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
  sourceUrl?: string
  license: string
  recommendation: SkillRecommendation
}

const SNAPSHOT_AT = '2026-08-04'
const SKILLHUB_SNAPSHOT_AT = '2026-08-05'

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
  sourcePath: string | null,
  label: string,
  license = 'Apache-2.0',
): CuratedSkill {
  return {
    slug,
    displayName,
    summary,
    tags: ['Storyflow', ...tags],
    sourceName: 'JiuZhou-ailab/storyflow',
    ...(sourcePath ? { sourceUrl: `https://github.com/JiuZhou-ailab/storyflow/tree/main/${sourcePath}` } : {}),
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

function skillHub(
  order: number,
  namespace: string,
  slug: string,
  downloads: string,
  favorites: string,
  rating: string,
  displayName: string,
  summary: string,
  tags: string[],
): CuratedSkill {
  return {
    slug,
    displayName,
    summary,
    tags: ['SkillHub', ...tags],
    sourceName: `@${namespace}/${slug}`,
    sourceUrl: `https://skillhub.cn/skills/${namespace}/${slug}`,
    license: 'See upstream',
    recommendation: {
      order,
      label: `${downloads} 次下载 · ${favorites} 次收藏 · AI 评分 ${rating}/5`,
      sourceName: 'SkillHub',
      sourceUrl: 'https://skillhub.cn/',
      snapshotAt: SKILLHUB_SNAPSHOT_AT,
    },
  }
}

// Popularity is a dated discovery signal, not Storyflow Market download data.
// skills.sh and SkillHub supply their own popularity and quality signals.
export const CURATED_SKILLS: readonly CuratedSkill[] = [
  storyflow(1, 'sn2s-novel-to-screenplay', '小说转剧本',
    '将小说确定性拆分并转换为可续作、可校验的竖屏短剧分集项目。',
    ['小说', '短剧'], 'apps/electron/resources/agent-defaults/global-skills/sn2s-novel-to-screenplay',
    'Storyflow 内置'),
  storyflow(2, 'video-to-screenplay', '视频转剧本',
    '使用 Storyflow 登录态与 Gemini 视频理解，把连续短剧批量转换为标准分集剧本。',
    ['视频', '短剧', '已鉴权'], null,
    'Storyflow 项目精品'),
  storyflow(3, 'discover-hit-dramas', '爆款短剧发现',
    '查询来源内榜单证据、历史快照和可直接转剧本的完整剧目。',
    ['短剧', '榜单', '已鉴权'], null,
    'Storyflow 项目精品'),
  storyflow(4, 'hot-video-script-ideation', '热点视频灵感',
    '把热点素材拆成可复用结构，并生成原创短视频故事引擎与大纲。',
    ['视频', '灵感'], null,
    'Storyflow 项目精品'),
  storyflow(5, 'anysearch', 'AnySearch',
    '实时网页、垂直领域、批量搜索与 URL 内容提取；Storyflow 已配置安全鉴权路径。',
    ['搜索', '已鉴权'], 'apps/electron/resources/agent-defaults/global-skills/anysearch',
    'Storyflow 内置 · skills.sh 34.4K installs'),

  skillHub(6, 'user_634bbcdc', 'g113593', '2.3 万', '253', '4.4',
    '番茄小说写作助手',
    '面向番茄小说的长篇分章工作流，覆盖黄金开篇、情绪曲线、章节钩子和阶段性数据反馈。',
    ['小说', '网文', '番茄']),
  skillHub(7, 'user_7ca3a4d6', 'fiction-crafter', '9.2 千', '70', '4.3',
    '小说工匠 Fiction Crafter',
    '从大纲和卷级规划逐章创作长篇爽文，并维护人物、地点、伏笔和剧情连续性。',
    ['小说', '长篇', '连续性']),
  skillHub(8, 'user_a75e6679', 'novel-evaluator', '6.8 千', '34', '4.4',
    '小说评分系统',
    '从情节、人物、文笔、世界观、情感和创新六个维度审阅小说并给出可执行反馈。',
    ['小说', '评审', '质量']),
  skillHub(9, 'user_f0835403', 'novel-to-drama', '2.6 千', '18', '4.4',
    '小说转剧本',
    '把网络小说片段改编为高密度、强情绪、强钩子的红果短剧拍摄剧本，并支持剧本审核。',
    ['小说', '短剧', '改编']),
  skillHub(10, 'user_5b12983f', 'novel-to-storyboard', '2.7 千', '31', '4.5',
    '剧本转分镜',
    '将小说或剧本文案拆成分镜脚本，同时提取角色特征卡和场景特征卡。',
    ['剧本', '分镜', '短视频']),

  skillsSh(11, 'find-skills', 'vercel-labs/skills', '2.8M', '发现 Skills',
    '按真实任务发现、比较并安装开放 Agent Skills。', ['发现', '生态']),
  skillsSh(12, 'grill-me', 'mattpocock/skills', '743.2K', '需求拷问',
    '在实现前系统暴露需求中的歧义、风险与隐含选择。', ['需求', '规划']),
  skillsSh(13, 'research', 'mattpocock/skills', '220.4K', '研究',
    '把多来源材料转化为可追溯结论、分歧和后续验证。', ['研究', '证据']),
  skillsSh(14, 'brainstorming', 'obra/superpowers', '308.9K', '头脑风暴',
    '在进入实现前探索目标、约束、备选方案和验收信号。', ['创意', '规划']),
  skillsSh(15, 'skill-creator', 'anthropics/skills', '338.6K', 'Skill Creator',
    '创建、评测、审阅和迭代高质量 Agent Skills。', ['Skill', '评测']),
]
