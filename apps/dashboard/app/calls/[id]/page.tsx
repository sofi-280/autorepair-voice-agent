import { notFound } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { TranscriptViewer } from "@/components/transcript-viewer";
import { AnalysisCard } from "@/components/analysis-card";
import { cn, formatDuration, statusColor } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CallDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await prisma.callSession.findUnique({
    where: { id: params.id },
    include: {
      transcriptEntries: { orderBy: { createdAt: "asc" } },
      toolCalls:         { orderBy: { calledAt: "asc" } },
      analysis:          true,
    },
  });

  if (!session) notFound();

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-400">
        <Link href="/calls" className="hover:text-gray-600">Calls</Link>
        {" / "}
        <span className="text-gray-600 font-mono">{session.id.slice(0, 8)}…</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {session.callerNumber ?? "Browser Call"}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {format(new Date(session.startedAt), "PPpp")}
            {session.durationSeconds != null && (
              <> · {formatDuration(session.durationSeconds)}</>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <span className={cn("px-3 py-1 rounded-full text-xs font-medium", statusColor(session.status))}>
            {session.status}
          </span>
          <span className={cn(
            "px-3 py-1 rounded-full text-xs font-medium",
            session.channel === "PHONE"
              ? "bg-purple-100 text-purple-700"
              : "bg-indigo-100 text-indigo-700"
          )}>
            {session.channel}
          </span>
        </div>
      </div>

      {/* 2-col layout: transcript left, analysis right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h2 className="font-semibold text-gray-700 mb-3">
            Transcript & Tool Calls
            <span className="ml-2 text-xs text-gray-400 font-normal">
              ({session.transcriptEntries.length} messages · {session.toolCalls.length} tool calls)
            </span>
          </h2>
          <div className="max-h-[32rem] overflow-y-auto pr-1">
            <TranscriptViewer
              entries={session.transcriptEntries as any}
              toolCalls={session.toolCalls as any}
            />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="font-semibold text-gray-700">Analysis</h2>
          <AnalysisCard analysis={session.analysis as any} sessionId={session.id} />
        </div>
      </div>
    </div>
  );
}
