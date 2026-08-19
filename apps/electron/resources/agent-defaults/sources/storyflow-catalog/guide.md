# 爆款短剧数据

只读 MCP 数据源，返回数据库已观测到的短剧榜单、剧目和视频媒资。访问配置由 Storyflow 管理。

## 工具

- `catalog_sources`：列出榜单来源、视频来源及其当前能力。
- `ranking_snapshots`：列出榜单快照。
- `rankings`：按来源、口径、快照和关键词查询榜单。
- `video_assets`：按视频来源、剧目 ID 或关键词查询分集视频和素材，支持分页。
- `series_manifest`：返回已验证完整性的有序分集清单。

## 响应字段

- `source` 和 `sourceSeriesId`：来源内的剧目标识。
- `videoSources[].rankingSource`：与该视频来源共享剧目 ID 的榜单来源；无对应来源时为 `null`。
- `playbackUrl`：可播放地址。
- `downloadUrl`：可直接下载的文件地址；不可直接下载时为 `null`。
- `downloadMethod`：`direct`、`hls_remux` 或 `unavailable`。
- `variants`：同一媒资的清晰度、码率、编码和播放地址。
- `observedAt`：数据观测时间。

工具 schema 与实时返回数据是能力的最终事实来源。
