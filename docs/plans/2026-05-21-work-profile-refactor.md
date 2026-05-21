# Work Profile Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert writing Method Packs from agent-facing prompt bundles into machine-readable Work Profiles, with runtime rules in `AGENTS.md` and writing methods in local skills.

**Architecture:** Work Profiles define scaffold, validation, repair, migration, file roles, and required skills only. `AGENTS.md` is the agent-readable runtime projection for a concrete workspace. `skills/*/SKILL.md` owns task methods, output contracts, and writing craft.

**Tech Stack:** TypeScript, Bun test runner, Markdown workspace templates, bundled skill files.

---

## Constraints

- Keep the first implementation scoped to `short-form.article`.
- Do not rename `method-packs/` to `workspace-profiles/` in this phase; introduce profile semantics first and defer broad naming migration.
- Do not preserve any Method Pack system prompt or periodic reminder path for short-form work.
- Do not put writing methods in Work Profile fields.
- Keep existing user-authored workspace files untouched during scaffold repair.
- Use TDD: write failing tests, verify red, implement, verify green.

## Target Boundary

```text
Work Profile
  Machine-readable product spec.
  Creates, validates, repairs, migrates, and installs resources.
  Not injected into model context.

AGENTS.md
  Agent-readable runtime contract for the current workspace.
  File roles, write boundaries, local skill usage principles, project overrides.

Skills
  Agent-readable executable methods.
  Opening design, golden-three planning, drafting, revision, diagnosis.
```

## Task 1: Stop Treating Short-Form Method Pack As Agent Runtime Prompt

**Files:**
- Modify: `packages/shared/src/prompts/__tests__/system-novel.test.ts`
- Modify: `packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts`
- Modify: `packages/shared/src/prompts/system.ts`

**Step 1: Write failing system prompt test**

Replace the existing runtime injection test in `packages/shared/src/prompts/__tests__/system-novel.test.ts`:

```ts
it('does not inject Method Pack runtime prompts from the writing manifest', () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'craft-profile-runtime-'))
  createNovelProjectScaffold(rootPath, {
    title: 'Short Profile Runtime',
    methodPackId: 'short-form.article',
  })

  const prompt = getSystemPrompt(
    undefined,
    undefined,
    rootPath,
    rootPath,
    'novel',
    'Storyflow Backend',
    false
  )

  expect(prompt).not.toContain('<method_pack_runtime')
  expect(prompt).not.toContain('method_pack_periodic_reminder')
  expect(prompt).not.toContain('首章入场坡道')
  expect(prompt).toContain('Novel Writing Workspace')
})
```

**Step 2: Write failing periodic reminder test**

Change `packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts` to assert no method-pack reminder is injected:

```ts
describe('PromptBuilder writing profile context', () => {
  it('does not inject method-pack periodic reminders', () => {
    const rootPath = mkdtempSync(join(tmpdir(), 'craft-profile-reminder-'))
    createNovelProjectScaffold(rootPath, {
      title: 'Short Form Reminder',
      methodPackId: 'short-form.article',
    })
    const builder = createBuilder(rootPath)

    const secondTurn = builder.buildContextParts({ userIteration: 2 }).join('\n\n')
    const fourthTurn = builder.buildContextParts({ userIteration: 4 }).join('\n\n')

    expect(secondTurn).not.toContain('<method_pack_periodic_reminder')
    expect(fourthTurn).not.toContain('<method_pack_periodic_reminder')
  })
})
```

**Step 3: Run tests to verify red**

Run:

```bash
bun test packages/shared/src/prompts/__tests__/system-novel.test.ts packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts
```

Expected: FAIL because `getMethodPackRuntimePrompt` still injects `<method_pack_runtime>` and `getMethodPackPeriodicReminderPrompt` still injects reminders.

**Step 4: Remove runtime prompt injection**

In `packages/shared/src/prompts/system.ts`:

- Remove imports for `buildMethodPackRuntimeContext` and `buildMethodPackPeriodicReminderContext`.
- Replace `getMethodPackRuntimePrompt()` implementation with `return ''`.
- Replace `getMethodPackPeriodicReminderPrompt()` implementation with `return ''`.
- Update the comment above both functions to explain Work Profiles are product metadata, not runtime prompt sources.

Minimal implementation:

```ts
export function getMethodPackRuntimePrompt(_workingDirectory?: string): string {
  return '';
}

export function getMethodPackPeriodicReminderPrompt(
  _workingDirectory: string | undefined,
  _userIteration: number | undefined,
): string {
  return '';
}
```

**Step 5: Run tests to verify green**

Run:

```bash
bun test packages/shared/src/prompts/__tests__/system-novel.test.ts packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/prompts/system.ts packages/shared/src/prompts/__tests__/system-novel.test.ts packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts
git commit -m "refactor: 停止注入工作区配置提示词"
```

## Task 2: Add Short-Form Runtime Skills

**Files:**
- Modify: `packages/shared/src/writing/novel-skills.ts`
- Modify: `packages/shared/src/writing/__tests__/novel-skills.test.ts`
- Modify: `packages/shared/src/writing/method-packs/short-form.ts`
- Modify: `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`

**Step 1: Write failing bundled skills test**

In `packages/shared/src/writing/__tests__/novel-skills.test.ts`, replace the short-form "seeds no skills" expectation with:

```ts
it("seeds short-form runtime skills into a short-form web-fiction scaffold", () => {
  const rootPath = createTempProject();

  createNovelProjectScaffold(rootPath, {
    title: "Short Piece",
    methodPackId: "short-form.article",
  });

  for (const slug of [
    "short-opening-designer",
    "short-golden-three",
    "short-draft-chapter",
    "short-reviser",
  ]) {
    const skillPath = join(rootPath, "skills", slug, "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);
    expect(readFileSync(skillPath, "utf-8")).toContain(`name: ${slug}`);
  }
});
```

**Step 2: Write failing profile contract test**

In `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`, update short-form expectations:

```ts
expect(pack?.requiredSkills).toEqual([
  "short-opening-designer",
  "short-golden-three",
  "short-draft-chapter",
  "short-reviser",
]);
```

**Step 3: Run tests to verify red**

Run:

```bash
bun test packages/shared/src/writing/__tests__/novel-skills.test.ts packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: FAIL because `SHORT_FORM_SKILLS` is empty and `requiredSkills` is still `[]`.

**Step 4: Implement bundled short-form skills**

In `packages/shared/src/writing/novel-skills.ts`, replace:

```ts
const SHORT_FORM_SKILLS: Array<{ slug: string; content: string }> = [];
```

with adapter skills:

```ts
const SHORT_FORM_ATTRIBUTION = "Craft Agent short-form writing profile";

const SHORT_FORM_SKILLS = [
  adapterSkill({
    slug: "short-opening-designer",
    title: "Short Opening Designer",
    description: "Use when planning, diagnosing, or revising the first screen of a short-form Chinese web-fiction piece, especially when writing chapter 1, improving an abrupt opening, or filling the opening section of 简报.md / 大纲.md.",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "Design the first-screen retention artifact before prose drafting.",
    context: [
      "Read 创作要求.md, 简报.md, 大纲.md, 人物.md, and 素材.md when present.",
      "Do not write accepted prose into 正文/.",
      "Use 自由区/ for competing opening experiments when needed.",
    ],
    workflow: [
      "Extract title promise, genre promise, protagonist pressure, relationship pressure, and known taboo constraints.",
      "Design the opening artifact: impossible fact, evidence object, relationship pressure, irreversible cost, protagonist first choice, three-paragraph progression, and first-800-character pursuit question.",
      "Update 简报.md and 大纲.md with the accepted opening design.",
      "If multiple options are useful, put comparison notes in 自由区/YYYYMMDD-开篇方案.md.",
    ],
    output: [
      "Updated 简报.md opening section.",
      "Updated 大纲.md chapter-01 opening beats.",
      "Optional 自由区 opening comparison note.",
    ],
  }),
  adapterSkill({
    slug: "short-golden-three",
    title: "Short Golden Three Planner",
    description: "Use when planning or repairing the first three chapters of a short-form Chinese web-fiction piece for retention, escalation, and payoff.",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "Turn premise and opening promise into a chapter-1 pull, chapter-2 pressure, and chapter-3 lock-in plan.",
    context: [
      "Use 简报.md as intake.",
      "Use 大纲.md as outline.",
      "Do not write accepted prose into 正文/.",
    ],
    workflow: [
      "Identify chapter-1 pull, chapter-2 pressure escalation, and chapter-3 retention lock.",
      "Check that each chapter has a state change, visible conflict, and pursuit question.",
      "Update 简报.md and 大纲.md rather than creating a separate 黄金三章.md file.",
    ],
    output: [
      "Updated 简报.md golden-three section.",
      "Updated 大纲.md first-three chapter beats.",
    ],
  }),
  adapterSkill({
    slug: "short-draft-chapter",
    title: "Short Chapter Drafter",
    description: "Use when drafting the current next chapter of a short-form Chinese web-fiction piece after 简报.md and 大纲.md contain usable planning content.",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "Draft one accepted chapter from the current brief, outline, characters, and source material.",
    context: [
      "正文/ contains accepted prose only.",
      "自由区/ contains experiments and discarded drafts.",
      "Default to one chapter per request unless the user explicitly asks for batch drafting.",
    ],
    workflow: [
      "Read 创作要求.md, 简报.md, 大纲.md, 人物.md, and 素材.md.",
      "Find the next planned chapter and confirm no accepted chapter already exists for that number.",
      "Draft only the current chapter into 正文/NN-标题.md.",
      "Keep experiments or alternative openings in 自由区/.",
    ],
    output: [
      "One 正文/NN-标题.md chapter file.",
      "Brief note of any unresolved assumptions.",
    ],
  }),
  adapterSkill({
    slug: "short-reviser",
    title: "Short Form Reviser",
    description: "Use when diagnosing or revising an existing short-form Chinese web-fiction chapter for retention, conflict, pacing, payoff, abruptness, or weak opening.",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "Revise accepted or draft short-form prose against the project brief and reader-retention contract.",
    context: [
      "Use patch-style local edits for existing files.",
      "Do not fork 草稿/ or 定稿/ directories.",
      "Put review notes in 自由区/ when needed.",
    ],
    workflow: [
      "Separate original text facts, inferred reader response, and revision recommendations.",
      "Check first 300-800 characters for pressure, conflict, question, and consequence.",
      "Apply scoped revisions to the target chapter or produce a review note if the user asked for diagnosis only.",
    ],
    output: [
      "Patched chapter file or 自由区 review note.",
      "Concise summary of structural changes.",
    ],
  }),
];
```

In `packages/shared/src/writing/method-packs/short-form.ts`, set:

```ts
requiredSkills: [
  "short-opening-designer",
  "short-golden-three",
  "short-draft-chapter",
  "short-reviser",
],
```

**Step 5: Run tests to verify green**

Run:

```bash
bun test packages/shared/src/writing/__tests__/novel-skills.test.ts packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/shared/src/writing/novel-skills.ts packages/shared/src/writing/__tests__/novel-skills.test.ts packages/shared/src/writing/method-packs/short-form.ts packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
git commit -m "feat: 添加短文运行时技能"
```

## Task 3: Move Short-Form Writing Methods Out Of Work Profile

**Files:**
- Modify: `packages/shared/src/writing/method-packs/short-form.ts`
- Modify: `packages/shared/src/writing/method-packs/__tests__/runtime.test.ts`
- Modify: `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`

**Step 1: Write failing profile purity tests**

In `packages/shared/src/writing/method-packs/__tests__/runtime.test.ts`, replace short-form runtime tests with a profile purity assertion:

```ts
it("keeps short-form profile free of agent-facing writing methods", () => {
  const pack = getBuiltInMethodPack("short-form.article");
  expect(pack).not.toBeNull();

  const serialized = JSON.stringify(pack);

  expect(serialized).not.toContain("首章入场坡道");
  expect(serialized).not.toContain("原创题记");
  expect(serialized).not.toContain("前三段");
  expect(serialized).not.toContain("高压开场");
  expect(serialized).not.toContain("情绪账本");
  expect(pack?.requiredSkills).toContain("short-opening-designer");
  expect(pack?.requiredSkills).toContain("short-draft-chapter");
});
```

**Step 2: Run test to verify red**

Run:

```bash
bun test packages/shared/src/writing/method-packs/__tests__/runtime.test.ts
```

Expected: FAIL because `SHORT_FORM_METHOD_PACK` still contains writing methods in `runtimePreamble`, `agentIdentity`, `alwaysOnInstructions`, `initialRequestPolicy`, `artifactContract`, and `operatingRules`.

**Step 3: Simplify short-form profile**

In `packages/shared/src/writing/method-packs/short-form.ts`:

- Remove writing-method wording from `runtimePreamble`, `agentIdentity`, `alwaysOnInstructions`, `initialRequestPolicy`, `artifactContract`, and `operatingRules`.
- Keep only file lifecycle roles, required paths, naming conventions, required skills, and starter message.
- If current `MethodPack` type requires prompt fields, set them to short neutral strings for compatibility during this phase:

```ts
runtimePreamble: "",
agentIdentity: "",
defaultSkill: "",
alwaysOnInstructions: "",
initialRequestPolicy: "",
operatingRules: undefined,
skillRouting: [],
```

Keep `starterMessage` short and product-facing:

```ts
starterMessage: `## 这是什么

这是一个面向 5,000-30,000 字中文短篇/中篇网文的写作工作区。系统会创建简报、大纲、人物、素材、正文和自由区，并安装短文写作 skills。

## 文件

- 创作要求.md：长期偏好与禁区。
- 简报.md：当前作品 intake。
- 大纲.md：章节 outline。
- 人物.md / 素材.md：reference。
- 正文/：accepted prose。
- 自由区/：scratch。
`,
```

**Step 4: Run test to verify green**

Run:

```bash
bun test packages/shared/src/writing/method-packs/__tests__/runtime.test.ts packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/method-packs/short-form.ts packages/shared/src/writing/method-packs/__tests__/runtime.test.ts packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
git commit -m "refactor: 精简短文工作区配置"
```

## Task 4: Make Short-Form AGENTS.md Runtime-Only

**Files:**
- Modify: `packages/shared/src/writing/novel-template.ts`
- Modify: `packages/shared/src/writing/__tests__/novel-template.test.ts`

**Step 1: Write failing AGENTS.md boundary test**

In `packages/shared/src/writing/__tests__/novel-template.test.ts`, update the short-form `AGENTS.md` assertions:

```ts
const agents = readFileSync(join(rootPath, "AGENTS.md"), "utf-8");
expect(agents).toContain("short-form.article");
expect(agents).toContain("## 文件角色");
expect(agents).toContain("## 写入边界");
expect(agents).toContain("## Skills");
expect(agents).toContain("正文/");
expect(agents).toContain("自由区/");
expect(agents).toContain("skill description");
expect(agents).not.toContain("原创题记");
expect(agents).not.toContain("前三段");
expect(agents).not.toContain("高压开场");
expect(agents).not.toContain("情绪账本");
expect(agents).not.toContain("第 1 章拉新");
```

**Step 2: Run test to verify red**

Run:

```bash
bun test packages/shared/src/writing/__tests__/novel-template.test.ts
```

Expected: FAIL because `createShortFormAgentInstructions()` still contains writing methods.

**Step 3: Rewrite short-form AGENTS.md template**

In `packages/shared/src/writing/novel-template.ts`, replace `createShortFormAgentInstructions()` with runtime-only content:

```ts
function createShortFormAgentInstructions(pack: MethodPack): string {
  return `# ${pack.displayName}

本工作区使用 \`${pack.id}\`。一个工作区只承载一本 5,000-30,000 字短篇/中篇网文。

## 文件角色

- \`创作要求.md\`：长期偏好、禁区和跨项目约束。
- \`简报.md\`：当前作品 intake。
- \`大纲.md\`：章节 outline。
- \`人物.md\`：character reference。
- \`素材.md\`：source/reference material。
- \`正文/\`：accepted prose only。
- \`自由区/\`：scratch notes, experiments, discarded variants, and reviews。

## 写入边界

- 不要把草稿、多版本、审校笔记写入 \`正文/\`。
- 不要新建 \`草稿/\` 或 \`定稿/\` 目录。
- 修改已有正文时优先局部 patch。
- 修订历史依赖 git diff。
- 不要无故覆盖用户已写内容。

## Skills

- 本工作区安装的本地 skills 是创作、诊断、修订任务的执行入口。
- 当用户请求命中某个 skill description 时，使用该 skill 的 workflow 和 output contract。
- 具体写法、开篇设计、黄金三章、正文起草和修订方法都由 skills 承载，不写在本文件中。
`;
}
```

**Step 4: Run test to verify green**

Run:

```bash
bun test packages/shared/src/writing/__tests__/novel-template.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/novel-template.ts packages/shared/src/writing/__tests__/novel-template.test.ts
git commit -m "refactor: 精简短文工作区运行说明"
```

## Task 5: Keep Writing Methods In Templates Or Skills Deliberately

**Files:**
- Modify: `packages/shared/src/writing/novel-template.ts`
- Modify: `packages/shared/src/writing/__tests__/novel-template.test.ts`

**Decision:** Starter project files such as `简报.md`, `大纲.md`, and `创作要求.md` may contain fields that skills read and fill. They should not contain full method explanations. Keep field names, remove long craft instructions.

**Step 1: Write template boundary test**

In `packages/shared/src/writing/__tests__/novel-template.test.ts`, assert templates contain field slots but not long method claims:

```ts
expect(brief).toContain("## 首章开篇引导");
expect(brief).toContain("章首题记 / 引文");
expect(brief).toContain("前三段节奏");
expect(brief).not.toContain("默认原创，不伪造出处");
expect(brief).not.toContain("情绪命题 → 异常现场 → 读者疑问");

expect(requirements).toContain("## 首章头部");
expect(requirements).toContain("题记 / 引文偏好");
expect(requirements).not.toContain("不可核验名人名言");
```

**Step 2: Run test to verify red**

Run:

```bash
bun test packages/shared/src/writing/__tests__/novel-template.test.ts
```

Expected: FAIL because templates still include detailed method hints.

**Step 3: Simplify starter templates**

In `packages/shared/src/writing/novel-template.ts`:

- Keep field labels:
  - `章首题记 / 引文`
  - `开场第一镜头`
  - `前三段节奏`
  - `第一章开讲前不解释的背景`
  - `读者必须带着什么问题读下去`
- Remove method explanation from field labels:
  - `默认原创，不伪造出处`
  - `情绪命题 → 异常现场 → 读者疑问`
  - `不使用不可核验名人名言`

**Step 4: Run test to verify green**

Run:

```bash
bun test packages/shared/src/writing/__tests__/novel-template.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/novel-template.ts packages/shared/src/writing/__tests__/novel-template.test.ts
git commit -m "refactor: 精简短文模板字段"
```

## Task 6: Introduce Work Profile Naming Without Broad Rename

**Files:**
- Modify: `packages/shared/src/writing/method-packs/types.ts`
- Modify: `packages/shared/src/writing/method-packs/index.ts`
- Modify: `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`

**Step 1: Write failing alias test**

In `packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts`:

```ts
import { getBuiltInWorkspaceProfile, getBuiltInWorkspaceProfiles } from "../index.ts";

it("exposes method packs through workspace profile aliases", () => {
  expect(getBuiltInWorkspaceProfiles().map((profile) => profile.id)).toContain("short-form.article");
  expect(getBuiltInWorkspaceProfile("short-form.article")?.projectType).toBe("short-form");
});
```

**Step 2: Run test to verify red**

Run:

```bash
bun test packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: FAIL because aliases do not exist.

**Step 3: Add type and function aliases**

In `packages/shared/src/writing/method-packs/types.ts`:

```ts
export type WorkspaceProfileId = MethodPackId;
export type WorkspaceProfile = MethodPack;
```

In `packages/shared/src/writing/method-packs/index.ts`:

```ts
export const getBuiltInWorkspaceProfiles = getBuiltInMethodPacks;
export const getBuiltInWorkspaceProfile = getBuiltInMethodPack;
```

Add comments explaining the old `MethodPack` name remains for compatibility while new code should prefer `WorkspaceProfile`.

**Step 4: Run test to verify green**

Run:

```bash
bun test packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/writing/method-packs/types.ts packages/shared/src/writing/method-packs/index.ts packages/shared/src/writing/method-packs/__tests__/claude-book.test.ts
git commit -m "refactor: 增加工作区配置别名"
```

## Task 7: Full Verification

**Files:**
- No source edits.

**Step 1: Run writing test suite**

Run:

```bash
bun test packages/shared/src/writing
```

Expected: PASS.

**Step 2: Run prompt-related tests**

Run:

```bash
bun test packages/shared/src/prompts packages/shared/src/agent/core/__tests__/prompt-builder-method-pack-reminder.test.ts
```

Expected: PASS.

**Step 3: Search for short-form method leakage**

Run:

```bash
rg -n "首章入场坡道|原创题记|前三段|高压开场|情绪账本|method_pack_runtime|method_pack_periodic_reminder" packages/shared/src/writing/method-packs packages/shared/src/prompts packages/shared/src/agent/core
```

Expected:

- No matches in `packages/shared/src/writing/method-packs/short-form.ts`.
- No runtime injection references in `packages/shared/src/prompts/system.ts`.
- Matches inside skill content are acceptable.

**Step 4: Commit verification-only cleanup if needed**

Only if formatting or test name cleanup was necessary:

```bash
git add <changed-files>
git commit -m "test: 验证工作区配置边界"
```

## Task 8: Deferred Follow-Up

Do not include this in the first implementation unless the short-form refactor is stable.

- Rename `method-packs/` to `workspace-profiles/`.
- Rename manifest field `methodPack` to `workspaceProfile`.
- Add migration from `craft-writing.json.methodPack` to `craft-writing.json.workspaceProfile`.
- Remove compatibility aliases.
- Apply the same prompt-removal cleanup to `novel.claude-book`, `novel.oh-story`, `novel.crucible`, and `novel.creative-writing`.

## Success Criteria

- Work Profile data no longer injects agent-facing prompts.
- Short-form profile contains structure, lifecycle, required paths, and required skills only.
- Short-form `AGENTS.md` contains runtime boundaries only.
- Short-form writing methods live in local skills.
- Starter content files contain fillable fields, not full method explanations.
- Existing scaffold, validation, and writing tests pass.

