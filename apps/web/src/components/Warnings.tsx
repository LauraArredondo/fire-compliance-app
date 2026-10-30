"use client";

import { disciplineLabel } from "@/lib/labels";

export type AssignmentWarning = { engineerId: string; engineerName: string; discipline: string; message: string };

export function QualificationWarnings({ warnings, title = "Qualification warnings" }: { warnings: AssignmentWarning[] | undefined; title?: string }) {
  if (!warnings?.length) return null;
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <div className="mb-1 font-medium">⚠ {title}</div>
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((w, i) => <li key={i}><strong>{w.engineerName}</strong> · {disciplineLabel(w.discipline)}: {w.message}</li>)}
      </ul>
    </div>
  );
}
