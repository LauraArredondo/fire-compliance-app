"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { homeFor } from "@/lib/routing";
import { Loading } from "@/components/ui";

export default function Home() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (s.isLoading) return;
    router.replace(s.isAuthenticated ? homeFor(s.current) : "/signin");
  }, [s.isLoading, s.isAuthenticated, s.current, router]);
  return <Loading />;
}
