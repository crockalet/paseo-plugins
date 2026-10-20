import type { PluginClientContext } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { useSyncExternalStore } from "react";
import { MOOD_LABEL } from "../shared/mood";
import { getPet, listPets, petSettings, type PetSettings } from "../shared/pets";
import { PetController, type PetSnapshot } from "./controller";
import { mountOverlay, type Overlay } from "./web";

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
    void this.loadSettings();
  }

  get current(): PetSettings {
    return this.settings;
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
      const result = await this.client.rpc(settingsRpc(petSettings.id).read, {});
      if (result.status === "ready") return this.apply(petSettings.schema.parse(result.values));
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
