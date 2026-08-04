// input: Public Skills leaderboards and Storyflow's bundled/project Skill inventory
// output: Traceable featured recommendations with upstream provenance and dated popularity evidence
// pos: Human-reviewed discovery snapshot; never fabricates install bundles or marketplace download counts

export interface SkillRecommendation {
  order: number
  label: string
  sourceName: string
  sourceUrl: string
  snapshotAt: string
}

export interface CuratedSkill {
  slug: string
  displayName: string
  summary: string
  tags: string[]
  sourceName: string
  sourceUrl: string
  license: string
  recommendation: SkillRecommendation
}

const SNAPSHOT_AT = '2026-08-04'

function skillsSh(
  order: number,
  slug: string,
  repository: string,
  installs: string,
  displayName: string,
  summary: string,
  tags: string[],
): CuratedSkill {
  return {
    slug,
    displayName,
    summary,
    tags: ['通用热门', ...tags],
    sourceName: repository,
    sourceUrl: `https://www.skills.sh/${repository}/${slug}`,
    license: 'See upstream',
    recommendation: {
      order,
      label: `${installs} installs on skills.sh`,
      sourceName: 'skills.sh',
      sourceUrl: 'https://www.skills.sh/',
      snapshotAt: SNAPSHOT_AT,
    },
  }
}

function storyflow(
  order: number,
  slug: string,
  displayName: string,
  summary: string,
  tags: string[],
  sourcePath: string,
  label: string,
  license = 'Apache-2.0',
): CuratedSkill {
  return {
    slug,
    displayName,
    summary,
    tags: ['Storyflow', ...tags],
    sourceName: 'JiuZhou-ailab/storyflow',
    sourceUrl: `https://github.com/JiuZhou-ailab/storyflow/tree/main/${sourcePath}`,
    license,
    recommendation: {
      order,
      label,
      sourceName: 'Storyflow',
      sourceUrl: 'https://github.com/JiuZhou-ailab/storyflow',
      snapshotAt: SNAPSHOT_AT,
    },
  }
}

// Popularity is a dated discovery signal, not Storyflow Market download data.
// skills.sh supplies anonymous install telemetry; SkillHub Hot and SkillsMP were
// used as cross-checks for current relevance and repository provenance.
export const CURATED_SKILLS: readonly CuratedSkill[] = [
  skillsSh(1, 'find-skills', 'vercel-labs/skills', '2.8M', '发现 Skills',
    '按真实任务发现、比较并安装开放 Agent Skills。', ['发现', '生态']),
  skillsSh(2, 'grill-me', 'mattpocock/skills', '743.2K', '需求拷问',
    '在实现前系统暴露需求中的歧义、风险与隐含选择。', ['需求', '规划']),
  skillsSh(3, 'frontend-design', 'anthropics/skills', '736.7K', '前端设计',
    '为新页面和现有界面建立明确、克制且非模板化的视觉方向。', ['前端', '设计']),
  skillsSh(4, 'grill-with-docs', 'mattpocock/skills', '630.8K', '文档驱动拷问',
    '结合现有文档追问方案边界，并把关键决策沉淀为可维护上下文。', ['需求', '文档']),
  skillsSh(5, 'agent-browser', 'vercel-labs/agent-browser', '621.6K', '浏览器自动化',
    '通过浏览器执行页面交互、抓取、截图和端到端验收。', ['浏览器', '测试']),
  skillsSh(6, 'improve-codebase-architecture', 'mattpocock/skills', '607.5K', '代码库架构优化',
    '从真实依赖和职责边界识别架构问题并规划渐进式改进。', ['架构', '重构']),
  skillsSh(7, 'vercel-react-best-practices', 'vercel-labs/agent-skills', '603.3K', 'React 最佳实践',
    '按 Vercel 工程实践审查 React 与 Next.js 的性能和数据流。', ['React', 'Next.js']),
  skillsSh(8, 'tdd', 'mattpocock/skills', '585.6K', '测试驱动开发',
    '用最小失败检查驱动实现，并保持测试与可见行为一致。', ['测试', '开发']),
  skillsSh(9, 'web-design-guidelines', 'vercel-labs/agent-skills', '513.2K', 'Web 设计规范',
    '按现代 Web 设计、可访问性和交互规范审查界面实现。', ['Web', '可访问性']),
  skillsSh(10, 'handoff', 'mattpocock/skills', '502.2K', '任务交接',
    '把当前状态、证据、风险和下一步整理成可继续执行的交接。', ['协作', '上下文']),
  skillsSh(11, 'triage', 'mattpocock/skills', '500.1K', '问题分诊',
    '快速区分症状、根因、优先级和下一步验证路径。', ['诊断', '优先级']),
  skillsSh(12, 'prototype', 'mattpocock/skills', '484.9K', '快速原型',
    '用可丢弃原型验证高风险假设，并避免原型复杂度进入正式架构。', ['原型', '验证']),
  skillsSh(13, 'skill-creator', 'anthropics/skills', '338.6K', 'Skill Creator',
    '创建、评测、审阅和迭代高质量 Agent Skills。', ['Skill', '评测']),
  skillsSh(14, 'domain-modeling', 'mattpocock/skills', '316.1K', '领域建模',
    '明确领域实体、关系、约束和语言，减少业务逻辑漂移。', ['领域', '架构']),
  skillsSh(15, 'brainstorming', 'obra/superpowers', '308.9K', '头脑风暴',
    '在进入实现前探索目标、约束、备选方案和验收信号。', ['创意', '规划']),
  skillsSh(16, 'diagnosing-bugs', 'mattpocock/skills', '301.2K', 'Bug 诊断',
    '沿真实调用链收集证据，定位根因后再选择最小修复点。', ['诊断', '调试']),
  skillsSh(17, 'code-review', 'mattpocock/skills', '239.9K', '代码审查',
    '基于 diff、调用方和运行证据报告可操作的正确性问题。', ['审查', '质量']),
  skillsSh(18, 'research', 'mattpocock/skills', '220.4K', '研究',
    '把多来源材料转化为可追溯结论、分歧和后续验证。', ['研究', '证据']),
  skillsSh(19, 'systematic-debugging', 'obra/superpowers', '211.0K', '系统化调试',
    '以复现、假设、实验和验证四阶段避免随机试错。', ['调试', '根因']),
  skillsSh(20, 'writing-plans', 'obra/superpowers', '207.3K', '实施计划',
    '把已确认方案拆成有依赖顺序和验收信号的执行步骤。', ['规划', '执行']),

  storyflow(21, 'anysearch', 'AnySearch',
    '实时网页、垂直领域、批量搜索与 URL 内容提取；Storyflow 已配置安全鉴权路径。',
    ['搜索', '已鉴权'], 'apps/electron/resources/agent-defaults/global-skills/anysearch',
    'Storyflow 内置 · skills.sh 34.4K installs'),
  storyflow(22, 'sn2s-novel-to-screenplay', '小说转剧本',
    '将小说确定性拆分并转换为可续作、可校验的竖屏短剧分集项目。',
    ['小说', '短剧'], 'apps/electron/resources/agent-defaults/global-skills/sn2s-novel-to-screenplay',
    'Storyflow 内置'),
  storyflow(23, 'video-to-screenplay', '视频转剧本',
    '使用 Storyflow 登录态与 Gemini 视频理解，把连续短剧批量转换为标准分集剧本。',
    ['视频', '短剧', '已鉴权'], '.agents/skills/video-to-screenplay',
    'Storyflow 项目精品'),
  storyflow(24, 'discover-hit-dramas', '爆款短剧发现',
    '查询来源内榜单证据、历史快照和可直接转剧本的完整剧目。',
    ['短剧', '榜单', '已鉴权'], '.agents/skills/discover-hit-dramas',
    'Storyflow 项目精品'),
  storyflow(25, 'hot-video-script-ideation', '热点视频灵感',
    '把热点素材拆成可复用结构，并生成原创短视频故事引擎与大纲。',
    ['视频', '灵感'], '.agents/skills/hot-video-script-ideation',
    'Storyflow 项目精品'),
]
