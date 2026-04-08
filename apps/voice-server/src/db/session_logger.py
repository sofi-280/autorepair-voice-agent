"""Helpers to log call session events to PostgreSQL."""
import json
import logging
from datetime import datetime, timezone

import httpx

from config import settings
from db.connection import get_pool

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def log_call_start(
    session_id: str,
    caller_id: str,
    channel: str,
    room_name: str,
    call_sid: str | None = None,
) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO call_sessions (id, call_sid, room_name, caller_number, channel, status, started_at)
            VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6)
            ON CONFLICT (id) DO NOTHING
            """,
            session_id,
            call_sid,
            room_name,
            caller_id,
            channel.upper(),
            _now(),
        )
    logger.info("Call started: %s (%s)", session_id, channel)


async def log_transcript_entry(session_id: str, role: str, text: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO transcript_entries (session_id, role, content, created_at)
            VALUES ($1, $2, $3, $4)
            """,
            session_id,
            role.upper(),
            text,
            _now(),
        )


async def log_tool_call(session_id: str, tool_name: str, args: dict, result: dict) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO tool_calls (session_id, tool_name, arguments, result, called_at)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
            """,
            session_id,
            tool_name,
            json.dumps(args),
            json.dumps(result),
            _now(),
        )


async def log_call_end(session_id: str, status: str = "COMPLETED") -> None:
    ended = _now()
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE call_sessions
            SET status = $2,
                ended_at = $3,
                duration_seconds = EXTRACT(EPOCH FROM ($3 - started_at))::int
            WHERE id = $1
            """,
            session_id,
            status.upper(),
            ended,
        )
    logger.info("Call ended: %s status=%s", session_id, status)

    # Notify dashboard to trigger post-call analysis
    try:
        async with httpx.AsyncClient() as hc:
            await hc.post(
                settings.dashboard_webhook_url,
                json={"event": "call_ended", "session_id": session_id},
                headers={"x-pipecat-secret": settings.pipecat_webhook_secret},
                timeout=5,
            )
    except Exception as exc:
        logger.warning("Dashboard webhook notification failed: %s", exc)
