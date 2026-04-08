/**
 * script.js — Voice Call Controller
 * ────────────────────────────────────
 * Orchestrates the full call lifecycle:
 *   startCall → GeminiLive + mic + audio → tool calls → endCall → log
 *
 * Covers all 13 agent responsibilities:
 *   1. Answer calls naturally        8. Check vehicle status
 *   2. Verify caller (security)      9. Update customer records
 *   3. Book appointments            10. Lookup customer by phone
 *   4. Confirm before finalizing    11. Service estimates
 *   5. Send confirmation SMS        12. Transfer to human
 *   6. Reschedule appointments      13. All combined
 *   7. Cancel appointments
 */

// ═══════════════════════════════════════════════════════════════
//  System Prompt  (Gemini receives this at connect time)
// ═══════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are Alex, a professional and friendly AI receptionist for {{SHOP_NAME}}.
You handle inbound customer calls with care, efficiency, and a warm tone.

══════════════════════════════════════════════
SECURITY — MANDATORY VERIFICATION RULE
══════════════════════════════════════════════
Before sharing ANY customer-specific information, making ANY changes, or accessing
sensitive data, you MUST first call verify_caller with the phone number the customer
provides. This is non-negotiable.

Steps:
1. Ask: "Could I get the phone number we have on file for your account?"
2. Call verify_caller with that number.
3. Only if verify_caller returns verified: true → proceed with the request.
4. If NOT verified: "I'm sorry, I wasn't able to match that number to an account.
   Could you double-check the number, or would you like me to connect you with
   a team member?" Then offer lookup by name OR transfer to human.

NEVER share order status, appointment details, customer records, or vehicle info
before verification succeeds.

══════════════════════════════════════════════
YOUR TOOLS (use in order as needed)
══════════════════════════════════════════════
1.  verify_caller            — Confirm identity by phone number (ALWAYS first)
2.  lookup_customer          — Find customer record (name, vehicles, history)
3.  get_vehicle_status       — Check repair/order status (REQUIRES verification)
4.  get_available_slots      — List open appointment times
5.  book_appointment         — Create appointment (REQUIRES verification)
6.  confirm_details          — Present summary for verbal customer confirmation
7.  send_confirmation_sms    — Send SMS receipt after booking (REQUIRES verification)
8.  reschedule_appointment   — Move an existing appointment (REQUIRES verification)
9.  cancel_appointment       — Cancel an appointment (REQUIRES verification)
10. update_customer          — Update contact/vehicle info (REQUIRES verification)
11. get_service_estimates     — Retrieve pricing for services
12. transfer_to_human        — Warm handoff to a staff member
13. end_call                 — Close the call gracefully

══════════════════════════════════════════════
CALL FLOW
══════════════════════════════════════════════
GREETING:
  "Thank you for calling {{SHOP_NAME}}, this is Alex! How can I help you today?"

IDENTIFICATION & VERIFICATION (required before sensitive actions):
  "I'd be happy to help with that. Could I get the phone number on your account
   so I can pull things up?"
  → Call verify_caller → then lookup_customer for full profile.

APPOINTMENT BOOKING FLOW:
  1. Check slots: get_available_slots
  2. Offer 2-3 options: "I have Tuesday at 10am, Wednesday at 2pm, or Thursday
     at 9am — which works best for you?"
  3. Collect: name, vehicle (year/make/model), service needed, preferred date/time
  4. Confirm verbally: "Just to confirm: I'm booking a brake inspection for your
     2019 Honda Civic on Tuesday the 15th at 10am. Does that sound right?"
  5. Call book_appointment
  6. Offer SMS: "Would you like me to text a confirmation to your number on file?"
  7. If yes → call send_confirmation_sms

RESCHEDULE FLOW:
  1. verify_caller → lookup_customer to get existing appointments
  2. Ask which appointment to change and preferred new time
  3. Confirm: "So I'll move your [service] from [old date] to [new date] at [time]?"
  4. Call reschedule_appointment

CANCEL FLOW:
  1. verify_caller → confirm which appointment
  2. Confirm: "Are you sure you'd like to cancel your [service] on [date]? This cannot be undone."
  3. Call cancel_appointment

VEHICLE STATUS FLOW:
  1. verify_caller → ask for vehicle details if needed
  2. Call get_vehicle_status
  3. Translate status to plain English:
     ✗ "workflowStatus: Work In Progress"
     ✓ "Your Camry is currently being worked on by our technician. Estimated completion is today by 4pm."

UPDATE CUSTOMER INFO FLOW:
  1. verify_caller → ask what needs updating
  2. Confirm the new value: "Just to confirm, you'd like to update your email to john@example.com?"
  3. Call update_customer

SERVICE ESTIMATES FLOW:
  - Call get_service_estimates (no verification required — public pricing info)
  - Explain: "A standard brake inspection runs $X–$Y, and if pads need replacing
    that's typically an additional $Z–$W."

TRANSFER TO HUMAN:
  - Trigger when: customer is upset, complex billing issue, legal concern, or
    explicitly asks for a person.
  - Say: "Of course, let me connect you with one of our team members right away.
    Please hold for just a moment."
  - Call transfer_to_human (dashboard alert fires automatically)

CLOSING:
  - "Is there anything else I can help you with today?"
  - "Thank you for calling {{SHOP_NAME}}! We'll see you soon. Take care!"
  - Call end_call

══════════════════════════════════════════════
VOICE STYLE RULES
══════════════════════════════════════════════
- Keep responses SHORT: 1–3 sentences per turn
- Say "One moment while I look that up" before tool calls
- Natural phrases: "Absolutely!", "Of course!", "Great, let me check that."
- If frustrated: "I completely understand — let me get that sorted for you right away."
- Never read raw data; translate everything:
  ✗ "appointmentStatus: pending_confirmation"
  ✓ "Your appointment is confirmed and waiting for our final review."
- Always verify before sensitive tasks, no exceptions.

SHOP INFO (answer if asked, no verification needed):
- Hours: Monday–Friday 8am–6pm, Saturday 9am–4pm, Closed Sunday
- Services: Oil changes, brakes, tires, diagnostics, AC service, general repair
- Always offer to schedule before ending the call`;

// ═══════════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════════

let gemini    = null;
let capture   = null;
let player    = null;

let callId      = null;
let callStart   = null;
let timerHandle = null;
let isInCall    = false;
let isVerified  = false;    // true after verify_caller succeeds

// Call data for logging
let callerName  = "Unknown";
let callerPhone = "";
let callActions = [];
let transcript  = [];       // [{role, text, ts}]

// ═══════════════════════════════════════════════════════════════
//  DOM refs
// ═══════════════════════════════════════════════════════════════

const $ = id => document.getElementById(id);

const callBtn      = $("callBtn");
const muteBtn      = $("muteBtn");
const statusBadge  = $("statusBadge");
const callTimer    = $("callTimer");
const callerInfo   = $("callerInfo");
const transcriptEl = $("transcriptArea");
const actionFeed   = $("actionFeed");
const volumeBar    = $("volumeBar");
const callsPanel   = $("recentCallsPanel");

// ── Transfer alert banner (injected at runtime) ───────────────
let _transferBanner = null;

function _showTransferBanner(data) {
  if (_transferBanner) _transferBanner.remove();

  _transferBanner = document.createElement("div");
  _transferBanner.style.cssText = [
    "position:fixed", "top:16px", "left:50%", "transform:translateX(-50%)",
    "background:#ef4444", "color:#fff", "padding:14px 22px", "border-radius:10px",
    "font-size:15px", "font-weight:600", "z-index:9999",
    "box-shadow:0 4px 16px rgba(0,0,0,0.25)", "display:flex",
    "align-items:center", "gap:12px", "max-width:90vw"
  ].join(";");

  const name   = data?.caller_name  || callerName  || "Unknown";
  const phone  = data?.caller_phone || callerPhone || "";
  const reason = data?.reason || "Transfer requested";

  _transferBanner.innerHTML =
    `<span style="font-size:20px">🔁</span>` +
    `<span>Transferring <strong>${_esc(name)}</strong>` +
    (phone ? ` (${_esc(phone)})` : "") +
    ` → ${_esc(reason)}</span>` +
    `<button onclick="this.parentElement.remove()" style="` +
      `background:transparent;border:none;color:#fff;font-size:18px;` +
      `cursor:pointer;padding:0 0 0 8px;line-height:1">✕</button>`;

  document.body.appendChild(_transferBanner);

  // Auto-dismiss after 30s
  setTimeout(() => { _transferBanner?.remove(); _transferBanner = null; }, 30_000);
}

// ─ Verified badge on caller info area ────────────────────────
function _setVerifiedBadge(verified) {
  let badge = callerInfo.querySelector(".verified-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "verified-badge";
    badge.style.cssText =
      "margin-left:8px;font-size:12px;padding:2px 8px;border-radius:99px;" +
      "font-weight:700;letter-spacing:0.03em;vertical-align:middle";
    callerInfo.querySelector(".caller-name")?.after(badge);
  }
  if (verified) {
    badge.textContent = "✓ VERIFIED";
    badge.style.background = "#d1fae5";
    badge.style.color = "#065f46";
  } else {
    badge.textContent = "UNVERIFIED";
    badge.style.background = "#fee2e2";
    badge.style.color = "#991b1b";
  }
}

// ═══════════════════════════════════════════════════════════════
//  START CALL
// ═══════════════════════════════════════════════════════════════

async function startCall() {
  setStatus("connecting", "Connecting…");
  callBtn.disabled = true;

  try {
    gemini  = new GeminiLiveClient();
    capture = new AudioCapture(
      (b64)   => gemini.sendAudio(b64),
      (level) => updateVolume(level)
    );
    player  = new AudioPlayer();

    // Reset call state
    callId      = crypto.randomUUID();
    callStart   = new Date();
    callerName  = "Unknown";
    callerPhone = "";
    isVerified  = false;
    callActions = [];
    transcript  = [];

    clearTranscript();
    clearActions();
    updateCallerInfo("Incoming Call", "");

    // ── Wire up Gemini events ──────────────────────────────────
    gemini.addEventListener("audio",           e  => {
      player.play(e.detail);
      setStatus("speaking", "Agent Speaking");
    });
    gemini.addEventListener("turnComplete",    ()  => {
      player.reset();
      setStatus("active", "Listening");
    });
    gemini.addEventListener("interrupted",     ()  => {
      player.reset();
      setStatus("active", "Listening");
    });
    gemini.addEventListener("inputTranscript", e  => addTranscriptLine("user",  e.detail));
    gemini.addEventListener("outputTranscript",e  => addTranscriptLine("agent", e.detail));
    gemini.addEventListener("toolCall",        e  => processToolCalls(e.detail));
    gemini.addEventListener("disconnected",    ()  => handleDisconnect());
    gemini.addEventListener("error",           e  => {
      addSystemMsg("⚠️ " + e.detail);
      setStatus("error", "Error");
    });

    // ── Connect to Gemini ──────────────────────────────────────
    // Inject live shop name from server config if available
    let prompt = SYSTEM_PROMPT;
    try {
      const cfg = await fetch("/api/config").then(r => r.ok ? r.json() : null);
      if (cfg?.shop_name) {
        prompt = prompt.replaceAll("{{SHOP_NAME}}", cfg.shop_name);
      } else {
        prompt = prompt.replaceAll("{{SHOP_NAME}}", "the shop");
      }
    } catch (_) {
      prompt = prompt.replaceAll("{{SHOP_NAME}}", "the shop");
    }

    await gemini.connect({
      systemPrompt: prompt,
      tools:        TOOL_DEFINITIONS,
      voice:        "Puck"
    });

    // ── Start microphone ───────────────────────────────────────
    await capture.start();
    capture.setActive(true);

    // ── UI: call active ────────────────────────────────────────
    isInCall = true;
    callBtn.textContent = "⏹  End Call";
    callBtn.className   = "call-btn end";
    callBtn.disabled    = false;
    callBtn.onclick     = endCall;
    muteBtn.disabled    = false;

    setStatus("active", "In Call");
    startTimer();
    addSystemMsg("✅ Call started — Alex is ready");

  } catch (err) {
    console.error("Call start failed:", err);
    addSystemMsg("❌ " + err.message);
    setStatus("error", err.message.includes("Token") ? "Config error" : "Connection failed");
    cleanup();
  }
}

// ═══════════════════════════════════════════════════════════════
//  END CALL
// ═══════════════════════════════════════════════════════════════

async function endCall(triggerData = null) {
  if (!isInCall) return;
  isInCall = false;
  stopTimer();

  // Update caller info if tool provided it
  if (triggerData) {
    if (triggerData.caller_name && triggerData.caller_name !== "Unknown") {
      callerName  = triggerData.caller_name;
    }
    if (triggerData.caller_phone) callerPhone = triggerData.caller_phone;
    if (triggerData.summary)      callActions.push("Summary: " + triggerData.summary);
  }

  const durationSec = Math.round((new Date() - callStart) / 1000);
  const transcriptText = transcript
    .map(t => `${t.role === "user" ? "Customer" : "Agent"}: ${t.text}`)
    .join("\n");

  gemini?.disconnect();
  capture?.stop();

  // ── Post-call analysis (Gemini-powered) ──────────────────────
  setStatus("idle", "Analyzing…");
  addSystemMsg("🔍 Running post-call analysis…");
  let analysis = {};
  try {
    const res = await fetch("/api/analyze", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript:   transcriptText,
        actions:      callActions,
        duration_sec: durationSec
      })
    });
    if (res.ok) {
      analysis = await res.json();
      if (analysis.summary) {
        addSystemMsg(`📋 ${analysis.summary}`);
      }
      if (analysis.unresolved?.length) {
        addSystemMsg(`⚠️ Unresolved: ${analysis.unresolved.join(" · ")}`);
      }
      if (analysis.action_items?.length) {
        addSystemMsg(`📌 Follow-up: ${analysis.action_items.join(" · ")}`);
      }
    }
  } catch (e) {
    console.warn("Post-call analysis failed:", e);
  }

  // ── Log enriched call to backend ─────────────────────────────
  try {
    await fetch("/api/calls", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id:               callId,
        start_time:       callStart.toISOString(),
        end_time:         new Date().toISOString(),
        duration_sec:     durationSec,
        caller_name:      callerName,
        caller_phone:     callerPhone,
        actions:          callActions,
        transcript:       transcriptText,
        sentiment:        analysis.sentiment         ?? _inferSentiment(transcriptText),
        sentiment_reason: analysis.sentiment_reason  ?? "",
        summary:          analysis.summary           ?? triggerData?.summary ?? "",
        resolved:         analysis.resolved          ?? [],
        unresolved:       analysis.unresolved         ?? [],
        topics:           analysis.topics             ?? [],
        action_items:     analysis.action_items       ?? [],
        satisfaction:     analysis.satisfaction       ?? 0,
        status:           isVerified ? "completed" : "completed_unverified"
      })
    });
  } catch (e) {
    console.warn("Call log failed:", e);
  }

  cleanup();
  setStatus("idle", "Ready");
  addSystemMsg(`✅ Call complete · ${_fmtDur(durationSec)}`);
  refreshRecentCalls();
}

function handleDisconnect() {
  if (isInCall) endCall();
}

// ═══════════════════════════════════════════════════════════════
//  TOOL CALLS
// ═══════════════════════════════════════════════════════════════

async function processToolCalls(calls) {
  const responses = [];
  setStatus("active", "Looking up…");

  for (const call of calls) {
    // Nice label for action feed
    const toolLabels = {
      verify_caller:           "🔐 Verifying caller",
      lookup_customer:         "🔍 Looking up customer",
      get_vehicle_status:      "🚗 Checking vehicle status",
      get_available_slots:     "📅 Checking availability",
      book_appointment:        "📝 Booking appointment",
      confirm_details:         "✅ Confirming details",
      send_confirmation_sms:   "📱 Sending confirmation SMS",
      reschedule_appointment:  "🔄 Rescheduling appointment",
      cancel_appointment:      "❌ Cancelling appointment",
      update_customer:         "✏️ Updating customer record",
      get_service_estimates:   "💰 Getting service estimates",
      transfer_to_human:       "🔁 Transferring to staff",
      end_call:                "📞 Ending call"
    };

    const label = toolLabels[call.name] ?? `🔧 ${call.name}`;
    logAction(label, JSON.stringify(call.args).slice(0, 80));

    const result = await handleToolCall(call.name, call.args);

    // ── Capture state from tool results ────────────────────────

    // 1. Caller verification
    if (call.name === "verify_caller") {
      isVerified = result.verified === true;
      if (isVerified && result.caller_name) {
        callerName  = result.caller_name;
        callerPhone = call.args.phone_number || callerPhone;
        updateCallerInfo(callerName, callerPhone);
      }
      _setVerifiedBadge(isVerified);
      callActions.push(
        isVerified
          ? `✅ Caller verified: ${callerName}`
          : `❌ Verification failed`
      );
    }

    // 2. Customer lookup — fill in name/phone
    if (call.name === "lookup_customer" && result.found) {
      callerName  = result.name  || callerName;
      callerPhone = result.phone || callerPhone;
      updateCallerInfo(callerName, callerPhone);
      callActions.push(`Identified customer: ${result.name}`);
    }

    // 3. Appointment booked
    if (call.name === "book_appointment" && result.success) {
      callActions.push(
        `Booked: ${call.args.service_description || "service"} — ` +
        `${call.args.date} ${call.args.time}`
      );
    }

    // 4. Appointment rescheduled
    if (call.name === "reschedule_appointment" && result.success) {
      callActions.push(
        `Rescheduled appt ${call.args.appointment_id} → ` +
        `${call.args.new_date} ${call.args.new_time}`
      );
    }

    // 5. Appointment cancelled
    if (call.name === "cancel_appointment" && result.success) {
      callActions.push(`Cancelled appointment ${call.args.appointment_id}`);
    }

    // 6. Vehicle status checked
    if (call.name === "get_vehicle_status" && result.found) {
      callActions.push(`Status check: ${result.status} — ${result.vehicle}`);
    }

    // 7. Customer updated
    if (call.name === "update_customer" && result.success) {
      callActions.push(`Updated customer record`);
    }

    // 8. Service estimates retrieved
    if (call.name === "get_service_estimates" && result.services) {
      callActions.push(
        `Provided estimates: ${result.services.map(s => s.name).join(", ")}`
      );
    }

    // 9. SMS sent
    if (call.name === "send_confirmation_sms" && result.sent) {
      callActions.push(`SMS confirmation sent to ${call.args.phone_number}`);
    }

    // 10. Transfer to human
    if (call.name === "transfer_to_human") {
      callActions.push(`Transferred to staff — ${call.args.reason || "requested"}`);
    }

    responses.push({ id: call.id, name: call.name, response: result });
  }

  gemini.sendToolResponse(responses);
  setStatus("active", "In Call");
}

// ═══════════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════════

const STATUS_CLASSES = {
  idle:       { cls: "idle",       label: "Ready" },
  connecting: { cls: "connecting", label: "Connecting…" },
  active:     { cls: "active",     label: "In Call" },
  speaking:   { cls: "speaking",   label: "Agent Speaking" },
  error:      { cls: "error",      label: "Error" }
};

function setStatus(key, customLabel) {
  const info  = STATUS_CLASSES[key] ?? STATUS_CLASSES.idle;
  statusBadge.className   = "status-badge " + info.cls;
  statusBadge.textContent = customLabel ?? info.label;
}

function updateCallerInfo(name, phone) {
  callerInfo.querySelector(".caller-name").textContent  = name  || "—";
  callerInfo.querySelector(".caller-phone").textContent = phone || "";
}

function addTranscriptLine(role, text) {
  if (!text?.trim()) return;
  transcript.push({ role, text, ts: new Date() });
  const div  = document.createElement("div");
  div.className = "tx-line " + role;
  div.innerHTML =
    `<span class="tx-icon">${role === "user" ? "👤" : "🤖"}</span>` +
    `<span class="tx-text">${_esc(text)}</span>`;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function addSystemMsg(text) {
  const div = document.createElement("div");
  div.className = "tx-system";
  div.textContent = text;
  transcriptEl.appendChild(div);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function clearTranscript() {
  transcriptEl.innerHTML =
    `<div class="tx-placeholder">Call transcript will appear here…</div>`;
}

function logAction(label, detail) {
  const div = document.createElement("div");
  div.className = "action-item";
  div.innerHTML =
    `<span class="action-label">${_esc(label)}</span>` +
    (detail ? `<span class="action-detail">${_esc(detail)}</span>` : "");
  actionFeed.querySelector(".action-placeholder")?.remove();
  actionFeed.appendChild(div);
  actionFeed.scrollTop = actionFeed.scrollHeight;
}

function clearActions() {
  actionFeed.innerHTML =
    `<div class="action-placeholder">Tool calls will appear here…</div>`;
}

function updateVolume(rms) {
  const level = Math.min(1, rms * 8);
  volumeBar.style.width = (level * 100) + "%";
  // Update mic rings
  const rings = document.querySelectorAll(".ring");
  rings.forEach((r, i) => {
    r.style.opacity = (isInCall && capture?.active && level > (i + 1) * 0.08)
      ? String(0.25 - i * 0.07) : "0";
  });
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() {
  timerHandle = setInterval(() => {
    const s = Math.round((new Date() - callStart) / 1000);
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    callTimer.textContent = `${m}:${(s % 60).toString().padStart(2, "0")}`;
  }, 1000);
}
function stopTimer() {
  clearInterval(timerHandle);
  callTimer.textContent = "00:00";
}

// ── Mute toggle ───────────────────────────────────────────────
let _muted = false;
function toggleMute() {
  if (!capture) return;
  _muted = !_muted;
  capture.setActive(!_muted);
  muteBtn.textContent  = _muted ? "🔇  Unmute" : "🎙  Mute";
  muteBtn.className    = "ctrl-btn" + (_muted ? " muted" : "");
  updateVolume(0);
}

// ── Cleanup ───────────────────────────────────────────────────
function cleanup() {
  gemini?.disconnect();
  capture?.stop();
  gemini = capture = player = null;
  isInCall   = false;
  isVerified = false;
  _muted     = false;

  // Remove verified badge
  callerInfo.querySelector(".verified-badge")?.remove();

  callBtn.textContent  = "📞  Start Call";
  callBtn.className    = "call-btn start";
  callBtn.disabled     = false;
  callBtn.onclick      = startCall;
  muteBtn.disabled     = true;
  muteBtn.textContent  = "🎙  Mute";
  muteBtn.className    = "ctrl-btn";
  updateVolume(0);
}

// ═══════════════════════════════════════════════════════════════
//  RECENT CALLS PANEL
// ═══════════════════════════════════════════════════════════════

async function refreshRecentCalls() {
  try {
    const calls = await fetch("/api/calls?limit=8").then(r => r.json());
    if (!calls.length) {
      callsPanel.innerHTML = `<p class="no-data">No calls yet</p>`;
      return;
    }
    callsPanel.innerHTML = calls.map(c => {
      const sentIcon = { positive: "😊", neutral: "😐", negative: "😟" }[c.sentiment] ?? "😐";
      const acts = (c.actions ?? []).slice(0, 2).map(a =>
        `<span class="act-chip">${_esc(String(a).slice(0, 40))}</span>`
      ).join("");
      return `
        <div class="rc-card">
          <div class="rc-top">
            <div class="rc-caller">
              <strong>${_esc(c.caller_name)}</strong>
              ${c.caller_phone ? `<span>${_esc(c.caller_phone)}</span>` : ""}
            </div>
            <div class="rc-meta">
              ${sentIcon} ${_fmtDur(c.duration_sec)} · ${_fmtTime(c.start_time)}
            </div>
          </div>
          ${acts ? `<div class="rc-acts">${acts}</div>` : ""}
        </div>`;
    }).join("");
  } catch (e) {
    callsPanel.innerHTML = `<p class="no-data">—</p>`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════════

function _esc(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function _fmtDur(s) {
  if (!s) return "0:00";
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function _fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function _inferSentiment(text) {
  if (!text) return "neutral";
  const t = text.toLowerCase();
  const positive = ["thank","great","perfect","appreciate","helpful","awesome","excellent","good","wonderful"]
    .some(w => t.includes(w));
  const negative = ["frustrated","angry","upset","problem","issue","never","terrible",
    "disappointed","wrong","broken","ridiculous","unacceptable","furious"]
    .some(w => t.includes(w));
  if (positive && !negative) return "positive";
  if (negative)              return "negative";
  return "neutral";
}

// ═══════════════════════════════════════════════════════════════
//  Initialization
// ═══════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  callBtn.onclick  = startCall;
  muteBtn.onclick  = toggleMute;
  muteBtn.disabled = true;

  // Tool's end_call triggers this DOM event
  document.addEventListener("sm:end_call", e => endCall(e.detail));

  // Tool's transfer_to_human triggers this DOM event → show transfer banner
  document.addEventListener("sm:transfer_initiated", e => {
    const data = e.detail || {};
    addSystemMsg(`🔁 Transfer initiated — ${data.reason || "staff requested"}`);
    _showTransferBanner(data);
    logAction("🔁 Transfer initiated", data.reason || "");
  });

  setStatus("idle", "Ready");
  refreshRecentCalls();

  // Refresh recent calls every 30s
  setInterval(refreshRecentCalls, 30_000);
});
