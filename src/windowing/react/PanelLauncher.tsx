import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEscapeToClose } from "./useEscapeToClose";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

export interface PanelLauncherClassNames {
  root?: string;
  button?: string;
  menu?: string;
  menuAlignLeft?: string;
  menuAlignRight?: string;
  menuItem?: string;
  menuEmpty?: string;
}

export interface PanelLauncherStrings {
  allTabsOpenText?: string;
}

export interface PanelLauncherProps<TabId extends string> {
  open: boolean;
  side?: "left" | "right";
  availableTabs: readonly TabId[];
  onOpenChange: (open: boolean) => void;
  onOpenTab: (tabId: TabId) => void;
  onMoveTab?: (tabId: TabId) => void;
  dropWidth?: number;
  dropMaxWidth?: number;
  dropHeight?: number;
  getLabel: (tabId: TabId) => string;
  classNames?: PanelLauncherClassNames;
  strings?: PanelLauncherStrings;
  renderButtonContent?: ReactNode;
  buttonAriaLabel?: string;
  buttonTitle?: string;
}

export function PanelLauncher<TabId extends string>(props: PanelLauncherProps<TabId>) {
  const {
    open,
    side = "left",
    availableTabs,
    onOpenChange,
    onOpenTab,
    onMoveTab,
    dropWidth,
    dropMaxWidth,
    dropHeight,
    getLabel,
    classNames,
    strings,
    renderButtonContent,
    buttonAriaLabel = "Open panel tab",
    buttonTitle = "Open panel tab",
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!onMoveTab) return;

    const handleDragStart = (event: Event) => {
      const sourceSide = (event as CustomEvent<{ side?: "left" | "right" }>).detail?.side;
      if (sourceSide !== side) setDragActive(true);
    };
    const handleDragEnd = () => {
      dragDepthRef.current = 0;
      setDragActive(false);
    };

    window.addEventListener("foss-earth-tab-drag-start", handleDragStart);
    window.addEventListener("foss-earth-tab-drag-end", handleDragEnd);
    return () => {
      window.removeEventListener("foss-earth-tab-drag-start", handleDragStart);
      window.removeEventListener("foss-earth-tab-drag-end", handleDragEnd);
    };
  }, [onMoveTab, side]);

  useEffect(() => {
    if (!open) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [onOpenChange, open]);
  useEscapeToClose(open, () => onOpenChange(false), () => buttonRef.current);

  const alignClassName = side === "right"
    ? (classNames?.menuAlignRight ?? "foss-earth-window-menu-align-right")
    : (classNames?.menuAlignLeft ?? "foss-earth-window-menu-align-left");

  const dropStyle: CSSProperties | undefined = dragActive
    ? {
        width: dropWidth,
        maxWidth: dropMaxWidth,
        height: dropHeight,
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      className={cx(
        "foss-earth-panel-launcher",
        dragActive && "foss-earth-panel-launcher-drop-active",
        classNames?.root,
      )}
      style={dropStyle}
      onDragEnter={onMoveTab ? () => {
        dragDepthRef.current += 1;
        setDragActive(true);
      } : undefined}
      onDragLeave={onMoveTab ? () => {
        dragDepthRef.current -= 1;
        if (dragDepthRef.current <= 0) {
          dragDepthRef.current = 0;
          setDragActive(false);
        }
      } : undefined}
      onDragOver={onMoveTab ? (event) => event.preventDefault() : undefined}
      onDrop={onMoveTab ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragDepthRef.current = 0;
        setDragActive(false);
        window.dispatchEvent(new Event("foss-earth-tab-drag-end"));
        const tabId = event.dataTransfer.getData("text/plain") as TabId;
        if (tabId) onMoveTab(tabId);
      } : undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        className={cx("foss-earth-panel-launcher-button", classNames?.button)}
        aria-label={buttonAriaLabel}
        title={buttonTitle}
      >
        {renderButtonContent ?? "+"}
      </button>

      {open ? (
        <div
          role="menu"
          className={cx("foss-earth-window-menu", classNames?.menu, alignClassName)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {availableTabs.length === 0 ? (
            <div className={cx("foss-earth-window-menu-empty", classNames?.menuEmpty)}>
              {strings?.allTabsOpenText ?? "All tabs open"}
            </div>
          ) : (
            availableTabs.map((tabId) => (
              <button
                key={tabId}
                type="button"
                role="menuitem"
                className={cx("foss-earth-window-menu-item", classNames?.menuItem)}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenTab(tabId);
                  onOpenChange(false);
                }}
              >
                {getLabel(tabId)}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
