/// <reference types="node" />
import { lstat, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { z } from "zod";
import type { RpcInput } from "@getpaseo/plugin";
import type { Animation, PetSprite, PetSummary, getPet } from "../shared/pets";

type Source = PetSummary["source"];

// Resolved at call time, never baked in at build time.
function roots(): { source: Source; dir: string }[] {
  const home = homedir();
  return [
    { source: "codex", dir: join(home, ".codex", "pets") },
    { source: "orca", dir: join(home, "Library", "Application Support", "orca", "sidekicks", "custom") },
  ];
}

const MAX_SHEET_BYTES = 64 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const manifestSchema = z
  .object({
    id: z.string().max(64).optional(),
    displayName: z.string().max(80).optional(),
    description: z.string().max(2000).optional(),
    spritesheetPath: z.string().min(1).max(255).optional(),
    frame: z.object({ width: z.number().int().positive().max(1024), height: z.number().int().positive().max(1024) }).optional(),
    fps: z.number().positive().max(60).optional(),
    defaultAnimation: z.string().min(1).max(64).optional(),
    animations: z
      .record(
        z.string().min(1).max(64),
        z.object({
          row: z.number().int().min(0).max(256),
          frames: z.number().int().positive().max(512),
          frameDurationsMs: z.array(z.number().positive().max(60_000)).max(512).optional(),
        }),
      )
      .optional(),
  })
  .loose();
type Manifest = z.infer<typeof manifestSchema>;

// Codex's sheet layout: 192×208 frames, one animation per row.
const DEFAULT_FRAME = { width: 192, height: 208 };
const hold = (frames: number, each: number, last: number) =>
  Array.from({ length: frames }, (_, i) => (i === frames - 1 ? last : each));
const DEFAULT_ANIMATIONS: Record<string, Animation> = {
  idle: { row: 0, frames: 6, frameDurationsMs: [1680, 660, 660, 840, 840, 1920] },
  "running-right": { row: 1, frames: 8, frameDurationsMs: hold(8, 120, 220) },
  "running-left": { row: 2, frames: 8, frameDurationsMs: hold(8, 120, 220) },
  waving: { row: 3, frames: 4, frameDurationsMs: hold(4, 140, 280) },
  jumping: { row: 4, frames: 5, frameDurationsMs: hold(5, 140, 280) },
  failed: { row: 5, frames: 8, frameDurationsMs: hold(8, 140, 240) },
  waiting: { row: 6, frames: 6, frameDurationsMs: hold(6, 150, 260) },
  running: { row: 7, frames: 6, frameDurationsMs: hold(6, 120, 220) },
  review: { row: 8, frames: 6, frameDurationsMs: hold(6, 150, 280) },
};

function animationsFor(manifest: Manifest): Record<string, Animation> {
  if (!manifest.animations) {
    if (manifest.fps === undefined) return DEFAULT_ANIMATIONS;
    const each = 1000 / manifest.fps;
    return Object.fromEntries(
      Object.entries(DEFAULT_ANIMATIONS).map(([name, a]) => [name, { ...a, frameDurationsMs: hold(a.frames, each, each) }]),
    );
  }
  const each = 1000 / (manifest.fps ?? 8);
  return Object.fromEntries(
    Object.entries(manifest.animations).map(([name, a]) => [
      name,
      { row: a.row, frames: a.frames, frameDurationsMs: a.frameDurationsMs ?? hold(a.frames, each, each) },
    ]),
  );
}

async function readManifest(dir: string): Promise<Manifest | null> {
  try {
    return manifestSchema.parse(JSON.parse(await readFile(join(dir, "pet.json"), "utf8")));
  } catch {
    return null;
  }
}

// Same rules as Orca: relative, inside the bundle, a real image file, not a symlink.
async function sheetPath(dir: string, manifest: Manifest): Promise<string> {
  const rel = manifest.spritesheetPath ?? "spritesheet.webp";
  if (isAbsolute(rel) || rel.includes("..") || rel.includes("\0")) throw new Error("spritesheetPath must stay inside the pet folder");
  const root = resolve(dir);
  const file = resolve(root, rel);
  if (!file.startsWith(root + sep)) throw new Error("spritesheetPath escapes the pet folder");
  if (!MIME[extname(file).toLowerCase()]) throw new Error("Spritesheet must be WebP, PNG, GIF or JPG");
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error("Spritesheet must not be a symlink");
  if (info.size > MAX_SHEET_BYTES) throw new Error("Spritesheet is larger than 64 MB");
  return file;
}

function parseKey(key: string): { source: Source; folder: string } | null {
  const [source, folder] = key.split(":", 2);
  if ((source !== "codex" && source !== "orca") || !folder || folder.includes("/") || folder.includes("\\") || folder.startsWith(".")) {
    return null;
  }
  return { source, folder };
}

export async function listPetFolders(): Promise<{ pets: PetSummary[] }> {
  const pets: PetSummary[] = [];
  const seen = new Set<string>();
  for (const { source, dir } of roots()) {
    let folders: string[];
    try {
      folders = await readdir(dir);
    } catch {
      continue;
    }
    for (const folder of folders.sort()) {
      if (folder.startsWith(".")) continue;
      const manifest = await readManifest(join(dir, folder));
      if (!manifest) continue;
      // Orca keeps its own copy of pets you also have in Codex; show each once.
      const identity = manifest.id ?? `${source}:${folder}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      pets.push({
        key: `${source}:${folder}`,
        displayName: manifest.displayName ?? manifest.id ?? folder,
        description: manifest.description,
        source,
      });
    }
  }
  return { pets };
}

export async function readPet({ key }: RpcInput<typeof getPet>): Promise<PetSprite> {
  const parsed = parseKey(key);
  const root = parsed && roots().find((r) => r.source === parsed.source);
  if (!parsed || !root) throw new Error(`Unknown pet: ${key}`);
  const dir = join(root.dir, parsed.folder);
  const manifest = await readManifest(dir);
  if (!manifest) throw new Error(`No valid pet.json in ${dir}`);
  const file = await sheetPath(dir, manifest);
  const bytes = await readFile(file);
  return {
    key,
    displayName: manifest.displayName ?? manifest.id ?? parsed.folder,
    dataUrl: `data:${MIME[extname(file).toLowerCase()]};base64,${bytes.toString("base64")}`,
    frame: manifest.frame ?? DEFAULT_FRAME,
    defaultAnimation: manifest.defaultAnimation ?? "idle",
    animations: animationsFor(manifest),
  };
}
