import { describe, expect, it, vi } from "vitest";
import { accessLogoutUrls } from "../accessLogout";
import { clearPageWatchBrowserState } from "../clientLogout";

describe("Access logout", () => {
  it("builds fixed application and team-domain logout endpoints", () => {
    expect(accessLogoutUrls({
      brokerUrl: "https://gateway.example.workers.dev",
      teamDomain: "page-watch.cloudflareaccess.com",
    })).toEqual([
      "https://gateway.example.workers.dev/cdn-cgi/access/logout",
      "https://page-watch.cloudflareaccess.com/cdn-cgi/access/logout",
    ]);
  });

  it("rejects unsafe or non-Access logout origins", () => {
    expect(accessLogoutUrls({
      brokerUrl: "https://gateway.example.workers.dev/redirect",
      teamDomain: "https://attacker.example.com",
    })).toEqual([]);
  });

  it("removes only Page Watch browser state", () => {
    const values = new Map([
      ["page-watcher:last-project", "brand-studio"],
      ["page-watcher:preferred-strategy", "mobile"],
      ["unrelated", "keep-me"],
    ]);
    const storage = {
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: vi.fn((key: string) => values.delete(key)),
    };

    clearPageWatchBrowserState(storage);

    expect([...values]).toEqual([["unrelated", "keep-me"]]);
  });
});
