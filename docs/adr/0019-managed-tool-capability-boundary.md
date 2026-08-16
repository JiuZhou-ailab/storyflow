# ADR 0019: 托管工具采用能力网关与本机代理边界

状态：Accepted
日期：2026-08-16

## 背景

Agent Skill、MCP 配置和 CLI 脚本是可分发的方法与调用入口，不适合承载共享的 Firecrawl、AnySearch 等供应商密钥。把供应商 key 下发给安装者会失去轮换、撤销、配额和审计边界；让每个 Skill 直接理解供应商鉴权，又会把运行时和分发契约耦合。现有 `web_search` 还会从 Pi 子进程环境读取 `ANYSEARCH_API_KEY` 并直连供应商，无法形成平台托管能力。

Firecrawl 官方 onboarding 的默认路径会安装 CLI/skills、打开供应商浏览器登录，并把 `FIRECRAWL_API_KEY` 交给调用环境；这适合个人开发者，但不满足 Storyflow 安装者零配置、平台统一维护 provider key 的产品契约。因此后续只能复用其方法层，不能原样采用其鉴权层。

## 决策

1. Identity Session 仍是唯一可持久化的账户事实。Auth Broker 仅按需用独立的 ES256 私钥签发短期 Managed Tool Capability；Tool Gateway 只持有公钥并验证独立的 audience 与 scope，不复用 Model Access 或 Skills Market 密钥，也不让 GitHub Actions 接触工具签名私钥。
2. Electron Host 持有 Managed Tool Capability 的进程内缓存。本机 Local Capability Broker 只绑定 loopback，并用每次进程启动随机生成的本机 capability 验证子进程。
3. 子进程和安装的 CLI 不获得云端 JWT。Local Capability Broker 代理明确列出的 Tool Operation，并在云端拒绝旧 token 时最多刷新重试一次。
4. Tool Gateway 暴露稳定、能力导向的产品路由：`POST /v1/search` 要求 `web:search`，由 AnySearch 适配；`POST /v1/scrape` 要求 `web:scrape`，由 Firecrawl 适配。供应商 API key 只存在于 Cloudflare Worker Secret。
5. Tool Gateway 以 JWT subject 和操作名使用独立的 Cloudflare Rate Limiting binding 保护共享供应商配额；普通搜索上限为每个 subject 每分钟 60 次，渲染提取为每分钟 10 次。
6. Tool Gateway 不是通用 HTTP 或 MCP 转发器。每个新增能力必须有独立输入校验、响应契约、scope、大小上限和超时；供应商更换不改变客户端操作名。
7. Pi 的内置 `web_search` 调用 Local Capability Broker。托管搜索不可用时，现有 DuckDuckGo provider 继续作为无凭证降级路径。
8. `web_search`、`web_fetch`、`web_scrape` 是三个独立产品能力：各自的工具提示词只描述自己的触发条件，不比较、委托或感知其他能力。`web_fetch` 继续在本机直接读取已知 URL；其余两项经过托管网关。
9. Skill Package 只描述何时和如何使用 Tool Operation。安装范围、发布市场和供应商鉴权互不拥有对方状态。

## 后果

- 用户安装或使用普通搜索方法时不再配置 AnySearch key；平台可在 Cloudflare 统一轮换供应商凭证。
- 任意安装脚本最多获得本机、进程期、操作受限的 capability，不能读取供应商 key 或云端 JWT。
- Firecrawl 接入只提供单 URL 的渲染后正文 Markdown；不把 crawl、map、batch 或结构化抽取提前暴露为产品能力。
- AnySearch 的 vertical、batch、extract 待真实产品操作明确后再添加。
- 面向外部用户开放前，必须确认供应商条款允许代调用或转售；技术上的密钥集中管理不替代商业授权。

## 非目标

- 不提供任意 URL 代理、任意 MCP method passthrough 或通用 secrets API。
- 不把 Provider Tool Credential 写入桌面配置、日志、Skill Package、MCP 配置或 CLI 环境。
- 不安装 Firecrawl 官方 onboarding Skill；默认分发的 Storyflow `firecrawl` Skill 只描述托管 `web_scrape` 的使用方法，不建立第三方插件运行时，也不提供站点级 crawl 或批处理接口。
