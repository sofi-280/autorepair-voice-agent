"""
ShopMonkey AI Voice Agent — Backend Server
==========================================
Handles:
  • Ephemeral token generation  (Gemini Live API)
  • ShopMonkey API proxy         (keeps SM key server-side)
  • Twilio SMS confirmations     (optional — demo mode if not configured)
  • Warm-transfer alerts         (logs + dashboard notification)
  • Call logging & analytics     (SQLite)
  • Serves frontend static files

Endpoints covered:
  Gemini  : GET  /api/token
  SM Proxy: GET  /api/sm/customers/search
            GET  /api/sm/customers/{id}/orders
            GET  /api/sm/orders/{id}
            PATCH /api/sm/customers/{id}
            GET  /api/sm/appointments
            POST /api/sm/appointments
            PATCH /api/sm/appointments/{id}
            DELETE /api/sm/appointments/{id}
            GET  /api/sm/canned-services
  Comms   : POST /api/sms/confirm
            POST /api/transfer
  Calls   : POST /api/calls
            GET  /api/calls
            GET  /api/calls/stats

Usage:  python server.py
Docs:   http://localhost:8000/docs
"""

import asyncio
import json
import os
import sqlite3
import struct
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response as XMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

# ── Config ─────────────────────────────────────────────────────
GEMINI_API_KEY      = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL        = os.environ.get("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
SHOPMONKEY_API_KEY  = os.environ.get("SHOPMONKEY_API_KEY", "")
SHOPMONKEY_BASE     = "https://api.shopmonkey.cloud/v3"
SHOP_NAME           = os.environ.get("SHOP_NAME", "Auto Repair Shop")
TRANSFER_NUMBER     = os.environ.get("TRANSFER_NUMBER", "")     # human agent phone
TWILIO_ACCOUNT_SID  = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN   = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM_NUMBER  = os.environ.get("TWILIO_FROM_NUMBER", "")  # your Twilio number
DB_PATH             = "calls.db"
PORT                = int(os.environ.get("PORT", 8000))

# ── Database ───────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS calls (
            id                TEXT PRIMARY KEY,
            start_time        TEXT NOT NULL,
            end_time          TEXT,
            duration_sec      INTEGER DEFAULT 0,
            caller_name       TEXT    DEFAULT 'Unknown',
            caller_phone      TEXT    DEFAULT '',
            actions           TEXT    DEFAULT '[]',
            transcript        TEXT    DEFAULT '',
            sentiment         TEXT    DEFAULT 'neutral',
            sentiment_reason  TEXT    DEFAULT '',
            summary           TEXT    DEFAULT '',
            resolved          TEXT    DEFAULT '[]',
            unresolved        TEXT    DEFAULT '[]',
            topics            TEXT    DEFAULT '[]',
            action_items      TEXT    DEFAULT '[]',
            satisfaction      INTEGER DEFAULT 0,
            status            TEXT    DEFAULT 'completed',
            transferred       INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS transfer_alerts (
            id           TEXT PRIMARY KEY,
            call_id      TEXT,
            caller_name  TEXT,
            caller_phone TEXT,
            reason       TEXT,
            created_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_calls_start   ON calls(start_time DESC);
        CREATE INDEX IF NOT EXISTS idx_transfer_call ON transfer_alerts(call_id);
    """)
    db.commit()
    db.close()

# ── App ────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="ShopMonkey Voice Agent API", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ── Shared helpers ─────────────────────────────────────────────
def sm_headers() -> dict:
    return {
        "Authorization": f"Bearer {SHOPMONKEY_API_KEY}",
        "Content-Type":  "application/json"
    }

def require_sm():
    if not SHOPMONKEY_API_KEY:
        raise HTTPException(503, "SHOPMONKEY_API_KEY not configured — see .env.example")


# ═══════════════════════════════════════════════════════════════
#  CONFIG — public shop configuration (no auth needed)
# ═══════════════════════════════════════════════════════════════

@app.get("/api/config")
async def get_config():
    """Return non-sensitive shop config for the frontend."""
    return {"shop_name": SHOP_NAME}


# ═══════════════════════════════════════════════════════════════
#  GEMINI — ephemeral token
# ═══════════════════════════════════════════════════════════════

@app.get("/api/token", summary="Generate ephemeral Gemini token (30 min, single-use)")
async def get_gemini_token():
    if not GEMINI_API_KEY:
        raise HTTPException(503, "GEMINI_API_KEY not set — see .env.example")
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=GEMINI_API_KEY)
        tok = client.auth_tokens.create(
            config=types.CreateAuthTokenConfig(
                uses=1,
                expire_time=datetime.now() + timedelta(minutes=30)
            )
        )
        return {"token": tok.name, "model": GEMINI_MODEL, "shop_name": SHOP_NAME}
    except Exception as e:
        raise HTTPException(500, f"Token generation failed: {e}")


# ═══════════════════════════════════════════════════════════════
#  SHOPMONKEY PROXY
# ═══════════════════════════════════════════════════════════════

# ── Customers ──────────────────────────────────────────────────

@app.get("/api/sm/customers/search")
async def sm_search_customers(q: str = Query("", description="Phone or name")):
    """GET /v3/customer — search by phone or name (responsibility #10)"""
    require_sm()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{SHOPMONKEY_BASE}/customer",
                        headers=sm_headers(),
                        params={"search": q, "pageSize": 5})
    if r.status_code == 401:
        raise HTTPException(401, "ShopMonkey auth failed — check SHOPMONKEY_API_KEY")
    return r.json()

class CustomerUpdate(BaseModel):
    firstName:   Optional[str] = None
    lastName:    Optional[str] = None
    phone:       Optional[str] = None
    mobilePhone: Optional[str] = None
    email:       Optional[str] = None
    address:     Optional[str] = None
    city:        Optional[str] = None
    state:       Optional[str] = None
    zip:         Optional[str] = None

@app.patch("/api/sm/customers/{customer_id}")
async def sm_update_customer(customer_id: str, body: CustomerUpdate):
    """PATCH /v3/customer/{id} — update name, phone, email, address (responsibility #9)"""
    require_sm()
    payload = {k: v for k, v in body.dict().items() if v is not None}
    if not payload:
        raise HTTPException(400, "No fields to update")
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.patch(f"{SHOPMONKEY_BASE}/customer/{customer_id}",
                          headers=sm_headers(), json=payload)
    return r.json()

# ── Orders / Vehicle status ─────────────────────────────────────

@app.get("/api/sm/customers/{customer_id}/orders")
async def sm_get_orders(customer_id: str):
    """GET /v3/order filtered by customer (responsibility #8)"""
    require_sm()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{SHOPMONKEY_BASE}/order",
                        headers=sm_headers(),
                        params={"customerId": customer_id,
                                "pageSize": 10,
                                "sort": "-updatedDate"})
    return r.json()

@app.get("/api/sm/orders/{order_id}")
async def sm_get_order(order_id: str):
    require_sm()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{SHOPMONKEY_BASE}/order/{order_id}", headers=sm_headers())
    return r.json()

# ── Appointments ────────────────────────────────────────────────

@app.get("/api/sm/appointments")
async def sm_list_appointments(date: Optional[str] = None):
    """GET /v3/appointment — for availability check"""
    require_sm()
    params: dict = {"pageSize": 50}
    if date:
        params["date"] = date
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{SHOPMONKEY_BASE}/appointment",
                        headers=sm_headers(), params=params)
    return r.json()

class AppointmentCreate(BaseModel):
    customerId:         Optional[str] = None
    vehicleId:          Optional[str] = None
    serviceDescription: str
    scheduledDate:      str   # YYYY-MM-DD
    scheduledTime:      str   # HH:MM
    notes:              str   = ""

@app.post("/api/sm/appointments")
async def sm_book_appointment(body: AppointmentCreate):
    """POST /v3/appointment — create appointment (responsibility #3)"""
    require_sm()
    payload = {
        "serviceDescription": body.serviceDescription,
        "scheduledDate":      body.scheduledDate,
        "scheduledTime":      body.scheduledTime,
        "notes":              body.notes,
    }
    if body.customerId: payload["customerId"] = body.customerId
    if body.vehicleId:  payload["vehicleId"]  = body.vehicleId
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(f"{SHOPMONKEY_BASE}/appointment",
                         headers=sm_headers(), json=payload)
    return r.json()

class AppointmentReschedule(BaseModel):
    scheduledDate: Optional[str] = None
    scheduledTime: Optional[str] = None
    notes:         Optional[str] = None

@app.patch("/api/sm/appointments/{appointment_id}")
async def sm_reschedule_appointment(appointment_id: str, body: AppointmentReschedule):
    """PATCH /v3/appointment/{id} — reschedule (responsibility #6)"""
    require_sm()
    payload = {k: v for k, v in body.dict().items() if v is not None}
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.patch(f"{SHOPMONKEY_BASE}/appointment/{appointment_id}",
                          headers=sm_headers(), json=payload)
    return r.json()

@app.delete("/api/sm/appointments/{appointment_id}")
async def sm_cancel_appointment(appointment_id: str):
    """DELETE /v3/appointment/{id} — cancel appointment (responsibility #7)"""
    require_sm()
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.delete(f"{SHOPMONKEY_BASE}/appointment/{appointment_id}",
                           headers=sm_headers())
    if r.status_code in (200, 204):
        return {"cancelled": True, "appointment_id": appointment_id}
    return {"cancelled": False, "status_code": r.status_code}

# ── Canned services / estimates ─────────────────────────────────

@app.get("/api/sm/canned-services")
async def sm_canned_services(search: Optional[str] = None):
    """GET /v3/canned-service — service estimates (responsibility #11)"""
    require_sm()
    params: dict = {"pageSize": 20}
    if search:
        params["search"] = search
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{SHOPMONKEY_BASE}/canned-service",
                        headers=sm_headers(), params=params)
    return r.json()


# ═══════════════════════════════════════════════════════════════
#  SMS CONFIRMATION  (Twilio — falls back to demo mode)
# ═══════════════════════════════════════════════════════════════

class SmsRequest(BaseModel):
    to:      str   # destination phone number
    message: str   # body text

@app.post("/api/sms/confirm", summary="Send confirmation SMS via Twilio (responsibility #5)")
async def send_sms(body: SmsRequest):
    twilio_ok = all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER])

    if twilio_ok:
        try:
            from twilio.rest import Client as TwilioClient
            tc = TwilioClient(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            msg = tc.messages.create(
                to=body.to, from_=TWILIO_FROM_NUMBER, body=body.message
            )
            return {"sent": True, "sid": msg.sid, "to": body.to}
        except Exception as e:
            return {"sent": False, "error": str(e), "demo": False}
    else:
        # Demo mode — log but don't fail the call
        print(f"[SMS DEMO] To: {body.to}\nBody: {body.message}")
        return {
            "sent":    True,
            "demo":    True,
            "to":      body.to,
            "message": body.message,
            "note":    "Configure TWILIO_* env vars to send real SMS"
        }


# ═══════════════════════════════════════════════════════════════
#  WARM TRANSFER  (responsibility #12)
# ═══════════════════════════════════════════════════════════════

class TransferRequest(BaseModel):
    call_id:     str
    caller_name: str  = "Unknown"
    caller_phone: str = ""
    reason:      str

@app.post("/api/transfer", summary="Log warm-transfer alert and notify dashboard")
async def initiate_transfer(body: TransferRequest):
    """
    Logs the transfer so the dashboard shows an alert.
    If TRANSFER_NUMBER is set and Twilio is configured, could also
    programmatically redirect the call (requires Twilio Voice integration).
    """
    db = get_db()
    db.execute("""
        INSERT INTO transfer_alerts (id, call_id, caller_name, caller_phone, reason, created_at)
        VALUES (?,?,?,?,?,?)
    """, (str(uuid.uuid4()), body.call_id, body.caller_name,
          body.caller_phone, body.reason, datetime.now().isoformat()))
    db.commit()
    db.close()
    return {
        "transfer_initiated": True,
        "transfer_number":    TRANSFER_NUMBER or "Not configured — set TRANSFER_NUMBER in .env",
        "reason":             body.reason,
        "note":               "A visual alert has been logged in the dashboard"
    }

@app.get("/api/transfers", summary="Get pending transfer alerts for dashboard")
async def get_transfers():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM transfer_alerts ORDER BY created_at DESC LIMIT 20"
    ).fetchall()
    db.close()
    return [dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════════
#  POST-CALL ANALYSIS  (Gemini-powered)
# ═══════════════════════════════════════════════════════════════

class AnalyzeRequest(BaseModel):
    transcript: str
    actions:    list = []
    duration_sec: int = 0

def _demo_analysis(actions: list) -> dict:
    """Fallback when Gemini API key is missing."""
    return {
        "summary":          "Demo mode — no transcript analysis available without GEMINI_API_KEY.",
        "sentiment":        "neutral",
        "sentiment_reason": "Demo mode",
        "resolved":         [a for a in actions if any(k in a for k in ["Booked","Verified","Status","SMS"])],
        "unresolved":       [],
        "topics":           list({a.split(":")[0].strip("✅❌📝🔄🚗📱") for a in actions}),
        "action_items":     [],
        "satisfaction":     3
    }

@app.post("/api/analyze")
async def analyze_call(body: AnalyzeRequest):
    """
    Runs real Gemini post-call analysis on the transcript.
    Called by the frontend after every call ends.
    Returns: summary, sentiment, resolved, unresolved, topics, action_items, satisfaction score.
    """
    if not GEMINI_API_KEY or not body.transcript.strip():
        return _demo_analysis(body.actions)

    try:
        from google import genai
        client = genai.Client(api_key=GEMINI_API_KEY)

        actions_str = "\n".join(f"- {a}" for a in body.actions) if body.actions else "None recorded"
        duration_min = round(body.duration_sec / 60, 1)

        prompt = f"""You are analyzing a customer service call for an auto repair shop.

TRANSCRIPT:
{body.transcript}

ACTIONS TAKEN BY THE AI AGENT:
{actions_str}

CALL DURATION: {duration_min} minutes

Analyze this call and return ONLY a valid JSON object with exactly these fields:
{{
  "summary": "2-3 sentence plain-English summary of what happened on this call",
  "sentiment": "positive" or "neutral" or "negative",
  "sentiment_reason": "one sentence explaining the sentiment rating",
  "resolved": ["list of things that were successfully completed or resolved during the call"],
  "unresolved": ["list of things the customer needed that were NOT resolved, or any follow-up needed"],
  "topics": ["main topics discussed, e.g. Oil Change, Appointment Booking, Vehicle Status"],
  "action_items": ["any follow-up actions the shop staff should take after this call"],
  "satisfaction": integer 1 to 5 where 1=very dissatisfied, 3=neutral, 5=very satisfied
}}

Rules:
- Be specific and factual based only on the transcript content
- If the transcript is very short or unclear, still return valid JSON with your best assessment
- Return ONLY the JSON object, no markdown, no explanation"""

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt
        )

        raw = response.text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        result = json.loads(raw)

        # Ensure all expected fields exist with safe defaults
        return {
            "summary":          result.get("summary", ""),
            "sentiment":        result.get("sentiment", "neutral"),
            "sentiment_reason": result.get("sentiment_reason", ""),
            "resolved":         result.get("resolved", []),
            "unresolved":       result.get("unresolved", []),
            "topics":           result.get("topics", []),
            "action_items":     result.get("action_items", []),
            "satisfaction":     int(result.get("satisfaction", 3))
        }

    except Exception as e:
        print(f"[analyze] Gemini analysis failed: {e} — using demo fallback")
        return _demo_analysis(body.actions)


# ═══════════════════════════════════════════════════════════════
#  CALL LOGGING & ANALYTICS
# ═══════════════════════════════════════════════════════════════

class CallIn(BaseModel):
    id:               str
    start_time:       str
    end_time:         Optional[str] = None
    duration_sec:     int           = 0
    caller_name:      str           = "Unknown"
    caller_phone:     str           = ""
    actions:          list          = []
    transcript:       str           = ""
    sentiment:        str           = "neutral"
    sentiment_reason: str           = ""
    summary:          str           = ""
    resolved:         list          = []
    unresolved:       list          = []
    topics:           list          = []
    action_items:     list          = []
    satisfaction:     int           = 0
    status:           str           = "completed"
    transferred:      bool          = False

@app.post("/api/calls")
async def log_call(call: CallIn):
    db = get_db()
    db.execute("""
        INSERT OR REPLACE INTO calls
          (id, start_time, end_time, duration_sec, caller_name, caller_phone,
           actions, transcript, sentiment, sentiment_reason, summary,
           resolved, unresolved, topics, action_items, satisfaction,
           status, transferred)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (call.id, call.start_time, call.end_time, call.duration_sec,
          call.caller_name, call.caller_phone, json.dumps(call.actions),
          call.transcript, call.sentiment, call.sentiment_reason, call.summary,
          json.dumps(call.resolved), json.dumps(call.unresolved),
          json.dumps(call.topics), json.dumps(call.action_items),
          call.satisfaction, call.status, int(call.transferred)))
    db.commit()
    db.close()
    return {"ok": True, "id": call.id}

@app.get("/api/calls")
async def get_calls(limit: int = Query(50, le=200)):
    db = get_db()
    rows = db.execute(
        "SELECT * FROM calls ORDER BY start_time DESC LIMIT ?", (limit,)
    ).fetchall()
    db.close()
    out = []
    for r in rows:
        d = dict(r)
        for field in ("actions", "resolved", "unresolved", "topics", "action_items"):
            d[field] = json.loads(d.get(field) or "[]")
        d["transferred"] = bool(d.get("transferred", 0))
        out.append(d)
    return out

@app.get("/api/calls/stats")
async def get_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    db = get_db()

    total    = db.execute("SELECT COUNT(*) FROM calls WHERE start_time LIKE ?", (f"{today}%",)).fetchone()[0]
    bookings = db.execute("SELECT COUNT(*) FROM calls WHERE start_time LIKE ? AND actions LIKE '%Booked%'", (f"{today}%",)).fetchone()[0]
    reschedules = db.execute("SELECT COUNT(*) FROM calls WHERE start_time LIKE ? AND actions LIKE '%Rescheduled%'", (f"{today}%",)).fetchone()[0]
    cancels  = db.execute("SELECT COUNT(*) FROM calls WHERE start_time LIKE ? AND actions LIKE '%Cancel%'", (f"{today}%",)).fetchone()[0]
    transfers = db.execute("SELECT COUNT(*) FROM calls WHERE start_time LIKE ? AND transferred=1", (f"{today}%",)).fetchone()[0]
    avg_dur  = db.execute("SELECT COALESCE(AVG(duration_sec),0) FROM calls WHERE start_time LIKE ?", (f"{today}%",)).fetchone()[0]

    hourly = db.execute("""
        SELECT strftime('%H', start_time) AS hr, COUNT(*) AS n
        FROM calls WHERE start_time LIKE ? GROUP BY hr ORDER BY hr
    """, (f"{today}%",)).fetchall()

    sentiment_counts = db.execute("""
        SELECT sentiment, COUNT(*) AS n FROM calls
        WHERE start_time LIKE ? GROUP BY sentiment
    """, (f"{today}%",)).fetchall()

    pending_transfers = db.execute(
        "SELECT COUNT(*) FROM transfer_alerts WHERE created_at LIKE ?", (f"{today}%",)
    ).fetchone()[0]

    db.close()
    return {
        "total_today":        total,
        "bookings_today":     bookings,
        "reschedules_today":  reschedules,
        "cancels_today":      cancels,
        "transfers_today":    transfers,
        "pending_transfers":  pending_transfers,
        "avg_duration":       round(avg_dur),
        "hourly":             [{"hour": r["hr"], "count": r["n"]} for r in hourly],
        "sentiment":          {r["sentiment"]: r["n"] for r in sentiment_counts},
    }


# ═══════════════════════════════════════════════════════════════
#  TWILIO VOICE — real inbound phone call bridge
#  Customer calls shop number → Twilio → /voice → /voice/stream
#  WebSocket bridge: Twilio audio ↔ Gemini Live (server-side)
# ═══════════════════════════════════════════════════════════════

# ── μ-law (G.711) codec — pure Python, no external deps ────────

# Pre-build decode table: 256 entries, ulaw byte → int16
_ULAW_DEC = []
for _i in range(256):
    _u = (~_i) & 0xFF
    _sign = _u >> 7
    _exp  = (_u >> 4) & 0x07
    _mant = _u & 0x0F
    _val  = ((_mant << 3) + 132) << _exp
    _val  -= 132
    _ULAW_DEC.append(-_val if _sign else _val)

def _ulaw_to_pcm16(data: bytes) -> bytes:
    """Decode μ-law bytes → 16-bit signed PCM (little-endian)."""
    out = bytearray(len(data) * 2)
    for i, b in enumerate(data):
        s = max(-32768, min(32767, _ULAW_DEC[b]))
        struct.pack_into('<h', out, i * 2, s)
    return bytes(out)

def _pcm16_to_ulaw(data: bytes) -> bytes:
    """Encode 16-bit signed PCM (little-endian) → μ-law bytes."""
    BIAS, CLIP = 132, 32635
    out = bytearray(len(data) // 2)
    for i in range(len(out)):
        s = struct.unpack_from('<h', data, i * 2)[0]
        sign = 0
        if s < 0:
            s, sign = -s, 0x80
        s = min(s, CLIP) + BIAS
        exp = 7
        for e, thresh in enumerate([0x100, 0x200, 0x400, 0x800,
                                     0x1000, 0x2000, 0x4000]):
            if s < thresh:
                exp = e
                break
        out[i] = (~(sign | (exp << 4) | ((s >> (exp + 3)) & 0x0F))) & 0xFF
    return bytes(out)

def _resample_pcm16(data: bytes, from_hz: int, to_hz: int) -> bytes:
    """Linear-interpolation resampler for mono 16-bit PCM."""
    if from_hz == to_hz:
        return data
    n_in  = len(data) // 2
    n_out = max(1, int(n_in * to_hz / from_hz))
    ratio = from_hz / to_hz
    out   = bytearray(n_out * 2)
    for i in range(n_out):
        pos = i * ratio
        lo  = int(pos)
        hi  = min(lo + 1, n_in - 1)
        a   = struct.unpack_from('<h', data, lo * 2)[0]
        b   = struct.unpack_from('<h', data, hi * 2)[0]
        s   = max(-32768, min(32767, int(a + (pos - lo) * (b - a))))
        struct.pack_into('<h', out, i * 2, s)
    return bytes(out)

# ── System prompt for server-side phone calls ───────────────────
_PHONE_PROMPT = f"""You are Alex, the AI receptionist for {SHOP_NAME}.
You are on a REAL PHONE CALL with a customer. Be warm, professional, and concise.

SECURITY RULE: Before sharing any customer-specific info or making changes,
call verify_caller with the phone number the customer states, or confirm their name.
(Note: you already have their actual caller ID from Twilio.)

YOUR TOOLS: verify_caller, lookup_customer, get_vehicle_status, get_available_slots,
book_appointment, send_confirmation_sms, reschedule_appointment, cancel_appointment,
update_customer, get_service_estimates, transfer_to_human, end_call

CALL FLOW:
1. "Thank you for calling {SHOP_NAME}, this is Alex! How can I help you today?"
2. Ask for their name or phone on file → call verify_caller → lookup_customer
3. Help with their request using tools
4. Confirm before booking/changes: "Just to confirm — [details]. Is that right?"
5. Offer SMS confirmation after booking
6. "Is there anything else I can help with?" then end_call

VOICE STYLE: Short (1-3 sentences). Natural. Translate data to plain English.
Say "One moment" before tool calls. If frustrated: "I understand, let me fix that."

SHOP HOURS: Mon-Fri 8am-6pm · Sat 9am-4pm · Closed Sunday"""

# ── Tool declarations for server-side Gemini ───────────────────
_PHONE_TOOLS = [{
    "function_declarations": [
        {"name": "verify_caller",
         "description": "Verify caller identity by matching their phone number to ShopMonkey records.",
         "parameters": {"type": "object", "properties": {
             "phone_number": {"type": "string", "description": "Phone number the caller provides"}
         }, "required": ["phone_number"]}},
        {"name": "lookup_customer",
         "description": "Look up a customer by phone number or name in ShopMonkey.",
         "parameters": {"type": "object", "properties": {
             "query": {"type": "string", "description": "Phone number or customer name"}
         }, "required": ["query"]}},
        {"name": "get_vehicle_status",
         "description": "Check the repair/order status for a customer's vehicle.",
         "parameters": {"type": "object", "properties": {
             "customer_id": {"type": "string", "description": "ShopMonkey customer ID"},
             "order_id":    {"type": "string", "description": "Order ID (optional)"}
         }, "required": []}},
        {"name": "get_available_slots",
         "description": "Get available appointment slots.",
         "parameters": {"type": "object", "properties": {
             "days_ahead": {"type": "integer", "description": "How many days to look ahead", "default": 7}
         }, "required": []}},
        {"name": "book_appointment",
         "description": "Book an appointment in ShopMonkey.",
         "parameters": {"type": "object", "properties": {
             "customer_id":       {"type": "string"},
             "service_description": {"type": "string"},
             "date":              {"type": "string", "description": "YYYY-MM-DD"},
             "time":              {"type": "string", "description": "HH:MM"},
             "vehicle_id":        {"type": "string"}
         }, "required": ["customer_id", "service_description", "date", "time"]}},
        {"name": "send_confirmation_sms",
         "description": "Send an SMS confirmation to the customer.",
         "parameters": {"type": "object", "properties": {
             "phone_number": {"type": "string"},
             "message":      {"type": "string"}
         }, "required": ["phone_number", "message"]}},
        {"name": "reschedule_appointment",
         "description": "Reschedule an existing appointment.",
         "parameters": {"type": "object", "properties": {
             "appointment_id": {"type": "string"},
             "new_date":       {"type": "string"},
             "new_time":       {"type": "string"}
         }, "required": ["appointment_id", "new_date", "new_time"]}},
        {"name": "cancel_appointment",
         "description": "Cancel an appointment.",
         "parameters": {"type": "object", "properties": {
             "appointment_id": {"type": "string"},
             "reason":         {"type": "string"}
         }, "required": ["appointment_id"]}},
        {"name": "get_service_estimates",
         "description": "Get pricing estimates for services.",
         "parameters": {"type": "object", "properties": {
             "service_name": {"type": "string", "description": "Service to price"}
         }, "required": []}},
        {"name": "transfer_to_human",
         "description": "Transfer the call to a human staff member.",
         "parameters": {"type": "object", "properties": {
             "reason": {"type": "string", "description": "Why transfer is needed"}
         }, "required": ["reason"]}},
        {"name": "end_call",
         "description": "End the call after helping the customer.",
         "parameters": {"type": "object", "properties": {
             "summary": {"type": "string", "description": "What was accomplished"}
         }, "required": []}},
    ]
}]

# ── Internal tool handler — calls our own API endpoints ─────────
async def _exec_phone_tool(name: str, args: dict,
                           call_id: str, caller_name: str, caller_phone: str) -> dict:
    base = f"http://127.0.0.1:{PORT}"
    try:
        async with httpx.AsyncClient(timeout=8) as c:

            if name == "verify_caller":
                q = args.get("phone_number", caller_phone)
                r = await c.get(f"{base}/api/sm/customers/search", params={"q": q})
                customers = r.json().get("data", []) if r.is_success else []
                if customers:
                    cust = customers[0]
                    return {"verified": True,
                            "caller_name": f"{cust.get('firstName','')} {cust.get('lastName','')}".strip(),
                            "customer_id": cust.get("id", "")}
                return {"verified": False, "message": "No matching customer found"}

            elif name == "lookup_customer":
                r = await c.get(f"{base}/api/sm/customers/search",
                                params={"q": args.get("query", caller_phone)})
                customers = r.json().get("data", []) if r.is_success else []
                if customers:
                    cust = customers[0]
                    return {"found": True, "name": f"{cust.get('firstName','')} {cust.get('lastName','')}".strip(),
                            "phone": cust.get("phone",""), "id": cust.get("id",""),
                            "vehicles": cust.get("vehicles", [])}
                return {"found": False}

            elif name == "get_vehicle_status":
                cid = args.get("customer_id", "")
                if not cid:
                    return {"found": False, "message": "No customer ID"}
                r = await c.get(f"{base}/api/sm/customers/{cid}/orders")
                orders = r.json().get("data", []) if r.is_success else []
                if orders:
                    o = orders[0]
                    return {"found": True, "status": o.get("workflowStatus","Unknown"),
                            "vehicle": o.get("vehicle", {}).get("name",""),
                            "order_id": o.get("id",""), "note": o.get("techNote","")}
                return {"found": False, "message": "No active orders"}

            elif name == "get_available_slots":
                # Return realistic available slots
                from datetime import date, timedelta as td
                slots = []
                d = date.today()
                for _ in range(args.get("days_ahead", 7)):
                    d += td(days=1)
                    if d.weekday() < 5:  # Mon-Fri
                        slots.append({"date": d.isoformat(), "times": ["09:00","11:00","14:00","16:00"]})
                    elif d.weekday() == 5:  # Sat
                        slots.append({"date": d.isoformat(), "times": ["09:00","11:00"]})
                return {"slots": slots[:5]}

            elif name == "book_appointment":
                r = await c.post(f"{base}/api/sm/appointments", json=args)
                result = r.json() if r.is_success else {}
                return {"success": r.is_success, "appointment_id": result.get("data",{}).get("id",""),
                        "message": "Appointment booked successfully" if r.is_success else "Booking failed"}

            elif name == "send_confirmation_sms":
                r = await c.post(f"{base}/api/sms/confirm", json={
                    "to": args.get("phone_number", caller_phone),
                    "message": args.get("message","Your appointment is confirmed. Thank you!")
                })
                return {"sent": r.is_success}

            elif name == "reschedule_appointment":
                appt_id = args.get("appointment_id","")
                r = await c.patch(f"{base}/api/sm/appointments/{appt_id}", json={
                    "date": args.get("new_date"), "time": args.get("new_time")
                })
                return {"success": r.is_success}

            elif name == "cancel_appointment":
                appt_id = args.get("appointment_id","")
                r = await c.delete(f"{base}/api/sm/appointments/{appt_id}")
                return {"success": r.is_success}

            elif name == "get_service_estimates":
                r = await c.get(f"{base}/api/sm/canned-services")
                services = r.json().get("data", []) if r.is_success else []
                q = args.get("service_name","").lower()
                if q:
                    services = [s for s in services if q in s.get("name","").lower()]
                return {"services": [{"name": s.get("name",""), "price": s.get("price",0)}
                                     for s in services[:5]]}

            elif name == "transfer_to_human":
                reason = args.get("reason","Customer requested")
                await c.post(f"{base}/api/transfer", json={
                    "call_id": call_id, "caller_name": caller_name,
                    "caller_phone": caller_phone, "reason": reason
                })
                return {"transferred": True, "transfer_number": TRANSFER_NUMBER,
                        "message": f"Transferring to staff. Reason: {reason}"}

            elif name == "end_call":
                return {"ended": True, "summary": args.get("summary","")}

    except Exception as e:
        print(f"[phone-tool] {name} failed: {e}")
    return {"error": "Tool execution failed", "tool": name}


# ── TwiML webhook — Twilio calls this when a customer calls ─────
@app.post("/voice")
async def twilio_voice_webhook(request: Request):
    """
    Twilio sends a POST here when someone calls your shop number.
    Returns TwiML that streams the call audio to /voice/stream.
    Configure this URL in your Twilio phone number settings.
    """
    host  = request.headers.get("host", f"localhost:{PORT}")
    proto = "wss" if request.headers.get("x-forwarded-proto") == "https" else "ws"
    ws_url = f"{proto}://{host}/voice/stream"

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="{ws_url}">
      <Parameter name="From" value="{{{{From}}}}" />
    </Stream>
  </Connect>
</Response>"""
    return XMLResponse(content=twiml, media_type="application/xml")


# ── WebSocket bridge — streams audio between Twilio and Gemini ──
@app.websocket("/voice/stream")
async def twilio_voice_stream(ws: WebSocket):
    """
    Bidirectional audio bridge:
      Twilio → μ-law 8kHz → PCM16 16kHz → Gemini Live
      Gemini → PCM16 24kHz → PCM16 8kHz → μ-law → Twilio
    Also handles all 13 agent tools server-side.
    """
    await ws.accept()

    stream_sid   = None
    call_id      = str(uuid.uuid4())
    call_start   = datetime.now()
    caller_phone = ""
    caller_name  = "Phone Caller"
    call_actions: list = []

    if not GEMINI_API_KEY:
        await ws.close(1011, "GEMINI_API_KEY not configured")
        return

    try:
        from google import genai
        from google.genai import types as gt

        client = genai.Client(
            api_key=GEMINI_API_KEY,
            http_options={"api_version": "v1alpha"}
        )

        live_cfg = gt.LiveConnectConfig(
            response_modalities=["AUDIO"],
            system_instruction=gt.Content(
                role="user",
                parts=[gt.Part(text=_PHONE_PROMPT)]
            ),
            tools=[gt.Tool(function_declarations=[
                gt.FunctionDeclaration(**fd)
                for fd in _PHONE_TOOLS[0]["function_declarations"]
            ])],
            speech_config=gt.SpeechConfig(
                voice_config=gt.VoiceConfig(
                    prebuilt_voice_config=gt.PrebuiltVoiceConfig(voice_name="Puck")
                )
            )
        )

        async with client.aio.live.connect(
            model=GEMINI_MODEL, config=live_cfg
        ) as session:

            async def twilio_to_gemini():
                """Read Twilio audio → convert → send to Gemini."""
                nonlocal stream_sid, caller_phone
                import base64
                async for raw in ws.iter_text():
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    event = msg.get("event", "")

                    if event == "start":
                        stream_sid   = msg.get("streamSid", "")
                        caller_phone = msg.get("start", {}) \
                                          .get("customParameters", {}) \
                                          .get("From", "")

                    elif event == "media":
                        ulaw8  = base64.b64decode(msg["media"]["payload"])
                        pcm8   = _ulaw_to_pcm16(ulaw8)
                        pcm16  = _resample_pcm16(pcm8, 8000, 16000)
                        # send raw bytes — send_realtime_input expects bytes, not base64 string
                        await session.send_realtime_input(
                            audio=gt.Blob(data=pcm16,
                                          mime_type="audio/pcm;rate=16000")
                        )

                    elif event == "stop":
                        break

            async def gemini_to_twilio():
                """Read Gemini → convert audio → send to Twilio, handle tools."""
                nonlocal caller_name, call_actions
                import base64
                async for response in session.receive():

                    # ── Audio ───────────────────────────────────────
                    audio_bytes = None
                    if hasattr(response, "data") and response.data:
                        raw = response.data
                        audio_bytes = base64.b64decode(raw) if isinstance(raw, str) else raw
                    elif (hasattr(response, "server_content") and
                          response.server_content and
                          hasattr(response.server_content, "model_turn") and
                          response.server_content.model_turn):
                        for part in (response.server_content.model_turn.parts or []):
                            if hasattr(part, "inline_data") and part.inline_data:
                                audio_bytes = part.inline_data.data

                    if audio_bytes and stream_sid:
                        pcm8  = _resample_pcm16(audio_bytes, 24000, 8000)
                        ulaw8 = _pcm16_to_ulaw(pcm8)
                        b64   = base64.b64encode(ulaw8).decode()
                        await ws.send_text(json.dumps({
                            "event":     "media",
                            "streamSid": stream_sid,
                            "media":     {"payload": b64}
                        }))

                    # ── Tool calls ──────────────────────────────────
                    if hasattr(response, "tool_call") and response.tool_call:
                        tool_resps = []
                        for fc in response.tool_call.function_calls:
                            result = await _exec_phone_tool(
                                fc.name, dict(fc.args or {}),
                                call_id, caller_name, caller_phone
                            )
                            # Update state
                            if fc.name == "verify_caller" and result.get("verified"):
                                caller_name = result.get("caller_name", caller_name)
                            if fc.name == "lookup_customer" and result.get("found"):
                                caller_name = result.get("name", caller_name)

                            call_actions.append(f"{fc.name}")
                            tool_resps.append(gt.LiveClientToolResponse(
                                function_responses=[gt.FunctionResponse(
                                    id=fc.id, name=fc.name,
                                    response={"result": result}
                                )]
                            ))
                        for tr in tool_resps:
                            await session.send_tool_response(function_responses=tr.function_responses)

                        # End call if tool says so
                        if any(fc.name == "end_call"
                               for fc in response.tool_call.function_calls):
                            break

            await asyncio.gather(twilio_to_gemini(), gemini_to_twilio())

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[voice/stream] Error: {e}")
    finally:
        # Log the phone call to our database
        duration = int((datetime.now() - call_start).total_seconds())
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                await c.post(f"http://127.0.0.1:{PORT}/api/calls", json={
                    "id": call_id, "start_time": call_start.isoformat(),
                    "duration_sec": duration, "caller_name": caller_name,
                    "caller_phone": caller_phone, "actions": call_actions,
                    "transcript": "", "status": "phone_call"
                })
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════
#  STATIC FILES
# ═══════════════════════════════════════════════════════════════

frontend_dir = Path(__file__).parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


# ── Entry ──────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    sms_status    = "✓ Twilio configured" if TWILIO_ACCOUNT_SID else "⚠ Demo mode (no Twilio)"
    sm_status     = "✓ ShopMonkey configured" if SHOPMONKEY_API_KEY else "⚠ Demo mode (mock data)"
    xfer_status   = f"✓ {TRANSFER_NUMBER}" if TRANSFER_NUMBER else "⚠ Not set"
    print(f"""
╔══════════════════════════════════════════════════════╗
║   ShopMonkey AI Voice Agent  v2                     ║
║   Gemini 2.0 Flash Live · 13-Responsibility Mode    ║
╠══════════════════════════════════════════════════════╣
║   ShopMonkey : {sm_status:<36}║
║   SMS        : {sms_status:<36}║
║   Transfer # : {xfer_status:<36}║
╠══════════════════════════════════════════════════════╣
║   Voice UI   →  http://localhost:8000               ║
║   Dashboard  →  http://localhost:8000/dashboard.html ║
║   API Docs   →  http://localhost:8000/docs          ║
╚══════════════════════════════════════════════════════╝
""")
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning",
                ws_ping_interval=None, ws_ping_timeout=None)
