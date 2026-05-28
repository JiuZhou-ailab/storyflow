// input: Built-in writing skill definitions
// output: File payloads seeded into writing workspaces
// pos: Packaged skill bundle for built-in writing Method Packs

import { getClaudeBookNotice } from "./claude-book-notice.ts";
import type { MethodPackId } from "./method-packs/types.ts";

export interface BundledNovelSkillFile {
  relativePath: string;
  content: string;
}

const ATTRIBUTION = "基于 Claude-Book 概念为 Craft Agent 改写。来源：https://github.com/ThomasHoussin/Claude-Book";
const OH_STORY_ATTRIBUTION = "基于 oh-story-claudecode 概念为 Craft Agent 改写。来源：https://github.com/worldwonderer/oh-story-claudecode";
const CRUCIBLE_ATTRIBUTION = "基于 The Crucible Writing System For Claude 概念为 Craft Agent 改写。来源：https://github.com/forsonny/The-Crucible-Writing-System-For-Claude";
const CREATIVE_WRITING_ATTRIBUTION = "基于 creative-writing-skills 概念为 Craft Agent 改写。来源：https://github.com/haowjy/creative-writing-skills";

const CLAUDE_BOOK_SKILLS: Array<{ slug: string; content: string }> = [
  {
    slug: "book-analyzer",
    content: `---
name: 原著分析
description: 用于分析小说、故事或叙事源文本，并抽取可复用的写作圣经。
---

# 原著分析

${ATTRIBUTION}

## 用途

从源文本中抽取有证据支撑的写作圣经文件，让新项目可以学习风格、结构、人物和地点，而不是依赖有损摘要。

## 输入

- \`.work/analysis/src/\` 下的源文本文件。
- 已存在的 \`bible/\` 模板。

## 工作流程

1. 先读完整源文本，再抽取规则。
2. 创建 \`.work/analysis/output/<source-slug>/style.md\`，记录视角、时态、对白风格、句子节奏、词汇和描写模式。
3. 创建 \`.work/analysis/output/<source-slug>/structure.md\`，记录幕结构、章节模式、开篇、结尾、节奏和类型机制。
4. 在 \`.work/analysis/output/<source-slug>/characters/\` 下为每个主要人物创建文件。
5. 在 \`.work/analysis/output/<source-slug>/universe/\` 下为每个重要地点或世界元素创建文件。
6. 每条特征、模式和规则都必须有直接证据或可测量观察支撑。

## 证据规则

- 优先引用带章节或段落位置的原文例子。
- 区分观察事实和解释判断。
- 不要为了填满模板而发明人物特征或世界事实。
- 引用时保持源文本措辞不变。

## 输出语言

用户可见内容使用项目 manifest 语言；如果没有定义项目语言，默认使用中文。
`,
  },
  {
    slug: "bible-merger",
    content: `---
name: 项目圣经合并
description: 用于把多份叙事分析合并成一份规范项目圣经。
---

# 项目圣经合并

${ATTRIBUTION}

## 用途

把多份 \`.work/analysis/output/*/\` 分析合并进规范的 \`bible/\` 目录，同时保留来源证据和冲突记录。

## 工作流程

1. 盘点本次合并涉及的全部分析目录。
2. 合并 \`style.md\`：保留稳定模式，记录可变指标范围，标记仅属于某个来源的词汇。
3. 合并人物文件：保留跨来源反复出现的特征，并给单一来源特征标注出处。
4. 合并世界文件：整合重复地点和世界元素，显式保留矛盾。
5. 把 \`structure.md\` 合并成持久叙事规则和非绑定观察。
6. 写入 \`.work/analysis/merge-report.md\`，记录来源、一致性分析、覆盖范围和冲突处理。

## 冲突规则

- 直接证据优先于解释判断。
- 只有项目明确遵循源文本时间顺序时，才默认采用较晚 canon。
- 记录未解决矛盾，不要隐藏。
- 覆盖已有 bible 文件前，必须在合并报告中保留旧内容摘要。
`,
  },
  {
    slug: "story-ideator",
    content: `---
name: 故事构思
description: 用于基于既有小说圣经生成原创情节点子、故事梗概、章节弧线或场景方案。
---

# 故事构思

${ATTRIBUTION}

## 用途

生成符合项目圣经的原创故事方案，避免复制源文本的剧情、场景、反派或章节推进方式。

## 必需上下文

- \`bible/style.md\`
- \`bible/structure.md\`
- \`bible/characters/*.md\`
- \`bible/universe/*.md\`
- 可用时读取 \`.work/analysis/output/*/structure.md\`，用于相似风险检查。

## 工作流程

1. 创建 \`.work/universe-context.md\`，整理人物、地点、语气、结构约束和开放创作边界。
2. 用反转、地点碰撞、外部压力、关系压力测试和类型混搭生成 10-15 个种子。
3. 除非用户要求直接生成，否则先展示种子选项再扩展。
4. 把选中种子扩展成一句话梗概、MICE 类型、结构图、风险、障碍、高潮和结局。
5. 可用时对照源文本结构，并把重叠风险写入 \`.work/plagiarism-check.md\`。
6. 只有方向明确后，才写入 \`story/synopsis.md\` 并更新 \`story/plan.md\`。

## 输出契约

- 已接受的梗概或章节计划不能只留在 \`.work/\` 或会话计划文件里。
- 选定梗概必须写入 \`story/synopsis.md\`。
- 选定章节数量、顺序、标题、目标篇幅和核心节拍必须写入 \`story/plan.md\`。
- \`story/plan.md\` 是后续章节生成的真相源。

## 原创性规则

- 把 bible 元素当作约束，不要当作可复制的剧情机器。
- 避免镜像源文本的信息发现方式、反派职能、关键场景或解决模式。
- 如果相似度过高，回到种子生成，不要用表层改名修补。
`,
  },
  {
    slug: "chapter-workflow",
    content: `---
name: 章节工作流
description: 用于在写作工作区内规划、起草、审校并定稿小说章节。
---

# 章节工作流

${ATTRIBUTION}

## 用途

用 Craft skills 和项目文件，把一个章节从当前状态推进到计划、草稿、审校、修订和状态更新。

## 标准流程

0. 在 \`story/synopsis.md\` 和 \`story/plan.md\` 仍是空模板前，不要写入或更新 \`story/chapters/\`。
1. 读取 \`story/synopsis.md\`、\`story/plan.md\`、\`state/current/*\` 和 \`timeline/history.md\`。
2. 创建 \`.work/chapter-XX-plan.md\`，写清目标、起点、节拍、章末钩子、人物、地点、物件和揭示信息。
3. 根据章节计划和相关 bible 文件，把草稿写入 \`.work/chapter-XX-draft.md\`。
4. 运行风格、人物和连续性审校 skills。
5. 如果关卡失败，只根据审校报告修订草稿并重复审校；除非用户要求继续，自动循环最多三轮。
6. 可选：只有项目明确启用且本地环境存在时，才运行本地 perplexity 分析。
7. 通过后，把定稿章节移入 \`story/chapters/\`。
8. 使用状态更新 skill 创建 \`state/chapter-XX/\`，更新 \`state/current\`，并追加时间线事件。

## 关卡

- 正文章节数量和顺序必须来自 \`story/plan.md\`。
- 不要跳过计划章节，也不要在 \`story/plan.md\` 之外发明额外已接受章节。
- 自然叙事段落通常应包含 2-5 句。
- 除对白、列表或刻意强调外，避免每句空一行。
- 风格审校检查正文是否符合 \`bible/style.md\`。
- 人物审校检查声线、特征、关系和情绪连续性。
- 连续性审校检查时间、空间、知识边界、物件状态和因果一致性。

## 边界

- 章节起草期间不要修改 \`bible/\`，除非用户明确要求。
- 不要把 perplexity 优化当作默认必选关卡；它是可选且依赖环境的。
- 保留已接受正文，除非用户明确要求修订它。
`,
  },
  {
    slug: "style-reviewer",
    content: `---
name: 风格审校
description: 用于根据小说项目风格指南检查章节草稿。
---

# 风格审校

${ATTRIBUTION}

## 用途

验证章节草稿是否符合技术性风格要求，不评价剧情质量，也不直接改写章节。

## 输入

- 章节草稿，通常是 \`.work/chapter-XX-draft.md\`
- \`bible/style.md\`
- 当章节开篇或结尾有结构约束时，读取 \`bible/structure.md\`

## 审校清单

- 视角一致性
- 时态一致性
- 语域和词汇约束
- 对白标签和对白格式规则
- 内心独白格式
- 指定的句子节奏和段落长度范围
- 指定的章节开篇和结尾模式
- 风格指南列出的禁止漂移项

## 输出

写入 \`.work/chapter-XX-style-report.md\`：

- 阻塞错误，包含精确摘录和违反的规则。
- 模糊或边界问题的警告。
- 风格指南要求的统计数据。
- 结论：\`PASS\` 或 \`FAIL - N blocking errors\`。

## 边界

- 不要改写正文。
- 不评价剧情、人物弧线或连续性。
- 如果风格指南模糊，把问题归为警告，不要当作阻塞错误。
`,
  },
  {
    slug: "character-reviewer",
    content: `---
name: 人物审校
description: 用于检查章节草稿中的人物行为、声线、关系和情绪连续性。
---

# 人物审校

${ATTRIBUTION}

## 用途

验证草稿中的人物是否与 bible 和当前状态一致，同时允许有动机支撑的成长。

## 输入

- 章节草稿
- \`bible/characters/*.md\`
- \`state/current/characters.md\`
- \`state/current/\` 中相关的关系或知识记录

## 审校清单

- 行动符合既有人设，或有可见压力解释偏离。
- 对白符合词汇、正式程度、节奏和口癖。
- 情绪变化来自前序状态和本章事件。
- 人物只知道他们已经得知的信息。
- 关系动态尊重先前状态。
- 成长应被事件挣得，而不是突然发生。

## 输出

写入 \`.work/chapter-XX-character-report.md\`：

- 重大不一致。
- 轻微不一致。
- 按人物拆分的对白检查。
- 情绪弧线。
- 结论：\`PASS\` 或 \`FAIL - N major inconsistencies\`。

## 边界

- 除非影响人物声线，否则不要评价文风。
- 不要直接改写对白；说明期望行为或声线目标。
`,
  },
  {
    slug: "continuity-reviewer",
    content: `---
name: 连续性审校
description: 用于检查章节草稿中的时间线、空间逻辑、知识边界、物件状态和因果连续性。
---

# 连续性审校

${ATTRIBUTION}

## 用途

找出章节草稿与既有叙事状态之间的矛盾。

## 输入

- 章节草稿
- \`state/current/situation.md\`
- \`state/current/knowledge.md\`
- 存在时读取 \`state/current/inventory.md\`
- \`timeline/history.md\`

## 审校清单

- 人物位置和转场。
- 时间点、经过时长、季节和事件顺序。
- 环境连续性。
- 人物知识边界。
- 物件归属、位置、损坏、丢失或使用状态。
- 来自前文的因果关系。
- 对前序事件的引用。

## 输出

写入 \`.work/chapter-XX-continuity-report.md\`：

- 连续性错误。
- 时间线问题。
- 知识边界违规。
- 空间问题。
- 物件追踪问题。
- 结论：\`PASS\` 或 \`FAIL - N errors\`。

## 边界

- 不评价文笔质量、节奏或风格。
- 除非为了解释矛盾，否则不要提出创意替代方案。
`,
  },
  {
    slug: "state-updater",
    content: `---
name: 状态更新
description: 用于把已验证章节中的叙事状态抽取到版本化状态文件和时间线文件。
---

# 状态更新

${ATTRIBUTION}

## 用途

把已接受章节转成后续写作可用的持久连续性记录。

## 输入

- 最终章节文本。
- 之前的 \`state/current/*\`。
- \`timeline/current-chapter.md\`
- \`timeline/history.md\`

## 工作流程

1. 确定章节编号。
2. 创建 \`state/chapter-XX/\`。
3. 在新章节目录中写入完整的 \`situation.md\`、\`characters.md\` 和 \`knowledge.md\`。
4. 只有物件具有叙事意义时，才写入 \`inventory.md\`。
5. 根据平台文件系统能力，让 \`state/current\` 指向或镜像新的章节状态。
6. 按时间顺序把事件追加到 \`timeline/current-chapter.md\`。
7. 章节切换时，把当前章节时间线追加到 \`timeline/history.md\`；确认归档完成后，才清空 \`timeline/current-chapter.md\`。

## 抽取规则

- 只记录明示或强暗示事实。
- 时间模糊时标为不明确，不要猜测。
- 追踪每条事实的知情者。
- 章节没有解决的钩子要继续保留。
- 仍然成立的旧状态事实要延续。

## 输出

展示每个创建或更新的状态文件完整内容，并按正文、状态、时间线总结语义变化。
`,
  },
];

function adapterSkill({
  slug,
  title,
  description,
  metadataName,
  attribution,
  purpose,
  context,
  workflow,
  output,
  sectionLabels = {
    purpose: "用途",
    context: "项目上下文",
    workflow: "工作流程",
    output: "输出",
  },
}: {
  slug: string;
  title: string;
  description: string;
  metadataName?: string;
  attribution: string;
  purpose: string;
  context: string[];
  workflow: string[];
  output: string[];
  sectionLabels?: {
    purpose: string;
    context: string;
    workflow: string;
    output: string;
  };
}): { slug: string; content: string } {
  return {
    slug,
    content: `---
name: ${metadataName ?? slug}
description: ${description}
---

# ${title}

${attribution}

## ${sectionLabels.purpose}

${purpose}

## ${sectionLabels.context}

${context.map((item) => `- ${item}`).join("\n")}

## ${sectionLabels.workflow}

${workflow.map((item, index) => `${index + 1}. ${item}`).join("\n")}

## ${sectionLabels.output}

${output.map((item) => `- ${item}`).join("\n")}
`,
  };
}

const OH_STORY_SKILLS = [
  adapterSkill({
    slug: "story-setup",
    title: "故事项目初始化",
    metadataName: "故事项目初始化",
    description: "用于初始化或修复 Oh Story 网文工作区。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "准备网文项目结构，并说明起草前必须补齐的信息。",
    context: ["设定/ 存放 canon。", "大纲/ 存放整本书和章节规划。", "追踪/ 存放连续性、伏笔和时间线状态。"],
    workflow: ["检查必需目录和起始文件是否存在。", "识别缺失的前提、平台、题材赛道、对标作品和更新节奏决策。", "如果项目方向仍不完整，把简短初始化清单写入 .work/setup-checklist.md。"],
    output: ["工作区初始化状态。", "下一步必须决策的信息。", "优先填写的文件。"],
  }),
  adapterSkill({
    slug: "story",
    title: "故事路由",
    metadataName: "故事路由",
    description: "用于处理写一个、爽文、打脸、男频、女频、双男主、腹黑、乡村短文、黄金三章、premise、outline 或章节请求等宽泛网文需求，且项目方向尚未锁定时。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "在进入大纲、黄金三章或正文前，把宽泛网文请求分流到正确 intake 路径。",
    context: ["这是 Oh Story 工作流的基础 intake skill。", "长篇路径在定位明确后使用 long-scan、long-analyze 和 long-write。", "短篇路径在压缩故事简报明确后使用 short-scan、short-analyze 和 short-write。", "已接受正文放在 正文/。"],
    workflow: ["不要从第一个模糊请求直接起草，即使用户说“写一个”。", "从提示词中抽取已知事实：前提、设定、主角、关系、冲突、情绪引擎、预期兑现、篇幅和平台线索。", "识别会决定方法的缺失维度：男频/女频/无CP/双男主/双女主、题材赛道、打脸/逆袭/复仇/种田/悬疑/甜宠引擎、腹黑或直给人设、POV、反转节奏、结局形态、禁区约束，以及用户想先要大纲、黄金三章、分章还是正文。", "只提出阻塞问题；低风险缺失项可以明确给出默认值。", "分流到调研、拆文、长篇写作或短篇写作前，先写入或更新 设定/题材定位.md 和 大纲/大纲.md。"],
    output: ["从提示中抽出的已知约束。", "阻塞问题或明确默认值。", "选定工作流和下一产物，例如题材定位简报、大纲、黄金三章方案或短篇节拍大纲。"],
  }),
  adapterSkill({
    slug: "story-long-scan",
    title: "长篇市场调研",
    metadataName: "长篇市场调研",
    description: "用于调研长篇网文平台、趋势赛道、钩子和读者期待。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "把市场观察转成面向长篇网文的结构化定位建议。",
    context: ["调研材料存放在 参考资料/。", "对标列表和笔记存放在 对标/ 或 拆文库/。", "趋势笔记只有被接受进 设定/ 或 大纲/ 后才算 canon。"],
    workflow: ["定义目标平台和题材赛道。", "收集可比作品、开篇钩子、更新模式和读者承诺。", "总结可长期使用的定位约束，不复制剧情。"],
    output: ["参考资料/<topic>.md 调研笔记。", "选定对标时的 对标/<title>/ 笔记。", "写入 设定/题材定位.md 的定位建议。"],
  }),
  adapterSkill({
    slug: "story-long-analyze",
    title: "长篇对标拆解",
    metadataName: "长篇对标拆解",
    description: "用于把长篇网文对标作品拆解为可复用的结构、钩子和节奏观察。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "抽取不丢失证据的对标观察，用来指导原创长篇作品。",
    context: ["源文本摘录放在 对标/ 或 拆文库/。", "分析报告要区分证据和解释。", "原创项目 canon 仍然保存在 设定/。"],
    workflow: ["识别开篇承诺、黄金三章、反复钩子、情绪奖励循环和章末推进力。", "用来源引用记录观察。", "标记不能直接复制的模式。"],
    output: ["拆文库/<title>/拆文报告.md。", "可复用技法观察。", "需要避开的相似风险。"],
  }),
  adapterSkill({
    slug: "story-long-write",
    title: "长篇网文写作",
    metadataName: "长篇网文写作",
    description: "用于故事路由选定长篇路径且核心定位明确后，规划或起草长篇网文章节。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "把长篇网文从定位和大纲推进到章节计划与正文。",
    context: ["设定/ 是 canon。", "大纲/ 是章节契约。", "正文/ 存放已接受章节。", "每章接受后更新 追踪/。"],
    workflow: ["起草前确认 设定/题材定位.md 和 大纲/大纲.md 非空。", "在 大纲/ 中创建或更新章节简报。", "先在 .work/ 起草，再把已接受文本写入 正文/。", "接受后更新 追踪/上下文.md、追踪/伏笔.md 和 追踪/时间线.md。"],
    output: ["章节简报。", "正文草稿。", "追踪更新。"],
  }),
  adapterSkill({
    slug: "story-short-scan",
    title: "短篇市场调研",
    metadataName: "短篇市场调研",
    description: "用于调研短篇小说平台、压缩钩子和情绪兑现模式。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "发现短篇机会空间，并转成原创前提约束。",
    context: ["短篇仍然使用 设定/、大纲/、正文/ 和 追踪/。", "调研材料放在 参考资料/。"],
    workflow: ["定义平台和目标情绪弧线。", "收集对标钩子、反转和兑现模式。", "总结可塑造原创短篇的约束。"],
    output: ["调研笔记。", "推荐的短篇前提赛道。", "风险和平台约束。"],
  }),
  adapterSkill({
    slug: "story-short-analyze",
    title: "短篇对标拆解",
    metadataName: "短篇对标拆解",
    description: "用于把短篇小说拆解成钩子、反转、情绪曲线和兑现机制。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "抽取短篇技法信号，但不复制对标作品的剧情机器。",
    context: ["对标分析放在 拆文库/。", "使用证据优先的抽取方式。", "原创故事决策写入 大纲/。"],
    workflow: ["识别钩子、铺设、反转序列、情绪高点和最终兑现。", "追踪信息在哪里被隐藏或重构。", "把观察转成当前故事约束。"],
    output: ["拆文报告.md。", "情绪曲线笔记。", "原创性风险提示。"],
  }),
  adapterSkill({
    slug: "story-short-write",
    title: "短篇故事写作",
    metadataName: "短篇故事写作",
    description: "用于故事路由选定短篇路径且核心约束明确后，规划、起草或打磨短篇网文。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "创作钩子、升级、反转和结尾清晰的高兑现短篇。",
    context: ["在故事路由之后使用，不作为第一个模糊请求的首个响应。", "用 大纲/ 承载压缩结构。", "先在 .work/ 起草，再把已接受文本写入 正文/。", "故事跨多个场景时，在 追踪/ 中记录事实连续性。"],
    workflow: ["如果仍是第一个模糊的“写一个”请求，返回故事路由，不要起草。", "确认前提、情绪目标、反转和结尾。", "创建节拍大纲。", "用紧凑场景经济性起草。", "围绕钩子清晰度和兑现完整性修订。"],
    output: ["短篇大纲。", "正文草稿。", "修订笔记。"],
  }),
  adapterSkill({
    slug: "story-deslop",
    title: "网文去 AI 味",
    metadataName: "网文去 AI 味",
    description: "用于减少网文草稿中的通用 AI 文风和模板化表达。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "在保留故事事实的前提下，识别并修订泛化、扁平或过度解释的文字。",
    context: ["默认处理 .work/ 草稿；只有用户明确要求编辑已接受正文时，才处理 正文/。", "除非用户要求，不改变 canon 事实。"],
    workflow: ["识别重复措辞、抽象情绪标签、过于整齐的过渡和低具体度描写。", "用具体动作、更锋利节奏和人物专属感知修订。", "保持剧情事件和连续性不变。"],
    output: ["问题清单。", "修订后的段落或文件。", "语义变化说明。"],
  }),
  adapterSkill({
    slug: "story-review",
    title: "网文审校",
    metadataName: "网文审校",
    description: "用于从钩子、节奏、连续性、市场匹配和读者兑现角度审校网文章节。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "在接受或发布网文草稿前做多维审校。",
    context: ["对照 设定/、大纲/ 和 追踪/。", "审校报告放在 .work/。"],
    workflow: ["检查钩子清晰度、章节推进力、情绪兑现、毒点、连续性和风格漂移。", "区分阻塞问题和润色建议。", "给出定向修订步骤。"],
    output: [".work/story-review-report.md。", "阻塞问题。", "修订优先级。"],
  }),
  adapterSkill({
    slug: "story-cover",
    title: "封面方案",
    metadataName: "封面方案",
    description: "用于为网文项目生成封面概念或封面制作简报。",
    attribution: OH_STORY_ATTRIBUTION,
    purpose: "把题材赛道、标题承诺、主角信号和平台期待转成封面简报。",
    context: ["用 设定/题材定位.md 和 大纲/ 确认故事承诺。", "生成资产或提示词不要写入 canon 文件。"],
    workflow: ["抽取题材、主角、核心视觉、情绪和平台约束。", "创建 2-3 个差异明显的封面方向。", "写出最终图片提示词或制作简报。"],
    output: ["封面概念选项。", "最终提示词或简报。", "如已生成图片，给出资产路径。"],
  }),
];

const CRUCIBLE_SKILLS = [
  adapterSkill({
    slug: "crucible-planner",
    title: "Crucible 规划",
    metadataName: "Crucible 规划",
    description: "用于把故事前提转成 Crucible 规划文档。",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "建立 36-beat 基础：命题、三条叙事线、forge points、mercy ledger、dark mirror 和 world forge。",
    context: ["planning/ 是真相源。", ".crucible/state/ 记录工作流状态。", "规划文档不成立前，不要起草章节。"],
    workflow: ["捕捉前提、主角、外部任务、内在火焰、关系星座、反派镜像和结局承诺。", "用明确未知项填充规划文档，不要发明确定性。", "检查每个 forge point 是否同时碰撞任务线、火焰线和关系星座线。"],
    output: ["planning/crucible-thesis.md。", "叙事线地图。", "Forge point 和 mercy ledger 更新。"],
  }),
  adapterSkill({
    slug: "crucible-outliner",
    title: "Crucible 大纲",
    metadataName: "Crucible 大纲",
    description: "用于把 Crucible 规划文档转成节拍和章节大纲。",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "把 36-beat 结构映射到章节级执行，同时保留叙事线逻辑。",
    context: ["写 outline/ 前必须读取 planning/。", "outline/master-outline.md 是章节契约。", "outline/by-chapter/ 存放详细章节简报。"],
    workflow: ["读取全部规划文档。", "把节拍映射到章节，标出进度百分比和 forge point 位置。", "创建包含叙事线功能、场景目标和结尾压力的章节简报。"],
    output: ["outline/master-outline.md。", "outline/by-chapter/chapter-XX.md 文件。", "未解决结构风险。"],
  }),
  adapterSkill({
    slug: "crucible-writer",
    title: "Crucible 起草",
    metadataName: "Crucible 起草",
    description: "用于按场景起草 Crucible 章节。",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "起草遵循大纲、尊重规划 canon、并保持 Crucible 叙事线压力的章节。",
    context: ["已接受章节放在 draft/chapters/。", "审校报告放在 draft/reviews/。", "story-bible.json 和 style-profile.md 有内容时，用它们约束 canon 和声线。"],
    workflow: ["读取章节简报和相关规划文档。", "先起草到 .work/。", "接受进 draft/chapters/ 前，确认没有发明设定、节拍漂移或无依据的人物知识。"],
    output: ["章节草稿。", "通过后的已接受章节文件。", "审校备注。"],
  }),
  adapterSkill({
    slug: "crucible-editor",
    title: "Crucible 修订",
    metadataName: "Crucible 修订",
    description: "用于按发展性、行文或润色层级修订 Crucible 章节。",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "在保留 36-beat 契约、叙事线编织和既定风格的前提下修订章节。",
    context: ["除非用户要求结构修订，否则不要编辑 planning 文档。", "修订报告放在 draft/reviews/。"],
    workflow: ["判定编辑层级。", "对照 outline 和 planning 文档检查。", "执行定向修订并总结语义变化。"],
    output: ["修订后的章节或 patch 计划。", "draft/reviews/edit-report.md。", "剩余风险。"],
  }),
  adapterSkill({
    slug: "crucible-reviewer",
    title: "Crucible 审校",
    metadataName: "Crucible 审校",
    description: "用于审校 Crucible 章节的连续性、大纲遵循度、时间线、声线和行文质量。",
    attribution: CRUCIBLE_ATTRIBUTION,
    purpose: "通过结构化章节或双章节审校，尽早发现漂移。",
    context: ["对照 planning/、outline/、story-bible.json 和 style-profile.md 审校。", "报告放在 draft/reviews/。"],
    workflow: ["检查节拍遵循、叙事线推进、时间线、连续性、发明事实、声线和行文技法。", "区分阻塞发现和建议。", "记录精确文件引用和修订目标。"],
    output: ["draft/reviews/chapter-XX-review.md。", "阻塞发现。", "下一步编辑建议。"],
  }),
];

const CREATIVE_WRITING_SKILLS = [
  adapterSkill({
    slug: "project-setup",
    title: "项目初始化",
    metadataName: "项目初始化",
    description: "用于初始化或修复 Creative Writing Skills 工作区。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "创建一个区分 story、work 和 kb 边界的可用写作工作区。",
    context: ["kb/ 是持久知识。", "work/ 是草稿和临时探索空间。", "story/chapters/ 是已接受正文。"],
    workflow: ["盘点现有文件。", "识别缺失的项目前提、声线参考、canon 和当前起草目标。", "写初始化清单，不覆盖用户内容。"],
    output: ["初始化状态。", "缺失输入。", "推荐的第一步动作。"],
  }),
  adapterSkill({
    slug: "writing-principles",
    title: "写作原则",
    metadataName: "写作原则",
    description: "用于把持久小说技法原则应用到故事决策或草稿判断中。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "用读者奖励、沉浸感、具体性、社会模拟和流动性评估创作选择。",
    context: ["先使用项目专属 kb/ 事实，再使用通用建议。", "技法建议必须绑定当前段落或大纲。"],
    workflow: ["识别目标读者效果。", "把当前选择映射到写作原则。", "推荐能改善目标效果的最小修订。"],
    output: ["技法诊断。", "定向建议。", "取舍。"],
  }),
  adapterSkill({
    slug: "prose-writing",
    title: "正文起草",
    metadataName: "正文起草",
    description: "用于根据场景简报并按项目声线起草正文。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "生成尊重 canon、声线参考和场景意图的场景正文。",
    context: ["读取相关 kb/ 页面和 work/outline 文件。", "除非接受进 story/chapters/，否则草稿写在 work/drafts/。"],
    workflow: ["收集场景目标、POV、地点、冲突和结束状态。", "用具体感官和情绪推进起草。", "保留所有已确立事实。"],
    output: ["场景或章节草稿。", "使用的假设。", "需要更新的 canon。"],
  }),
  adapterSkill({
    slug: "scene-construction",
    title: "场景构建",
    metadataName: "场景构建",
    description: "用于设计或修复场景节拍、入场、对白流或转场。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "塑造场景，让每个节拍都改变压力、信息、关系或承诺。",
    context: ["场景计划放在 work/outline/。", "已接受后果后续应进入 kb/。"],
    workflow: ["定义入场状态和离场状态。", "把场景拆成压力节拍。", "检查对白、动作和内心是否在重复承担同一个功能。"],
    output: ["场景节拍表。", "修订目标。", "连续性影响。"],
  }),
  adapterSkill({
    slug: "prose-critique",
    title: "正文批评",
    metadataName: "正文批评",
    description: "用于从读者体验、声线、结构和连续性角度批评草稿。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "为草稿或段落提供有对抗性但可执行的批评。",
    context: ["批评报告放在 work/critique-reports/。", "用 kb/ 区分 canon 错误和审美判断。"],
    workflow: ["识别段落目标。", "评估沉浸感、清晰度、具体性、声线、连续性和场景推进。", "按读者影响排列问题优先级。"],
    output: ["批评报告。", "最高优先级修订项。", "段落级例子。"],
  }),
  adapterSkill({
    slug: "style-analysis",
    title: "风格分析",
    metadataName: "风格分析",
    description: "用于分析正文样本，并创建或更新声线参考。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "从源文本中抽取可复用风格信号，不把它们压扁成泛泛形容词。",
    context: ["风格参考放在 kb/styles/。", "引用证据和推导建议要分开。"],
    workflow: ["读取代表性样本。", "测量 POV、叙述距离、节奏、措辞、对白、意象和段落习惯。", "写出具体的应该做和避免做规则。"],
    output: ["kb/styles/<style-name>.md。", "有证据支撑的风格笔记。", "仍缺失的样本。"],
  }),
  adapterSkill({
    slug: "story-architecture",
    title: "故事架构",
    metadataName: "故事架构",
    description: "用于塑造弧线、大纲结构、张力曲线或章节顺序。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "把故事意图转成持久结构，但不过早锁死低层场景。",
    context: ["大纲被接受前放在 work/outline/。", "Canon 事实放在 kb/canon/。"],
    workflow: ["澄清主角欲望、阻力、风险和转变。", "映射弧线和压力转折。", "记录假设和未解决结构选择。"],
    output: ["大纲产物。", "弧线图。", "决策记录。"],
  }),
  adapterSkill({
    slug: "story-context",
    title: "故事上下文",
    metadataName: "故事上下文",
    description: "用于为写作、批评或修订任务选择最小相关上下文。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "防止上下文过载，同时保留正确性所需全部事实。",
    context: ["kb/ 是持久记忆。", "work/ 是任务临时上下文。"],
    workflow: ["识别目标任务。", "选择相关 canon、人物、风格、时间线和当前草稿文件。", "明确排除无关材料。"],
    output: ["上下文包摘要。", "纳入文件。", "排除文件及原因。"],
  }),
  adapterSkill({
    slug: "brainstorming",
    title: "头脑风暴",
    metadataName: "头脑风暴",
    description: "用于在定稿前探索剧情、人物、世界或修订选项。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "生成多样选项，并附带清晰取舍和来源标记。",
    context: ["头脑风暴产物放在 work/brainstorm/。", "已接受决策后续必须进入 kb/ 或大纲文件。"],
    workflow: ["澄清创作问题。", "生成不同选项族。", "根据项目约束评估适配度。", "标记任何已接受方向。"],
    output: ["选项集合。", "带取舍的推荐。", "已接受决策记录。"],
  }),
  adapterSkill({
    slug: "kb-management",
    title: "知识库管理",
    metadataName: "知识库管理",
    description: "用于在起草、批评或决策后更新持久项目知识。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "让 kb/ 保持准确、简洁，并对未来写作会话有用。",
    context: ["kb/canon/ 存放已确立事实。", "kb/characters/ 存放人物档案和当前状态。", "kb/timeline/ 存放时间线。", "kb/issues/ 存放开放写作问题。"],
    workflow: ["只抽取明示或强暗示事实。", "更新范围最窄的相关 kb 页面。", "保留不确定性和来源引用。"],
    output: ["已更新 kb 文件。", "语义变化摘要。", "开放问题。"],
  }),
  adapterSkill({
    slug: "writing-artifacts",
    title: "写作产物归位",
    metadataName: "写作产物归位",
    description: "用于判断创作产物应该存放在项目哪个位置。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "把临时工作、已接受正文和持久知识放在不同位置。",
    context: ["story/chapters/ 是已接受正文。", "work/ 是临时草稿。", "kb/ 是持久知识。"],
    workflow: ["按生命周期分类产物。", "选择目标文件夹。", "避免同一个真相在多个持久文件中重复。"],
    output: ["产物路径决策。", "理由。", "需要的后续更新。"],
  }),
  adapterSkill({
    slug: "writing-issues",
    title: "写作问题追踪",
    metadataName: "写作问题追踪",
    description: "用于追踪反复出现的草稿问题和修订任务。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "让批评发现足够持久，可以跨多轮修订保留。",
    context: ["问题文件放在 kb/issues/。", "批评报告放在 work/critique-reports/。"],
    workflow: ["抽取问题、证据、严重度、所属文件和状态。", "能更新既有问题时优先更新。", "只有相关草稿已经改变时才关闭问题。"],
    output: ["问题条目。", "状态变化。", "下一步修订目标。"],
  }),
  adapterSkill({
    slug: "writing-staffing",
    title: "写作角色分工",
    metadataName: "写作角色分工",
    description: "用于判断一个任务应该由写作、批评、头脑风暴或知识维护等哪类角色处理。",
    attribution: CREATIVE_WRITING_ATTRIBUTION,
    purpose: "为创作任务选择最小可用的专业流程。",
    context: ["简单编辑优先直接执行。", "只有不同视角能真实降低风险时，才拆分角色。"],
    workflow: ["判断任务复杂度。", "选择写作、批评、读者模拟、连续性或知识维护角色。", "定义交接产物。"],
    output: ["推荐角色组合。", "任务边界。", "预期产物。"],
  }),
];

const SHORT_FORM_ATTRIBUTION = "Craft Agent 短篇写作配置";
const SHORT_FORM_SECTION_LABELS = {
  purpose: "用途",
  context: "项目上下文",
  workflow: "工作流程",
  output: "输出",
};

const SHORT_FORM_SKILLS = [
  adapterSkill({
    slug: "short-opening-designer",
    title: "短篇开篇设计",
    metadataName: "短篇开篇设计",
    description: "用于规划、诊断或修订中文短篇网文的第一屏、第一章开篇、开篇钩子，以及补全 简报.md 或 大纲.md 中的开篇设计。",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "在正文起草前设计第一屏留存结构。",
    sectionLabels: SHORT_FORM_SECTION_LABELS,
    context: [
      "存在 创作要求.md、简报.md、大纲.md、人物.md 时先读取。",
      "不要把已接受正文写入 正文/。",
      "需要比较多个开篇方案时使用 自由区/。",
    ],
    workflow: [
      "提取标题承诺、题材承诺、主角压力、关系压力和已知禁区。",
      "设计开篇结构：不可能事实、证据物、关系压力、不可逆代价、主角第一次选择、前三段推进和前 800 字追读问题。",
      "把已接受的开篇设计更新到 简报.md 和 大纲.md。",
      "如果需要多个方案，把比较记录写到 自由区/YYYYMMDD-开篇方案.md。",
    ],
    output: [
      "更新后的 简报.md 开篇部分。",
      "更新后的 大纲.md 第一章开篇节拍。",
      "可选的 自由区 开篇方案比较记录。",
    ],
  }),
  adapterSkill({
    slug: "short-golden-three",
    title: "黄金三章规划",
    metadataName: "黄金三章规划",
    description: "用于规划或修复中文短篇网文前三章的留存、升级、状态变化和兑现节奏。",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "把前提和开篇承诺转成第一章牵引、第二章加压、第三章锁读的执行方案。",
    sectionLabels: SHORT_FORM_SECTION_LABELS,
    context: [
      "简报.md 是作品 intake。",
      "大纲.md 是章节 outline。",
      "不要把已接受正文写入 正文/。",
    ],
    workflow: [
      "识别第一章牵引、第二章压力升级和第三章锁读点。",
      "检查每章是否都有状态变化、可见冲突和追读问题。",
      "更新 简报.md 和 大纲.md，不单独创建 黄金三章.md。",
    ],
    output: [
      "更新后的 简报.md 黄金三章部分。",
      "更新后的 大纲.md 前三章节拍。",
    ],
  }),
  adapterSkill({
    slug: "short-draft-chapter",
    title: "短篇章节起草",
    metadataName: "短篇章节起草",
    description: "用于在 简报.md 和 大纲.md 已有可执行规划后，起草中文短篇网文的当前下一章。",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "根据当前简报、大纲和人物起草一个可接受章节。",
    sectionLabels: SHORT_FORM_SECTION_LABELS,
    context: [
      "正文/ 只放已接受正文。",
      "自由区/ 放试验稿和废弃稿。",
      "默认每次只写一章，除非用户明确要求批量起草。",
    ],
    workflow: [
      "读取 创作要求.md、简报.md、大纲.md 和 人物.md。",
      "找到下一章规划，并确认 正文/ 中还没有同编号已接受章节。",
      "只把当前章节写入 正文/NN-标题.md。",
      "试写或替代开篇保留在 自由区/。",
    ],
    output: [
      "一个 正文/NN-标题.md 章节文件。",
      "未解决假设的简短说明。",
    ],
  }),
  adapterSkill({
    slug: "short-reviser",
    title: "短篇正文修订",
    metadataName: "短篇正文修订",
    description: "用于诊断或修订既有中文短篇网文章节的留存、冲突、节奏、兑现、开篇突兀或开篇无力问题。",
    attribution: SHORT_FORM_ATTRIBUTION,
    purpose: "根据项目简报和读者留存契约修订已接受正文或草稿。",
    sectionLabels: SHORT_FORM_SECTION_LABELS,
    context: [
      "对已有文件使用局部 patch 式修改。",
      "不要派生 草稿/ 或 定稿/ 目录。",
      "需要审校记录时放入 自由区/。",
    ],
    workflow: [
      "区分原文事实、推断的读者反应和修订建议。",
      "检查前 300-800 字是否具备压力、冲突、问题和后果。",
      "对目标章节做限定范围修订；如果用户只要求诊断，则输出审校记录。",
    ],
    output: [
      "修订后的章节文件或 自由区 审校记录。",
      "结构变化的简要说明。",
    ],
  }),
];

export function getBundledNovelSkillFiles(methodPackId: MethodPackId = "novel.claude-book"): BundledNovelSkillFile[] {
  if (methodPackId === "novel.oh-story") {
    return OH_STORY_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  if (methodPackId === "novel.crucible") {
    return CRUCIBLE_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  if (methodPackId === "novel.creative-writing") {
    return CREATIVE_WRITING_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  if (methodPackId === "short-form.article") {
    return SHORT_FORM_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    }));
  }

  return [
    ...CLAUDE_BOOK_SKILLS.map((skill) => ({
      relativePath: `${skill.slug}/SKILL.md`,
      content: skill.content,
    })),
    {
      relativePath: "NOTICE-Claude-Book.md",
      content: `${getClaudeBookNotice()}

原 Claude-Book 项目的 perplexity 分析在 Craft Agent 中故意保持为可选能力。它依赖本地 GPU/CUDA 类资源，只有已经安装并配置所需本地环境的项目才应启用。
`,
    },
  ];
}
