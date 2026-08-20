import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Block, BlockHeader, BlockState, ListRow, Stack, StatusTag } from "@webflow/extension-ui";
import type { Intents } from "./intents";

const view = WebflowExtensionView.connect<Intents>();

/**
 * Fixed, bounded snapshot of this Next.js app's routes, derived from
 * src/app/**\/page.tsx at authoring time. This View does not read the
 * filesystem or a Content Source at runtime — it is a local project-file
 * snapshot, so the list only changes when this View is re-authored.
 */
interface AppRoute {
  path: string;
  title: string;
}

const ROUTES: AppRoute[] = [
  { path: "/dashboard", title: "Dashboard" },
  { path: "/pages", title: "Pages" },
  { path: "/inbox", title: "Inbox" },
  { path: "/tasks", title: "Tasks" },
  { path: "/watchlist", title: "Watchlist" },
  { path: "/settings", title: "Settings" },
  { path: "/admin", title: "Admin" },
  { path: "/scorecard-demo", title: "Scorecard Demo" },
  { path: "/login", title: "Login" },
  { path: "/", title: "Home" },
];

type RowState = "idle" | "opening" | "failed";

function App() {
  const [blockState, setBlockState] = useState<"ready" | "loading" | "error">("ready");
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [lastError, setLastError] = useState<string | null>(null);

  async function openRoute(route: string) {
    setRowStates((current) => ({ ...current, [route]: "opening" }));
    setBlockState("loading");
    setLastError(null);
    try {
      const result = await view.intent("pages.openRoute", { route });
      const message = WebflowExtensionView.matchResult(result, {
        readOkData(value) {
          if (
            typeof value !== "object" ||
            value === null ||
            Array.isArray(value) ||
            typeof (value as { previewId?: unknown }).previewId !== "string" ||
            typeof (value as { status?: unknown }).status !== "string"
          ) {
            return { ok: false };
          }
          return { ok: true, value: value as { previewId: string; status: string } };
        },
        ok: () => null,
        needs_input: () => "The preview needs more input before it can open this route.",
        blocked: (blocked) => `Blocked: ${blocked.reason}.`,
        unknown: (status) => `Unexpected status: ${status}.`,
      });
      if (message) {
        setRowStates((current) => ({ ...current, [route]: "failed" }));
        setLastError(message);
        setBlockState("error");
      } else {
        setRowStates((current) => ({ ...current, [route]: "idle" }));
        setBlockState("ready");
      }
    } catch (error) {
      setRowStates((current) => ({ ...current, [route]: "failed" }));
      setLastError(error instanceof Error ? error.message : "Opening this route failed.");
      setBlockState("error");
    }
  }

  return (
    <Block variant="list">
      <BlockState
        state={blockState}
        onRetry={() => {
          setBlockState("ready");
          setLastError(null);
        }}
      >
        <Stack gap="4">
          <BlockHeader
            title="App Pages"
            context={`${ROUTES.length} routes`}
          />
          {lastError ? (
            <div role="status" style={{ color: "var(--text-danger, #d33)" }}>
              {lastError}
            </div>
          ) : null}
          <Stack gap="1">
            {ROUTES.map((route) => {
              const rowState = rowStates[route.path] ?? "idle";
              return (
                <ListRow
                  key={route.path}
                  title={route.title}
                  secondary={route.path}
                  onClick={() => void openRoute(route.path)}
                  actions={
                    rowState === "opening" ? (
                      <StatusTag status="draft" />
                    ) : rowState === "failed" ? (
                      <StatusTag status="failed" />
                    ) : undefined
                  }
                />
              );
            })}
          </Stack>
          <div style={{ fontSize: 12, color: "var(--text-secondary, #888)" }}>
            Selecting a route opens it in the Site Browser or live preview. The dynamic page detail
            route (/pages/[id]) is opened from within the Pages list itself, since it needs a real id.
          </div>
        </Stack>
      </BlockState>
    </Block>
  );
}

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Managed View mount root is missing.");
createRoot(root).render(<App />);
