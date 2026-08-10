import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Block, BlockState, Button, ListRow, Stack, StatusTag } from "@webflow/extension-ui";
import type { Intents } from "./intents";

const operations = [{"label":"Send greeting","intent":"responsive-preview.echo","params":{"message":"Hello from Webflow"}}] as const;
const view = WebflowExtensionView.connect<Intents>();
const MAX_RENDERED_RESULTS = 50;

function prependResults(current: string[], additions: readonly string[]): string[] {
  return [...additions, ...current].slice(0, MAX_RENDERED_RESULTS);
}

function describeResult(result: { status: string; data?: unknown; reason?: unknown }): string {
  if (result.status === "ok") return JSON.stringify(result.data ?? null, null, 2);
  if (result.status === "blocked") return "Blocked: " + String(result.reason ?? "The host rejected this operation.");
  if (result.status === "needs_input") return "More input is required before this can continue.";
  return "Unknown result status: " + result.status;
}

function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [state, setState] = useState<"ready" | "loading" | "error">("ready");
  const [results, setResults] = useState<string[]>([]);
  const selected = operations[selectedIndex] ?? operations[0];


  useEffect(() => () => view.disconnect(), []);


  async function runSelected() {
    if (!selected) return;
    setState("loading");
    try {
      const result = await view.intent(selected.intent as keyof Intents, selected.params as never);
      setResults((current) => prependResults(current, [describeResult(result)]));
      setState("ready");
    } catch (error) {

      setResults((current) => prependResults(current, [
        error instanceof Error ? error.message : "The operation failed.",
      ]));
      setState("error");
    }
  }

  return (
    <Block variant="list">
      <BlockState state={state} onRetry={() => setState("ready")}>
        <Stack gap="layout-gap">
          <div role="status"><StatusTag status={state === "error" ? "failed" : "ready"} /></div>
          {operations.map((operation, index) => (
            <ListRow
              key={operation.label}
              title={operation.label}
              density="regular"
              selected={index === selectedIndex}
              onClick={() => setSelectedIndex(index)}
            />
          ))}
          <Button type="button" size="md" variant="solid" tone="brand" onClick={() => void runSelected()}>
            Run selected operation
          </Button>

          {results.map((result, index) => <pre key={index}>{result}</pre>)}
        </Stack>
      </BlockState>
    </Block>
  );
}

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Managed View mount root is missing.");
createRoot(root).render(<App />);
