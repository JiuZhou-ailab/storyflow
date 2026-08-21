# @craft-agent/shared

跨宿主共享的业务契约与原语包。消费方包括 Electron 主进程/renderer、无头 server（server-core/server）、Pi agent 子进程等不同宿主形态。

## 目录职责

- `src/agent/` — Pi agent 运行时、传输边界、产品策略与 backend 契约
- `src/automations/` — 自动化系统：事件总线、匹配器、调度、handlers
- `src/auth/` — OAuth 与令牌管理
- `src/config/` — 配置/偏好/模型目录/存储
- `src/credentials/` — 加密凭据管理
- `src/i18n/` — 多语言注册表与翻译资源
- `src/labels/` / `src/statuses/` — 标签树与状态机契约
- `src/mcp/` — MCP 类型词汇表与连接校验（运行时连接池在 `@craft-agent/server-core/mcp`）
- `src/protocol/` — 进程间 RPC 通道与 DTO 契约
- `src/sessions/` — 会话持久化与索引
- `src/sources/` — 来源（MCP/API/local）类型、存储与服务端构建
- `src/views/` — ViewConfig 跨宿主类型契约（求值引擎在 electron，持久化在 server-core）
- `src/workspaces/` — workspace 路径、存储与应用上下文
- 其余 `utils/`、`colors/`、`icons/` 等为跨宿主工具原语

## 成员资格宪法

1. **进入门槛**：一个模块进入 shared，须有 ≥2 个异构消费者（不同宿主形态），且属于跨上下文契约或原语；仅单宿主使用的实现应留在该宿主包内。
2. **子域隔离**：领域子目录之间禁止互相 import，只能经显式接口（如 `mcp/types.ts` 的 `McpClientPoolLike`）。
3. **演进受控**：新增顶层子目录需先写 ADR 说明消费者与契约边界；迁出同理。
