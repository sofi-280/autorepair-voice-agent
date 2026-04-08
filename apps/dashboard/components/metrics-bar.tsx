import { prisma } from "@/lib/prisma";

export async function MetricsBar() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalToday, avgDurationResult, activeCalls, bookings] = await Promise.all([
    prisma.callSession.count({ where: { startedAt: { gte: today } } }),
    prisma.callSession.aggregate({
      where: { startedAt: { gte: today }, durationSeconds: { not: null } },
      _avg: { durationSeconds: true },
    }),
    prisma.callSession.count({ where: { status: "ACTIVE" } }),
    prisma.toolCall.count({
      where: {
        toolName: "book_appointment",
        calledAt: { gte: today },
        result: { path: ["success"], equals: true },
      },
    }),
  ]);

  const avgSecs = avgDurationResult._avg.durationSeconds ?? 0;
  const avgMin = Math.floor(avgSecs / 60);
  const avgSec = Math.round(avgSecs % 60);

  const stats = [
    { label: "Calls Today",       value: totalToday.toString(),              icon: "📞" },
    { label: "Avg Duration",      value: `${avgMin}:${avgSec.toString().padStart(2,"0")}`, icon: "⏱️" },
    { label: "Bookings Today",    value: bookings.toString(),                icon: "📅" },
    { label: "Active Right Now",  value: activeCalls.toString(),             icon: "🔴" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl mb-1">{s.icon}</div>
          <div className="text-2xl font-bold text-gray-900">{s.value}</div>
          <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  );
}
