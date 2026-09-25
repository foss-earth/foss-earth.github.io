import { useLayoutEffect, useRef } from "react";

/**
 * Moves a node the host already built and wired into this spot, and lets it go
 * again when the tab closes. Its listeners and state travel with it, so closing
 * and reopening the tab loses nothing.
 */
export function AdoptedElement({ element, className }: { element: HTMLElement; className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.append(element);
    return () => element.remove();
  }, [element]);
  return <div ref={hostRef} className={className} />;
}
