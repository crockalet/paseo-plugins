import { getPaseoClient } from "@getpaseo/plugin/client";
import { Image } from "react-native";
import { type Mood, moodOf, needsYou, overallMood } from "../shared/mood";
import type { PetSprite } from "../shared/pets";

export interface HostInfo {
  serverId: string;
  label: string;
  status: string;
}

export interface WorkspaceEntry {
  serverId: string;
  hostLabel: string;
  id: string;
  name: string;
  project: string;
  status: string;
  since: string | null;
}

export interface LoadedSprite extends PetSprite {
  sheet: { width: number; height: number };
}

export interface PetSnapshot {
  mood: Mood;
  attention: WorkspaceEntry[];
  running: number;
  sprite: LoadedSprite | null;
}

type Api = ReturnType<typeof getPaseoClient>;
type RawWorkspace = {
  id: string;
  name: string;
  title?: string | null;
  projectDisplayName?: string;
  status: string;
  statusEnteredAt?: string | null;
  archivingAt?: string | null;
};
type Tracked = { label: string; release: () => void };

const RETRY_MS = 15_000;

/** One pet for every connected host, fed by a workspace subscription per host. */
export class PetController {
  private hosts = new Map<string, Tracked>();
  private wanted: HostInfo[] = [];
  private workspaces = new Map<string, WorkspaceEntry>();
  private sprite: LoadedSprite | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PetSnapshot = { mood: "idle", attention: [], running: 0, sprite: null };
  private retry: ReturnType<typeof setInterval> | null = setInterval(() => this.sync(), RETRY_MS);
  private disposed = false;

  getSnapshot = (): PetSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setHosts(hosts: readonly HostInfo[]): void {
    this.wanted = hosts.map((h) => ({ serverId: h.serverId, label: h.label, status: h.status }));
    this.sync();
  }

  knownHosts(): HostInfo[] {
    return this.wanted;
  }

  async setSprite(sprite: PetSprite | null): Promise<void> {
    if (!sprite) {
      this.sprite = null;
      return this.publish();
    }
    const sheet = await new Promise<{ width: number; height: number }>((done, fail) =>
      Image.getSize(sprite.dataUrl, (width, height) => done({ width, height }), fail),
    );
    if (this.disposed) return;
    this.sprite = { ...sprite, sheet };
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
    if (this.retry) clearInterval(this.retry);
    this.retry = null;
    for (const serverId of [...this.hosts.keys()]) this.stop(serverId);
    this.listeners.clear();
  }

  private sync(): void {
    if (this.disposed) return;
    const online = new Map(this.wanted.filter((h) => h.status === "online").map((h) => [h.serverId, h]));
    for (const serverId of [...this.hosts.keys()]) if (!online.has(serverId)) this.stop(serverId);
    for (const host of online.values()) if (!this.hosts.has(host.serverId)) void this.start(host);
  }

  private async start(host: HostInfo): Promise<void> {
    const tracked: Tracked = { label: host.label, release: () => {} };
    this.hosts.set(host.serverId, tracked);
    let api: Api;
    try {
      api = getPaseoClient(host.serverId);
      const result = await api.workspaces.list({ subscribe: {}, page: { limit: 500 } });
      if (this.hosts.get(host.serverId) !== tracked) return void result.subscription.release();
      this.replaceHost(host.serverId, result.entries as RawWorkspace[]);
      const unsubscribe = result.subscription.subscribe({
        snapshot: (snap) => this.replaceHost(host.serverId, snap.entries as RawWorkspace[]),
        update: (message) => {
          if (message.type !== "workspace_update") return;
          const payload = message.payload as { kind: string; workspace?: RawWorkspace; id?: string };
          if (payload.kind === "upsert" && payload.workspace) this.upsert(host.serverId, payload.workspace);
          else if (payload.kind === "remove" && payload.id) this.remove(host.serverId, payload.id);
        },
        // A connection switch releases the borrowed API; drop the host and let the retry timer resubscribe.
        error: () => this.stop(host.serverId),
      });
      tracked.release = () => {
        unsubscribe();
        void result.subscription.release().catch(() => {});
      };
    } catch (error) {
      console.warn(`[codex-pets] could not watch ${host.label}`, error);
      this.stop(host.serverId);
    }
  }

  private stop(serverId: string): void {
    const tracked = this.hosts.get(serverId);
    if (!tracked) return;
    this.hosts.delete(serverId);
    tracked.release();
    for (const key of [...this.workspaces.keys()]) if (key.startsWith(`${serverId}\0`)) this.workspaces.delete(key);
    this.publish();
  }

  private replaceHost(serverId: string, entries: RawWorkspace[]): void {
    for (const key of [...this.workspaces.keys()]) if (key.startsWith(`${serverId}\0`)) this.workspaces.delete(key);
    for (const ws of entries) this.put(serverId, ws);
    this.publish();
  }

  private upsert(serverId: string, ws: RawWorkspace): void {
    this.put(serverId, ws);
    this.publish();
  }

  private remove(serverId: string, id: string): void {
    this.workspaces.delete(`${serverId}\0${id}`);
    this.publish();
  }

  private put(serverId: string, ws: RawWorkspace): void {
    const key = `${serverId}\0${ws.id}`;
    if (ws.archivingAt) return void this.workspaces.delete(key);
    this.workspaces.set(key, {
      serverId,
      hostLabel: this.hosts.get(serverId)?.label ?? serverId,
      id: ws.id,
      name: ws.title || ws.name,
      project: ws.projectDisplayName ?? "",
      status: ws.status,
      since: ws.statusEnteredAt ?? null,
    });
  }

  private publish(): void {
    const all = [...this.workspaces.values()];
    const attention = all
      .filter((w) => needsYou(moodOf(w.status)))
      .sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
    this.snapshot = {
      mood: overallMood(all.map((w) => w.status)),
      attention,
      running: all.filter((w) => moodOf(w.status) === "running").length,
      sprite: this.sprite,
    };
    for (const listener of this.listeners) listener();
  }
}
