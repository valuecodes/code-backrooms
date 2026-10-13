import { useThree } from "@react-three/fiber";
import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  ToneMapping,
  Vignette,
} from "@react-three/postprocessing";
import { N8AOPostPass } from "n8ao";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useMemo } from "react";
import { AgXToneMapping, Vector2 } from "three";

/** How much the scene is drawn for: nothing at `low`, the full chain at `high`. */
type Quality = "low" | "high";

/**
 * Shared by both paths: the renderer tone-maps at `low`, and at `high` the
 * composer's AgX pass reads the renderer's exposure too.
 */
const EXPOSURE = 1.15;

/**
 * The frame's look, the same at every quality: AgX tone mapping, with the
 * exposure the lights are tuned against.
 *
 * At `high` the frame goes through a composer: ambient occlusion, bloom off
 * the fixtures, grain, a vignette and a touch of lens fringing, tone-mapped
 * last. The composer takes `toneMapping` over while mounted and gives AgX
 * back when it unmounts, so switching quality never changes the brightness.
 */
const Effects = ({ quality }: { readonly quality: Quality }) => {
  const get = useThree((state) => state.get);
  useEffect(() => {
    const { gl } = get();
    gl.toneMapping = AgXToneMapping;
    gl.toneMappingExposure = EXPOSURE;
  }, [get]);
  const high = quality === "high";
  // The composer sizes its passes on every resize; the constructor only
  // needs a first size, so the pass is not rebuilt when the window changes.
  const occlusion = useMemo(() => {
    if (!high) {
      return null;
    }
    const { gl, scene, camera } = get();
    const { width, height } = gl.getDrawingBufferSize(new Vector2());
    const pass = new N8AOPostPass(scene, camera, width, height);
    const { configuration } = pass;
    configuration.aoRadius = 1.2;
    configuration.distanceFalloff = 0.6;
    configuration.intensity = 2.5;
    configuration.halfRes = true;
    configuration.depthAwareUpsampling = true;
    configuration.aoSamples = 12;
    configuration.denoiseSamples = 6;
    configuration.denoiseRadius = 8;
    // Tone mapping follows, so the pass must hand on linear light.
    configuration.gammaCorrection = false;
    return pass;
  }, [high, get]);
  useEffect(() => () => occlusion?.dispose(), [occlusion]);
  if (occlusion === null) {
    return null;
  }
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <primitive object={occlusion} />
      <Bloom mipmapBlur luminanceThreshold={1} intensity={0.35} />
      <Noise opacity={0.035} />
      <Vignette offset={0.3} darkness={0.45} />
      <ChromaticAberration
        offset={[0.0006, 0.0006]}
        radialModulation
        modulationOffset={0.3}
      />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
};

export { Effects };
export type { Quality };
