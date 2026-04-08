"""Gemini function schemas and async handlers for ShopMonkey operations."""
import asyncio
import logging
from typing import Optional

from twilio.rest import Client as TwilioClient

from config import settings
from shopmonkey.client import ShopMonkeyClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Function schemas (OpenAPI-style, passed to Gemini Live)
# ---------------------------------------------------------------------------

TOOL_DECLARATIONS = [
    {
        "name": "book_appointment",
        "description": (
            "Book a service appointment for a customer vehicle. "
            "Always confirm details with the customer before calling this."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customer_name":  {"type": "string", "description": "Full name of the customer"},
                "phone_number":   {"type": "string", "description": "Customer phone number in E.164 format"},
                "vehicle_year":   {"type": "string", "description": "Vehicle year e.g. 2019"},
                "vehicle_make":   {"type": "string", "description": "Vehicle make e.g. Toyota"},
                "vehicle_model":  {"type": "string", "description": "Vehicle model e.g. Camry"},
                "service_type":   {"type": "string", "description": "Type of service requested"},
                "preferred_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "preferred_time": {"type": "string", "description": "Preferred time e.g. 10:00 AM"},
            },
            "required": ["customer_name", "phone_number", "service_type", "preferred_date"],
        },
    },
    {
        "name": "cancel_appointment",
        "description": (
            "Cancel an existing appointment. "
            "First call get_customer_info to find the appointment ID, then confirm with customer before cancelling."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "appointment_id": {"type": "string", "description": "ShopMonkey appointment ID"},
                "phone_number":   {"type": "string", "description": "Customer phone number for confirmation"},
            },
            "required": ["appointment_id"],
        },
    },
    {
        "name": "reschedule_appointment",
        "description": (
            "Reschedule an existing appointment to a new date/time. "
            "Confirm the new date/time with the customer before calling."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "appointment_id": {"type": "string", "description": "ShopMonkey appointment ID"},
                "new_date":       {"type": "string", "description": "New ISO date YYYY-MM-DD"},
                "new_time":       {"type": "string", "description": "New time e.g. 2:00 PM"},
            },
            "required": ["appointment_id", "new_date"],
        },
    },
    {
        "name": "check_vehicle_status",
        "description": "Look up the current repair/work order status for a customer's vehicle.",
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {"type": "string", "description": "Customer phone number"},
                "last_name":    {"type": "string", "description": "Customer last name"},
            },
            "required": [],
        },
    },
    {
        "name": "get_customer_info",
        "description": "Retrieve customer profile, linked vehicles, and upcoming appointments by phone number.",
        "parameters": {
            "type": "object",
            "properties": {
                "phone_number": {"type": "string", "description": "Customer phone number"},
            },
            "required": ["phone_number"],
        },
    },
    {
        "name": "update_customer_info",
        "description": (
            "Update customer contact details (name, phone, email, address). "
            "Read back changes to the customer and get verbal confirmation before calling this."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "customer_id": {"type": "string", "description": "ShopMonkey customer ID"},
                "first_name":  {"type": "string", "description": "Updated first name"},
                "last_name":   {"type": "string", "description": "Updated last name"},
                "phone":       {"type": "string", "description": "Updated phone number"},
                "email":       {"type": "string", "description": "Updated email address"},
                "address":     {"type": "string", "description": "Updated street address"},
            },
            "required": ["customer_id"],
        },
    },
    {
        "name": "get_service_estimate",
        "description": "Get an approximate cost estimate for a service type.",
        "parameters": {
            "type": "object",
            "properties": {
                "service_type":  {"type": "string", "description": "Service name e.g. oil change"},
                "vehicle_year":  {"type": "string"},
                "vehicle_make":  {"type": "string"},
                "vehicle_model": {"type": "string"},
            },
            "required": ["service_type"],
        },
    },
    {
        "name": "transfer_to_human",
        "description": (
            "Transfer the call to a human agent when the request is complex, the customer is upset, "
            "or the customer explicitly asks to speak to a person. "
            "Tell the customer you are transferring them before calling this."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Brief reason for the transfer e.g. 'customer requested human agent'",
                },
            },
            "required": ["reason"],
        },
    },
]


# ---------------------------------------------------------------------------
# Tool handler factory
# ---------------------------------------------------------------------------

class ToolHandlers:
    """Encapsulates all tool handler coroutines bound to a call session."""

    def __init__(self, session_id: str, call_sid: Optional[str], channel: str):
        self.session_id = session_id
        self.call_sid = call_sid  # Twilio CallSid (phone only)
        self.channel = channel    # "phone" | "browser"
        self.sm = ShopMonkeyClient()
        self._transfer_requested = False

    @property
    def transfer_requested(self) -> bool:
        return self._transfer_requested

    # ── Helpers ──────────────────────────────────────────────────────────────

    async def _log_tool(self, tool_name: str, args: dict, result: dict):
        """Lazy import to avoid circular deps."""
        from db.session_logger import log_tool_call
        await log_tool_call(self.session_id, tool_name, args, result)

    def _send_sms(self, to: str, body: str):
        """Fire-and-forget SMS via Twilio Messaging API."""
        try:
            client = TwilioClient(settings.twilio_account_sid, settings.twilio_auth_token)
            client.messages.create(to=to, from_=settings.twilio_phone_number, body=body)
            logger.info("SMS sent to %s", to)
        except Exception as exc:
            logger.warning("SMS send failed: %s", exc)

    # ── book_appointment ─────────────────────────────────────────────────────

    async def book_appointment(self, args: dict) -> dict:
        customer_name = args["customer_name"]
        phone = args["phone_number"]
        service_type = args["service_type"]
        preferred_date = args["preferred_date"]
        preferred_time = args.get("preferred_time", "")

        # Find or create customer
        customers = await self.sm.list_customers(phone=phone)
        if customers:
            customer_id = customers[0]["id"]
        else:
            name_parts = customer_name.split(" ", 1)
            customer = await self.sm.create_customer({
                "firstName": name_parts[0],
                "lastName": name_parts[1] if len(name_parts) > 1 else "",
                "phone": phone,
            })
            customer_id = customer["id"]

        scheduled = preferred_date
        if preferred_time:
            scheduled = f"{preferred_date}T{preferred_time}"

        appt = await self.sm.create_appointment({
            "customerId": customer_id,
            "serviceType": service_type,
            "scheduledDate": scheduled,
            "notes": f"{args.get('vehicle_year', '')} {args.get('vehicle_make', '')} {args.get('vehicle_model', '')}".strip(),
        })

        result = {
            "success": True,
            "appointment_id": appt["id"],
            "date": appt.get("scheduledDate", preferred_date),
            "service": service_type,
            "customer_name": customer_name,
        }

        # Send confirmation SMS (fire-and-forget)
        sms_body = (
            f"Hi {customer_name.split()[0]}, your appointment at {settings.shop_name} "
            f"is confirmed for {preferred_date}"
            + (f" at {preferred_time}" if preferred_time else "")
            + f". Service: {service_type}. Reply STOP to opt out."
        )
        asyncio.get_event_loop().run_in_executor(None, self._send_sms, phone, sms_body)

        await self._log_tool("book_appointment", args, result)
        return result

    # ── cancel_appointment ───────────────────────────────────────────────────

    async def cancel_appointment(self, args: dict) -> dict:
        appointment_id = args["appointment_id"]
        await self.sm.cancel_appointment(appointment_id)
        result = {"success": True, "appointment_id": appointment_id, "status": "cancelled"}
        await self._log_tool("cancel_appointment", args, result)
        return result

    # ── reschedule_appointment ───────────────────────────────────────────────

    async def reschedule_appointment(self, args: dict) -> dict:
        appointment_id = args["appointment_id"]
        new_date = args["new_date"]
        new_time = args.get("new_time", "")
        scheduled = f"{new_date}T{new_time}" if new_time else new_date
        appt = await self.sm.update_appointment(appointment_id, {"scheduledDate": scheduled})
        result = {
            "success": True,
            "appointment_id": appointment_id,
            "new_date": new_date,
            "new_time": new_time,
            "updated_scheduled": appt.get("scheduledDate", scheduled),
        }
        await self._log_tool("reschedule_appointment", args, result)
        return result

    # ── check_vehicle_status ─────────────────────────────────────────────────

    async def check_vehicle_status(self, args: dict) -> dict:
        search = args.get("phone_number") or args.get("last_name", "")
        orders = await self.sm.list_orders(
            customer_search=search,
            status_filter=["in_progress", "waiting", "parts_ordered", "ready"],
        )
        if not orders:
            result = {"found": False, "message": "No active work orders found for that customer."}
        else:
            order = orders[0]
            result = {
                "found": True,
                "order_number": order.get("number"),
                "status": order.get("status"),
                "technician_notes": order.get("technicianNotes", ""),
                "estimated_completion": order.get("estimatedCompletionDate"),
                "vehicle": f"{order.get('vehicleYear', '')} {order.get('vehicleMake', '')} {order.get('vehicleModel', '')}".strip(),
            }
        await self._log_tool("check_vehicle_status", args, result)
        return result

    # ── get_customer_info ────────────────────────────────────────────────────

    async def get_customer_info(self, args: dict) -> dict:
        phone = args["phone_number"]
        customers = await self.sm.list_customers(phone=phone)
        if not customers:
            result = {"found": False, "message": "No customer found with that phone number."}
        else:
            c = customers[0]
            vehicles = await self.sm.list_vehicles(customer_id=c["id"])
            appointments = await self.sm.list_appointments(customer_id=c["id"])
            result = {
                "found": True,
                "customer_id": c["id"],
                "name": f"{c.get('firstName', '')} {c.get('lastName', '')}".strip(),
                "email": c.get("email", ""),
                "phone": c.get("phone", ""),
                "vehicles": [
                    {"year": v.get("year"), "make": v.get("make"), "model": v.get("model")}
                    for v in vehicles
                ],
                "upcoming_appointments": [
                    {
                        "id": a["id"],
                        "date": a.get("scheduledDate"),
                        "service": a.get("serviceType"),
                    }
                    for a in appointments[:3]
                ],
            }
        await self._log_tool("get_customer_info", args, result)
        return result

    # ── update_customer_info ─────────────────────────────────────────────────

    async def update_customer_info(self, args: dict) -> dict:
        customer_id = args["customer_id"]
        updates = {
            k: v for k, v in {
                "firstName": args.get("first_name"),
                "lastName":  args.get("last_name"),
                "phone":     args.get("phone"),
                "email":     args.get("email"),
                "address":   args.get("address"),
            }.items() if v is not None
        }
        updated = await self.sm.update_customer(customer_id, updates)
        result = {"success": True, "customer_id": customer_id, "updated_fields": list(updates.keys())}
        await self._log_tool("update_customer_info", args, result)
        return result

    # ── get_service_estimate ─────────────────────────────────────────────────

    async def get_service_estimate(self, args: dict) -> dict:
        service_type = args["service_type"]
        canned = await self.sm.list_canned_services(name=service_type)
        if canned:
            svc = canned[0]
            result = {
                "found": True,
                "service": svc.get("name", service_type),
                "estimated_price": svc.get("price"),
                "estimated_labor_hours": svc.get("laborHours"),
            }
        else:
            result = {
                "found": False,
                "service": service_type,
                "message": "Please call us for a detailed quote on that service.",
            }
        await self._log_tool("get_service_estimate", args, result)
        return result

    # ── transfer_to_human ────────────────────────────────────────────────────

    async def transfer_to_human(self, args: dict) -> dict:
        reason = args.get("reason", "customer request")
        self._transfer_requested = True

        if self.channel == "phone" and self.call_sid and settings.human_transfer_number:
            try:
                twilio_client = TwilioClient(settings.twilio_account_sid, settings.twilio_auth_token)
                twiml = (
                    f'<?xml version="1.0" encoding="UTF-8"?>'
                    f"<Response><Dial>{settings.human_transfer_number}</Dial></Response>"
                )
                twilio_client.calls(self.call_sid).update(twiml=twiml)
                logger.info("Call %s transferred to human: %s", self.call_sid, settings.human_transfer_number)
            except Exception as exc:
                logger.error("Transfer failed: %s", exc)

        # Notify dashboard via webhook
        try:
            import httpx as _httpx
            async with _httpx.AsyncClient() as hc:
                await hc.post(
                    settings.dashboard_webhook_url,
                    json={"event": "transfer_requested", "session_id": self.session_id, "reason": reason},
                    headers={"x-pipecat-secret": settings.pipecat_webhook_secret},
                    timeout=5,
                )
        except Exception as exc:
            logger.warning("Dashboard webhook failed: %s", exc)

        result = {"success": True, "reason": reason, "transferred": True}
        await self._log_tool("transfer_to_human", args, result)
        return result

    async def close(self):
        await self.sm.close()
