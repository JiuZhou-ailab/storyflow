// input: Public Skills leaderboards and Storyflow's bundled/project Skill inventory
// output: Traceable featured recommendations plus pinned upstream package coordinates where redistribution is safe
// pos: Human-reviewed discovery snapshot and immutable allowlist for curated upstream installs

import type { StoryflowSkillManifest } from '@craft-agent/shared/skills/marketplace'

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
  package?: {
    installSlug?: string
    namespace: string
    sourceSlug: string
    version: string
    publishedAt: number
    archiveSha256: string
    bundleSha256: string
    objectKey: string
    /** Immutable manifest that produced bundleSha256; catalog display metadata may change independently. */
    manifest: StoryflowSkillManifest
  }
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
  packageMetadata?: CuratedSkill['package'],
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
    ...(packageMetadata ? { package: packageMetadata } : {}),
    recommendation: {
      order,
      label,
      sourceName: 'Storyflow',
      sourceUrl: 'https://github.com/JiuZhou-ailab/storyflow',
      snapshotAt: packageMetadata
        ? new Date(packageMetadata.publishedAt).toISOString().slice(0, 10)
        : SNAPSHOT_AT,
    },
  }
}

function skillHub(
  order: number,
  namespace: string,
  sourceSlug: string,
  packageMetadata: CuratedSkill['package'],
  downloads: string,
  favorites: string,
  rating: string,
  displayName: string,
  summary: string,
  tags: string[],
): CuratedSkill {
  return {
    slug: packageMetadata?.installSlug ?? sourceSlug,
    displayName,
    summary,
    tags: ['SkillHub', ...tags],
    sourceName: `@${namespace}/${sourceSlug}`,
    sourceUrl: `https://skillhub.cn/skills/${namespace}/${sourceSlug}`,
    license: 'See upstream',
    ...(packageMetadata ? { package: packageMetadata } : {}),
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
    'Storyflow 内置', {
      namespace: 'storyflow', sourceSlug: 'sn2s-novel-to-screenplay', version: '1.0.0', publishedAt: 1786017600000,
      archiveSha256: '508623df136e6363ef8714cb799ceb97afff1ac86d90498fa946580b906b8fe0',
      bundleSha256: 'd936bbcd6ef148955aefb4ae43c1bcc6b7a0f828e1c4b20f254a265a485ea57f',
      objectKey: 'curated/storyflow/sn2s-novel-to-screenplay/1.0.0/508623df136e6363ef8714cb799ceb97afff1ac86d90498fa946580b906b8fe0.zip',
      manifest: {
        schemaVersion: 1, slug: 'sn2s-novel-to-screenplay', version: '1.0.0', displayName: '小说转剧本',
        summary: '将小说确定性拆分并转换为可续作、可校验的竖屏短剧分集项目。', license: 'Apache-2.0',
        author: { name: 'JiuZhou-ailab/storyflow', url: 'https://github.com/JiuZhou-ailab/storyflow/tree/main/apps/electron/resources/agent-defaults/global-skills/sn2s-novel-to-screenplay' },
        tags: ['Storyflow', '小说', '短剧'],
        methodology: { sourceName: 'Storyflow', sourceUrl: 'https://github.com/JiuZhou-ailab/storyflow', adaptation: 'Pinned upstream package 1.0.0' },
      },
    }),
  storyflow(2, 'video-to-screenplay', '视频转剧本',
    '使用 Storyflow 登录态与 Gemini 视频理解，把连续短剧批量转换为标准分集剧本。',
    ['视频', '短剧', '已鉴权'], null,
    'Storyflow 项目精品', {
      namespace: 'storyflow', sourceSlug: 'video-to-screenplay', version: '1.0.0', publishedAt: 1786017600000,
      archiveSha256: 'cb0aad4d34ad8e2c168bab876521415a62a1d5f0e4bd32dd1583a0293f6e5d04',
      bundleSha256: 'edf05772a847c31a7242994690a1f5822ab244ad84cadf7e6c4e72b756a12256',
      objectKey: 'curated/storyflow/video-to-screenplay/1.0.0/cb0aad4d34ad8e2c168bab876521415a62a1d5f0e4bd32dd1583a0293f6e5d04.zip',
      manifest: {
        schemaVersion: 1, slug: 'video-to-screenplay', version: '1.0.0', displayName: '视频转剧本',
        summary: '使用 Storyflow 登录态与 Gemini 视频理解，把连续短剧批量转换为标准分集剧本。', license: 'Apache-2.0',
        author: { name: 'JiuZhou-ailab/storyflow', url: 'https://github.com/JiuZhou-ailab/storyflow/tree/main/.agents/skills/video-to-screenplay' },
        tags: ['Storyflow', '视频', '短剧', '已鉴权'],
        methodology: { sourceName: 'Storyflow', sourceUrl: 'https://github.com/JiuZhou-ailab/storyflow', adaptation: 'Pinned upstream package 1.0.0' },
      },
    }),
  storyflow(3, 'hot-video-script-ideation', '热点视频灵感',
    '把热点素材拆成可复用结构，并生成原创短视频故事引擎与大纲。',
    ['视频', '灵感'], null,
    'Storyflow 项目精品', {
      namespace: 'storyflow', sourceSlug: 'hot-video-script-ideation', version: '1.0.0', publishedAt: 1786017600000,
      archiveSha256: '74316ea2e07bbf2a8c67ab6872b704b020b0c368ddea76b6fe64f4f13b9be358',
      bundleSha256: '328ea266c70d8363fc0687136ffd64c849e8a578d06125ecdd66517e84c29af4',
      objectKey: 'curated/storyflow/hot-video-script-ideation/1.0.0/74316ea2e07bbf2a8c67ab6872b704b020b0c368ddea76b6fe64f4f13b9be358.zip',
      manifest: {
        schemaVersion: 1, slug: 'hot-video-script-ideation', version: '1.0.0', displayName: '热点视频灵感',
        summary: '把热点素材拆成可复用结构，并生成原创短视频故事引擎与大纲。', license: 'Apache-2.0',
        author: { name: 'JiuZhou-ailab/storyflow', url: 'https://github.com/JiuZhou-ailab/storyflow/tree/main/.agents/skills/hot-video-script-ideation' },
        tags: ['Storyflow', '视频', '灵感'],
        methodology: { sourceName: 'Storyflow', sourceUrl: 'https://github.com/JiuZhou-ailab/storyflow', adaptation: 'Pinned upstream package 1.0.0' },
      },
    }),
  storyflow(4, 'web-research', '网页研究',
    '使用 Storyflow 托管网页能力搜索最新信息并形成可追溯结论。',
    ['搜索', '研究', '已鉴权'], 'apps/skills-market/curated/web-research',
    'Storyflow 托管能力', {
      namespace: 'storyflow', sourceSlug: 'web-research', version: '1.0.0', publishedAt: 1786838400000,
      archiveSha256: '1251b5f87aecc6df23baa51603d5a6c382ee455a1a8f697ef7588149a2d4b27a',
      bundleSha256: '6ba5f0267fe8ca22f841290dba8273a0d3474b7efaaf658526ee7c9b5e28da0f',
      objectKey: 'curated/storyflow/web-research/1.0.0/1251b5f87aecc6df23baa51603d5a6c382ee455a1a8f697ef7588149a2d4b27a.zip',
      manifest: {
        schemaVersion: 1, slug: 'web-research', version: '1.0.0', displayName: '网页研究',
        summary: '使用 Storyflow 托管网页能力搜索最新信息并形成可追溯结论。', license: 'Apache-2.0',
        author: { name: 'JiuZhou-ailab/storyflow', url: 'https://github.com/JiuZhou-ailab/storyflow/tree/main/apps/skills-market/curated/web-research' },
        tags: ['Storyflow', '搜索', '研究', '已鉴权'],
        methodology: { sourceName: 'Storyflow', sourceUrl: 'https://github.com/JiuZhou-ailab/storyflow', adaptation: 'Pinned upstream package 1.0.0' },
      },
    }),

  skillHub(5, 'user_634bbcdc', 'g113593', {
    installSlug: 'tomato-novelist', namespace: 'user_634bbcdc', sourceSlug: 'g113593',
    version: '1.0.5', publishedAt: 1776184402155,
    archiveSha256: '9c4f65bcf68d32146469bc46872287deb5ef2f22d111a66fb27a9fba51649f10',
    bundleSha256: 'bf68ffd7d094e70a9c5358f5db3f895fe2d852937edf0c706b4ea90bfd61cc59',
    objectKey: 'curated/skillhub/user_634bbcdc/g113593/1.0.5/9c4f65bcf68d32146469bc46872287deb5ef2f22d111a66fb27a9fba51649f10.zip',
    manifest: {
      schemaVersion: 1, slug: 'tomato-novelist', version: '1.0.5', displayName: '番茄小说写作助手',
      summary: '面向番茄小说的长篇分章工作流，覆盖黄金开篇、情绪曲线、章节钩子和阶段性数据反馈。', license: 'See upstream',
      author: { name: '@user_634bbcdc/g113593', url: 'https://skillhub.cn/skills/user_634bbcdc/g113593' },
      tags: ['SkillHub', '小说', '网文', '番茄'],
      methodology: { sourceName: 'SkillHub', sourceUrl: 'https://skillhub.cn/', adaptation: 'Pinned upstream package 1.0.5' },
    },
  }, '2.3 万', '253', '4.4',
    '番茄小说写作助手',
    '面向番茄小说的长篇分章工作流，覆盖黄金开篇、情绪曲线、章节钩子和阶段性数据反馈。',
    ['小说', '网文', '番茄']),
  skillHub(6, 'user_7ca3a4d6', 'fiction-crafter', {
    namespace: 'user_7ca3a4d6', sourceSlug: 'fiction-crafter', version: '1.1.0', publishedAt: 1775639701323,
    archiveSha256: 'a6d1c215b8627bd2aa1885c9fc394d3d464acfb6b110b890fce4ea82ac0ecfdf',
    bundleSha256: 'cba93ffea134cb3abc0565fa9ec1b479b3c7f6827bb578a3bd072420dc9f4ed7',
    objectKey: 'curated/skillhub/user_7ca3a4d6/fiction-crafter/1.1.0/a6d1c215b8627bd2aa1885c9fc394d3d464acfb6b110b890fce4ea82ac0ecfdf.zip',
    manifest: {
      schemaVersion: 1, slug: 'fiction-crafter', version: '1.1.0', displayName: '小说工匠 Fiction Crafter',
      summary: '从大纲和卷级规划逐章创作长篇爽文，并维护人物、地点、伏笔和剧情连续性。', license: 'See upstream',
      author: { name: '@user_7ca3a4d6/fiction-crafter', url: 'https://skillhub.cn/skills/user_7ca3a4d6/fiction-crafter' },
      tags: ['SkillHub', '小说', '长篇', '连续性'],
      methodology: { sourceName: 'SkillHub', sourceUrl: 'https://skillhub.cn/', adaptation: 'Pinned upstream package 1.1.0' },
    },
  }, '9.2 千', '70', '4.3',
    '小说工匠 Fiction Crafter',
    '从大纲和卷级规划逐章创作长篇爽文，并维护人物、地点、伏笔和剧情连续性。',
    ['小说', '长篇', '连续性']),
  skillHub(7, 'user_a75e6679', 'novel-evaluator', {
    namespace: 'user_a75e6679', sourceSlug: 'novel-evaluator', version: '1.0.0', publishedAt: 1775545899274,
    archiveSha256: '435ab8c8bed2180c01a46de9490d5a67e5e6a6106f81235337d8788adb4eafe0',
    bundleSha256: '9d43c6b1578f6037639a6973088ac7eb63dc12b13df27b68614b4ea063bb4374',
    objectKey: 'curated/skillhub/user_a75e6679/novel-evaluator/1.0.0/435ab8c8bed2180c01a46de9490d5a67e5e6a6106f81235337d8788adb4eafe0.zip',
    manifest: {
      schemaVersion: 1, slug: 'novel-evaluator', version: '1.0.0', displayName: '小说评分系统',
      summary: '从情节、人物、文笔、世界观、情感和创新六个维度审阅小说并给出可执行反馈。', license: 'See upstream',
      author: { name: '@user_a75e6679/novel-evaluator', url: 'https://skillhub.cn/skills/user_a75e6679/novel-evaluator' },
      tags: ['SkillHub', '小说', '评审', '质量'],
      methodology: { sourceName: 'SkillHub', sourceUrl: 'https://skillhub.cn/', adaptation: 'Pinned upstream package 1.0.0' },
    },
  }, '6.8 千', '34', '4.4',
    '小说评分系统',
    '从情节、人物、文笔、世界观、情感和创新六个维度审阅小说并给出可执行反馈。',
    ['小说', '评审', '质量']),
  skillHub(8, 'user_f0835403', 'novel-to-drama', {
    namespace: 'user_f0835403', sourceSlug: 'novel-to-drama', version: '1.0.1', publishedAt: 1782627874964,
    archiveSha256: '128f558f27b97c36c9021458d2bc462e1e0347d5a009e358a144009e3ba42ecd',
    bundleSha256: '30ec54dc4e703a5bba7c4b6c39aa483f0c1d8ab6b0d27f87acda4f1d8adb4380',
    objectKey: 'curated/skillhub/user_f0835403/novel-to-drama/1.0.1/128f558f27b97c36c9021458d2bc462e1e0347d5a009e358a144009e3ba42ecd.zip',
    manifest: {
      schemaVersion: 1, slug: 'novel-to-drama', version: '1.0.1', displayName: '小说转剧本',
      summary: '把网络小说片段改编为高密度、强情绪、强钩子的红果短剧拍摄剧本，并支持剧本审核。', license: 'See upstream',
      author: { name: '@user_f0835403/novel-to-drama', url: 'https://skillhub.cn/skills/user_f0835403/novel-to-drama' },
      tags: ['SkillHub', '小说', '短剧', '改编'],
      methodology: { sourceName: 'SkillHub', sourceUrl: 'https://skillhub.cn/', adaptation: 'Pinned upstream package 1.0.1' },
    },
  }, '2.6 千', '18', '4.4',
    '小说转剧本',
    '把网络小说片段改编为高密度、强情绪、强钩子的红果短剧拍摄剧本，并支持剧本审核。',
    ['小说', '短剧', '改编']),
  skillHub(9, 'user_5b12983f', 'novel-to-storyboard', {
    namespace: 'user_5b12983f', sourceSlug: 'novel-to-storyboard', version: '1.0.0', publishedAt: 1777341101704,
    archiveSha256: '1e78f2b805c61708e84d4c39a3b25d15af9fb0a3ad961bb191817457f225ed71',
    bundleSha256: 'cb89c1fc36543628d3462605460bafb1223a746e1b895cbf7fbd73194f31e429',
    objectKey: 'curated/skillhub/user_5b12983f/novel-to-storyboard/1.0.0/1e78f2b805c61708e84d4c39a3b25d15af9fb0a3ad961bb191817457f225ed71.zip',
    manifest: {
      schemaVersion: 1, slug: 'novel-to-storyboard', version: '1.0.0', displayName: '剧本转分镜',
      summary: '将小说或剧本文案拆成分镜脚本，同时提取角色特征卡和场景特征卡。', license: 'See upstream',
      author: { name: '@user_5b12983f/novel-to-storyboard', url: 'https://skillhub.cn/skills/user_5b12983f/novel-to-storyboard' },
      tags: ['SkillHub', '剧本', '分镜', '短视频'],
      methodology: { sourceName: 'SkillHub', sourceUrl: 'https://skillhub.cn/', adaptation: 'Pinned upstream package 1.0.0' },
    },
  }, '2.7 千', '31', '4.5',
    '剧本转分镜',
    '将小说或剧本文案拆成分镜脚本，同时提取角色特征卡和场景特征卡。',
    ['剧本', '分镜', '短视频']),

  skillsSh(10, 'find-skills', 'vercel-labs/skills', '2.8M', '发现 Skills',
    '按真实任务发现、比较并安装开放 Agent Skills。', ['发现', '生态']),
  skillsSh(11, 'grill-me', 'mattpocock/skills', '743.2K', '需求拷问',
    '在实现前系统暴露需求中的歧义、风险与隐含选择。', ['需求', '规划']),
  skillsSh(12, 'research', 'mattpocock/skills', '220.4K', '研究',
    '把多来源材料转化为可追溯结论、分歧和后续验证。', ['研究', '证据']),
  skillsSh(13, 'brainstorming', 'obra/superpowers', '308.9K', '头脑风暴',
    '在进入实现前探索目标、约束、备选方案和验收信号。', ['创意', '规划']),
  skillsSh(14, 'skill-creator', 'anthropics/skills', '338.6K', 'Skill Creator',
    '创建、评测、审阅和迭代高质量 Agent Skills。', ['Skill', '评测']),
]
