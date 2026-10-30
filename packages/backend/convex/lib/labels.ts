/** Shared display labels (UK terminology). */
export const DISCIPLINE_LABELS: Record<string, string> = {
  fire_alarm: "Fire Detection & Alarm",
  emergency_lighting: "Emergency Lighting",
  fire_extinguishers: "Portable Fire Extinguishers",
  sprinklers: "Sprinkler Systems",
  fire_doors: "Fire Doors",
  dry_wet_risers: "Dry / Wet Risers",
  smoke_ventilation: "Smoke Ventilation (AOV)",
  gas_suppression: "Gas Suppression",
  fire_risk_assessment: "Fire Risk Assessment",
  intruder_alarm: "Intruder & Hold-up Alarm",
  cctv: "CCTV",
  access_control: "Access Control",
  nurse_call: "Nurse Call",
  other: "Other",
};
export const disciplineLabel = (d: string) => DISCIPLINE_LABELS[d] ?? d;

export const RESULT_LABELS: Record<string, string> = {
  satisfactory: "Satisfactory",
  unsatisfactory: "Unsatisfactory",
  satisfactory_with_observations: "Satisfactory with observations",
};

export function formatDate(ms: number | null | undefined, timeZone = "Europe/London"): string {
  if (ms === null || ms === undefined) return "-";
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
