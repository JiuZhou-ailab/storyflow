# Catalog API Source

`catalog_domain.py` 定义稳定领域对象，`catalog_sources.py` 隔离爬虫表结构，`reelshort_search.py` 适配实时剧名搜索。
`catalog_api.py` 提供鉴权后的 v2 HTTP 契约并兼容 v1；`test_*.py` 覆盖发布所需的确定性契约。
