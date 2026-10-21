import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const animationSchema = z.object({
  row: z.number().int().min(0),
  frames: z.number().int().positive(),
  frameDurationsMs: z.array(z.number().positive()),
});
export type Animation = z.infer<typeof animationSchema>;

export const petSummarySchema = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  source: z.enum(["codex", "orca"]),
});
export type PetSummary = z.infer<typeof petSummarySchema>;

export const petSpriteSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  dataUrl: z.string(),
  frame: z.object({ width: z.number().positive(), height: z.number().positive() }),
  defaultAnimation: z.string(),
  animations: z.record(z.string(), animationSchema),
});
export type PetSprite = z.infer<typeof petSpriteSchema>;

export const listPets = defineRpc({
  name: "pets.list",
  input: z.object({}),
  output: z.object({ pets: z.array(petSummarySchema) }),
});

export const getPet = defineRpc({
  name: "pets.get",
  input: z.object({ key: z.string().min(1) }),
  output: petSpriteSchema,
});

export const petSettings = defineSettings({
  id: "pet",
  scope: "host",
  version: 1,
  schema: z.object({
    petKey: z.string().default(""),
    overlay: z.boolean().default(true),
    scale: z.number().min(0.2).max(1).default(0.45),
  }),
});
export type PetSettings = z.output<typeof petSettings.schema>;

// The overlay starts before any surface mounts, so it reads saved settings through the plugin's own RPC.
export const readSettings = defineRpc({
  name: "pets.settings",
  input: z.object({}),
  output: petSettings.schema,
});
