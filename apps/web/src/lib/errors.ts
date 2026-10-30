import { ConvexError } from "convex/values";

/** Turn a Convex error into a short, user-facing message. */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const d = e.data as unknown;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
    return JSON.stringify(d);
  }
  const msg = e instanceof Error ? e.message : String(e);
  // Strip Convex's "[CONVEX M(x:y)] [Request ID: ...] Server Error\nUncaught Error: ..." wrapping.
  const m = msg.match(/Uncaught (?:Convex)?Error:\s*([^\n]+)/);
  if (m) return m[1].replace(/\s+at .*$/, "").trim();
  if (/InvalidSecret|InvalidAccountId/.test(msg)) return "Incorrect email or password.";
  if (/TooManyFailedAttempts/.test(msg)) return "Too many attempts. Please wait a few minutes and try again.";
  return msg.replace(/^\[CONVEX [^\]]+\]\s*(\[Request ID: [^\]]+\]\s*)?/, "").split("\n")[0] || "Something went wrong";
}
