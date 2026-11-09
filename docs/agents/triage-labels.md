# Triage Labels

open issue 恰好有一个状态标签；类型（`bug` / `enhancement` / `documentation` / `question`）和来源（`feedback`）是另外的维度，可以同时打。

| Canonical role | GitHub 上的做法 | Meaning |
| --- | --- | --- |
| `needs-triage` | 标签 `needs-triage` | 等维护者评估（新 issue 默认） |
| `needs-info` | 标签 `needs-info` | 等补充信息 |
| `ready-for-agent` | 标签 `ready-for-agent` | 有写权限的人确认验收标准后手动打，打上即开始 agent 开发；agent 不打这个标签 |
| `ready-for-human` | 指派负责人（assignee），不打标签 | 人工实现；有指派的 issue 不会交给 agent |
| `wontfix` | 关闭为 Not planned：`gh issue close <n> --reason "not planned"` | 不采取行动 |

`agent-working` 由调度脚本管理，不要手动打；人摘掉它表示叫停。重复的 issue 用 GitHub 原生的 Close as duplicate。
