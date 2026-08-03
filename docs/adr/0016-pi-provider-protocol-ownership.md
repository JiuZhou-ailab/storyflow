# ADR 0016: Pi 独占 Provider 协议所有权

## 状态

Accepted

## 背景

Pi 已按 provider `api` 实现请求体、历史消息、工具 schema 与流式响应解析。Storyflow 过去又在全局 `fetch` preload 中重写同一批数据，形成两个协议所有者；长会话、并行工具调用和兼容 endpoint 会因此积累不可恢复的历史形态差异。

## 决策

- **Provider Protocol**：请求体、历史、工具 schema、SSE 与 provider 兼容由 Pi 单独拥有。
- **Provider Registration**：Storyflow 只注册模型、认证、能力和用户自定义 endpoint，不改变其所选 Pi API 协议。
- **Provider Hook**：只允许显式、窄范围的请求头补充和响应状态诊断；不读写 body、history 或 stream。
- **Transport Proxy**：只根据 URL 和代理环境决定网络出口。
- **Tool Display Metadata**：在 Pi 生命周期事件之后由本地映射解析；不加入模型可见 schema。旧会话中的 `_intent` / `_displayName` 仅在执行边界防御性清理。
- **Prompt Cache**：使用 Pi 原生 `PI_CACHE_RETENTION`，不重写 provider 请求。

## 结果

自定义 provider 继续通过既有 `customEndpoint.api` 选择协议；Pi 升级协议实现时无需同步 Storyflow 的第二套解析器。代价是 provider 特有兼容必须上游修复或通过 Pi 的正式扩展点实现，不能再放入全局网络拦截层。
