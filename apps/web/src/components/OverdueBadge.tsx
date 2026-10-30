"use client";

import { date } from "@/lib/format";
import { Badge } from "./ui";

export function OverdueBadge({ inv }: { inv: { status: string; dueAt?: number; overdueSince?: number } }) {
  if (inv.status !== "overdue" && inv.overdueSince === undefined) return null;
  if (inv.status === "paid" || inv.status === "void") return null;
  const since = inv.overdueSince ?? inv.dueAt;
  const days = since ? Math.max(0, Math.floor((Date.now() - since) / 864e5)) : null;
  return <Badge tone="red">Overdue{since ? ` since ${date(since)}` : ""}{days !== null ? ` (${days}d)` : ""}</Badge>;
}
