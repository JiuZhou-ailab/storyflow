# Storyflow Video Catalog API

内网只读服务：用详情表的 `video_list` 校验下载表的完整 OSS 分集，并按爬虫记录的 `hot_score` 提供当前 `/v1/rankings/daily`。
当前表不保存历史快照，因此不接受 `date` 查询；缺少热度字段时不伪造排序。
Files: `src/catalog_api.py`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `compose.yaml`.
