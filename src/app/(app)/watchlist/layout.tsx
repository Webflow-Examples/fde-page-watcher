import { requireProjectAdminPage } from "@/lib/pageAuthorization";

export const dynamic = "force-dynamic";

export default async function WatchlistLayout({ children }: { children: React.ReactNode }) {
  await requireProjectAdminPage();
  return children;
}
