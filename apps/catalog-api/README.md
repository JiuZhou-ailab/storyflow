# Storyflow Video Catalog API

内网只读服务：把红果、GoodShort、ReelShort 与 DataEye 的异构爬虫表转换为来源内可解释的榜单快照、媒资覆盖度与完整分集清单。
`/v2` 是稳定业务契约；`/v1` 仅保留红果兼容。API 不提供 SQL、表名或跨来源伪统一热度。

- `GET /v2/catalog/sources`：来源能力与支持的榜单口径。
- `GET /v2/ranking-snapshots`：来源内可用快照。
- `GET /v2/rankings`：按来源分组的榜单条目与媒资覆盖度。
- `GET /v2/series/{source}/{sourceId}/manifest`：仅在分集完整且传输受支持时返回 URL。

所有查询参数采用白名单；`source=all` 只分组返回，不跨来源混排。
`compose.yaml` 同时部署 VPN 私网 MCP 与现有 Tunnel，私网访问不向桌面端分发应用层凭据；`compose.dokploy.yaml` 保留需要独立 Bearer 的公网中转部署。
GitHub 的 `Validate Catalog Data Source` workflow 只运行确定性服务契约测试；VPN 内 `/ready` 与 MCP 工具验收属于数据源自身发布流程，不阻塞桌面产品发版。
Files: `src/`, `mcp/`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `compose.yaml`, `compose.dokploy.yaml`.
