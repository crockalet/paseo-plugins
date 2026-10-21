import { type PluginAgentPanelProps, useAgent } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";

const PARENT_LABEL = "paseo.parent-agent-id";

export function parentOf(agent: {
  parentAgentId?: string | null;
  labels?: Readonly<Record<string, string>> | null;
}): string | null {
  const id = agent.parentAgentId ?? agent.labels?.[PARENT_LABEL];
  return id && id.trim() ? id.trim() : null;
}

export function ParentPanel({ agentId, theme, layout, navigation }: PluginAgentPanelProps) {
  const parentId = useAgent(agentId, (agent) => parentOf(agent));
  const parent = useAgent(parentId ?? "", (agent) => ({ title: agent.title, status: agent.status }));
  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        padding: layout.compact ? 16 : 24,
        gap: 12,
        backgroundColor: theme.colors.surface0,
      },
      label: { color: theme.colors.foregroundMuted, fontSize: 13 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20 },
      button: {
        alignSelf: "flex-start" as const,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      buttonText: { color: theme.colors.accentForeground },
    }),
    [theme, layout.compact],
  );

  if (!parentId) {
    return (
      <View style={styles.screen}>
        <Text style={styles.label}>This agent was not started by another agent.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.label}>This is a worker. It was started by:</Text>
      <Text style={styles.title}>{parent?.title ?? parentId}</Text>
      <Text style={styles.label}>
        {parent ? `Status: ${parent.status}` : "The parent is archived or on another host."}
      </Text>
      <Text style={styles.label}>
        Ask the parent about overall progress. This worker only knows its own lane.
      </Text>
      {navigation && parent ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the parent agent"
          onPress={() => navigation.openAgent({ agentId: parentId })}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Open parent agent</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
