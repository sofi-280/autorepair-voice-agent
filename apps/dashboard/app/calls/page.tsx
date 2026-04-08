import { prisma } from "@/lib/prisma";
import { CallsTable } from "@/components/calls-table";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function CallsPage({
  searchParams,
}: {
  searchParams: { page?: string; channel?: string; status?: string; date?: string };
}) {
  const page    = Math.max(1, parseInt(searchParams.page ?? "1"));
  const channel = searchParams.channel?.toUpperCase();
  const status  = searchParams.status?.toUpperCase();
  const date    = searchParams.date;

  const where: any = {};
  if (channel && channel !== "ALL") where.channel = channel;
  if (status  && status  !== "ALL") where.status  = status;
  if (date) {
    const d = new Date(date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    where.startedAt = { gte: d, lt: next };
  }

  const [calls, total] = await Promise.all([
    prisma.callSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        analysis: { select: { sentiment: true, outcome: true } },
        _count:   { select: { toolCalls: true, transcriptEntries: true } },
      },
    }),
    prisma.callSession.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">All Calls</h1>
        <span className="text-sm text-gray-400">{total} total</span>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3 text-sm">
        <select name="channel" defaultValue={channel ?? "ALL"}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white">
          <option value="ALL">All channels</option>
          <option value="PHONE">Phone</option>
          <option value="BROWSER">Browser</option>
        </select>
        <select name="status" defaultValue={status ?? "ALL"}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white">
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="TRANSFERRED">Transferred</option>
          <option value="FAILED">Failed</option>
        </select>
        <input type="date" name="date" defaultValue={date ?? ""}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white" />
        <button type="submit"
          className="px-4 py-1.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
          Filter
        </button>
      </form>

      <CallsTable calls={calls as any} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center pt-2">
          {page > 1 && (
            <Link href={`?page=${page - 1}`} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
              ← Prev
            </Link>
          )}
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={`?page=${page + 1}`} className="px-3 py-1.5 border rounded-lg text-sm hover:bg-gray-50">
              Next →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
