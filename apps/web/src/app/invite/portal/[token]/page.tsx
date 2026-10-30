"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "@/lib/api";
import { AcceptInvite } from "@/components/AcceptInvite";

export default function AcceptPortalInvite() {
  const { token } = useParams<{ token: string }>();
  const acceptInvitation = useMutation(api.portal.acceptInvitation);
  const accept = useCallback(() => acceptInvitation({ token }), [acceptInvitation, token]);
  return <AcceptInvite kind="portal" accept={accept} />;
}
