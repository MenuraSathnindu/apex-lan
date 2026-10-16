import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  type Pass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { POST, type QualityLevel } from '@apex/shared';
import type { QualitySettings } from './quality.ts';

/**
 * Post-processing chain (pmndrs `postprocessing`):
 *   scene → [N8AO ambient occlusion] → [bloom] + ACES tone mapping + vignette → SMAA.
 * The renderer itself uses NoToneMapping; tone mapping happens here, in the effect pass.
 */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private passes: Pass[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  }

  /** Rebuilds the pass chain for a quality level. */
  apply(level: QualityLevel, q: QualitySettings): void {
    this.composer.removeAllPasses();
    for (const p of this.passes) p.dispose();

    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const passes: Pass[] = [new RenderPass(this.scene, this.camera)];

    if (q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, size.x, size.y);
      ao.configuration.aoRadius = POST.aoRadius;
      ao.configuration.distanceFalloff = 1;
      ao.configuration.intensity = POST.aoIntensity;
      ao.configuration.gammaCorrection = false; // later passes handle colour output
      ao.setQualityMode(level === 'high' ? 'Medium' : 'Low');
      // Half-res AO with depth-aware upsampling: ~15% faster, visually near-identical.
      ao.configuration.halfRes = true;
      ao.configuration.depthAwareUpsampling = true;
      passes.push(ao);
    }

    const effects = [];
    if (q.bloom) {
      effects.push(
        new BloomEffect({
          intensity: POST.bloomIntensity,
          luminanceThreshold: POST.bloomThreshold,
          luminanceSmoothing: 0.2,
          mipmapBlur: true,
        }),
      );
    }
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    effects.push(new VignetteEffect({ offset: 0.3, darkness: POST.vignetteDarkness }));
    passes.push(new EffectPass(this.camera, ...effects));

    // SMAA after tone mapping, where edges have their final contrast.
    passes.push(new EffectPass(this.camera, new SMAAEffect({ preset: level === 'high' ? SMAAPreset.HIGH : SMAAPreset.MEDIUM })));

    for (const p of passes) this.composer.addPass(p);
    this.passes = passes;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
