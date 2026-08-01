# Short-drama Discovery

本上下文只表达“数据库已经观测到什么”以及“哪些媒资现在可直接进入视频转剧本”，不推断跨平台统一热度。

## Language

**Evidence Source**:
产生榜单观测的外部平台或数据产品，例如 Hongguo、GoodShort、ReelShort、DataEye。
_Avoid_: Table, database

**Ranking Kind**:
一个 Evidence Source 内部可解释的排名口径，例如平台日榜、周热榜或当前热度。
_Avoid_: Global hot score

**Ranking Snapshot**:
由 Evidence Source、Ranking Kind 与观测周期唯一标识的不可混排证据集合。
_Avoid_: Latest data without period

**Series Key**:
`source:sourceSeriesId` 组成的稳定剧目标识；只在同一 Evidence Source 内解释原始 id。
_Avoid_: Bare series id, title as identity

**Media Coverage**:
已声明、已发现、可播放及 OSS 分集数量，以及连续性和传输形态的事实集合。
_Avoid_: Ready boolean without evidence

**Conversion-ready Manifest**:
声明集数、连续分集与受支持文件媒资完全一致时才返回的有序输入清单。
_Avoid_: Partial URL list, signed HLS as downloadable file

**Source Adapter**:
唯一理解某个爬虫表结构并把它转换为上述领域对象的反腐层。
_Avoid_: SQL in Skill, generic arbitrary-query adapter

**Discovery Skill**:
通过 Storyflow 身份调用 Catalog API、解释结果并衔接视频转剧本的薄交互层。
_Avoid_: Database client, ranking implementation
