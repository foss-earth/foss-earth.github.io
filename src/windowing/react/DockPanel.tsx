import { useEffect, useRef, useState, type CSSProperties, type DragEventHandler, type ReactNode } from "react";

function cx(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(" ");
}

interface ResizeDragState {
  startX: number;
  startY: number;
  startW: number;
  startH: number;
  pointerId: number;
  moved: boolean;
}

export interface DockPanelClassNames {
  container?: string;
  expanded?: string;
  collapsed?: string;
  raisedZ?: string;
  defaultZ?: string;
  header?: string;
  headerExpanded?: string;
  headerCollapsed?: string;
  body?: string;
  resizeHandle?: string;
  resizeHandleForLeftPanel?: string;
  resizeHandleForRightPanel?: string;
  resizeDots?: string;
}

export interface DockPanelProps {
  side: "left" | "right";
  width: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  addMenuOpen?: boolean;
  header?: ReactNode;
  children?: ReactNode;
  classNames?: DockPanelClassNames;
  topOffsetPx?: number;
  edgeOffsetPx?: number;
  expandedMaxHeightCss?: string;
  minWidth?: number;
  minHeight?: number;
  initialHeight?: number;
  maxHeightPaddingPx?: number;
  resizeClickThresholdPx?: number;
  resizeAriaLabel?: string;
  resizeTitle?: string;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
}

export function DockPanel(props: DockPanelProps) {
  const {
    side,
    width,
    maxWidth,
    onWidthChange,
    collapsed,
    onCollapsedChange,
    addMenuOpen = false,
    header,
    children,
    classNames,
    topOffsetPx,
    edgeOffsetPx = 12,
    expandedMaxHeightCss,
    minWidth = 160,
    minHeight = 128,
    initialHeight = 512,
    maxHeightPaddingPx = 80,
    resizeClickThresholdPx = 6,
    resizeAriaLabel = "Resize panel, click to minimize",
    resizeTitle = "Drag to resize, click to minimize",
    onDragOver,
    onDrop,
  } = props;

  const isRightPanel = side === "right";
  const resolvedTop = topOffsetPx ?? 12;
  const resolvedMaxHeight = expandedMaxHeightCss ?? "calc(100vh - 1.5rem)";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<ResizeDragState | null>(null);
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    const handleDragStart = (event: Event) => {
      const sourceSide = (event as CustomEvent<{ side?: "left" | "right" }>).detail?.side;
      setDragActive(sourceSide !== side);
    };
    const handleDragEnd = () => setDragActive(false);

    window.addEventListener("foss-earth-tab-drag-start", handleDragStart);
    window.addEventListener("foss-earth-tab-drag-end", handleDragEnd);
    return () => {
      window.removeEventListener("foss-earth-tab-drag-start", handleDragStart);
      window.removeEventListener("foss-earth-tab-drag-end", handleDragEnd);
    };
  }, [side]);

  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const panelElement = containerRef.current;
    if (!panelElement) return;

    const rect = panelElement.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startW: rect.width,
      startH: rect.height,
      pointerId: event.pointerId,
      moved: false,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (
      Math.abs(event.clientX - drag.startX) > resizeClickThresholdPx
      || Math.abs(event.clientY - drag.startY) > resizeClickThresholdPx
    ) {
      drag.moved = true;
    }

    const maxW = Math.max(minWidth, maxWidth);
    const maxH = Math.max(minHeight, window.innerHeight - maxHeightPaddingPx);
    const deltaX = event.clientX - drag.startX;
    const rawW = drag.startW + (isRightPanel ? -deltaX : deltaX);

    if (rawW < minWidth) {
      onCollapsedChange(true);
      dragRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }

    const nextW = Math.min(maxW, rawW);
    const nextH = Math.max(minHeight, Math.min(maxH, drag.startH + (event.clientY - drag.startY)));

    onWidthChange(nextW);
    setPanelHeight(nextH);
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (!drag.moved) {
      onCollapsedChange(true);
    }

    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const positionStyle: CSSProperties = {
    position: "absolute",
    top: resolvedTop,
    ...(isRightPanel ? { right: edgeOffsetPx } : { left: edgeOffsetPx }),
  };

  const expandedStyle: CSSProperties = collapsed
    ? { maxWidth: width }
    : {
        width,
        height: panelHeight,
        maxWidth,
        maxHeight: resolvedMaxHeight,
      };

  return (
    <div
      ref={containerRef}
      className={cx(
        "foss-earth-dock-panel",
        dragActive && "foss-earth-dock-panel-drop-active",
        classNames?.container,
        addMenuOpen ? classNames?.raisedZ : classNames?.defaultZ,
        collapsed ? classNames?.collapsed : classNames?.expanded,
      )}
      style={{
        ...positionStyle,
        ...expandedStyle,
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-side={side}
      data-collapsed={collapsed ? "true" : "false"}
    >
      {header ? (
        <div
          className={cx(
            "foss-earth-dock-panel-header",
            classNames?.header,
            collapsed ? classNames?.headerCollapsed : classNames?.headerExpanded,
          )}
        >
          {header}
        </div>
      ) : null}

      {collapsed ? null : (
        <>
          <div className={cx("foss-earth-dock-panel-body", classNames?.body)}>
            {children}
          </div>
          <div
            role="separator"
            aria-label={resizeAriaLabel}
            title={resizeTitle}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            className={cx(
              "foss-earth-dock-panel-resize-handle",
              classNames?.resizeHandle,
              isRightPanel ? classNames?.resizeHandleForRightPanel : classNames?.resizeHandleForLeftPanel,
            )}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 10 10"
              className={cx("foss-earth-dock-panel-resize-dots", classNames?.resizeDots)}
              fill="currentColor"
            >
              {isRightPanel ? (
                <>
                  <circle cx="2" cy="8" r="1.2" />
                  <circle cx="5" cy="8" r="1.2" />
                  <circle cx="2" cy="5" r="1.2" />
                </>
              ) : (
                <>
                  <circle cx="8" cy="8" r="1.2" />
                  <circle cx="5" cy="8" r="1.2" />
                  <circle cx="8" cy="5" r="1.2" />
                </>
              )}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
