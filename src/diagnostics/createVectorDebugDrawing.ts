import {
  Color3, Constants, DynamicTexture, Material, Mesh, MeshBuilder, Quaternion, StandardMaterial,
  Texture, TransformNode, Vector3, type Scene,
} from "@babylonjs/core";
import { whenMeshesReady } from "../engine/babylon/sceneUpdates";

export interface DebugVector {
  id: string;
  label: string;
  color: string;
  /** Both vector and anchor are in the supplied parent's local coordinate system. */
  vector: readonly [number, number, number];
  anchor: readonly [number, number, number];
}

export interface VectorDebugDrawingSettings {
  enabled: boolean;
  /** Scalar data units represented by one metre of arrow. */
  valuePerMeter: number;
  maxArrowMeters: number;
  labels: boolean;
  labelRefreshHz: number;
}

export interface VectorDebugDrawingOptions {
  settings: VectorDebugDrawingSettings;
  /** Unit conversion for label values; geometry uses the unscaled input vector. */
  valueDisplayScale: number;
  valueUnit: string;
  requestRender?(): void;
  onError?(message: string): void;
  whenReady?(meshes: readonly Mesh[], signal: AbortSignal): Promise<void>;
}

interface VectorGlyph {
  root: TransformNode;
  shaft: Mesh;
  head: Mesh;
  label: Mesh | null;
  labelAnchor: TransformNode | null;
  texture: DynamicTexture | null;
  key: string;
  text: string;
  labelTime: number;
  color: string;
  labelText: string;
}

/** World-space vector glyphs in parent-local coordinates, independent of any domain model. */
export function createVectorDebugDrawing(scene: Scene, parent: TransformNode, options: VectorDebugDrawingOptions) {
  let settings = options.settings;
  let disposed = false;
  let root: TransformNode | null = null;
  let prepared = false;
  let preparation = Promise.resolve();
  let controller: AbortController | null = null;
  let snapshot: { vectors: readonly DebugVector[]; timeSeconds: number } | null = null;
  let withinScheduledFrame = false;
  const requestFrame = (): void => { if (!withinScheduledFrame) options.requestRender?.(); };
  const glyphs = new Map<string, VectorGlyph>();
  const materials: StandardMaterial[] = [];
  const retired: { root: TransformNode; glyphs: VectorGlyph[]; materials: StandardMaterial[] }[] = [];
  const warnings = new Set<string>();

  const warn = (message: string): void => {
    if (warnings.has(message)) return;
    warnings.add(message);
    options.onError?.(message);
  };
  const disposeRetired = (): boolean => {
    let visible = false;
    for (const previous of retired.splice(0)) {
      visible ||= previous.root.isEnabled();
      for (const glyph of previous.glyphs) glyph.texture?.dispose();
      previous.root.dispose();
      for (const material of previous.materials) material.dispose();
    }
    return visible;
  };
  const clearGeometry = (preserveVisible = false): void => {
    const wasVisible = root?.isEnabled() ?? false;
    controller?.abort();
    controller = null;
    if (preserveVisible && wasVisible && root) {
      retired.push({ root, glyphs: [...glyphs.values()], materials: materials.splice(0) });
    } else {
      for (const glyph of glyphs.values()) glyph.texture?.dispose();
      root?.dispose();
      for (const material of materials.splice(0)) material.dispose();
    }
    glyphs.clear();
    root = null;
    prepared = false;
    if (!preserveVisible && (disposeRetired() || wasVisible)) requestFrame();
  };
  const stop = (): void => {
    clearGeometry();
    snapshot = null;
  };

  function material(name: string, color: string): StandardMaterial {
    const result = new StandardMaterial(name, scene);
    result.disableLighting = true;
    result.emissiveColor = Color3.FromHexString(color);
    result.diffuseColor = result.emissiveColor;
    result.specularColor = Color3.Black();
    result.depthFunction = Constants.ALWAYS;
    result.disableDepthWrite = true;
    result.alpha = 0.98;
    result.transparencyMode = Material.MATERIAL_ALPHABLEND;
    result.doNotSerialize = true;
    materials.push(result);
    return result;
  }

  function createGlyph(force: DebugVector): VectorGlyph {
    const node = new TransformNode(`vector-debug/${force.id}`, scene);
    node.parent = root;
    node.rotationQuaternion = Quaternion.Identity();
    node.doNotSerialize = true;
    const color = material(`vector-debug/${force.id}/material`, force.color);
    const shaft = MeshBuilder.CreateCylinder(`vector-debug/${force.id}/shaft`, { height: 1, diameter: 0.045, tessellation: 6 }, scene);
    const head = MeshBuilder.CreateCylinder(`vector-debug/${force.id}/head`, { height: 1, diameterTop: 0, diameterBottom: 0.22, tessellation: 6 }, scene);
    for (const mesh of [shaft, head]) {
      mesh.parent = node;
      mesh.material = color;
      mesh.isPickable = false;
      mesh.doNotSerialize = true;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.alphaIndex = 10003;
      mesh.metadata = { debugVector: { id: force.id, label: force.label } };
    }
    let label: Mesh | null = null;
    let labelAnchor: TransformNode | null = null;
    let texture: DynamicTexture | null = null;
    if (settings.labels) {
      // Babylon billboards discard their parent's orientation while composing
      // a nonzero child offset. An ordinary tip node transforms that offset
      // first; the zero-position billboard then only changes its facing.
      labelAnchor = new TransformNode(`vector-debug/${force.id}/label-anchor`, scene);
      labelAnchor.parent = node;
      labelAnchor.doNotSerialize = true;
      label = MeshBuilder.CreatePlane(`vector-debug/${force.id}/label`, { width: 3.5, height: 0.55 }, scene);
      label.parent = labelAnchor;
      label.billboardMode = Mesh.BILLBOARDMODE_ALL;
      label.isPickable = false;
      label.doNotSerialize = true;
      label.alwaysSelectAsActiveMesh = true;
      label.alphaIndex = 10004;
      label.metadata = { debugVector: { id: force.id, kind: "label" } };
      texture = new DynamicTexture(`vector-debug/${force.id}/text`, { width: 512, height: 80 }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
      texture.hasAlpha = true;
      const labelMaterial = material(`vector-debug/${force.id}/label-material`, "#ffffff");
      labelMaterial.diffuseTexture = texture;
      labelMaterial.emissiveTexture = texture;
      labelMaterial.useAlphaFromDiffuseTexture = true;
      labelMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
      labelMaterial.backFaceCulling = false;
      label.material = labelMaterial;
    }
    const glyph = { root: node, shaft, head, label, labelAnchor, texture, key: "", text: "", labelTime: Number.NaN,
      color: force.color, labelText: force.label };
    if (texture) {
      // DynamicTexture becomes ready only after its first upload. Waiting for
      // material readiness before drawing text would wait for that upload
      // forever. Paint the initial label while its complete glyph is hidden.
      const magnitude = Math.hypot(...force.vector);
      const capped = Number.isFinite(magnitude) && magnitude > 0 && settings.valuePerMeter > 0
        && magnitude / settings.valuePerMeter > settings.maxArrowMeters;
      paintLabel(glyph, labelText(force, magnitude, capped), force.color);
      // Keep labelTime unset: the atomic reveal must refresh the latest
      // snapshot if observations changed while preparation was pending.
    }
    return glyph;
  }

  function labelText(force: DebugVector, magnitude: number, capped: boolean): string {
    return `${force.label}: ${(magnitude * options.valueDisplayScale).toFixed(1)} ${options.valueUnit}${capped ? " [capped]" : ""}`;
  }

  function paintLabel(glyph: VectorGlyph, text: string, color: string, styleChanged = false): boolean {
    if (!glyph.texture || text === glyph.text && !styleChanged) return false;
    glyph.text = text;
    const context = glyph.texture.getContext();
    context.font = "bold 28px sans-serif";
    const textWidth = context.measureText(text).width;
    const fontPixels = Math.min(28, Math.floor(28 * 480 / Math.max(1, textWidth)));
    glyph.texture.drawText(text, null, 52, `bold ${fontPixels}px sans-serif`, color, "#101820d9", true);
    return true;
  }

  function applySnapshot(): void {
    if (!snapshot || !root || !prepared) return;
    let changed = false;
    const seen = new Set<string>();
    for (const force of snapshot.vectors) {
      const glyph = glyphs.get(force.id);
      if (!glyph) continue;
      seen.add(force.id);
      const magnitude = Math.hypot(...force.vector);
      const valid = [...force.vector, ...force.anchor, magnitude].every(Number.isFinite)
        && Number.isFinite(settings.valuePerMeter) && settings.valuePerMeter > 0
        && Number.isFinite(settings.maxArrowMeters) && settings.maxArrowMeters > 0;
      const length = valid ? Math.min(magnitude / settings.valuePerMeter, settings.maxArrowMeters) : 0;
      const visible = valid && magnitude > 0 && length > 0;
      const capped = visible && magnitude / settings.valuePerMeter > settings.maxArrowMeters;
      const styleChanged = glyph.color !== force.color || glyph.labelText !== force.label;
      const key = [...force.vector, ...force.anchor, length, visible, force.color, force.label].join("/");
      if (key !== glyph.key) {
        glyph.key = key;
        if (styleChanged) {
          const colorMaterial = glyph.shaft.material as StandardMaterial;
          colorMaterial.emissiveColor.copyFrom(Color3.FromHexString(force.color));
          colorMaterial.diffuseColor.copyFrom(colorMaterial.emissiveColor);
          glyph.color = force.color;
          glyph.labelText = force.label;
          for (const mesh of [glyph.shaft, glyph.head]) mesh.metadata = { debugVector: { id: force.id, label: force.label } };
        }
        glyph.root.setEnabled(visible);
        if (visible) {
          glyph.root.position.set(...force.anchor);
          const vector = force.vector;
          const direction = new Vector3(vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude);
          // The helper compares 1 + dot(from,to) with epsilon. Its default
          // .001 treats directions within ~2.56 degrees of down as exactly
          // opposite, erasing real vector components. Limit that fallback to
          // floating-point indistinguishability while retaining exact down.
          Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction, glyph.root.rotationQuaternion!, 4 * Number.EPSILON);
          const headLength = Math.min(0.35, length * 0.25);
          glyph.shaft.scaling.y = length - headLength;
          glyph.shaft.position.y = (length - headLength) / 2;
          glyph.head.scaling.y = headLength;
          glyph.head.position.y = length - headLength / 2;
          if (glyph.labelAnchor) glyph.labelAnchor.position.y = length + 0.35;
        }
        glyph.root.metadata = { debugVector: { ...force, magnitude: magnitude, arrowMeters: length, capped } };
        changed = true;
      }
      const time = snapshot.timeSeconds;
      const hz = settings.labelRefreshHz;
      const due = !Number.isFinite(glyph.labelTime) || time < glyph.labelTime
        || (Number.isFinite(time) && Number.isFinite(hz) && hz > 0 && time - glyph.labelTime >= 1 / hz);
      const text = labelText(force, magnitude, capped);
      if (glyph.texture && visible && (due || styleChanged)) {
        glyph.labelTime = time;
        changed = paintLabel(glyph, text, force.color, styleChanged) || changed;
      }
    }
    for (const [id, glyph] of glyphs) if (!seen.has(id) && glyph.root.isEnabled()) {
      glyph.root.setEnabled(false); glyph.key = ""; changed = true;
    }
    if (changed) requestFrame();
  }

  function createGeometry(): void {
    if (!snapshot) return;
    root = new TransformNode("vector-debug", scene);
    root.parent = parent;
    root.doNotSerialize = true;
    root.setEnabled(false);
    for (const force of snapshot.vectors) glyphs.set(force.id, createGlyph(force));
    controller = new AbortController();
    const signal = controller.signal;
    const meshes = [...glyphs.values()].flatMap(glyph => [glyph.shaft, glyph.head, ...(glyph.label ? [glyph.label] : [])]);
    const prepare = options.whenReady ?? ((next: readonly Mesh[], nextSignal: AbortSignal) => whenMeshesReady(next, { signal: nextSignal }));
    preparation = prepare(meshes, signal).then(() => {
      if (disposed || signal.aborted || !root) return;
      prepared = true;
      const replacedVisible = disposeRetired();
      root.setEnabled(settings.enabled);
      const previous = withinScheduledFrame;
      withinScheduledFrame = true;
      try { applySnapshot(); } finally { withinScheduledFrame = previous; }
      if (replacedVisible || [...glyphs.values()].some(glyph => glyph.root.isEnabled())) requestFrame();
    }).catch(error => {
      if (!disposed && !signal.aborted) warn(`Vector drawing could not prepare: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  function update(vectors: readonly DebugVector[], timeSeconds: number, alreadyScheduled = false): void {
    if (disposed || !settings.enabled) return;
    const previous = withinScheduledFrame;
    withinScheduledFrame = alreadyScheduled;
    try {
      snapshot = { vectors, timeSeconds };
      if (!root) createGeometry();
      else if (vectors.some(vector => !glyphs.has(vector.id))) { clearGeometry(true); createGeometry(); }
      applySnapshot();
    } finally { withinScheduledFrame = previous; }
  }

  return {
    get ready(): Promise<void> { return preparation; },
    update,
    setSettings(next: VectorDebugDrawingSettings): void {
      if (disposed) return;
      const rebuildLabels = next.labels !== settings.labels;
      settings = next;
      if (!settings.enabled) { stop(); return; }
      if (rebuildLabels) clearGeometry(true);
      update(snapshot?.vectors ?? [], snapshot?.timeSeconds ?? 0);
    },
    dispose(): void { if (!disposed) { disposed = true; stop(); } },
  };
}
