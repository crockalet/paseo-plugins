import type { PluginClientContext } from "@getpaseo/plugin/client";
import { useSyncExternalStore } from "react";
import { MOOD_LABEL } from "../shared/mood";
import { getPet, listPets, petSettings, readSettings, type PetSettings } from "../shared/pets";
import { type HostInfo, PetController, type PetSnapshot } from "./controller";
import { loadHosts, mountOverlay, saveHosts, type Overlay } from "./web";

/** The plugin's single live instance: store, desktop overlay and the settings they follow. */
export class PetApp {
  readonly controller = new PetController();
  private overlay: Overlay | null;
  private settings: PetSettings = petSettings.schema.parse({});
  private loadedKey: string | null = null;
  private unsubscribe: () => void;

  constructor(private client: PluginClientContext) {
    this.overlay = mountOverlay(() => client.openScreen({ screenId: "pets" }));
    this.unsubscribe = this.controller.subscribe(() => this.render());
    // Hosts seen last session, so the pet works before (or without) the sidebar mounting.
    // Assumed online; ones that aren't fail and the controller's retry picks them up later.
    const saved = loadHosts();
    if (saved.length) this.controller.setHosts(saved.map((h) => ({ ...h, status: "online" })));
    void this.loadSettings();
  }

  get current(): PetSettings {
    return this.settings;
  }

  setHosts(hosts: readonly HostInfo[]): void {
    this.controller.setHosts(hosts);
    saveHosts(hosts.map((h) => ({ serverId: h.serverId, label: h.label })));
  }

  async apply(values: PetSettings): Promise<void> {
    this.settings = values;
    let key = values.petKey;
    if (!key) key = (await this.client.rpc(listPets, {})).pets[0]?.key ?? "";
    if (key && key !== this.loadedKey) {
      this.loadedKey = key;
      try {
        await this.controller.setSprite(await this.client.rpc(getPet, { key }));
      } catch (error) {
        this.loadedKey = null;
        console.warn(`[codex-pets] could not load pet ${key}`, error);
      }
    }
    this.render();
  }

  dispose(): void {
    this.unsubscribe();
    this.overlay?.destroy();
    this.controller.dispose();
  }

  private async loadSettings(): Promise<void> {
    try {
      return await this.apply(await this.client.rpc(readSettings, {}));
    } catch (error) {
      console.warn("[codex-pets] could not read settings", error);
    }
    await this.apply(this.settings);
  }

  private render(): void {
    const snap = this.controller.getSnapshot();
    this.overlay?.update({
      sprite: snap.sprite,
      mood: snap.mood,
      scale: this.settings.scale,
      visible: this.settings.overlay,
      badge: snap.attention.filter((w) => w.status === "needs_input").length,
      label: summary(snap),
    });
  }
}

export function summary(snap: PetSnapshot): string {
  const parts: string[] = [];
  if (snap.attention.length) parts.push(`${snap.attention.length} need${snap.attention.length === 1 ? "s" : ""} you`);
  if (snap.running) parts.push(`${snap.running} working`);
  return parts.length ? parts.join(" · ") : MOOD_LABEL[snap.mood];
}

let instance: PetApp | null = null;

export function startApp(client: PluginClientContext): PetApp {
  instance?.dispose();
  instance = new PetApp(client);
  return instance;
}

export function stopApp(app: PetApp): void {
  app.dispose();
  if (instance === app) instance = null;
}

export function getApp(): PetApp | null {
  return instance;
}

const EMPTY: PetSnapshot = { mood: "idle", attention: [], running: 0, sprite: null };
const noop = () => () => {};

export function usePet(): PetSnapshot {
  const app = instance;
  return useSyncExternalStore(app ? app.controller.subscribe : noop, app ? app.controller.getSnapshot : () => EMPTY);
}
