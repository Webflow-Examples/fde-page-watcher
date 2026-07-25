"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
} from "react";

export type SegmentedControlValue = string | number;

export interface SegmentedControlOption<T extends SegmentedControlValue> {
  value: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  title?: string;
  tone?: string;
  selectedBackground?: string;
}

export interface StatusSegmentedControlOption<T extends SegmentedControlValue>
  extends SegmentedControlOption<T> {
  count: number;
  showDot?: boolean;
  shape?: "circle" | "triangle" | "square";
}

interface SharedProps<T extends SegmentedControlValue> {
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

function valuesMatch<T extends SegmentedControlValue>(left: T, right: T) {
  return Object.is(left, right);
}

function nextEnabledIndex<T extends SegmentedControlValue>(
  options: ReadonlyArray<SegmentedControlOption<T>>,
  current: number,
  direction: 1 | -1,
) {
  let next = current;
  for (let attempt = 0; attempt < options.length; attempt += 1) {
    next = (next + direction + options.length) % options.length;
    if (!options[next]?.disabled) return next;
  }
  return current;
}

function useKeyboardModality() {
  const [keyboardModality, setKeyboardModality] = useState(false);

  useEffect(() => {
    const handleKeyDown = () => setKeyboardModality(true);
    const handlePointerDown = () => setKeyboardModality(false);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  return keyboardModality;
}

function useRovingSelection<T extends SegmentedControlValue>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => valuesMatch(option.value, value)));
  const [tabIndex, setTabIndex] = useState(selectedIndex);
  const effectiveTabIndex = options[tabIndex] && !options[tabIndex].disabled
    ? tabIndex
    : selectedIndex;

  const selectIndex = useCallback((index: number, focus = false) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setTabIndex(index);
    onChange(option.value);
    if (focus) requestAnimationFrame(() => buttonRefs.current[index]?.focus());
  }, [onChange, options]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = nextEnabledIndex(options, index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = nextEnabledIndex(options, index, -1);
    } else if (event.key === "Home") {
      next = options.findIndex((option) => !option.disabled);
    } else if (event.key === "End") {
      next = options.findLastIndex((option) => !option.disabled);
    } else {
      return;
    }

    event.preventDefault();
    if (next >= 0) selectIndex(next, true);
  }, [options, selectIndex]);

  return {
    buttonRefs,
    selectedIndex,
    tabIndex: effectiveTabIndex,
    setTabIndex,
    selectIndex,
    handleKeyDown,
  };
}

/** Neutral two-or-more-option control used for device and view choices. */
export function SegmentedControl<T extends SegmentedControlValue>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: SharedProps<T> & {
  options: ReadonlyArray<SegmentedControlOption<T>>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 3, width: 0, ready: false });
  const roving = useRovingSelection({ value, options, onChange });
  const keyboardModality = useKeyboardModality();
  const selectedOption = options[roving.selectedIndex];
  const optionKey = options
    .map((option) => `${option.value}:${option.disabled ? "disabled" : "enabled"}`)
    .join("|");

  useLayoutEffect(() => {
    const updateIndicator = () => {
      const root = rootRef.current;
      const button = roving.buttonRefs.current[roving.selectedIndex];
      if (!root || !button) return;
      const rootRect = root.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const nextIndicator = {
        left: buttonRect.left - rootRect.left,
        width: buttonRect.width,
        ready: true,
      };
      setIndicator((current) =>
        current.ready === nextIndicator.ready
        && Math.abs(current.left - nextIndicator.left) < 0.25
        && Math.abs(current.width - nextIndicator.width) < 0.25
          ? current
          : nextIndicator,
      );
    };
    updateIndicator();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateIndicator);
    observer.observe(root);
    return () => observer.disconnect();
  }, [optionKey, roving.buttonRefs, roving.selectedIndex]);

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={ariaLabel}
      className={`segmented-control segmented-control--device${keyboardModality ? " is-keyboard-modality" : ""}${className ? ` ${className}` : ""}`}
      style={{
        "--segment-tone": selectedOption?.tone ?? "#ffffff",
        "--segment-selected-bg": selectedOption?.selectedBackground ?? "#22222b",
      } as CSSProperties}
    >
      <span
        aria-hidden="true"
        className={`segmented-control__indicator${indicator.ready ? " is-ready" : ""}`}
        style={{
          width: indicator.width,
          transform: `translateX(${indicator.left}px)`,
        }}
      />
      {options.map((option, index) => {
        const selected = valuesMatch(option.value, value);
        return (
          <button
            key={option.value}
            ref={(node) => {
              roving.buttonRefs.current[index] = node;
            }}
            type="button"
            className={`segmented-control__option${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            disabled={option.disabled}
            title={option.title}
            tabIndex={roving.tabIndex === index ? 0 : -1}
            onClick={() => roving.selectIndex(index)}
            onFocus={() => roving.setTabIndex(index)}
            onKeyDown={(event) => roving.handleKeyDown(event, index)}
          >
            {option.icon && <span className="segmented-control__icon" aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export const DeviceSegmentedControl = SegmentedControl;

/** Counted status filter with hue reserved exclusively for selected state. */
export function StatusSegmentedControl<T extends SegmentedControlValue>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  loading = false,
}: SharedProps<T> & {
  options: ReadonlyArray<StatusSegmentedControlOption<T>>;
  loading?: boolean;
}) {
  const measureRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [widths, setWidths] = useState<number[]>([]);
  const roving = useRovingSelection({ value, options, onChange });
  const keyboardModality = useKeyboardModality();
  const measurementKey = useMemo(
    () => options.map((option) => `${option.value}:${option.label}:${String(option.count).length}:${option.showDot !== false}:${option.shape ?? "circle"}`).join("|"),
    [options],
  );

  useLayoutEffect(() => {
    const measured = measureRefs.current.map((node) =>
      node ? Math.ceil(node.getBoundingClientRect().width) + 24 : 0);
    setWidths((current) => (
      measured.length === current.length
      && measured.every((width, index) => width === current[index])
        ? current
        : measured
    ));
  }, [measurementKey]);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-busy={loading}
      className={`segmented-control segmented-control--status${keyboardModality ? " is-keyboard-modality" : ""}${className ? ` ${className}` : ""}`}
    >
      {options.map((option, index) => {
        const selected = valuesMatch(option.value, value);
        const empty = !!option.disabled;
        const showDot = option.showDot !== false && !empty;
        const shape = option.shape ?? "circle";
        const showCount = !empty;
        const style = {
          width: widths[index] || undefined,
          "--segment-tone": option.tone ?? "#e9e9ee",
          "--segment-selected-bg": option.selectedBackground ?? "#22222b",
        } as CSSProperties;
        const label = empty
          ? `${option.label}, no results`
          : `${option.label}, ${option.count}`;

        return (
          <button
            key={option.value}
            ref={(node) => {
              roving.buttonRefs.current[index] = node;
            }}
            type="button"
            className={`segmented-control__option${selected ? " is-selected" : ""}${empty ? " is-empty" : ""}`}
            style={style}
            aria-label={label}
            aria-pressed={selected}
            aria-busy={loading && showCount}
            disabled={empty}
            title={option.title}
            tabIndex={!empty && roving.tabIndex === index ? 0 : -1}
            onClick={() => roving.selectIndex(index)}
            onFocus={() => roving.setTabIndex(index)}
            onKeyDown={(event) => roving.handleKeyDown(event, index)}
          >
            {showDot && <span className={`segmented-control__dot segmented-control__dot--${shape}`} aria-hidden="true" />}
            <span className="segmented-control__label">{option.label}</span>
            {showCount && (
              loading ? (
                <span className="segmented-control__count-skeleton" aria-hidden="true" />
              ) : (
                <strong className="segmented-control__count">{option.count}</strong>
              )
            )}
            <span
              ref={(node) => {
                measureRefs.current[index] = node;
              }}
              className="segmented-control__measure"
              aria-hidden="true"
            >
              {option.showDot !== false && <span className={`segmented-control__dot segmented-control__dot--${shape}`} />}
              <span>{option.label}</span>
              <strong>{option.count || 8}</strong>
            </span>
          </button>
        );
      })}
    </div>
  );
}
