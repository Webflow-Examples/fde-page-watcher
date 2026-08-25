import Link from "next/link";
import { getEnv } from "@/lib/env";
import { normalizeBasePath, withBasePath } from "@/lib/paths";
import { DESTINATION_LABEL, DESTINATION_PATH, QUEUES, QUEUE_LABEL, parseQueue } from "@/lib/vocabulary";
import { PageHeader } from "@/components/page-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface IssuesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Route shell for the one object the app is organised around. The queue tabs
 * and the header live here; the list itself is a later chunk, so the body is a
 * placeholder for now.
 *
 * The header is written inline rather than extracted into a shared component —
 * that extraction is a separate piece of work that will adopt this route along
 * with every other one.
 */
export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.queue) ? params.queue[0] : params.queue;
  const activeQueue = parseQueue(requested);
  const basePath = normalizeBasePath(getEnv("BASE_URL"));

  return (
    <div style={{ minWidth: 0 }}>
      <PageHeader
        title={DESTINATION_LABEL.issues}
        purpose="One case per problem. Decide what to take on, then follow it until the evidence agrees."
        flush
      />

      <nav
        aria-label="Queues"
        style={{
          display: "flex",
          gap: 2,
          alignItems: "center",
          padding: "18px 40px 0",
          borderBottom: "1px solid var(--border-hairline)",
          margin: "0 0 24px",
        }}
      >
        {QUEUES.map((queue) => {
          const active = queue === activeQueue;
          return (
            <Link
              key={queue}
              href={withBasePath(basePath, `${DESTINATION_PATH.issues}?queue=${queue}`)}
              aria-current={active ? "page" : undefined}
              style={{
                padding: "8px 12px 11px",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
                color: active ? "var(--text-body)" : "var(--text-muted)",
                borderBottom: `2px solid ${active ? "var(--action-primary-bg)" : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {QUEUE_LABEL[queue]}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: "0 40px 40px", fontSize: 13, color: "var(--text-muted)" }}>
        {QUEUE_LABEL[activeQueue]} is not wired up yet.
      </div>
    </div>
  );
}
