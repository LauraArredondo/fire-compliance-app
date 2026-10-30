/** Money is stored in minor units (pence). */
export function money(minor: number | null | undefined, currency = "GBP"): string {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}
export function toMinor(major: string | number): number {
  const n = typeof major === "number" ? major : parseFloat(major.replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export function date(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" });
}
export function dateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}
/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromDateInput(s: string): number | undefined {
  if (!s) return undefined;
  const t = new Date(s + "T09:00:00").getTime();
  return Number.isFinite(t) ? t : undefined;
}
/** yyyy-mm-ddThh:mm for <input type="datetime-local"> */
export function toDateTimeInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromDateTimeInput(s: string): number | undefined {
  if (!s) return undefined;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : undefined;
}
export function address(a: { line1?: string; line2?: string; city?: string; postcode?: string } | null | undefined): string {
  if (!a) return "";
  return [a.line1, a.line2, a.city, a.postcode].filter(Boolean).join(", ");
}
/** Blank string -> undefined (Convex optional args). */
export function opt(s: string | undefined | null): string | undefined {
  const t = (s ?? "").trim();
  return t ? t : undefined;
}
