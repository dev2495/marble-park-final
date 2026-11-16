// Running water. Every effect here turns on and off the way a real fitting
// does: the leading edge falls from the outlet when it starts, and the last
// of the water falls away when it stops. That is what lets a multi-function
// shower step cleanly from one spray pattern to the next.
import * as THREE from 'three';

export type Water = {
  object: THREE.Object3D;
  setOn(on: boolean): void;
  tick(time: number, delta: number): void;
};

const WATER = new THREE.Color('#dcecff');
const FALL = 4.8; // metres per second the leading edge travels

/** Tracks how far the first and last drops of a column have fallen. */
class Column {
  head = 0;
  tail = 0;
  on = false;
  constructor(public length: number) {}
  set(on: boolean) {
    if (on && !this.on) { this.head = 0; this.tail = 0; }
    this.on = on;
  }
  step(delta: number) {
    const limit = this.length * 1.25;
    if (this.on) this.head = Math.min(limit, this.head + FALL * delta);
    else this.tail = Math.min(limit, this.tail + FALL * delta);
  }
  /** 1 while water is actually reaching the far end. */
  get landing() { return this.head >= this.length && this.tail < this.length ? 1 : 0; }
}

export type SprayStyle = {
  /** Brightness of each thread. */
  alpha: number;
  /** Drops per metre once the thread breaks up. */
  beads: number;
  /** Distance from the nozzle over which a solid thread breaks into drops. */
  breakFrom: number;
  breakTo: number;
  /** How fast the beads travel, for the look of the flow. */
  speed: number;
};

export const FINE_RAIN: SprayStyle = { alpha: 0.46, beads: 2.6, breakFrom: 0.9, breakTo: 2.2, speed: 3.6 };
export const SOFT_DROPS: SprayStyle = { alpha: 0.7, beads: 6.5, breakFrom: 0.0, breakTo: 0.35, speed: 2.7 };
export const NEEDLE: SprayStyle = { alpha: 0.6, beads: 3.4, breakFrom: 0.5, breakTo: 1.3, speed: 4.4 };

/** Threads of water along the given paths (each a list of [x, y, z] points). */
function threads(paths: number[][][], style: SprayStyle, column: Column) {
  const position: number[] = [];
  const distance: number[] = [];
  const seed: number[] = [];
  paths.forEach((path, index) => {
    const s = Math.abs((Math.sin((index + 1) * 12.9898) * 43758.5453) % 1);
    let travelled = 0;
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      const step = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      position.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      distance.push(travelled, travelled + step);
      seed.push(s, s);
      travelled += step;
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('aDistance', new THREE.Float32BufferAttribute(distance, 1));
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
  geometry.computeBoundingSphere();
  const uniforms = {
    uTime: { value: 0 }, uHead: { value: 0 }, uTail: { value: 0 }, uLength: { value: column.length },
    uColour: { value: WATER }, uAlpha: { value: style.alpha }, uBeads: { value: style.beads },
    uBreak: { value: new THREE.Vector2(style.breakFrom, Math.max(style.breakTo, style.breakFrom + 0.01)) }, uSpeed: { value: style.speed },
  };
  const lines = new THREE.LineSegments(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aDistance; attribute float aSeed;
      varying float vDistance; varying float vSeed;
      void main() { vDistance = aDistance; vSeed = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHead, uTail, uLength, uAlpha, uBeads, uSpeed; uniform vec2 uBreak; uniform vec3 uColour;
      varying float vDistance; varying float vSeed;
      void main() {
        float visible = smoothstep(uTail - 0.14, uTail, vDistance) * (1.0 - smoothstep(uHead - 0.1, uHead, vDistance));
        float bead = fract(vDistance * uBeads - uTime * (uSpeed + vSeed * 0.9) + vSeed * 9.0);
        float pulse = smoothstep(0.0, 0.18, bead) * (1.0 - smoothstep(0.45, 0.95, bead));
        float broken = mix(1.0, pulse, smoothstep(uBreak.x, uBreak.y, vDistance));
        float fade = mix(1.0, 0.42, clamp(vDistance / uLength, 0.0, 1.0));
        gl_FragColor = vec4(uColour, uAlpha * fade * (0.58 + 0.42 * pulse) * broken * visible * (0.5 + 0.5 * vSeed));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lines.renderOrder = 5;
  return { object: lines, update(time: number) { uniforms.uTime.value = time; uniforms.uHead.value = column.head; uniforms.uTail.value = column.tail; } };
}

/** A soft glowing body behind the threads, so a spray reads as a volume of water catching the light. */
function body(x: number, z0: number, z1: number, top: number, floor: number, spread: number, strength: number, column: Column) {
  const height = top - floor;
  const width = (z1 - z0) * (1 + spread) + 0.1;
  const uniforms = {
    uTime: { value: 0 }, uHead: { value: 0 }, uTail: { value: 0 }, uLength: { value: height },
    uColour: { value: WATER }, uNarrow: { value: (z1 - z0) / width }, uStrength: { value: strength },
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uHead, uTail, uLength, uNarrow, uStrength; uniform vec3 uColour; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        float fallen = (1.0 - vUv.y) * uLength;
        float t = fallen / uLength;
        // The spray is as wide as the head at the top and opens out as it falls.
        float reach = mix(uNarrow, 1.0, t) * 0.5;
        float across = abs(vUv.x - 0.5) / reach;
        float shape = 1.0 - smoothstep(0.55, 1.0, across);
        float visible = smoothstep(uTail - 0.2, uTail, fallen) * (1.0 - smoothstep(uHead - 0.15, uHead, fallen));
        float streak = 0.7 + 0.3 * noise(vec2(vUv.x * 46.0, fallen * 2.2 - uTime * 3.0));
        gl_FragColor = vec4(uColour, shape * visible * streak * mix(0.17, 0.05, t) * uStrength);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  mesh.rotation.y = Math.PI / 2;
  mesh.position.set(x, (top + floor) / 2, (z0 + z1) / 2);
  mesh.renderOrder = 4;
  return { object: mesh, update(time: number) { uniforms.uTime.value = time; uniforms.uHead.value = column.head; uniforms.uTail.value = column.tail; } };
}

/** Small rings that open and fade where water lands, plus a low haze of spray. */
function landing(area: { x0: number; x1: number; z0: number; z1: number; y: number }, count: number, size = 1) {
  const position = new Float32Array(count * 3);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    position.set([area.x0 + Math.random() * (area.x1 - area.x0), area.y + 0.01, area.z0 + Math.random() * (area.z1 - area.z0)], i * 3);
    seed.set([Math.random(), 0.7 + Math.random() * 0.6], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3((area.x0 + area.x1) / 2, area.y, (area.z0 + area.z1) / 2), 4);
  const uniforms = { uTime: { value: 0 }, uAmount: { value: 0 }, uSize: { value: size }, uColour: { value: WATER } };
  const rings = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aSeed; uniform float uTime, uAmount, uSize; varying float vAlpha;
      void main() {
        float age = fract(uTime * 1.7 * aSeed.y + aSeed.x);
        vAlpha = (1.0 - age) * uAmount;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (5.0 + 46.0 * age) / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour; varying float vAlpha;
      void main() {
        // Squashed, because the rings lie flat and are seen at a low angle.
        vec2 p = (gl_PointCoord - 0.5) * vec2(2.0, 5.0);
        float r = length(p);
        gl_FragColor = vec4(uColour, smoothstep(1.0, 0.8, r) * smoothstep(0.4, 0.7, r) * vAlpha * 0.5);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  rings.renderOrder = 5;
  let amount = 0;
  return {
    object: rings as THREE.Object3D,
    update(time: number, delta: number, wanted: number) {
      amount += (wanted - amount) * Math.min(1, delta * 5);
      uniforms.uTime.value = time;
      uniforms.uAmount.value = amount;
    },
  };
}

export type Head = {
  /** Position of the spray face: its centre across the view (x), its extent along z and toward the viewer. */
  x: number; z0: number; z1: number; depth: number;
  top: number; floor: number;
  columns: number; rows: number;
  /** How much wider the spray is at the floor than at the head. */
  spread?: number;
  /** Draw each thread twice, a few millimetres apart, for a heavier drop. */
  heavy?: boolean;
  /** A round head: only nozzles inside the circle. */
  round?: boolean;
  /** A curtain: only the nozzles in the outer band (this fraction of the half-size is left empty). */
  hollow?: number;
};

/** A rain head: one straight thread per nozzle, drilled in even staggered rows. */
export function rainShower(head: Head, style: SprayStyle, glow = 1): Water {
  const { columns, rows } = head;
  const spread = head.spread ?? 0.14;
  const centreZ = (head.z0 + head.z1) / 2;
  const paths: number[][][] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const pitch = (head.z1 - head.z0) / columns;
      const z = head.z0 + (col + 0.5) * pitch + (row % 2 === 0 ? 0 : pitch / 2 - (col === columns - 1 ? pitch : 0));
      const x = head.x + (rows > 1 ? row / (rows - 1) - 0.5 : 0) * head.depth;
      const ex = (x - head.x) / (head.depth / 2);
      const ez = (z - centreZ) / ((head.z1 - head.z0) / 2);
      if (head.round && ex * ex + ez * ez > 1) continue;
      if (head.hollow && Math.abs(ex) < head.hollow && Math.abs(ez) < head.hollow) continue;
      const end = [x + (x - head.x) * spread, head.floor, z + (z - centreZ) * spread];
      paths.push([[x, head.top, z], end]);
      if (head.heavy) paths.push([[x + 0.004, head.top, z + 0.004], [end[0] + 0.004, end[1], end[2] + 0.004]]);
    }
  }
  const column = new Column(head.top - head.floor);
  const jets = threads(paths, style, column);
  const volume = body(head.x, head.z0, head.z1, head.top, head.floor, spread, glow, column);
  const half = (head.z1 - head.z0) / 2;
  const rings = landing({
    x0: head.x - head.depth * 0.7, x1: head.x + head.depth * 0.7,
    z0: centreZ - half * (1 + spread), z1: centreZ + half * (1 + spread), y: head.floor,
  }, Math.round(columns * rows * 0.4));
  const object = new THREE.Group();
  object.add(volume.object, jets.object, rings.object);
  return {
    object,
    setOn(on) { column.set(on); },
    tick(time, delta) {
      column.step(delta);
      jets.update(time);
      volume.update(time);
      rings.update(time, delta, column.landing);
    },
  };
}

export type Nozzle = {
  from: [number, number, number];
  /** Direction the spray leaves in (need not be normalised). */
  aim: [number, number, number];
  /** Half-angle of the cone, in degrees. */
  cone: number;
  jets: number;
  /** Speed the water leaves at, metres per second: faster throws further before gravity wins. */
  force: number;
  floor: number;
};

/** A hand shower: a small cone of threads that leave at an angle and curve down under gravity. */
export function handSpray(nozzle: Nozzle, style: SprayStyle): Water {
  const aim = new THREE.Vector3(...nozzle.aim).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(aim);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = aim.clone().cross(side).normalize();
  const paths: number[][][] = [];
  let longest = 0;
  const landings: number[][] = [];
  for (let i = 0; i < nozzle.jets; i += 1) {
    // Rings of nozzles around the face, like the real spray plate.
    const ring = Math.sqrt((i + 0.5) / nozzle.jets);
    const angle = i * 2.39996;
    const tilt = Math.tan(THREE.MathUtils.degToRad(nozzle.cone)) * ring;
    const direction = aim.clone().addScaledVector(side, Math.cos(angle) * tilt).addScaledVector(up, Math.sin(angle) * tilt).normalize();
    const start = new THREE.Vector3(...nozzle.from).addScaledVector(side, Math.cos(angle) * ring * 0.04).addScaledVector(up, Math.sin(angle) * ring * 0.04);
    const velocity = direction.multiplyScalar(nozzle.force);
    // Time to reach the floor under gravity.
    const drop = start.y - nozzle.floor;
    const flight = (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * 9.81 * drop)) / 9.81;
    const path: number[][] = [];
    let travelled = 0;
    let previous = start;
    for (let step = 0; step <= 14; step += 1) {
      const t = (step / 14) * flight;
      const point = new THREE.Vector3(start.x + velocity.x * t, start.y + velocity.y * t - 4.905 * t * t, start.z + velocity.z * t);
      travelled += point.distanceTo(previous);
      previous = point;
      path.push([point.x, point.y, point.z]);
    }
    longest = Math.max(longest, travelled);
    landings.push(path[path.length - 1]);
    paths.push(path);
  }
  const column = new Column(longest);
  const jets = threads(paths, style, column);
  const xs = landings.map((p) => p[0]);
  const zs = landings.map((p) => p[2]);
  const rings = landing({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y: nozzle.floor }, Math.round(nozzle.jets * 0.5), 0.8);
  const object = new THREE.Group();
  object.add(jets.object, rings.object);
  return {
    object,
    setOn(on) { column.set(on); },
    tick(time, delta) { column.step(delta); jets.update(time); rings.update(time, delta, column.landing); },
  };
}

/** A waterfall outlet: one unbroken sheet of water that narrows slightly as it falls. */
export function waterfall(sheet: { x: number; z: number; length: number; along: 'x' | 'z'; top: number; floor: number }): Water {
  const height = sheet.top - sheet.floor;
  const column = new Column(height);
  const uniforms = { uTime: { value: 0 }, uHead: { value: 0 }, uTail: { value: 0 }, uLength: { value: height }, uColour: { value: WATER } };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sheet.length, height), new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uHead, uTail, uLength; uniform vec3 uColour; varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main() {
        float fallen = (1.0 - vUv.y) * uLength;
        float t = fallen / uLength;
        float reach = mix(0.5, 0.36, t);
        float across = abs(vUv.x - 0.5) / reach;
        float edge = 1.0 - smoothstep(0.78, 1.0, across);
        float rim = smoothstep(0.6, 0.98, across) * edge;
        float visible = smoothstep(uTail - 0.2, uTail, fallen) * (1.0 - smoothstep(uHead - 0.12, uHead, fallen));
        float grain = noise(vec2(vUv.x * 34.0, fallen * 1.6 - uTime * 4.6));
        float ripple = 0.6 + 0.4 * noise(vec2(vUv.x * 5.0, fallen * 5.0 - uTime * 7.0));
        float alpha = edge * (0.12 + 0.3 * grain * ripple + 0.26 * rim) * mix(1.0, 0.6, t) * visible;
        gl_FragColor = vec4(mix(uColour, vec3(1.0), 0.3 * grain), alpha);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  if (sheet.along === 'z') mesh.rotation.y = Math.PI / 2;
  mesh.position.set(sheet.x, (sheet.top + sheet.floor) / 2, sheet.z);
  mesh.renderOrder = 5;
  const spanX = sheet.along === 'x' ? sheet.length * 0.3 : 0.05;
  const spanZ = sheet.along === 'z' ? sheet.length * 0.3 : 0.05;
  const rings = landing({ x0: sheet.x - spanX, x1: sheet.x + spanX, z0: sheet.z - spanZ, z1: sheet.z + spanZ, y: sheet.floor }, 22, 1.1);
  const object = new THREE.Group();
  object.add(mesh, rings.object);
  return {
    object,
    setOn(on) { column.set(on); },
    tick(time, delta) {
      column.step(delta);
      uniforms.uTime.value = time;
      uniforms.uHead.value = column.head;
      uniforms.uTail.value = column.tail;
      rings.update(time, delta, column.landing);
    },
  };
}

/** Mist outlets: slow soft clouds of fine droplets drifting down and outward. */
export function mist(outlets: Array<[number, number, number]>, reach: number, count = 320): Water {
  const position = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  const seed = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const outlet = outlets[i % outlets.length];
    position.set(outlet, i * 3);
    const angle = Math.random() * Math.PI * 2;
    const tilt = 0.15 + Math.random() * 0.5;
    drift.set([Math.cos(angle) * tilt, -1, Math.sin(angle) * tilt], i * 3);
    seed.set([Math.random(), 0.6 + Math.random() * 0.8], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aDrift', new THREE.BufferAttribute(drift, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(...outlets[0]), reach + 2);
  const uniforms = { uTime: { value: 0 }, uAmount: { value: 0 }, uReach: { value: reach }, uColour: { value: WATER } };
  const points = new THREE.Points(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aDrift; attribute vec2 aSeed; uniform float uTime, uAmount, uReach; varying float vAlpha;
      void main() {
        float age = fract(uTime * 0.42 * aSeed.y + aSeed.x);
        vec3 p = position + aDrift * age * uReach * vec3(0.55, 1.0, 0.55);
        p.x += sin(uTime * 0.9 + aSeed.x * 30.0) * 0.05 * age;
        vAlpha = sin(age * 3.14159) * uAmount;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (30.0 + 260.0 * age) / max(0.5, -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColour; varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(uColour, (1.0 - smoothstep(0.0, 1.0, r)) * vAlpha * 0.15);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  points.renderOrder = 5;
  let on = false;
  let amount = 0;
  return {
    object: points,
    setOn(value) { on = value; },
    tick(time, delta) {
      amount += ((on ? 1 : 0) - amount) * Math.min(1, delta * (on ? 1.6 : 2.6));
      uniforms.uTime.value = time;
      uniforms.uAmount.value = amount;
    },
  };
}

/**
 * A single smooth column of water from a spout. The mesh is one metre tall
 * with its top at the origin, so the caller positions the group at the spout
 * and sets the length each frame; the splash follows the lower end.
 */
export function stream(width = 0.016): Water & { setLength(length: number): void } {
  const column = new Column(0.3);
  const uniforms = { uTime: { value: 0 }, uHead: { value: 0 }, uTail: { value: 0 }, uLength: { value: 0.3 }, uColour: { value: WATER } };
  const geometry = new THREE.PlaneGeometry(width, 1);
  geometry.translate(0, -0.5, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uHead, uTail, uLength; uniform vec3 uColour; varying vec2 vUv;
      void main() {
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float fallen = (1.0 - vUv.y) * uLength;
        float visible = smoothstep(uTail - 0.04, uTail, fallen) * (1.0 - smoothstep(uHead - 0.03, uHead, fallen));
        float ripple = 0.82 + 0.18 * sin(fallen * 150.0 - uTime * 26.0 + sin(vUv.x * 7.0));
        float core = smoothstep(0.5, 1.0, across);
        gl_FragColor = vec4(mix(uColour * 0.82, vec3(1.0), core * 0.75), pow(across, 0.6) * ripple * visible * 0.92);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.renderOrder = 6;
  const rings = landing({ x0: -0.02, x1: 0.02, z0: -0.02, z1: 0.02, y: 0 }, 6, 0.5);
  rings.object.renderOrder = 6;
  const object = new THREE.Group();
  object.add(mesh, rings.object);
  return {
    object,
    setOn(on) { column.set(on); },
    setLength(length) { mesh.scale.y = length; uniforms.uLength.value = length; column.length = length; rings.object.position.y = -length; },
    tick(time, delta) {
      column.step(delta);
      uniforms.uTime.value = time;
      uniforms.uHead.value = column.head;
      uniforms.uTail.value = column.tail;
      rings.update(time, delta, column.landing);
    },
  };
}
