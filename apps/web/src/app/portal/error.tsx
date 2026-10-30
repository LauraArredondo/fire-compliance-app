"use client";

import { errorMessage } from "@/lib/errors";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-fg">Something went wrong</h1>
      <p className="mt-2 text-sm text-fg-2">{errorMessage(error)}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm" onClick={() => reset()}>Try again</button>
        <a className="rounded-md bg-brand px-3 py-2 text-sm text-on-brand" href="/">Home</a>
      </div>
    </div>
  );
}
