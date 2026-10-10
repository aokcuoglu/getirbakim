"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = { orders: { label: "Sipariş", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Orders per day (Istanbul time) for the dashboard; `day` is YYYY-MM-DD. */
export function OrdersChart({ days }: { days: { day: string; orders: number }[] }) {
  const data = days.map(day => ({ ...day, label: new Date(`${day.day}T12:00:00`).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) }));
  return <ChartContainer config={config} className="aspect-auto h-52 w-full">
    <BarChart data={data} margin={{ left: -20, right: 4, top: 8 }} accessibilityLayer>
      <CartesianGrid vertical={false}/>
      <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" minTickGap={12}/>
      <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40}/>
      <ChartTooltip cursor={false} content={<ChartTooltipContent/>}/>
      <Bar dataKey="orders" fill="var(--color-orders)" radius={4}/>
    </BarChart>
  </ChartContainer>;
}
