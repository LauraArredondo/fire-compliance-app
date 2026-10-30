"use client";

import { Shell, type NavItem } from "@/components/Shell";

const NAV: NavItem[] = [
  { href: "/portal", label: "Overview" },
  { href: "/portal/certificates", label: "Certificates" },
  { href: "/portal/defects", label: "Defects" },
  { href: "/portal/quotes", label: "Quotes" },
  { href: "/portal/invoices", label: "Invoices" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Shell area="portal" nav={NAV}>{children}</Shell>;
}
