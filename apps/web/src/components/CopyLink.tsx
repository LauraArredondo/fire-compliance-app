"use client";

import { useState } from "react";

export function CopyLink({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      {label && <span className="font-medium text-slate-600">{label}</span>}
      <code className="min-w-0 flex-1 truncate text-slate-800">{url}</code>
      <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-100" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
