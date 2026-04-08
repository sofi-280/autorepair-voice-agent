/**
 * Post-call analysis using Gemini (standard API, not Live).
 * Triggered after a call ends to generate summary, sentiment, outcome, etc.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { prisma } from "@/lib/prisma";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

export async function generatePostCallAnalysis(sessionId: string) {
  const session = await prisma.callSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      transcriptEntries: { orderBy: { createdAt: "asc" } },
      toolCalls: { orderBy: { calledAt: "asc" } },
    },
  });

  const transcript = session.transcriptEntries
    .map((e) => `${e.role === "USER" ? "Customer" : "Agent"}: ${e.content}`)
    .join("\n");

  const toolSummary =
    session.toolCalls.length > 0
      ? session.toolCalls
          .map(
            (t) =>
              `- ${t.toolName}(${JSON.stringify(t.arguments)}) → ${JSON.stringify(t.result)}`
          )
          .join("\n")
      : "None";

  const prompt = `You are analyzing a customer service call transcript for an auto repair shop called Smart Choice Auto Shop.

TRANSCRIPT:
${transcript || "(no transcript available)"}

TOOL CALLS MADE DURING THE CALL:
${toolSummary}

Respond ONLY with a valid JSON object matching this exact schema (no markdown, no extra text):
{
  "summary": "2-3 sentence summary of what happened during the call",
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE",
  "outcome": "APPOINTMENT_BOOKED" | "APPOINTMENT_CANCELLED" | "APPOINTMENT_RESCHEDULED" | "STATUS_CHECK" | "INFO_UPDATE" | "INQUIRY" | "TRANSFERRED" | "UNRESOLVED",
  "topics": ["array", "of", "main", "topics", "discussed"],
  "actionItems": ["any follow-up actions required by the shop team"]
}`;

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  let parsed: {
    summary: string;
    sentiment: string;
    outcome: string;
    topics: string[];
    actionItems: string[];
  };

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {
      summary: "Analysis could not be parsed.",
      sentiment: "NEUTRAL",
      outcome: "UNRESOLVED",
      topics: [],
      actionItems: [],
    };
  }

  return prisma.postCallAnalysis.upsert({
    where: { sessionId },
    create: {
      sessionId,
      summary:     parsed.summary,
      sentiment:   parsed.sentiment as any,
      outcome:     parsed.outcome as any,
      topics:      parsed.topics ?? [],
      actionItems: parsed.actionItems ?? [],
      rawResponse: result.response as any,
    },
    update: {
      summary:     parsed.summary,
      sentiment:   parsed.sentiment as any,
      outcome:     parsed.outcome as any,
      topics:      parsed.topics ?? [],
      actionItems: parsed.actionItems ?? [],
      rawResponse: result.response as any,
      generatedAt: new Date(),
    },
  });
}
