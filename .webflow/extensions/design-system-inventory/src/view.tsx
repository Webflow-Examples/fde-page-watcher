import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Badge, Block, BlockState, Card, CardBody, EmptyState, Field, Input, Select, Stack } from "@webflow/extension-ui";
import { INVENTORY, usageCount, type SystemCategory, type SystemEntry } from "./inventory-data";
import { copyToClipboard, MockPreview, ScalePreview, SwatchPreview, TypePreview } from "./preview-mocks";

type CategoryFilter = "all" | SystemCategory;

type SortKey = "name-asc" | "name-desc" | "uses-asc" | "uses-desc" | "category-asc" | "category-desc";

type GridSize = "small" | "large";

const CATEGORY_LABEL: Record<SystemCategory, string> = {
  token: "Token",
  pattern: "Pattern",
  component: "Component",
};

/** One distinct color per category, so the pills are color-coded at a glance. */
const CATEGORY_COLOR: Record<SystemCategory, string> = {
  token: "#3b89ff",
  pattern: "#8a5cf6",
  component: "#35d07f",
};

/**
 * Icon-only grid-density toggle, styled to match the app's own segmented
 * control (rounded track, sliding-style selected pill) since the managed
 * facade has no admitted SegmentedControl component.
 */
function GridSizeToggle({ value, onChange }: { value: GridSize; onChange: (next: GridSize) => void }) {
  return (
    <div className="grid-size-toggle" role="group" aria-label="Grid card size">
      <button
        type="button"
        className={"grid-size-toggle__option" + (value === "small" ? " is-selected" : "")}
        aria-pressed={value === "small"}
        aria-label="Small cards, three columns"
        title="Small cards (3 columns)"
        onClick={() => onChange("small")}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="6" y="1" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="11" y="1" width="4" height="14" rx="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={"grid-size-toggle__option" + (value === "large" ? " is-selected" : "")}
        aria-pressed={value === "large"}
        aria-label="Large cards, two columns"
        title="Large cards (2 columns)"
        onClick={() => onChange("large")}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="6.5" height="14" rx="1" fill="currentColor" />
          <rect x="8.5" y="1" width="6.5" height="14" rx="1" fill="currentColor" />
        </svg>
      </button>
    </div>
  );
}

function CategoryPill({ category }: { category: SystemCategory }) {
  const color = CATEGORY_COLOR[category];
  return (
    <span
      className="category-pill"
      style={{
        color,
        background: color + "22",
        border: "1px solid " + color + "55",
      }}
    >
      {CATEGORY_LABEL[category]}
    </span>
  );
}

const CATEGORY_ORDER: Record<SystemCategory, number> = {
  token: 0,
  pattern: 1,
  component: 2,
};

const SORT_LABEL: Record<SortKey, string> = {
  "name-asc": "Name (A → Z)",
  "name-desc": "Name (Z → A)",
  "uses-desc": "References (most first)",
  "uses-asc": "References (fewest first)",
  "category-asc": "Category (A → Z)",
  "category-desc": "Category (Z → A)",
};

function matchesQuery(entry: SystemEntry, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    entry.source.toLowerCase().includes(needle)
  );
}

function sortEntries(entries: SystemEntry[], sortKey: SortKey): SystemEntry[] {
  const list = [...entries];
  switch (sortKey) {
    case "name-asc":
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case "name-desc":
      return list.sort((a, b) => b.name.localeCompare(a.name));
    case "uses-asc":
      return list.sort((a, b) => usageCount(a) - usageCount(b) || a.name.localeCompare(b.name));
    case "uses-desc":
      return list.sort((a, b) => usageCount(b) - usageCount(a) || a.name.localeCompare(b.name));
    case "category-asc":
      return list.sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.name.localeCompare(b.name));
    case "category-desc":
      return list.sort((a, b) => CATEGORY_ORDER[b.category] - CATEGORY_ORDER[a.category] || a.name.localeCompare(b.name));
    default:
      return list;
  }
}

function EntryPreview({ entry }: { entry: SystemEntry }) {
  if (entry.preview.kind === "swatch") return <SwatchPreview colors={entry.preview.colors} />;
  if (entry.preview.kind === "scale") return <ScalePreview steps={entry.preview.steps} />;
  if (entry.preview.kind === "type") return <TypePreview sample={entry.preview.sample} tokenName={entry.name} tokenValue={entry.preview.sample} />;
  return <MockPreview mockId={entry.preview.mockId} />;
}

/**
 * The "#uses" pill. Its reference list opens on hover/focus AND stays open
 * once clicked (pinned), so the pointer can travel down into the list
 * without the disclosure closing. Route/file references are shown as
 * selectable text, not a link: no Studio capability lets a View drive Site
 * Browser navigation to an arbitrary local route or file, so this stays
 * honest instead of wiring a broken click.
 */
function UsesPill({ entry }: { entry: SystemEntry }) {
  const [pinned, setPinned] = useState(false);
  const count = usageCount(entry);
  const label = count === 0 ? "Unused" : "#" + count + (count === 1 ? " use" : " uses");

  return (
    <span className={"uses-pill" + (pinned ? " is-pinned" : "")} tabIndex={0}>
      <button
        type="button"
        className="uses-pill__trigger"
        onClick={() => setPinned((current) => !current)}
        aria-expanded={pinned}
      >
        <Badge>{label}</Badge>
      </button>
      <span className="uses-pill__bridge" />
      <span className="uses-pill__content" role="note">
        <strong>Defined in</strong>
        <span className="uses-pill__path">{entry.source}</span>
        {entry.usages.length === 0 ? (
          <span>No current references found in src/app routes.</span>
        ) : (
          <>
            <strong>Referenced in</strong>
            {entry.usages.map((usage, index) => (
              <span key={entry.id + "-" + index} className="uses-pill__ref">
                <span className="uses-pill__path">{usage.route}</span>
                <span className="uses-pill__path uses-pill__path--file">{usage.file}</span>
              </span>
            ))}
          </>
        )}
      </span>
    </span>
  );
}

function EntryCard({ entry }: { entry: SystemEntry }) {
  return (
    <Card className="entry-card">
      <CardBody className="entry-card__body">
        <div className="entry-card__preview">
          <EntryPreview entry={entry} />
        </div>
        <div className="entry-card__footer">
          <button
            type="button"
            className="entry-card__title"
            onClick={() => copyToClipboard(entry.name)}
            title={"Click to copy " + entry.name}
          >
            {entry.name}
          </button>
          <div className="entry-card__pills">
            <CategoryPill category={entry.category} />
            <UsesPill entry={entry} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function App() {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("uses-desc");
  const [gridSize, setGridSize] = useState<GridSize>("small");

  const filtered = useMemo(() => {
    return INVENTORY.filter((entry) => (category === "all" ? true : entry.category === category)).filter((entry) =>
      matchesQuery(entry, query),
    );
  }, [category, query]);

  const sorted = useMemo(() => sortEntries(filtered, sortKey), [filtered, sortKey]);

  const totals = useMemo(() => {
    const byCategory: Record<SystemCategory, number> = { token: 0, pattern: 0, component: 0 };
    for (const entry of INVENTORY) byCategory[entry.category] += 1;
    return byCategory;
  }, []);

  const state = sorted.length === 0 ? "filtered-empty" : "ready";

  return (
    <Block variant="padded" headerTitle="Design system inventory" headerContext={<Badge>{INVENTORY.length} pieces</Badge>}>
      <style>{`
        .controls-row {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 20px;
          flex-wrap: wrap;
        }
        .controls-row__left {
          display: flex;
          align-items: flex-end;
          gap: 20px;
          flex-wrap: wrap;
        }
        .controls-row__search {
          width: 22rem;
          max-width: 100%;
        }
        .entry-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
          align-items: stretch;
        }
        .entry-grid.entry-grid--large {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @media (max-width: 46rem) {
          .entry-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 28rem) {
          .entry-grid,
          .entry-grid.entry-grid--large {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .controls-row__right {
          display: flex;
          align-items: flex-end;
          gap: 20px;
        }
        .grid-size-toggle {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          border-radius: 9px;
          background: #101014;
        }
        .grid-size-toggle__option {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 28px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: #6b6b76;
          cursor: pointer;
        }
        .grid-size-toggle__option.is-selected {
          background: #20202a;
          color: var(--text-primary, #f4f4f5);
        }
        .entry-card {
          height: 100%;
        }
        .entry-card__body {
          display: flex;
          height: 100%;
          flex-direction: column;
          gap: 12px;
        }
        .entry-card__preview {
          flex: 1 1 auto;
        }
        .entry-card__footer {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: auto;
        }
        .entry-card__title {
          display: inline-block;
          width: fit-content;
          border: 0;
          background: transparent;
          padding: 0;
          margin: 0;
          font-weight: 600;
          font-size: inherit;
          font-family: inherit;
          color: inherit;
          text-align: left;
          cursor: pointer;
          border-radius: 4px;
        }
        .entry-card__title:hover {
          text-decoration: underline;
          text-decoration-style: dotted;
          text-underline-offset: 3px;
        }
        .entry-card__pills {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .category-pill {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        .uses-pill {
          position: relative;
          display: inline-flex;
          outline: none;
        }
        .uses-pill__trigger {
          padding: 0;
          border: 0;
          background: transparent;
          cursor: pointer;
        }
        .uses-pill__bridge {
          position: absolute;
          top: 100%;
          right: 0;
          left: 0;
          height: 10px;
          display: none;
        }
        .uses-pill__content {
          position: absolute;
          z-index: 20;
          top: calc(100% + 6px);
          right: 0;
          display: none;
          flex-direction: column;
          gap: 4px;
          width: 260px;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--border-default, #2c2c36);
          background: var(--surface-elevated, #1c1c22);
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
          font-size: 11.5px;
          line-height: 1.4;
        }
        .uses-pill__ref {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .uses-pill__path {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          user-select: text;
        }
        .uses-pill__path--file {
          opacity: 0.72;
        }
        .uses-pill:hover .uses-pill__bridge,
        .uses-pill:hover .uses-pill__content,
        .uses-pill:focus-within .uses-pill__bridge,
        .uses-pill:focus-within .uses-pill__content,
        .uses-pill.is-pinned .uses-pill__bridge,
        .uses-pill.is-pinned .uses-pill__content {
          display: flex;
        }
      `}</style>
      <Stack gap="layout-gap">
        <p>
          Every token, pattern, and component found in this project&apos;s source, shown at once.
          Hover, focus, or click the &quot;#uses&quot; pill on a card to see exactly where it is
          referenced — click pins it open so you can move down into the list. This is a static
          snapshot reconciled against source; it does not refetch or watch the app, and
          references are shown as text because no Studio capability lets this View drive Site
          Browser navigation to an arbitrary local route or file.
        </p>

        <div className="controls-row">
          <div className="controls-row__left">
            <Field label="Category">
              <Select value={category} onChange={(event) => setCategory(event.target.value as CategoryFilter)}>
                <option value="all">All ({INVENTORY.length})</option>
                <option value="token">Tokens ({totals.token})</option>
                <option value="pattern">Patterns ({totals.pattern})</option>
                <option value="component">Components ({totals.component})</option>
              </Select>
            </Field>
            <Field label="Search" className="controls-row__search">
              <Input
                type="text"
                placeholder="Filter by name, description, or file…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
          </div>
          <div className="controls-row__right">
            <Field label="Card size">
              <GridSizeToggle value={gridSize} onChange={setGridSize} />
            </Field>
            <Field label="Sort by">
              <Select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
                {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SORT_LABEL[key]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <BlockState
          state={state}
          skeleton={<span>Loading design system inventory…</span>}
          empty={<EmptyState title="No inventory" description="No tokens, patterns, or components were found." tone="neutral" />}
          filteredEmpty={
            <EmptyState
              title="No matches"
              description="No token, pattern, or component matches this filter and search."
              tone="neutral"
            />
          }
          error={<EmptyState title="Could not load inventory" description="The bundled snapshot failed to render." tone="danger" />}
          unavailable={<EmptyState title="Inventory unavailable" description="This snapshot is not available in this build." tone="neutral" />}
          onClearFilters={() => {
            setCategory("all");
            setQuery("");
          }}
        >
          <div className={"entry-grid" + (gridSize === "large" ? " entry-grid--large" : "")}>
            {sorted.map((entry) => (
              <EntryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </BlockState>
      </Stack>
    </Block>
  );
}

const root = document.querySelector<HTMLElement>("#root");
if (!root) throw new Error("Managed View mount root is missing.");
createRoot(root).render(<App />);
