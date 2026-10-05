export interface HudBarFitItem {
  element: HTMLElement;
  /** Lower numbers get the available space first. */
  priority: number;
  /** Essential controls and items the user explicitly enabled may wrap. */
  keepVisible?: boolean;
  /** Always reserve this control's room before credit, even after its priority changes. */
  essential?: boolean;
  /** Shorten credit text to leave room for this item before fitting the row. */
  reserveSpace?: boolean;
  onFit?(visible: boolean): void;
}

/**
 * Fit automatic items into one row before the bar's right end. Overflow items
 * remain measurable, but invisible and outside the flex layout, so a resize or
 * changing readout can bring them back without temporarily showing another row.
 */
export function fitHudBar(bar: HTMLElement, end: HTMLElement, readItems: () => readonly HudBarFitItem[]): { update(): void; destroy(): void } {
  bar.classList.add("hud-bar--fitted");
  let frame: number | null = null;
  let disposed = false;
  const observed = new Set<HTMLElement>();
  const managed = new Map<HTMLElement, string>();
  const originalEndMaxWidth = end.style.maxWidth;
  const schedule = (): void => {
    if (!disposed && frame === null) frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  };
  const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resize?.observe(bar);
  resize?.observe(end);

  function update(): void {
    if (disposed) return;
    const items = [...readItems()].sort((a, b) => a.priority - b.priority);
    const current = new Set(items.map(item => item.element));
    for (const [element, order] of managed) {
      if (current.has(element)) continue;
      element.removeAttribute("data-hud-overflow-hidden");
      element.style.order = order;
      managed.delete(element);
    }
    for (const element of observed) {
      if (current.has(element)) continue;
      resize?.unobserve(element);
      observed.delete(element);
    }
    for (const [index, item] of items.entries()) {
      if (!managed.has(item.element)) managed.set(item.element, item.element.style.order);
      // Ranks preserve the caller's order on ties, even for nested flex items.
      item.element.style.order = String(index);
      if (!observed.has(item.element)) {
        resize?.observe(item.element);
        observed.add(item.element);
      }
    }
    const width = bar.getBoundingClientRect().width;
    // Unmounted tabs and DOM-only tests have no usable geometry yet.
    if (width <= 0) return;
    const gap = Number.parseFloat(getComputedStyle(bar).columnGap) || 0;
    const available = items.filter(item => !item.element.closest("[hidden]"));
    const widths = new Map(available.map(item => [item, item.element.getBoundingClientRect().width]));
    // Leave room for the core controls even when attribution text is long.
    // Manual extras still use their own widths and may wrap after fitting.
    const required = available.filter(item => item.essential);
    // Keep the existing helper contract for callers without an explicit anchor.
    if (required.length === 0) {
      const first = available.find(item => item.keepVisible);
      if (first) required.push(first);
    }
    const requiredSet = new Set(required);
    const reservationWidth = (entries: readonly HudBarFitItem[]): number =>
      entries.reduce((sum, item) => sum + widths.get(item)!, 0) + entries.length * gap;
    let reserved = available.filter(item => item.reserveSpace || requiredSet.has(item));
    let reservedWidth = reservationWidth(reserved);
    // A newly high-ranked wide readout must not consume the credit's entire
    // allocation. Fall back to the mandatory controls and fit the rest normally.
    const reserveRequiredOnly = (): void => {
      reserved = required;
      reservedWidth = reservationWidth(reserved);
    };
    if (reservedWidth >= width) reserveRequiredOnly();
    const measureEnd = (): number => {
      end.style.maxWidth = `${Math.max(0, width - reservedWidth)}px`;
      const measured = end.getBoundingClientRect().width;
      // The detail rail and credit link cannot shrink as much as their text.
      // Count overflowing content; scrollWidth rounds to an integer, so allow
      // its rounding error before treating it as actual overflow.
      return end.scrollWidth > measured + 1 ? end.scrollWidth : measured;
    };
    let endWidth = measureEnd();
    if (endWidth + reservedWidth > width && reserved.some(item => !requiredSet.has(item))) {
      reserveRequiredOnly();
      endWidth = measureEnd();
    }
    // A manual extra may need another row. Keep the core row's controls when
    // they fit beside the credit on their own, rather than spending their
    // budget on the extra and hiding them just because it wraps.
    const reservedFit = endWidth + reservedWidth <= width;
    const reservedSet = new Set(reserved);
    const fixed = available.filter(item => item.keepVisible || item.essential || (reservedSet.has(item) && reservedFit));
    const alwaysVisible = new Set(fixed);
    let used = endWidth + fixed.reduce((sum, item) => sum + widths.get(item)!, 0);
    let count = fixed.length + (endWidth > 0 ? 1 : 0);
    used += Math.max(0, count - 1) * gap;
    let full = false;
    for (const item of available) {
      let visible = alwaysVisible.has(item);
      if (!visible && !full) {
        const next = used + widths.get(item)! + (count > 0 ? gap : 0);
        visible = next <= width;
        if (visible) { used = next; count++; }
        else full = true;
      }
      item.element.toggleAttribute("data-hud-overflow-hidden", !visible);
      item.onFit?.(visible);
    }
  }

  const mutations = new MutationObserver(schedule);
  mutations.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("resize", schedule);
  update();
  return {
    update: schedule,
    destroy() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      for (const [element, order] of managed) {
        element.removeAttribute("data-hud-overflow-hidden");
        element.style.order = order;
      }
      end.style.maxWidth = originalEndMaxWidth;
      bar.classList.remove("hud-bar--fitted");
    },
  };
}
