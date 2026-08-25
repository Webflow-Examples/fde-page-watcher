/**
 * Route config for the issues list.
 *
 * The list reads `?queue=` and `?sort=` from the client, so `page.tsx` is a
 * client component and cannot carry segment config itself. These two exports
 * are the ones the route shell already had, kept here unchanged: the store
 * reads the filesystem, so the Node runtime has to be explicit — some hosts
 * default an unannotated segment to an edge runtime — and the page is never
 * prerendered, which is also what lets the client read the query string
 * without a Suspense boundary.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function IssuesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
