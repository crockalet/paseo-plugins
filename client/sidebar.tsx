import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { summary, usePet } from "./app";
import { PetSprite } from "./sprite";
import { usePetSync } from "./sync";

export function PetSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  usePetSync();
  const snap = usePet();
  const icon = useMemo(() => {
    const sprite = snap.sprite;
    if (!sprite) return "PawPrint";
    return function PetIcon({ size }: { size: number; color: string }) {
      return <PetSprite sprite={sprite} animation={snap.mood} height={size + 6} />;
    };
  }, [snap.sprite, snap.mood]);

  return (
    <SidebarRow
      icon={icon}
      label={summary(snap)}
      active={currentScreen?.screenId === "pets"}
      onPress={() => openScreen({ screenId: "pets" })}
    />
  );
}
