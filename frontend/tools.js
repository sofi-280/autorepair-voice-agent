/**
 * tools.js — ShopMonkey Function Tools for Gemini Live
 * ──────────────────────────────────────────────────────
 * Covers all 13 agent responsibilities:
 *   #1  Answer calls naturally           → system prompt
 *   #2  Verify caller by phone           → verify_caller
 *   #3  Book appointments                → book_appointment
 *   #4  Confirm before finalizing        → system prompt + confirm flow
 *   #5  Send confirmation SMS            → send_confirmation_sms
 *   #6  Reschedule appointments          → reschedule_appointment
 *   #7  Cancel appointments              → cancel_appointment
 *   #8  Check vehicle status             → get_vehicle_status
 *   #9  Update customer records          → update_customer
 *   #10 Lookup customer info by phone    → lookup_customer
 *   #11 Provide service estimates        → get_service_estimates
 *   #12 Transfer to human agent          → transfer_to_human
 *   #13 (covered by all above)
 *   Extra: get_available_slots, end_call
 */

// ═══════════════════════════════════════════════════════════════
//  TOOL DEFINITIONS  (sent to Gemini in session setup)
// ═══════════════════════════════════════════════════════════════

const TOOL_DEFINITIONS = [

  // ── #10: Lookup customer by phone ────────────────────────────
  {
    name: "lookup_customer",
    description:
      "Look up a customer in ShopMonkey by phone number or name. " +
      "Always call this at the start of a call to identify the caller. " +
      "Returns customer ID, full name, contact info, and their vehicles.",
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Customer phone number — try this first"
        },
        name: {
          type: "string",
          description: "Customer name if phone is unknown"
        }
      }
    }
  },

  // ── #2: Verify caller identity ────────────────────────────────
  {
    name: "verify_caller",
    description:
      "SECURITY: Verify the caller's identity by confirming their phone number " +
      "matches the record before sharing any account info, order status, or making changes. " +
      "Ask the caller to confirm the phone number on file. " +
      "MUST be called before get_vehicle_status, reschedule_appointment, cancel_appointment, or update_customer.",
    parameters: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "Customer ID from lookup_customer"
        },
        phone_on_file: {
          type: "string",
          description: "Phone number from the customer record"
        },
        phone_provided_by_caller: {
          type: "string",
          description: "Phone number the caller just stated verbally"
        }
      },
      required: ["phone_on_file", "phone_provided_by_caller"]
    }
  },

  // ── #8: Vehicle / repair status ──────────────────────────────
  {
    name: "get_vehicle_status",
    description:
      "Get the current repair or service status for a customer's vehicle. " +
      "Returns order status, assigned technician, services, estimated completion, and notes. " +
      "REQUIRES verify_caller to have been called first.",
    parameters: {
      type: "object",
      properties: {
        customer_id: {
          type: "string",
          description: "ShopMonkey customer ID"
        },
        vehicle_description: {
          type: "string",
          description: "e.g. '2019 Honda Civic' to select the right order"
        }
      },
      required: ["customer_id"]
    }
  },

  // ── Appointment availability ──────────────────────────────────
  {
    name: "get_available_slots",
    description:
      "Check available appointment time slots for a given date. " +
      "ALWAYS call this before offering times — never invent time slots. " +
      "Returns open times and the formatted day of week.",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format"
        }
      },
      required: ["date"]
    }
  },

  // ── #3: Book appointment ──────────────────────────────────────
  {
    name: "book_appointment",
    description:
      "Create a new appointment in ShopMonkey AFTER the customer has confirmed all details. " +
      "Confirm script: 'I have you scheduled for [day] at [time] for [service] — is that correct?' " +
      "After booking, always call send_confirmation_sms immediately.",
    parameters: {
      type: "object",
      properties: {
        customer_id: {
          type: "string"
        },
        vehicle_id: {
          type: "string"
        },
        service_description: {
          type: "string",
          description: "What service is needed (e.g., 'Oil change and tire rotation')"
        },
        date: {
          type: "string",
          description: "YYYY-MM-DD"
        },
        time: {
          type: "string",
          description: "HH:MM in 24h format (e.g., '09:00', '14:30')"
        },
        notes: {
          type: "string",
          description: "Any notes the customer mentioned"
        },
        customer_phone: {
          type: "string",
          description: "Customer's phone number for SMS confirmation"
        }
      },
      required: ["service_description", "date", "time"]
    }
  },

  // ── #5: Send confirmation SMS ─────────────────────────────────
  {
    name: "send_confirmation_sms",
    description:
      "Send a text message confirmation to the customer after booking or rescheduling. " +
      "Always call this immediately after a successful book_appointment or reschedule_appointment.",
    parameters: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Customer's mobile phone number"
        },
        message: {
          type: "string",
          description:
            "Confirmation message. Example: 'Hi [Name]! Your appointment at [Shop] is confirmed for [Day], [Date] at [Time] for [Service]. Reply CANCEL to cancel. Questions? Call us at [phone]'"
        }
      },
      required: ["phone", "message"]
    }
  },

  // ── #6: Reschedule appointment ────────────────────────────────
  {
    name: "reschedule_appointment",
    description:
      "Reschedule an existing appointment to a new date and/or time. " +
      "First use get_available_slots to find open times, offer options, confirm with customer, " +
      "then call this. After success, call send_confirmation_sms.",
    parameters: {
      type: "object",
      properties: {
        appointment_id: {
          type: "string",
          description: "ShopMonkey appointment ID to update"
        },
        new_date: {
          type: "string",
          description: "New date YYYY-MM-DD"
        },
        new_time: {
          type: "string",
          description: "New time HH:MM"
        },
        notes: {
          type: "string",
          description: "Updated notes if any"
        },
        customer_phone: {
          type: "string",
          description: "Customer phone for SMS confirmation"
        },
        customer_name: {
          type: "string"
        },
        service_description: {
          type: "string"
        }
      },
      required: ["appointment_id", "new_date", "new_time"]
    }
  },

  // ── #7: Cancel appointment ────────────────────────────────────
  {
    name: "cancel_appointment",
    description:
      "Cancel an existing appointment. " +
      "Always confirm with the customer before cancelling: " +
      "'Just to confirm — you want to cancel your [service] appointment on [date] at [time]?' " +
      "REQUIRES verify_caller first.",
    parameters: {
      type: "object",
      properties: {
        appointment_id: {
          type: "string",
          description: "ShopMonkey appointment ID to cancel"
        },
        customer_phone: {
          type: "string",
          description: "Customer phone to send cancellation confirmation SMS"
        },
        service_description: {
          type: "string",
          description: "What was the appointment for (for confirmation message)"
        },
        date: {
          type: "string",
          description: "Original appointment date (for confirmation message)"
        }
      },
      required: ["appointment_id"]
    }
  },

  // ── #9: Update customer record ────────────────────────────────
  {
    name: "update_customer",
    description:
      "Update a customer's contact information: name, phone, email, or address. " +
      "Always confirm the new value before saving: 'I'll update your email to [email] — is that correct?' " +
      "REQUIRES verify_caller first.",
    parameters: {
      type: "object",
      properties: {
        customer_id: {
          type: "string"
        },
        field: {
          type: "string",
          enum: ["phone", "email", "firstName", "lastName", "address"],
          description: "Which field to update"
        },
        new_value: {
          type: "string",
          description: "The new value for the field"
        }
      },
      required: ["customer_id", "field", "new_value"]
    }
  },

  // ── #11: Service estimates ─────────────────────────────────────
  {
    name: "get_service_estimates",
    description:
      "Get approximate cost estimates for common services using ShopMonkey's canned services. " +
      "Use when a customer asks 'How much does an oil change cost?' or 'What's your price for brakes?'",
    parameters: {
      type: "object",
      properties: {
        service_name: {
          type: "string",
          description: "Service to look up (e.g., 'oil change', 'brake pads', 'tire rotation')"
        }
      },
      required: ["service_name"]
    }
  },

  // ── #12: Transfer to human agent ──────────────────────────────
  {
    name: "transfer_to_human",
    description:
      "Initiate a warm handoff to a human agent for complex requests: " +
      "billing disputes, legal questions, major complaints, or anything beyond your capabilities. " +
      "Say: 'I'm going to connect you with one of our team members who can better help you with this.' " +
      "This logs a dashboard alert so a staff member can call back.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Why the transfer is needed (e.g., 'Billing dispute about invoice #1234')"
        },
        caller_name: {
          type: "string"
        },
        caller_phone: {
          type: "string"
        },
        urgency: {
          type: "string",
          enum: ["normal", "urgent"],
          description: "'urgent' for angry customers or safety issues"
        }
      },
      required: ["reason"]
    }
  },

  // ── End call ──────────────────────────────────────────────────
  {
    name: "end_call",
    description:
      "End the call when everything is resolved and the customer has said goodbye. " +
      "Always ask 'Is there anything else I can help you with?' before ending. " +
      "Provide a clear summary of what was accomplished.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "resolved",
            "appointment_booked",
            "appointment_rescheduled",
            "appointment_cancelled",
            "status_given",
            "transfer_initiated",
            "customer_updated",
            "estimate_given"
          ]
        },
        caller_name:  { type: "string" },
        caller_phone: { type: "string" },
        summary:      {
          type: "string",
          description: "1-2 sentences: what was accomplished"
        }
      },
      required: ["reason", "summary"]
    }
  }

];

// ═══════════════════════════════════════════════════════════════
//  TOOL HANDLERS
// ═══════════════════════════════════════════════════════════════

/**
 * Execute a tool call and return the result for Gemini.
 * @param {string} name
 * @param {object} args
 * @returns {Promise<object>}
 */
async function handleToolCall(name, args) {
  console.log(`[Tool] ▶ ${name}`, args);
  try {
    switch (name) {

      // ── lookup_customer ───────────────────────────────────────
      case "lookup_customer": {
        const q = args.phone || args.name || "";
        if (!q) return { found: false, message: "No phone or name provided to search." };
        const r  = await _api(`/api/sm/customers/search?q=${encodeURIComponent(q)}`);
        const cs = r.data ?? [];
        if (!cs.length) return {
          found:   false,
          message: `No account found for "${q}". This may be a new customer.`,
          is_new_customer: true
        };
        const c = cs[0];
        return {
          found:       true,
          customer_id: c.id,
          name:        [c.firstName, c.lastName].filter(Boolean).join(" ") || "Unknown",
          phone:       c.phone || c.mobilePhone || "",
          email:       c.email || "",
          vehicles:    (c.vehicles ?? []).map(v => ({
            id:    v.id,
            label: `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim(),
            plate: v.licensePlate ?? ""
          }))
        };
      }

      // ── verify_caller ─────────────────────────────────────────
      case "verify_caller": {
        const onFile   = _normalizePhone(args.phone_on_file ?? "");
        const provided = _normalizePhone(args.phone_provided_by_caller ?? "");
        const verified = onFile && provided && (
          onFile === provided ||
          onFile.endsWith(provided.slice(-7)) ||
          provided.endsWith(onFile.slice(-7))
        );
        return {
          verified,
          message: verified
            ? "Caller identity confirmed."
            : "Phone number does not match the record on file. Cannot share account details.",
          customer_id: args.customer_id ?? null
        };
      }

      // ── get_vehicle_status ────────────────────────────────────
      case "get_vehicle_status": {
        const r = await _api(`/api/sm/customers/${args.customer_id}/orders`);
        const orders = r.data ?? [];
        if (!orders.length) return {
          found: false,
          message: "No active work orders found for this customer."
        };
        // Match on vehicle description if provided
        let order = orders[0];
        if (args.vehicle_description) {
          const desc = args.vehicle_description.toLowerCase();
          const match = orders.find(o => {
            const v   = o.vehicle ?? {};
            const lbl = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.toLowerCase();
            return lbl.split(" ").some(word => desc.includes(word) && word.length > 2);
          });
          if (match) order = match;
        }
        const v       = order.vehicle ?? {};
        const vehicle = `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim();
        const services = (order.services ?? [])
          .map(s => s.name || s.description || "Service").join(", ");
        const statusMessages = {
          "Estimate":           "We've received your vehicle and are preparing an estimate.",
          "Work In Progress":   "Your vehicle is being worked on right now.",
          "Waiting for Parts":  "We're waiting on parts to arrive. We'll call when they're in.",
          "Ready":              "Great news — your vehicle is ready for pickup!",
          "Completed":          "Your service has been completed.",
          "Invoiced":           "Your vehicle is ready and your invoice is prepared."
        };
        return {
          found:                true,
          order_id:             order.id,
          status:               order.workflowStatus ?? order.status ?? "In Progress",
          status_message:       statusMessages[order.workflowStatus] ?? "We're working on it.",
          vehicle:              vehicle || "vehicle on file",
          services:             services || "general service",
          technician:           order.technician?.name ?? "our technician",
          estimated_completion: order.promisedDate ?? "",
          notes:                order.notes ?? "",
          appointment_id:       order.appointmentId ?? null
        };
      }

      // ── get_available_slots ───────────────────────────────────
      case "get_available_slots": {
        const r = await _api(`/api/sm/appointments?date=${encodeURIComponent(args.date)}`);
        const booked = (r.data ?? []).map(a => a.scheduledTime ?? a.time ?? "");
        const d   = new Date(args.date + "T12:00:00");
        const dow = d.getDay(); // 0=Sun
        const isClosed = dow === 0;
        const allSlots = isClosed
          ? []
          : dow === 6
          ? ["09:00","10:00","11:00","13:00","14:00","15:00"]
          : ["08:00","09:00","10:00","11:00","13:00","14:00","15:00","16:00","17:00"];
        const available = allSlots.filter(s => !booked.includes(s));
        return {
          date:            args.date,
          day_name:        ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dow],
          is_closed:       isClosed,
          available_slots: available,
          formatted_times: available.map(_fmt24),
          next_open_slots: available.slice(0, 3).map(_fmt24)
        };
      }

      // ── book_appointment ──────────────────────────────────────
      case "book_appointment": {
        const payload = {
          serviceDescription: args.service_description,
          scheduledDate:      args.date,
          scheduledTime:      args.time,
          notes:              args.notes ?? ""
        };
        if (args.customer_id) payload.customerId = args.customer_id;
        if (args.vehicle_id)  payload.vehicleId  = args.vehicle_id;
        const r = await _api("/api/sm/appointments", "POST", payload);
        const apptId = r.id ?? r.data?.id;
        if (apptId) {
          return {
            success:        true,
            appointment_id: apptId,
            date:           args.date,
            time:           args.time,
            service:        args.service_description,
            confirmation:   `Appointment confirmed for ${_fmtDate(args.date)} at ${_fmt24(args.time)}`,
            customer_phone: args.customer_phone ?? ""
          };
        }
        return { success: false, message: r.message ?? r.error ?? "Booking failed — please try a different time" };
      }

      // ── send_confirmation_sms ─────────────────────────────────
      case "send_confirmation_sms": {
        if (!args.phone) return { sent: false, message: "No phone number provided" };
        const r = await _api("/api/sms/confirm", "POST", {
          to:      args.phone,
          message: args.message
        });
        return {
          sent:  r.sent ?? false,
          demo:  r.demo ?? false,
          phone: args.phone,
          note:  r.demo ? "SMS logged (demo mode — no Twilio configured)" : "SMS sent successfully"
        };
      }

      // ── reschedule_appointment ────────────────────────────────
      case "reschedule_appointment": {
        const payload = {
          scheduledDate: args.new_date,
          scheduledTime: args.new_time,
        };
        if (args.notes) payload.notes = args.notes;
        const r = await _api(`/api/sm/appointments/${args.appointment_id}`, "PATCH", payload);
        if (r.id || r.data?.id || r.ok !== false) {
          return {
            success:       true,
            appointment_id: args.appointment_id,
            new_date:      args.new_date,
            new_time:      args.new_time,
            confirmation:  `Rescheduled to ${_fmtDate(args.new_date)} at ${_fmt24(args.new_time)}`
          };
        }
        return { success: false, message: r.message ?? "Reschedule failed" };
      }

      // ── cancel_appointment ────────────────────────────────────
      case "cancel_appointment": {
        const r = await _api(`/api/sm/appointments/${args.appointment_id}`, "DELETE");
        return {
          cancelled:      r.cancelled ?? true,
          appointment_id: args.appointment_id,
          message:        r.cancelled !== false
            ? "Appointment has been cancelled."
            : "Could not cancel — please try again or contact us"
        };
      }

      // ── update_customer ───────────────────────────────────────
      case "update_customer": {
        const fieldMap = {
          phone:     "phone",
          email:     "email",
          firstName: "firstName",
          lastName:  "lastName",
          address:   "address"
        };
        const smField = fieldMap[args.field] ?? args.field;
        const r = await _api(`/api/sm/customers/${args.customer_id}`, "PATCH", {
          [smField]: args.new_value
        });
        return {
          updated: true,
          field:   args.field,
          value:   args.new_value,
          message: `${args.field} has been updated successfully.`
        };
      }

      // ── get_service_estimates ─────────────────────────────────
      case "get_service_estimates": {
        const r = await _api(
          `/api/sm/canned-services?search=${encodeURIComponent(args.service_name)}`
        );
        const services = r.data ?? [];
        if (!services.length) {
          return {
            found: false,
            message: `No standard pricing found for "${args.service_name}". Prices vary by vehicle — I can have someone call you with an exact estimate.`
          };
        }
        return {
          found:    true,
          services: services.slice(0, 5).map(s => ({
            name:        s.name ?? s.description ?? "Service",
            price:       s.price ? `$${(s.price / 100).toFixed(2)}` : "Price varies",
            description: s.description ?? ""
          }))
        };
      }

      // ── transfer_to_human ─────────────────────────────────────
      case "transfer_to_human": {
        // Get call ID from the global scope in script.js
        const cId = (typeof callId !== "undefined" && callId) ? callId : "unknown";
        const r = await _api("/api/transfer", "POST", {
          call_id:     cId,
          caller_name: args.caller_name  ?? callerName ?? "Unknown",
          caller_phone:args.caller_phone ?? callerPhone ?? "",
          reason:      args.reason
        });
        // Dispatch event so the UI can show a visual transfer banner
        document.dispatchEvent(new CustomEvent("sm:transfer_initiated", {
          detail: { reason: args.reason, urgency: args.urgency ?? "normal" }
        }));
        return {
          transfer_initiated: true,
          reason:             args.reason,
          urgency:            args.urgency ?? "normal",
          message:            "A team member will call you back shortly. " + (r.transfer_number !== "Not configured — set TRANSFER_NUMBER in .env" ? `Transfer number: ${r.transfer_number}` : "Dashboard alert sent.")
        };
      }

      // ── end_call ──────────────────────────────────────────────
      case "end_call": {
        document.dispatchEvent(new CustomEvent("sm:end_call", { detail: args }));
        return { acknowledged: true };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    console.error(`[Tool error] ${name}:`, err);
    return { error: err.message, tool: name };
  }
}

// ═══════════════════════════════════════════════════════════════
//  Private helpers
// ═══════════════════════════════════════════════════════════════

async function _api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  if (r.status === 503) {
    const err = await r.json().catch(() => ({}));
    console.warn("[SM] Not configured:", err.detail);
    return _mock(path, method, body);
  }
  return r.json();
}

/** Demo mock data when ShopMonkey or Twilio is not configured */
function _mock(path, method, body) {
  if (path.includes("/customers/search"))
    return { data: [{ id:"mock-c1", firstName:"Maria", lastName:"Garcia",
      phone:"(555) 867-5309", email:"maria@example.com",
      vehicles:[{id:"mock-v1", year:"2021", make:"Toyota", model:"Camry", licensePlate:"ABC-1234"}] }] };
  if (path.includes("/orders"))
    return { data: [{ id:"mock-o1", workflowStatus:"Work In Progress",
      vehicle:{year:"2021",make:"Toyota",model:"Camry"},
      services:[{name:"Brake pad replacement"}],
      technician:{name:"Carlos R."}, promisedDate: new Date(Date.now()+86400000).toISOString().slice(0,10),
      notes:"Front brakes almost done.", appointmentId:"mock-a1" }] };
  if (path.includes("/appointments") && method === "POST")
    return { id: "mock-appt-" + Date.now() };
  if (path.includes("/appointments") && method === "PATCH")
    return { id: body?.appointmentId ?? "mock-a1", ok: true };
  if (path.includes("/appointments") && method === "DELETE")
    return { cancelled: true };
  if (path.includes("/appointments"))
    return { data: [] };
  if (path.includes("/canned-services"))
    return { data: [
      { name:"Oil Change", price: 4999, description:"Includes filter" },
      { name:"Brake Pad Replacement (front)", price: 14999 },
      { name:"Tire Rotation", price: 2499 },
      { name:"AC Recharge", price: 8999 },
      { name:"Diagnostic Scan", price: 9999 }
    ]};
  if (path.includes("/customers") && method === "PATCH")
    return { updated: true };
  if (path.includes("/sms/confirm"))
    return { sent: true, demo: true };
  if (path.includes("/transfer"))
    return { transfer_initiated: true, transfer_number: "Demo — set TRANSFER_NUMBER in .env" };
  return { data: [] };
}

function _normalizePhone(p) {
  return String(p).replace(/\D/g, "");
}

function _fmt24(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,"0")} ${h >= 12 ? "PM" : "AM"}`;
}

function _fmtDate(d) {
  if (!d) return "";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-US",
      { weekday:"long", month:"long", day:"numeric" });
  } catch { return d; }
}
