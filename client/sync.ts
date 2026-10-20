import { useHosts, useSettings } from "@getpaseo/plugin/client";
import { useEffect } from "react";
import { petSettings } from "../shared/pets";
import { getApp } from "./app";

/** Feeds the live host list and saved settings to the store from whichever surface is mounted. */
export function usePetSync(): ReturnType<typeof useSettings<typeof petSettings.schema>> {
  const hosts = useHosts();
  const settings = useSettings(petSettings);

  useEffect(() => {
    getApp()?.controller.setHosts(hosts);
  }, [hosts]);

  const values = settings.status === "ready" ? settings.values : null;
  useEffect(() => {
    const app = getApp();
    if (app && values && JSON.stringify(values) !== JSON.stringify(app.current)) void app.apply(values);
  }, [values]);

  return settings;
}
