"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CaretDown, CaretUp, Check, SpinnerGap } from "@phosphor-icons/react";

export type SelectMenuValue = string | number;

export interface SelectMenuOption<T extends SelectMenuValue> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectMenuProps<T extends SelectMenuValue> {
  value: T;
  options: ReadonlyArray<SelectMenuOption<T>>;
  onChange: (value: T) => void | Promise<void>;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  loading?: boolean;
  menuWidth?: number;
  triggerWidth?: number | string;
}

interface MenuPosition {
  left: number;
  top: number;
  placement: "above" | "below";
}

function valuesMatch<T extends SelectMenuValue>(left: T, right: T) {
  return Object.is(left, right);
}

export function SelectMenu<T extends SelectMenuValue>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled = false,
  loading = false,
  menuWidth = 196,
  triggerWidth,
}: SelectMenuProps<T>) {
  const generatedId = useId().replace(/:/g, "");
  const listboxId = `select-menu-${generatedId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const keyboardInputRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [showFocusRing, setShowFocusRing] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingValue, setPendingValue] = useState<T | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition>({ left: 0, top: 0, placement: "below" });
  const displayValue = pendingValue ?? value;
  const isLoading = loading || pendingValue !== null;
  const selectedIndex = useMemo(
    () => options.findIndex((option) => valuesMatch(option.value, displayValue)),
    [displayValue, options],
  );
  const firstEnabledIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => !option.disabled)),
    [options],
  );
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const triggerStyle = triggerWidth === undefined
    ? undefined
    : ({ width: typeof triggerWidth === "number" ? `${triggerWidth}px` : triggerWidth } satisfies CSSProperties);

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? (options.length * 32) + 12;
    const opensAbove = triggerRect.bottom + 6 + menuHeight > window.innerHeight
      && triggerRect.top >= menuHeight + 6;
    const maximumLeft = Math.max(8, window.innerWidth - menuWidth - 8);
    setMenuPosition({
      left: Math.min(Math.max(8, triggerRect.left), maximumLeft),
      top: opensAbove ? triggerRect.top - menuHeight - 6 : triggerRect.bottom + 6,
      placement: opensAbove ? "above" : "below",
    });
  }, [menuWidth, options.length]);

  const openMenu = useCallback(() => {
    if (disabled || isLoading || options.length === 0) return;
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex);
    setOpen(true);
  }, [disabled, firstEnabledIndex, isLoading, options.length, selectedIndex]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  }, []);

  const commitOption = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    closeMenu(true);
    if (valuesMatch(option.value, value)) return;

    setPendingValue(option.value);
    Promise.resolve(onChange(option.value)).catch(() => {
      setPendingValue(null);
    });
  }, [closeMenu, onChange, options, value]);

  const moveHighlight = useCallback((direction: 1 | -1) => {
    if (options.length === 0) return;
    setHighlightedIndex((current) => {
      let next = current;
      for (let attempt = 0; attempt < options.length; attempt += 1) {
        next = (next + direction + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return current;
    });
  }, [options]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    keyboardInputRef.current = true;
    setShowFocusRing(true);
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commitOption(highlightedIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    } else if (event.key === "Tab") {
      closeMenu();
    }
  }

  useEffect(() => {
    if (pendingValue === null || !valuesMatch(value, pendingValue)) return;

    let settleFrame = 0;
    const renderFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => setPendingValue(null));
    });
    return () => {
      cancelAnimationFrame(renderFrame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
    };
  }, [pendingValue, value]);

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const update = () => updateMenuPosition();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [closeMenu, open]);

  useEffect(() => {
    const markKeyboardInput = () => {
      keyboardInputRef.current = true;
    };
    const markPointerInput = () => {
      keyboardInputRef.current = false;
      setShowFocusRing(false);
    };
    document.addEventListener("keydown", markKeyboardInput, true);
    document.addEventListener("pointerdown", markPointerInput, true);
    return () => {
      document.removeEventListener("keydown", markKeyboardInput, true);
      document.removeEventListener("pointerdown", markPointerInput, true);
    };
  }, []);

  return (
    <div className={`select-menu${className ? ` ${className}` : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`select-menu__trigger${open ? " is-open" : ""}${isLoading ? " is-loading" : ""}${showFocusRing ? " is-keyboard-focused" : ""}`}
        style={triggerStyle}
        aria-label={ariaLabel}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${listboxId}-option-${highlightedIndex}` : undefined}
        aria-busy={isLoading}
        disabled={disabled || isLoading}
        onBlur={() => setShowFocusRing(false)}
        onClick={() => (open ? closeMenu() : openMenu())}
        onFocus={() => setShowFocusRing(keyboardInputRef.current)}
        onKeyDown={handleKeyDown}
        onPointerDown={() => {
          keyboardInputRef.current = false;
          setShowFocusRing(false);
        }}
      >
        <span className="select-menu__label">{selectedOption?.label ?? String(displayValue)}</span>
        {isLoading ? (
          <SpinnerGap className="select-menu__spinner" size={15} weight="bold" aria-hidden="true" />
        ) : open ? (
          <CaretUp className="select-menu__chevron" size={11} weight="bold" aria-hidden="true" />
        ) : (
          <CaretDown className="select-menu__chevron" size={11} weight="bold" aria-hidden="true" />
        )}
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          className="select-menu__popover"
          data-placement={menuPosition.placement}
          aria-label={ariaLabel}
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuWidth }}
        >
          {options.map((option, index) => {
            const selected = valuesMatch(option.value, value);
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={String(option.value)}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                className={`select-menu__option${highlighted ? " is-highlighted" : ""}${selected ? " is-selected" : ""}`}
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setHighlightedIndex(index)}
                onClick={() => commitOption(index)}
              >
                <span>{option.label}</span>
                {selected && <Check size={16} weight="bold" aria-hidden="true" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
