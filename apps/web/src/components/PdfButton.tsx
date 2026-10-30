"use client";

import { Badge, Button } from "./ui";

/** Shows a download link for a generated PDF, or its generation status. */
export function PdfButton({ pdf, label = "Download PDF", onRegenerate }: {
  pdf: { pdfStatus: string | null; pdfError?: string | null; url: string | null } | undefined;
  label?: string;
  onRegenerate?: () => void;
}) {
  if (!pdf) return <span className="text-sm text-fg-muted">Checking PDF…</span>;
  if (pdf.url && pdf.pdfStatus !== "pending") {
    return <a href={pdf.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-md bg-inverse px-4 text-sm font-medium text-fg-inverse shadow-e1 hover:opacity-90">⬇ {label}</a>;
  }
  if (pdf.pdfStatus === "pending") return <Badge tone="blue">Generating PDF…</Badge>;
  if (pdf.pdfStatus === "failed") {
    return (
      <span className="inline-flex items-center gap-2">
        <Badge tone="red">PDF failed{pdf.pdfError ? `: ${pdf.pdfError}` : ""}</Badge>
        {onRegenerate && <Button type="button" variant="ghost" className="h-auto px-2 text-link" onClick={onRegenerate}>Retry</Button>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Badge>No PDF yet</Badge>
      {onRegenerate && <Button type="button" variant="ghost" className="h-auto px-2 text-link" onClick={onRegenerate}>Generate</Button>}
    </span>
  );
}
