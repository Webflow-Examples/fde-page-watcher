"use client";

import { SettingsPageContent } from "../watchlist/page";
import { ProjectMembers } from "@/components/ProjectMembers";
import { useStore } from "@/components/store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SettingsPage() {
  const { canManageProject, pathFor } = useStore();
  const router = useRouter();
  useEffect(() => {
    if (!canManageProject) router.replace(pathFor("/dashboard"));
  }, [canManageProject, pathFor, router]);
  if (!canManageProject) return null;
  return <><SettingsPageContent /><div style={{ padding: "0 40px 48px", marginTop: -32 }}><ProjectMembers /></div></>;
}
