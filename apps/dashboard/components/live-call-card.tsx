"use client";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

type LiveCall = {
  id: string;
  callerNumber: string | null;
  channel: string;
  startedAt: string;
  transcriptEntries: Array<{ role: string; content: string }>;
  _count: { toolCalls: number };
};

export function LiveCallCard({ call }: { call: LiveCall }) {
  const lastEntry = call.transcriptEntries[0];
  const isTransfer = lastEntry?.content?.toLowerCase().includes("transfer");

  return (
    <div className={cn(
      "border rounded-xl p-4 space-y-3 bg-white transition-all",
      isTransfer ? "border-orange-400 shadow-orange-100 shadow-md" : "border-blue-300 shadow-blue-50 shadow-sm"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <span className="font-medium text-sm text-gray-800">
            {call.callerNumber ?? "Browser call"}
          </span>
          {isTransfer && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
              Transfer Requested
            </span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          {formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
        </span>
      </div>

      <div className="flex gap-3 text-xs text-gray-500">
        <span className={cn(
          "px-2 py-0.5 rounded font-medium",
          call.channel === "PHONE" ? "bg-purple-50 text-purple-600" : "bg-indigo-50 text-indigo-600"
        )}>
          {call.channel === "PHONE" ? "📞 Phone" : "🌐 Browser"}
        </span>
        <span>{call._count.toolCalls} tool call{call._count.toolCalls !== 1 ? "s" : ""}</span>
      </div>

      {lastEntry && (
        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 italic truncate">
          {lastEntry.role === "USER" ? "👤" : "🤖"} "{lastEntry.content}"
        </div>
      )}
    </div>
  );
}
