// input: Novel workspace relative file paths
// output: Stable writing UI category labels for each path
// pos: Shared classifier between writing scaffolds and workspace navigation

import {
  getBuiltInMethodPack,
  type MethodPackArtifactLifecycle,
} from "./method-packs/index.ts";

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

function normalizePathString(path: string): string {
  return normalizePath(path).join("/");
}

function isContractPathMatch(relativePath: string, contractPath: string): boolean {
  const path = normalizePathString(relativePath);
  const contract = normalizePathString(contractPath);
  if (!path || !contract) return false;

  const isDirectoryContract = contractPath.replace(/\\/g, "/").trim().endsWith("/");
  return isDirectoryContract
    ? path === contract || path.startsWith(`${contract}/`)
    : path === contract;
}

function categoryFromArtifactLifecycle(
  relativePath: string,
  lifecycle: MethodPackArtifactLifecycle
): WritingFileCategory {
  if (lifecycle === "final") return "manuscript";
  if (lifecycle === "outline" || lifecycle === "intake") return "outline";
  if (lifecycle === "draft") return "work";
  if (lifecycle === "review") return "analysis";
  if (lifecycle === "state") return "state";

  const [first] = normalizePath(relativePath);
  if (lifecycle === "reference") {
    if (first === "角色") return "characters";
    if (first === "场景") return "locations";
    return "analysis";
  }

  if (lifecycle === "canon") return "state";
  return "other";
}

export function categorizeNovelPath(relativePath: string): WritingFileCategory {
  const segments = normalizePath(relativePath);
  const [first, second, third] = segments;

  if (first === "创作要求.md") return "style";
  if (first === "简报.md") return "outline";
  if (first === "大纲.md") return "outline";
  if (first === "人物.md") return "characters";
  if (first === ".work") return "work";
  if (first === "自由区") return "work";
  if (first === "work") return "work";
  if (first === "analysis") return "analysis";
  if (first === "notes" || first === "reference" || first === "reviews") return "analysis";
  if (first === "style") return "style";
  if (first === "drafts" || first === "published") return "manuscript";
  if (first === "revisions") return "work";
  if (first === "episodes") return "manuscript";
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

  if (first === "全局" || first === "设定") {
    if (second === "创作要求.md") return "style";
    if (second === "简报.md" || second === "大纲.md" || second === "题材定位.md") return "outline";
    if (second === "人物.md") return "characters";
    if (second === "角色") return "characters";
    if (second === "世界观" || second === "势力") return "locations";
    if (third || second?.endsWith(".md")) return "outline";
  }

  return "other";
}

export function categorizeNovelPathForMethodPack(
  relativePath: string,
  methodPackId?: string
): WritingFileCategory {
  const category = categorizeNovelPath(relativePath);
  if (category !== "other" || !methodPackId) return category;

  const methodPack = getBuiltInMethodPack(methodPackId);
  if (!methodPack) return category;

  const artifact = methodPack.artifactContract
    .filter((entry) => isContractPathMatch(relativePath, entry.path))
    .sort((left, right) => normalizePathString(right.path).length - normalizePathString(left.path).length)[0];

  return artifact ? categoryFromArtifactLifecycle(relativePath, artifact.lifecycle) : category;
}
