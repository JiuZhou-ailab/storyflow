# ADR 0020: Project 注册不授予可执行能力

状态：Accepted
日期：2026-08-26

用户选择目录只建立 Project 上下文和文件可见性，不代表同意执行该目录声明的能力。项目 Skills
和指令可以作为只读上下文被发现；项目 `permissions.json` 的权限扩张、默认 `allow-all`、自动启用的
Source、stdio MCP、Automations 与 Extensions 都属于彼此独立的可执行能力，必须由 Product Host 显式
授权，不能由 Project 文件自我授权。在对应的 Host 授权状态与交互闭环完成前，这些入口保持
fail-closed；用户级全局资源继续按其既有信任契约加载。此边界刻意不引入一个笼统的
trusted/untrusted Project 枚举。

Source grant 与凭据同时绑定 `origin + slug + definition identity`。同 slug 的定义被替换后必须重新
授权和认证；旧的 slug-only 凭据只能显式删除，不能自动迁移到新定义。

Remote ownership 也是 Host 身份的一部分：已有 local Project 不能通过再次 CREATE 原地改成 remote；
remote Project 只能单独建立或重连，避免 remote marker 留下本地 watcher、Session runtime 或 Automation。
