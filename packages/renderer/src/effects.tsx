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
 * last. The composer turns the renderer's own tone mapping off while it is
 * mounted (its effect runs before this component's, being a child) and
 * gives the previous mapping back when it unmounts; so AgX is set on the
 * renderer only at `low`, where nothing else maps, and never over the
 * composer's `NoToneMapping`.
 */
const Effects = ({ quality }: { readonly quality: Quality }) => {
  const get = useThree((state) => state.get);
  const high = quality === "high";
  useEffect(() => {
    const { gl } = get();
    gl.toneMappingExposure = EXPOSURE;
    if (!high) {
      gl.toneMapping = AgXToneMapping;
    }
  }, [get, high]);
  // One pass per Canvas, kept across quality changes: `Pass.dispose` does
  // not reach the pass's own fullscreen objects, so rebuilding it on every
  // toggle would leak them. The composer sizes it on every resize; the
  // constructor only needs a first size.
  const occlusion = useMemo(() => {
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
  }, [get]);
  useEffect(() => () => occlusion.dispose(), [occlusion]);
  if (!high) {
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
