// input: Claude-Book workspace files after manuscript generation
// output: Contract findings for outline, chapter order, continuity state, and prose shape
// pos: E2E validation layer for Method Pack runtime behavior

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

export type ClaudeBookDraftContractFindingCode =
  | "manuscript_without_outline"
  | "missing_planned_chapter"
  | "unplanned_chapter"
  | "non_contiguous_chapters"
  | "manuscript_without_state_update"
  | "choppy_paragraph_format";

export interface ClaudeBookDraftContractFinding {
  severity: "error" | "warning";
  code: ClaudeBookDraftContractFindingCode;
  path: string;
  message: string;
}

interface ManuscriptChapter {
  chapterNumber: number;
  relativePath: string;
  text: string;
}

const SYNOPSIS_PATH = "story/synopsis.md";
const PLAN_PATH = "story/plan.md";
const CHAPTERS_PATH = "story/chapters";
const STATE_PATHS = [
  "state/current/situation.md",
  "state/current/characters.md",
  "state/current/knowledge.md",
  "timeline/history.md",
  "timeline/current-chapter.md",
];

function readText(rootPath: string, relativePath: string): string {
  const filePath = join(rootPath, relativePath);
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function meaningfulMarkdownBody(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0
      && !line.startsWith("#")
      && !/^[-*_]{3,}$/.test(line)
    )
    .join("\n")
    .trim();
}

function hasMeaningfulContent(text: string): boolean {
  return meaningfulMarkdownBody(text).length > 0;
}

function listManuscriptChapters(rootPath: string): ManuscriptChapter[] {
  const chaptersRoot = join(rootPath, CHAPTERS_PATH);
  if (!existsSync(chaptersRoot)) return [];

  return readdirSync(chaptersRoot)
    .flatMap((entry): ManuscriptChapter[] => {
      const match = /^chapter-(\d+)\.md$/i.exec(entry);
      if (!match) return [];

      const relativePath = `${CHAPTERS_PATH}/${entry}`;
      const filePath = join(rootPath, relativePath);
      if (!statSync(filePath).isFile()) return [];

      const text = readText(rootPath, relativePath);
      if (!hasMeaningfulContent(text)) return [];

      return [{
        chapterNumber: Number.parseInt(match[1]!, 10),
        relativePath,
        text,
      }];
    })
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
}

function parsePlannedChapterNumbers(planText: string): number[] {
  const chapterNumbers = new Set<number>();
  const headingPattern = /^#{1,6}\s*(?:(?:第\s*)?(\d+)\s*章|Chapter\s+(\d+)\b)/gim;
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(planText)) !== null) {
    const chapterGroup = match[1] ?? match[2];
    if (!chapterGroup) continue;

    const chapterNumber = Number.parseInt(chapterGroup, 10);
    if (Number.isFinite(chapterNumber) && chapterNumber > 0) {
      chapterNumbers.add(chapterNumber);
    }
  }

  return [...chapterNumbers].sort((left, right) => left - right);
}

function hasContiguousChapters(chapters: ManuscriptChapter[]): boolean {
  if (chapters.length === 0) return true;
  const firstChapter = chapters[0]!;
  const lastChapter = chapters[chapters.length - 1]!;
  const minChapter = firstChapter.chapterNumber;
  const maxChapter = lastChapter.chapterNumber;
  const seen = new Set(chapters.map((chapter) => chapter.chapterNumber));

  for (let chapterNumber = minChapter; chapterNumber <= maxChapter; chapterNumber += 1) {
    if (!seen.has(chapterNumber)) return false;
  }

  return true;
}

function getChapterPath(chapterNumber: number): string {
  return `${CHAPTERS_PATH}/chapter-${String(chapterNumber).padStart(2, "0")}.md`;
}

function validateOutline(
  synopsisText: string,
  planText: string,
  chapters: ManuscriptChapter[],
  findings: ClaudeBookDraftContractFinding[]
): void {
  if (chapters.length === 0) return;

  if (!hasMeaningfulContent(synopsisText)) {
    findings.push({
      severity: "error",
      code: "manuscript_without_outline",
      path: SYNOPSIS_PATH,
      message: "Manuscript chapters exist before story/synopsis.md contains a real synopsis.",
    });
  }

  if (!hasMeaningfulContent(planText)) {
    findings.push({
      severity: "error",
      code: "manuscript_without_outline",
      path: PLAN_PATH,
      message: "Manuscript chapters exist before story/plan.md defines the chapter plan.",
    });
  }
}

function validateChapterPlan(
  planText: string,
  chapters: ManuscriptChapter[],
  findings: ClaudeBookDraftContractFinding[]
): void {
  if (!hasMeaningfulContent(planText) || chapters.length === 0) return;

  const plannedNumbers = parsePlannedChapterNumbers(planText);
  if (plannedNumbers.length === 0) return;

  const manuscriptNumbers = new Set(chapters.map((chapter) => chapter.chapterNumber));
  const plannedSet = new Set(plannedNumbers);

  for (const plannedNumber of plannedNumbers) {
    if (!manuscriptNumbers.has(plannedNumber)) {
      findings.push({
        severity: "error",
        code: "missing_planned_chapter",
        path: getChapterPath(plannedNumber),
        message: `story/plan.md expects chapter ${plannedNumber}, but no accepted manuscript file exists.`,
      });
    }
  }

  for (const chapter of chapters) {
    if (!plannedSet.has(chapter.chapterNumber)) {
      findings.push({
        severity: "error",
        code: "unplanned_chapter",
        path: chapter.relativePath,
        message: `Chapter ${chapter.chapterNumber} exists in the manuscript but is not listed in story/plan.md.`,
      });
    }
  }
}

function validateChapterContinuity(
  chapters: ManuscriptChapter[],
  findings: ClaudeBookDraftContractFinding[]
): void {
  if (hasContiguousChapters(chapters)) return;

  findings.push({
    severity: "error",
    code: "non_contiguous_chapters",
    path: CHAPTERS_PATH,
    message: "Manuscript chapter files are not contiguous; draft generation skipped at least one chapter number.",
  });
}

function validateStateUpdates(
  rootPath: string,
  chapters: ManuscriptChapter[],
  findings: ClaudeBookDraftContractFinding[]
): void {
  if (chapters.length === 0) return;

  for (const relativePath of STATE_PATHS) {
    if (!hasMeaningfulContent(readText(rootPath, relativePath))) {
      findings.push({
        severity: "error",
        code: "manuscript_without_state_update",
        path: relativePath,
        message: `Manuscript chapters exist before ${relativePath} contains durable continuity state.`,
      });
    }
  }
}

function validateParagraphShape(
  chapters: ManuscriptChapter[],
  findings: ClaudeBookDraftContractFinding[]
): void {
  for (const chapter of chapters) {
    const lines = chapter.text.split(/\r?\n/);
    const blankLines = lines.filter((line) => line.trim().length === 0).length;
    const paragraphs = chapter.text
      .replace(/^#.*(?:\r?\n)+/, "")
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) =>
        paragraph.length > 0
        && !paragraph.startsWith("#")
        && !/^[-*_]{3,}$/.test(paragraph)
      );

    if (paragraphs.length < 4) continue;

    const shortParagraphs = paragraphs.filter((paragraph) =>
      [...paragraph.replace(/[#*_`>\s]/g, "")].length < 45
    );
    const blankLineRatio = blankLines / Math.max(1, lines.length);
    const shortParagraphRatio = shortParagraphs.length / paragraphs.length;

    if (blankLineRatio > 0.35 && shortParagraphRatio > 0.8) {
      findings.push({
        severity: "warning",
        code: "choppy_paragraph_format",
        path: chapter.relativePath,
        message: "Chapter formatting looks like sentence-per-paragraph output instead of natural prose paragraphs.",
      });
    }
  }
}

export function validateClaudeBookDraftContract(rootPath: string): ClaudeBookDraftContractFinding[] {
  const findings: ClaudeBookDraftContractFinding[] = [];
  const synopsisText = readText(rootPath, SYNOPSIS_PATH);
  const planText = readText(rootPath, PLAN_PATH);
  const chapters = listManuscriptChapters(rootPath);

  validateOutline(synopsisText, planText, chapters, findings);
  validateChapterPlan(planText, chapters, findings);
  validateChapterContinuity(chapters, findings);
  validateStateUpdates(rootPath, chapters, findings);
  validateParagraphShape(chapters, findings);

  return findings;
}
