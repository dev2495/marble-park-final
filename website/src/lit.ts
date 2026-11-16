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
};

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
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
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
