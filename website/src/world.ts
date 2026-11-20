// The showroom itself: one continuous space the camera walks through as the
// page scrolls. Stone surfaces are the catalogue's own slab photographs; the
// bath products are real 3D models built to catalogue dimensions, fitted where
// they would be installed, with the water running.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import media from './media.json';
import { lit, setLevel, type Lamp, type Strip } from './lit';
import { buildFacade, LOBBY_BACK, type Facade } from './facade';
import { bandTexture, canvasTexture, flat, glow, glowTexture, shade } from './kit';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { hob, hood, ovenTower, workstation, type HobSpec, type HoodKind, type WorkstationSpec } from './kitchen';
import { armShower, basin, ceilingPanel, closet, controlPlate, flushPlate, handShower, metal, mixer, pedestal, wallSpout, type BasinSpec, type ClosetSpec, type PedestalKind } from './models';
import { FINE_RAIN, NEEDLE, SOFT_DROPS, handSpray, rainShower, stream, waterfall, type Water } from './water';

type MediaItem = {
  id: string; role: string; sku: string; title: string; brand: string; meta: string; file: string; aspect: number;
  shadow?: string; shadowScale?: number[];
};

export type Room = 'stone' | 'rain' | 'basin' | 'form' | 'kitchen';

export type Exhibit = {
  id: string;
  room: Room;
  title: string;
  brand: string;
  meta: string;
  index: number;
  total: number;
  position: THREE.Vector3;
  /** How far away, and how far off the line of sight, it still counts as "what you are looking at". */
  reach: number;
  cone: number;
};

const items = media as MediaItem[];

type Product = { id: string; title: string; brand: string; meta: string; basin?: BasinSpec; closet?: ClosetSpec };

/** The bath products on show. Sizes and finishes are from the makers' catalogues. */
const PRODUCTS: Record<string, Product> = {
  rainGold: { id: 'rain-gold', title: 'Rainshower Cosmopolitan 310', brand: 'Grohe', meta: 'Cool Sunrise · 380 mm arm · fine rain' },
  rainSunrise: { id: 'rain-sunrise', title: 'Rainshower Cosmopolitan 310', brand: 'Grohe', meta: 'Brushed Cool Sunrise · soft drops' },
  handRain: { id: 'hand-rain', title: 'Rainshower SmartActive 130', brand: 'Grohe', meta: 'Cool Sunrise hand shower · rain spray' },
  handJet: { id: 'hand-jet', title: 'Rainshower SmartActive 130', brand: 'Grohe', meta: 'Cool Sunrise hand shower · jet spray' },
  panel: { id: 'ceiling-panel', title: '3-function ceiling shower', brand: 'Aquant', meta: 'Brushed Gold · 580 × 480 mm · rain, waterfall, curtain' },
  basinGreen: {
    id: '78575-MFG', title: '78575 countertop basin', brand: 'Comlux', meta: 'Matt Forest Green · 600 × 375 × 140 mm',
    basin: { id: '78575-MFG', width: 0.6, depth: 0.375, height: 0.14, corner: 0.07, taper: 0.006, finish: { colour: '#56614a', matt: true } },
  },
  basinBlack: {
    id: 'G281C-MB', title: 'G281C round basin', brand: 'Comlux', meta: 'Matt Black · 345 × 345 × 155 mm',
    basin: { id: 'G281C-MB', width: 0.345, depth: 0.345, height: 0.155, corner: 0.1725, taper: 0.012, finish: { colour: '#1f1f21', matt: true } },
  },
  basinNavy: {
    id: '78589-MNB', title: '78589 countertop basin', brand: 'Comlux', meta: 'Matt Navy Blue · 500 × 355 × 145 mm',
    basin: { id: '78589-MNB', width: 0.5, depth: 0.355, height: 0.145, corner: 0.115, taper: 0.03, finish: { colour: '#2e3b58', matt: true } },
  },
  basinCappuccino: {
    id: '78575-MC', title: '78575 countertop basin', brand: 'Comlux', meta: 'Cappuccino · 600 × 375 × 140 mm',
    basin: { id: '78575-MC', width: 0.6, depth: 0.375, height: 0.14, corner: 0.07, taper: 0.006, finish: { colour: '#a8937d', matt: true } },
  },
  standMarquina: { id: 'YA-24170-1', title: 'YA-24170 standing basin', brand: 'Comlux', meta: 'Black Marquina on brushed rose gold · 445 × 445 × 900 mm' },
  standStatuario: { id: 'YA-2411', title: 'YA-2411 standing basin', brand: 'Comlux', meta: 'Statuario on walnut · 445 × 445 × 900 mm' },
  standFluted: { id: '8716-BG', title: '8716 fluted standing basin', brand: 'Comlux', meta: 'Brushed gold stainless steel · 450 × 370 × 800 mm' },
  standArmani: { id: 'YA-2430', title: 'YA-2430 standing basin', brand: 'Comlux', meta: 'Armani Grey on brushed rose gold · 445 × 445 × 890 mm' },
  wcGreen: {
    id: 'B-2351-MFG', title: 'B-2351 wall-hung WC', brand: 'Comlux', meta: 'Forest Green · rimless · 515 × 360 × 360 mm',
    closet: { id: 'B-2351-MFG', depth: 0.515, width: 0.36, height: 0.36, form: 'square', finish: { colour: '#55614b', matt: true } },
  },
  wcBlack: {
    id: 'ROTO-MB', title: 'ROTO wall-hung WC', brand: 'Comlux', meta: 'Matt Black · Tornado flush · 530 × 365 × 335 mm',
    closet: { id: 'ROTO-MB', depth: 0.53, width: 0.365, height: 0.335, form: 'round', finish: { colour: '#202022', matt: true } },
  },
  wcCappuccino: {
    id: 'B-2351-MC', title: 'B-2351 wall-hung WC', brand: 'Comlux', meta: 'Cappuccino · rimless · 515 × 360 × 360 mm',
    closet: { id: 'B-2351-MC', depth: 0.515, width: 0.36, height: 0.36, form: 'square', finish: { colour: '#b39f8a', matt: true } },
  },
  wcGrey: {
    id: 'ROTO-MDH', title: 'ROTO wall-hung WC', brand: 'Comlux', meta: 'Matt Grey · Tornado flush · 530 × 365 × 335 mm',
    closet: { id: 'ROTO-MDH', depth: 0.53, width: 0.365, height: 0.335, form: 'round', finish: { colour: '#6f7276', matt: true } },
  },
};
const byRole = (role: string) => items.filter((item) => item.role === role);
const find = (id: string) => items.find((item) => item.id === id)!;

const INK = new THREE.Color('#0b0a09');
const IVORY = new THREE.Color('#e9e2d6');
const DUSK = new THREE.Color('#59607a');

const HALF = 3.6; // half-width of the corridor
const CEILING = 5.2;
const WING_END = -70; // gallery and bath wing share one corridor
const KITCHEN_END = -98;
const FEATURE = -116; // the closing wall
const ENTRY = LOBBY_BACK; // the gallery begins behind the shopfront lobby
const CORRIDOR_STRIP: Strip = { x: 0, y: 5.18, from: ENTRY, to: WING_END, colour: '#ffe4bd' };
const KITCHEN_STRIP: Strip = { x: 1.7, y: 5.38, from: WING_END - 0.5, to: KITCHEN_END, colour: '#ffffff' };

// The three display bays: which wall, where along the corridor, how wide.
const RAIN = { side: -1 as const, centre: -46, width: 6.4, depth: 2.6, out: 1.25, height: 3.3 };
const VANITY = { side: 1 as const, centre: -54.5, width: 6.4, depth: 2.8 };
const FORM = { side: -1 as const, centre: -63, width: 6.4, depth: 1.8 };

// Kitchen stations along the side walls: Waltz workstations on the right, cooking on the left.
// Both rows stand alongside the island, inside the kitchen's original length.
const WORKSTATIONS = [-76.6, -80.6, -84.6];
const OVEN_Z = -75.5;
const COOKING = [-79.1, -82.9, -86.7];

/**
 * The walk is laid out on its own scale and then normalised, so a room can be
 * given more time without retiming everything after it. TIMELINE is its length.
 */
export const TIMELINE = 1.245;
const RAW_STOPS = { arrival: 0, stone: 0.12, rain: 0.365, basin: 0.498, form: 0.775, kitchen: 0.918, visit: 1.2 };
// Where each room begins on the rail, for the side navigation.
export const STOPS = Object.fromEntries(Object.entries(RAW_STOPS).map(([key, value]) => [key, value / TIMELINE])) as typeof RAW_STOPS;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The camera rail: progress, eye x y z, look-at x y z. It is rebuilt for the
 * shape of the screen, so each display is framed whole on a wide monitor and
 * on a phone alike. `tanH` is the tangent of half the horizontal field of view.
 */
function makeRail(tanH: number, tanV: number): number[][] {
  const stand = (width: number, min: number, max: number) => Math.min(max, Math.max(min, width / (2 * tanH)));
  // The street: far enough back to take in the whole frontage (on a phone, the doors and the sign).
  const portrait = tanH < 0.62;
  const startZ = 0.4 + Math.min(34, Math.max(15.5, (portrait ? 10.5 : 33) / (2 * tanH), 8.2 / tanV));
  const sx = portrait ? 4.2 : 0;
  // Rain room: stand back far enough to see all five showers, then drift across and in.
  const rainPlane = -(HALF + RAIN.depth) + RAIN.out;
  // On a tall screen that would leave the room small, so it closes in and pans a little instead.
  const whole = 7 / (2 * tanH);
  const tall = (RAIN.height + 0.3) / (2 * tanV * 0.62);
  const rainStand = Math.min(7.9, Math.max(3.5, whole <= tall * 1.1 ? whole : tall));
  const rainX = rainPlane + rainStand;
  const rainPan = Math.max(0.4, (7 - 2 * rainStand * tanH) / 2 + 0.25);
  // Vanity: a little above counter height, the way basins are seen when you walk up to them.
  // Portrait screens stand closer (framed on height) and pan along the counter instead.
  const vanityWall = HALF + VANITY.depth;
  const basinStand = Math.min(stand(4.4, 2.3, 6), Math.max(2.3, 1.8 / (2 * tanV * 0.6)));
  const basinX = vanityWall - 0.3 - basinStand;
  const basinY = 0.86 + Math.min(0.85, basinStand * 0.32);
  const basinPan = Math.max(1.2, (4.7 - 2 * basinStand * tanH) / 2);
  // Standing basins on the side walls of the vanity: turn to one wall, then the other.
  const cheekStand = Math.min(3.5, Math.max(stand(2.1, 2.3, 3.5), 2.3 / (2 * tanV * 0.8)));
  const cheekX = vanityWall - 1.65;
  const zL = VANITY.centre - VANITY.width / 2;
  const zR = VANITY.centre + VANITY.width / 2;
  const wall = -(HALF + FORM.depth);
  // Close enough to each WC to read its glaze and form, its flush plate in frame.
  const wcX = Math.min(HALF - 0.6, wall + 0.2 + Math.min(3.2, Math.max(stand(1.5, 1.9, 3.2), 1.25 / (2 * tanV * 0.75))));
  // Kitchen side walls: close enough to read a sink or a hob, back enough for the hood above it.
  // Capped so the island's pendants never come between the visitor and the wall.
  const workStand = Math.min(2.7, Math.max(stand(1.6, 1.7, 3), 1.3 / (2 * tanV * 0.7)));
  const cookStand = Math.min(2.6, Math.max(stand(1.9, 2.1, 3.4), 2.3 / (2 * tanV * 0.85)));
  // Closing wall: as close as still shows its full width.
  const finish = FEATURE + Math.max(stand(14.6, 9, 13.5), 6.6 / (2 * tanV * 0.72));
  // A row of stations seen one at a time: a short pause at each, a smooth move between.
  const dwell = (from: number, to: number, zs: number[], view: (z: number) => number[]) => {
    const step = (to - from) / (zs.length - 0.45);
    return zs.flatMap((z, i) => [
      [from + step * i, ...view(z + 0.12)],
      [from + step * (i + 0.55), ...view(z - 0.12)],
    ]);
  };
  const raw = [
    [0.0, sx, 1.65, startZ, sx, 5.9, 0],
    [0.05, sx * 0.4, 1.7, 10.5, sx * 0.25, 3.6, 0],
    [0.088, 0, 1.7, 3.6, 0, 2.1, -5],
    [0.12, 0, 1.65, -3.6, 0, 1.7, -10.6],
    [0.35, 0, 1.65, -38.6, 0, 1.65, -45.6],
    [0.38, rainX * 0.5, 1.65, -42.4, -6.2, 1.7, -45.4],
    [0.405, rainX, 1.62, RAIN.centre + rainPan, -6.2, 1.82, RAIN.centre + rainPan * 0.8],
    [0.475, rainX - 0.5, 1.6, RAIN.centre - rainPan, -6.2, 1.72, RAIN.centre - rainPan * 0.8],
    [0.505, mix(0.2, basinX, 0.35), 1.72, -50.4, vanityWall - 1.2, 1.25, -52.6],
    [0.53, basinX, basinY, VANITY.centre + basinPan, vanityWall - 0.18, 1.12, VANITY.centre + basinPan * 0.92],
    [0.605, basinX, basinY, VANITY.centre - basinPan, vanityWall - 0.18, 1.12, VANITY.centre - basinPan * 0.92],
    [0.635, cheekX - 0.1, 1.45, zL + cheekStand + 0.2, cheekX + 0.1, 1.12, zL],
    [0.668, cheekX + 0.1, 1.42, zL + cheekStand - 0.15, cheekX - 0.1, 1.08, zL],
    [0.69, cheekX, 1.5, VANITY.centre - 0.3, vanityWall + 0.6, 1.3, VANITY.centre],
    [0.712, cheekX - 0.1, 1.45, zR - cheekStand - 0.2, cheekX + 0.1, 1.12, zR],
    [0.745, cheekX + 0.1, 1.42, zR - cheekStand + 0.15, cheekX - 0.1, 1.08, zR],
    [0.765, 2.4, 1.6, -55.6, -1, 1.25, -61],
    // The WC wall in a three-quarter view, drifting along it.
    [0.78, -0.3, 1.55, -58.6, wall, 0.8, -61.2],
    ...dwell(0.805, 0.875, [1.5, 0.5, -0.5, -1.5].map((k) => FORM.centre + k * 1.42), (z) => [wcX, 1.18, z + 0.45, wall + 0.2, 0.55, z - 0.05]),
    [0.91, 0, 1.65, -67.6, 0, 1.6, -75],
    // The cooking wall on the left, across to the Waltz workstations on the right, then over the island.
    [0.932, -0.8, 1.7, -72.6, -4.8, 1.4, -75.2],
    ...dwell(0.945, 1.018, [OVEN_Z, ...COOKING], (z) => [-4.55 + cookStand, 1.72, z + 0.7, -4.8, 1.45, z - 0.1]),
    [1.032, 0, 1.75, -88, 0, 1.4, -96],
    ...dwell(1.045, 1.11, WORKSTATIONS.slice().reverse(), (z) => [4.5 - workStand, 1.72, z - 0.7, 4.62, 0.95, z + 0.1]),
    [1.135, 0, 2.3, -73.6, 0, 0.5, -77.2],
    [1.165, 0, 2.3, -80.2, 0, 0.5, -83.8],
    [1.2, 0, 1.7, KITCHEN_END - 3.2, 0, 2.5, KITCHEN_END - 12],
    [TIMELINE, 0, 1.7, finish, 0, 2.75, FEATURE],
  ];
  return raw.map(([at, ...rest]) => [at / TIMELINE, ...rest]);
}

/** Smooth path through the rail's keyframes (non-uniform Catmull-Rom). */
function sample(keys: number[][], progress: number, out: number[]) {
  const p = Math.min(1, Math.max(0, progress));
  let i = 0;
  while (i < keys.length - 2 && p > keys[i + 1][0]) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  const before = keys[i - 1];
  const after = keys[i + 2];
  const span = b[0] - a[0];
  const t = (p - a[0]) / span;
  const t2 = t * t;
  const t3 = t2 * t;
  for (let c = 1; c <= 6; c += 1) {
    const ma = before ? (b[c] - before[c]) / (b[0] - before[0]) : (b[c] - a[c]) / span;
    const mb = after ? (after[c] - a[c]) / (after[0] - a[0]) : (b[c] - a[c]) / span;
    out[c - 1] = (2 * t3 - 3 * t2 + 1) * a[c] + (t3 - 2 * t2 + t) * span * ma + (-2 * t3 + 3 * t2) * b[c] + (t3 - t2) * span * mb;
  }
}

/** 0 in the dark rooms, 1 in the bright kitchen hall. */
const toneAt = (z: number) => smooth(2, -3, z) - smooth(KITCHEN_END + 0.7, KITCHEN_END - 0.9, z);

type Slab = { front: THREE.ShaderMaterial; mirror: THREE.MeshBasicMaterial; pool?: THREE.MeshBasicMaterial; z: number };

/** A recessed display bay off the corridor, addressed in its own wall coordinates. */
type Bay = {
  side: 1 | -1;
  centre: number;
  wallX: number;
  width: number;
  height: number;
  lamps: Lamp[];
  /** Models are added to this group, which has the bay's wall space as its own. */
  anchor: THREE.Group;
  mouth: THREE.Vector3;
  surfaces: THREE.ShaderMaterial[];
  shadows: THREE.MeshBasicMaterial[];
  glows: Array<{ material: THREE.MeshBasicMaterial; opacity: number }>;
  /** Water that runs whenever the bay is lit. */
  waters: Water[];
  /** Water that takes turns: each step runs for its number of seconds. */
  programme: Array<{ waters: Water[]; seconds: number }>;
  clock: number;
  /** u runs to the viewer's right along the back wall, d is distance out from it. */
  place(u: number, y: number, d: number): THREE.Vector3;
};

const worldOf = (bay: Bay, local: THREE.Vector3) => local.clone().applyMatrix4(bay.anchor.matrixWorld);

export class World {
  readonly exhibits: Exhibit[] = [];
  onExhibit: (exhibit: Exhibit | null) => void = () => {};
  onTone: (light: boolean) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(54, 1, 0.2, 150);
  private fog = new THREE.Fog(INK.clone(), 4, 26);
  private textures = new Map<string, THREE.Texture>();
  private keys = makeRail(0.8, 0.5);

  private facade!: Facade;
  private slabs: Slab[] = [];
  private bays: Bay[] = [];
  private streams: THREE.Object3D[] = [];
  private mirrors: Array<{ glass: Reflector; bay: Bay }> = [];
  private flames: THREE.Object3D[] = [];
  private static reflecting = false;
  private blob = glowTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
  /** One set of lights for the 3D models, moved to whichever bay the visitor is at. */
  private rig: { spots: THREE.SpotLight[]; fill: THREE.PointLight; bay: Bay | null } = { spots: [], fill: new THREE.PointLight('#fff1de', 0, 0, 2), bay: null };
  private feature: THREE.ShaderMaterial[] = [];
  private sign: THREE.MeshBasicMaterial[] = [];
  private halo!: THREE.MeshBasicMaterial;
  private wash!: THREE.MeshBasicMaterial;
  private sky!: THREE.Mesh;
  private inRain = false;
  // Adaptive resolution: drop the pixel ratio on devices that cannot hold the frame rate.
  private ratioCap = Math.min(window.devicePixelRatio, 2);
  private ratio = Math.min(window.devicePixelRatio, 2);
  private frameAverage = 1 / 60;
  private frameClock = 0;
  private veilDark!: THREE.MeshBasicMaterial;

  private target = 0;
  private goal = [0, 1.7, 15, 0, 2.3, 7];
  private state = [0, 1.7, 15, 0, 2.3, 7];
  private lookX = 0;
  private pointer = new THREE.Vector2();
  private pointerEase = new THREE.Vector2();
  private eye = new THREE.Vector3();
  private gaze = new THREE.Vector3();
  private scratch = new THREE.Vector3();
  private active: Exhibit | null = null;
  private light = false;
  private spread = 1;
  private turn = 0.3;
  private still: boolean;
  private built = false;

  constructor(canvas: HTMLCanvasElement, reducedMotion: boolean) {
    this.still = reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping applies to the 3D models (the surface shaders handle their own light).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    environment.dispose();
    this.scene.fog = this.fog;
    this.scene.background = INK.clone();
    this.resize();
  }

  async load(onProgress: (ratio: number) => void) {
    const manager = new THREE.LoadingManager();
    manager.onProgress = (_url, loaded, total) => onProgress(loaded / total);
    const loader = new THREE.TextureLoader(manager);
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const fetch = async (key: string, file: string) => {
      const texture = await loader.loadAsync(file);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = anisotropy;
      this.textures.set(key, texture);
    };
    // The street sign and the pylon are lettered in the site's own typeface.
    await Promise.all(['700 100px "Manrope Variable"', '600 100px "Manrope Variable"'].map((font) => document.fonts.load(font).catch(() => []))).catch(() => undefined);
    await Promise.all(items.flatMap((item) => [fetch(item.id, item.file), ...(item.shadow ? [fetch(`${item.id}-shadow`, item.shadow)] : [])]));
    this.build();
    // Compile every material up front so the first steps of the walk do not stutter.
    this.renderer.compile(this.scene, this.camera);
    onProgress(1);
  }

  setProgress(progress: number) { this.target = progress; }

  setPointer(x: number, y: number) { this.pointer.set(x, y); }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.8 ? 70 : aspect < 1.25 ? 62 : 54;
    this.camera.updateProjectionMatrix();
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.keys = makeRail(tanV * aspect, tanV);
    // Portrait screens see a narrow slice, so the gallery slabs move in toward the centre line.
    this.turn = aspect < 0.8 ? 0.75 : 0.3;
    this.applySpread(aspect < 0.8 ? 0.58 : aspect < 1.25 ? 0.8 : 1);
    const [mirrorWidth, mirrorHeight] = this.mirrorSize();
    for (const { glass } of this.mirrors) glass.getRenderTarget().setSize(mirrorWidth, mirrorHeight);
  }

  private applySpread(spread: number) {
    if (spread === this.spread) return;
    this.scene.traverse((object) => {
      const baseX = object.userData.baseX as number | undefined;
      if (baseX !== undefined) object.position.x = baseX * spread;
    });
    for (const exhibit of this.exhibits) if (exhibit.room === 'stone') exhibit.position.x = (exhibit.position.x / this.spread) * spread;
    this.spread = spread;
  }

  // ---------------------------------------------------------------- build

  private add<T extends THREE.Object3D>(object: T, x = 0, y = 0, z = 0) {
    object.position.set(x, y, z);
    this.scene.add(object);
    return object;
  }

  private plane(width: number, height: number, material: THREE.Material) {
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  }

  private box(width: number, height: number, depth: number, material: THREE.Material | THREE.Material[]) {
    return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  }

  /** A horizontal surface facing up (or down, for ceilings). */
  private level(width: number, depth: number, material: THREE.Material, x: number, y: number, z: number, down = false) {
    const mesh = this.plane(width, depth, material);
    mesh.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
    return this.add(mesh, x, y, z);
  }

  /** A wall running along the corridor at x, facing the centre line. */
  private wall(side: number, x: number, from: number, to: number, height: number, material: THREE.Material, y = 0) {
    const mesh = this.plane(Math.abs(from - to), height, material);
    mesh.rotation.y = -side * Math.PI / 2;
    return this.add(mesh, x, y + height / 2, (from + to) / 2);
  }

  private build() {
    this.scene.add(new THREE.HemisphereLight('#fff6ea', '#5a5148', 0.6));
    for (let i = 0; i < 3; i += 1) {
      const spot = new THREE.SpotLight('#fff0dc', 0, 0, 0.72, 0.85, 2);
      this.rig.spots.push(spot);
      this.scene.add(spot, spot.target);
    }
    this.scene.add(this.rig.fill);
    this.facade = buildFacade(this.scene, this.textures, (object) => this.reflect(object));
    this.sky = this.facade.sky;
    this.buildCorridor();
    this.buildGallery();
    this.buildRainBay();
    this.buildVanityBay();
    this.buildFormBay();
    this.buildKitchen();
    this.buildFinale();
    // Objects are placed for a wide screen; pull them in if this one is narrow.
    const spread = this.spread;
    this.spread = 1;
    this.applySpread(spread);
    this.built = true;
  }

  /**
   * The spine of the building, now a bright stone gallery: warm travertine-toned
   * walls washed from a cove above, a polished cream marble floor laid in large
   * book-matched slabs, and one fine line of light down the ceiling.
   */
  private buildCorridor() {
    const length = ENTRY - WING_END;
    const mid = (ENTRY + WING_END) / 2;
    // Polished floor, slightly see-through over the mirrored room beneath it.
    const floor = lit({
      map: this.textures.get('slab-06'), repeat: [(HALF * 2) / 1.2, length / 2.4], book: true, grout: 0.3,
      gloss: 1.3, ambient: 0.92, opacity: 0.86, strip: { ...CORRIDOR_STRIP, fill: 0.25, shine: 1.1 },
    });
    this.level(HALF * 2, length, floor, 0, 0, mid).renderOrder = -1;
    this.level(HALF * 2, length, flat('#f1ece4'), 0, CEILING, mid, true);

    // Hey Concrete Drape: fine round flutes cast in a warm ivory, raked by the cove light.
    const plaster = lit({ colour: '#e9e0d3', noise: 0.08, ambient: 0.62, strip: { ...CORRIDOR_STRIP, fill: 1.2, shine: 0 }, relief: { kind: 'drape', size: [0.075, 1], depth: 0.02 } });
    const brass = flat('#b39363');
    const wash = glow(bandTexture('rgba(255,228,190,0.32)', true, 0), 1);
    // Solid wall wherever there is no bay opening.
    const opening = (bay: { centre: number; width: number }) => [bay.centre + bay.width / 2, bay.centre - bay.width / 2];
    const [rainFrom, rainTo] = opening(RAIN);
    const [vanityFrom, vanityTo] = opening(VANITY);
    const [formFrom, formTo] = opening(FORM);
    const runs: Record<string, number[][]> = {
      '-1': [[ENTRY, rainFrom], [rainTo, formFrom], [formTo, WING_END]],
      '1': [[ENTRY, vanityFrom], [vanityTo, WING_END]],
    };
    for (const side of [-1, 1]) {
      for (const [from, to] of runs[String(side)]) {
        this.wall(side, side * HALF, from, to, CEILING, plaster);
        // Cove light washing down the wall, a brass shadow-gap skirting and picture rail.
        this.wall(side, side * (HALF - 0.01), from, to, 2.2, wash, CEILING - 2.2);
        this.add(this.box(0.02, 0.018, from - to, brass), side * (HALF - 0.012), 0.07, (from + to) / 2);
        this.add(this.box(0.016, 0.012, from - to, brass), side * (HALF - 0.01), 3.35, (from + to) / 2);
      }
      // The cove itself: a slim lit slot where wall meets ceiling.
      this.add(this.box(0.04, 0.03, length - 1, flat('#fff3df')), side * (HALF - 0.05), CEILING - 0.03, mid);
    }

    // Facing the vanity, a framed book-matched panel of Quarzo Verde: what its mirrors show.
    const panelLamps: Lamp[] = [-1, 1].map((k) => ({ position: [-1.6, CEILING - 0.3, VANITY.centre + k * 1.1], target: [-HALF, 1.8, VANITY.centre + k * 1.1], intensity: 1.1, angle: 34 }));
    const verde = lit({ map: this.textures.get('slab-03'), repeat: [4, 1], book: true, grout: 0.3, gloss: 0.9, ambient: 0.6, lamps: panelLamps });
    this.wall(-1, -HALF + 0.03, VANITY.centre + 2.1, VANITY.centre - 2.1, 2.5, verde, 0.65);
    for (const y of [0.64, 3.16]) this.add(this.box(0.03, 0.025, 4.24, brass), -HALF + 0.03, y, VANITY.centre);
    for (const k of [-1, 1]) this.add(this.box(0.03, 2.55, 0.025, brass), -HALF + 0.03, 1.9, VANITY.centre + k * 2.11);

    // The line of light down the middle of the ceiling, and its image in the floor.
    this.add(this.box(0.07, 0.02, length - 1, flat('#fff6e8')), 0, CEILING - 0.02, mid);
    this.add(this.box(0.07, 0.02, length - 1, flat('#d8c9b2')), 0, -(CEILING - 0.02), mid);

    // End of the corridor: a wide opening into the kitchen hall.
    const end = WING_END;
    this.add(this.box(2.1, CEILING, 0.5, plaster), -2.55, CEILING / 2, end);
    this.add(this.box(2.1, CEILING, 0.5, plaster), 2.55, CEILING / 2, end);
    this.add(this.box(3, 1.3, 0.5, plaster), 0, 4.55, end);
  }

  /** Standing slabs, each one a real tile at close to real scale, spotlit on a bronze plinth. */
  private buildGallery() {
    const slabs = byRole('slab');
    const edge = flat('#cdbfa8');
    const shoe = flat('#2c2621');
    const brass = flat('#b39363');
    const can = flat('#3a332c');
    const lens = flat('#fff2da');
    const pool = glowTexture('rgba(255,214,160,0.22)', 'rgba(255,214,160,0)');
    slabs.forEach((item, index) => {
      const hand = index % 2 === 0 ? 1 : -1;
      const height = 2.7;
      const width = height * item.aspect;
      const x = hand * 2.15;
      const z = -9.5 - index * 2.15;
      const yaw = -hand * 0.5;
      const map = this.textures.get(item.id)!;
      const lampAt: [number, number, number] = [x + Math.sin(yaw) * 2.2, CEILING - 0.5, z + Math.cos(yaw) * 2.2];
      const front = lit({
        map, ambient: 0.66, gloss: 1, strip: { ...CORRIDOR_STRIP, fill: 0.4, shine: 1.2 },
        lamps: [{ position: lampAt, target: [x, 1.6, z], intensity: 0.85, angle: 30, colour: '#fff1dc' }],
      });
      const mirror = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
      const group = new THREE.Group();
      const slab = this.box(width, height, 0.05, [edge, edge, edge, edge, front, edge]);
      slab.position.y = 0.14 + height / 2;
      const reflection = this.plane(width, height, mirror);
      reflection.scale.y = -1;
      reflection.position.set(0, -(0.14 + height / 2), 0.02);
      reflection.renderOrder = -3;
      const base = this.box(width + 0.14, 0.13, 0.36, shoe);
      base.position.y = 0.065;
      const trim = this.box(width + 0.14, 0.012, 0.36, brass);
      trim.position.y = 0.136;
      const light = new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const lightPool = this.plane(width + 2.2, 2.6, light);
      lightPool.rotation.x = -Math.PI / 2;
      lightPool.position.set(0, 0.006, 0.9);
      group.add(slab, reflection, base, trim, lightPool);
      group.rotation.y = yaw;
      group.userData.baseX = x;
      this.add(group, x, 0, z);

      // The spotlight that lights it.
      this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 16), can), lampAt[0], CEILING - 0.08, lampAt[2]);
      this.level(0.07, 0.07, lens, lampAt[0], CEILING - 0.165, lampAt[2], true);

      this.slabs.push({ front, mirror, pool: light, z });
      this.exhibits.push({
        id: item.id, room: 'stone', title: item.title, brand: item.brand, meta: item.meta, index: index + 1, total: slabs.length,
        position: new THREE.Vector3(x, 1.6, z), reach: 6.6, cone: 62,
      });
    });
  }

  // ---------------------------------------------------------------- bays

  /** A recessed display bay off the corridor with a stone back wall washed by three ceiling spots. */
  private bay(spec: { side: 1 | -1; centre: number; width: number; depth: number }, height: number, cladding: { id: string; tile: [number, number] }, floorId: string, stoneSides = false): Bay {
    const { side, centre, width, depth } = spec;
    const wallX = side * (HALF + depth);
    const midX = side * (HALF + depth / 2);
    const surfacesExtra: THREE.ShaderMaterial[] = [];
    const lamps: Lamp[] = [-1, 0, 1].map((k) => ({
      position: [wallX - side * 0.6, height - 0.04, centre + k * width * 0.31],
      target: [wallX, height * 0.42, centre + k * width * 0.31],
      intensity: 1.35, angle: 42,
    }));
    const stone = lit({
      map: this.textures.get(cladding.id), repeat: [width / cladding.tile[0], height / cladding.tile[1]],
      book: true, grout: 0.6, gloss: 0.9, ambient: 0.2, lamps, side: THREE.DoubleSide,
    });
    // Side walls not in stone are Hey Concrete Ridge, in a deep taupe.
    const plaster = lit({ colour: '#7a6f64', noise: 0.18, ambient: 0.42, lamps, relief: { kind: 'ridge', size: [0.12, 1], depth: 0.03 } });
    // The bay floor is a dark glaze over the room's own reflection.
    const floor = lit({
      map: this.textures.get(floorId), colour: '#8e8a86', repeat: [depth / 0.6, width / 1.2],
      grout: 0.7, gloss: 1.2, ambient: 0.16, lamps, opacity: 0.74,
    });
    const back = this.plane(width, height, stone);
    back.rotation.y = -side * Math.PI / 2;
    this.add(back, wallX, height / 2, centre);
    this.reflect(back);
    // Side walls: plaster, or the same stone as the back wall for a fully clad room.
    for (const end of [1, -1]) {
      // Stone side walls get their own pair of downlights grazing them.
      const cheekLamps: Lamp[] = [0.42, 0.78].map((k) => {
        const along = centre + side * end * (width / 2);
        const inset = centre + side * end * (width / 2 - 0.45);
        return { position: [wallX - side * depth * k, height - 0.04, inset], target: [wallX - side * depth * k, height * 0.42, along], intensity: 1.1, angle: 40 };
      });
      const sides = stoneSides
        ? lit({ map: this.textures.get(cladding.id), repeat: [depth / cladding.tile[0], height / cladding.tile[1]], book: true, grout: 0.6, gloss: 0.9, ambient: 0.24, lamps: cheekLamps, side: THREE.DoubleSide })
        : plaster;
      if (stoneSides) {
        surfacesExtra.push(sides);
        for (const lamp of cheekLamps) this.level(0.08, 0.08, flat('#fff0d2'), lamp.position[0], height - 0.004, lamp.position[2], true);
      }
      const cheek = this.plane(depth, height, sides);
      cheek.rotation.y = end === 1 ? Math.PI : 0;
      this.add(cheek, midX, height / 2, centre + end * width / 2);
    }
    this.level(depth, width, floor, midX, 0.002, centre).renderOrder = -1;
    // A few millimetres above the beam's underside, so the two never share a plane.
    this.level(depth, width, flat('#1e1a17'), midX, height + 0.005, centre, true);
    // The beam over the opening, a brass edge, and the three downlights.
    const beam = lit({ colour: '#e6ddd0', noise: 0.16, ambient: 0.66, strip: { ...CORRIDOR_STRIP, fill: 1.1, shine: 0 } });
    this.add(this.box(0.3, CEILING - height, width, beam), side * (HALF + 0.15), (CEILING + height) / 2, centre);
    this.add(this.box(0.03, 0.03, width - 0.1, flat('#b39363')), side * (HALF + 0.022), height - 0.017, centre);
    // Brass edges down each side of the opening, set just inside it: no face shares a plane with
    // the gallery wall or the side wall, so the edge cannot flicker as the camera passes.
    for (const end of [1, -1]) this.add(this.box(0.04, height, 0.04, flat('#b39363')), side * (HALF + 0.022), height / 2, centre + end * (width / 2 - 0.021));
    const lens = flat('#fff0d2');
    for (const lamp of lamps) this.level(0.09, 0.09, lens, lamp.position[0], height - 0.004, lamp.position[2], true);

    const anchor = new THREE.Group();
    anchor.position.set(wallX, 0, centre);
    anchor.rotation.y = -side * Math.PI / 2;
    this.scene.add(anchor);
    anchor.updateMatrixWorld();

    const bay: Bay = {
      side, centre, wallX, width, height, lamps, anchor,
      mouth: new THREE.Vector3(side * HALF, 1.5, centre),
      surfaces: [stone, plaster, floor, ...surfacesExtra], shadows: [], glows: [], waters: [], programme: [], clock: 0,
      place: (u, y, d) => new THREE.Vector3(wallX - side * d, y, centre + side * u),
    };
    this.bays.push(bay);
    return bay;
  }

  /** The image of an object in a polished floor: the same thing upside down, drawn before the floor. */
  private reflect(object: THREE.Object3D, parent: THREE.Object3D = this.scene) {
    const copy = object.clone();
    copy.position.y = -object.position.y;
    copy.scale.y = -object.scale.y;
    copy.traverse((child) => { child.renderOrder = -3; });
    parent.add(copy);
    return copy;
  }

  /** Add a model to a bay at a point given in the bay's wall space. */
  private fit(bay: Bay, model: THREE.Object3D, u: number, y: number, d: number) {
    model.position.set(u, y, d);
    bay.anchor.add(model);
    model.updateMatrixWorld(true);
    return model;
  }

  /** A soft dark patch: a contact shadow on a wall (facing out of it) or on a horizontal surface. */
  private contact(bay: Bay, size: [number, number], u: number, y: number, d: number, onWall: boolean, strength = 0.6) {
    const material = shade(this.blob);
    material.userData.strength = strength;
    const patch = this.plane(size[0], size[1], material);
    if (!onWall) patch.rotation.x = -Math.PI / 2;
    patch.renderOrder = 1;
    this.fit(bay, patch, u, y, d);
    bay.shadows.push(material);
  }

  private show(room: Room, product: Product, position: THREE.Vector3, index: number, total: number, cone = 15) {
    this.exhibits.push({ id: product.id, room, title: product.title, brand: product.brand, meta: product.meta, index, total, position, reach: 12, cone });
  }

  private pour(bay: Bay, water: Water, always = true) {
    this.scene.add(water.object);
    if (always) bay.waters.push(water);
    return water;
  }

  /**
   * Five showers, each fitted and running: two arm-mounted rain heads out of
   * the back wall, two slide-rail hand showers angled into the room, and a
   * concealed ceiling panel stepping through rain, twin waterfalls and mist.
   */
  private buildRainBay() {
    const bay = this.bay(RAIN, RAIN.height, { id: 'wall-01', tile: [1.2, 2.4] }, 'slab-02', true);
    const floor = 0.01;
    const world = (local: THREE.Vector3) => worldOf(bay, local);
    const direction = (local: THREE.Vector3) => local.clone().applyQuaternion(bay.anchor.quaternion).normalize();

    // Arm showers: Grohe Rainshower Cosmopolitan 310, 380 mm arm, each out of a side wall.
    const arm = (product: Product, end: 1 | -1, finish: THREE.MeshPhysicalMaterial, index: number, fine: boolean) => {
      const model = armShower({ arm: 0.38, head: 0.31, finish });
      // Wall-space for a side wall: the arm points back into the room along u.
      model.group.rotation.y = -end * Math.PI / 2;
      this.fit(bay, model.group, end * (bay.width / 2), 2.32, 1.0);
      const centre = model.group.localToWorld(model.spray.clone());
      const r = model.radius;
      this.pour(bay, rainShower(
        fine
          ? { x: centre.x, depth: r * 2, z0: centre.z - r, z1: centre.z + r, top: centre.y, floor, columns: 21, rows: 21, spread: 0.07, round: true }
          : { x: centre.x, depth: r * 2, z0: centre.z - r, z1: centre.z + r, top: centre.y, floor, columns: 12, rows: 12, spread: 0.2, round: true, heavy: true },
        fine ? FINE_RAIN : SOFT_DROPS, fine ? 1 : 0.85,
      ));
      this.show('rain', product, new THREE.Vector3(centre.x, 1.7, centre.z), index, 5, 12);
    };
    // Gold on black marble: polished Cool Sunrise on one side, brushed on the other.
    arm(PRODUCTS.rainGold, -1, metal('#d8b77c', 0.14), 1, true);
    arm(PRODUCTS.rainSunrise, 1, metal('#c9a46c', 0.32), 5, false);

    // Hand showers on slide rails, each angled out and in toward the middle of the room.
    const gold = metal('#d4b27a', 0.2);
    const hand = (product: Product, u: number, inward: number, face: 'white' | 'chrome', index: number, wide: boolean) => {
      const aim = new THREE.Vector3(inward * 0.42, -0.55, 0.72);
      const model = handShower({ rail: [0.95, 1.9], holder: 1.6, aim, head: 0.13, finish: gold, face });
      // Its concealed thermostat, beside the rail.
      this.fit(bay, controlPlate(gold), u - inward * 0.32, 1.12, 0);
      this.contact(bay, [0.3, 0.3], u - inward * 0.32, 1.1, 0.004, true, 0.35);
      this.fit(bay, model.group, u, 0, 0);
      const from = world(model.spray.clone().add(new THREE.Vector3(u, 0, 0)));
      const towards = direction(model.aim);
      this.pour(bay, wide
        ? handSpray({ from: [from.x, from.y, from.z], aim: [towards.x, towards.y, towards.z], cone: 15, jets: 56, force: 2.2, floor }, { ...FINE_RAIN, alpha: 0.5, breakFrom: 0.35, breakTo: 1.1 })
        : handSpray({ from: [from.x, from.y, from.z], aim: [towards.x, towards.y, towards.z], cone: 6, jets: 34, force: 3.1, floor }, NEEDLE));
      this.contact(bay, [0.26, 1.2], u, 1.42, 0.006, true, 0.4);
      this.show('rain', product, new THREE.Vector3(from.x, 1.5, from.z), index, 5, 12);
    };
    hand(PRODUCTS.handRain, -1.15, 1, 'chrome', 2, true);
    hand(PRODUCTS.handJet, 1.15, -1, 'chrome', 4, false);

    // The ceiling panel, flush with the ceiling, 580 × 480 mm.
    const out = RAIN.out;
    const panel = ceilingPanel({ width: 0.58, depth: 0.48, finish: metal('#c7a46f', 0.34) });
    this.fit(bay, panel, 0, bay.height - 0.008, out);
    const at = (u: number, d: number) => world(new THREE.Vector3(u, bay.height - 0.016, out + d));
    const centre = at(0, 0);
    const field = rainShower({ x: centre.x, depth: 0.27, z0: centre.z - 0.17, z1: centre.z + 0.17, top: centre.y, floor, columns: 26, rows: 15, spread: 0.05 }, { ...FINE_RAIN, alpha: 0.42 }, 1.1);
    const slotA = at(0, -0.18);
    const slotB = at(0, 0.18);
    const fallA = waterfall({ x: slotA.x, z: slotA.z, length: 0.36, along: 'z', top: slotA.y, floor });
    const fallB = waterfall({ x: slotB.x, z: slotB.z, length: 0.36, along: 'z', top: slotB.y, floor });
    // The outer curtain: a rectangle of fine jets round the edge, hollow in the middle.
    const curtain = rainShower({ x: centre.x, depth: 0.44, z0: centre.z - 0.27, z1: centre.z + 0.27, top: centre.y, floor, columns: 36, rows: 26, spread: 0.04, hollow: 0.86 }, { ...FINE_RAIN, alpha: 0.5 }, 0.7);
    for (const water of [field, fallA, fallB, curtain]) this.pour(bay, water, false);
    bay.programme = [
      { waters: [field], seconds: 5.2 },
      { waters: [fallA, fallB], seconds: 4.2 },
      { waters: [curtain], seconds: 4.6 },
    ];
    this.show('rain', PRODUCTS.panel, new THREE.Vector3(centre.x, 1.7, centre.z), 3, 5, 12);

    // A brass channel drain under the showers, and haze where the water lands.
    this.fit(bay, this.box(bay.width - 0.5, 0.008, 0.05, flat('#b39363')), 0, 0.006, 0.95);
    const haze = glow(glowTexture('rgba(200,225,255,0.12)', 'rgba(200,225,255,0)'), 0);
    this.fit(bay, this.plane(bay.width, 1.3, haze), 0, 0.5, 1.3);
    bay.glows.push({ material: haze, opacity: 1 });
  }

  /**
   * A floating stone vanity with four Comlux countertop basins under round
   * mirrors, and on each side wall two Comlux standing basins under tall lit
   * mirrors, every tap running. The mirrors are real reflections.
   */
  private buildVanityBay() {
    const bay = this.bay(VANITY, 3.0, { id: 'slab-12', tile: [1.2, 1.8] }, 'slab-14', true);
    const top = 0.86;
    const counter = lit({ map: this.textures.get('slab-04'), repeat: [1, 5.8 / 2.4], book: true, grout: 0.4, gloss: 1.1, ambient: 0.42, lamps: bay.lamps });
    const cabinet = lit({ colour: '#3b2b21', noise: 0.22, ambient: 0.34, lamps: bay.lamps });
    bay.surfaces.push(counter, cabinet);
    this.fit(bay, this.box(5.8, 0.05, 0.6, counter), 0, top - 0.025, 0.3);
    this.fit(bay, this.box(5.6, 0.34, 0.54, cabinet), 0, top - 0.22, 0.27);
    this.fit(bay, this.box(5.6, 0.012, 0.012, flat('#b39363')), 0, top - 0.22, 0.545);
    // Light spilling from under the floating vanity.
    const under = glow(glowTexture('rgba(255,205,150,0.34)', 'rgba(255,205,150,0)'), 0);
    const spill = this.plane(7, 2.4, under);
    spill.rotation.x = -Math.PI / 2;
    this.fit(bay, spill, 0, 0.01, 0.55);
    bay.glows.push({ material: under, opacity: 1 });

    // What a mirror shows from across the room, until the visitor is close enough for the real reflection.
    const mirrorFace = canvasTexture(128, 128, (context) => {
      const gradient = context.createLinearGradient(0, 0, 128, 128);
      gradient.addColorStop(0, '#77736d');
      gradient.addColorStop(0.45, '#3a3632');
      gradient.addColorStop(0.55, '#4e4943');
      gradient.addColorStop(1, '#25211d');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
    });
    const halo = glowTexture('rgba(255,214,165,0.5)', 'rgba(255,214,165,0)');
    const brass = flat('#c3a26c');
    const stations: Product[] = [PRODUCTS.basinGreen, PRODUCTS.basinBlack, PRODUCTS.basinNavy, PRODUCTS.basinCappuccino];
    const backMirrors: THREE.BufferGeometry[] = [];
    const total = stations.length + 4;
    stations.forEach((product, index) => {
      const spec = product.basin!;
      const u = (index - 1.5) * 1.42;
      // Backlit round mirror in a fine brass ring.
      const glowDisc = glow(halo, 0);
      this.fit(bay, this.plane(1.7, 1.7, glowDisc), u, 1.86, 0.02);
      this.fit(bay, new THREE.Mesh(new THREE.CircleGeometry(0.37, 64), new THREE.MeshBasicMaterial({ map: mirrorFace })), u, 1.86, 0.045);
      backMirrors.push(new THREE.CircleGeometry(0.37, 64).translate(u, 1.86, 0));
      this.fit(bay, new THREE.Mesh(new THREE.RingGeometry(0.37, 0.386, 64), brass), u, 1.86, 0.052);
      bay.glows.push({ material: glowDisc, opacity: 1 });

      // The basin sits on the stone; the mixer stands behind it with its spout over the bowl.
      const d = 0.32;
      const model = basin(spec);
      this.fit(bay, model, u, top, d);
      this.contact(bay, [spec.width * 1.15, spec.depth * 1.15], u, top + 0.002, d, false, 0.7);
      const mixerD = d - spec.depth / 2 - 0.04;
      const outletD = d - spec.depth * 0.08;
      const tap = mixer({ height: spec.height + 0.25, reach: outletD - mixerD + 0.009, finish: 'black' });
      this.fit(bay, tap.group, u, top, mixerD);
      this.contact(bay, [0.1, 0.1], u, top + 0.002, mixerD, false, 0.6);
      const outlet = worldOf(bay, tap.outlet.clone().add(new THREE.Vector3(u, top, mixerD)));
      const floorY = top + (model.userData.floorY as number) + 0.004;
      this.run(bay, outlet, floorY, 0.015);
      this.show('basin', product, bay.place(u, top + 0.2, d), index + 1, total, 14);
    });
    this.mirror(bay, mergeGeometries(backMirrors)!, bay.anchor, 0.05);

    // Standing basins against the side walls, two to a wall, each under a tall backlit mirror.
    const stones = { marquina: this.textures.get('wall-01')!, statuario: this.textures.get('slab-04')!, armani: this.textures.get('slab-14')! };
    const roseGold = metal('#cf9f86', 0.24);
    const gold = metal('#d2ad6e', 0.26);
    const walls: Array<{ end: 1 | -1; pieces: Array<[Product, PedestalKind, THREE.Material]> }> = [
      { end: -1, pieces: [[PRODUCTS.standMarquina, 'marquina', roseGold], [PRODUCTS.standStatuario, 'statuario', gold]] },
      { end: 1, pieces: [[PRODUCTS.standFluted, 'fluted', gold], [PRODUCTS.standArmani, 'armani', roseGold]] },
    ];
    const pill = (w: number, h: number) => {
      const r = w / 2;
      const shape = new THREE.Shape();
      shape.moveTo(-r, -(h / 2 - r));
      shape.lineTo(-r, h / 2 - r);
      shape.absarc(0, h / 2 - r, r, Math.PI, 0, true);
      shape.lineTo(r, -(h / 2 - r));
      shape.absarc(0, -(h / 2 - r), r, 0, Math.PI, true);
      return shape;
    };
    const tallHalo = glowTexture('rgba(255,214,165,0.42)', 'rgba(255,214,165,0)');
    let number = stations.length;
    for (const { end, pieces } of walls) {
      // The side wall's own frame: x runs along it (out of the bay is +x for end -1), z out of it.
      const cheek = new THREE.Group();
      cheek.position.set(end * (bay.width / 2), 0, 0);
      cheek.rotation.y = -end * Math.PI / 2;
      bay.anchor.add(cheek);
      cheek.updateMatrixWorld(true);
      const glassShapes: THREE.BufferGeometry[] = [];
      const gap = 0.05;
      pieces.forEach(([product, kind, finish], i) => {
        const d = i === 0 ? 1.2 : 2.12;
        const along = end * d;
        const piece = pedestal(kind, stones);
        const radius = kind === 'fluted' ? 0.37 / 2 : 0.2225;
        const out = gap + radius;
        piece.group.position.set(along, 0, out);
        cheek.add(piece.group);
        piece.group.updateMatrixWorld(true);
        const rim = kind === 'fluted' ? 0.8 : 0.9;
        // Contact shadow on the floor, and the spout above the bowl with its water running.
        const shadow = shade(this.blob);
        shadow.userData.strength = 0.75;
        const patch = this.plane(0.8, 0.8, shadow);
        patch.rotation.x = -Math.PI / 2;
        patch.renderOrder = 1;
        patch.position.set(along, 0.008, out);
        cheek.add(patch);
        bay.shadows.push(shadow);
        const spout = wallSpout(finish, out);
        spout.group.position.set(along, rim + 0.24, 0);
        cheek.add(spout.group);
        spout.group.updateMatrixWorld(true);
        const outlet = spout.group.localToWorld(spout.outlet.clone());
        this.run(bay, outlet, piece.floor + 0.004, 0.013);
        // The mirror: a tall pill of glass with a brass edge and a halo of light behind it.
        const mirrorY = rim + 0.86;
        const haloMaterial = glow(tallHalo, 0);
        const haloPlane = this.plane(1.3, 1.9, haloMaterial);
        haloPlane.position.set(along, mirrorY, 0.006);
        cheek.add(haloPlane);
        bay.glows.push({ material: haloMaterial, opacity: 1 });
        const shape = pill(0.52, 0.96);
        const fallback = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), new THREE.MeshBasicMaterial({ map: mirrorFace }));
        fallback.position.set(along, mirrorY, 0.012);
        cheek.add(fallback);
        glassShapes.push(new THREE.ShapeGeometry(shape, 24).translate(along, mirrorY, 0));
        const frameShape = pill(0.55, 0.99);
        frameShape.holes.push(new THREE.Path(pill(0.52, 0.96).getPoints(48)));
        const frame = new THREE.Mesh(new THREE.ShapeGeometry(frameShape, 24), brass);
        frame.position.set(along, mirrorY, 0.018);
        cheek.add(frame);
        number += 1;
        this.show('basin', product, cheek.localToWorld(new THREE.Vector3(along, 0.95, out)), number, total, 14);
      });
      this.mirror(bay, mergeGeometries(glassShapes)!, cheek, 0.016);
    }
  }

  /** A running tap: a ribbon of water from the outlet down to where it lands, turned to the visitor each frame. */
  private run(bay: Bay, outlet: THREE.Vector3, floorY: number, width: number) {
    const water = stream(width);
    water.object.position.copy(outlet);
    water.setLength(outlet.y - floorY);
    this.pour(bay, water);
    this.streams.push(water.object);
  }

  /**
   * A true mirror: the room is drawn again from the mirrored viewpoint, once
   * for all the glass in one plane. It only draws while the visitor is at its
   * bay and the glass is in view; from further off a painted mirror stands in.
   */
  private mirror(bay: Bay, geometry: THREE.BufferGeometry, parent: THREE.Object3D, z: number) {
    const [width, height] = this.mirrorSize();
    const glass = new Reflector(geometry, { textureWidth: width, textureHeight: height, color: 0x817c76, clipBias: 0.002, multisample: this.ratioCap > 1.5 ? 4 : 0 });
    (glass.material as THREE.ShaderMaterial).toneMapped = false;
    glass.position.z = z;
    glass.visible = false;
    // Inside a reflection the other mirrors step aside for their painted stand-ins, so the
    // glass never recurses or shows a stale image.
    const draw = glass.onBeforeRender.bind(glass);
    glass.onBeforeRender = (...args) => {
      if (World.reflecting) return;
      World.reflecting = true;
      const others = this.mirrors.filter((entry) => entry.glass !== glass && entry.glass.visible);
      for (const entry of others) entry.glass.visible = false;
      try { draw(...args); } finally {
        for (const entry of others) entry.glass.visible = true;
        World.reflecting = false;
      }
    };
    parent.add(glass);
    this.mirrors.push({ glass, bay });
  }

  private mirrorSize() {
    const width = Math.min(1280, Math.round(window.innerWidth * Math.min(window.devicePixelRatio, 2) * 0.6));
    return [width, Math.round(width * (window.innerHeight / window.innerWidth))];
  }

  /**
   * Four Comlux wall-hung WCs on a stone-clad duct wall: a book-matched Onice
   * room with a polished ledge running its full width, lit from beneath, each
   * pan under its flush plate with a brass roll holder beside it.
   */
  private buildFormBay() {
    const bay = this.bay(FORM, 3.0, { id: 'slab-10', tile: [1.2, 2.4] }, 'slab-14', true);
    const seat = 0.4; // top of the seat above the floor
    const duct = 0.2; // the duct wall stands this far out from the back wall
    const ledgeY = 1.08;
    // The duct wall in the same stone, with a Statuario ledge over it.
    const cladding = lit({ map: this.textures.get('slab-10'), repeat: [bay.width / 1.2, ledgeY / 2.4], book: true, grout: 0.5, gloss: 1, ambient: 0.26, lamps: bay.lamps });
    const ledgeStone = lit({ map: this.textures.get('slab-04'), repeat: [bay.width / 2.4, 1], gloss: 1.2, ambient: 0.5, lamps: bay.lamps });
    bay.surfaces.push(cladding, ledgeStone);
    this.fit(bay, this.box(bay.width - 0.004, ledgeY, duct, [cladding, cladding, flat('#2a2420'), flat('#2a2420'), cladding, cladding]), 0, ledgeY / 2, duct / 2);
    this.fit(bay, this.box(bay.width - 0.004, 0.03, duct + 0.05, ledgeStone), 0, ledgeY + 0.015, (duct + 0.05) / 2);
    // A line of light under the ledge's lip, washing down the stone.
    this.fit(bay, this.box(bay.width - 0.1, 0.006, 0.01, flat('#fff1dc')), 0, ledgeY - 0.004, duct + 0.03);
    const wash = glow(bandTexture('rgba(255,222,180,0.45)', true, 0), 0);
    this.fit(bay, this.plane(bay.width - 0.1, 0.6, wash), 0, ledgeY - 0.3, duct + 0.003);
    bay.glows.push({ material: wash, opacity: 1 });
    // Objects on the ledge: a brass vase of dried stems, and a pair of stone candle holders.
    const brassVase = metal('#c7a46b', 0.28);
    const vase = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.055, 0), new THREE.Vector2(0.07, 0.08), new THREE.Vector2(0.04, 0.2), new THREE.Vector2(0.03, 0.26), new THREE.Vector2(0.034, 0.27)], 40), brassVase);
    this.fit(bay, vase, -2.75, ledgeY + 0.03, 0.12);
    const stem = flat('#8a6a45');
    for (let i = 0; i < 7; i += 1) {
      const rod = this.box(0.004, 0.55 + (i % 3) * 0.08, 0.004, stem);
      rod.rotation.z = (i - 3) * 0.09;
      rod.rotation.x = ((i % 2) - 0.5) * 0.15;
      this.fit(bay, rod, -2.75 + (i - 3) * 0.012, ledgeY + 0.5, 0.12);
    }
    const candleStone = lit({ map: this.textures.get('wall-01'), ambient: 0.5, gloss: 0.8, lamps: bay.lamps });
    for (const [u, h] of [[2.6, 0.16], [2.78, 0.1]] as const) {
      this.fit(bay, new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, h, 32), candleStone), u, ledgeY + 0.03 + h / 2, 0.12);
      this.fit(bay, new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24), flat('#f3ece0')), u, ledgeY + 0.04 + h, 0.12);
    }

    const pairs: Array<[Product, 'black' | 'chrome' | 'graphite', boolean]> = [
      [PRODUCTS.wcGreen, 'graphite', false],
      [PRODUCTS.wcBlack, 'black', true],
      [PRODUCTS.wcCappuccino, 'chrome', false],
      [PRODUCTS.wcGrey, 'black', true],
    ];
    const holderBrass = metal('#c9a66e', 0.25);
    const paper = new THREE.MeshPhysicalMaterial({ color: '#f4f1ec', roughness: 0.9 });
    pairs.forEach(([product, plateFinish, portrait], index) => {
      const spec = product.closet!;
      const u = (index - 1.5) * 1.42;
      const model = closet(spec);
      this.fit(bay, model, u, seat - spec.height, duct);
      this.reflect(model, bay.anchor);
      this.contact(bay, [spec.width * 1.5, spec.height * 1.6], u, seat - spec.height * 0.62, duct + 0.006, true, 0.55);
      this.contact(bay, [spec.width * 1.7, spec.depth * 1.6], u, 0.008, duct + spec.depth * 0.55, false, 0.55);
      const plate = flushPlate(plateFinish, portrait);
      this.fit(bay, plate, u, 0.86, duct + 0.004);
      this.contact(bay, [0.34, 0.3], u, 0.84, duct + 0.003, true, 0.3);
      // A brass roll holder to the right of each pan.
      const holder = new THREE.Group();
      const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 32), holderBrass);
      rose.rotation.x = Math.PI / 2;
      rose.position.z = 0.006;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.13, 16), holderBrass);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(0.065, 0, 0.06);
      const bend = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 16), holderBrass);
      bend.rotation.x = Math.PI / 2;
      bend.position.set(0, 0, 0.03);
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 40), paper);
      roll.rotation.z = Math.PI / 2;
      roll.position.set(0.065, -0.04, 0.06);
      holder.add(rose, arm, bend, roll);
      this.fit(bay, holder, u + 0.42, 0.62, duct);
      this.show('form', product, bay.place(u, 0.3, duct + 0.3), index + 1, pairs.length, 16);
    });
    // A warm wash along the floor line.
    const floorWash = glow(glowTexture('rgba(255,210,160,0.2)', 'rgba(255,210,160,0)'), 0);
    const strip = this.plane(6.8, 2.4, floorWash);
    strip.rotation.x = -Math.PI / 2;
    this.fit(bay, strip, 0, 0.01, 0.8);
    bay.glows.push({ material: floorWash, opacity: 1 });
  }

  // ------------------------------------------------------ kitchen, finale

  /**
   * A sink as a real recess: rim, sloping walls and floor are separate
   * surfaces at their true depths, all painted from the one top-down product
   * photo, so the bowl has genuine depth as the visitor moves over it.
   */
  private recessedSink(id: string, width: number, z: number, y: number, hole: number[], floor: number[]) {
    const item = find(id);
    const depth = width / item.aspect;
    const drop = 0.21;
    const position: number[] = [];
    const uv: number[] = [];
    const colour: number[] = [];
    const corner = (rect: number[], level: number, light: number) => [
      [rect[0], rect[1], level, light], [rect[2], rect[1], level, light], [rect[2], rect[3], level, light], [rect[0], rect[3], level, light],
    ];
    const push = (p: number[]) => {
      position.push((p[0] - 0.5) * width, p[2], (p[1] - 0.5) * depth);
      uv.push(p[0], 1 - p[1]);
      colour.push(p[3], p[3], p[3]);
    };
    const quad = (a: number[], b: number[], c: number[], d: number[]) => { for (const p of [a, d, c, a, c, b]) push(p); };
    const outer = corner([0, 0, 1, 1], 0, 1);
    const lip = corner(hole, 0, 1);
    const lipInner = corner(hole, 0, 0.9);
    const base = corner(floor, -drop, 0.72);
    const bed = corner(floor, -drop, 0.84);
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      quad(outer[i], outer[j], lip[j], lip[i]);
      quad(lipInner[i], lipInner[j], base[j], base[i]);
    }
    quad(bed[0], bed[1], bed[2], bed[3]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colour, 3));
    this.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: this.textures.get(id)!, vertexColors: true, side: THREE.DoubleSide })), 0, y, z);
    return depth;
  }

  /**
   * A bright kitchen hall: an island of quartz sinks under brass pendants, a
   * wall of Carysil Waltz workstations on the right with their taps running,
   * and on the left the cooking wall: an oven tower, then three gas hobs, each
   * under its own chimney hood, flames lit.
   */
  private buildKitchen() {
    const start = WING_END - 0.25;
    const end = KITCHEN_END;
    const length = start - end;
    const mid = (start + end) / 2;

    const tile = lit({
      map: this.textures.get('floor-01'), repeat: [10 / 1.8, length / 1.2], grout: 0.35, gloss: 0.5, ambient: 0.82,
      strip: { ...KITCHEN_STRIP, fill: 0.5, shine: 0.55 },
    });
    this.level(10, length, tile, 0, 0, mid);
    // Hey Concrete Billow above the cabinetry: soft drifting waves.
    const wall = lit({ colour: '#ebe4d8', noise: 0.06, ambient: 0.6, strip: { ...KITCHEN_STRIP, fill: 1.5, shine: 0 }, relief: { kind: 'billow', size: [1.4, 0.32], depth: 0.035 } });
    this.level(10, length, flat('#d9d1c4'), 0, 5.4, mid, true);

    // Cabinetry down both walls: base units under a stone top, a slab splashback, wall units above.
    const white = canvasTexture(4, 4, (context) => { context.fillStyle = '#fff'; context.fillRect(0, 0, 4, 4); });
    const runFrom = start - 0.6;
    const runTo = end + 0.6;
    const run = runFrom - runTo;
    const runMid = (runFrom + runTo) / 2;
    const doors = (colour: string, along: number) => lit({ map: white, colour, repeat: [along / 0.6, 1], grout: 0.9, ambient: 0.62, strip: { ...KITCHEN_STRIP, fill: 1.3, shine: 0 } });
    const worktop = lit({ map: this.textures.get('slab-08'), repeat: [1, run / 1.3], grout: 0.4, gloss: 0.6, ambient: 0.8, strip: { ...KITCHEN_STRIP, fill: 0.5, shine: 0.45 } });
    const splash = lit({ map: this.textures.get('slab-04'), repeat: [run / 1.2, 1.42 / 2.4], grout: 0.5, gloss: 0.5, ambient: 0.74, strip: { ...KITCHEN_STRIP, fill: 0.9, shine: 0.2 } });
    const underLight = glow(bandTexture('rgba(255,236,205,0.5)', true, 0), 1);
    const brass = flat('#b9975f');
    const topY = 0.92;
    const cabinetColour = '#5b4332';
    const wallColour = '#6a503c';
    // Which stretches of each wall the wall units leave free (for the hoods and the oven tower).
    const gaps: Record<string, Array<[number, number]>> = {
      '-1': [[OVEN_Z + 0.33, OVEN_Z - 0.33], ...COOKING.map((z) => [z + 0.47, z - 0.47] as [number, number])],
      '1': [],
    };
    const segments = (from: number, to: number, holes: Array<[number, number]>) => {
      const out: Array<[number, number]> = [];
      let cursor = from;
      for (const [near, far] of holes.slice().sort((p, q) => q[0] - p[0])) {
        if (near < cursor) out.push([cursor, near]);
        cursor = far;
      }
      if (cursor > to) out.push([cursor, to]);
      return out;
    };
    // Worktop holes for the Waltz sinks, filled in as the sinks are made.
    const sinkHoles: Array<{ z0: number; z1: number; x0: number; x1: number }> = [];
    const workstationSpecs: WorkstationSpec[] = [
      { id: 'Waltz 560 FE', width: 0.56, depth: 0.51, bowlWidth: 0.5, bowlDepth: 0.36, finish: 'deep-black', deck: true, accessories: ['mat'] },
      { id: 'Waltz 610', width: 0.61, depth: 0.508, bowlWidth: 0.572, bowlDepth: 0.387, finish: 'metallico', deck: false, accessories: ['colander'] },
      { id: 'Waltz 780', width: 0.78, depth: 0.51, bowlWidth: 0.72, bowlDepth: 0.37, finish: 'snova', deck: false, accessories: ['board', 'mat'] },
    ];
    const products: Product[] = [
      { id: 'waltz-560-fe', title: 'Waltz 560 FE workstation sink', brand: 'Carysil', meta: 'Deep Black quartz, rose gold kit · 560 × 510 mm' },
      { id: 'waltz-610', title: 'Waltz 610 workstation sink', brand: 'Carysil', meta: 'Metallico quartz, rose gold kit · 610 × 508 mm' },
      { id: 'waltz-780', title: 'Waltz 780 workstation sink', brand: 'Carysil', meta: 'Snova quartz, rose gold kit · 780 × 510 mm' },
    ];
    const depthOf = (side: number) => (side === 1 ? 0.74 : 0.66);

    // The two walls as bays of their own, so the model lights and running water follow the visitor here too.
    const wallBay = (side: 1 | -1, zs: number[], lampY: number, targetY: number): Bay => {
      const anchor = new THREE.Group();
      anchor.position.set(side * 5, 0, 0);
      anchor.rotation.y = -side * Math.PI / 2;
      this.scene.add(anchor);
      anchor.updateMatrixWorld();
      const centre = (zs[0] + zs[zs.length - 1]) / 2;
      // Bay lights aim 1.4 m in front of their targets (see the rig), so these sit behind the wall.
      const lamps: Lamp[] = zs.slice(0, 3).map((z) => ({ position: [side * 3.6, lampY, z + 0.6], target: [side * 5.75, targetY / 0.6, z], intensity: 1, angle: 40 }));
      const bay: Bay = {
        side, centre, wallX: side * 5, width: Math.abs(zs[0] - zs[zs.length - 1]) + 1.5, height: 5.4, lamps, anchor,
        mouth: new THREE.Vector3(side * 2.6, 1.5, centre),
        surfaces: [], shadows: [], glows: [], waters: [], programme: [], clock: 0,
        place: (u, y, d) => new THREE.Vector3(side * (5 - d), y, side * u),
      };
      this.bays.push(bay);
      return bay;
    };
    const sinkWall = wallBay(1, WORKSTATIONS, 3.4, 0.9);
    const cookWall = wallBay(-1, [OVEN_Z, ...COOKING], 3.5, 1.2);
    cookWall.lamps = COOKING.map((z) => ({ position: [-3.5, 3.5, z + 0.6], target: [-5.75, 2, z], intensity: 1, angle: 40 }));

    workstationSpecs.forEach((spec, i) => {
      const z = WORKSTATIONS[i];
      const d = depthOf(1) / 2 + 0.035; // a little forward of the middle of the worktop
      const sink = workstation(spec);
      // Wall space of the right wall: u = z, d out from the wall.
      sink.group.position.set(z, topY, d);
      sink.group.rotation.y = 0;
      sinkWall.anchor.add(sink.group);
      sink.group.updateMatrixWorld(true);
      const { a, b, z: bowlZ } = sink.opening;
      sinkHoles.push({ z0: z + a, z1: z - a, x0: 5 - (d + bowlZ + b), x1: 5 - (d + bowlZ - b) });
      const outlet = sink.group.localToWorld(sink.outlet.clone());
      this.run(sinkWall, outlet, topY + sink.floorY, 0.012);
      this.show('kitchen', products[i], sink.group.localToWorld(new THREE.Vector3(0, 0.05, 0)), 5 + i, 11, 22);
    });

    for (const side of [-1, 1] as const) {
      const depth = depthOf(side);
      const front = side * (5 - depth + 0.04);
      // Base units: door fronts (no solid top, so sinks can drop into them), a recessed plinth, end panels.
      const fronts = this.wall(side, front, runFrom, runTo, 0.78, doors(cabinetColour, run), 0.1);
      fronts.userData.cabinet = true;
      this.wall(side, side * (5 - depth + 0.1), runFrom, runTo, 0.1, flat('#2a211b'));
      for (const zEnd of [runFrom, runTo]) {
        const cap = this.plane(depth - 0.04, 0.88, flat('#4a3628'));
        cap.rotation.y = zEnd === runFrom ? 0 : Math.PI;
        this.add(cap, side * (5 - (depth - 0.04) / 2), 0.44, zEnd);
      }
      // Worktop: a top face with openings for any sinks, and its front edge.
      const holes = side === 1 ? sinkHoles : [];
      this.worktop(side * (5 - depth), side * 5, runFrom, runTo, topY, holes, worktop);
      this.wall(side, side * (5 - depth), runFrom, runTo, 0.04, worktop, topY - 0.04);
      this.wall(side, side * 4.985, runFrom, runTo, 1.42, splash, topY);
      this.wall(side, side * 4.975, runFrom, runTo, 0.75, underLight, 1.59);
      // Wall units, broken where the hoods and the oven tower need the wall.
      for (const [from, to] of segments(runFrom, runTo, gaps[String(side)])) {
        const along = from - to;
        this.add(this.box(0.4, 1.12, along, doors(wallColour, along)), side * 4.8, 2.9, (from + to) / 2);
        this.add(this.box(0.012, 0.012, along, brass), side * 4.595, 2.345, (from + to) / 2);
      }
      // A bulkhead over the wall units that the chimneys run up into.
      this.add(this.box(0.46, 0.24, run, lit({ colour: '#ece6dc', noise: 0.06, ambient: 0.66, strip: { ...KITCHEN_STRIP, fill: 1.3, shine: 0 } })), side * 4.77, 3.58, runMid);
      this.add(this.box(0.012, 0.012, run, brass), side * 4.535, 3.46, runMid);
      this.add(this.box(0.12, 0.02, length, flat('#ffffff')), side * 1.7, 5.38, mid);
      this.wall(side, side * 5, start, end, 5.4, wall);
    }

    // The cooking wall: the Bio-07 oven tower, then three hobs under their hoods.
    const tower = ovenTower(doors(cabinetColour, 0.64), 3.46);
    tower.position.set(-OVEN_Z, 0, 0);
    cookWall.anchor.add(tower);
    tower.updateMatrixWorld(true);
    this.show('kitchen', { id: 'bio-07', title: 'Bio-07 built-in oven', brand: 'Carysil', meta: '75 L, 8.8" touch screen, with the MWO-1 microwave above' }, new THREE.Vector3(-4.4, 1.3, OVEN_Z), 1, 11, 22);
    const stations: Array<{ hob: HobSpec; hood: HoodKind; product: Product }> = [
      {
        hob: { id: 'Bravo 90-5', width: 0.9, depth: 0.52, lit: [2], cookware: [{ burner: 2, kind: 'pan' }], burners: [{ x: -0.3, z: -0.11, size: 'dual' }, { x: -0.3, z: 0.1, size: 'mini' }, { x: 0, z: 0, size: 'big' }, { x: 0.3, z: -0.11, size: 'dual' }, { x: 0.3, z: 0.1, size: 'dual' }] },
        hood: 'miracle',
        product: { id: 'miracle-bravo', title: 'Miracle hood · Bravo 90-5 hob', brand: 'Carysil', meta: 'Black glass, touch, 1350 m³/h · five brass burners on 8 mm glass' },
      },
      {
        hob: { id: 'Bravo 78-4', width: 0.78, depth: 0.52, lit: [3], burners: [{ x: -0.2, z: -0.11, size: 'dual' }, { x: 0.12, z: -0.12, size: 'dual' }, { x: -0.24, z: 0.08, size: 'mini' }, { x: 0.22, z: 0.06, size: 'big' }] },
        hood: 'tune-t',
        product: { id: 'tune-t-bravo', title: 'Tune T hood · Bravo 78-4 hob', brand: 'Carysil', meta: 'Matt black, BLDC motor, Bluetooth · four brass burners' },
      },
      {
        hob: { id: 'Pro 75-3', width: 0.75, depth: 0.45, lit: [1], cookware: [{ burner: 1, kind: 'pot' }], burners: [{ x: -0.24, z: 0.03, size: 'mini' }, { x: 0, z: -0.08, size: 'big' }, { x: 0.24, z: 0.03, size: 'dual' }] },
        hood: 'crysta-plus',
        product: { id: 'crysta-pro', title: 'Crysta Plus hood · Pro 75-3 hob', brand: 'Carysil', meta: 'Filterless, motion sensor · three brass burners, auto ignition' },
      },
    ];
    const hoodBottom = topY + 0.7;
    stations.forEach(({ hob: spec, hood: kind, product }, i) => {
      const z = COOKING[i];
      // Wall space of the left wall: u = -z.
      const cooktop = hob(spec);
      cooktop.group.position.set(-z, topY, depthOf(-1) / 2 + 0.02);
      cookWall.anchor.add(cooktop.group);
      this.flames.push(...cooktop.flames);
      const canopy = hood(kind, 3.46 - hoodBottom);
      canopy.position.set(-z, hoodBottom, 0);
      cookWall.anchor.add(canopy);
      // The hood's lamps light the hob below it.
      this.level(1.1, 0.7, glow(glowTexture('rgba(255,236,200,0.42)', 'rgba(255,236,200,0)'), 1), -4.67, topY + 0.012, z);
      this.show('kitchen', product, new THREE.Vector3(-4.6, 1.35, z), 2 + i, 11, 22);
    });

    // The island: a stone top with openings cut for each sink.
    const islandLength = 10.5;
    const islandMid = -78.85;
    const islandTop = 0.922;
    const half = 0.9;
    const body = lit({ colour: '#4f3a2c', noise: 0.1, ambient: 0.6, strip: { ...KITCHEN_STRIP, fill: 1.2, shine: 0 } });
    // Sides only: the top is laid separately so the sinks can drop into it.
    for (const side of [-1, 1]) this.wall(-side, side * half, islandMid + islandLength / 2, islandMid - islandLength / 2, islandTop, body);
    for (const end2 of [1, -1]) {
      const cap = this.plane(half * 2, islandTop, body);
      cap.rotation.y = end2 === 1 ? 0 : Math.PI;
      this.add(cap, 0, islandTop / 2, islandMid + end2 * islandLength / 2);
    }

    const sinks = ['sink-01', 'sink-02', 'sink-03', 'sink-05'].map(find);
    const insets: Record<string, [number[], number[]]> = {
      // Where the bowl opens, and where its floor begins, as fractions of each product photo.
      bigBowl: [[0.05, 0.07, 0.95, 0.93], [0.11, 0.14, 0.89, 0.86]],
      salsa: [[0.056, 0.065, 0.944, 0.94], [0.116, 0.136, 0.884, 0.864]],
    };
    const sinkWidth = 1.12;
    const openings: Array<{ z0: number; z1: number; x0: number; x1: number }> = [];
    sinks.forEach((item, index) => {
      const z = -75.4 - index * 2.3;
      const [hole, floor] = insets[item.title.startsWith('Salsa') ? 'salsa' : 'bigBowl'];
      const depth = this.recessedSink(item.id, sinkWidth, z, islandTop + 0.004, hole, floor);
      openings.push({ z0: z + depth / 2, z1: z - depth / 2, x0: -sinkWidth / 2, x1: sinkWidth / 2 });
      this.exhibits.push({
        id: item.id, room: 'kitchen', title: item.title, brand: item.brand, meta: item.meta, index: index + 8, total: 11,
        position: new THREE.Vector3(0, 0.93, z), reach: 5.2, cone: 26,
      });
    });
    // Worktop around the openings, with its stone pattern running continuously through them.
    const top = lit({
      map: this.textures.get('slab-02'), repeat: [1, islandLength / 3.6], grout: 0.6, gloss: 1, ambient: 0.78,
      strip: { ...KITCHEN_STRIP, fill: 0.4, shine: 0 },
    });
    this.worktop(-half, half, islandMid + islandLength / 2, islandMid - islandLength / 2, islandTop, openings, top, [half * 2, islandLength]);

    // Brass pendants over the island, one each side of every sink.
    const shadeMetal = flat('#7d6238', { side: THREE.DoubleSide });
    const bulb = flat('#fff3d6');
    const cord = flat('#2b2622');
    const bloom = glowTexture('rgba(255,226,180,0.55)', 'rgba(255,226,180,0)');
    const pool = glowTexture('rgba(255,226,180,0.3)', 'rgba(255,226,180,0)');
    for (let i = 0; i < 4; i += 1) {
      for (const side of [-1, 1]) {
        const x = side * 1.5;
        const z = -75.4 - i * 2.3 - (side === 1 ? 1.15 : 0);
        this.add(this.box(0.005, 5.4 - 1.96, 0.005, cord), x, (5.4 + 1.96) / 2, z);
        this.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.095, 0.16, 32, 1, true), shadeMetal), x, 1.88, z);
        this.add(new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), bulb), x, 1.803, z).rotation.x = Math.PI / 2;
        this.add(this.plane(0.6, 0.6, glow(bloom, 0.6)), x, 1.8, z + 0.02);
        this.level(2.6, 2.6, glow(pool, 0.7), x, 0.012, z);
      }
    }

    // From the bright hall, the last room is a doorway of dark.
    this.add(this.box(3.3, 5.4, 0.5, wall), -3.35, 2.7, end);
    this.add(this.box(3.3, 5.4, 0.5, wall), 3.35, 2.7, end);
    this.add(this.box(3.4, 1.2, 0.5, wall), 0, 4.8, end);
    this.veilDark = new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.add(this.plane(3.4, 4.2, this.veilDark), 0, 2.1, end).renderOrder = 10;
  }

  /**
   * A horizontal worktop between x0..x1 and z from..to, with rectangular openings
   * left for sinks. The stone runs continuously across the whole top.
   */
  private worktop(x0: number, x1: number, from: number, to: number, y: number, holes: Array<{ z0: number; z1: number; x0: number; x1: number }>, material: THREE.Material, size?: [number, number]) {
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const span = size ?? [right - left, from - to];
    const position: number[] = [];
    const uv: number[] = [];
    const normal: number[] = [];
    const quad = (qa: number, qb: number, za: number, zb: number) => {
      if (qb - qa < 1e-4 || za - zb < 1e-4) return;
      for (const [x, z] of [[qa, za], [qb, zb], [qa, zb], [qa, za], [qb, za], [qb, zb]]) {
        position.push(x, y, z);
        uv.push((x - left) / span[0], (from - z) / span[1]);
        normal.push(0, 1, 0);
      }
    };
    let cursor = from;
    for (const hole of holes.slice().sort((p, q) => q.z0 - p.z0)) {
      quad(left, right, cursor, hole.z0);
      quad(left, hole.x0, hole.z0, hole.z1);
      quad(hole.x1, right, hole.z0, hole.z1);
      cursor = hole.z1;
    }
    quad(left, right, cursor, to);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    const mesh = new THREE.Mesh(geometry, material);
    this.scene.add(mesh);
    return mesh;
  }

  /**
   * The last room: a dark gallery whose whole far wall is book-matched Rosso
   * Levanto, four slabs wide and full height, washed from a slot in the ceiling,
   * over a polished Calacatta Nero floor that holds its reflection.
   */
  private buildFinale() {
    const item = find('feature-01');
    const map = this.textures.get('feature-01')!;
    const columns = 4;
    const rows = 1;
    const slabWidth = 2.7;
    const slabHeight = slabWidth / item.aspect;
    const width = columns * slabWidth;
    const height = rows * slabHeight;
    const half = width / 2;
    const start = KITCHEN_END - 0.25;
    const length = start - FEATURE;
    const mid = (start + FEATURE) / 2;
    const lines: Strip = { x: 2.2, y: height - 0.02, from: start, to: FEATURE + 0.4, colour: '#ffe6c8' };

    // The wall, grazed by a row of wall-washers in the ceiling slot just in front of it.
    const lamps: Lamp[] = [-1.5, -0.5, 0.5, 1.5].map((k) => ({ position: [k * slabWidth, height - 0.05, FEATURE + 0.7], target: [k * slabWidth, height * 0.3, FEATURE], intensity: 1.05, angle: 40, colour: '#fff1e2' }));
    const face = lit({ map, repeat: [columns, rows], book: true, grout: 0.4, gloss: 0.5, ambient: 0.52, lamps });
    this.add(this.plane(width, height, face), 0, height / 2, FEATURE);
    const image = lit({ map, repeat: [columns, rows], book: true, grout: 0.4, ambient: 0.9 });
    const reflection = this.plane(width, height, image);
    reflection.scale.y = -1;
    this.add(reflection, 0, -height / 2, FEATURE);
    this.feature = [face, image];

    // Polished black marble floor, charcoal walls and ceiling, two lines of light leading to the wall.
    const floor = lit({
      map: this.textures.get('wall-01'), colour: '#9a948e', repeat: [width / 1.2, length / 2.4], book: true, grout: 0.5,
      gloss: 1.4, ambient: 0.5, opacity: 0.8, strip: { ...lines, fill: 0.15, shine: 1.3 },
    });
    this.level(width, length, floor, 0, 0, mid).renderOrder = -1;
    // The reflection fades as the floor runs away from the wall, the way a polished floor does.
    const fade = canvasTexture(4, 256, (context) => {
      const gradient = context.createLinearGradient(0, 0, 0, 256);
      gradient.addColorStop(0, 'rgba(10,9,8,0)');
      gradient.addColorStop(0.55, 'rgba(10,9,8,0.55)');
      gradient.addColorStop(1, 'rgba(10,9,8,0.92)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 4, 256);
    });
    this.level(width, 7, new THREE.MeshBasicMaterial({ map: fade, transparent: true, depthWrite: false }), 0, 0.003, FEATURE + 3.5);
    // Hey Concrete Prism in charcoal: the lines of light pick out every facet.
    const walls = lit({ colour: '#34302c', noise: 0.15, ambient: 0.3, strip: { ...lines, fill: 1.3, shine: 0 }, relief: { kind: 'prism', size: [0.42, 0.42], depth: 0.09 } });
    for (const side of [-1, 1]) {
      this.wall(side, side * half, start, FEATURE, height, walls);
      this.add(this.box(0.012, height, 0.03, flat('#b39363')), side * (half - 0.006), height / 2, FEATURE + 0.015);
      this.add(this.box(0.06, 0.02, length - 0.6, flat('#fff1de')), side * lines.x, height - 0.012, mid + 0.3);
    }
    this.level(width, length, flat('#141110'), 0, height, mid, true);
    // The slot the wall-washers sit in, and the warm wash they throw down the stone.
    this.add(this.box(width, 0.03, 0.14, flat('#fff4e4')), 0, height - 0.016, FEATURE + 0.7);
    this.wash = glow(bandTexture('rgba(255,214,170,0.3)', true, 0), 0);
    this.add(this.plane(width, height * 0.75, this.wash), 0, height * 0.625, FEATURE + 0.02);

    // The Marble Park monogram, drawn in brass rod and stood off the stone.
    const scale = 4.1 / 1337;
    const at = (x: number, y: number) => new THREE.Vector3((x - 668) * scale, (415 - y) * scale + height * 0.5, FEATURE + 0.16);
    const line = (from: [number, number], to: [number, number]) => Array.from({ length: 13 }, (_, i) => at(mix(from[0], to[0], i / 12), mix(from[1], to[1], i / 12)));
    const curve = new THREE.CubicBezierCurve(new THREE.Vector2(715, 180), new THREE.Vector2(790, 85), new THREE.Vector2(890, 22), new THREE.Vector2(990, 22));
    const sweep = [
      ...line([210, 830], [715, 180]),
      ...curve.getPoints(14).map((p) => at(p.x, p.y)),
      ...Array.from({ length: 40 }, (_, i) => {
        const angle = THREE.MathUtils.degToRad(-90 + (192.9 * (i + 1)) / 40);
        return at(990 + Math.cos(angle) * 325, 347 + Math.sin(angle) * 325);
      }),
    ];
    const strokes = [[...line([24, 830], [24, 62]), ...line([24, 62], [367, 512])], sweep, line([818, 265], [818, 830])];
    const rod = flat('#d9bb82');
    const hot = flat('#f0d6a4');
    strokes.forEach((points, index) => {
      const path = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0);
      this.scene.add(new THREE.Mesh(new THREE.TubeGeometry(path, points.length * 4, 0.042, 12), index === 1 ? hot : rod));
    });
    this.sign = [rod, hot];
    this.halo = glow(glowTexture('rgba(255,170,110,0.28)', 'rgba(255,170,110,0)'), 0);
    this.add(this.plane(9.5, 6, this.halo), 0, height * 0.5, FEATURE + 0.08);
  }

  // --------------------------------------------------------------- frame

  /** Keeps motion smooth: lower the render resolution when frames run long, raise it again when there is headroom. */
  private adapt(delta: number) {
    if (delta >= 0.1) return; // a throttled or backgrounded tab, not a slow device
    this.frameAverage += (delta - this.frameAverage) * 0.05;
    this.frameClock += delta;
    if (this.frameClock < 2) return;
    this.frameClock = 0;
    let next = this.ratio;
    if (this.frameAverage > 1 / 46 && this.ratio > 1) next = Math.max(1, this.ratio - 0.25);
    else if (this.frameAverage < 1 / 57 && this.ratio < this.ratioCap) next = Math.min(this.ratioCap, this.ratio + 0.25);
    if (next !== this.ratio) {
      this.ratio = next;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
  }

  render(time: number, delta: number) {
    if (!this.built) return;
    this.adapt(delta);
    sample(this.keys, this.target, this.goal);
    const ease = this.still ? 1 : 1 - Math.exp(-delta * 4.2);
    const state = this.state;
    for (let i = 0; i < 6; i += 1) state[i] = mix(state[i], this.goal[i], ease);
    const z = state[2];

    this.pointerEase.lerp(this.pointer, this.still ? 0 : 1 - Math.exp(-delta * 3));
    const inGallery = smooth(-2, -6, z) * (1 - smooth(-35, -39, z));
    const drift = this.still ? 0 : Math.sin(z * 0.21) * 0.32 * this.spread * inGallery;
    this.eye.set(state[0] + drift, state[1], z);
    this.gaze.set(state[3], state[4], state[5]);

    // What the visitor is looking at: the closest thing near the line of sight.
    const forward = this.scratch.copy(this.gaze).sub(this.eye).normalize();
    let nearest: Exhibit | null = null;
    let best = Infinity;
    let activeScore = Infinity;
    for (const exhibit of this.exhibits) {
      const dx = exhibit.position.x - this.eye.x;
      const dy = exhibit.position.y - this.eye.y;
      const dz = exhibit.position.z - this.eye.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > exhibit.reach || distance < 0.4) continue;
      const cosine = (dx * forward.x + dy * forward.y + dz * forward.z) / distance;
      const angle = Math.acos(Math.min(1, Math.max(-1, cosine))) * 57.2958;
      if (angle > exhibit.cone) continue;
      const score = angle / exhibit.cone + distance / exhibit.reach;
      if (exhibit === this.active) activeScore = score;
      if (score < best) { best = score; nearest = exhibit; }
    }
    // Hysteresis: the caption stays put unless another product is clearly the one in view.
    if (this.active && activeScore < Infinity && nearest !== this.active && best > activeScore - 0.14) nearest = this.active;
    if (nearest !== this.active) { this.active = nearest; this.onExhibit(nearest); }

    // In the gallery the head turns a little toward each slab.
    const lookGoal = nearest && nearest.room === 'stone' ? nearest.position.x * this.turn : 0;
    this.lookX = mix(this.lookX, lookGoal, this.still ? 1 : 1 - Math.exp(-delta * 2.2));
    // Pointer parallax, applied across the view whichever way the camera faces.
    const rightX = -forward.z;
    const rightZ = forward.x;
    const sway = this.pointerEase.x * 0.5;
    this.camera.position.set(this.eye.x + rightX * this.pointerEase.x * 0.1, this.eye.y + this.pointerEase.y * 0.04, this.eye.z + rightZ * this.pointerEase.x * 0.1);
    this.camera.lookAt(this.gaze.x + this.lookX + rightX * sway, this.gaze.y + this.pointerEase.y * 0.25, this.gaze.z + rightZ * sway);

    // Each tap's stream is a flat ribbon, so it is kept turned toward the visitor.
    const yaw = Math.atan2(-forward.x, -forward.z);
    for (const water of this.streams) water.rotation.y = yaw;
    // Gas flames flicker.
    if (!this.still) this.flames.forEach((fire, i) => { fire.scale.set(1, 0.85 + 0.3 * Math.abs(Math.sin(time * 19 + i * 1.7) * Math.sin(time * 7.3 + i)), 1); });

    // The shopfront doors slide apart as the visitor walks up.
    this.facade.update(z);

    // Light changes from night stone to the bright hall and back.
    const tone = toneAt(z);
    const outside = smooth(-3, 6, z);
    this.fog.color.copy(INK).lerp(IVORY, tone).lerp(DUSK, outside);
    (this.scene.background as THREE.Color).copy(this.fog.color);
    this.sky.visible = z > -8;
    // The last room is seen whole: almost no haze between the visitor and the wall.
    const finale = smooth(KITCHEN_END + 0.5, KITCHEN_END - 2.5, z);
    this.fog.near = mix(mix(mix(4, 9, tone), 34, outside), 22, finale);
    this.fog.far = mix(mix(mix(27, 48, tone), 150, outside), 90, finale);
    this.veilDark.opacity = smooth(0, 0.3, tone);
    // The page chrome turns dark-on-light inside the building, and back for the night outside and the finale.
    // The rain room's dark stone takes light text, like the night outside.
    const rainLevel = this.bays.length > 0 ? smooth(13, 5.2, this.eye.distanceTo(this.bays[0].mouth)) : 0;
    this.inRain = this.inRain ? rainLevel > 0.5 : rainLevel > 0.64;
    const inRain = this.inRain;
    const light = z < -1.5 && z > KITCHEN_END + 2.6 && !inRain;
    if (light !== this.light) { this.light = light; this.onTone(light); }

    // Spotlights come up as the visitor approaches each slab, and the closing wall.
    for (const slab of this.slabs) this.lightSlab(slab, smooth(14, 5, z - slab.z));
    const arrival = smooth(KITCHEN_END - 0.5 - FEATURE, 11, z - FEATURE);
    setLevel(this.feature[0], 0.06 + 0.94 * arrival);
    setLevel(this.feature[1], (0.06 + 0.94 * arrival) * 0.5);
    this.sign[0].color.set('#d9bb82').multiplyScalar(0.15 + 0.85 * arrival);
    this.sign[1].color.set('#f0d6a4').multiplyScalar(0.15 + 0.85 * arrival);
    this.halo.opacity = arrival * 0.7;
    this.wash.opacity = arrival;

    // Each bay lights up, and its water turns on, as the visitor arrives.
    const step = this.still ? 10 : delta;
    let atBay: { bay: Bay; level: number } | null = null;
    for (const bay of this.bays) {
      const level = smooth(13, 5.2, this.eye.distanceTo(bay.mouth));
      if (!atBay || level > atBay.level) atBay = { bay, level };
      for (const surface of bay.surfaces) setLevel(surface, 0.3 + 0.7 * level);
      for (const shadow of bay.shadows) shadow.opacity = (shadow.userData.strength ?? 0.6) * (0.4 + 0.6 * level);
      for (const entry of bay.glows) entry.material.opacity = entry.opacity * level;
      const running = level > 0.82;
      for (const entry of this.mirrors) if (entry.bay === bay) entry.glass.visible = level > 0.45;
      for (const water of bay.waters) { water.setOn(running); water.tick(time, step); }
      if (bay.programme.length) {
        const total = bay.programme.reduce((sum, entry) => sum + entry.seconds, 0);
        bay.clock = running ? (bay.clock + delta) % total : 0;
        let elapsed = 0;
        for (const entry of bay.programme) {
          const current = running && bay.clock >= elapsed && bay.clock < elapsed + entry.seconds;
          for (const water of entry.waters) { water.setOn(current); water.tick(time, step); }
          elapsed += entry.seconds;
        }
      }
    }

    // The model lights follow the visitor to the bay they are at.
    if (atBay) {
      const { bay, level } = atBay;
      if (this.rig.bay !== bay) {
        this.rig.bay = bay;
        bay.lamps.forEach((lamp, i) => {
          this.rig.spots[i].position.set(...lamp.position);
          this.rig.spots[i].target.position.set(lamp.target[0] - bay.side * 1.4, lamp.target[1] * 0.6, lamp.target[2]);
          this.rig.spots[i].target.updateMatrixWorld();
        });
        this.rig.fill.position.set(bay.side * (HALF - 0.2), 2.4, bay.centre);
      }
      for (const spot of this.rig.spots) spot.intensity = 16 * (0.25 + 0.75 * level);
      this.rig.fill.intensity = 5 * (0.3 + 0.7 * level);
      this.scene.environmentIntensity = 0.35 + 0.3 * level;
    }

    this.renderer.render(this.scene, this.camera);
  }

  private lightSlab(slab: Slab, level: number) {
    setLevel(slab.front, 0.62 + 0.38 * level);
    slab.mirror.color.setScalar((0.62 + 0.38 * level) * 0.55);
    if (slab.pool) slab.pool.opacity = level;
  }
}
