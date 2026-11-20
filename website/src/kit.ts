// Small shared helpers: painted canvas textures and unlit materials for glows,
// light pools and contact shadows.
import * as THREE from 'three';

export function canvasTexture(width: number, height: number, paint: (context: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const glowTexture = (inner: string, outer: string) => canvasTexture(256, 256, (context) => {
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
});

/** A soft band of light, bright along one edge or through the middle. */
export const bandTexture = (colour: string, vertical: boolean, peak = 0.5) => canvasTexture(vertical ? 4 : 64, vertical ? 64 : 4, (context) => {
  const gradient = vertical ? context.createLinearGradient(0, 0, 0, 64) : context.createLinearGradient(0, 0, 64, 0);
  gradient.addColorStop(0, peak === 0 ? colour : colour.replace(/[\d.]+\)$/, '0)'));
  if (peak > 0 && peak < 1) gradient.addColorStop(peak, colour);
  gradient.addColorStop(1, colour.replace(/[\d.]+\)$/, '0)'));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
});

export const flat = (colour: string, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: colour, ...extra });
// Decals (light washes, pools, contact shadows) sit a hair off the surface; the polygon
// offset pulls them forward in depth so they cannot shimmer against it as the camera moves.
export const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
export const glow = (texture: THREE.Texture, opacity = 1) => new THREE.MeshBasicMaterial({
  map: texture, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...DECAL,
});
export const shade = (texture: THREE.Texture) => new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false, ...DECAL });
