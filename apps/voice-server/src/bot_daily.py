"""Pipecat pipeline for browser-based calls (Daily WebRTC → Gemini Live)."""
import argparse
import asyncio
import logging

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.google.live import GoogleLLMService
from pipecat.transports.services.daily import DailyParams, DailyTransport

from config import settings
from db.session_logger import log_call_end, log_transcript_entry
from prompt import SYSTEM_PROMPT
from shopmonkey.tools import TOOL_DECLARATIONS, ToolHandlers

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def run_bot(room_url: str, room_token: str, session_id: str) -> None:
    transport = DailyTransport(
        room_url,
        room_token,
        "Smart Choice Bot",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    handlers = ToolHandlers(session_id=session_id, call_sid=None, channel="browser")

    llm = GoogleLLMService(
        api_key=settings.google_api_key,
        model="gemini-3.1-flash-live-preview",
        voice_id="Aoede",
        system_instruction=SYSTEM_PROMPT,
        tools=[{"function_declarations": TOOL_DECLARATIONS}],
        transcribe_user_audio=True,
        transcribe_model_audio=True,
    )

    llm.register_function("book_appointment",      handlers.book_appointment)
    llm.register_function("cancel_appointment",    handlers.cancel_appointment)
    llm.register_function("reschedule_appointment", handlers.reschedule_appointment)
    llm.register_function("check_vehicle_status",  handlers.check_vehicle_status)
    llm.register_function("get_customer_info",     handlers.get_customer_info)
    llm.register_function("update_customer_info",  handlers.update_customer_info)
    llm.register_function("get_service_estimate",  handlers.get_service_estimate)
    llm.register_function("transfer_to_human",     handlers.transfer_to_human)

    context = OpenAILLMContext()
    context_aggregator = llm.create_context_aggregator(context)

    pipeline = Pipeline([
        transport.input(),
        context_aggregator.user(),
        llm,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            audio_in_sample_rate=16000,
            audio_out_sample_rate=24000,
            allow_interruptions=True,
        ),
    )

    @transport.event_handler("on_participant_left")
    async def on_participant_left(transport, participant, reason):
        await task.cancel()

    @transport.event_handler("on_call_state_updated")
    async def on_call_state_updated(transport, state):
        if state == "left":
            status = "TRANSFERRED" if handlers.transfer_requested else "COMPLETED"
            await log_call_end(session_id, status=status)
            await handlers.close()

    @llm.event_handler("on_transcription_message")
    async def on_transcription(llm, message):
        role = message.get("role", "assistant")
        text = message.get("text", "")
        if text:
            await log_transcript_entry(session_id, role, text)

    runner = PipelineRunner()
    await runner.run(task)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--room-url",   required=True)
    parser.add_argument("--room-token", required=True)
    parser.add_argument("--session-id", required=True)
    args = parser.parse_args()

    asyncio.run(run_bot(args.room_url, args.room_token, args.session_id))
