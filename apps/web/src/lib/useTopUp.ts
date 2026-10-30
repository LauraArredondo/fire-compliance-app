"use client";

import { useEffect, useRef } from "react";

/**
 * Some backend lists are filtered after paging (e.g. `defects:list` / `certificates:list` for
 * engineers keep only their sites), so a page can come back shorter than asked — or empty — while
 * more results exist. A short page is NOT the end: only `status === "Exhausted"` (isDone) is.
 * This keeps loading until at least `target` rows are shown or the list is exhausted.
 */
export function useTopUp(
  p: { results: unknown[]; status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"; loadMore: (n: number) => void },
  target: number,
  resetKey: unknown = null,
  maxRounds = 10,
) {
  const rounds = useRef(0);
  const key = useRef(resetKey);
  if (key.current !== resetKey) { key.current = resetKey; rounds.current = 0; }
  const { results, status, loadMore } = p;
  useEffect(() => {
    if (status === "CanLoadMore" && results.length < target && rounds.current < maxRounds) {
      rounds.current++;
      loadMore(Math.max(25, target - results.length));
    }
  }, [status, results.length, target, loadMore, maxRounds]);
}
