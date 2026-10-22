import { Platform } from "react-native";
import type { LoadedSprite } from "./controller";
import { HAND_FRAMES, HAND_REST, HAND_SIZE, HAND_STRIP } from "./hand";

// Desktop and browser only. Declares just the DOM it uses so no DOM types reach the native bundle.
interface Style {
  cssText: string;
  setProperty(name: string, value: string): void;
}
interface PointerEventLike {
  clientX: number;
  clientY: number;
  pointerId: number;
  button: number;
  preventDefault(): void;
}
interface DomNode {
  style: Style;
  textContent: string | null;
  title: string;
  appendChild(node: DomNode): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  addEventListener(name: string, fn: (e: PointerEventLike) => void): void;
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  animate?(
    keyframes: Record<string, string>[],
    options: { duration: number; easing: string; iterations?: number },
  ): { onfinish: (() => void) | null; cancel(): void };
}
interface ImageNode {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}
interface CanvasNode {
  width: number;
  height: number;
  getContext(kind: "2d", options?: { willReadFrequently: boolean }): {
    drawImage(image: ImageNode, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> };
  } | null;
}
interface DomDocument {
  body: DomNode | null;
  hidden: boolean;
  createElement(tag: "img"): ImageNode;
  createElement(tag: "canvas"): CanvasNode;
  createElement(tag: string): DomNode;
  addEventListener(name: string, fn: () => void): void;
  removeEventListener(name: string, fn: () => void): void;
}
declare const document: DomDocument;
declare const window: {
  innerWidth: number;
  innerHeight: number;
  addEventListener(name: string, fn: () => void): void;
  removeEventListener(name: string, fn: () => void): void;
};
declare const localStorage: { getItem(key: string): string | null; setItem(key: string, value: string): void };

export interface OverlayState {
  sprite: LoadedSprite | null;
  mood: string;
  scale: number;
  visible: boolean;
  badge: number;
  label: string;
}

export interface Overlay {
  update(state: OverlayState): void;
  destroy(): void;
}

const POSITION_KEY = "codex-pets.position";
const HOSTS_KEY = "codex-pets.hosts";
const MARGIN = 8;
/** Shake meter: pixels dragged, draining at DIZZY_DRAIN px/s; above DIZZY_AT the pet is dizzy until DIZZY_MS after it drops back. */
const DIZZY_AT = 700;
const DIZZY_DRAIN = 500;
const DIZZY_MS = 4000;
/** Fractions of the frame; used when the sprite can't be read. */
const DEFAULT_HEAD: Box = { left: 0.2, right: 0.8, top: 0, bottom: 0.35 };

/** Past the last line, keep stretching it: one more of its last letter and one more "!" per pat. */
function excited(lines: string[], n: number): string {
  if (n < lines.length) return lines[n];
  const extra = n - lines.length + 1;
  const last = lines[lines.length - 1];
  return last.replace(/(\p{L})(?=[^\p{L}]*$)/u, (ch) => ch.repeat(extra + 1)) + "!".repeat(extra);
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Finds the head in the idle pose: the top 30% of its opaque pixels, padded a little. */
function findHead(sprite: LoadedSprite): Promise<Box> {
  const anim = sprite.animations.idle ?? sprite.animations[sprite.defaultAnimation];
  if (!anim) return Promise.resolve(DEFAULT_HEAD);
  const { width: w, height: h } = sprite.frame;
  return new Promise((done) => {
    const img = document.createElement("img");
    img.onerror = () => done(DEFAULT_HEAD);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return done(DEFAULT_HEAD);
        ctx.drawImage(img, 0, anim.row * h, w, h, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const solid = (x: number, y: number) => data[(y * w + x) * 4 + 3] > 40;
        let top = -1;
        let bottom = -1;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++)
            if (solid(x, y)) {
              if (top < 0) top = y;
              bottom = y;
              break;
            }
        if (top < 0) return done(DEFAULT_HEAD);
        const headBottom = top + Math.max(8, Math.round((bottom - top) * 0.3));
        let left = w;
        let right = -1;
        for (let y = top; y <= headBottom; y++)
          for (let x = 0; x < w; x++)
            if (solid(x, y)) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
        const pad = 6;
        done({
          left: Math.max(0, left - pad) / w,
          right: Math.min(w, right + pad) / w,
          top: Math.max(0, top - pad) / h,
          bottom: headBottom / h,
        });
      } catch {
        done(DEFAULT_HEAD);
      }
    };
    img.src = sprite.dataUrl;
  });
}

export function loadHosts(): { serverId: string; label: string }[] {
  if (Platform.OS !== "web") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(HOSTS_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((h) => typeof h?.serverId === "string" && typeof h?.label === "string") : [];
  } catch {
    return [];
  }
}

export function saveHosts(hosts: { serverId: string; label: string }[]): void {
  if (Platform.OS !== "web") return;
  try {
    localStorage.setItem(HOSTS_KEY, JSON.stringify(hosts));
  } catch {}
}

function loadOffset(): { right: number; bottom: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (typeof saved?.right === "number" && typeof saved?.bottom === "number") return saved;
  } catch {}
  // Above the composer, so the pet never sits on the send button.
  return { right: 24, bottom: 180 };
}

function saveOffset(offset: { right: number; bottom: number }): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(offset));
  } catch {}
}

export function mountOverlay(onOpen: () => void): Overlay | null {
  if (Platform.OS !== "web" || typeof document === "undefined" || !document.body) return null;

  const pet = document.createElement("div");
  pet.setAttribute("data-testid", "codex-pets-overlay");
  pet.setAttribute("role", "button");
  pet.style.cssText =
    "position:fixed;z-index:2147483000;cursor:grab;touch-action:none;user-select:none;background-repeat:no-repeat;display:none;";
  const badge = document.createElement("span");
  badge.style.cssText =
    "position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#e5484d;color:#fff;font:600 11px/18px system-ui,sans-serif;text-align:center;display:none;pointer-events:none;";
  pet.appendChild(badge);
  const hand = document.createElement("div");
  hand.style.cssText = `position:fixed;z-index:2147483002;pointer-events:none;display:none;background-repeat:no-repeat;image-rendering:pixelated;background-image:url("${HAND_STRIP}");`;
  document.body.appendChild(hand);
  // Above the hand, so what the pet says is never covered.
  const bubble = document.createElement("span");
  bubble.style.cssText =
    "position:fixed;z-index:2147483003;padding:4px 10px;border-radius:12px;background:#fff;color:#1a1a1a;border:2px solid #1a1a1a;font:800 15px/1.2 system-ui,sans-serif;text-align:center;overflow-wrap:anywhere;pointer-events:none;display:none;";
  document.body.appendChild(bubble);
  let handTimer: ReturnType<typeof setInterval> | null = null;
  /** Keeps the pat going while the button is held still. */
  let patBeat: ReturnType<typeof setInterval> | null = null;
  let lastSay = 0;
  document.body.appendChild(pet);

  let state: OverlayState | null = null;
  let offset = loadOffset();
  let hovering = false;
  let drag: {
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    dir: string;
    shake: number;
    at: number;
    /** Pointer's distance from the pet's right and bottom edges, so the grabbed spot stays under it. */
    grab: { right: number; bottom: number };
  } | null = null;
  let dizzy: ReturnType<typeof setTimeout> | null = null;
  let orbit: ReturnType<typeof setInterval> | null = null;
  let pat: { id: number; lastX: number; lastY: number; travel: number } | null = null;
  let patting: ReturnType<typeof setTimeout> | null = null;
  let head = DEFAULT_HEAD;
  let pats = 0;
  let spriteKey: string | undefined;
  let current = "";
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const size = () => {
    const s = state?.sprite;
    return s ? { w: s.frame.width * state!.scale, h: s.frame.height * state!.scale } : { w: 0, h: 0 };
  };

  const place = () => {
    const { w, h } = size();
    const right = Math.min(Math.max(offset.right, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN));
    const bottom = Math.min(Math.max(offset.bottom, MARGIN), Math.max(MARGIN, window.innerHeight - h - MARGIN));
    pet.style.setProperty("right", `${right}px`);
    pet.style.setProperty("bottom", `${bottom}px`);
  };

  const animationName = () => {
    const s = state?.sprite;
    if (!s) return "";
    const dizzyTurn = drag?.moved ? drag.dir.replace("running", "dizzy") : "";
    const wanted = dizzy
      ? s.animations[dizzyTurn] ? dizzyTurn : s.animations.dizzy ? "dizzy" : "failed"
      : drag?.moved
        ? drag.dir
        : pat || patting
          ? s.animations.patting ? "patting" : "waving"
          : hovering
            ? "jumping"
            : state!.mood;
    return s.animations[wanted] ? wanted : s.animations[s.defaultAnimation] ? s.defaultAnimation : "idle";
  };

  const paint = () => {
    const s = state?.sprite;
    const anim = s?.animations[current];
    if (!s || !anim) return;
    const scale = state!.scale;
    const x = (frame % anim.frames) * s.frame.width * scale;
    const y = anim.row * s.frame.height * scale;
    pet.style.setProperty("background-position", `-${x}px -${y}px`);
  };

  const tick = () => {
    timer = null;
    const s = state?.sprite;
    const anim = s?.animations[current];
    if (!s || !anim || document.hidden || !state?.visible) return;
    paint();
    const wait = anim.frameDurationsMs[frame % anim.frames] ?? 125;
    frame = (frame + 1) % anim.frames;
    timer = setTimeout(tick, wait);
  };

  const restart = () => {
    const next = animationName();
    if (next !== current) {
      current = next;
      frame = 0;
    }
    if (timer) clearTimeout(timer);
    timer = null;
    tick();
  };

  const onHead = (e: PointerEventLike) => {
    const r = pet.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return x >= head.left && x <= head.right && y >= head.top && y <= head.bottom;
  };

  // 1 at the default size, so hearts, the bubble and the hand grow with the pet.
  const grow = () => Math.max(0.7, (state?.scale ?? 0.45) / 0.45);

  const heart = (x: number, y: number) => {
    const el = document.createElement("span");
    const px = Math.round(16 * grow());
    el.textContent = "❤";
    el.style.cssText = `position:fixed;left:${x - px / 2}px;top:${y - px * 1.25}px;z-index:2147483001;pointer-events:none;color:#e5484d;font:${px}px system-ui,sans-serif;`;
    document.body?.appendChild(el);
    const drift = Math.round((Math.random() * 30 - 15) * grow());
    const run = el.animate?.(
      [
        { transform: "translate(0,0) scale(0.6)", opacity: "1" },
        { transform: `translate(${drift}px,${Math.round(-48 * grow())}px) scale(1.1)`, opacity: "0" },
      ],
      { duration: 900, easing: "ease-out" },
    );
    if (run) run.onfinish = () => el.remove();
    else setTimeout(() => el.remove(), 900);
  };

  const say = () => {
    const lines = state?.sprite?.patSays;
    if (!lines?.length || Date.now() - lastSay < 200) return;
    lastSay = Date.now();
    bubble.textContent = excited(lines, pats);
    bubble.style.setProperty("font-size", `${Math.round(15 * grow() * (1 + Math.min(pats, 33) * 0.015))}px`);
    pats++;
    const maxWidth = Math.min(window.innerWidth - 2 * MARGIN, 260 * grow());
    bubble.style.setProperty("max-width", `${maxWidth}px`);
    bubble.style.setProperty("display", "block");
    const r = pet.getBoundingClientRect();
    const half = bubble.getBoundingClientRect().width / 2;
    const center = Math.min(Math.max(r.left + r.width / 2, MARGIN + half), window.innerWidth - MARGIN - half);
    bubble.style.setProperty("left", `${center}px`);
    const tall = bubble.getBoundingClientRect().height;
    const below = r.top + r.height + 6 + tall <= window.innerHeight - MARGIN;
    bubble.style.setProperty("top", below ? `${r.top + r.height + 6}px` : `${r.top + head.top * r.height - 6 - tall}px`);
    bubble.style.setProperty("transform-origin", below ? "50% 0" : "50% 100%");
    const tilt = pats % 2 ? -6 : 6;
    bubble.animate?.(
      [
        { transform: "translateX(-50%) scale(0.4) rotate(0deg)" },
        { transform: `translateX(-50%) scale(1.25) rotate(${tilt}deg)` },
        { transform: `translateX(-50%) scale(0.95) rotate(${-tilt / 2}deg)` },
        { transform: "translateX(-50%) scale(1) rotate(0deg)" },
      ],
      { duration: 380, easing: "ease-out" },
    );
    bubble.style.setProperty("transform", "translateX(-50%)");
  };

  /** Size of one art pixel of the hand, in screen pixels. */
  const handPixel = () => Math.max(1, Math.round(2 * grow()));
  let handAt = { x: 0, y: 0 };
  let handStep = 0;

  const paintHand = () => {
    const k = handPixel();
    const { width: w, height: h } = HAND_SIZE;
    hand.style.setProperty("width", `${w * k}px`);
    hand.style.setProperty("height", `${h * k}px`);
    hand.style.setProperty("background-size", `${w * k * HAND_FRAMES}px ${h * k}px`);
    hand.style.setProperty("background-position", `-${(handStep % HAND_FRAMES) * w * k}px 0`);
    // The resting fingertips sink just into the head at the pointer.
    hand.style.setProperty("left", `${handAt.x - (w / 2) * k}px`);
    hand.style.setProperty("top", `${handAt.y - (HAND_REST - 2) * k}px`);
  };

  const moveHand = (x: number, y: number) => {
    handAt = { x, y };
    paintHand();
  };

  // The same hand shows on hover and while patting, so it never jumps in size or swaps image.
  const stillHand = (x: number, y: number) => {
    if (handTimer) clearInterval(handTimer);
    handTimer = null;
    handStep = 0;
    moveHand(x, y);
    hand.style.setProperty("display", "block");
    pet.style.setProperty("cursor", "none");
  };

  const patHand = (x: number, y: number) => {
    stillHand(x, y);
    handTimer = setInterval(() => {
      handStep++;
      paintHand();
    }, 70);
  };

  const hideHand = () => {
    if (handTimer) clearInterval(handTimer);
    handTimer = null;
    hand.style.setProperty("display", "none");
    pet.style.setProperty("cursor", "grab");
  };

  const stars = [0, 1, 2].map(() => {
    const el = document.createElement("span");
    el.textContent = "★";
    el.style.cssText =
      "position:fixed;z-index:2147483001;pointer-events:none;display:none;color:#ffd23f;text-shadow:0 0 0 #3a1e10,1px 1px 0 #3a1e10,-1px -1px 0 #3a1e10,1px -1px 0 #3a1e10,-1px 1px 0 #3a1e10;line-height:1;";
    document.body?.appendChild(el);
    return el;
  });

  const stopDizzy = () => {
    if (dizzy) clearTimeout(dizzy);
    if (orbit) clearInterval(orbit);
    dizzy = null;
    orbit = null;
    for (const star of stars) star.style.setProperty("display", "none");
    restart();
  };

  const startDizzy = () => {
    const already = dizzy !== null;
    if (dizzy) clearTimeout(dizzy);
    dizzy = setTimeout(stopDizzy, DIZZY_MS);
    // Restarting on every move would skip frames.
    if (already) return;
    if (!orbit) {
      const start = Date.now();
      orbit = setInterval(() => {
        const r = pet.getBoundingClientRect();
        const px = Math.round(14 * grow());
        const cx = r.left + r.width * ((head.left + head.right) / 2);
        const cy = r.top + r.height * head.top;
        const rx = r.width * 0.3;
        stars.forEach((star, i) => {
          const a = (Date.now() - start) / 260 + (i * 2 * Math.PI) / stars.length;
          // Stars passing behind the head shrink and fade, so the ring reads as a circle.
          const depth = (Math.sin(a) + 1) / 2;
          star.style.setProperty("font-size", `${px}px`);
          star.style.setProperty("left", `${cx + Math.cos(a) * rx - px / 2}px`);
          star.style.setProperty("top", `${cy + Math.sin(a) * rx * 0.3 - px / 2}px`);
          star.style.setProperty("opacity", String(0.45 + depth * 0.55));
          star.style.setProperty("transform", `scale(${0.7 + depth * 0.3})`);
          star.style.setProperty("display", "block");
        });
      }, 40);
    }
    restart();
  };

  pet.addEventListener("pointerenter", () => {
    hovering = true;
    restart();
  });
  pet.addEventListener("pointerleave", () => {
    hovering = false;
    if (!pat) hideHand();
    restart();
  });
  pet.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (onHead(e)) {
      pat = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY, travel: 0 };
      pet.setPointerCapture?.(e.pointerId);
      patHand(e.clientX, e.clientY);
      heart(e.clientX, e.clientY);
      say();
      if (patBeat) clearInterval(patBeat);
      patBeat = setInterval(() => {
        heart(handAt.x, handAt.y);
        say();
      }, 400);
      if (patting) clearTimeout(patting);
      patting = null;
      if (dizzy) stopDizzy();
      restart();
      return;
    }
    drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      dir: "running-right",
      shake: 0,
      at: Date.now(),
      grab: (() => {
        const r = pet.getBoundingClientRect();
        return { right: r.left + r.width - e.clientX, bottom: r.top + r.height - e.clientY };
      })(),
    };
    pet.setPointerCapture?.(e.pointerId);
    pet.style.setProperty("cursor", "grabbing");
  });
  pet.addEventListener("pointermove", (e) => {
    if (pat && e.pointerId === pat.id) {
      moveHand(e.clientX, e.clientY);
      pat.travel += Math.hypot(e.clientX - pat.lastX, e.clientY - pat.lastY);
      pat.lastX = e.clientX;
      pat.lastY = e.clientY;
      if (pat.travel >= 30) {
        pat.travel = 0;
        heart(e.clientX, e.clientY);
        say();
      }
      return;
    }
    if (!drag) {
      if (onHead(e)) stillHand(e.clientX, e.clientY);
      else hideHand();
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const dx = e.clientX - drag.lastX;
    if (Math.abs(dx) >= 2) drag.dir = dx > 0 ? "running-right" : "running-left";
    const now = Date.now();
    drag.shake = Math.max(0, drag.shake - ((now - drag.at) / 1000) * DIZZY_DRAIN) + Math.hypot(dx, e.clientY - drag.lastY);
    drag.at = now;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (drag.shake >= DIZZY_AT) startDizzy();
    offset = { right: window.innerWidth - e.clientX - drag.grab.right, bottom: window.innerHeight - e.clientY - drag.grab.bottom };
    place();
    if (current !== animationName()) restart();
  });
  const endPat = (e: PointerEventLike) => {
    pet.releasePointerCapture?.(e.pointerId);
    pat = null;
    if (patBeat) clearInterval(patBeat);
    patBeat = null;
    if (onHead(e)) stillHand(e.clientX, e.clientY);
    else hideHand();
    // Keep the pat going a moment after release so a quick tap still shows.
    if (patting) clearTimeout(patting);
    patting = setTimeout(() => {
      patting = null;
      pats = 0;
      bubble.style.setProperty("display", "none");
      restart();
    }, 1100);
    restart();
  };
  pet.addEventListener("pointercancel", (e) => {
    if (pat && e.pointerId === pat.id) endPat(e);
  });
  pet.addEventListener("pointerup", (e) => {
    if (pat && e.pointerId === pat.id) return endPat(e);
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    pet.releasePointerCapture?.(e.pointerId);
    drag = null;
    pet.style.setProperty("cursor", "grab");
    if (moved) saveOffset(offset);
    else onOpen();
    restart();
  });

  const onVisibility = () => restart();
  const onResize = () => place();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);

  return {
    update(next) {
      const spriteChanged = next.sprite?.key !== state?.sprite?.key || next.scale !== state?.scale;
      state = next;
      const s = next.sprite;
      if (!s || !next.visible) {
        pet.style.setProperty("display", "none");
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (spriteChanged) {
        const { w, h } = size();
        pet.style.setProperty("width", `${w}px`);
        pet.style.setProperty("height", `${h}px`);
        pet.style.setProperty("background-image", `url("${s.dataUrl}")`);
        pet.style.setProperty("background-size", `${s.sheet.width * next.scale}px ${s.sheet.height * next.scale}px`);
        // Upscaling pixel art smoothly blurs it; downscaling with "pixelated" makes it jagged.
        pet.style.setProperty("image-rendering", next.scale >= 1 ? "pixelated" : "auto");
        current = "";
        if (next.sprite?.key !== spriteKey) {
          spriteKey = s.key;
          head = DEFAULT_HEAD;
          void findHead(s).then((box) => {
            if (spriteKey === s.key) head = box;
          });
        }
      }
      pet.style.setProperty("display", "block");
      pet.title = next.label;
      pet.setAttribute("aria-label", `${s.displayName}: ${next.label}`);
      badge.textContent = String(next.badge);
      badge.style.setProperty("display", next.badge > 0 ? "block" : "none");
      place();
      restart();
    },
    destroy() {
      if (timer) clearTimeout(timer);
      if (patting) clearTimeout(patting);
      if (handTimer) clearInterval(handTimer);
      if (patBeat) clearInterval(patBeat);
      if (dizzy) clearTimeout(dizzy);
      if (orbit) clearInterval(orbit);
      for (const star of stars) star.remove();
      hand.remove();
      bubble.remove();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      pet.remove();
    },
  };
}
