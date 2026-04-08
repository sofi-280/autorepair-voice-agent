import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function sentimentColor(sentiment: string) {
  return {
    POSITIVE: "text-green-600 bg-green-50",
    NEUTRAL:  "text-yellow-600 bg-yellow-50",
    NEGATIVE: "text-red-600 bg-red-50",
  }[sentiment] ?? "text-gray-600 bg-gray-50";
}

export function statusColor(status: string) {
  return {
    ACTIVE:      "text-blue-700 bg-blue-100",
    COMPLETED:   "text-green-700 bg-green-100",
    FAILED:      "text-red-700 bg-red-100",
    TRANSFERRED: "text-orange-700 bg-orange-100",
  }[status] ?? "text-gray-700 bg-gray-100";
}
