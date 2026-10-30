export const DISCIPLINES = [
  "fire_alarm", "emergency_lighting", "fire_extinguishers", "sprinklers", "fire_doors", "dry_wet_risers", "smoke_ventilation",
  "gas_suppression", "fire_risk_assessment", "intruder_alarm", "cctv", "access_control", "nurse_call", "other",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const DISCIPLINE_LABEL: Record<Discipline, string> = {
  fire_alarm: "Fire alarm (BS 5839)",
  emergency_lighting: "Emergency lighting (BS 5266)",
  fire_extinguishers: "Fire extinguishers (BS 5306)",
  sprinklers: "Sprinklers (BS EN 12845)",
  fire_doors: "Fire doors",
  dry_wet_risers: "Dry/wet risers",
  smoke_ventilation: "Smoke ventilation",
  gas_suppression: "Gas suppression",
  fire_risk_assessment: "Fire risk assessment",
  intruder_alarm: "Intruder alarm (BS EN 50131)",
  cctv: "CCTV (BS EN 62676)",
  access_control: "Access control",
  nurse_call: "Nurse call",
  other: "Other",
};
export const disciplineLabel = (d: string) => DISCIPLINE_LABEL[d as Discipline] ?? humanize(d);

export function humanize(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const CLIENT_TYPES = ["commercial", "residential", "public_sector", "managing_agent"] as const;
export const JOB_TYPES = ["routine_service", "inspection", "installation", "commissioning", "remedial", "callout", "survey"] as const;
export const JOB_STATUSES = ["draft", "scheduled", "in_progress", "on_hold", "completed", "invoiced", "cancelled"] as const;
export const PRIORITIES = ["low", "normal", "high", "emergency"] as const;
export const DEFECT_SEVERITIES = ["critical", "major", "minor", "advisory"] as const;
export const DEFECT_STATUSES = ["open", "quoted", "scheduled", "in_progress", "resolved", "verified", "closed_no_action"] as const;
export const CERT_STATUSES = ["draft", "pending_signature", "issued", "superseded", "revoked"] as const;
export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "declined", "expired", "superseded"] as const;
export const INVOICE_STATUSES = ["draft", "sent", "partially_paid", "paid", "overdue", "void"] as const;
export const OVERALL_RESULTS = ["satisfactory", "satisfactory_with_observations", "unsatisfactory"] as const;
export const LINE_KINDS = ["labour", "material", "equipment", "service", "other"] as const;
export const PAYMENT_METHODS = ["bank_transfer", "card", "cash", "cheque", "other"] as const;
export const FREQ_UNITS = ["day", "week", "month", "year"] as const;

/** Auto-created jobs use status "draft"; the UI calls that "Unscheduled". */
export function jobStatusLabel(s: string): string {
  return s === "draft" ? "Unscheduled" : humanize(s);
}

export type Tone = "gray" | "blue" | "green" | "amber" | "red" | "purple";
export function toneFor(status: string): Tone {
  switch (status) {
    case "issued": case "paid": case "accepted": case "completed": case "resolved": case "verified": case "active": case "satisfactory": case "pass": case "in_service":
      return "green";
    case "scheduled": case "sent": case "viewed": case "in_progress": case "quoted": case "pending_signature":
      return "blue";
    case "partially_paid": case "on_hold": case "satisfactory_with_observations": case "minor": case "advisory": case "draft": case "paused":
      return "amber";
    case "overdue": case "revoked": case "declined": case "critical": case "major": case "unsatisfactory": case "open": case "fail": case "defective": case "out_of_service":
      return "red";
    case "invoiced":
      return "purple";
    default:
      return "gray";
  }
}

export type Role = "owner" | "admin" | "office" | "engineer" | "client_user";
export const STAFF: Role[] = ["owner", "admin", "office", "engineer"];
export const OFFICE: Role[] = ["owner", "admin", "office"];
export const MANAGERS: Role[] = ["owner", "admin"];
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", office: "Office", engineer: "Engineer", client_user: "Client portal" };
