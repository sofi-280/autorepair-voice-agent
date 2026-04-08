"""Daily.co REST API helpers — room creation with SIP support."""
import logging
import uuid

import httpx

from config import settings

logger = logging.getLogger(__name__)

DAILY_API_BASE = "https://api.daily.co/v1"


async def create_daily_room(session_id: str, sip_enabled: bool = False) -> dict:
    """Create a Daily room and return room URL, SIP URI, and bot/user tokens."""
    room_name = f"autorepair-{session_id[:12]}"

    headers = {
        "Authorization": f"Bearer {settings.daily_api_key}",
        "Content-Type": "application/json",
    }

    room_props = {
        "enable_prejoin_ui": False,
        "enable_chat": False,
        "start_audio_off": False,
        "start_video_off": True,
        "exp": _unix_ts_minutes(60),
    }
    if sip_enabled:
        room_props["sip_mode"] = "dial-in"

    async with httpx.AsyncClient() as client:
        # Create room
        resp = await client.post(
            f"{DAILY_API_BASE}/rooms",
            json={"name": room_name, "properties": room_props},
            headers=headers,
        )
        if resp.status_code == 409:
            # Room already exists — fetch it
            resp = await client.get(f"{DAILY_API_BASE}/rooms/{room_name}", headers=headers)
        resp.raise_for_status()
        room = resp.json()

        room_url = room["url"]

        # Bot token (owner — can record/eject)
        bot_token_resp = await client.post(
            f"{DAILY_API_BASE}/meeting-tokens",
            json={
                "properties": {
                    "room_name": room_name,
                    "is_owner": True,
                    "exp": _unix_ts_minutes(60),
                    "user_name": "AutoRepairBot",
                }
            },
            headers=headers,
        )
        bot_token_resp.raise_for_status()
        bot_token = bot_token_resp.json()["token"]

        # User token (for browser calls)
        user_token_resp = await client.post(
            f"{DAILY_API_BASE}/meeting-tokens",
            json={
                "properties": {
                    "room_name": room_name,
                    "is_owner": False,
                    "exp": _unix_ts_minutes(60),
                    "user_name": "Caller",
                }
            },
            headers=headers,
        )
        user_token_resp.raise_for_status()
        user_token = user_token_resp.json()["token"]

    sip_uri = f"sip:{room_name}@sip.daily.co" if sip_enabled else None

    logger.info("Daily room created: %s (sip=%s)", room_name, sip_enabled)
    return {
        "name": room_name,
        "url": room_url,
        "bot_token": bot_token,
        "user_token": user_token,
        "sip_uri": sip_uri,
    }


def _unix_ts_minutes(minutes: int) -> int:
    import time
    return int(time.time()) + minutes * 60
