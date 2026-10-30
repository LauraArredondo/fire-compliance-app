"use client";

import { Badge } from "./ui";

/** Shows a download link for a generated PDF, or its generation status. */
export function PdfButton({ pdf, label = "Download PDF", onRegenerate }: {
  pdf: { pdfStatus: string | null; pdfError?: string | null; url: string | null } | undefined;
  label?: string;
  onRegenerate?: () => void;
}) {
  if (!pdf) return <span className="text-sm text-slate-500">Checking PDF…</span>;
  if (pdf.url && pdf.pdfStatus !== "pending") {
    return <a href={pdf.url} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">⬇ {label}</a>;
  }
  if (pdf.pdfStatus === "pending") return <Badge tone="blue">Generating PDF…</Badge>;
  if (pdf.pdfStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-2">
        <Badge tone="red">PDF failed{pdf.pdfError ? `: ${pdf.pdfError}` : ""}</Badge>
        {onRegenerate && <button type="button" className="text-sm text-red-700 hover:underline" onClick={onRegenerate}>Retry</button>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Badge>No PDF yet</Badge>
      {onRegenerate && <button type="button" className="text-sm text-red-700 hover:underline" onClick={onRegenerate}>Generate</button>}
    </span>
  );
}
