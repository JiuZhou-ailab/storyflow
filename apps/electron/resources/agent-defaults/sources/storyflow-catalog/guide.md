# 爆款短剧数据

只读 MCP 数据源，用于搜索 ReelShort、DramaBox 与 NetShort 的短剧，并获取剧目、分集和播放地址。

## 工具

- `short2api_health`：检查短剧服务是否可用。
- `short2api_providers`：列出支持的平台。
- `short2api_languages`：列出平台支持的语言代码。
- `short2api_search`：按平台、关键词和语言搜索短剧。
- `short2api_short_detail`：获取剧目信息和分集列表。
- `short2api_episode_detail`：获取单集信息和播放地址。

## 响应字段

- `platform` 和 `short_id`：平台及其剧目标识。
- `episode_id` 和 `serial_number`：分集标识和集数。
- `oss_url`：单集播放地址；不可用时为 `null`。

工具 schema 与实时返回数据是能力的最终事实来源。
