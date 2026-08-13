interface BrowserStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export function clearPageWatchBrowserState(...stores: BrowserStorage[]): void {
  for (const store of stores) {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index))
      .filter((key): key is string => Boolean(key?.startsWith("page-watcher:")));
    for (const key of keys) store.removeItem(key);
  }
}
