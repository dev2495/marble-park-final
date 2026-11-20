// The building from the street at dusk, after the showroom's own elevation:
// a two-storey frontage of staggered cream stone blocks split by slits of warm
// light, a slatted timber bay and a dark stone pylon carrying the departments,
// the backlit Marble Park sign, and a full-height glass shopfront under a deep
// canopy, with the lit showroom visible through it. Planters, trees, bollards
// and steps lead down to the pavement and the road the visitor starts on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lit, type Lamp } from './lit';
import { DECAL, bandTexture, canvasTexture, flat, glow, glowTexture } from './kit';

export const STORE_Z = 0; // the glass line of the shopfront
export const LOBBY_BACK = -3; // the gallery corridor begins here

const LEFT = -9.4; // left edge of the glazed bay and the stone above it
const RIGHT = 13;
const CANOPY_Y = 5.2;
const CANOPY_TOP = 5.65;
const TOP = 12.6;

/** A small seeded generator, so the stone coursing is the same on every visit. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Foliage: dusk-dark leaves lit warm from below by the uplights, with clumpy variation. */
function foliage(dark: string, lit: string, leaves?: THREE.Texture) {
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDark: { value: new THREE.Color(dark) }, uLit: { value: new THREE.Color(lit) }, uLeaves: { value: null }, uUseLeaves: { value: leaves ? 1 : 0 } }]),
    vertexShader: /* glsl */ `
      varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz; vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uDark; uniform vec3 uLit; uniform sampler2D uLeaves; uniform float uUseLeaves;
      varying vec3 vNormal; varying vec3 vWorld; varying vec2 vUv;
      #include <fog_pars_fragment>
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        float leaf = 1.0;
        if (uUseLeaves > 0.5) {
          vec4 sheet = texture2D(uLeaves, vUv);
          if (sheet.a < 0.5) discard;
          leaf = sheet.r;
        }
        vec3 N = normalize(vNormal);
        float y = abs(vWorld.y);
        float sky = 0.35 + 0.65 * max(N.y, 0.0);
        float under = max(-N.y, 0.0) * 0.8 + max(dot(N, normalize(vec3(0.0, -0.2, 1.0))), 0.0) * 0.35;
        float speck = 0.75 + 0.5 * hash(floor(vWorld * 9.0));
        vec3 colour = (uDark * sky * speck + uLit * under * exp(-max(y - 1.2, 0.0) * 0.32) * speck) * (0.55 + 0.6 * leaf);
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  });
  material.uniforms.uLeaves.value = leaves ?? null;
  return material;
}

/** A warm limestone, painted: soft clouding, fine bedding lines and pores, never a repeat of a photo. */
function limestone(rand: () => number) {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#e6d8c1';
  context.fillRect(0, 0, size, size);
  // Clouding: many large soft blots of slightly lighter and darker stone.
  for (let i = 0; i < 260; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 40 + rand() * 180;
    const light = rand() > 0.5;
    const g = context.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, light ? 'rgba(250,242,226,0.14)' : 'rgba(196,176,146,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = g;
    context.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Bedding: faint wavering horizontal lines.
  for (let i = 0; i < 26; i += 1) {
    const y = rand() * size;
    context.strokeStyle = `rgba(150,128,100,${0.05 + rand() * 0.08})`;
    context.lineWidth = 1 + rand() * 3;
    context.beginPath();
    context.moveTo(0, y);
    for (let x = 0; x <= size; x += 64) context.lineTo(x, y + Math.sin(x * 0.01 + i) * 6 + (rand() - 0.5) * 4);
    context.stroke();
  }
  // Pores and fossil specks.
  for (let i = 0; i < 9000; i += 1) {
    context.fillStyle = rand() > 0.4 ? `rgba(140,116,88,${0.1 + rand() * 0.25})` : `rgba(252,246,234,${0.3 + rand() * 0.3})`;
    const r = rand() * 1.8 + 0.3;
    context.fillRect(rand() * size, rand() * size, r, r);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A sheet of painted leaves with transparent gaps, for the tree crowns. */
function leafSheet(rand: () => number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 150; i += 1) {
    const x = 22 + rand() * 212;
    const y = 30 + rand() * 196;
    const shade = Math.floor(150 + rand() * 105);
    context.save();
    context.translate(x, y);
    context.rotate(rand() * Math.PI * 2);
    context.fillStyle = `rgb(${shade},${shade},${shade})`;
    context.beginPath();
    context.ellipse(0, 0, 7 + rand() * 6, 3 + rand() * 2.5, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

/**
 * A tree crown made of many leaf cards inside an ellipsoid. Each card's
 * normal points out from the crown's centre, so light wraps the whole crown
 * like foliage rather than flat cards.
 */
function leafCrown(rand: () => number, radius: number, cards: number, squash = 0.78) {
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const corner = new THREE.Vector3();
  for (let i = 0; i < cards; i += 1) {
    // Biased toward the surface of the crown, where leaves catch the light.
    const u = rand() * Math.PI * 2;
    const v = Math.acos(2 * rand() - 1);
    const r = radius * (0.55 + 0.45 * Math.cbrt(rand()));
    const centre = new THREE.Vector3(Math.sin(v) * Math.cos(u) * r, Math.cos(v) * r * squash, Math.sin(v) * Math.sin(u) * r);
    const out = centre.clone().normalize();
    const size = radius * (0.28 + rand() * 0.16);
    quaternion.setFromEuler(euler.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI));
    const base = position.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corner.set(cx * size / 2, cy * size / 2, 0).applyQuaternion(quaternion).add(centre);
      position.push(corner.x, corner.y, corner.z);
      normal.push(out.x, out.y, out.z);
      uv.push((cx + 1) / 2, (cy + 1) / 2);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

export type Facade = {
  doors: THREE.Object3D[];
  sky: THREE.Mesh;
  /** Call once per frame with the visitor's distance along the street (z). */
  update(z: number): void;
};

export function buildFacade(scene: THREE.Scene, textures: Map<string, THREE.Texture>, reflect: (object: THREE.Object3D) => THREE.Object3D): Facade {
  const rand = random(20261120);
  const add = <T extends THREE.Object3D>(object: T, x = 0, y = 0, z = 0, parent: THREE.Object3D = scene) => {
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const plane = (w: number, h: number, m: THREE.Material) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  const level = (w: number, d: number, m: THREE.Material, x: number, y: number, z: number, down = false, parent: THREE.Object3D = scene) => {
    const mesh = plane(w, d, m);
    mesh.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
    return add(mesh, x, y, z, parent);
  };

  // ------------------------------------------------------------------ sky
  const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 zenith = vec3(0.15, 0.26, 0.48);
        vec3 mid = vec3(0.40, 0.50, 0.68);
        vec3 low = vec3(0.74, 0.68, 0.72);
        vec3 horizon = vec3(0.98, 0.73, 0.56);
        vec3 colour = mix(horizon, low, smoothstep(0.0, 0.07, h));
        colour = mix(colour, mid, smoothstep(0.07, 0.25, h));
        colour = mix(colour, zenith, smoothstep(0.25, 0.85, h));
        // Long soft clouds catching the last of the sun low down.
        vec2 q = vDir.xz / max(h + 0.12, 0.05) * vec2(0.5, 1.6);
        float cloud = smoothstep(0.52, 0.8, fbm(q * 1.4 + 3.0)) * smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.25, 0.55, h));
        colour = mix(colour, vec3(0.98, 0.74, 0.62), cloud * 0.55);
        gl_FragColor = vec4(colour, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -10;
  add(sky, 0, 0, 10);

  // ----------------------------------------------------- street and plaza
  // Downlights in the canopy soffit; four of them also light the paving shader.
  const downlightX = [-9.6, -7.6, -5.6, -3.4, -1.2, 1.2, 3.4, 5.6, 7.6, 9.6, 11.6];
  const paveLamps: Lamp[] = [-5.6, -1.2, 1.2, 5.6].map((x) => ({ position: [x, CANOPY_Y - 0.05, 1.8], target: [x, 0, 2.6], intensity: 0.9, angle: 40, colour: '#ffd7a6' }));
  const paving = lit({
    map: textures.get('slab-14'), colour: '#d8d4cf', repeat: [36 / 1.2, 6.5 / 0.6], grout: 0.5, gloss: 1.1,
    ambient: 0.34, opacity: 0.82, lamps: paveLamps,
  });
  level(36, 6.5, paving, 0, 0, STORE_Z + 3.25).renderOrder = -1;
  // The paving catches the lit shopfront as a warm sheen.
  const sheen = glow(bandTexture('rgba(255,214,160,0.34)', true, 0), 1);
  level(RIGHT - LEFT, 4.2, sheen, (LEFT + RIGHT) / 2, 0.004, STORE_Z + 2.1);

  const kerbStone = lit({ colour: '#4a4643', noise: 0.25, ambient: 0.4 });
  const pavement = lit({ colour: '#8d8984', noise: 0.35, ambient: 0.38, lamps: paveLamps });
  const asphalt = lit({ colour: '#2b2b2e', noise: 0.5, ambient: 0.42, gloss: 0.4 });
  const drop = 0.45;
  // The plaza's edge: a dark stone retaining face, with three broad steps in the middle.
  for (const side of [-1, 1]) {
    const w = 18 - 4;
    const face = plane(w, drop, kerbStone);
    add(face, side * (4 + w / 2), -drop / 2, STORE_Z + 6.5);
  }
  for (let i = 0; i < 3; i += 1) {
    const y = -(i + 1) * (drop / 3);
    const z = STORE_Z + 6.5 + i * 0.34;
    add(plane(8, drop / 3, kerbStone), 0, y + drop / 6, z);
    level(8, 0.34, pavement, 0, y, z + 0.17);
  }
  // Light lines under each tread nosing.
  for (let i = 0; i < 3; i += 1) add(box(8, 0.012, 0.012, flat('#ffd9a8')), 0, -(i) * (drop / 3) - 0.02, STORE_Z + 6.5 + i * 0.34 + 0.008);
  level(80, 2.6, pavement, 0, -drop, STORE_Z + 7.52 + 1.3);
  for (const side of [-1, 1]) level(36, 1.02, pavement, side * 22, -drop, STORE_Z + 7.01);
  add(box(80, 0.15, 0.2, kerbStone), 0, -drop - 0.075, STORE_Z + 10.1);
  level(80, 40, asphalt, 0, -drop - 0.15, STORE_Z + 30.2);
  const dash = flat('#8f8c86');
  for (let x = -38; x < 40; x += 6) level(3, 0.12, dash, x, -drop - 0.145, STORE_Z + 21);
  level(80, 0.1, flat('#c9b98f'), 0, -drop - 0.145, STORE_Z + 11);

  // ------------------------------------------------------------- building
  const building = new THREE.Group();
  scene.add(building);

  // Upper storey: staggered cream stone blocks over a dark backing, so every joint reads.
  add(plane(RIGHT - LEFT, TOP - CANOPY_TOP, flat('#1a1612')), (LEFT + RIGHT) / 2, (CANOPY_TOP + TOP) / 2, 0.08, building);
  const blocks: THREE.BufferGeometry[] = [];
  const slits: Array<{ x: number; y0: number; y1: number }> = [];
  const signZone = (x: number, y: number) => x > 1.6 && x < 9.8 && y > 8.2 && y < 12;
  // Blocks that reach into the sign's panel lie flat, so nothing stands proud of the letters.
  const behindSign = (x0: number, x1: number, y0: number, y1: number) => x1 > 1.2 && x0 < 10.2 && y1 > 8.1 && y0 < 12.1;
  let x = LEFT;
  let column = 0;
  while (x < RIGHT - 0.3) {
    const w = Math.min(RIGHT - x, 0.75 + rand() * 0.7);
    let y = CANOPY_TOP;
    const breaks: number[] = [y];
    while (y < TOP - 0.05) {
      const h = Math.min(TOP - y, 0.8 + rand() * 1.7);
      const proud = behindSign(x, x + w, y, y + h) ? 0 : [0, 0.04, 0.1, 0.17, 0.26][Math.floor(rand() * 5)];
      const depth = 0.3 + proud;
      const geometry = new THREE.BoxGeometry(w - 0.025, h - 0.025, depth);
      // Each block shows its own patch of the stone, so no two read as copies.
      const su = (w / 1.7) * 0.92;
      const sv = (h / 2.7) * 0.92;
      const ou = rand() * (1 - su);
      const ov = rand() * (1 - sv);
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k += 1) uv.setXY(k, ou + uv.getX(k) * su, ov + uv.getY(k) * sv);
      geometry.translate(x + w / 2, y + h / 2, 0.1 + depth / 2);
      blocks.push(geometry);
      y += h;
      breaks.push(y);
    }
    // A slit of light in some joints, running between two coursing lines.
    if (column > 0 && rand() < 0.72) {
      const a = Math.floor(rand() * (breaks.length - 1));
      const b = Math.min(breaks.length - 1, a + 1 + Math.floor(rand() * 2));
      const y0 = breaks[a];
      const y1 = breaks[b];
      if (!signZone(x, (y0 + y1) / 2) && !signZone(x, y1 - 0.2)) slits.push({ x, y0, y1 });
    }
    x += w;
    column += 1;
  }
  const stone = lit({
    map: limestone(rand), colour: '#fff3e2', ambient: 0.66, gloss: 0.05,
    lamps: [
      // The last of the sky from high and to the left, so proud blocks model.
      { position: [-44, 26, 26], target: [2, 8, 0], intensity: 0.38, angle: 50, colour: '#e6e2f0' },
      // Warm light thrown up the stone from the top of the canopy.
      { position: [-3, CANOPY_TOP + 0.05, 2.2], target: [-3, 9.5, 0.4], intensity: 0.55, angle: 64, colour: '#ffd3a0' },
      { position: [7, CANOPY_TOP + 0.05, 2.2], target: [7, 9.5, 0.4], intensity: 0.55, angle: 64, colour: '#ffd3a0' },
    ],
  });
  const stoneMesh = new THREE.Mesh(mergeGeometries(blocks)!, stone);
  building.add(stoneMesh);
  const slitCore = flat('#fff0d6');
  const slitBand = bandTexture('rgba(255,196,130,0.5)', false, 0.5);
  for (const slit of slits) {
    const h = slit.y1 - slit.y0;
    add(box(0.035, h - 0.06, 0.02, slitCore), slit.x, (slit.y0 + slit.y1) / 2, 0.14, building);
    const halo = plane(0.9, h + 0.1, glow(slitBand, 0.8));
    add(halo, slit.x, (slit.y0 + slit.y1) / 2, 0.68, building);
  }
  // Coping along the top and a crisp shadow line under the stone.
  add(box(RIGHT - LEFT + 1.8, 0.12, 0.62, flat('#2a2420')), (LEFT + RIGHT) / 2 - 0.9, TOP + 0.06, 0.32, building);

  // The timber bay: vertical slats over a dark backing, with fine lines of light between them.
  const slatsX0 = -11.2;
  const wood = canvasTexture(64, 512, (context) => {
    context.fillStyle = '#7a5235';
    context.fillRect(0, 0, 64, 512);
    for (let i = 0; i < 70; i += 1) {
      context.strokeStyle = `rgba(${40 + rand() * 40},${22 + rand() * 20},${10 + rand() * 12},${0.15 + rand() * 0.3})`;
      context.lineWidth = 0.5 + rand() * 2;
      const gx = rand() * 64;
      context.beginPath();
      context.moveTo(gx, 0);
      context.bezierCurveTo(gx + rand() * 6 - 3, 170, gx + rand() * 6 - 3, 340, gx + rand() * 4 - 2, 512);
      context.stroke();
    }
  });
  add(plane(LEFT - slatsX0, TOP, flat('#120e0b')), (slatsX0 + LEFT) / 2, TOP / 2, 0.12, building);
  const timber = lit({ map: wood, colour: '#e7c39d', ambient: 0.55, lamps: [{ position: [-10.3, 0.1, 1.2], target: [-10.3, 6, 0.3], intensity: 0.7, angle: 30, colour: '#ffcf96' }] });
  const slats: THREE.BufferGeometry[] = [];
  for (let sx = slatsX0 + 0.06; sx < LEFT - 0.03; sx += 0.115) {
    const geometry = new THREE.BoxGeometry(0.06, TOP - 0.1, 0.16);
    geometry.translate(sx, (TOP - 0.1) / 2, 0.3);
    slats.push(geometry);
  }
  building.add(new THREE.Mesh(mergeGeometries(slats)!, timber));
  for (const lx of [-10.85, -10.16, -9.7]) add(box(0.018, TOP - 0.6, 0.012, flat('#ffe2b8')), lx, TOP / 2, 0.2, building);

  // The pylon: dark stone carrying the departments, edged with a line of light.
  const pylon = lit({ map: textures.get('slab-02'), colour: '#9a948f', ambient: 0.42, gloss: 0.5, lamps: [{ position: [-12.1, 0.1, 1.6], target: [-12.1, 7, 0.75], intensity: 0.5, angle: 22, colour: '#ffd8a8' }] });
  add(box(1.8, 11.4, 1.3, pylon), -12.1, 5.7, 0.1, building);
  add(box(0.03, 10.6, 0.03, flat('#ffe0b0')), -11.215, 5.6, 0.76, building);
  const labels = canvasTexture(256, 1024, (context) => {
    context.clearRect(0, 0, 256, 1024);
    context.fillStyle = 'rgba(255,240,220,0.92)';
    context.font = '600 30px "Manrope Variable", Manrope, sans-serif';
    context.textBaseline = 'middle';
    const words = [['TILES', ''], ['LARGE', 'SLABS'], ['SANITARY', 'WARE'], ['FAUCETS &', 'SHOWERS'], ['KITCHEN', 'SINKS']];
    words.forEach(([a, b], i) => {
      const cy = 110 + i * 190;
      const spaced = (text: string, y: number) => {
        let cx = 26;
        for (const ch of text) { context.fillText(ch, cx, y); cx += context.measureText(ch).width + 5; }
      };
      spaced(a, b ? cy - 22 : cy);
      if (b) spaced(b, cy + 22);
      if (i < words.length - 1) {
        context.fillStyle = 'rgba(255,220,170,0.45)';
        context.fillRect(26, cy + 95, 70, 2);
        context.fillStyle = 'rgba(255,240,220,0.92)';
      }
    });
  });
  const labelPlate = plane(1.3, 5.2, new THREE.MeshBasicMaterial({ map: labels, transparent: true, depthWrite: false, ...DECAL }));
  add(labelPlate, -12.05, 7.0, 0.752, building);

  // The sign: the Marble Park mark and name, backlit, with its glow on the stone.
  const markTexture = canvasTexture(1024, 640, (context) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, 1024, 640);
    context.translate(212, 60);
    context.scale(0.44, 0.6);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const draw = (d: string, colour: string, blur: number) => {
      context.shadowColor = 'rgba(255,190,120,0.9)';
      context.shadowBlur = blur;
      context.strokeStyle = colour;
      context.lineWidth = 46;
      context.stroke(new Path2D(d));
    };
    for (const blur of [60, 0]) {
      draw('M24 830V62l343 450', '#f2cf8a', blur);
      draw('M210 830 715 180C790 85 890 22 990 22a325 325 0 1 1-72 640', '#e9b770', blur);
      draw('M818 265v565', '#f2cf8a', blur);
    }
  });
  const sign = (texture: THREE.Texture, w: number, h: number, sx: number, sy: number) => {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...DECAL });
    return add(plane(w, h, material), sx, sy, 0.43, building);
  };
  const textTexture = (text: string, size: number, weight: number, spacing: number, height: number, colour: string, blur: number) => canvasTexture(2048, height, (context) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, 2048, height);
    context.font = `${weight} ${size}px "Manrope Variable", Manrope, sans-serif`;
    context.textBaseline = 'middle';
    const widths = [...text].map((ch) => context.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    for (const pass of [blur, 0]) {
      let cx = (2048 - total) / 2;
      context.shadowColor = 'rgba(255,186,110,0.95)';
      context.shadowBlur = pass;
      context.fillStyle = colour;
      [...text].forEach((ch, i) => { context.fillText(ch, cx, height / 2); cx += widths[i] + spacing; });
    }
  });
  const signX = 5.7;
  sign(markTexture, 2.3, 1.44, signX, 10.95);
  sign(textTexture('MARBLE PARK', 230, 700, 34, 320, '#fff3dc', 46), 8.2, 8.2 * 320 / 2048, signX, 9.55);
  sign(textTexture('TILES   |   BATH   |   SURFACES', 92, 600, 16, 140, '#f6dcb6', 18), 5.6, 5.6 * 140 / 2048, signX + 0.15, 8.78);
  const signHalo = plane(11, 5.4, glow(glowTexture('rgba(255,190,120,0.2)', 'rgba(255,190,120,0)'), 1));
  add(signHalo, signX, 9.9, 0.45, building);

  // ------------------------------------------------------- canopy & glass
  const canopyDepth = 3.0;
  const canopyZ = -0.1 + canopyDepth / 2;
  const soffit = flat('#2a2420');
  const canopy = box(RIGHT + 0.4 - (slatsX0 + 0.0), CANOPY_TOP - CANOPY_Y, canopyDepth, [flat('#1c1815'), flat('#1c1815'), flat('#151210'), soffit, flat('#1c1815'), flat('#1c1815')]);
  add(canopy, (RIGHT + 0.4 + slatsX0) / 2, (CANOPY_Y + CANOPY_TOP) / 2, canopyZ, building);
  add(box(RIGHT + 0.4 - slatsX0, 0.02, 0.02, flat('#ffd9a8')), (RIGHT + 0.4 + slatsX0) / 2, CANOPY_Y + 0.01, -0.1 + canopyDepth - 0.01, building);
  const lensMaterial = flat('#fff2da');
  const pool = glowTexture('rgba(255,212,160,0.36)', 'rgba(255,212,160,0)');
  for (const lx of downlightX) {
    for (const lz of [0.9, 2.1]) {
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), lensMaterial);
      lens.rotation.x = Math.PI / 2;
      add(lens, lx, CANOPY_Y - 0.002, lz, building);
    }
    level(2.4, 2.8, glow(pool, 0.75), lx, 0.006, 1.9);
  }

  // The shopfront: tall panes in slim bronze frames, a transom, and sliding doors in the middle.
  const frame = flat('#1d1914');
  const glassSky = canvasTexture(4, 128, (context) => {
    const gradient = context.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, 'rgba(150,170,205,0.2)');
    gradient.addColorStop(0.45, 'rgba(150,170,205,0.05)');
    gradient.addColorStop(1, 'rgba(150,170,205,0.02)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 128);
  });
  const glass = new THREE.MeshBasicMaterial({ map: glassSky, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const store = new THREE.Group();
  scene.add(store);
  const mullions = [LEFT, -7.4, -5.4, -3.6, -1.8, 1.8, 3.6, 5.6, 7.6, 9.6, 11.4, RIGHT];
  for (let i = 0; i < mullions.length - 1; i += 1) {
    const a = mullions[i];
    const b = mullions[i + 1];
    if (a === -1.8) {
      add(plane(b - a, CANOPY_Y - 3.2, glass), 0, 3.2 + (CANOPY_Y - 3.2) / 2, STORE_Z, store);
      continue;
    }
    add(plane(b - a, CANOPY_Y, glass), (a + b) / 2, CANOPY_Y / 2, STORE_Z, store);
  }
  for (const mx of mullions) add(box(0.07, CANOPY_Y, 0.14, frame), mx, CANOPY_Y / 2, STORE_Z, store);
  add(box(RIGHT - LEFT, 0.07, 0.14, frame), (LEFT + RIGHT) / 2, 3.2, STORE_Z, store);
  add(box(RIGHT - LEFT, 0.1, 0.16, frame), (LEFT + RIGHT) / 2, 0.05, STORE_Z, store);
  const doors: THREE.Object3D[] = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.Group();
    add(plane(1.8, 3.13, glass), 0, 3.13 / 2 + 0.03, 0, leaf);
    for (const ex of [-0.875, 0.875]) add(box(0.05, 3.13, 0.05, frame), ex, 3.13 / 2 + 0.03, 0, leaf);
    add(box(1.8, 0.06, 0.05, frame), 0, 0.06, 0, leaf);
    add(box(1.8, 0.05, 0.05, frame), 0, 3.15, 0, leaf);
    add(box(0.03, 1.4, 0.03, flat('#c8a46a')), -side * 0.72, 1.15, 0.07, leaf);
    add(leaf, side * 0.9, 0, STORE_Z - 0.06);
    leaf.userData.closedX = side * 0.9;
    doors.push(leaf, reflect(leaf));
  }

  // ----------------------------------------------------------------- lobby
  // What the street sees through the glass: a bright double-height showroom.
  const lobby = new THREE.Group();
  scene.add(lobby);
  const lobbyLamps = (xs: number[]): Lamp[] => xs.map((lx) => ({ position: [lx, CANOPY_Y - 0.1, -1.3], target: [lx, 1.6, LOBBY_BACK], intensity: 1.1, angle: 36, colour: '#ffdcae' }));
  const floor = lit({ map: textures.get('slab-06'), colour: '#f2e2c8', repeat: [(RIGHT - LEFT) / 1.2, 3 / 2.4], book: true, grout: 0.3, gloss: 1.3, ambient: 0.74, opacity: 0.86 });
  level(RIGHT - LEFT, -LOBBY_BACK, floor, (LEFT + RIGHT) / 2, 0, LOBBY_BACK / 2).renderOrder = -1;
  level(RIGHT - LEFT, -LOBBY_BACK, flat('#d8c8b0'), (LEFT + RIGHT) / 2, CANOPY_Y, LOBBY_BACK / 2, true, lobby);
  // Back walls either side of the gallery: stone shown whole, each slab under its own light.
  const leftWall = lit({ colour: '#d8cab5', noise: 0.08, ambient: 0.6, relief: { kind: 'prism', size: [0.3, 0.3], depth: 0.05 }, lamps: lobbyLamps([-8.1, -6.3, -4.6]) });
  add(plane(-3.6 - LEFT, CANOPY_Y, leftWall), (LEFT - 3.6) / 2, CANOPY_Y / 2, LOBBY_BACK, lobby);
  ['slab-03', 'slab-07', 'slab-09'].forEach((id, i) => {
    const sx = -8.1 + i * 1.75;
    const slab = lit({ map: textures.get(id), ambient: 0.75, gloss: 0.8, lamps: lobbyLamps([sx]) });
    add(box(1.2, 2.6, 0.04, [flat('#d9cdb9'), flat('#d9cdb9'), flat('#d9cdb9'), flat('#d9cdb9'), slab, flat('#d9cdb9')]), sx, 0.2 + 1.3, LOBBY_BACK + 0.03, lobby);
    add(box(1.34, 0.18, 0.3, flat('#2b2520')), sx, 0.09, LOBBY_BACK + 0.15, lobby);
  });
  // Right of the gallery: a book-matched Statuario feature wall behind the reception desk.
  const feature = lit({ map: textures.get('slab-10'), repeat: [(RIGHT - 3.6) / 1.2, CANOPY_Y / 2.4], book: true, grout: 0.35, gloss: 0.9, ambient: 0.56, lamps: lobbyLamps([5.4, 8.2, 11]) });
  add(plane(RIGHT - 3.6, CANOPY_Y, feature), (RIGHT + 3.6) / 2, CANOPY_Y / 2, LOBBY_BACK, lobby);
  const sideWall = lit({ colour: '#d3c4ae', noise: 0.08, ambient: 0.55, relief: { kind: 'ivy', size: [0.24, 0.5], depth: 0.03 } });
  for (const [wx, facing] of [[LEFT, 1], [RIGHT, -1]] as const) {
    const wall = plane(-LOBBY_BACK, CANOPY_Y, sideWall);
    wall.rotation.y = facing * Math.PI / 2;
    add(wall, wx, CANOPY_Y / 2, LOBBY_BACK / 2, lobby);
  }
  const deskFront = lit({ map: textures.get('slab-09'), ambient: 0.8, gloss: 0.7, lamps: [{ position: [8.2, 3.6, 0.5], target: [8.2, 0.5, -1.2], intensity: 0.8, angle: 40, colour: '#fff0da' }] });
  add(box(3, 1.02, 0.75, [flat('#3b2a1f'), flat('#3b2a1f'), flat('#5c4331'), flat('#3b2a1f'), deskFront, flat('#3b2a1f')]), 8.2, 0.51, -1.5, lobby);
  add(box(3.1, 0.04, 0.82, flat('#c9a46c')), 8.2, 1.04, -1.5, lobby);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.03, 12, 96), flat('#fff4de'));
  ring.rotation.x = Math.PI / 2;
  add(ring, 8.2, 3.3, -1.5, lobby);
  add(box(0.006, CANOPY_Y - 3.3, 0.006, flat('#2b2622')), 8.2, (CANOPY_Y + 3.3) / 2, -1.5, lobby);
  add(plane(2.6, 2.6, glow(glowTexture('rgba(255,236,205,0.45)', 'rgba(255,236,205,0)'), 1)), 8.2, 3.3, -1.45, lobby);
  // Track lighting on the ceiling.
  for (const tz of [-0.8, -2.2]) {
    add(box(RIGHT - LEFT - 0.6, 0.035, 0.035, flat('#1c1a18')), (LEFT + RIGHT) / 2, CANOPY_Y - 0.02, tz, lobby);
    for (let tx = LEFT + 0.8; tx < RIGHT - 0.4; tx += 1.2) {
      if (Math.abs(tx) < 3.4) continue;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 12), flat('#1c1a18'));
      can.rotation.x = 0.5;
      add(can, tx, CANOPY_Y - 0.11, tz, lobby);
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.032, 12), flat('#fff3dd'));
      spot.rotation.x = Math.PI / 2 + 0.5;
      add(spot, tx, CANOPY_Y - 0.17, tz - 0.035, lobby);
    }
  }

  // ------------------------------------------------- planters, trees, lights
  const planterStone = lit({ map: textures.get('slab-02'), colour: '#77726e', ambient: 0.4, gloss: 0.4, lamps: paveLamps });
  const sheet = leafSheet(rand);
  const leaves = foliage('#2b4526', '#c4a862', sheet);
  const shrubLeaves = foliage('#2f4a28', '#b39d5c', sheet);
  const greenery = new THREE.Group();
  scene.add(greenery);
  for (const side of [-1, 1]) {
    const x0 = 4.6;
    const x1 = 11;
    const w = x1 - x0;
    add(box(w, 0.55, 1.3, planterStone), side * (x0 + w / 2), 0.275, STORE_Z + 5.75, greenery);
    add(box(w, 0.012, 0.012, flat('#ffd9a8')), side * (x0 + w / 2), 0.02, STORE_Z + 6.41, greenery);
    // A low clipped hedge with shrubs, and one small tree in each planter.
    for (let i = 0; i < 9; i += 1) {
      const shrub = new THREE.Mesh(leafCrown(rand, 0.42 + rand() * 0.18, 170, 0.62), shrubLeaves);
      add(shrub, side * (x0 + 0.4 + i * (w - 0.8) / 8), 0.7, STORE_Z + 5.75 + (rand() - 0.5) * 0.4, greenery);
    }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.4, 10), flat('#2a2018'));
    add(trunk, side * 7.8, 0.55 + 1.2, STORE_Z + 5.7, greenery);
    add(new THREE.Mesh(leafCrown(rand, 1.2, 900), leaves), side * 7.8, 3.3, STORE_Z + 5.7, greenery);
    // Big trees beside the building.
    const bigTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 4.2, 12), flat('#241b14'));
    add(bigTrunk, side * 15.6, 2.1, STORE_Z + 3.6, greenery);
    add(new THREE.Mesh(leafCrown(rand, 2.5, 1900), leaves), side * 15.6, 5.6, STORE_Z + 3.6, greenery);
    add(new THREE.Mesh(leafCrown(rand, 1.6, 900), leaves), side * 14.5, 3.6, STORE_Z + 4.6, greenery);
    // Bollards: two flanking the steps and one at each end.
    for (const bx of [4.25, 12.4]) {
      add(box(0.14, 0.9, 0.14, flat('#2a2522')), side * bx, 0.45, STORE_Z + 6.25, greenery);
      add(box(0.145, 0.12, 0.145, flat('#ffdcae')), side * bx, 0.78, STORE_Z + 6.25, greenery);
      level(2.2, 2.2, glow(glowTexture('rgba(255,210,160,0.35)', 'rgba(255,210,160,0)'), 0.85), side * bx, 0.007, STORE_Z + 6.0);
    }
  }
  // Uplight pools at the foot of the big trees.
  for (const side of [-1, 1]) level(3.4, 3.4, glow(glowTexture('rgba(255,200,140,0.32)', 'rgba(255,200,140,0)'), 1), side * 15.6, 0.008, STORE_Z + 3.6);

  // Everything above the plaza, upside down in its polish.
  for (const object of [building, store, lobby, greenery]) reflect(object);

  return {
    doors,
    sky,
    update(z: number) {
      // The doors slide apart as the visitor reaches the steps.
      const open = Math.min(1, Math.max(0, (9 - z) / 5.5));
      const eased = open * open * (3 - 2 * open);
      doors.forEach((door) => { door.position.x = (door.userData.closedX as number) * (1 + eased * 1.9); });
    },
  };
}
