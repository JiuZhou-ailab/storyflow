// input: Public-domain, open-licensed, and reference-only methodology research
// output: Curated marketplace catalog entries with provenance and project layout suggestions
// pos: Human-reviewable seed inventory; not a runtime registry or copied methodology corpus

export type Distribution = 'installable' | 'reference-only'

export interface MethodologySeed {
  slug: string
  displayName: string
  summary: string
  method: string
  roots: string[]
  tags: string[]
  sourceName: string
  sourceUrl: string
  license: string
  distribution: Distribution
  featured?: boolean
}

export const METHODOLOGY_SEEDS: readonly MethodologySeed[] = [
  {
    slug: 'world-system-map', displayName: '世界系统图',
    summary: '把世界中的实体、力量、关系与未知区域组织成可持续更新的系统地图。',
    method: '先列实体与外力，再用有方向的关系记录影响；每条关系注明证据、置信度和待验证问题。',
    roots: ['world/entities', 'world/forces', 'world/relations', 'world/maps'],
    tags: ['世界观', '系统思考'], sourceName: '18F System Map',
    sourceUrl: 'https://guides.18f.org/methods/discover/system-map/', license: 'CC0-1.0', distribution: 'installable', featured: true,
  },
  {
    slug: 'relationship-power-map', displayName: '人物权力关系图',
    summary: '从利益、影响力和依赖关系中识别人物冲突与联盟。',
    method: '为每个人物记录目标、资源、依赖和影响方向，优先寻找权力不对称与目标冲突。',
    roots: ['characters', 'characters/relations', 'characters/power', 'plot/conflicts'],
    tags: ['人物', '关系'], sourceName: '18F Stakeholder Influence Mapping',
    sourceUrl: 'https://guides.18f.org/methods/discover/stakeholder-influence-mapping/', license: 'CC0-1.0', distribution: 'installable', featured: true,
  },
  {
    slug: 'plain-language-editor', displayName: '清晰语言编辑',
    summary: '围绕读者行动，用常用词、主动表达和可扫描结构压缩文档。',
    method: '先写清读者与行动目标，再逐层检查信息顺序、标题、句长、主动表达和不必要术语。',
    roots: ['draft', 'reviews/clarity', 'style-guide'], tags: ['编辑', '文档'],
    sourceName: '18F Content Guide', sourceUrl: 'https://guides.18f.org/content-guide/our-approach/plain-language/',
    license: 'CC0-1.0', distribution: 'installable', featured: true,
  },
  {
    slug: 'evidence-sift', displayName: 'SIFT 证据核验',
    summary: '对网络断言先暂停，再核验来源、寻找更好报道并追溯原始上下文。',
    method: '为每条关键断言分别记录初始来源、来源声誉、替代报道、原始材料与最终判断。',
    roots: ['research/claims', 'research/sources', 'research/traces'], tags: ['研究', '事实核验'],
    sourceName: 'Web Literacy for Student Fact-Checkers', sourceUrl: 'https://pressbooks.pub/webliteracy/',
    license: 'CC-BY-4.0', distribution: 'installable', featured: true,
  },
  {
    slug: 'systematic-review-prisma', displayName: '系统综述流程',
    summary: '预先定义问题、筛选与综合协议，让研究过程完整可追溯。',
    method: '在检索前冻结问题和纳排标准，随后记录查询、去重、排除理由、质量判断与综合结果。',
    roots: ['research/protocol', 'research/search', 'research/screening', 'research/synthesis'], tags: ['研究', '综述'],
    sourceName: 'PRISMA 2020', sourceUrl: 'https://www.prisma-statement.org/prisma-2020',
    license: 'CC-BY-4.0', distribution: 'installable',
  },
  {
    slug: 'source-quality-check', displayName: '来源质量审查',
    summary: '从时效、相关性、权威性、准确性与目的记录来源采用理由。',
    method: '逐项记录五个维度的证据，明确采用、保留意见或拒绝，而不是只给来源一个总分。',
    roots: ['research/sources', 'research/audits', 'research/claims'], tags: ['研究', '来源'],
    sourceName: 'CSU Chico CRAAP Test', sourceUrl: 'https://library.csuchico.edu/sites/default/files/craap-test.pdf',
    license: 'Attribution required', distribution: 'installable',
  },
  {
    slug: 'reader-first-structure', displayName: '读者优先目录',
    summary: '从读者任务生成目录，把重要信息前置并拆成可扫描内容块。',
    method: '先列读者要完成的任务，按优先级形成目录；每个标题都描述结果，每块只服务一个任务。',
    roots: ['audience', 'content-map', 'draft', 'reviews/usability'], tags: ['文档', '信息架构'],
    sourceName: '18F Structure the Content', sourceUrl: 'https://guides.18f.org/content-guide/our-approach/structure-the-content/',
    license: 'CC0-1.0', distribution: 'installable', featured: true,
  },
  {
    slug: 'human-centered-loop', displayName: '人本发现循环',
    summary: '观察真实用户、综合需求、生成方案，再用反馈验证并循环修正。',
    method: '每轮只推进一个可验证假设：观察证据、综合洞察、做低成本原型、记录验证结果与下一轮变化。',
    roots: ['research/users', 'insights', 'concepts', 'prototypes', 'validation'], tags: ['产品', '用户研究'],
    sourceName: '18F Methods', sourceUrl: 'https://guides.18f.org/methods/about/', license: 'CC0-1.0', distribution: 'installable',
  },
  {
    slug: 'double-diamond', displayName: '双钻设计',
    summary: '对问题先发散收敛，对解法再次发散收敛，并保留阶段证据。',
    method: '分别管理发现、定义、发展、交付四个阶段；收敛点必须留下选择标准和被放弃方案。',
    roots: ['discover', 'define', 'develop', 'deliver'], tags: ['设计', '产品'],
    sourceName: 'Design Council Double Diamond', sourceUrl: 'https://www.designcouncil.org.uk/resources/the-double-diamond/',
    license: 'CC-BY-4.0', distribution: 'installable', featured: true,
  },
  {
    slug: 'systemic-design', displayName: '系统设计框架',
    summary: '把关系、愿景、领导与持续演化纳入复杂多主体设计。',
    method: '先建立系统方向和关系，再探索与重构问题，生成干预并记录它如何催化后续系统变化。',
    roots: ['orientation', 'system/explore', 'system/reframe', 'system/create', 'system/catalyse'], tags: ['设计', '系统思考'],
    sourceName: 'Design Council Systemic Design', sourceUrl: 'https://www.designcouncil.org.uk/resources/systemic-design-framework/',
    license: 'CC-BY-4.0', distribution: 'installable',
  },
  {
    slug: 'competing-hypothesis-matrix', displayName: '竞争假设矩阵',
    summary: '同时比较合理假设，让证据优先寻找不一致而非支持偏好。',
    method: '先列互斥或可竞争假设，再逐条判断证据与各假设的一致性；重点调查区分度最高的证据。',
    roots: ['analysis/hypotheses', 'analysis/evidence', 'analysis/judgments'], tags: ['分析', '决策'],
    sourceName: 'CIA Tradecraft Primer', sourceUrl: 'https://www.cia.gov/resources/csi/static/955180a45afe3f5013772c313b16face/Tradecraft-Primer-apr09.pdf',
    license: 'US-Public-Domain', distribution: 'installable', featured: true,
  },
  {
    slug: 'rapid-decision-loop', displayName: '快速决策循环',
    summary: '持续观察变化、更新情境模型、做出暂定决定并用行动产生新证据。',
    method: '把观察、判断、决定、行动作为持续循环；每次行动都明确预期信号和下一次重新判断条件。',
    roots: ['observations', 'orientation', 'decisions', 'actions'], tags: ['决策', '复盘'],
    sourceName: 'US Air University OODA', sourceUrl: 'https://www.airuniversity.af.edu/News/Display/Article/420819/ooda-loop-makes-its-mark-on-maxwell/',
    license: 'US-Public-Domain', distribution: 'installable',
  },
  {
    slug: 'after-action-learning', displayName: '行动后复盘',
    summary: '对照目标复原事实、解释差异、提炼经验并明确下一次改变。',
    method: '分别记录预期、事实、差异原因、可复用经验和有负责人的下一步动作，避免只写感想。',
    roots: ['reviews/context', 'reviews/outcomes', 'reviews/lessons', 'reviews/actions'], tags: ['复盘', '团队'],
    sourceName: 'U.S. Army After Action Review', sourceUrl: 'https://www.army.mil/article/17487/after_action_review_focuses_on_vanguard_oif_deployment',
    license: 'US-Public-Domain', distribution: 'installable', featured: true,
  },
  ...referenceOnlySeeds(),
]

function referenceOnlySeeds(): MethodologySeed[] {
  const entries: Array<[string, string, string, string[], string, string]> = [
    ['premise-snowball', '故事雪球', '从一句核心承诺逐层扩成角色、梗概和场景清单。', ['story/premise', 'story/synopsis', 'characters', 'plot/scenes'], 'Snowflake Method', 'https://www.advancedfictionwriting.com/articles/snowflake-method/'],
    ['return-change-arc', '归返成长环', '让角色因欲望进入未知、付出代价，并带着变化归返。', ['story/arc', 'plot/beats', 'characters/arcs'], 'Dan Harmon Story Circle', 'https://channel101.fandom.com/wiki/Story_Structure_101%3A_Super_Basic_Shit'],
    ['resolution-backward-plot', '结局逆推七点法', '先确定结局与终态，再逆推起点、转折与压力点。', ['story/ending', 'plot/turns', 'plot/pressure'], 'Writing Excuses Seven-Point Structure', 'https://writingexcuses.com/writing-excuses-7-41-seven-point-story-structure/'],
    ['narrative-thread-stack', '叙事线程栈', '识别叙事线程，并按后开先收检查闭合顺序。', ['plot/threads', 'plot/nesting', 'plot/closures'], 'Writing Excuses MICE', 'https://writingexcuses.com/tag/mice-quotient/'],
    ['action-reflection-cycle', '行动反思链', '交替组织目标受阻与反应决定，使场景自然产生下一目标。', ['plot/scenes', 'characters/reactions', 'plot/decisions'], 'Writing the Perfect Scene', 'https://www.advancedfictionwriting.com/articles/writing-the-perfect-scene/'],
    ['scene-causality-gate', '场景因果门', '检查触发、升级、两难、选择与余波，确保变化来自行动。', ['plot/scenes', 'plot/value-shifts', 'reviews/causality'], 'Story Grid Five Commandments', 'https://storygrid.com/five-commandments-of-storytelling/'],
    ['belief-desire-arc', '信念欲望弧', '连接错误信念、外在欲望、真实需要与关键选择。', ['characters/beliefs', 'characters/wants', 'characters/arcs', 'themes'], 'K.M. Weiland Character Arc', 'https://www.helpingwritersbecomeauthors.com/writing-glossary/'],
    ['constraint-first-magic', '限制优先魔法系统', '先定义理解边界、代价和限制，再扩展既有规则。', ['world/rules', 'world/costs', 'world/exceptions', 'plot/payoffs'], 'Sanderson Laws', 'https://faq.brandonsanderson.com/knowledge-base/what-are-sandersons-laws-of-magic/'],
    ['escalation-ladder', '尝试失败升级梯', '围绕同一目标设计性质不同、代价递增的尝试失败。', ['plot/goals', 'plot/attempts', 'plot/escalation'], 'Writing Excuses Try-Fail Cycle', 'https://writingexcuses.com/21-14-because-at-first-they-dont-succeed/'],
    ['reverse-outline', '反向提纲修订', '从现有正文抽取每段作用，再按整体目标重排合并。', ['draft', 'reviews/reverse-outline', 'revisions'], 'Purdue OWL Reverse Outlining', 'https://owl.purdue.edu/owl/graduate_writing/introduction_to_writing/documents/drafting-your-document/handouts/genre-analysis-activity.pdf'],
    ['progress-interview', '进展任务访谈', '还原用户在具体情境中试图取得的功能、情感和社会进展。', ['research/interviews', 'users/jobs', 'users/forces', 'opportunities'], 'Christensen Institute JTBD', 'https://www.christenseninstitute.org/theory/jobs-to-be-done/'],
    ['wardley-strategy-map', 'Wardley 战略地图', '从用户需要画出能力依赖链，再按演化判断战略动作。', ['strategy/users', 'strategy/value-chain', 'strategy/evolution', 'strategy/moves'], 'Wardley Mapping', 'https://learnwardleymapping.com/introduction/'],
    ['fixed-appetite-shaping', '固定投入塑形', '先固定投入周期，再塑造粗略但已解题且有边界的方案。', ['pitches', 'bets', 'cycles/current', 'cycles/cooldown'], 'Basecamp Shape Up', 'https://basecamp.com/shapeup/1.1-chapter-02'],
    ['reach-impact-priority', '影响优先级', '以覆盖、影响、置信度和投入形成可比较排序依据。', ['opportunities', 'priorities', 'evidence/confidence'], 'Intercom RICE', 'https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/'],
    ['decision-role-map', '决策角色图', '为每个决策明确唯一决策者及推动、贡献、知会角色。', ['decisions/open', 'decisions/records', 'stakeholders'], 'Atlassian DACI', 'https://www.atlassian.com/team-playbook/plays/daci'],
    ['architecture-decision-log', '架构决策记录', '记录背景、选择、状态与后果，并保留被替代决策。', ['decisions/proposed', 'decisions/accepted', 'decisions/superseded'], 'Michael Nygard ADR', 'https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions'],
    ['blameless-system-review', '无责系统复盘', '把注意力放到系统条件、恢复过程和预防措施。', ['incidents/timeline', 'incidents/impact', 'incidents/causes', 'incidents/actions'], 'Google SRE Postmortem Culture', 'https://sre.google/sre-book/postmortem-culture/'],
  ]
  return entries.map(([slug, displayName, summary, roots, sourceName, sourceUrl]) => ({
    slug, displayName, summary, method: summary, roots, tags: ['方法论', '待授权'],
    sourceName, sourceUrl, license: 'Reference only — redistribution not cleared', distribution: 'reference-only',
  }))
}
