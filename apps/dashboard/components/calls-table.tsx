"use client";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { cn, formatDuration, sentimentColor, statusColor } from "@/lib/utils";

type Call = {
  id: string;
  callerNumber: string | null;
  channel: string;
  status: string;
  startedAt: string;
  durationSeconds: number | null;
  analysis?: { sentiment: string; outcome: string } | null;
  _count?: { toolCalls: number; transcriptEntries: number };
};

export function CallsTable({ calls }: { calls: Call[] }) {
  if (calls.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">No calls found.</div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            {["Date", "Caller", "Channel", "Duration", "Status", "Sentiment", "Outcome", ""].map(
              (h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-gray-500">
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {calls.map((call) => (
            <tr key={call.id} className="hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                {formatDistanceToNow(new Date(call.startedAt), { addSuffix: true })}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-gray-700">
                {call.callerNumber ?? "browser"}
              </td>
              <td className="px-4 py-3">
                <span className={cn(
                  "px-2 py-0.5 rounded text-xs font-medium",
                  call.channel === "PHONE"
                    ? "bg-purple-100 text-purple-700"
                    : "bg-indigo-100 text-indigo-700"
                )}>
                  {call.channel === "PHONE" ? "📞 Phone" : "🌐 Browser"}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">
                {formatDuration(call.durationSeconds)}
              </td>
              <td className="px-4 py-3">
                <span className={cn("px-2 py-0.5 rounded text-xs font-medium", statusColor(call.status))}>
                  {call.status}
                </span>
              </td>
              <td className="px-4 py-3">
                {call.analysis ? (
                  <span className={cn("px-2 py-0.5 rounded text-xs font-medium", sentimentColor(call.analysis.sentiment))}>
                    {call.analysis.sentiment}
                  </span>
                ) : (
                  <span className="text-gray-300 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {call.analysis?.outcome?.replace(/_/g, " ") ?? "—"}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/calls/${call.id}`}
                  className="text-brand-600 hover:underline text-xs font-medium"
                >
                  View →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
