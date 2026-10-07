/**
 * Fitting a + menu between its button and whatever lies along the window's
 * bottom edge. A menu too tall for that space takes further columns instead
 * of running on: an item out of sight under a toolbar reads as an item that
 * is not there, as About did on 2026-10-07, last in a menu that ran under the
 * map source chip.
 */

/** Keeps a menu this far inside the window's edges, and above what a host draws along the bottom one. */
export const MENU_EDGE_PX = 8;

/**
 * Where a menu must end, as a y in the window: `limit`, the top of what a host
 * draws over the window's bottom edge, such as its toolbar, where it gives
 * one; else the window's own edge.
 */
export function menuBottom(limit?: () => number | null | undefined): number {
  const edge = window.innerHeight - MENU_EDGE_PX;
  const given = limit?.();
  return typeof given === "number" && Number.isFinite(given) ? Math.min(edge, given - MENU_EDGE_PX) : edge;
}

/** The grid a menu takes to fit between `top` and `bottom`: as many rows as fit, then further columns. */
export interface MenuColumns {
  gridTemplateRows: string;
  gridAutoFlow: "column";
}

/**
 * The columns `menu` needs to show every item between `top` and `bottom`, or
 * null where one column fits, or where nothing can be measured yet.
 */
export function menuColumns(menu: HTMLElement, top: number, bottom: number): MenuColumns | null {
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  // The tallest item's height: every row of the grid is as tall as its tallest.
  const itemHeight = Math.max(0, ...items.map(item => item.getBoundingClientRect().height || item.offsetHeight));
  if (items.length < 2 || itemHeight <= 0) return null;
  const style = getComputedStyle(menu);
  const px = (value: string): number => Number.parseFloat(value) || 0;
  const frame = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  const gap = px(style.rowGap);
  const rows = Math.max(1, Math.floor((bottom - top - frame + gap) / (itemHeight + gap)));
  return items.length > rows ? { gridTemplateRows: `repeat(${rows}, auto)`, gridAutoFlow: "column" } : null;
}

/**
 * Lays `menu` out to fit from `top` down to `bottom`, before its width is
 * read: more columns are wider. Returns the styles that keep it so.
 */
export function fitMenu(menu: HTMLElement, top: number, bottom: number): { maxHeight: number; maxWidth: number; overflow: "auto"; boxSizing: "border-box" } & Partial<MenuColumns> {
  const columns = menuColumns(menu, top, bottom);
  menu.style.gridTemplateRows = columns?.gridTemplateRows ?? "";
  menu.style.gridAutoFlow = columns?.gridAutoFlow ?? "";
  // A window too small for every column scrolls the rest, rather than losing it.
  return { maxHeight: Math.max(0, bottom - top), maxWidth: Math.max(0, window.innerWidth - 2 * MENU_EDGE_PX), overflow: "auto", boxSizing: "border-box", ...(columns ?? {}) };
}
