import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { MetricsBar } from "@/components/metrics-bar";
import { CallsTable } from "@/components/calls-table";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const recentCalls = await prisma.callSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
    include: {
      analysis: { select: { sentiment: true, outcome: true } },
      _count:   { select: { toolCalls: true, transcriptEntries: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Smart Choice Auto Shop — Voice Agent Overview</p>
      </div>

      <Suspense fallback={<div className="grid grid-cols-4 gap-4">{Array(4).fill(0).map((_,i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>}>
        <MetricsBar />
      </Suspense>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Recent Calls</h2>
          <Link href="/calls" className="text-sm text-brand-600 hover:underline">View all →</Link>
        </div>
        <CallsTable calls={recentCalls as any} />
      </div>
    </div>
  );
}
