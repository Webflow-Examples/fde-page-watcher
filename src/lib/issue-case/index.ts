/**
 * The canonical issue case, split by concern.
 *
 * `core` holds the object, its parsers, and the transition table. `migration`
 * adapts the retired lifecycles, `grouping` folds cases by cause and
 * remediation, and `applicability` owns per-page inclusion. Callers keep
 * importing from `@/lib/issue-case`; the module boundary is this directory.
 */
export * from "./core";
export * from "./migration";
export * from "./grouping";
export * from "./applicability";
