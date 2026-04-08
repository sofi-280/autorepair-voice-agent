"use client";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type Entry = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
};

type ToolCall = {
  id: string;
  toolName: string;
  arguments: any;
  result: any;
  calledAt: string;
};

export function TranscriptViewer({
  entries,
  toolCalls,
}: {
  entries: Entry[];
  toolCalls: ToolCall[];
}) {
  // Merge entries and tool calls sorted by time
  const timeline: Array<{ time: string; type: "message" | "tool"; data: any }> =
    [
      ...entries.map((e) => ({ time: e.createdAt, type: "message" as const, data: e })),
      ...toolCalls.map((t) => ({ time: t.calledAt, type: "tool" as const, data: t })),
    ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  if (timeline.length === 0) {
    return <p className="text-gray-400 text-sm py-8 text-center">No transcript available.</p>;
  }

  return (
    <div className="space-y-3">
      {timeline.map((item) => {
        if (item.type === "message") {
          const e = item.data as Entry;
          const isUser = e.role === "USER";
          return (
            <div key={e.id} className={cn("flex", isUser ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
                  isUser
                    ? "bg-gray-100 text-gray-800 rounded-tl-sm"
                    : "bg-brand-600 text-white rounded-tr-sm"
                )}
              >
                <p>{e.content}</p>
                <p className={cn("text-xs mt-1", isUser ? "text-gray-400" : "text-blue-200")}>
                  {format(new Date(e.createdAt), "HH:mm:ss")}
                </p>
              </div>
            </div>
          );
        }

        const t = item.data as ToolCall;
        return (
          <details key={t.id} className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-xs">
            <summary className="cursor-pointer font-medium text-amber-800 flex items-center gap-2">
              <span>⚙️</span>
              <span>{t.toolName.replace(/_/g, " ")}</span>
              <span className="ml-auto text-amber-500">{format(new Date(t.calledAt), "HH:mm:ss")}</span>
            </summary>
            <div className="mt-2 space-y-1">
              <div>
                <span className="font-semibold text-gray-500">Args: </span>
                <code className="text-gray-700">{JSON.stringify(t.arguments, null, 2)}</code>
              </div>
              <div>
                <span className="font-semibold text-gray-500">Result: </span>
                <code className="text-gray-700">{JSON.stringify(t.result, null, 2)}</code>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}
