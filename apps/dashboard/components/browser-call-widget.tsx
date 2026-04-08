"use client";
import { useState, useEffect, useRef } from "react";

type Phase = "idle" | "connecting" | "active" | "ended" | "error";

export function BrowserCallWidget() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const callFrameRef = useRef<any>(null);

  async function startCall() {
    setPhase("connecting");
    setError(null);
    try {
      const res = await fetch("/api/daily-token", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const { room_url, user_token } = await res.json();

      // Dynamically load @daily-co/daily-js
      const DailyIframe = (await import("@daily-co/daily-js")).default;
      const frame = DailyIframe.createFrame(iframeRef.current!, {
        showLeaveButton: true,
        showFullscreenButton: false,
        iframeStyle: { width: "100%", height: "100%", border: "none", borderRadius: "0.75rem" },
      });
      callFrameRef.current = frame;

      frame.on("left-meeting", () => { setPhase("ended"); frame.destroy(); });
      frame.on("error", (e: any) => { setError(e.errorMsg); setPhase("error"); });

      await frame.join({ url: room_url, token: user_token });
      setPhase("active");
    } catch (e: any) {
      setError(e.message);
      setPhase("error");
    }
  }

  function endCall() {
    callFrameRef.current?.leave();
    setPhase("idle");
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-gray-700">Browser Call</h3>
        {phase === "active" && (
          <span className="flex items-center gap-1.5 text-xs text-green-600">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Live
          </span>
        )}
      </div>

      <div className="p-4">
        {phase === "idle" && (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500 mb-4">
              Start a live browser call with the Smart Choice Auto Shop voice agent.
            </p>
            <button
              onClick={startCall}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              📞 Start Call
            </button>
          </div>
        )}

        {phase === "connecting" && (
          <div className="text-center py-6 text-gray-400 text-sm animate-pulse">
            Connecting…
          </div>
        )}

        {(phase === "active") && (
          <div>
            <div ref={iframeRef as any} className="w-full h-64 rounded-xl bg-gray-900" />
            <button
              onClick={endCall}
              className="mt-3 w-full py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600"
            >
              End Call
            </button>
          </div>
        )}

        {phase === "ended" && (
          <div className="text-center py-6">
            <p className="text-sm text-gray-500 mb-3">Call ended.</p>
            <button onClick={() => setPhase("idle")} className="text-brand-600 text-sm hover:underline">
              Start a new call
            </button>
          </div>
        )}

        {phase === "error" && (
          <div className="text-center py-6">
            <p className="text-sm text-red-500 mb-2">{error}</p>
            <button onClick={() => setPhase("idle")} className="text-brand-600 text-sm hover:underline">
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
