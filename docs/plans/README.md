# Plans and implementation records

计划、阶段性调查和实施验收记录统一收纳于本目录，文件名使用 `YYYY-MM-DD-topic.md`。当前操作方法保留在 `docs/*-qa.md` 和子系统 README；长期架构决策保留在 `docs/adr/`。

| 记录 | 状态 | 当前入口 |
| --- | --- | --- |
| [交互性能 #29](2026-09-08-interaction-performance.md) | 已实施；保留基线与测量限制 | [性能 QA](../electron-performance-qa.md) |
| [Runtime 常驻与目录体验 #30–37](2026-09-08-runtime-catalog-performance.md) | 已实施；保留实验与验收证据 | [性能场景](../../e2e/perf/README.md) |
| [自由对话文件工作区 #38](2026-09-10-free-conversation-file-workspace.md) | 已实施；保留需求与验收记录 | [侧栏边界](../../apps/electron/src/renderer/components/right-sidebar/README.md) |
| [官网实施 #39](2026-09-17-marketing-implementation.md) | 历史实施记录；含已替代设计目标 | [官网](../../apps/marketing/README.md) |
| [Pi 0.87.1 升级前评估](2026-09-23-pi-upgrade-assessment.md) | 历史评估；升级已完成 | [升级验收](../pi-native-upgrade-qa.md) |

新增记录在开头标明状态、适用快照和现行依据，并在此登记。完成的计划保留原有路径和有用证据；历史测试结果不代表当前版本或生产验收。待办工作的事实源为 [GitHub Issues](../agents/issue-tracker.md)。
