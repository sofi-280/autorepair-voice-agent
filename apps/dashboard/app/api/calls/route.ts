import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page    = Math.max(1, parseInt(searchParams.get("page")  ?? "1"));
  const limit   = Math.min(50, parseInt(searchParams.get("limit") ?? "20"));
  const channel = searchParams.get("channel");  // PHONE | BROWSER
  const status  = searchParams.get("status");   // ACTIVE | COMPLETED | FAILED | TRANSFERRED
  const date    = searchParams.get("date");     // YYYY-MM-DD

  const where: any = {};
  if (channel) where.channel = channel.toUpperCase();
  if (status)  where.status  = status.toUpperCase();
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
      skip:  (page - 1) * limit,
      take:  limit,
      include: {
        analysis: { select: { sentiment: true, outcome: true } },
        _count:   { select: { toolCalls: true, transcriptEntries: true } },
      },
    }),
    prisma.callSession.count({ where }),
  ]);

  return NextResponse.json({ calls, total, page, limit });
}
