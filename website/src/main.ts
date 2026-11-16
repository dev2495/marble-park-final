import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/manrope';
import Lenis from 'lenis';
import { STOPS, World, type Exhibit } from './world';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector(selector) as T;
// Dev only: ?p=0.42 freezes the walk at that point, for checking a single frame.
const frozen = import.meta.env.DEV ? new URLSearchParams(location.search).get('p') : null;
const reducedMotion = frozen !== null || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (frozen !== null) document.querySelector<HTMLElement>('#loader')!.style.display = 'none';
history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const journey = $('#journey');
const cards = [...document.querySelectorAll<HTMLElement>('.card')].map((element) => ({
  element, from: Number(element.dataset.in), to: Number(element.dataset.out),
}));
const railButtons = [...document.querySelectorAll<HTMLButtonElement>('.rail button')];
const stops = Object.entries(STOPS) as Array<[keyof typeof STOPS, number]>;

const span = () => journey.offsetHeight - window.innerHeight;
const progress = () => (frozen !== null ? Number(frozen) : Math.min(1, Math.max(0, window.scrollY / span())));

// ------------------------------------------------------------- scrolling

const lenis = reducedMotion ? null : new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
lenis?.stop();
if (import.meta.env.DEV) Object.assign(window, { __lenis: lenis });

function scrollTo(target: number | HTMLElement) {
  if (lenis) lenis.scrollTo(target, { duration: 2.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
  else if (typeof target === 'number') window.scrollTo({ top: target });
  else target.scrollIntoView();
}

document.addEventListener('click', (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  if (!link) return;
  const target = document.querySelector<HTMLElement>(link.getAttribute('href')!);
  if (!target) return;
  event.preventDefault();
  scrollTo(target.id === 'top' ? 0 : target);
});

for (const button of railButtons) {
  button.addEventListener('click', () => {
    const stop = button.dataset.stop as keyof typeof STOPS;
    if (stop === 'visit') scrollTo($('#visit'));
    else scrollTo(Math.ceil((STOPS[stop] + (stop === 'arrival' ? 0 : 0.035)) * span()));
  });
}

// ------------------------------------------------------------ overlays

const caption = $('#caption');
const captionIndex = $('#caption-index');
const captionTotal = $('#caption-total');
const captionTitle = $('#caption-title');
const captionMeta = $('#caption-meta');
let captionTimer = 0;

function showExhibit(exhibit: Exhibit | null) {
  window.clearTimeout(captionTimer);
  caption.classList.remove('is-on');
  if (!exhibit) return;
  captionTimer = window.setTimeout(() => {
    captionIndex.textContent = String(exhibit.index).padStart(2, '0');
    captionTotal.textContent = String(exhibit.total).padStart(2, '0');
    captionTitle.textContent = exhibit.title;
    captionMeta.textContent = [exhibit.brand, exhibit.meta].filter(Boolean).join(' · ');
    caption.classList.add('is-on');
  }, 260);
}

function updateOverlays(p: number) {
  for (const card of cards) card.element.classList.toggle('is-on', p >= card.from && p < card.to);
  let current = stops[0][0];
  for (const [name, at] of stops) if (p >= at - 0.012) current = name;
  for (const button of railButtons) button.classList.toggle('is-active', button.dataset.stop === current);
}

// Sections after the walk fade up as they arrive; figures count up once.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const element = entry.target as HTMLElement;
    element.classList.add('is-in');
    observer.unobserve(element);
    const figure = element.querySelector<HTMLElement>('[data-count]');
    if (figure && !reducedMotion) countUp(figure);
  }
}, { rootMargin: '0px 0px -12% 0px' });

document.querySelectorAll<HTMLElement>('.reveal').forEach((element) => {
  const siblings = [...element.parentElement!.children].filter((child) => child.classList.contains('reveal'));
  element.style.transitionDelay = `${Math.min(siblings.indexOf(element), 6) * 70}ms`;
  observer.observe(element);
});

function countUp(element: HTMLElement) {
  const goal = Number(element.dataset.count);
  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / 1600);
    element.textContent = Math.round(goal * (1 - Math.pow(1 - t, 4))).toLocaleString('en-IN');
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// --------------------------------------------------------------- world

const loaderPct = $('#loader-pct');
let world: World | null = null;
try {
  world = new World($<HTMLCanvasElement>('#stage') as HTMLCanvasElement, reducedMotion);
} catch {
  // No WebGL: the story still reads as text over the dark page.
  document.body.classList.add('no-webgl');
}

if (world) {
  if (import.meta.env.DEV) Object.assign(window, { __world: world });
  world.onExhibit = showExhibit;
  world.onTone = (light) => { document.body.dataset.tone = light ? 'light' : 'dark'; };
  window.addEventListener('resize', () => world!.resize());
  window.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;
    world!.setPointer((event.clientX / window.innerWidth) * 2 - 1, -((event.clientY / window.innerHeight) * 2 - 1));
  });
}

let loaded = 0;
let shown = 0;
const opened = performance.now();
const ready = world
  ? world.load((ratio) => { loaded = ratio; }).catch(() => { world = null; loaded = 1; })
  : Promise.resolve().then(() => { loaded = 1; });

let last = performance.now();
let entered = false;

function frame(now: number) {
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  lenis?.raf(now);

  if (!entered) {
    // The count follows real loading but never outruns the logo drawing itself.
    const ceiling = Math.min(1, (now - opened) / 2400);
    shown += (Math.min(loaded, ceiling) - shown) * 0.12;
    loaderPct.textContent = String(Math.round(shown * 100));
  }

  const p = progress();
  if (entered) updateOverlays(p);
  // Stop drawing once the closing sections fully cover the stage.
  if (world && window.scrollY < span() + window.innerHeight * 1.1) {
    world.setProgress(p);
    world.render(now / 1000, delta);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

ready.then(() => {
  const wait = Math.max(0, 2600 - (performance.now() - opened));
  window.setTimeout(() => {
    entered = true;
    loaderPct.textContent = '100';
    document.body.classList.remove('is-loading');
    lenis?.start();
  }, reducedMotion ? 0 : wait);
});
