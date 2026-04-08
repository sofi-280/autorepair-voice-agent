import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        if (!closed) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        }
      };

      // Initial state
      const active = await getActiveCalls();
      send({ type: "active_calls", calls: active });

      const interval = setInterval(async () => {
        try {
          const calls = await getActiveCalls();
          send({ type: "active_calls", calls });
        } catch {
          // db hiccup — skip
        }
      }, 2000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection:      "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function getActiveCalls() {
  return prisma.callSession.findMany({
    where: { status: "ACTIVE" },
    orderBy: { startedAt: "desc" },
    include: {
      transcriptEntries: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      _count: { select: { toolCalls: true } },
    },
  });
}
