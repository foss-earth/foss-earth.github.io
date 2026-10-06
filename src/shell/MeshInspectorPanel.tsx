import { memo, useCallback, useRef, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { MeshInspectorHandle, MeshInspectorNode } from "../diagnostics/createMeshInspector";
import "./meshInspector.css";

export interface MeshInspectorPanelProps {
  inspector: MeshInspectorHandle | null;
}

const emptySnapshot: ReturnType<MeshInspectorHandle["getSnapshot"]> = {
  roots: [],
  enabled: false,
  error: null,
};
const unsubscribeEmpty = () => {};

function MeshSelection({ node, inspector }: { node: MeshInspectorNode; inspector: MeshInspectorHandle }) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (input.current) input.current.indeterminate = node.mixed;
  }, [node.mixed]);
  return (
    <label className="settings-checkbox foss-earth-mesh-inspector__selection" onClick={(event) => event.stopPropagation()}>
      <input
        ref={input}
        type="checkbox"
        checked={node.selected}
        aria-checked={node.mixed ? "mixed" : node.selected}
        onChange={(event) => inspector.setSelected(node.id, event.currentTarget.checked)}
      />
      <span className="foss-earth-mesh-inspector__name">{node.name}</span>
      {!node.mesh && <span className="foss-earth-mesh-inspector__kind" aria-hidden="true">group</span>}
    </label>
  );
}

function MeshTree({ roots, inspector }: { roots: readonly MeshInspectorNode[]; inspector: MeshInspectorHandle }) {
  // Keep descendants' expansion state when their parent closes. Transform roots
  // and unary wrappers unfold to the first useful level of model parts.
  const [expanded, setExpanded] = useState(() => {
    const initial = new Set<number>();
    for (const root of roots) {
      let node = root;
      while (!node.mesh && node.children.length > 0) {
        initial.add(node.id);
        if (node.children.length !== 1) break;
        node = node.children[0];
      }
    }
    return initial;
  });
  const setOpen = (id: number, open: boolean) => {
    setExpanded((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const renderNodes = (nodes: readonly MeshInspectorNode[]) => (
    <ul className="foss-earth-mesh-inspector__tree" role="list">
      {nodes.map((node) => (
        <li key={node.id} data-mesh-id={node.id}>
          {node.children.length > 0 ? (
            <details open={expanded.has(node.id)} onToggle={(event) => setOpen(node.id, event.currentTarget.open)}>
              <summary><MeshSelection node={node} inspector={inspector} /></summary>
              {expanded.has(node.id) && renderNodes(node.children)}
            </details>
          ) : (
            <div className="foss-earth-mesh-inspector__leaf"><MeshSelection node={node} inspector={inspector} /></div>
          )}
        </li>
      ))}
    </ul>
  );
  return renderNodes(roots);
}

/** An event-driven mesh hierarchy; selecting changes highlighting, never visibility. */
export const MeshInspectorPanel = memo(function MeshInspectorPanel({ inspector }: MeshInspectorPanelProps) {
  const subscribe = useCallback((listener: () => void) => inspector?.subscribe(listener) ?? unsubscribeEmpty, [inspector]);
  const getSnapshot = useCallback(() => inspector?.getSnapshot() ?? emptySnapshot, [inspector]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <div className="foss-earth-mesh-inspector" role="group" aria-label="Mesh selection">
      <p>Select meshes to highlight their polygon edges. Groups include their descendants. Selection does not hide geometry.</p>
      {snapshot.error && <p role="alert">{snapshot.error}</p>}
      {inspector && snapshot.roots.length > 0 ? <>
        <div className="foss-earth-mesh-inspector__actions">
          <button type="button" onClick={() => inspector.selectAll(true)}>Select all</button>
          <button type="button" onClick={() => inspector.selectAll(false)}>Deselect all</button>
        </div>
        {!snapshot.enabled && <p className="foss-earth-mesh-inspector__note">Enable polygon edges to show the selection.</p>}
        <MeshTree key={snapshot.roots.map((node) => node.id).join(",")} roots={snapshot.roots} inspector={inspector} />
      </> : <p>No meshes loaded.</p>}
    </div>
  );
});
