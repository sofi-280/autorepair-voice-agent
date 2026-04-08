import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await prisma.callSession.findUnique({
    where: { id: params.id },
    include: {
      transcriptEntries: { orderBy: { createdAt: "asc" } },
      toolCalls:         { orderBy: { calledAt: "asc" } },
      analysis:          true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(session);
}
