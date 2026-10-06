// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeshInspectorHandle, MeshInspectorNode } from "../diagnostics/createMeshInspector";
import { MeshInspectorPanel } from "./MeshInspectorPanel";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const leaf = (id: number, name: string, selected = true): MeshInspectorNode => ({
  id, name, mesh: true, selected, mixed: false, children: [],
});
const tree = (selected = true): readonly MeshInspectorNode[] => [{
  id: 1,
  name: "Model",
  mesh: false,
  selected,
  mixed: false,
  children: [leaf(2, "Body", selected), {
    id: 3, name: "Moving parts", mesh: false, selected, mixed: false,
    children: [leaf(4, "Left panel", selected), leaf(5, "Right panel", selected)],
  }],
}];

function makeInspector() {
  let snapshot: ReturnType<MeshInspectorHandle["getSnapshot"]> = { roots: tree(), enabled: true, error: null };
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn((listener: () => void) => { listeners.delete(listener); });
  const inspector: MeshInspectorHandle = {
    getSnapshot: vi.fn(() => snapshot),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => unsubscribe(listener);
    }),
    setSelected: vi.fn(),
    selectAll: vi.fn(),
    setEnabled: vi.fn(),
    setRoots: vi.fn(),
    dispose: vi.fn(),
  };
  const publish = (next: Partial<typeof snapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  return { inspector, publish, unsubscribe };
}

const checkbox = (id: number) => host.querySelector<HTMLInputElement>(`li[data-mesh-id="${id}"] input`)!;
const details = (id: number) => host.querySelector<HTMLDetailsElement>(`li[data-mesh-id="${id}"] details`)!;
const button = (label: string) => Array.from(host.querySelectorAll("button")).find((item) => item.textContent === label)!;

async function toggle(id: number): Promise<void> {
  await act(async () => {
    const element = details(id);
    element.open = !element.open;
    element.dispatchEvent(new Event("toggle"));
  });
}

describe("MeshInspectorPanel", () => {
  it("unfolds single-child transform wrappers to the first parts without opening their branches", async () => {
    const { inspector, publish } = makeInspector();
    const parts = tree()[0];
    const geometricParent = { ...leaf(7, "Hinge"), children: [leaf(8, "Hinge detail")] };
    const wrapper = (id: number, child: MeshInspectorNode): MeshInspectorNode => ({
      id, name: `Wrapper ${id}`, mesh: false, selected: true, mixed: false, children: [child],
    });
    publish({ roots: [wrapper(10, wrapper(11, { ...parts, children: [...parts.children, geometricParent] }))] });
    await act(async () => root.render(<MeshInspectorPanel inspector={inspector} />));

    expect(details(10).open).toBe(true);
    expect(details(11).open).toBe(true);
    expect(details(1).open).toBe(true);
    expect(checkbox(2).labels?.[0].textContent).toBe("Body");
    expect(details(3).open).toBe(false);
    expect(details(7).open).toBe(false);
    expect(host.querySelector('li[data-mesh-id="8"]')).toBeNull();

    await act(async () => publish({ roots: [wrapper(12, geometricParent)] }));
    expect(details(12).open).toBe(true);
    expect(details(7).open).toBe(false);
    expect(host.querySelector('li[data-mesh-id="8"]')).toBeNull();
  });

  it("uses native labeled selection controls and defers collapsed descendants", async () => {
    const { inspector } = makeInspector();
    await act(async () => root.render(<MeshInspectorPanel inspector={inspector} />));

    expect(details(1).open).toBe(true);
    expect(details(3).open).toBe(false);
    expect(host.querySelector('li[data-mesh-id="4"]')).toBeNull();
    expect(details(3).firstElementChild?.tagName).toBe("SUMMARY");
    expect(checkbox(3).labels?.[0].textContent).toBe("Moving partsgroup");
    expect(checkbox(3).checked).toBe(true);
    expect(checkbox(3).tabIndex).toBe(0);

    await toggle(3);
    expect(checkbox(4).labels?.[0].textContent).toBe("Left panel");
    expect(checkbox(5).checked).toBe(true);
    await act(async () => checkbox(3).click());
    expect(inspector.setSelected).toHaveBeenCalledWith(3, false);
    expect(details(3).open).toBe(true);
    expect(host.textContent).toContain("Selection does not hide geometry.");
  });

  it("sends all/none and group selection to the controller and reflects mixed selection", async () => {
    const { inspector, publish } = makeInspector();
    await act(async () => root.render(<MeshInspectorPanel inspector={inspector} />));

    await act(async () => button("Deselect all").click());
    expect(inspector.selectAll).toHaveBeenLastCalledWith(false);
    await act(async () => publish({ roots: tree(false) }));
    expect(checkbox(1).checked).toBe(false);
    expect(checkbox(2).checked).toBe(false);
    await act(async () => button("Select all").click());
    expect(inspector.selectAll).toHaveBeenLastCalledWith(true);
    await act(async () => publish({ roots: tree() }));
    expect(checkbox(1).checked).toBe(true);

    const roots = tree();
    await act(async () => publish({ roots: [{ ...roots[0], selected: false, mixed: true, children: [leaf(2, "Body", false), roots[0].children[1]] }] }));
    expect(checkbox(1).indeterminate).toBe(true);
    expect(checkbox(1).getAttribute("aria-checked")).toBe("mixed");
    await act(async () => checkbox(1).click());
    expect(inspector.setSelected).toHaveBeenLastCalledWith(1, true);
    await act(async () => publish({ roots: tree() }));
    expect(checkbox(1).indeterminate).toBe(false);
    expect(checkbox(1).checked).toBe(true);
  });

  it("preserves expansion through selections and parent closure, then resets for a new model", async () => {
    const { inspector, publish } = makeInspector();
    await act(async () => root.render(<MeshInspectorPanel inspector={inspector} />));
    await toggle(3);
    await act(async () => publish({ roots: tree(false) }));
    expect(details(3).open).toBe(true);
    await toggle(1);
    expect(host.querySelector('li[data-mesh-id="3"]')).toBeNull();
    await toggle(1);
    expect(details(3).open).toBe(true);
    expect(checkbox(4).checked).toBe(false);

    await act(async () => publish({ roots: [{ ...tree()[0], id: 6 }] }));
    expect(details(6).open).toBe(true);
    expect(details(3).open).toBe(false);
    expect(host.querySelector('li[data-mesh-id="4"]')).toBeNull();
  });

  it("uses subscription updates while disabled, shows errors and unsubscribes on detach", async () => {
    const { inspector, publish, unsubscribe } = makeInspector();
    await act(async () => root.render(<MeshInspectorPanel inspector={inspector} />));
    expect(inspector.subscribe).toHaveBeenCalledOnce();
    const snapshotReads = vi.mocked(inspector.getSnapshot).mock.calls.length;
    await act(async () => root.render(<MeshInspectorPanel inspector={inspector} />));
    expect(vi.mocked(inspector.getSnapshot).mock.calls.length).toBe(snapshotReads);
    await act(async () => publish({ enabled: false, error: "Polygon edges could not be prepared." }));
    expect(host.textContent).toContain("Enable polygon edges to show the selection.");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Polygon edges could not be prepared.");
    expect(checkbox(2).disabled).toBe(false);
    expect(inspector.subscribe).toHaveBeenCalledOnce();

    await act(async () => root.render(<MeshInspectorPanel inspector={null} />));
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("No meshes loaded.");
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector("input")).toBeNull();
  });
});
