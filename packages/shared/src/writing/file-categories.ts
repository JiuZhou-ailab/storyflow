export type WritingFileCategory =
  | "manuscript"
  | "outline"
  | "characters"
  | "locations"
  | "style"
  | "state"
  | "timeline"
  | "analysis"
  | "work"
  | "other";

function normalizePath(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function categorizeNovelPath(relativePath: string): WritingFileCategory {
  const segments = normalizePath(relativePath);
  const [first, second] = segments;

  if (first === ".work") return "work";
  if (first === "analysis") return "analysis";
  if (first === "state") return "state";
  if (first === "timeline") return "timeline";

  if (first === "story") {
    if (second === "chapters") return "manuscript";
    if (second === "plan.md" || second === "synopsis.md") return "outline";
    return "other";
  }

  if (first === "bible") {
    if (second === "characters") return "characters";
    if (second === "universe") return "locations";
    if (second === "style.md") return "style";
    if (second === "structure.md") return "outline";
  }

  return "other";
}
