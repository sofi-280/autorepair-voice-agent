"use client";
import { useState } from "react";
import { cn, sentimentColor } from "@/lib/utils";

type Analysis = {
  summary: string;
  sentiment: string;
  outcome: string;
  topics: string[];
  actionItems: string[];
  generatedAt: string;
} | null;

export function AnalysisCard({
  analysis,
  sessionId,
}: {
  analysis: Analysis;
  sessionId: string;
}) {
  const [data, setData] = useState<Analysis>(analysis);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/calls/${sessionId}/analysis`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="border border-dashed border-gray-300 rounded-xl p-6 text-center">
        <p className="text-gray-400 text-sm mb-3">No analysis yet for this call.</p>
        <button
          onClick={regenerate}
          disabled={loading}
          className="px-4 py-2 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate Analysis"}
        </button>
        {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800">Post-Call Analysis</h3>
        <button
          onClick={regenerate}
          disabled={loading}
          className="text-xs text-brand-600 hover:underline disabled:opacity-50"
        >
          {loading ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      {error && <p className="text-red-500 text-xs">{error}</p>}

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        <span className={cn("px-2 py-1 rounded-full text-xs font-medium", sentimentColor(data.sentiment))}>
          {data.sentiment}
        </span>
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
          {data.outcome.replace(/_/g, " ")}
        </span>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-700 leading-relaxed">{data.summary}</p>

      {/* Topics */}
      {data.topics.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">Topics</p>
          <div className="flex flex-wrap gap-1">
            {data.topics.map((t) => (
              <span key={t} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action items */}
      {data.actionItems.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1">Action Items</p>
          <ul className="space-y-1">
            {data.actionItems.map((item, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-600">
                <span className="text-orange-400 mt-0.5">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
