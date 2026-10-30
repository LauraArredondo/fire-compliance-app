"use client";

import { Component, type ReactNode } from "react";
import { isAccessError } from "@/lib/errors";
import { NotAvailable } from "./NotAvailable";

/**
 * Safety net around every staff/portal page: if a query throws a role-scoping refusal
 * ("You're not assigned to this job", "Insufficient permissions", …) the page shows
 * "not available for your role" instead of crashing. Other errors go to the normal error page.
 * Re-keyed on navigation so it resets.
 */
export class AccessBoundary extends Component<{ children: ReactNode; home?: string }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isAccessError(error)) return <NotAvailable home={this.props.home} />;
    throw error; // not a role refusal: let the route's error page handle it
  }
}
