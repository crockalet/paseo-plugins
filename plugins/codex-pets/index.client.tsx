import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startApp, stopApp } from "./client/app";
import { PetsScreen } from "./client/screen";
import { PetSidebarItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  const app = startApp(client);
  client.addScreen({ id: "pets", title: "Pet", Component: PetsScreen });
  client.addSidebarFooterItem({ id: "pet", title: "Pet", Component: PetSidebarItem });
  client.addCommandCenterItem({
    id: "open-pet",
    title: "Pet: show what needs you",
    icon: "PawPrint",
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: "pets" }),
  });
  return () => stopApp(app);
}
