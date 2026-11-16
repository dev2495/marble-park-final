// Real 3D models of the bath products on show, built to the dimensions and
// finishes in the Comlux Comfort 2026–27 catalogue (and Grohe / Aquant data
// for the showers). Everything is generated from measurements, so a model is
// as wide, deep and tall as the product it stands for.
//
// Every model is built in "wall space": x runs along the wall, y is height
// above the floor, z is distance out from the wall. The caller places the
// returned group against a wall.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ------------------------------------------------------------- materials

export type Finish = { colour: string; matt: boolean };

/** Fired ceramic: matt glazes are soft and dry, gloss has a lacquer-like clear coat. */
export function ceramic({ colour, matt }: Finish) {
  return new THREE.MeshPhysicalMaterial({
    color: colour,
    roughness: matt ? 0.52 : 0.16,
    clearcoat: matt ? 0.08 : 1,
    clearcoatRoughness: matt ? 0.6 : 0.06,
    specularIntensity: matt ? 0.45 : 0.8,
    side: THREE.DoubleSide,
  });
}

export function metal(colour: string, roughness: number) {
  return new THREE.MeshPhysicalMaterial({ color: colour, metalness: 1, roughness, side: THREE.DoubleSide });
}

export const CHROME = () => metal('#e9ecef', 0.07);
export const MATT_BLACK = () => new THREE.MeshPhysicalMaterial({ color: '#1b1b1c', roughness: 0.42, metalness: 0.25, clearcoat: 0.3, clearcoatRoughness: 0.5 });

// -------------------------------------------------------------- profiles

/**
 * A rounded rectangle as a closed loop of points, always with the same number
 * of points whatever its size, so consecutive rings can be joined into a surface.
 * Points run counter-clockwise when seen from +y.
 */
function roundedRect(a: number, b: number, r: number, corner = 14, edge = 10): THREE.Vector2[] {
  const radius = Math.max(0.0005, Math.min(r, a, b));
  const points: THREE.Vector2[] = [];
  const centres: Array<[number, number, number]> = [
    [a - radius, b - radius, 0], [-(a - radius), b - radius, 0.5], [-(a - radius), -(b - radius), 1], [a - radius, -(b - radius), 1.5],
  ];
  for (let c = 0; c < 4; c += 1) {
    const [cx, cy, start] = centres[c];
    for (let i = 0; i < corner; i += 1) {
      const angle = (start + (i / corner) * 0.5) * Math.PI;
      points.push(new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
    }
    // The straight run to the next corner.
    const end = (start + 0.5) * Math.PI;
    const from = new THREE.Vector2(cx + Math.cos(end) * radius, cy + Math.sin(end) * radius);
    const [nx, ny, nextStart] = centres[(c + 1) % 4];
    const to = new THREE.Vector2(nx + Math.cos(nextStart * Math.PI) * radius, ny + Math.sin(nextStart * Math.PI) * radius);
    for (let i = 0; i < edge; i += 1) points.push(from.clone().lerp(to, i / edge));
  }
  return points;
}

type Ring = { a: number; b: number; r: number; y: number };

/**
 * A surface swept through horizontal rings, like a potter's profile. Each
 * group is shaded smoothly; a new group starts at a crisp edge (a rim).
 */
function sweep(groups: Ring[][], cap?: { y: number }) {
  const position: number[] = [];
  const index: number[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  for (const rings of groups) {
    position.length = 0;
    index.length = 0;
    const loops = rings.map((ring) => roundedRect(ring.a, ring.b, ring.r));
    const count = loops[0].length;
    loops.forEach((loop, i) => loop.forEach((p) => position.push(p.x, rings[i].y, -p.y)));
    for (let i = 0; i < rings.length - 1; i += 1) {
      for (let j = 0; j < count; j += 1) {
        const k = (j + 1) % count;
        const a = i * count + j;
        const b = i * count + k;
        const c = (i + 1) * count + k;
        const d = (i + 1) * count + j;
        index.push(a, b, d, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setIndex(index.slice());
    geometry.computeVertexNormals();
    geometries.push(geometry);
  }
  if (cap) {
    // A flat floor filling the last ring.
    const last = groups[groups.length - 1];
    const ring = last[last.length - 1];
    const shape = new THREE.Shape(roundedRect(ring.a, ring.b, ring.r));
    const floor = new THREE.ShapeGeometry(shape, 8);
    floor.rotateX(-Math.PI / 2);
    floor.translate(0, cap.y, 0);
    geometries.push(floor);
  }
  return geometries;
}

// ---------------------------------------------------------------- basins

export type BasinSpec = {
  id: string;
  /** Overall size in metres: width (along the wall), depth (out from it), height. */
  width: number; depth: number; height: number;
  /** Corner radius at the rim, and how much smaller the foot is than the rim on each side. */
  corner: number; taper: number;
  finish: Finish;
  wall?: number;
};

/** A countertop vessel basin: tapered outer wall, a thin crisp rim, and a filleted bowl inside. */
export function basin(spec: BasinSpec) {
  const a = spec.width / 2;
  const b = spec.depth / 2;
  const h = spec.height;
  const t = spec.wall ?? 0.0075;
  const r = spec.corner;
  const k = spec.taper;
  const outer: Ring[] = [];
  // Foot, with a small rounded heel where it meets the counter.
  for (let i = 0; i <= 5; i += 1) {
    const angle = (i / 5) * (Math.PI / 2);
    const heel = 0.012;
    outer.push({ a: a - k - heel * (1 - Math.sin(angle)), b: b - k - heel * (1 - Math.sin(angle)), r: Math.max(0.004, r - k), y: heel * (1 - Math.cos(angle)) });
  }
  // Outer wall flaring gently up to the rim.
  for (let i = 1; i <= 8; i += 1) {
    const s = i / 8;
    const ease = 1 - (1 - s) * (1 - s);
    outer.push({ a: a - k * (1 - ease), b: b - k * (1 - ease), r: r - k * (1 - ease), y: 0.012 + (h - 0.012) * s });
  }
  const rim: Ring[] = [
    { a, b, r, y: h },
    { a: a - t, b: b - t, r: Math.max(0.003, r - t), y: h },
  ];
  // Inside: down the wall, then round into a flat floor.
  const floorY = 0.024;
  const fillet = Math.min(0.05, (h - floorY) * 0.45);
  const inner: Ring[] = [];
  for (let i = 0; i <= 6; i += 1) {
    const s = i / 6;
    inner.push({ a: a - t - k * 0.8 * s, b: b - t - k * 0.8 * s, r: Math.max(0.003, r - t - k * 0.8 * s), y: h - (h - floorY - fillet) * s });
  }
  const ia = a - t - k * 0.8;
  const ib = b - t - k * 0.8;
  const ir = Math.max(0.003, r - t - k * 0.8);
  for (let i = 1; i <= 7; i += 1) {
    const angle = (i / 7) * (Math.PI / 2);
    const inset = fillet * (1 - Math.cos(angle));
    inner.push({ a: ia - inset, b: ib - inset, r: Math.max(0.003, ir - inset), y: floorY + fillet * (1 - Math.sin(angle)) });
  }
  const material = ceramic(spec.finish);
  const group = new THREE.Group();
  for (const geometry of sweep([outer, rim, inner], { y: floorY })) group.add(new THREE.Mesh(geometry, material));
  // Pop-up waste in the floor.
  const waste = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.033, 0.006, 40), spec.finish.matt ? MATT_BLACK() : CHROME());
  waste.position.y = floorY + 0.003;
  group.add(waste);
  group.userData.floorY = floorY;
  return group;
}

// ----------------------------------------------------------------- mixer

export type MixerSpec = { height: number; reach: number; finish: 'black' | 'chrome' };

/**
 * A tall single-lever basin mixer with a square body and flat spout.
 * Returns the group and the spout outlet (in the mixer's own space).
 */
export function mixer(spec: MixerSpec) {
  const material = spec.finish === 'black' ? MATT_BLACK() : CHROME();
  const group = new THREE.Group();
  const body = 0.038;
  const column = new THREE.Mesh(new RoundedBoxGeometry(body, spec.height, body, 4, 0.006), material);
  column.position.y = spec.height / 2;
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.052, 0.012, 0.052, 3, 0.004), material);
  base.position.y = 0.006;
  const spout = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.022, spec.reach, 4, 0.006), material);
  spout.position.set(0, spec.height - 0.04, spec.reach / 2 + body / 2 - 0.006);
  const lever = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.012, 0.085, 3, 0.004), material);
  lever.position.set(0, spec.height + 0.012, 0.03);
  lever.rotation.x = -0.18;
  const cap = new THREE.Mesh(new RoundedBoxGeometry(body * 0.92, 0.02, body * 0.92, 3, 0.005), material);
  cap.position.y = spec.height + 0.004;
  const aerator = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 24), metal('#9aa0a6', 0.3));
  const outlet = new THREE.Vector3(0, spec.height - 0.052, body / 2 - 0.006 + spec.reach - 0.022);
  aerator.position.copy(outlet);
  group.add(column, base, spout, lever, cap, aerator);
  return { group, outlet };
}

// ------------------------------------------------------------ wall-hung WC

export type ClosetSpec = {
  id: string;
  /** Catalogue size: depth (out from the wall) × width × height, in metres. */
  depth: number; width: number; height: number;
  finish: Finish;
  /** "square" (B-2351 family) or "round" (ROTO family). */
  form: 'square' | 'round';
};

/**
 * A wall-hung pan with its slim soft-close seat. The body is swept from the
 * wall outward through cross-sections whose width, top and underside follow
 * the product's side and plan profiles, closing smoothly at the front.
 */
export function closet(spec: ClosetSpec) {
  const square = spec.form === 'square';
  const W = spec.width / 2;
  const D = spec.depth;
  const H = spec.height;
  const seat = 0.024; // the seat and cover sit on top of the body
  const top = H - seat - 0.004;
  const planR = square ? 0.07 : W * 0.98; // how round the front is, seen from above
  const noseR = square ? 0.05 : 0.19; // how round the front is at the bottom, seen from the side
  const crownR = square ? 0.025 : 0.035; // and at the top
  const sectionR = square ? 0.05 : 0.13; // corner radius of each cross-section
  const front = (z: number, radius: number) => (z <= D - radius ? 1 : Math.sqrt(Math.max(0, 1 - ((z - (D - radius)) / radius) ** 2)));
  // Underside: tucked up near the wall (where the fixing frame hides) and rounding up into the nose.
  const under = (z: number) => {
    const tuck = square ? 0.07 * Math.max(0, 1 - z / 0.16) : 0.1 * Math.max(0, 1 - z / 0.22) ** 1.5;
    return tuck;
  };
  const steps: number[] = [];
  const n = 46;
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    // Denser near the front, where the shape changes fastest.
    steps.push(D * (1 - (1 - s) ** 1.6));
  }
  const position: number[] = [];
  const index: number[] = [];
  let count = 0;
  // Plan width: full until the front corners, which round in with radius planR.
  const widthAt = (z: number) => Math.max(0.003, W - planR + planR * front(z, planR));
  let last: { w: number; hh: number; cy: number } = { w: 0, hh: 0, cy: 0 };
  steps.forEach((z, i) => {
    const w = widthAt(z);
    const yTop = top - crownR * (1 - front(z, crownR));
    const yBottom = under(z) + noseR * (1 - front(z, noseR));
    const hh = Math.max(0.0015, (yTop - yBottom) / 2);
    const cy = (yTop + yBottom) / 2;
    const loop = roundedRect(w, hh, Math.min(sectionR, w, hh));
    last = { w, hh, cy };
    count = loop.length;
    for (const p of loop) position.push(p.x, cy + p.y, z);
    if (i > 0) {
      for (let j = 0; j < count; j += 1) {
        const k = (j + 1) % count;
        const a = (i - 1) * count + j;
        const b = (i - 1) * count + k;
        const c = i * count + k;
        const d = i * count + j;
        index.push(a, d, b, b, d, c);
      }
    }
  });
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  body.setIndex(index);
  body.computeVertexNormals();
  const material = ceramic(spec.finish);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(body, material));
  // The flat face that closes the front of the pan.
  const face = new THREE.ShapeGeometry(new THREE.Shape(roundedRect(last.w, last.hh, Math.min(sectionR, last.w, last.hh))), 6);
  face.translate(0, last.cy, D);
  group.add(new THREE.Mesh(face, material));

  // Seat and cover: the outline of the top of the pan, as a thin slab with softened edges.
  const outline: THREE.Vector2[] = [];
  const zFrom = 0.045;
  for (let i = 0; i <= 40; i += 1) {
    const z = zFrom + (D - zFrom) * (i / 40);
    const w = widthAt(z) - 0.004;
    outline.push(new THREE.Vector2(Math.max(0.002, w), z));
  }
  const shape = new THREE.Shape([...outline, ...outline.slice().reverse().map((p) => new THREE.Vector2(-p.x, p.y))]);
  const cover = new THREE.ExtrudeGeometry(shape, { depth: seat - 0.01, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 4, curveSegments: 24 });
  cover.rotateX(Math.PI / 2);
  const lid = new THREE.Mesh(cover, ceramic({ colour: spec.finish.colour, matt: spec.finish.matt }));
  lid.position.y = H - 0.005;
  // The shadow line between cover and pan.
  const gap = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  gap.position.y = top + 0.0015;
  gap.scale.set(0.985, 1, 0.985);
  group.add(lid, gap);
  // Concealed hinges, a hint of chrome at the back of the cover.
  for (const side of [-1, 1]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 16), CHROME());
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(side * 0.08, top + 0.008, zFrom + 0.012);
    group.add(hinge);
  }
  return group;
}

/** A concealed-cistern flush plate with two push buttons. */
export function flushPlate(finish: 'black' | 'chrome' | 'graphite', portrait = false) {
  const plateMaterial = finish === 'black' ? MATT_BLACK() : finish === 'chrome' ? CHROME() : metal('#4a4c50', 0.28);
  const buttonMaterial = finish === 'chrome' ? metal('#cfd4d9', 0.18) : finish === 'black' ? metal('#2b2b2d', 0.3) : metal('#5a5d62', 0.2);
  const [w, h] = portrait ? [0.156, 0.235] : [0.246, 0.165];
  const group = new THREE.Group();
  const plate = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.01, 4, 0.004), plateMaterial);
  plate.position.z = 0.005;
  group.add(plate);
  const buttons = portrait ? [[0, 0.036, 0.11, 0.056], [0, -0.03, 0.11, 0.07]] : [[-0.042, 0, 0.074, 0.048], [0.042, 0, 0.074, 0.048]];
  for (const [x, y, bw, bh] of buttons) {
    const button = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, 0.006, 3, 0.0025), buttonMaterial);
    button.position.set(x, y, 0.0115);
    group.add(button);
  }
  return group;
}

// --------------------------------------------------------------- showers

/** Brushed nozzle face for shower heads: holes in rings, drawn once and shared. */
let nozzleFace: THREE.CanvasTexture | null = null;
function nozzles() {
  if (nozzleFace) return nozzleFace;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 512, 512);
  context.fillStyle = '#1a1a1a';
  for (let ring = 1; ring <= 9; ring += 1) {
    const count = ring * 7;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + ring;
      context.beginPath();
      context.arc(256 + Math.cos(angle) * ring * 25, 256 + Math.sin(angle) * ring * 25, 4.2, 0, Math.PI * 2);
      context.fill();
    }
  }
  nozzleFace = new THREE.CanvasTexture(canvas);
  nozzleFace.colorSpace = THREE.SRGBColorSpace;
  return nozzleFace;
}

/**
 * An arm-mounted rain shower: wall flange, a straight arm out from the wall,
 * and a slim round head. Returns the centre of the spray face.
 */
export function armShower(spec: { arm: number; head: number; finish: THREE.Material }) {
  const group = new THREE.Group();
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 40), spec.finish);
  flange.rotation.x = Math.PI / 2;
  flange.position.z = 0.006;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, spec.arm, 24), spec.finish);
  arm.rotation.x = Math.PI / 2;
  arm.position.z = spec.arm / 2;
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.05, 24), spec.finish);
  elbow.position.set(0, -0.025, spec.arm);
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 20, 12), spec.finish);
  joint.position.z = spec.arm;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(spec.head / 2, spec.head / 2 - 0.004, 0.011, 72), spec.finish);
  head.position.set(0, -0.056, spec.arm);
  const faceMaterial = (spec.finish as THREE.MeshPhysicalMaterial).clone();
  faceMaterial.map = nozzles();
  const face = new THREE.Mesh(new THREE.CircleGeometry(spec.head / 2 - 0.008, 72), faceMaterial);
  face.rotation.x = Math.PI / 2;
  face.position.set(0, -0.0617, spec.arm);
  group.add(flange, arm, elbow, joint, head, face);
  return { group, spray: new THREE.Vector3(0, -0.063, spec.arm), radius: spec.head / 2 - 0.012 };
}

/**
 * A slide-rail hand shower set: rail with wall brackets, a holder, the handset
 * angled in it, and the hose looping down to the wall outlet. `aim` is the
 * direction the spray face points, in wall space.
 */
export function handShower(spec: { rail: [number, number]; holder: number; aim: THREE.Vector3; head: number; finish: THREE.Material; face: 'white' | 'chrome' }) {
  const m = spec.finish;
  const group = new THREE.Group();
  const [bottom, top] = spec.rail;
  const out = 0.055;
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, top - bottom, 28), m);
  rail.position.set(0, (top + bottom) / 2, out);
  group.add(rail);
  for (const y of [bottom + 0.02, top - 0.02]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, out, 18), m);
    arm.rotation.x = Math.PI / 2;
    arm.position.set(0, y, out / 2);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.008, 32), m);
    rose.rotation.x = Math.PI / 2;
    rose.position.set(0, y, 0.004);
    group.add(arm, rose);
  }
  for (const y of [bottom, top]) {
    const end = new THREE.Mesh(new THREE.SphereGeometry(0.0118, 20, 12), m);
    end.position.set(0, y, out);
    group.add(end);
  }
  // Holder on the rail.
  const holder = new THREE.Mesh(new RoundedBoxGeometry(0.036, 0.05, 0.05, 3, 0.008), m);
  holder.position.set(0, spec.holder, out + 0.02);
  group.add(holder);

  // The handset: handle below, head above, face pointing along `aim`.
  const aim = spec.aim.clone().normalize();
  const upHint = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(upHint, aim).normalize();
  const up = new THREE.Vector3().crossVectors(aim, right).normalize();
  const basis = new THREE.Matrix4().makeBasis(right, up, aim);
  const handset = new THREE.Group();
  const handleLength = 0.2;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0095, handleLength, 28), m);
  handle.position.y = -handleLength / 2 - spec.head * 0.36;
  const neck = new THREE.Mesh(new THREE.SphereGeometry(0.014, 20, 12), m);
  neck.position.y = -spec.head * 0.38;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(spec.head / 2, spec.head / 2 - 0.006, 0.026, 56), m);
  head.rotation.x = Math.PI / 2;
  const faceMaterial = spec.face === 'white'
    ? new THREE.MeshPhysicalMaterial({ color: '#f2f2f2', roughness: 0.35, map: nozzles() })
    : (m as THREE.MeshPhysicalMaterial).clone();
  if (spec.face === 'chrome') (faceMaterial as THREE.MeshPhysicalMaterial).map = nozzles();
  const face = new THREE.Mesh(new THREE.CircleGeometry(spec.head / 2 - 0.007, 56), faceMaterial);
  face.position.z = 0.0132;
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(spec.head / 2 - 0.004, 0.0035, 10, 56), m);
  bezel.position.z = 0.012;
  handset.add(handle, neck, head, face, bezel);
  handset.setRotationFromMatrix(basis);
  // The handle sits in the holder.
  const grip = new THREE.Vector3(0, -spec.head * 0.36 - 0.06, 0).applyMatrix4(basis);
  const holderAt = new THREE.Vector3(0, spec.holder + 0.012, out + 0.045);
  handset.position.copy(holderAt).sub(grip);
  group.add(handset);

  // Hose: from the end of the handle, looping down, to the outlet at the bottom of the rail.
  const handleEnd = new THREE.Vector3(0, -spec.head * 0.36 - handleLength, 0).applyMatrix4(basis).add(handset.position);
  const outlet = new THREE.Vector3(0.07, bottom - 0.06, 0.02);
  const sag = Math.min(handleEnd.y, outlet.y) - 0.42;
  const hose = new THREE.CatmullRomCurve3([
    handleEnd,
    handleEnd.clone().add(new THREE.Vector3(0, -0.12, 0.03)),
    new THREE.Vector3(handleEnd.x + 0.05, sag + 0.08, out + 0.09),
    new THREE.Vector3(0.05, sag, out + 0.06),
    new THREE.Vector3(0.08, outlet.y - 0.03, 0.05),
    outlet,
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 90, 0.0072, 12), m));
  const elbow = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 28), m);
  elbow.rotation.x = Math.PI / 2;
  elbow.position.set(outlet.x, outlet.y, 0.015);
  group.add(elbow);

  const spray = new THREE.Vector3(0, 0, 0.016).applyMatrix4(basis).add(handset.position);
  return { group, spray, aim, radius: spec.head / 2 - 0.012 };
}

/** A round concealed thermostat plate: three push buttons and a temperature dial. */
export function controlPlate(finish: THREE.Material) {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.079, 0.079, 0.01, 64), finish);
  plate.rotation.x = Math.PI / 2;
  plate.position.z = 0.005;
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.05, 48), finish);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0, -0.03, 0.035);
  group.add(plate, dial);
  for (const x of [-0.034, 0, 0.034]) {
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.0115, 0.0115, 0.008, 32), finish);
    button.rotation.x = Math.PI / 2;
    button.position.set(x, 0.034, 0.013);
    group.add(button);
  }
  return group;
}

/** A concealed ceiling shower panel, flush with the ceiling: rain field and two waterfall slots. */
export function ceilingPanel(spec: { width: number; depth: number; finish: THREE.MeshPhysicalMaterial }) {
  const canvas = document.createElement('canvas');
  canvas.width = 580;
  canvas.height = 480;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 580, 480);
  context.fillStyle = '#2a2016';
  for (let row = 0; row < 15; row += 1) {
    for (let col = 0; col < 26; col += 1) {
      context.beginPath();
      context.arc(118 + col * 13.8, 104 + row * 19, 3, 0, Math.PI * 2);
      context.fill();
    }
  }
  // The outer curtain: a ring of nozzles round the edge.
  for (let i = 0; i < 34; i += 1) {
    const t = i / 34;
    for (const [x, y] of [[40 + t * 500, 24], [40 + t * 500, 456], [22, 40 + t * 400], [558, 40 + t * 400]]) {
      context.beginPath();
      context.arc(x, y, 2.6, 0, Math.PI * 2);
      context.fill();
    }
  }
  // Two waterfall slots, front and back, running across the panel.
  context.fillRect(110, 50, 360, 11);
  context.fillRect(110, 419, 360, 11);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = spec.finish.clone();
  face.map = texture;
  const group = new THREE.Group();
  const box = new THREE.Mesh(new RoundedBoxGeometry(spec.width, 0.014, spec.depth, 3, 0.004), spec.finish);
  const underside = new THREE.Mesh(new THREE.PlaneGeometry(spec.width - 0.01, spec.depth - 0.01), face);
  underside.rotation.x = Math.PI / 2;
  underside.position.y = -0.0072;
  group.add(box, underside);
  return group;
}
