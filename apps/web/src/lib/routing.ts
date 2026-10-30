import type { Membership } from "./session";

/** Where a signed-in user should land. */
export function homeFor(current: Membership | null): string {
  if (!current) return "/onboarding";
  return current.role === "client_user" ? "/portal" : "/app";
}
