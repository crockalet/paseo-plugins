import { Platform } from "react-native";
import type { LoadedSprite } from "./controller";

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
}
interface DomDocument {
  body: DomNode | null;
  hidden: boolean;
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
  document.body.appendChild(pet);

  let state: OverlayState | null = null;
  let offset = loadOffset();
  let hovering = false;
  let drag: { id: number; startX: number; startY: number; lastX: number; moved: boolean; dir: string } | null = null;
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
    const wanted = drag?.moved ? drag.dir : hovering ? "jumping" : state!.mood;
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

  pet.addEventListener("pointerenter", () => {
    hovering = true;
    restart();
  });
  pet.addEventListener("pointerleave", () => {
    hovering = false;
    restart();
  });
  pet.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, moved: false, dir: "running-right" };
    pet.setPointerCapture?.(e.pointerId);
    pet.style.setProperty("cursor", "grabbing");
  });
  pet.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4) return;
    drag.moved = true;
    const dx = e.clientX - drag.lastX;
    if (Math.abs(dx) >= 2) drag.dir = dx > 0 ? "running-right" : "running-left";
    drag.lastX = e.clientX;
    const { w, h } = size();
    offset = { right: window.innerWidth - e.clientX - w / 2, bottom: window.innerHeight - e.clientY - h / 2 };
    place();
    if (current !== animationName()) restart();
  });
  pet.addEventListener("pointerup", (e) => {
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
        current = "";
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
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      pet.remove();
    },
  };
}
