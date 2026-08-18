"use client";

import { useMemo, useState } from "react";
import { BookOpenTextIcon, CaretDownIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { GUIDE_CATEGORIES, GUIDE_ENTRIES } from "@/lib/guide";
import type { GuideCategoryId, GuideEntry } from "@/lib/guide";
import { C } from "@/lib/ui";

type CategoryFilter = "all" | GuideCategoryId;

function entryMatches(entry: GuideEntry, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return [
    entry.term,
    entry.shortDefinition,
    entry.appMeaning,
    entry.action,
    ...(entry.related ?? []),
    ...(entry.aliases ?? []),
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
}

export default function GuidePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(
    () => GUIDE_ENTRIES.filter((entry) =>
      (category === "all" || entry.category === category)
      && entryMatches(entry, normalizedQuery)),
    [category, normalizedQuery],
  );
  const groupedEntries = GUIDE_CATEGORIES.flatMap((group) => {
    const entries = filteredEntries.filter((entry) => entry.category === group.id);
    return entries.length ? [{ ...group, entries }] : [];
  });
  const hasFilters = !!normalizedQuery || category !== "all";

  return (
    <div className="guide-page">
      <header className="page-header guide-page__header">
        <div className="guide-page__intro">
          <span className="guide-page__eyebrow"><BookOpenTextIcon size={15} /> Training guide</span>
          <h1>Page Watch glossary</h1>
          <p>Plain-language definitions for the terms, statuses, evidence, and workflows used throughout Page Watch.</p>
        </div>
      </header>

      <main className="page-content guide-page__content">
        <section aria-label="Search and filter the glossary" className="guide-toolbar">
          <div className="guide-search">
            <MagnifyingGlassIcon aria-hidden="true" size={17} />
            <label className="sr-only" htmlFor="guide-search">Search the glossary</label>
            <input
              id="guide-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search terms and definitions"
            />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
                <XIcon size={14} />
              </button>
            )}
          </div>
          <div className="guide-filters" aria-label="Filter glossary categories">
            <button
              type="button"
              className={category === "all" ? "is-active" : ""}
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              All
            </button>
            {GUIDE_CATEGORIES.map((item) => (
              <button
                type="button"
                key={item.id}
                className={category === item.id ? "is-active" : ""}
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <div className="guide-results-summary" aria-live="polite">
          {filteredEntries.length} {filteredEntries.length === 1 ? "term" : "terms"}
          {hasFilters ? " found" : " in this guide"}
        </div>

        {groupedEntries.length > 0 ? (
          <div className="guide-sections">
            {groupedEntries.map((group) => (
              <section key={group.id} aria-labelledby={`guide-${group.id}`} className="guide-section">
                <div className="guide-section__heading">
                  <h2 id={`guide-${group.id}`}>{group.label}</h2>
                  <span>{group.entries.length}</span>
                </div>
                <div className="guide-entry-list">
                  {group.entries.map((entry) => (
                    <details key={entry.id} id={entry.id} className="guide-entry">
                      <summary>
                        <span className="guide-entry__summary">
                          <strong>{entry.term}</strong>
                          <span>{entry.shortDefinition}</span>
                        </span>
                        <span className="guide-entry__toggle" aria-hidden="true">
                          <span>Details</span>
                          <CaretDownIcon size={15} />
                        </span>
                      </summary>
                      <div className="guide-entry__details">
                        <div>
                          <h3>In Page Watch</h3>
                          <p>{entry.appMeaning}</p>
                        </div>
                        {entry.action && (
                          <div>
                            <h3>What to do</h3>
                            <p>{entry.action}</p>
                          </div>
                        )}
                        {!!entry.related?.length && (
                          <div>
                            <h3>Related terms</h3>
                            <p>{entry.related.join(" · ")}</p>
                          </div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <section className="guide-empty">
            <BookOpenTextIcon size={24} color={C.muted} />
            <h2>No matching terms</h2>
            <p>Try a different search or view all glossary categories.</p>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
            >
              Clear filters
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
