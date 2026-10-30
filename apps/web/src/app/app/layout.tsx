"use client";

import { Shell, type NavItem } from "@/components/Shell";
import { sectionsFor } from "@fire/shared";
import { useSession } from "@/lib/session";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const { role } = useSession();
  // The menu comes from the shared permissions map (packages/shared), so web and mobile agree.
  const nav: NavItem[] = role ? sectionsFor(role).map((s) => ({ href: s.web, label: s.label })) : [];
  return <Shell area="staff" nav={nav}>{children}</Shell>;
}
