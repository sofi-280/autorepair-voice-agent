"""FastAPI entry point.

Routes:
  POST /twilio-webhook     — inbound Twilio phone call
  POST /start-browser-call — browser-based call from dashboard
  GET  /health             — health check
"""
import logging
import subprocess
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from daily_helpers import create_daily_room
from db.session_logger import log_call_start

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SRC_DIR = Path(__file__).parent

app = FastAPI(title="Smart Choice Auto Shop Voice Server", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok"}


# ── Twilio inbound call ───────────────────────────────────────────────────────

@app.post("/twilio-webhook")
async def twilio_webhook(request: Request):
    """Receive inbound Twilio call, create Daily SIP room, launch bot."""
    form = await request.form()
    call_sid = form.get("CallSid", str(uuid.uuid4()))
    from_number = form.get("From", "unknown")
    session_id = str(uuid.uuid4())

    logger.info("Inbound call: CallSid=%s From=%s", call_sid, from_number)

    try:
        room = await create_daily_room(session_id, sip_enabled=True)
    except Exception as exc:
        logger.error("Failed to create Daily room: %s", exc)
        twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>We're sorry, we're experiencing technical difficulties. Please call back later.</Say>
  <Hangup/>
</Response>"""
        return Response(content=twiml, media_type="application/xml")

    await log_call_start(
        session_id=session_id,
        caller_id=from_number,
        channel="phone",
        room_name=room["name"],
        call_sid=call_sid,
    )

    subprocess.Popen(
        [
            sys.executable,
            str(SRC_DIR / "bot_twilio.py"),
            "--room-url",   room["url"],
            "--room-token", room["bot_token"],
            "--call-sid",   call_sid,
            "--session-id", session_id,
        ],
        cwd=str(SRC_DIR),
    )

    sip_uri = room["sip_uri"]
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling Smart Choice Auto Shop. Please hold while we connect you.</Say>
  <Dial callerId="{settings.twilio_phone_number}">
    <Sip>{sip_uri}</Sip>
  </Dial>
</Response>"""
    return Response(content=twiml, media_type="application/xml")


# ── Browser call ──────────────────────────────────────────────────────────────

@app.post("/start-browser-call")
async def start_browser_call(request: Request):
    """Called by the dashboard to initiate a browser-based call session."""
    body = await request.json()
    session_id = body.get("session_id", str(uuid.uuid4()))

    room = await create_daily_room(session_id, sip_enabled=False)

    await log_call_start(
        session_id=session_id,
        caller_id="browser",
        channel="browser",
        room_name=room["name"],
    )

    subprocess.Popen(
        [
            sys.executable,
            str(SRC_DIR / "bot_daily.py"),
            "--room-url",   room["url"],
            "--room-token", room["bot_token"],
            "--session-id", session_id,
        ],
        cwd=str(SRC_DIR),
    )

    return {
        "session_id": session_id,
        "room_url":   room["url"],
        "user_token": room["user_token"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
