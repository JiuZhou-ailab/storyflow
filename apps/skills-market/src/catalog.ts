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
  storyflow(1, 'sn2s-novel-to-screenplay', '小说转剧本',
    '将小说确定性拆分并转换为可续作、可校验的竖屏短剧分集项目。',
    ['小说', '短剧'], 'apps/electron/resources/agent-defaults/global-skills/sn2s-novel-to-screenplay',
    'Storyflow 内置'),
  storyflow(2, 'video-to-screenplay', '视频转剧本',
    '使用 Storyflow 登录态与 Gemini 视频理解，把连续短剧批量转换为标准分集剧本。',
    ['视频', '短剧', '已鉴权'], '.agents/skills/video-to-screenplay',
    'Storyflow 项目精品'),
  storyflow(3, 'discover-hit-dramas', '爆款短剧发现',
    '查询来源内榜单证据、历史快照和可直接转剧本的完整剧目。',
    ['短剧', '榜单', '已鉴权'], '.agents/skills/discover-hit-dramas',
    'Storyflow 项目精品'),
  storyflow(4, 'hot-video-script-ideation', '热点视频灵感',
    '把热点素材拆成可复用结构，并生成原创短视频故事引擎与大纲。',
    ['视频', '灵感'], '.agents/skills/hot-video-script-ideation',
    'Storyflow 项目精品'),
  storyflow(5, 'anysearch', 'AnySearch',
    '实时网页、垂直领域、批量搜索与 URL 内容提取；Storyflow 已配置安全鉴权路径。',
    ['搜索', '已鉴权'], 'apps/electron/resources/agent-defaults/global-skills/anysearch',
    'Storyflow 内置 · skills.sh 34.4K installs'),

  skillsSh(6, 'find-skills', 'vercel-labs/skills', '2.8M', '发现 Skills',
    '按真实任务发现、比较并安装开放 Agent Skills。', ['发现', '生态']),
  skillsSh(7, 'grill-me', 'mattpocock/skills', '743.2K', '需求拷问',
    '在实现前系统暴露需求中的歧义、风险与隐含选择。', ['需求', '规划']),
  skillsSh(8, 'research', 'mattpocock/skills', '220.4K', '研究',
    '把多来源材料转化为可追溯结论、分歧和后续验证。', ['研究', '证据']),
  skillsSh(9, 'brainstorming', 'obra/superpowers', '308.9K', '头脑风暴',
    '在进入实现前探索目标、约束、备选方案和验收信号。', ['创意', '规划']),
  skillsSh(10, 'skill-creator', 'anthropics/skills', '338.6K', 'Skill Creator',
    '创建、评测、审阅和迭代高质量 Agent Skills。', ['Skill', '评测']),
]
