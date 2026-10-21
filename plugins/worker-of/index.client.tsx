import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { ParentPanel, parentOf } from "./client/parent-panel";

const MAX_LABEL = 28;

type AgentLike = {
  id: string;
  workspaceId?: string | null;
  title?: string | null;
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>> | null;
};

function shorten(text: string) {
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "parent",
    title: "Parent agent",
    icon: "CornerLeftUp",
    context: "agent",
    Component: ParentPanel,
  });

  const agents = new Map<string, AgentLike>();
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();

  const removePill = (agentId: string) => {
    pills.get(agentId)?.remove();
    pills.delete(agentId);
  };

  const sync = (agent: AgentLike) => {
    const parentId = parentOf(agent);
    const workspaceId = agent.workspaceId;
    if (lifetime.signal.aborted || !parentId || !workspaceId) return removePill(agent.id);
    const parentTitle = agents.get(parentId)?.title?.trim();
    const label = `↳ Worker of ${parentTitle ? shorten(parentTitle) : parentId.slice(0, 7)}`;
    const button = {
      title: `Started by ${parentTitle ?? parentId}. Open the parent agent.`,
      icon: "CornerLeftUp",
      label,
      behavior: {
        kind: "action" as const,
        onPress() {
          client.openPanel("parent", { workspaceId, agentId: agent.id });
        },
      },
    };
    const existing = pills.get(agent.id);
    if (existing) return existing.update(button);
    pills.set(agent.id, client.addComposerPill({ id: "worker-of", workspaceId, agentId: agent.id, button }));
  };

  // A parent's title can arrive or change after its workers, so relabel every worker.
  const syncAll = () => {
    for (const agent of agents.values()) sync(agent);
  };

  const removeAll = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };

  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          agents.clear();
          for (const { agent } of entries) agents.set(agent.id, agent);
          syncAll();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") {
            agents.set(update.agent.id, update.agent);
            return syncAll();
          }
          agents.delete(update.agentId);
          removePill(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("[worker-of] agent list failed", error);
    });

  return () => {
    lifetime.abort();
    removeAll();
  };
}
