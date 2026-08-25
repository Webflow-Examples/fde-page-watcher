/**
 * Route config for the case view.
 *
 * Same reasoning as the list's layout: the page is a client component reading
 * the route param and the store, so the segment config cannot live in it. The
 * store reads the filesystem, so the Node runtime is explicit rather than left
 * to a host default.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function CaseLayout({ children }: { children: React.ReactNode }) {
  return children;
}
