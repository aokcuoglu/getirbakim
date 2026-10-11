"use client";
import { Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const freshnessConfig = {
  fresh: { label: "Güncel", color: "var(--success)" },
  retry: { label: "Yeniden deneme bekliyor", color: "var(--warning)" },
  stale: { label: "Güncellik aşıldı", color: "var(--destructive)" },
} satisfies ChartConfig;

/** Donut of scheduled groups by freshness; the centre shows the group count. */
export function GroupFreshnessChart({ fresh, retry, stale }: { fresh: number; retry: number; stale: number }) {
  const total = fresh + retry + stale;
  const data = (["fresh", "retry", "stale"] as const).map(key => ({ key, value: key === "fresh" ? fresh : key === "retry" ? retry : stale, fill: `var(--color-${key})` })).filter(entry => entry.value > 0);
  return <ChartContainer config={freshnessConfig} className="mx-auto aspect-square h-48" aria-label={`${total} grup: ${fresh} güncel, ${retry} yeniden deneme bekliyor, ${stale} güncellik aşıldı`}>
    <PieChart accessibilityLayer>
      <ChartTooltip cursor={false} content={<ChartTooltipContent nameKey="key" hideLabel/>}/>
      <Pie data={data} dataKey="value" nameKey="key" innerRadius={56} outerRadius={80} strokeWidth={2}>
        <Label content={({ viewBox }) => viewBox && "cx" in viewBox && "cy" in viewBox ? <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
          <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-semibold">{total}</tspan>
          <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 22} className="fill-muted-foreground">grup</tspan>
        </text> : null}/>
      </Pie>
    </PieChart>
  </ChartContainer>;
}

const runConfig = {
  seconds: { label: "Süre (sn)", color: "var(--chart-1)" },
  succeeded: { label: "Başarılı", color: "var(--success)" },
  failed: { label: "Başarısız", color: "var(--destructive)" },
  rejected: { label: "İnceleme gerekli", color: "var(--warning)" },
  running: { label: "Çalışıyor", color: "var(--info)" },
} satisfies ChartConfig;

/** Durations of recent runs (oldest → newest), each bar coloured by its status. */
export function RunDurationChart({ runs }: { runs: { id: string; label: string; seconds: number; status: string }[] }) {
  return <ChartContainer config={runConfig} className="aspect-auto h-48 w-full">
    <BarChart data={runs} margin={{ left: -16, right: 4, top: 8 }} accessibilityLayer>
      <CartesianGrid vertical={false}/>
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={16}/>
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40}/>
      <ChartTooltip cursor={false} content={<ChartTooltipContent/>}/>
      <Bar dataKey="seconds" radius={4}>
        {runs.map(run => <Cell key={run.id} fill={`var(--color-${run.status in runConfig ? run.status : "seconds"})`}/>)}
      </Bar>
    </BarChart>
  </ChartContainer>;
}
