"use client";

import { useMemo } from "react";
import { useQueries } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { isAccessError } from "./errors";

/**
 * Like `useQuery`, but a backend refusal comes back as `error` instead of throwing (and crashing
 * the page). Use it for the main record on pages a restricted role might open by URL.
 *
 *   const { data: job, denied } = useSafeQuery(api.jobs.get, { jobId });
 *   if (denied) return <NotAvailable what="job" />;
 */
export function useSafeQuery<Q extends FunctionReference<"query">>(query: Q, args: FunctionArgs<Q> | "skip") {
  // `api.x.y` references are fresh objects on every render, so memoise on the function name + args
  // (otherwise useQueries re-subscribes every render and React loops).
  const key = (args === "skip" ? "skip" : JSON.stringify(args)) + "|" + getFunctionName(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const queries = useMemo(() => (args === "skip" ? {} : { q: { query, args } }), [key]);
  const r = useQueries(queries as never) as Record<string, unknown>;
  const v = r.q;
  const error = v instanceof Error ? v : undefined;
  return {
    data: (error ? undefined : v) as FunctionReturnType<Q> | undefined,
    error,
    /** The backend refused because of the user's role / assignment. */
    denied: !!error && isAccessError(error),
  };
}
