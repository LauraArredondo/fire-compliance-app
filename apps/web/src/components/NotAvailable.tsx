import Link from "next/link";
import { Card } from "./ui";

/** Shown when a role opens something outside what it can see (e.g. an engineer and another engineer's job). */
export function NotAvailable({ what = "page", home = "/app" }: { what?: string; home?: string }) {
  return (
    <Card>
      <div className="py-6 text-center">
        <div className="text-lg font-semibold text-slate-900">This {what} isn&apos;t available for your role</div>
        <p className="mt-2 text-sm text-slate-600">If you think you need access, ask an admin in your company.</p>
        <Link href={home} className="mt-4 inline-block text-sm font-medium text-red-700 hover:underline">Back to dashboard</Link>
      </div>
    </Card>
  );
}
