import type { Intents } from "./intents";

const view = WebflowExtensionView.connect<Intents>();

// Fixed, bounded snapshot of this app's real Next.js route tree, read from
// src/app/**/page.tsx, plus real navigation edges read from src/components/Sidebar.tsx.
// Route groups like "(app)" are layout-only in Next.js and are not shown as routes.
type NodeKind = "route" | "dynamic" | "auth" | "demo";

interface GraphNode {
  id: string;
  route: string;
  label: string;
  sourceFile: string;
  kind: NodeKind;
  col: number;
  row: number;
  x: number;
  y: number;
}

interface GraphEdge {
  from: string;
  to: string;
  kind: "nav" | "nest" | "flow";
}

const nodes: GraphNode[] = [
  { id: "root", route: "/", label: "/ (root redirect)", sourceFile: "src/app/page.tsx", kind: "route", col: 0, row: 2, x: 0, y: 0 },
  { id: "login", route: "/login", label: "Login", sourceFile: "src/app/login/page.tsx", kind: "auth", col: 0, row: 0, x: 0, y: 0 },
  { id: "scorecard-demo", route: "/scorecard-demo", label: "Scorecard Demo", sourceFile: "src/app/scorecard-demo/page.tsx", kind: "demo", col: 0, row: 4, x: 0, y: 0 },

  { id: "dashboard", route: "/dashboard", label: "Dashboard", sourceFile: "src/app/(app)/dashboard/page.tsx", kind: "route", col: 1, row: 0, x: 0, y: 0 },
  { id: "pages", route: "/pages", label: "Pages", sourceFile: "src/app/(app)/pages/page.tsx", kind: "route", col: 1, row: 1, x: 0, y: 0 },
  { id: "inbox", route: "/inbox", label: "Inbox", sourceFile: "src/app/(app)/inbox/page.tsx", kind: "route", col: 1, row: 2, x: 0, y: 0 },
  { id: "tasks", route: "/tasks", label: "Tasks", sourceFile: "src/app/(app)/tasks/page.tsx", kind: "route", col: 1, row: 3, x: 0, y: 0 },
  { id: "watchlist", route: "/watchlist", label: "Watchlist", sourceFile: "src/app/(app)/watchlist/page.tsx", kind: "route", col: 1, row: 4, x: 0, y: 0 },
  { id: "settings", route: "/settings", label: "Settings", sourceFile: "src/app/(app)/settings/page.tsx", kind: "route", col: 1, row: 5, x: 0, y: 0 },
  { id: "admin", route: "/admin", label: "Admin", sourceFile: "src/app/(app)/admin/page.tsx", kind: "route", col: 1, row: 6, x: 0, y: 0 },

  { id: "pages-id", route: "/pages/[id]", label: "Page detail", sourceFile: "src/app/(app)/pages/[id]/page.tsx", kind: "dynamic", col: 2, row: 1, x: 0, y: 0 },
];

const edges: GraphEdge[] = [
  { from: "root", to: "login", kind: "flow" },
  { from: "root", to: "dashboard", kind: "flow" },
  { from: "dashboard", to: "pages", kind: "nav" },
  { from: "dashboard", to: "inbox", kind: "nav" },
  { from: "dashboard", to: "tasks", kind: "nav" },
  { from: "dashboard", to: "watchlist", kind: "nav" },
  { from: "dashboard", to: "settings", kind: "nav" },
  { from: "dashboard", to: "admin", kind: "nav" },
  { from: "pages", to: "pages-id", kind: "nest" },
];

const KIND_COLOR: Record<NodeKind, string> = {
  route: "#3b89ff",
  dynamic: "#35d07f",
  auth: "#f5a623",
  demo: "#a1a1aa",
};

const COL_W = 210;
const ROW_H = 74;
const PAD_X = 90;
const PAD_Y = 50;
const R = 46;
// Minimum center-to-center distance allowed between two node circles,
// including a small buffer so labels never visually touch.
const MIN_DIST = R * 2 + 16;

for (const n of nodes) {
  n.x = PAD_X + n.col * COL_W;
  n.y = PAD_Y + n.row * ROW_H;
}

const byId = new Map(nodes.map((n) => [n.id, n]));
const maxCol = Math.max(...nodes.map((n) => n.col));
const maxRow = Math.max(...nodes.map((n) => n.row));
let width = PAD_X * 2 + maxCol * COL_W;
let height = PAD_Y * 2 + maxRow * ROW_H;

const svgNS = "http://www.w3.org/2000/svg";

function makeSvgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(svgNS, tag);
}

const svg = document.querySelector<SVGSVGElement>("#graph");
const detailRoute = document.querySelector<HTMLElement>("#detail-route");
const detailFile = document.querySelector<HTMLElement>("#detail-file");
const detailKind = document.querySelector<HTMLElement>("#detail-kind");
const openButton = document.querySelector<HTMLButtonElement>("#open-route");
const openStatus = document.querySelector<HTMLElement>("#open-status");
const nodeCountEl = document.querySelector<HTMLElement>("#node-count");
const edgeCountEl = document.querySelector<HTMLElement>("#edge-count");

let selected: GraphNode | null = null;
const circleEls = new Map<string, SVGCircleElement>();
const groupEls = new Map<string, SVGGElement>();
const edgeEls: { edge: GraphEdge; path: SVGPathElement }[] = [];

// Resolve any circle/circle overlaps by nudging nodes apart, so the initial
// layout (and any later drag) never leaves two nodes visually overlapping.
function resolveOverlaps(): void {
  const iterations = 24;
  for (let iter = 0; iter < iterations; iter += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist === 0) {
          dx = 1;
          dy = 0;
          dist = 1;
        }
        if (dist < MIN_DIST) {
          const overlap = (MIN_DIST - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * overlap;
          a.y -= uy * overlap;
          b.x += ux * overlap;
          b.y += uy * overlap;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  for (const n of nodes) {
    n.x = Math.max(PAD_X, n.x);
    n.y = Math.max(PAD_Y, n.y);
  }
  const maxX = Math.max(...nodes.map((n) => n.x));
  const maxY = Math.max(...nodes.map((n) => n.y));
  width = Math.max(width, maxX + PAD_X);
  height = Math.max(height, maxY + PAD_Y);
}

function updateEdgePaths(): void {
  for (const { edge, path } of edgeEls) {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) continue;
    const midX = (a.x + b.x) / 2;
    path.setAttribute("d", `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`);
  }
}

function updateNodeTransform(node: GraphNode): void {
  const g = groupEls.get(node.id);
  if (g) g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
}

function updateViewport(): void {
  svg?.setAttribute("viewBox", `0 0 ${width} ${height}`);
}

function selectNode(node: GraphNode): void {
  selected = node;
  for (const [id, circle] of circleEls) {
    circle.setAttribute("stroke", id === node.id ? "#ffffff" : "rgba(255,255,255,0.25)");
    circle.setAttribute("stroke-width", id === node.id ? "3" : "1.5");
  }
  if (detailRoute) detailRoute.textContent = node.route;
  if (detailFile) detailFile.textContent = node.sourceFile;
  if (detailKind) detailKind.textContent = node.kind;
  if (openButton) openButton.disabled = false;
  if (openStatus) openStatus.textContent = "";
}

function svgPoint(clientX: number, clientY: number): { x: number; y: number } {
  if (!svg) return { x: clientX, y: clientY };
  const rect = svg.getBoundingClientRect();
  const scaleX = width / rect.width;
  const scaleY = height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

function makeDraggable(g: SVGGElement, node: GraphNode): void {
  let dragging = false;
  let moved = false;
  let offsetX = 0;
  let offsetY = 0;

  g.addEventListener("pointerdown", (event) => {
    dragging = true;
    moved = false;
    g.setPointerCapture(event.pointerId);
    const p = svgPoint(event.clientX, event.clientY);
    offsetX = node.x - p.x;
    offsetY = node.y - p.y;
    g.style.cursor = "grabbing";
  });

  g.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    moved = true;
    const p = svgPoint(event.clientX, event.clientY);
    node.x = Math.max(R + 4, p.x + offsetX);
    node.y = Math.max(R + 4, p.y + offsetY);
    updateNodeTransform(node);
    updateEdgePaths();
  });

  function endDrag(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    g.style.cursor = "grab";
    try {
      g.releasePointerCapture(event.pointerId);
    } catch {
      // ignore if capture already released
    }
    if (moved) {
      // Settle any overlap this drag introduced, then snap every node's
      // rendered position to its resolved coordinates.
      resolveOverlaps();
      for (const n of nodes) updateNodeTransform(n);
      updateEdgePaths();
      updateViewport();
    } else {
      selectNode(node);
    }
  }

  g.addEventListener("pointerup", endDrag);
  g.addEventListener("pointercancel", endDrag);
}

function render(): void {
  if (!svg) return;
  resolveOverlaps();
  updateViewport();
  svg.innerHTML = "";
  circleEls.clear();
  groupEls.clear();
  edgeEls.length = 0;

  const edgeGroup = makeSvgEl("g");
  for (const edge of edges) {
    const path = makeSvgEl("path");
    path.setAttribute("fill", "none");
    path.setAttribute(
      "stroke",
      edge.kind === "nav" ? "rgba(59,137,255,0.55)" : edge.kind === "nest" ? "rgba(53,208,127,0.6)" : "rgba(255,255,255,0.25)",
    );
    path.setAttribute("stroke-width", edge.kind === "nav" ? "2" : "1.5");
    if (edge.kind === "flow") path.setAttribute("stroke-dasharray", "4 4");
    edgeEls.push({ edge, path });
    edgeGroup.appendChild(path);
  }
  svg.appendChild(edgeGroup);
  updateEdgePaths();

  const nodeGroup = makeSvgEl("g");
  for (const node of nodes) {
    const g = makeSvgEl("g");
    g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
    g.style.cursor = "grab";
    g.style.touchAction = "none";
    groupEls.set(node.id, g);

    const circle = makeSvgEl("circle");
    circle.setAttribute("r", String(R));
    circle.setAttribute("fill", KIND_COLOR[node.kind]);
    circle.setAttribute("fill-opacity", "0.16");
    circle.setAttribute("stroke", "rgba(255,255,255,0.25)");
    circle.setAttribute("stroke-width", "1.5");
    circleEls.set(node.id, circle);
    g.appendChild(circle);

    const dot = makeSvgEl("circle");
    dot.setAttribute("r", "5");
    dot.setAttribute("cy", String(-R + 14));
    dot.setAttribute("fill", KIND_COLOR[node.kind]);
    g.appendChild(dot);

    const text = makeSvgEl("text");
    text.textContent = node.label;
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dy", "-2");
    text.setAttribute("fill", "#f4f4f5");
    text.setAttribute("font-size", "12.5");
    text.setAttribute("font-weight", "600");
    text.style.userSelect = "none";
    g.appendChild(text);

    const routeText = makeSvgEl("text");
    routeText.textContent = node.route;
    routeText.setAttribute("text-anchor", "middle");
    routeText.setAttribute("dy", "16");
    routeText.setAttribute("fill", "rgba(244,244,245,0.6)");
    routeText.setAttribute("font-size", "10.5");
    routeText.style.userSelect = "none";
    g.appendChild(routeText);

    makeDraggable(g, node);
    nodeGroup.appendChild(g);
  }
  svg.appendChild(nodeGroup);

  if (nodeCountEl) nodeCountEl.textContent = String(nodes.length);
  if (edgeCountEl) edgeCountEl.textContent = String(edges.length);
}

render();

openButton?.addEventListener("click", async () => {
  if (!selected || !openButton || !openStatus) return;
  const route = selected.route === "/pages/[id]" ? "/pages" : selected.route;
  openButton.disabled = true;
  openStatus.textContent = "Opening preview…";
  try {
    const result = await view.intent("preview.openRoute", { route });
    if (result.status === "ok") {
      openStatus.textContent = `Opened ${route} in preview.`;
    } else if (result.status === "blocked") {
      openStatus.textContent = `Blocked: ${String(result.reason ?? "Preview unavailable.")}`;
    } else {
      openStatus.textContent = "More input is required to open this route.";
    }
  } catch (error) {
    openStatus.textContent = error instanceof Error ? `Transport error: ${error.message}` : "Transport error.";
  } finally {
    openButton.disabled = false;
  }
});
