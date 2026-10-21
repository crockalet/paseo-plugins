export type Mood = "idle" | "running" | "waiting" | "failed" | "review";

// Workspace status → pet animation. "attention" is a finished turn nobody has looked at yet.
const MOOD_BY_STATUS: Record<string, Mood> = {
  needs_input: "waiting",
  failed: "failed",
  running: "running",
  attention: "review",
  done: "idle",
};

// The most urgent workspace decides the pet's mood.
const PRIORITY: Mood[] = ["waiting", "failed", "running", "review", "idle"];

export function moodOf(status: string): Mood {
  return MOOD_BY_STATUS[status] ?? "idle";
}

export function overallMood(statuses: Iterable<string>): Mood {
  let best = PRIORITY.length - 1;
  for (const status of statuses) best = Math.min(best, PRIORITY.indexOf(moodOf(status)));
  return PRIORITY[best];
}

export function needsYou(mood: Mood): boolean {
  return mood === "waiting" || mood === "failed" || mood === "review";
}

export const MOOD_LABEL: Record<Mood, string> = {
  waiting: "Needs your input",
  failed: "Failed",
  running: "Working",
  review: "Ready to review",
  idle: "All quiet",
};
