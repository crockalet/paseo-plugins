import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPetFolders, readPet } from "./server/pets";
import { getPet, listPets, petSettings, readSettings } from "./shared/pets";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(petSettings);
  server.handle(listPets, listPetFolders);
  server.handle(getPet, readPet);
  server.handle(readSettings, async () => {
    const current = await settings.read();
    return petSettings.schema.parse(current.status === "ready" ? current.values : {});
  });
  return () => {};
}
