"use client";
import { useEffect, useState } from "react";
import { LiveCallCard } from "@/components/live-call-card";
import { BrowserCallWidget } from "@/components/browser-call-widget";

export default function LivePage() {
  const [calls, setCalls] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/live/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.type === "active_calls") {
        setCalls(data.calls);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Live Calls</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time active call monitoring</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-400"}`} />
          <span className="text-gray-500">{connected ? "Connected" : "Reconnecting…"}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active calls */}
        <div className="lg:col-span-2 space-y-4">
          {calls.length === 0 ? (
            <div className="border border-dashed border-gray-200 rounded-xl py-16 text-center text-gray-400">
              <p className="text-3xl mb-2">📵</p>
              <p className="text-sm">No active calls right now</p>
            </div>
          ) : (
            calls.map((call) => <LiveCallCard key={call.id} call={call} />)
          )}
        </div>

        {/* Browser call launcher */}
        <div>
          <BrowserCallWidget />
        </div>
      </div>
    </div>
  );
}
