"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { fmtSolesCompact } from "@/lib/format";

interface Point {
  mes: number;
  label: string;
  devengado: number;
  meta: number;
  tieneData: boolean;
}

export function ExecutionChart({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="devGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#1F1F1F" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#A1A1AA", fontSize: 11, fontFamily: "var(--font-mono)" }}
          axisLine={{ stroke: "#1F1F1F" }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => fmtSolesCompact(v as number)}
          tick={{ fill: "#A1A1AA", fontSize: 11, fontFamily: "var(--font-mono)" }}
          axisLine={false}
          tickLine={false}
          width={70}
        />
        <Tooltip
          cursor={{ stroke: "#2A2A2A" }}
          contentStyle={{
            background: "#111",
            border: "1px solid #1F1F1F",
            borderRadius: 4,
            fontSize: 12,
            color: "#F5F5F5"
          }}
          labelStyle={{ color: "#A1A1AA" }}
          formatter={(value, name) => [
            fmtSolesCompact(Number(value)),
            name === "devengado" ? "Devengado" : "Meta"
          ]}
        />
        <Area type="monotone" dataKey="devengado" stroke="#F59E0B" strokeWidth={2} fill="url(#devGrad)" />
        <Line
          type="monotone"
          dataKey="meta"
          stroke="#A1A1AA"
          strokeDasharray="4 4"
          strokeWidth={1.5}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
