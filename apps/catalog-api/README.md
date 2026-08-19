# Storyflow Video Catalog API

内网只读服务：把红果、DramaBox、GoodShort、ReelShort 与 DataEye 的异构爬虫表转换为来源内可解释的榜单快照、媒资覆盖度、完整分集清单与有界视频资产。
`/v2` 是稳定业务契约；`/v1` 仅保留红果兼容。API 不提供 SQL、表名或跨来源伪统一热度。

- `GET /v2/catalog/sources`：榜单来源与视频资产来源能力。
- `GET /v2/video-assets`：按单一来源、剧目 ID 或标题分页查询视频；MP4 返回 `downloadUrl`，HLS 返回 `playbackUrl` 与 `downloadMethod=hls_remux`。
- `GET /v2/ranking-snapshots`：来源内可用快照。
- `GET /v2/rankings`：按来源分组的榜单条目与媒资覆盖度。
- `GET /v2/series/{source}/{sourceId}/manifest`：仅在分集完整且传输受支持时返回 URL。

所有查询参数采用白名单；全量视频访问通过分页的领域资产查询完成，不提供任意 SQL；`source=all` 榜单只分组返回，不跨来源混排。
`compose.yaml` 部署 Catalog、带 Bearer 校验的 MCP 与现有 Tunnel；MCP 通过外部 `storyflow-edge` Docker 网络接入统一网关，同时保留可配置的内网监听用于运维。
GitHub 的 `Validate Catalog Data Source` workflow 只运行确定性服务契约测试；VPN 内 `/ready` 与 MCP 工具验收属于数据源自身发布流程，不阻塞桌面产品发版。
Files: `src/`, `mcp/`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `compose.yaml`, `compose.dokploy.yaml`.
