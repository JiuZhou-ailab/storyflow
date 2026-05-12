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
  const [first, second, third] = segments;

  if (first === ".work") return "work";
  if (first === "work") return "work";
  if (first === "analysis") return "analysis";
  if (first === "brief") return "outline";
  if (first === "notes" || first === "reference" || first === "reviews") return "analysis";
  if (first === "style") return "style";
  if (first === "drafts" || first === "published") return "manuscript";
  if (first === "revisions") return "work";
  if (first === "episodes") return "manuscript";
  if (first === "series") {
    if (second === "characters.md") return "characters";
    if (second === "world.md") return "locations";
    if (second === "episode-map.md" || second === "season-arc.md" || second === "premise.md") return "outline";
    return "outline";
  }
  if (first === "state") return "state";
  if (first === "timeline") return "timeline";
  if (first === "参考资料" || first === "拆文库" || first === "对标") return "analysis";
  if (first === "追踪") return "timeline";
  if (first === "正文") return "manuscript";
  if (first === "大纲") return "outline";
  if (first === "draft") {
    if (second === "chapters") return "manuscript";
    if (second === "reviews") return "analysis";
    return "work";
  }
  if (first === "outline") return "outline";
  if (first === "planning") {
    if (second === "world-forge.md") return "locations";
    if (second === "constellation-strand-map.md") return "characters";
    return "outline";
  }
  if (first === "kb") {
    if (second === "characters") return "characters";
    if (second === "world") return "locations";
    if (second === "timeline") return "timeline";
    if (second === "canon") return "state";
    if (second === "issues") return "analysis";
    if (second === "styles") return "style";
  }

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

  if (first === "设定") {
    if (second === "角色") return "characters";
    if (second === "世界观" || second === "势力") return "locations";
    if (third || second?.endsWith(".md")) return "outline";
  }

  return "other";
}
