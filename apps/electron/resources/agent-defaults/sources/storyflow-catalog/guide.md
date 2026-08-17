# 爆款短剧数据

爆款短剧数据是只读短剧调研数据源。它返回爬虫数据库已经观测到的榜单、剧目身份和媒资覆盖事实；不触发爬取、下载、转码或内容生成。

使用前连接公司 VPN，并在数据源设置中保存共享 Bearer Token。Token 只进入 Storyflow 的加密凭据存储；不要写入项目、Skill 或聊天消息。

## 领域对象

- **Evidence Source**：产生榜单观测的外部平台或数据产品。目前包括 `hongguo`、`goodshort`、`reelshort`、`dataeye`。
- **Ranking Kind**：一个来源内部可解释的榜单口径。
- **Ranking Snapshot**：来源、榜单口径和观测周期共同标识的证据集合。
- **Series Key**：`source:sourceSeriesId` 组成的稳定剧目标识。
- **Media Coverage**：声明集数、已发现元数据、可播放媒资、OSS 文件、连续性和传输形态。
- **Conversion-ready Manifest**：只有完整、连续且传输形态受支持时才提供的有序分集输入。

## 工具

### `catalog_sources`

开始调研或不确定来源能力时先调用。读取每个来源的：

- 默认和可用 `rankingKinds`；
- `supportsHistory`；
- `supportsManifest`。

### `ranking_snapshots`

列出单一来源、单一榜单口径的可用快照。只有明确需要历史数据且 `supportsHistory=true` 时调用；否则使用 `latest`。

### `rankings`

查询来源内榜单：

- `source=all` 只用于并列展示不同来源的最新结果；不能指定 `rankingKind`，不能把不同来源的指标混合、归一化或重新排名。
- 研究一个平台时明确传入 `source`，必要时再传 `rankingKind`、`snapshot`、`query`。
- `conversionReady="true"` 只表示筛选当前可直接转剧本的媒资，不是热度条件。
- 每次先用较小 `limit` 验证口径，再按需要扩大，最大 100。

### `series_manifest`

只在用户已经选定剧目并要进入视频转剧本时调用。使用结果中的 `series.key` 拆出 `source` 和 `sourceId`；不要根据标题猜 ID。

## 调研方法

1. **明确问题**：先确认用户要研究的平台、榜单口径、时间范围和候选数量。缺失信息只在会改变结论时追问。
2. **确认能力**：调用 `catalog_sources`，不要假设某来源有历史快照或完整视频。
3. **固定证据边界**：确定 Evidence Source、Ranking Kind 和 Snapshot 后再取榜单。
4. **来源内解释**：只使用返回的 `rank` 和原始 `metrics`。不同来源的阅读、热度、消耗、素材量不可互相换算。
5. **检查新鲜度**：报告 `periodStart`、`periodEnd` 和 `observedAt`。没有观测时间时明确说明，不把 `latest` 当作“今天”。
6. **检查媒资**：结合声明集数、元数据集数、可播放集数、OSS 集数、连续性、`delivery` 和 `reasons` 解释 `status`。
7. **形成结论**：区分数据库事实和推断；指出样本范围、缺失字段和不能回答的问题。
8. **按需衔接**：只有 `conversionReady=true` 才取得 manifest 并交给视频转剧本流程。

## 来源限制

- `hongguo`：当前热榜；是否可转剧本以实际 `Media Coverage` 为准。
- `goodshort`：平台日榜；当前不承诺历史和 manifest。
- `reelshort`：平台日榜；当前不承诺历史和 manifest。`signed_hls` 不是可直接下载的文件媒资。
- `dataeye`：支持其明确返回的周榜历史；不可与平台日榜合成统一热度。

## 输出要求

调研回答至少包含：

- 来源与榜单口径；
- 快照周期和观测时间；
- 候选剧目的来源内排名及原始指标；
- 媒资覆盖状态及不可转换原因；
- 数据缺口和推断边界。

不要输出爬虫物理表名、SQL、数据库凭据或未由接口返回的视频 URL。
