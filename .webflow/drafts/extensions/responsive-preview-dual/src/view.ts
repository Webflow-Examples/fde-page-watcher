// Plain-profile custom UI: two side-by-side iframes (desktop + mobile widths)
// pointed at the user's local dev server. No extension capabilities are
// needed for this — it only sets iframe `src` from user-entered port/path.

const portInput = document.querySelector<HTMLInputElement>("[data-port]");
const pathInput = document.querySelector<HTMLInputElement>("[data-path]");
const loadButton = document.querySelector<HTMLButtonElement>("[data-load]");
const reloadButton = document.querySelector<HTMLButtonElement>("[data-reload]");
const statusEl = document.querySelector<HTMLElement>("[data-status]");
const panesEl = document.querySelector<HTMLElement>("[data-panes]");
const emptyEl = document.querySelector<HTMLElement>("[data-empty]");
const desktopFrame = document.querySelector<HTMLIFrameElement>("#desktop-frame");
const mobileFrame = document.querySelector<HTMLIFrameElement>("#mobile-frame");

const DEFAULT_PORT = "3000";
const DEFAULT_PATH = "/dashboard";

function normalizedPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_PATH;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function buildUrl(): string | null {
  const port = (portInput?.value ?? "").trim() || DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(port)) {
    setStatus("Port must be numeric.");
    return null;
  }
  const path = normalizedPath(pathInput?.value ?? "/");
  return `http://localhost:${port}${path}`;
}

function setStatus(message: string) {
  if (statusEl) statusEl.textContent = message;
}

function loadPreview() {
  const url = buildUrl();
  if (!url || !desktopFrame || !mobileFrame) return;

  desktopFrame.src = url;
  mobileFrame.src = url;

  if (panesEl) panesEl.hidden = false;
  if (emptyEl) emptyEl.hidden = true;
  setStatus(`Loaded ${url}`);
}

function reloadPreview() {
  if (desktopFrame?.src) {
    // Re-assigning forces a reload without changing history entries.
    desktopFrame.src = desktopFrame.src;
  }
  if (mobileFrame?.src) {
    mobileFrame.src = mobileFrame.src;
  }
  setStatus("Reloaded both panes.");
}

loadButton?.addEventListener("click", loadPreview);
reloadButton?.addEventListener("click", reloadPreview);

portInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadPreview();
});
pathInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loadPreview();
});
