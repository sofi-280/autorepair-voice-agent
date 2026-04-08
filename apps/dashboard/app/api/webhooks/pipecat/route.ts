import { NextRequest, NextResponse } from "next/server";
import { generatePostCallAnalysis } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  // Verify shared secret
  const secret = req.headers.get("x-pipecat-secret");
  if (secret !== process.env.PIPECAT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { event, session_id } = body;

  if (event === "call_ended") {
    // Run analysis in background — don't await so webhook returns fast
    generatePostCallAnalysis(session_id).catch((err) => {
      console.error("Post-call analysis failed for", session_id, err);
    });
    return NextResponse.json({ ok: true });
  }

  if (event === "transfer_requested") {
    // Could emit a push notification or update a Redis pub/sub here
    console.log("Transfer requested for session", session_id, "reason:", body.reason);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}
