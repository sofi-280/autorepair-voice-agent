import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generatePostCallAnalysis } from "@/lib/analysis";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const analysis = await prisma.postCallAnalysis.findUnique({
    where: { sessionId: params.id },
  });

  if (!analysis) {
    return NextResponse.json({ error: "No analysis yet" }, { status: 404 });
  }

  return NextResponse.json(analysis);
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const analysis = await generatePostCallAnalysis(params.id);
    return NextResponse.json(analysis);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
