import { type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { MOOD_LABEL, moodOf } from "../shared/mood";
import { listPets, type PetSettings } from "../shared/pets";
import { getApp, summary, usePet } from "./app";
import { PetSprite } from "./sprite";
import { usePetSync } from "./sync";

const SIZES = [
  { label: "Small", value: "0.3" },
  { label: "Medium", value: "0.45" },
  { label: "Large", value: "0.6" },
];

function ago(since: string | null): string {
  if (!since) return "";
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(since)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function PetsScreen({ theme, layout, navigation }: PluginScreenProps) {
  const settings = usePetSync();
  const snap = usePet();
  const fetchPets = useRpc(listPets);
  const pets = useQuery({ queryKey: ["codex-pets", "list"], queryFn: () => fetchPets({}) });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: layout.compact ? 16 : 24, gap: 20 },
      hero: { flexDirection: "row" as const, alignItems: "center" as const, gap: 16 },
      name: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 20, fontWeight: "600" as const },
      status: { color: theme.colors.foregroundMuted, fontSize: 14, marginTop: 4 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 14, padding: 12 },
    }),
    [theme, layout.compact],
  );

  const save = async (patch: Partial<PetSettings>) => {
    if (settings.status !== "ready") return;
    const next = { ...settings.values, ...patch };
    if (await settings.save(next, settings.revision)) await getApp()?.apply(next);
  };

  const values = settings.status === "ready" ? settings.values : null;
  const options = (pets.data?.pets ?? []).map((p) => ({ label: p.displayName, value: p.key }));
  const selected = values?.petKey || snap.sprite?.key || options[0]?.value || "";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        {snap.sprite ? <PetSprite sprite={snap.sprite} animation={snap.mood} height={layout.compact ? 88 : 112} /> : null}
        <View>
          <Text style={styles.name}>{snap.sprite?.displayName ?? "No pet yet"}</Text>
          <Text style={styles.status}>{summary(snap)}</Text>
        </View>
      </View>

      <SettingsSection title="Needs you">
        <SettingsCard>
          {snap.attention.length === 0 ? (
            <Text style={styles.empty}>Nothing is waiting on you.</Text>
          ) : (
            snap.attention.map((w) => (
              <SettingsAction
                key={`${w.serverId}:${w.id}`}
                label={w.name}
                hint={[MOOD_LABEL[moodOf(w.status)], w.project, w.hostLabel, ago(w.since)].filter(Boolean).join(" · ")}
                actionLabel="Open"
                disabled={!navigation}
                onPress={() => navigation?.openWorkspace({ workspaceId: w.id, serverId: w.serverId })}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Pet">
        <SettingsCard>
          {options.length === 0 ? (
            <SettingsRow
              label="No pets found"
              hint={pets.isLoading ? "Looking…" : "Add Codex pets to ~/.codex/pets, or hatch one in Codex or Orca."}
            />
          ) : (
            <SettingsSelect label="Pet" value={selected} options={options} onValueChange={(petKey) => void save({ petKey })} />
          )}
          {layout.platform === "web" ? (
            <SettingsSwitch
              label="Float over the window"
              hint="Drag it anywhere. Click it to come back here."
              value={values?.overlay ?? true}
              disabled={!values}
              onValueChange={(overlay) => void save({ overlay })}
            />
          ) : null}
          <SettingsSelect
            label="Size"
            value={String(values?.scale ?? 0.45)}
            options={SIZES}
            disabled={!values}
            onValueChange={(scale) => void save({ scale: Number(scale) })}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
