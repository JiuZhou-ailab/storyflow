# ADR 0012: 内嵌临时 Subagent Run

状态：Accepted
日期：2026-07-29

Storyflow 通过 Pi Extension API 提供内建 `subagent` 工具，但每个 Subagent Run 都由同一 Agent Kernel 内嵌创建、使用内存会话，并由 Host 固定 Capability Profile、并发、权限、取消和 usage；它不创建持久 Session，也不发现子角色或允许模型选择调度模式。相比官方示例的外部 `pi --no-session` 子进程，这一实现保留独立上下文和临时生命周期语义，同时复用 Storyflow 的认证、工具治理和打包入口；`call_llm` 继续承担无工具推理，`spawn_session` 继续独占用户可见的持久会话语义。

`pi-subagents` 当前通过外部 Pi CLI 启动 child，无法继承 Storyflow 父进程内存中的 `AuthStorage`、`ModelRegistry`、proxy tools 和 permission hooks；正式包也不分发独立 Pi CLI。因此在上游提供可注入 child runner，或 Storyflow 具备经过 packaged E2E 验证的受控 child runtime 前，不做只在开发机 PATH 上成立的半替换。满足该退出条件后，本 ADR 应由 Pi package-owned lifecycle 的新决策取代，并删除内建实现。
