import type { SceneExample } from "./sceneController";

/**
 * The example scenes in public/examples/panorama-scenes/, rebuilt by
 * scripts/build-panorama-examples.mjs. Their ids are what `?scene=` accepts.
 */
export const SCENE_EXAMPLES: readonly SceneExample[] = [
  {
    id: "umn-single",
    title: "UMN — test panorama",
    description: "One test photograph 30 m above the University of Minnesota campus. It was not taken there.",
    url: "examples/panorama-scenes/umn-single.scene.json",
  },
  {
    id: "umn-cardinal",
    title: "UMN — cardinal test image",
    description: "The same place with generated N, E, S and W letters, to see mirroring or a wrong direction.",
    url: "examples/panorama-scenes/umn-cardinal.scene.json",
  },
  {
    id: "campus-pair",
    title: "Test pair: two linked panoramas",
    description: "Two different images 80 m apart, linked both ways: enter, look, follow a link, go back, exit. Their orbs are outlined and grow under the pointer.",
    url: "examples/panorama-scenes/campus-pair.scene.json",
  },
];
