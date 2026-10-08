/**
 * Scene downloads update the existing log in place: the small manifest,
 * all orb previews together, and each image requested on entry. A failed
 * download leaves its diagnostic, and cancelled work leaves no busy bar.
 */
import type { GameLog, GameLogEntry, GameLogLine } from "../log/createGameLog";
import type { SceneProgress, SceneStatus } from "../scenes/loadScene";
import type { SceneController } from "../scenes/sceneController";

function bytes(value: number): string {
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${Math.round(value)} B`;
}

function transferred(progress: Pick<SceneProgress, "receivedBytes" | "totalBytes">): string {
  return progress.totalBytes === null ? `${bytes(progress.receivedBytes)} received` : `${bytes(progress.receivedBytes)} / ${bytes(progress.totalBytes)}`;
}

interface UpdatingLine { handle: GameLogLine; key: string }

export function connectSceneLog(controller: SceneController, log: Pick<GameLog, "print">): () => void {
  let previews = new Set<string>();
  let previewFailureLine: GameLogLine | null = null;
  let metadataLine: UpdatingLine | null = null;
  let previewLine: UpdatingLine | null = null;
  let previewStatus: SceneStatus | null = null;
  let sceneKey: string | null = null;
  let unavailable: string | null = null;
  let previewFinished = false;
  const previewDownloads = new Map<string, SceneProgress>();
  const imageLines = new Map<string, UpdatingLine>();
  let loading: string | null = null;

  const update = (line: UpdatingLine | null, entry: GameLogEntry): UpdatingLine => {
    const key = JSON.stringify(entry);
    if (!line) return { handle: log.print(entry), key };
    // Camera frames must not keep a completed line from fading.
    if (line.key !== key) {
      line.handle.update(entry);
      line.key = key;
    }
    return line;
  };

  const updatePreviews = (): void => {
    if (!previewStatus?.renderingAvailable) return;
    const entries = previewStatus.entries.filter(entry => entry.supported);
    if (entries.length === 0) return;
    const ready = entries.filter(entry => entry.preview === "ready").length;
    const failed = entries.filter(entry => entry.preview === "failed").length;
    const pending = entries.length - ready - failed;
    const active = [...previewDownloads.values()];
    const receivedBytes = active.reduce((sum, each) => sum + each.receivedBytes, 0);
    const totalBytes = active.every(each => each.totalBytes !== null) ? active.reduce((sum, each) => sum + each.totalBytes!, 0) : null;
    let text = `${previewStatus.title}: ${ready} of ${entries.length} panorama previews ready`;
    if (failed) text += `; ${failed} unavailable`;
    if (pending > 0) text += active.length ? ` · ${active.length} loading (${transferred({ receivedBytes, totalBytes })})` : ` · ${pending} remaining`;
    previewFinished = pending === 0;
    previewLine = update(previewLine, {
      text: `${text}.`, tone: pending > 0 ? "progress" : failed ? "warning" : "success",
      // Count usable previews. Background sharpening can transfer more
      // bytes for already-ready entries and must not inflate this bar.
      progress: (ready + failed) / entries.length,
    });
  };

  const stopImages = (): void => {
    for (const line of imageLines.values()) line.handle.remove();
    imageLines.clear();
  };

  const offState = controller.subscribe(state => {
    // Another scene: its previews are counted afresh.
    if (state.loading && state.loading !== loading) {
      previews = new Set();
      previewFailureLine = null;
      metadataLine?.handle.remove();
      metadataLine = update(null, { text: `Loading scene: ${state.loading}`, tone: "progress", progress: null });
    }
    if (!state.loading && metadataLine) {
      if (state.errors.length || !state.status) metadataLine.handle.remove();
      else update(metadataLine, { text: `${state.status.title}: ${state.status.entries.length} panorama locations loaded.`, tone: "success" });
      metadataLine = null;
    }
    loading = state.loading;
    const status = state.status?.phase === "disposed" ? null : state.status;
    const key = status ? `${status.sceneId}/${status.generation}` : null;
    if (key !== sceneKey) {
      if (!previewFinished) previewLine?.handle.remove();
      previewLine = null;
      previewFinished = false;
      previewDownloads.clear();
      stopImages();
      sceneKey = key;
      unavailable = null;
    }
    previewStatus = status;
    if (status && !status.renderingAvailable) {
      const reason = status.unavailableReason ?? "Panoramas cannot be drawn here.";
      if (reason !== unavailable) log.print({ text: `${status.title}: ${reason}`, tone: "error" });
      unavailable = reason;
    }
    updatePreviews();
  });
  const offProgress = controller.onProgress(progress => {
    if (progress.kind === "manifest") {
      if (metadataLine && progress.state === "loading") metadataLine = update(metadataLine, {
        text: `Loading scene: ${progress.title} · ${transferred(progress)}`,
        tone: "progress", progress: progress.totalBytes ? progress.receivedBytes / progress.totalBytes : null,
      });
      return;
    }
    if (progress.kind === "preview") {
      if (progress.state === "loading") previewDownloads.set(progress.id, progress);
      else previewDownloads.delete(progress.id);
      updatePreviews();
      return;
    }
    const existing = imageLines.get(progress.id) ?? null;
    if (progress.state === "loading") {
      imageLines.set(progress.id, update(existing, {
        text: `${progress.title}: downloading panorama image · ${transferred(progress)}`,
        tone: "progress", progress: progress.totalBytes ? progress.receivedBytes / progress.totalBytes : null,
      }));
    } else {
      if (progress.state === "ready" && existing) update(existing, {
        text: `${progress.title}: panorama image ready.`, tone: "success", progress: 1,
        // Repeated visits should not fill the open history with ready notices.
        keepInHistory: false,
      });
      else existing?.handle.remove();
      imageLines.delete(progress.id);
    }
  });
  const offFailure = controller.onFailure(failure => {
    if (failure.kind !== "preview" || !failure.panorama) {
      log.print({ text: failure.message, tone: "error" });
      return;
    }
    previews.add(failure.panorama.id);
    previewFailureLine?.remove();
    previewFailureLine = log.print({
      text: previews.size === 1 ? failure.message : `The previews of ${previews.size} panoramas could not be loaded. The latest, ${failure.message}`,
      tone: "error",
    });
  });
  return () => {
    offState();
    offProgress();
    offFailure();
    metadataLine?.handle.remove();
    if (!previewFinished) previewLine?.handle.remove();
    stopImages();
  };
}
