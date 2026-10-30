"use client";

import { useState } from "react";

export function CopyLink({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-subtle p-2 text-xs">
      {label && <span className="font-medium text-fg-2">{label}</span>}
      <code className="min-w-0 flex-1 truncate text-fg">{url}</code>
      <button type="button" className="rounded border border-line-strong bg-surface px-2 py-1 hover:bg-hover" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
