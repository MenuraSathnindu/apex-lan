import * as THREE from 'three';
import type { QualityLevel } from '@apex/shared';
import { Environment } from './environment.ts';
import { PostProcessing } from './post.ts';
import type { QualitySettings } from './quality.ts';

/**
 * Renderer + scene + camera + lighting + post-processing.
 * Colour pipeline: linear lighting (three's physically based units) → HalfFloat buffers →
 * ACES Filmic tone mapping in the post chain → sRGB output.
 */
export class Graphics {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.15, 3000);
  readonly environment: Environment;
  private readonly post: PostProcessing;
  private pixelRatioCap = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA in post instead
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // done by ToneMappingEffect (ACES Filmic)
    this.renderer.shadowMap.enabled = true;
    // three r186 removed PCFSoftShadowMap; PCF + shadow.radius gives the soft edges.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.environment = new Environment(this.renderer, this.scene);
    this.post = new PostProcessing(this.renderer, this.scene, this.camera);
    window.addEventListener('resize', () => this.resize());
  }

  applyQuality(level: QualityLevel, q: QualitySettings): void {
    this.pixelRatioCap = q.pixelRatio;
    this.resize();
    this.environment.applyQuality(q);
    this.post.apply(level, q);
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.post.render(dt);
  }
}
