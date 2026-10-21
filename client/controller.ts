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
type RawAgent = {
  id: string;
  workspaceId?: string | null;
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>> | null;
};
type Tracked = { label: string; release: () => void };

const PARENT_LABEL = "paseo.parent-agent-id";

function isWorker(agent: RawAgent): boolean {
  return Boolean(agent.parentAgentId?.trim() || agent.labels?.[PARENT_LABEL]?.trim());
}

const RETRY_MS = 15_000;

/** One pet for every connected host, fed by a workspace subscription per host. */
export class PetController {
  private hosts = new Map<string, Tracked>();
  private wanted: HostInfo[] = [];
  private workspaces = new Map<string, WorkspaceEntry>();
  /** `${serverId}\0${agentId}` → the agent's workspace key and whether another agent started it. */
  private agents = new Map<string, { workspace: string; worker: boolean }>();
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
      const result = await api.workspaces.list({ subscribe: {}, page: { limit: 200 } });
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
      const releaseAgents = await this.watchAgents(api, host.serverId, tracked);
      tracked.release = () => {
        unsubscribe();
        releaseAgents();
        void result.subscription.release().catch(() => {});
      };
    } catch (error) {
      console.warn(`[codex-pets] could not watch ${host.label}`, error);
      this.stop(host.serverId);
    }
  }

  private async watchAgents(api: Api, serverId: string, tracked: Tracked): Promise<() => void> {
    const result = await api.agents.list({ subscribe: {} });
    if (this.hosts.get(serverId) !== tracked) {
      void result.subscription.release().catch(() => {});
      return () => {};
    }
    const replace = (entries: readonly { agent: RawAgent }[]) => {
      this.dropKeys(this.agents, serverId);
      for (const { agent } of entries) this.putAgent(serverId, agent);
      this.publish();
    };
    replace(result.entries as { agent: RawAgent }[]);
    const unsubscribe = result.subscription.subscribe({
      snapshot: (snap) => replace(snap.entries as { agent: RawAgent }[]),
      update: (message) => {
        if (message.type !== "agent_update") return;
        const payload = message.payload as { kind: string; agent?: RawAgent; agentId?: string };
        if (payload.kind === "upsert" && payload.agent) this.putAgent(serverId, payload.agent);
        else if (payload.agentId) this.agents.delete(`${serverId}\0${payload.agentId}`);
        this.publish();
      },
      error: () => this.stop(serverId),
    });
    return () => {
      unsubscribe();
      void result.subscription.release().catch(() => {});
    };
  }

  private putAgent(serverId: string, agent: RawAgent): void {
    const key = `${serverId}\0${agent.id}`;
    if (!agent.workspaceId) return void this.agents.delete(key);
    this.agents.set(key, { workspace: `${serverId}\0${agent.workspaceId}`, worker: isWorker(agent) });
  }

  private dropKeys(map: Map<string, unknown>, serverId: string): void {
    for (const key of [...map.keys()]) if (key.startsWith(`${serverId}\0`)) map.delete(key);
  }

  /** Workspaces where every agent was started by another agent; their parent handles them. */
  private workerWorkspaces(): Set<string> {
    const owned = new Map<string, boolean>();
    for (const { workspace, worker } of this.agents.values()) {
      owned.set(workspace, (owned.get(workspace) ?? true) && worker);
    }
    return new Set([...owned].filter(([, allWorkers]) => allWorkers).map(([workspace]) => workspace));
  }

  private stop(serverId: string): void {
    const tracked = this.hosts.get(serverId);
    if (!tracked) return;
    this.hosts.delete(serverId);
    tracked.release();
    this.dropKeys(this.workspaces, serverId);
    this.dropKeys(this.agents, serverId);
    this.publish();
  }

  private replaceHost(serverId: string, entries: RawWorkspace[]): void {
    this.dropKeys(this.workspaces, serverId);
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
    const workers = this.workerWorkspaces();
    const delegated = (w: WorkspaceEntry) => workers.has(`${w.serverId}\0${w.id}`);
    const attention = all
      .filter((w) => !delegated(w) && needsYou(moodOf(w.status)))
      .sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
    this.snapshot = {
      mood: overallMood(all.map((w) => (delegated(w) && w.status !== "running" ? "done" : w.status))),
      attention,
      running: all.filter((w) => moodOf(w.status) === "running").length,
      sprite: this.sprite,
    };
    for (const listener of this.listeners) listener();
  }
}
