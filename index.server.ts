import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listPetFolders, readPet } from "./server/pets";
import { getPet, listPets, petSettings } from "./shared/pets";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(petSettings);
  server.handle(listPets, listPetFolders);
  server.handle(getPet, readPet);
  return () => {};
}
