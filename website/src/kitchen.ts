// Kitchen products from Carysil's 2026 catalogues, built to their published
// dimensions: Waltz quartz workstation sinks with the rose gold accessory kit,
// built-in gas hobs, wall-mounted hoods and a built-in oven column.
//
// Models are in "wall space" like the bath models: x runs along the wall, y is
// height (0 is the worktop surface for sinks and hobs, the floor otherwise),
// z is distance out from the wall.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { metal } from './models';

// ------------------------------------------------------------- materials

function speckle(base: string, grains: string[], size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  let seed = 11;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < size * size * 0.12; i += 1) {
    context.fillStyle = grains[Math.floor(rand() * grains.length)];
    context.fillRect(rand() * size, rand() * size, 1 + rand() * 1.2, 1 + rand() * 1.2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

export type QuartzFinish = 'deep-black' | 'metallico' | 'snova';

/** Carysil's quartz composite: a dense matt surface with fine grains through it. */
export function quartz(finish: QuartzFinish) {
  const looks: Record<QuartzFinish, [string, string[], number]> = {
    'deep-black': ['#1b1b1d', ['#2a2a2d', '#111113', '#34343a'], 0.62],
    metallico: ['#4f4e4c', ['#6a6865', '#3b3a39', '#8a867f', '#2f2e2d'], 0.5],
    snova: ['#e8e5df', ['#f4f2ee', '#d7d3cc', '#cfcac2'], 0.55],
  };
  const [base, grains, roughness] = looks[finish];
  return new THREE.MeshPhysicalMaterial({
    map: speckle(base, grains), roughness, metalness: finish === 'metallico' ? 0.18 : 0,
    clearcoat: 0.25, clearcoatRoughness: 0.5, side: THREE.DoubleSide,
  });
}

export const ROSE_GOLD = () => metal('#d4a08a', 0.22);
const STAINLESS = () => metal('#c9cdd1', 0.28);
const BLACK_GLASS = () => new THREE.MeshPhysicalMaterial({ color: '#060607', roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, reflectivity: 0.6 });
const MATT_BODY = () => new THREE.MeshPhysicalMaterial({ color: '#1c1c1e', roughness: 0.5, metalness: 0.35 });

function woodTexture(base: string, dark: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 128);
  let seed = 5;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 90; i += 1) {
    context.strokeStyle = dark.replace('A', (0.08 + rand() * 0.25).toFixed(2));
    context.lineWidth = 0.6 + rand() * 1.8;
    const y = rand() * 128;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(170, y + rand() * 8 - 4, 340, y + rand() * 8 - 4, 512, y + rand() * 6 - 3);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ------------------------------------------------------------- geometry

/** A rounded rectangle with a fixed number of points, centred on the origin, in x/z. */
function loop(a: number, b: number, r: number, corner = 8, edge = 6) {
  const radius = Math.max(0.0005, Math.min(r, a, b));
  const points: THREE.Vector2[] = [];
  const centres: Array<[number, number, number]> = [[a - radius, b - radius, 0], [-(a - radius), b - radius, 0.5], [-(a - radius), -(b - radius), 1], [a - radius, -(b - radius), 1.5]];
  for (let c = 0; c < 4; c += 1) {
    const [cx, cy, start] = centres[c];
    for (let i = 0; i < corner; i += 1) {
      const angle = (start + (i / corner) * 0.5) * Math.PI;
      points.push(new THREE.Vector2(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius));
    }
    const end = (start + 0.5) * Math.PI;
    const from = new THREE.Vector2(cx + Math.cos(end) * radius, cy + Math.sin(end) * radius);
    const [nx, ny, nextStart] = centres[(c + 1) % 4];
    const to = new THREE.Vector2(nx + Math.cos(nextStart * Math.PI) * radius, ny + Math.sin(nextStart * Math.PI) * radius);
    for (let i = 0; i < edge; i += 1) points.push(from.clone().lerp(to, i / edge));
  }
  return points;
}

/** Join rings of equal point count into one surface (rings given top to bottom). */
function rings(list: Array<{ a: number; b: number; r: number; y: number }>, offsetZ = 0) {
  const loops = list.map((ring) => loop(ring.a, ring.b, ring.r));
  const count = loops[0].length;
  const position: number[] = [];
  const index: number[] = [];
  loops.forEach((points, i) => points.forEach((p) => position.push(p.x, list[i].y, p.y + offsetZ)));
  for (let i = 0; i < list.length - 1; i += 1) {
    for (let j = 0; j < count; j += 1) {
      const k = (j + 1) % count;
      index.push(i * count + j, (i + 1) * count + j, i * count + k, i * count + k, (i + 1) * count + j, (i + 1) * count + k);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Planar UVs from above, so the quartz grains run continuously.
  const uv: number[] = [];
  for (let i = 0; i < position.length; i += 3) uv.push(position[i] * 2, position[i + 2] * 2 + position[i + 1] * 2);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geometry;
}

// ------------------------------------------------------- workstation sink

export type WorkstationSpec = {
  id: string;
  /** Overall size along the wall and out from it, and the bowl opening, in metres. */
  width: number; depth: number; bowlWidth: number; bowlDepth: number;
  finish: QuartzFinish;
  /** The FE models carry the faucet on a deck behind the bowl. */
  deck: boolean;
  accessories: Array<'board' | 'colander' | 'mat'>;
};

/**
 * A Carysil Waltz workstation sink, inset into a worktop: the flange, a ledge
 * along the front and back walls for the accessories to ride on, a deep bowl
 * with a rose gold waste, the ALA 1512 pull-down faucet and SD-001 soap
 * dispenser behind it, and the accessories on the ledge. y = 0 is the top of
 * the worktop. Returns the group, the faucet outlet, the bowl floor height,
 * and the opening (for cutting the worktop), all in the sink's own space.
 */
export function workstation(spec: WorkstationSpec) {
  const group = new THREE.Group();
  const body = quartz(spec.finish);
  const rose = ROSE_GOLD();
  const W = spec.width / 2;
  const D = spec.depth / 2;
  const a = spec.bowlWidth / 2;
  const b = spec.bowlDepth / 2;
  // The bowl sits toward the front; the space behind it is the faucet deck.
  const front = spec.deck ? 0.035 : (spec.depth - spec.bowlDepth) / 2 - 0.01;
  const bowlZ = D - front - b; // centre of the bowl, measured from the sink's centre (+z is the front)
  const flangeY = 0.004;
  const floorY = -0.205;
  const ledgeY = -0.028;
  const ledge = 0.014;

  // Flange: the sink's top face, with the bowl opening cut out, and its thin edge.
  const outline = new THREE.Shape(loop(W, D, 0.03).map((p) => new THREE.Vector2(p.x, p.y)));
  outline.holes.push(new THREE.Path(loop(a, b, 0.02).map((p) => new THREE.Vector2(p.x, p.y + bowlZ))));
  const flange = new THREE.ShapeGeometry(outline, 6);
  flange.rotateX(Math.PI / 2);
  flange.translate(0, flangeY, 0);
  const uv = flange.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2);
  group.add(new THREE.Mesh(flange, body));
  group.add(new THREE.Mesh(rings([{ a: W, b: D, r: 0.03, y: flangeY }, { a: W, b: D, r: 0.03, y: -0.002 }]), body));

  // Bowl: down to the ledge, a step in along the long sides, then down to the floor.
  const bowl = rings([
    { a, b, r: 0.02, y: flangeY },
    { a, b, r: 0.02, y: ledgeY },
    { a, b: b - ledge, r: 0.02, y: ledgeY },
    { a: a - 0.006, b: b - ledge - 0.008, r: 0.026, y: floorY + 0.02 },
    { a: a - 0.02, b: b - ledge - 0.022, r: 0.03, y: floorY },
  ], bowlZ);
  group.add(new THREE.Mesh(bowl, body));
  const floorShape = new THREE.ShapeGeometry(new THREE.Shape(loop(a - 0.02, b - ledge - 0.022, 0.03).map((p) => new THREE.Vector2(p.x, p.y))), 6);
  floorShape.rotateX(Math.PI / 2);
  floorShape.translate(0, floorY, bowlZ);
  group.add(new THREE.Mesh(floorShape, body));
  // Rose gold waste (WHC-001), off-centre toward the back as on the catalogue sinks.
  const waste = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.046, 0.006, 48), rose);
  waste.position.set(a * 0.45, floorY + 0.003, bowlZ - b * 0.25);
  const grate = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.0065, 32), metal('#7c5f52', 0.4));
  grate.position.copy(waste.position);
  group.add(waste, grate);
  // FG-003 floor grid: a stainless wire rack on the bowl floor.
  const wire = STAINLESS();
  const gridY = floorY + 0.012;
  for (let x = -a + 0.05; x <= a - 0.05; x += 0.045) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 2 * (b - ledge - 0.05), 6), wire);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(x, gridY, bowlZ);
    group.add(rod);
  }
  for (const zz of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 2 * a - 0.08, 6), wire);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, gridY + 0.004, bowlZ + zz * (b - ledge - 0.06));
    group.add(rail);
  }

  // Accessories riding on the ledges, from the left end of the bowl.
  const span = 2 * (b - ledge) + 2 * ledge - 0.006; // they rest on both ledges
  let cursor = 0; // left edge of the accessory being placed
  const board = (width: number) => {
    const material = new THREE.MeshPhysicalMaterial({ map: woodTexture('#c99b6b', 'rgba(110,70,40,A)'), roughness: 0.55, clearcoat: 0.2 });
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, 0.022, span, 3, 0.006), material);
    mesh.position.set(cursor + width / 2, ledgeY + 0.011, bowlZ);
    group.add(mesh);
    // A few cut vegetables make it a working board.
    const slices = new THREE.MeshPhysicalMaterial({ color: '#e0662f', roughness: 0.6 });
    for (let i = 0; i < 5; i += 1) {
      const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 20), slices);
      slice.position.set(cursor + width * 0.3 + i * 0.012, ledgeY + 0.025 + i * 0.0005, bowlZ - span * 0.15 + i * 0.008);
      slice.rotation.z = 0.25;
      group.add(slice);
    }
  };
  const colander = (width: number) => {
    const holes = document.createElement('canvas');
    holes.width = 128;
    holes.height = 128;
    const context = holes.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = '#000';
    for (let y = 4; y < 128; y += 8) for (let x = (y / 8) % 2 ? 8 : 4; x < 128; x += 8) { context.beginPath(); context.arc(x, y, 2.2, 0, Math.PI * 2); context.fill(); }
    const alpha = new THREE.CanvasTexture(holes);
    alpha.wrapS = THREE.RepeatWrapping;
    alpha.wrapT = THREE.RepeatWrapping;
    alpha.repeat.set(3, 3);
    const steel = new THREE.MeshPhysicalMaterial({ color: '#c9cdd1', metalness: 1, roughness: 0.3, alphaMap: alpha, alphaTest: 0.5, side: THREE.DoubleSide });
    const depth = 0.085;
    const inner = span - 0.03;
    const tray = rings([
      { a: width / 2, b: inner / 2, r: 0.015, y: 0 },
      { a: width / 2 - 0.012, b: inner / 2 - 0.012, r: 0.015, y: -depth },
    ]);
    const floor = new THREE.ShapeGeometry(new THREE.Shape(loop(width / 2 - 0.012, inner / 2 - 0.012, 0.015).map((p) => new THREE.Vector2(p.x, p.y))), 4);
    floor.rotateX(Math.PI / 2);
    floor.translate(0, -depth, 0);
    const lip = new THREE.Mesh(rings([{ a: width / 2 + 0.004, b: span / 2, r: 0.015, y: 0.003 }, { a: width / 2, b: inner / 2, r: 0.015, y: 0.003 }]), STAINLESS());
    const basket = new THREE.Group();
    basket.add(new THREE.Mesh(tray, steel), new THREE.Mesh(floor, steel), lip);
    // Produce in the colander.
    const fruit = new THREE.MeshPhysicalMaterial({ color: '#7fb04a', roughness: 0.35, clearcoat: 0.6 });
    const tomato = new THREE.MeshPhysicalMaterial({ color: '#c8331f', roughness: 0.3, clearcoat: 0.8 });
    for (let i = 0; i < 6; i += 1) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 14), i % 2 ? tomato : fruit);
      ball.position.set((i % 3 - 1) * 0.045, -depth + 0.03, (Math.floor(i / 3) - 0.5) * 0.05);
      basket.add(ball);
    }
    basket.position.set(cursor + width / 2, ledgeY, bowlZ);
    group.add(basket);
  };
  const mat = (width: number) => {
    const steel = STAINLESS();
    const silicone = new THREE.MeshPhysicalMaterial({ color: '#2b2b2d', roughness: 0.7 });
    for (let x = 0.008; x < width; x += 0.019) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, span, 10), steel);
      rod.rotation.x = Math.PI / 2;
      rod.position.set(cursor + x, ledgeY + 0.005, bowlZ);
      group.add(rod);
    }
    for (const zz of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(width, 0.008, 0.02), silicone);
      strip.position.set(cursor + width / 2, ledgeY + 0.005, bowlZ + zz * span * 0.36);
      group.add(strip);
    }
  };
  const sizes = { board: 0.3, colander: 0.22, mat: 0.24 };
  const place = { board, colander, mat };
  // Half the accessories from the left end, the rest from the right; the water falls between.
  const items = spec.accessories;
  const leftCount = items.length > 1 ? Math.ceil(items.length / 2) : items[0] === 'board' ? 1 : 0;
  let leftEnd = -a + 0.012;
  for (const item of items.slice(0, leftCount)) { cursor = leftEnd; place[item](sizes[item]); leftEnd += sizes[item] + 0.008; }
  let rightStart = a - 0.012;
  for (const item of items.slice(leftCount).reverse()) { rightStart -= sizes[item]; cursor = rightStart; place[item](sizes[item]); rightStart -= 0.008; }
  const openX = (leftEnd + rightStart) / 2;

  // ALA 1512 pull-down faucet, rose gold, on the deck or the worktop behind the bowl.
  const faucetZ = bowlZ - b - (spec.deck ? 0.055 : 0.05);
  const faucet = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.02, 40), rose);
  base.position.y = 0.01;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.2, 40), rose);
  column.position.y = 0.12;
  const reach = Math.min(0.24, b + 0.07);
  const neck = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.21, 0), new THREE.Vector3(0, 0.36, 0.0), new THREE.Vector3(0, 0.45, reach * 0.35),
    new THREE.Vector3(0, 0.44, reach * 0.78), new THREE.Vector3(0, 0.39, reach),
  ]);
  const gooseneck = new THREE.Mesh(new THREE.TubeGeometry(neck, 60, 0.015, 24), rose);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.1, 32), rose);
  head.position.set(0, 0.34, reach);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), metal('#3a3330', 0.5));
  face.rotation.x = Math.PI / 2;
  face.position.set(0, 0.289, reach);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.006, 0.075, 16), rose);
  lever.rotation.z = -1.1;
  lever.position.set(0.045, 0.17, 0);
  const leverHub = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 24), rose);
  leverHub.rotation.z = Math.PI / 2;
  leverHub.position.set(0.024, 0.15, 0);
  faucet.add(base, column, gooseneck, head, face, lever, leverHub);
  faucet.position.set(openX, flangeY, faucetZ);
  group.add(faucet);
  const outlet = new THREE.Vector3(openX, flangeY + 0.287, faucetZ + reach);

  // SD-001 soap dispenser beside it.
  const dispenser = new THREE.Group();
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 32), rose);
  collar.position.y = 0.006;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.07, 20), rose);
  stem.position.y = 0.045;
  const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.022, 28), rose);
  pump.position.y = 0.09;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 12), rose);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.09, 0.03);
  dispenser.add(collar, stem, pump, nozzle);
  dispenser.position.set(openX + (openX < 0 ? 0.13 : -0.13), flangeY, faucetZ + 0.005);
  group.add(dispenser);

  return { group, outlet, floorY: floorY + 0.012, opening: { a: a + 0.004, b: b + 0.004, z: bowlZ } };
}

// -------------------------------------------------------------------- hobs

type Burner = { x: number; z: number; size: 'big' | 'mini' | 'dual' };

export type HobSpec = { id: string; width: number; depth: number; burners: Burner[]; lit?: number[]; cookware?: Array<{ burner: number; kind: 'pan' | 'pot' }> };

const canvasMaterial = (width: number, height: number, paint: (context: CanvasRenderingContext2D) => void, extra: THREE.MeshBasicMaterialParameters = {}) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d')!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, ...extra });
};

/** The soft studio highlight that runs across polished black glass. */
function sheen(width: number, height: number) {
  const material = canvasMaterial(256, 256, (context) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, 256, 256);
    const band = context.createLinearGradient(0, 256, 256, 0);
    band.addColorStop(0.28, 'rgba(255,255,255,0)');
    band.addColorStop(0.4, 'rgba(255,255,255,0.16)');
    band.addColorStop(0.46, 'rgba(255,255,255,0.05)');
    band.addColorStop(0.62, 'rgba(255,255,255,0.1)');
    band.addColorStop(0.7, 'rgba(255,255,255,0)');
    context.fillStyle = band;
    context.fillRect(0, 0, 256, 256);
    const top = context.createLinearGradient(0, 0, 0, 256);
    top.addColorStop(0, 'rgba(255,255,255,0.12)');
    top.addColorStop(0.25, 'rgba(255,255,255,0)');
    context.fillStyle = top;
    context.fillRect(0, 0, 256, 256);
  }, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

/** A brass burner with its cast-iron pan support, at the given size. */
function burner(size: Burner['size'], brass: THREE.Material, iron: THREE.Material, cap: THREE.Material) {
  const group = new THREE.Group();
  const r = size === 'big' ? 0.062 : size === 'mini' ? 0.046 : 0.04;
  // Spill tray ring, flame crown with its ports, and the cap.
  const profile = [
    new THREE.Vector2(0, 0), new THREE.Vector2(r * 1.3, 0), new THREE.Vector2(r * 1.32, 0.004), new THREE.Vector2(r * 1.12, 0.008),
    new THREE.Vector2(r, 0.012), new THREE.Vector2(r, 0.022), new THREE.Vector2(r * 0.92, 0.024), new THREE.Vector2(r * 0.8, 0.02),
    new THREE.Vector2(r * 0.6, 0.02), new THREE.Vector2(r * 0.56, 0.03), new THREE.Vector2(r * 0.34, 0.032), new THREE.Vector2(r * 0.3, 0.026), new THREE.Vector2(0, 0.026),
  ];
  group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 64), brass));
  const ports = new THREE.Mesh(new THREE.TorusGeometry(r * 0.99, 0.0012, 4, 64), new THREE.MeshBasicMaterial({ color: '#2a1d0e' }));
  ports.rotation.x = Math.PI / 2;
  ports.position.y = 0.017;
  group.add(ports);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.32, 0.008, 40), cap);
  crown.position.y = 0.034;
  group.add(crown);
  // Round cast-iron pan support: a ring with fingers reaching in, on short feet.
  const ringR = r * 2.05;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(ringR, 0.006, 10, 64), iron);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.032;
  group.add(ring);
  const fingers = size === 'big' ? 6 : 4;
  for (let i = 0; i < fingers; i += 1) {
    const angle = (i / fingers) * Math.PI * 2 + Math.PI / fingers;
    const length = ringR - r * 0.8;
    const finger = new THREE.Mesh(new RoundedBoxGeometry(length, 0.014, 0.009, 2, 0.003), iron);
    finger.position.set(Math.cos(angle) * (ringR - length / 2), 0.038, Math.sin(angle) * (ringR - length / 2));
    finger.rotation.y = -angle;
    group.add(finger);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.03, 8), iron);
    foot.position.set(Math.cos(angle) * ringR, 0.015, Math.sin(angle) * ringR);
    group.add(foot);
  }
  return { group, radius: r, support: ringR };
}

/** A ring of blue flame that flickers. */
function flame(radius: number) {
  const count = 36;
  const geometry = new THREE.ConeGeometry(0.0045, 0.026, 6, 1, true);
  geometry.translate(0, 0.013, 0);
  const material = new THREE.MeshBasicMaterial({ color: '#3f7dff', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const tips = new THREE.MeshBasicMaterial({ color: '#9fc2ff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const group = new THREE.Group();
  for (const [mesh, scale] of [[new THREE.InstancedMesh(geometry, material, count), 1], [new THREE.InstancedMesh(geometry, tips, count), 0.55]] as const) {
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2;
      matrix.compose(new THREE.Vector3(Math.cos(angle) * radius, 0.018, Math.sin(angle) * radius),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(angle) * 0.75, 0, -Math.cos(angle) * 0.75)), new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, matrix);
    }
    group.add(mesh);
  }
  const halo = new THREE.Mesh(new THREE.RingGeometry(radius * 0.8, radius * 1.45, 48), new THREE.MeshBasicMaterial({ color: '#2a5cff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.021;
  group.add(halo);
  return group;
}

/** Cookware: a red ceramic-coated sauté pan with sauce and a wooden spatula, or a steel pot with its lid. */
function cookware(kind: 'pan' | 'pot') {
  const group = new THREE.Group();
  if (kind === 'pan') {
    const outer = new THREE.MeshPhysicalMaterial({ color: '#7a1f24', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
    const profile = [new THREE.Vector2(0, 0), new THREE.Vector2(0.1, 0), new THREE.Vector2(0.13, 0.015), new THREE.Vector2(0.142, 0.06), new THREE.Vector2(0.145, 0.072), new THREE.Vector2(0.138, 0.072), new THREE.Vector2(0.13, 0.02), new THREE.Vector2(0.1, 0.008), new THREE.Vector2(0, 0.008)];
    group.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 64), outer));
    const sauce = new THREE.Mesh(new THREE.CircleGeometry(0.128, 48), new THREE.MeshPhysicalMaterial({ color: '#b8401e', roughness: 0.35, clearcoat: 0.8 }));
    sauce.rotation.x = -Math.PI / 2;
    sauce.position.y = 0.035;
    group.add(sauce);
    const handle = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.02, 0.03, 3, 0.008), new THREE.MeshPhysicalMaterial({ color: '#1a1a1a', roughness: 0.5 }));
    handle.position.set(0.24, 0.07, 0);
    handle.rotation.z = 0.12;
    group.add(handle);
    const spatula = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.006, 0.26, 2, 0.002), new THREE.MeshPhysicalMaterial({ color: '#c08b54', roughness: 0.6 }));
    spatula.position.set(-0.02, 0.08, 0.04);
    spatula.rotation.set(0.5, 0.4, 0);
    group.add(spatula);
  } else {
    const steel = metal('#d6d9dc', 0.18);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.098, 0.16, 64, 1, true), steel);
    body.position.y = 0.08;
    const base = new THREE.Mesh(new THREE.CircleGeometry(0.098, 48), steel);
    base.rotation.x = Math.PI / 2;
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.104, 48, 12, 0, Math.PI * 2, 0, 0.5), steel);
    lid.scale.y = 0.4;
    lid.position.y = 0.155;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.02, 24), new THREE.MeshPhysicalMaterial({ color: '#111', roughness: 0.4 }));
    knob.position.y = 0.2;
    group.add(body, base, lid, knob);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 8, 24, Math.PI), steel);
      ear.position.set(side * 0.108, 0.13, 0);
      ear.rotation.set(0, side > 0 ? 0 : Math.PI, Math.PI / 2);
      group.add(ear);
    }
  }
  return group;
}

/**
 * A built-in gas hob: 8 mm black tempered glass with printed rings, brass
 * burners on cast-iron pan supports and chrome-ringed knobs along the front.
 * y = 0 is the worktop.
 */
export function hob(spec: HobSpec) {
  const group = new THREE.Group();
  const glassMaterial = BLACK_GLASS();
  const glass = new THREE.Mesh(new RoundedBoxGeometry(spec.width, 0.008, spec.depth, 4, 0.0035), glassMaterial);
  glass.position.y = 0.004;
  group.add(glass);
  // The fine white printing on the glass.
  const print = canvasMaterial(1024, Math.round(1024 * spec.depth / spec.width), (context) => {
    const w = 1024;
    const h = Math.round(1024 * spec.depth / spec.width);
    context.fillStyle = '#000';
    context.fillRect(0, 0, w, h);
    context.strokeStyle = 'rgba(255,255,255,0.22)';
    context.lineWidth = 2;
    for (const item of spec.burners) {
      const cx = (item.x / spec.width + 0.5) * w;
      const cy = (item.z / spec.depth + 0.5) * h;
      const r = (item.size === 'big' ? 0.15 : 0.11) / spec.width * w;
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.stroke();
    }
    context.fillStyle = 'rgba(255,255,255,0.5)';
    context.font = '600 18px sans-serif';
    context.textAlign = 'right';
    context.fillText('C A R Y S I L', w - 40, h - 22);
  }, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const printPlane = new THREE.Mesh(new THREE.PlaneGeometry(spec.width - 0.01, spec.depth - 0.01), print);
  printPlane.rotation.x = -Math.PI / 2;
  printPlane.position.y = 0.0085;
  group.add(printPlane);
  const highlight = sheen(spec.width, spec.depth);
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.y = 0.009;
  group.add(highlight);
  const brass = metal('#cfa760', 0.26);
  const iron = new THREE.MeshPhysicalMaterial({ color: '#121212', roughness: 0.75, metalness: 0.3 });
  const cap = new THREE.MeshPhysicalMaterial({ color: '#0e0e0e', roughness: 0.35, metalness: 0.6 });
  const flames: THREE.Object3D[] = [];
  spec.burners.forEach((item, i) => {
    const part = burner(item.size, brass, iron, cap);
    part.group.position.set(item.x, 0.008, item.z);
    group.add(part.group);
    if (spec.lit?.includes(i)) {
      const fire = flame(part.radius * 1.0);
      fire.position.set(item.x, 0.008, item.z);
      group.add(fire);
      flames.push(fire);
    }
    const ware = spec.cookware?.find((entry) => entry.burner === i);
    if (ware) {
      const piece = cookware(ware.kind);
      piece.position.set(item.x, 0.008 + 0.044, item.z);
      group.add(piece);
    }
  });
  const chrome = metal('#dfe2e5', 0.12);
  const knobMaterial = metal('#a9adb2', 0.3);
  const n = spec.burners.length;
  for (let i = 0; i < n; i += 1) {
    const x = (i - (n - 1) / 2) * 0.055;
    const z = spec.depth / 2 - 0.045;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0025, 8, 40), chrome);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.0095, z);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.021, 0.026, 40), knobMaterial);
    knob.position.set(x, 0.022, z);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.0175, 0.0175, 0.002, 40), chrome);
    top.position.set(x, 0.0355, z);
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.002, 0.012), new THREE.MeshBasicMaterial({ color: '#222' }));
    mark.position.set(x, 0.0368, z - 0.006);
    group.add(ring, knob, top, mark);
  }
  return { group, flames };
}

// ------------------------------------------------------------------- hoods

export type HoodKind = 'miracle' | 'tune-t' | 'crysta-plus';

/** Touch controls lit on dark glass: a row of icons and a small readout. */
function controls(width: number) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width * 0.62, width * 0.62 / 16), canvasMaterial(512, 32, (context) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, 512, 32);
    context.fillStyle = '#e8f1ff';
    for (let i = 0; i < 7; i += 1) {
      if (i === 3) continue;
      context.beginPath();
      context.arc(110 + i * 48, 16, 4, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = '#9fd0ff';
    context.font = '700 22px sans-serif';
    context.textAlign = 'center';
    context.fillText('3', 256, 24);
  }, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
}

/** Stainless baffle filters, as seen from below. */
function baffles(width: number, depth: number) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshPhysicalMaterial({
    map: (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#8d9297';
      context.fillRect(0, 0, 512, 256);
      for (let x = 0; x < 512; x += 16) {
        const g = context.createLinearGradient(x, 0, x + 16, 0);
        g.addColorStop(0, '#5f6469');
        g.addColorStop(0.5, '#c4c9ce');
        g.addColorStop(1, '#5f6469');
        context.fillStyle = g;
        context.fillRect(x, 0, 16, 256);
      }
      context.fillStyle = '#2b2e31';
      context.fillRect(254, 0, 4, 256);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    })(),
    metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide,
  }));
}

/**
 * A wall-mounted chimney hood, 900 mm wide: the hood with its bottom edge at
 * y = 0, its chimney cover running up to `duct`, LED lamps lit underneath
 * and their light falling on the hob below.
 */
export function hood(kind: HoodKind, duct: number) {
  const group = new THREE.Group();
  const glass = BLACK_GLASS();
  const body = MATT_BODY();
  const steel = metal('#c9cdd1', 0.22);
  const lampGlow = new THREE.MeshBasicMaterial({ color: '#fff6e4' });
  const width = 0.9;
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, r = 0.005) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const prismAlongWall = (points: Array<[number, number]>, material: THREE.Material) => {
    const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(width / 2, 0, 0);
    group.add(new THREE.Mesh(geometry, material));
  };
  let top = 0;
  let chimney: [number, number] = [0.35, 0.28];
  let lampZ = 0.2;
  if (kind === 'miracle') {
    // Miracle: a full-width sheet of black glass angled back to the wall over a slim stainless filter box.
    box(width, 0.045, 0.35, body, 0, 0.0225, 0.175);
    box(width + 0.002, 0.006, 0.006, steel, 0, 0.044, 0.35, 0.002);
    prismAlongWall([[0, 0.045], [0.33, 0.045], [0.06, 0.52], [0, 0.52]], body);
    const tilt = Math.atan2(0.27, 0.475);
    const length = Math.hypot(0.27, 0.475) + 0.02;
    const face = new THREE.Mesh(new RoundedBoxGeometry(width + 0.006, length, 0.01, 3, 0.004), glass);
    face.position.set(0, 0.045 + 0.2375, 0.195 + 0.008);
    face.rotation.x = -tilt;
    group.add(face);
    const shine = sheen(width, length);
    shine.position.set(0, 0.045 + 0.2375, 0.195 + 0.0145);
    shine.rotation.x = -tilt;
    group.add(shine);
    const strip = controls(width);
    strip.position.set(0, 0.1, 0.31 + 0.012);
    strip.rotation.x = -tilt;
    group.add(strip);
    const under = baffles(width - 0.06, 0.28);
    under.rotation.x = Math.PI / 2;
    under.position.set(0, -0.001, 0.17);
    group.add(under);
    top = 0.52;
    chimney = [0.36, 0.265];
    lampZ = 0.28;
  } else if (kind === 'tune-t') {
    // Tune T: a matt black T, its canopy with a display bar along the front.
    box(width, 0.07, 0.5, body, 0, 0.035, 0.25, 0.012);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.03, 0.05), glass);
    front.position.set(0, 0.035, 0.5015);
    group.add(front);
    const strip = controls(width);
    strip.position.set(0, 0.035, 0.503);
    group.add(strip);
    const under = baffles(width - 0.05, 0.44);
    under.rotation.x = Math.PI / 2;
    under.position.set(0, -0.001, 0.25);
    group.add(under);
    top = 0.07;
    chimney = [0.35, 0.28];
    lampZ = 0.4;
  } else {
    // Crysta Plus: a canopy sloping back to the chimney, its front a band of black glass.
    prismAlongWall([[0, 0], [0.48, 0], [0.48, 0.06], [0.3, 0.27], [0, 0.27]], body);
    const tilt = Math.atan2(0.18, 0.21);
    const length = Math.hypot(0.18, 0.21);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.01, length), glass);
    face.position.set(0, 0.165, 0.39 + 0.005);
    face.rotation.x = -tilt;
    group.add(face);
    const shine = sheen(width - 0.01, length);
    shine.position.set(0, 0.165, 0.39 + 0.008);
    shine.rotation.x = -tilt;
    group.add(shine);
    const strip = controls(width);
    strip.position.set(0, 0.03, 0.4835);
    group.add(strip);
    const under = baffles(width - 0.06, 0.4);
    under.rotation.x = Math.PI / 2;
    under.position.set(0, -0.001, 0.24);
    group.add(under);
    top = 0.27;
    lampZ = 0.36;
  }
  // Chimney cover up to the bulkhead, in two telescoping sections.
  const rise = duct - top;
  box(chimney[0], rise * 0.55, chimney[1], body, 0, top + rise * 0.275, chimney[1] / 2, 0.004);
  box(chimney[0] - 0.008, rise * 0.47, chimney[1] - 0.006, body, 0, duct - rise * 0.235, chimney[1] / 2 - 0.003, 0.004);
  // LED lamps under the hood, and the cone of light they drop.
  const cone = new THREE.MeshBasicMaterial({
    map: (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 128;
      const context = canvas.getContext('2d')!;
      const g = context.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(255,244,222,0.12)');
      g.addColorStop(1, 'rgba(255,244,222,0)');
      context.fillStyle = g;
      context.fillRect(0, 0, 4, 128);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    })(),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const x of [-0.27, 0.27]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), lampGlow);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(x, -0.002, lampZ);
    group.add(lamp);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.16, 0.66, 32, 1, true), cone);
    beam.position.set(x, -0.335, lampZ);
    group.add(beam);
  }
  return group;
}

// -------------------------------------------------------------- oven tower

/** A painted control screen for the oven's 8.8" display. */
function screen() {
  return canvasMaterial(512, 96, (context) => {
    context.fillStyle = '#05070a';
    context.fillRect(0, 0, 512, 96);
    const tiles = ['#b4442c', '#d08a3a', '#6d8f3e', '#c2552e', '#8a5a3c', '#a83d35'];
    tiles.forEach((colour, i) => {
      context.fillStyle = colour;
      context.fillRect(18 + i * 80, 14, 66, 50);
      context.fillStyle = 'rgba(255,255,255,0.85)';
      context.fillRect(24 + i * 80, 72, 40, 4);
    });
    context.fillStyle = '#fff';
    context.font = '600 12px sans-serif';
    context.fillText('220°', 470, 90);
  });
}

/** The lit inside of the oven: warm walls with shelf runners, a tray with a pizza on it. */
function cavity(width: number, height: number, depth: number) {
  const group = new THREE.Group();
  const walls = canvasMaterial(256, 256, (context) => {
    const g = context.createRadialGradient(128, 40, 10, 128, 128, 200);
    g.addColorStop(0, '#ffd9a0');
    g.addColorStop(0.5, '#c46e32');
    g.addColorStop(1, '#4a2410');
    context.fillStyle = g;
    context.fillRect(0, 0, 256, 256);
    context.strokeStyle = 'rgba(40,18,6,0.6)';
    context.lineWidth = 3;
    for (const y of [70, 130, 190]) { context.beginPath(); context.moveTo(0, y); context.lineTo(256, y); context.stroke(); }
  }, { side: THREE.BackSide });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), walls);
  shell.position.z = -depth / 2;
  group.add(shell);
  const rack = metal('#cfd3d6', 0.3);
  for (let i = 0; i < 9; i += 1) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, depth * 0.9, 6), rack);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(-width * 0.4 + (i * width * 0.8) / 8, -height * 0.12, -depth / 2);
    group.add(rod);
  }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.012, depth * 0.8), new THREE.MeshBasicMaterial({ color: '#2a2622' }));
  tray.position.set(0, -height * 0.1, -depth / 2);
  group.add(tray);
  const pizza = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.016, 48), [
    new THREE.MeshBasicMaterial({ color: '#d39a52' }),
    canvasMaterial(256, 256, (context) => {
      context.fillStyle = '#d39a52';
      context.fillRect(0, 0, 256, 256);
      context.fillStyle = '#c4421e';
      context.beginPath(); context.arc(128, 128, 112, 0, Math.PI * 2); context.fill();
      context.fillStyle = '#f2d38a';
      for (let i = 0; i < 40; i += 1) { context.beginPath(); context.arc(30 + ((i * 53) % 196), 30 + ((i * 97) % 196), 14, 0, Math.PI * 2); context.fill(); }
      context.fillStyle = '#3c6b2a';
      for (let i = 0; i < 14; i += 1) { context.fillRect(40 + ((i * 71) % 170), 40 + ((i * 37) % 170), 10, 6); }
    }),
    new THREE.MeshBasicMaterial({ color: '#d39a52' }),
  ]);
  pizza.position.set(0, -height * 0.1 + 0.014, -depth / 2);
  group.add(pizza);
  return group;
}

/**
 * A tall unit with the Bio-07 built-in oven (595 × 595, black glass, touch
 * screen, a lit cavity seen through the door) and the MWO-1 microwave above
 * it, drawers below and doors above. Floor at y = 0.
 */
export function ovenTower(cabinet: THREE.Material, height: number) {
  const group = new THREE.Group();
  const D = 0.68; // proud of the base units' fronts
  const W = 0.64;
  const glass = BLACK_GLASS();
  const steel = metal('#cdd1d4', 0.2);
  const brass = metal('#c7a46b', 0.3);
  const dark = new THREE.MeshBasicMaterial({ color: '#0a0908' });
  const panel = (w: number, h: number, x: number, y: number, z = D) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.02, 2, 0.003), cabinet);
    mesh.position.set(x, y, z - 0.01);
    group.add(mesh);
    return mesh;
  };
  // Carcass sides and top, open at the front where the appliances sit.
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.02, height, D), cabinet);
    cheek.position.set(side * (W / 2 - 0.01), height / 2, D / 2);
    group.add(cheek);
  }
  const ovenY = 0.82; // bottom of the oven
  const microY = ovenY + 0.595 + 0.03;
  const microTop = microY + 0.388;
  // Drawers below, doors above, with brass grip grooves.
  panel(W - 0.04, ovenY / 2 - 0.012, 0, ovenY * 0.25);
  panel(W - 0.04, ovenY / 2 - 0.012, 0, ovenY * 0.75);
  for (const y of [ovenY / 2 - 0.02, ovenY - 0.02]) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, 0.008, 0.004), brass);
    groove.position.set(0, y, D + 0.002);
    group.add(groove);
  }
  const upper = height - microTop - 0.02;
  panel(W - 0.04, upper, 0, microTop + 0.02 + upper / 2);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.08, 0.008, 0.004), brass);
  grip.position.set(0, microTop + 0.05, D + 0.002);
  group.add(grip);
  // Shadow gaps around the appliances.
  const gap = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, microTop - ovenY + 0.02), dark);
  gap.position.set(0, (ovenY + microTop) / 2, D - 0.46);
  group.add(gap);

  // Bio-07: a control band with the touch screen, and the door with a window onto the lit cavity.
  const ovenW = 0.595;
  const band = new THREE.Mesh(new RoundedBoxGeometry(ovenW, 0.1, 0.022, 2, 0.003), glass);
  band.position.set(0, ovenY + 0.545, D + 0.011);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.05), screen());
  display.position.set(0, ovenY + 0.545, D + 0.0225);
  group.add(band, display);
  const doorH = 0.49;
  const doorShape = new THREE.Shape(loop(ovenW / 2, doorH / 2, 0.006).map((p) => new THREE.Vector2(p.x, p.y)));
  doorShape.holes.push(new THREE.Path(loop(0.215, 0.13, 0.02).map((p) => new THREE.Vector2(p.x, p.y - 0.035))));
  const door = new THREE.Mesh(new THREE.ExtrudeGeometry(doorShape, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 }), glass);
  door.position.set(0, ovenY + doorH / 2 + 0.005, D);
  group.add(door);
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.43, 0.26), new THREE.MeshPhysicalMaterial({ color: '#1a0d06', transparent: true, opacity: 0.42, roughness: 0.05, clearcoat: 1 }));
  pane.position.set(0, ovenY + doorH / 2 + 0.005 - 0.035, D + 0.012);
  group.add(pane);
  const inside = cavity(0.46, 0.32, 0.42);
  inside.position.set(0, ovenY + doorH / 2 - 0.03, D);
  group.add(inside);
  const doorShine = sheen(ovenW, doorH);
  doorShine.position.set(0, ovenY + doorH / 2, D + 0.0275);
  group.add(doorShine);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.5, 24), steel);
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, ovenY + doorH - 0.04, D + 0.065);
  group.add(handle);
  for (const x of [-0.22, 0.22]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 12), steel);
    post.rotation.x = Math.PI / 2;
    post.position.set(x, ovenY + doorH - 0.04, D + 0.045);
    group.add(post);
  }

  // MWO-1: a glass door with a dark window, the control column with its clock, and a bar handle.
  const micro = new THREE.Mesh(new RoundedBoxGeometry(ovenW, 0.388, 0.024, 2, 0.003), glass);
  micro.position.set(0, microY + 0.194, D + 0.012);
  const window = new THREE.Mesh(new THREE.PlaneGeometry(0.39, 0.25), new THREE.MeshBasicMaterial({ color: '#16130f' }));
  window.position.set(-0.06, microY + 0.2, D + 0.0245);
  const plate = new THREE.Mesh(new THREE.CircleGeometry(0.09, 40), new THREE.MeshBasicMaterial({ color: '#2a2520' }));
  plate.position.set(-0.06, microY + 0.13, D + 0.0246);
  plate.scale.y = 0.3;
  const clock = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.022), canvasMaterial(128, 40, (context) => {
    context.fillStyle = '#000';
    context.fillRect(0, 0, 128, 40);
    context.fillStyle = '#ff5c3a';
    context.font = '700 30px monospace';
    context.textAlign = 'center';
    context.fillText('12:30', 64, 31);
  }));
  clock.position.set(0.21, microY + 0.32, D + 0.0245);
  const dial = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.004, 8, 40), steel);
  dial.position.set(0.21, microY + 0.2, D + 0.026);
  const microHandle = new THREE.Mesh(new RoundedBoxGeometry(0.014, 0.3, 0.022, 2, 0.005), steel);
  microHandle.position.set(0.15, microY + 0.194, D + 0.04);
  const microShine = sheen(ovenW, 0.388);
  microShine.position.set(0, microY + 0.194, D + 0.0255);
  group.add(micro, window, plate, clock, dial, microHandle, microShine);
  return group;
}
