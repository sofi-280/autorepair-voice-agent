import { NextRequest, NextResponse } from "next/server";
import { createBrowserCallRoom } from "@/lib/daily";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body.session_id ?? randomUUID();

    // Ask voice server to start the bot
    const voiceServerUrl = process.env.VOICE_SERVER_URL ?? "http://localhost:7860";
    const botRes = await fetch(`${voiceServerUrl}/start-browser-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    });

    if (!botRes.ok) {
      throw new Error(`Voice server error: ${botRes.status}`);
    }

    const { room_url, user_token } = await botRes.json();
    return NextResponse.json({ session_id: sessionId, room_url, user_token });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
