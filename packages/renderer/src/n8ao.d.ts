// n8ao ships no types: the part of its post-processing pass this package uses.
declare module "n8ao" {
  import type { Pass } from "postprocessing";
  import type { Camera, Color, Scene } from "three";

  type N8AOConfiguration = {
    /** Occlusion radius in world units. */
    aoRadius: number;
    /** World units over which the effect fades out with distance. */
    distanceFalloff: number;
    intensity: number;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    /** Compute the occlusion at half the frame's resolution. */
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    screenSpaceRadius: boolean;
    color: Color;
    /** Apply gamma correction: only when this pass draws to the screen. */
    gammaCorrection: boolean;
    renderMode: 0 | 1 | 2 | 3 | 4;
    transparencyAware: boolean;
  };

  class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    readonly configuration: N8AOConfiguration;
  }

  export { N8AOPostPass };
}
