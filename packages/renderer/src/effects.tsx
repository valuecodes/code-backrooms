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
import { useEffect, useLayoutEffect, useMemo } from "react";
import { AgXToneMapping, NoToneMapping, Vector2 } from "three";

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
 * last. The renderer maps only at `low`; at `high` it is set to no mapping
 * here, which is what the composer holds it to while mounted (and hands
 * back on unmount, by which time the next quality's setting is in place).
 *
 * A layout effect, so the mapping is set before any passive effect of the
 * same commit: the World's shader precompile runs there, and tone mapping
 * picks the shader variant it would otherwise warm wrongly.
 */
const Effects = ({ quality }: { readonly quality: Quality }) => {
  const get = useThree((state) => state.get);
  const high = quality === "high";
  useLayoutEffect(() => {
    const { gl } = get();
    gl.toneMappingExposure = EXPOSURE;
    gl.toneMapping = high ? NoToneMapping : AgXToneMapping;
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
    configuration.aoSamples = 8;
    configuration.denoiseSamples = 4;
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
    // The composer draws off screen, where the Canvas's own antialiasing
    // does not reach: it multisamples instead.
    <EffectComposer multisampling={4} enableNormalPass={false}>
      <primitive object={occlusion} />
      <Bloom mipmapBlur luminanceThreshold={1} intensity={0.35} />
      <Noise opacity={0.01} />

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
