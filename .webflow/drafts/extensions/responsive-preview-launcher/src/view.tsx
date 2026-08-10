import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Block, Button, Field, Input, Stack } from "@webflow/extension-ui";

const DEFAULT_PORT = "3001";
const DEFAULT_PATH = "/responsive-preview.html";

function buildUrl(port: string): string {
  const trimmedPort = port.trim() || DEFAULT_PORT;
  return `http://localhost:${trimmedPort}${DEFAULT_PATH}`;
}

function App() {
  const [port, setPort] = useState(DEFAULT_PORT);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const url = useMemo(() => buildUrl(port), [port]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }

  return (
    <Block
      variant="padded"
      headerTitle="Responsive Preview"
      headerContext="Desktop + mobile, side by side"
    >
      <Stack direction="column" gap="layout-gap">
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-secondary, #6b7280)" }}>
          Your dev server serves a live, synced desktop/mobile comparison page at the
          URL below. This panel can&apos;t open it for you directly — copy the link and
          paste it into the Site Browser&apos;s address bar.
        </p>

        <Field label="Dev server port" hint="Change this if your dev server printed a different port.">
          <Input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder={DEFAULT_PORT}
          />
        </Field>

        <Field label="Preview URL">
          <Input value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        </Field>

        <Stack direction="row" gap="control-gap">
          <Button type="button" variant="solid" tone="brand" size="md" onClick={() => void copyUrl()}>
            {copyState === "copied" ? "Copied!" : copyState === "error" ? "Copy failed" : "Copy link"}
          </Button>
        </Stack>

        <p style={{ margin: 0, fontSize: 12, color: "var(--text-tertiary, #9ca3af)" }}>
          Requires the dev server (<code>npm run dev</code>) to be running, and the
          page to be opened via <code>http://localhost:{port || DEFAULT_PORT}</code> —
          not as a local file — so navigation and scroll sync between the two panes
          works correctly.
        </p>
      </Stack>
    </Block>
  );
}

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Managed View mount root is missing.");
createRoot(root).render(<App />);
