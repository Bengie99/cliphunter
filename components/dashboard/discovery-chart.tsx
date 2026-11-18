"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Clips discovered per day — single series, so no legend; the card title names it. */
export function DiscoveryChart({ data }: { data: { day: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <div className="h-56 w-full" role="img" aria-label={`Clips discovered per day, last ${data.length} days, ${total} in total`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke="hsl(240 4% 16%)" strokeDasharray="0" />
          <XAxis
            dataKey="day"
            tickFormatter={fmtDay}
            tick={{ fill: "#71717A", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis allowDecimals={false} tick={{ fill: "#71717A", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { day: string; count: number };
              return (
                <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg">
                  <div className="text-muted-foreground">{fmtDay(p.day)}</div>
                  <div className="font-semibold tabular-nums text-foreground">
                    {p.count} clip{p.count === 1 ? "" : "s"} discovered
                  </div>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
