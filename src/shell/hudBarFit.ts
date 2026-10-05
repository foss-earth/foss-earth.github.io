export interface HudBarFitItem {
  element: HTMLElement;
  /** Lower numbers get the available space first. */
  priority: number;
  /** Essential controls and items the user explicitly enabled may wrap. */
  keepVisible?: boolean;
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
    for (const item of items) {
      if (!managed.has(item.element)) managed.set(item.element, item.element.style.order);
      item.element.style.order = String(item.priority);
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
    // Keep the first essential control reachable even with a very long credit.
    const essential = available.find(item => item.keepVisible);
    end.style.maxWidth = `${Math.max(0, width - (essential ? widths.get(essential)! + gap : 0))}px`;
    const endWidth = end.getBoundingClientRect().width;
    const fixed = available.filter(item => item.keepVisible);
    let used = endWidth + fixed.reduce((sum, item) => sum + widths.get(item)!, 0);
    let count = fixed.length + (endWidth > 0 ? 1 : 0);
    used += Math.max(0, count - 1) * gap;
    let full = false;
    for (const item of available) {
      let visible = !!item.keepVisible;
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
