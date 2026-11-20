// A small art-directed surface shader for the showroom's walls, floors and
// stone. Each material carries its own few spotlights, so a room can be lit
// carefully without every surface in the building paying for every light.
import * as THREE from 'three';

export type Lamp = {
  position: [number, number, number];
  target: [number, number, number];
  /** Brightness where the beam lands (1 is fully lit). */
  intensity?: number;
  /** Outer half-angle of the beam, in degrees. */
  angle?: number;
  colour?: string;
};

export type Strip = {
  /** Distance of the linear ceiling light from the room's centre line (0 for a single centre strip). */
  x: number;
  y: number;
  from: number;
  to: number;
  colour?: string;
  /** Strength of its mirror image in glossy surfaces. */
  shine?: number;
  /** How much it lights matte surfaces. */
  fill?: number;
};

export type LitOptions = {
  colour?: string;
  map?: THREE.Texture;
  /** Tiles across and up the surface. */
  repeat?: [number, number];
  /** Joint darkness between tiles, 0 to 1. */
  grout?: number;
  /** Lay the tiles book-matched: each piece mirrors its neighbour side to side, so the veining meets across each joint. */
  book?: boolean;
  /** Mottling for plaster, 0 to 1. */
  noise?: number;
  ambient?: number;
  gloss?: number;
  lamps?: Lamp[];
  strip?: Strip;
  opacity?: number;
  side?: THREE.Side;
  /**
   * A cast relief pattern, after Hey Concrete's 3D wall panels: the surface is
   * shaded as if carved, with its grooves darkened. `size` is one module along
   * the wall and up it, in metres; `depth` is how deep the carving reads.
   */
  relief?: { kind: ReliefKind; size: [number, number]; depth: number };
};

export type ReliefKind = 'drape' | 'ridge' | 'prism' | 'billow' | 'ivy';
const RELIEF: Record<ReliefKind, number> = { drape: 1, ridge: 2, prism: 3, billow: 4, ivy: 5 };

const MAX_LAMPS = 4;
const FALLOFF = 0.18;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uUseMap;
  uniform vec3 uColour;
  uniform vec2 uRepeat;
  uniform float uGrout;
  uniform float uBook;
  uniform float uNoise;
  uniform float uAmbient;
  uniform float uGloss;
  uniform float uLevel;
  uniform float uOpacity;
  uniform vec3 uLampPos[${MAX_LAMPS}];
  uniform vec3 uLampDir[${MAX_LAMPS}];
  uniform vec3 uLampCol[${MAX_LAMPS}];
  uniform vec2 uLampCone[${MAX_LAMPS}];
  uniform vec4 uStrip;
  uniform vec3 uStripCol;
  uniform vec2 uStripMix;
  uniform float uRelief;
  uniform vec2 uReliefSize;
  uniform float uReliefDepth;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // Height of the relief, 0 in the grooves to 1 on the faces, in module units.
  float reliefHeight(vec2 q) {
    vec2 f = fract(q);
    if (uRelief < 1.5) { float x = 2.0 * f.x - 1.0; return sqrt(max(0.0, 1.0 - x * x)); }            // Drape: round flutes
    if (uRelief < 2.5) { return smoothstep(0.0, 0.78, f.x) * (1.0 - smoothstep(0.84, 1.0, f.x)); }   // Ridge: raked fins
    if (uRelief < 3.5) { vec2 d = abs(2.0 * f - 1.0); return 1.0 - max(d.x, d.y); }                   // Prism: pyramids
    if (uRelief < 4.5) { return 0.5 + 0.5 * sin(6.2832 * (q.y + 0.22 * sin(3.1416 * q.x))); }        // Billow: drifting waves
    float c = fract(q.y + abs(2.0 * f.x - 1.0) * 0.5);                                                // Ivy: chevron leaves
    return smoothstep(0.0, 0.12, c) * (1.0 - c);
  }

  void main() {
    vec3 albedo = uColour;
    if (uUseMap > 0.5) {
      vec2 uv = vUv * uRepeat;
      vec2 f = fract(uv);
      vec2 t = vUv;
      if (uRepeat.x * uRepeat.y > 1.001) {
        // Laid tiles: mirror alternate pieces so repeats never read as copies, and draw the joints.
        vec2 cell = floor(uv);
        // Book-matched: neighbours mirror side to side, the way slabs are cut and opened; rows simply repeat.
        t = uBook > 0.5
          ? vec2(1.0 - abs(2.0 * fract(uv.x * 0.5) - 1.0), f.y)
          : vec2(mix(f.x, 1.0 - f.x, step(0.5, hash(cell))), mix(f.y, 1.0 - f.y, step(0.5, hash(cell + 17.0))));
        vec2 width = fwidth(uv) * 1.1 + 0.0016;
        vec2 joint = smoothstep(vec2(0.0), width, f) * smoothstep(vec2(0.0), width, 1.0 - f);
        albedo *= texture2D(uMap, t).rgb * mix(1.0, 0.42, (1.0 - joint.x * joint.y) * uGrout);
      } else {
        albedo *= texture2D(uMap, t).rgb;
      }
    }
    if (uNoise > 0.0) {
      vec2 q = vWorld.xy * 1.3 + vWorld.zz * vec2(1.1, 0.7);
      float mottled = noise(q) * 0.55 + noise(q * 4.3) * 0.3 + noise(q * 17.0) * 0.15;
      albedo *= 1.0 + uNoise * (mottled - 0.5);
    }

    // Geometry below the floor is a mirror image, so it is lit as the thing it reflects.
    vec3 P = vec3(vWorld.x, abs(vWorld.y), vWorld.z);
    vec3 N = normalize(vNormal);
    if (uRelief > 0.5) {
      // Pattern coordinates run along the wall (whichever way it faces) and up it.
      vec2 q = vec2(abs(N.x) > abs(N.z) ? vWorld.z * sign(N.x) : -vWorld.x * sign(N.z), P.y) / uReliefSize;
      vec2 width = fwidth(q);
      float detail = 1.0 - smoothstep(0.12, 0.45, max(width.x, width.y)); // fade before it can shimmer
      float e = 0.01;
      float h = reliefHeight(q);
      vec2 slope = vec2(reliefHeight(q + vec2(e, 0.0)) - reliefHeight(q - vec2(e, 0.0)), reliefHeight(q + vec2(0.0, e)) - reliefHeight(q - vec2(0.0, e))) / (2.0 * e);
      // World-space directions of the pattern axes, from screen derivatives (no tangents needed).
      vec3 dp1 = dFdx(vWorld); vec3 dp2 = dFdy(vWorld);
      vec2 dq1 = dFdx(q); vec2 dq2 = dFdy(q);
      vec3 perp2 = cross(dp2, N); vec3 perp1 = cross(N, dp1);
      float det = dot(dp1, perp2);
      if (abs(det) > 1e-12) {
        vec3 gradU = (perp2 * dq1.x + perp1 * dq2.x) / det;
        vec3 gradV = (perp2 * dq1.y + perp1 * dq2.y) / det;
        vec3 grad = (slope.x * gradU + slope.y * gradV) * uReliefDepth * detail;
        N = normalize(N - grad);
      }
      albedo *= mix(0.86, mix(0.6, 1.06, h), detail);
    }
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 light = vec3(uAmbient);
    vec3 shine = vec3(0.0);

    for (int i = 0; i < ${MAX_LAMPS}; i++) {
      vec3 L = uLampPos[i] - P;
      float d = length(L);
      L /= d;
      float beam = smoothstep(uLampCone[i].x, uLampCone[i].y, dot(-L, uLampDir[i])) / (1.0 + ${FALLOFF.toFixed(2)} * d * d);
      light += uLampCol[i] * beam * max(dot(N, L), 0.0);
      shine += uLampCol[i] * beam * pow(max(dot(N, normalize(L + V)), 0.0), 120.0) * uGloss * 0.6;
    }

    if (uStripCol.r + uStripCol.g + uStripCol.b > 0.0) {
      float along = smoothstep(uStrip.w - 1.0, uStrip.w + 1.0, vWorld.z) * (1.0 - smoothstep(uStrip.z - 1.0, uStrip.z + 1.0, vWorld.z));
      // Matte light from the linear ceiling fitting.
      vec3 S = vec3(sign(vWorld.x) * uStrip.x, uStrip.y, vWorld.z) - vWorld;
      float sd = length(S);
      light += uStripCol * uStripMix.y * along * max(dot(N, S / sd), 0.0) / (1.0 + 0.1 * sd * sd);
      // Its mirror image sliding across polished stone as the visitor moves.
      vec3 R = reflect(-V, N);
      if (R.y > 0.02) {
        float reach = (uStrip.y - vWorld.y) / R.y;
        vec3 hit = vWorld + R * reach;
        float off = abs(abs(hit.x) - uStrip.x);
        float inside = step(uStrip.w, hit.z) * step(hit.z, uStrip.z);
        float fresnel = 0.18 + 0.82 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
        shine += uStripCol * uStripMix.x * uGloss * fresnel * inside * exp(-off * off / (0.006 + 0.004 * reach));
      }
    }

    gl_FragColor = vec4((albedo * light + shine) * uLevel, uOpacity);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function lit(options: LitOptions = {}) {
  const lamps = (options.lamps ?? []).slice(0, MAX_LAMPS);
  const position: THREE.Vector3[] = [];
  const direction: THREE.Vector3[] = [];
  const colour: THREE.Color[] = [];
  const cone: THREE.Vector2[] = [];
  for (let i = 0; i < MAX_LAMPS; i += 1) {
    const lamp = lamps[i];
    if (!lamp) {
      position.push(new THREE.Vector3(0, 100, 0));
      direction.push(new THREE.Vector3(0, -1, 0));
      colour.push(new THREE.Color(0, 0, 0));
      cone.push(new THREE.Vector2(0.9, 1));
      continue;
    }
    const from = new THREE.Vector3(...lamp.position);
    const to = new THREE.Vector3(...lamp.target);
    const distance = from.distanceTo(to);
    const outer = THREE.MathUtils.degToRad(lamp.angle ?? 34);
    position.push(from);
    direction.push(to.clone().sub(from).normalize());
    // Scale so "intensity" is the brightness where the beam lands, whatever the throw.
    colour.push(new THREE.Color(lamp.colour ?? '#ffe6c4').multiplyScalar((lamp.intensity ?? 1) * (1 + FALLOFF * distance * distance)));
    cone.push(new THREE.Vector2(Math.cos(outer), Math.cos(outer * 0.45)));
  }
  const strip = options.strip;
  const material = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uMap: { value: null },
        uUseMap: { value: options.map ? 1 : 0 },
        uColour: { value: new THREE.Color(options.colour ?? '#ffffff') },
        uRepeat: { value: new THREE.Vector2(...(options.repeat ?? [1, 1])) },
        uGrout: { value: options.grout ?? 0 },
        uBook: { value: options.book ? 1 : 0 },
        uNoise: { value: options.noise ?? 0 },
        uAmbient: { value: options.ambient ?? 0.3 },
        uGloss: { value: options.gloss ?? 0 },
        uLevel: { value: 1 },
        uOpacity: { value: options.opacity ?? 1 },
        uLampPos: { value: position },
        uLampDir: { value: direction },
        uLampCol: { value: colour },
        uLampCone: { value: cone },
        uStrip: { value: strip ? new THREE.Vector4(strip.x, strip.y, strip.from, strip.to) : new THREE.Vector4() },
        uStripCol: { value: strip ? new THREE.Color(strip.colour ?? '#ffe4bd') : new THREE.Color(0, 0, 0) },
        uStripMix: { value: new THREE.Vector2(strip?.shine ?? 1, strip?.fill ?? 1) },
        uRelief: { value: options.relief ? RELIEF[options.relief.kind] : 0 },
        uReliefSize: { value: new THREE.Vector2(...(options.relief?.size ?? [1, 1])) },
        uReliefDepth: { value: options.relief?.depth ?? 0 },
      },
    ]),
    vertexShader,
    fragmentShader,
    fog: true,
    transparent: (options.opacity ?? 1) < 1,
    side: options.side ?? THREE.FrontSide,
  });
  // UniformsUtils.merge clones values, so the texture is attached afterwards.
  material.uniforms.uMap.value = options.map ?? null;
  return material;
}

export const setLevel = (material: THREE.ShaderMaterial, level: number) => { material.uniforms.uLevel.value = level; };
