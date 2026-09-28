/**
 * Tells the log when a scene fails: its file, entering a panorama, a larger
 * image of the one on screen, and orb previews. The tabs say the same where
 * each belongs; the log is where a failure is noticed. Previews fail
 * together when their server goes away, so they share one line counting
 * the panoramas, printed again at the top with each new failure.
 */
import type { GameLog, GameLogLine } from "../log/createGameLog";
import type { SceneController } from "../scenes/sceneController";

export function connectSceneLog(controller: SceneController, log: Pick<GameLog, "print">): () => void {
  let previews = new Set<string>();
  let previewLine: GameLogLine | null = null;
  let loading: string | null = null;
  const offState = controller.subscribe(state => {
    // Another scene: its previews are counted afresh.
    if (state.loading && state.loading !== loading) {
      previews = new Set();
      previewLine = null;
    }
    loading = state.loading;
  });
  const offFailure = controller.onFailure(failure => {
    if (failure.kind !== "preview" || !failure.panorama) {
      log.print({ text: failure.message, tone: "error" });
      return;
    }
    previews.add(failure.panorama.id);
    previewLine?.remove();
    previewLine = log.print({
      text: previews.size === 1 ? failure.message : `The previews of ${previews.size} panoramas could not be loaded. The latest, ${failure.message}`,
      tone: "error",
    });
  });
  return () => {
    offState();
    offFailure();
  };
}
