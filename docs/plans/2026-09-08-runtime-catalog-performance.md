# Specs #30 / #31：Runtime 常驻与目录体验验收

基线 `2ab23a4d144433e1ae8d1d0888989a87558d6c3d`。对应 [#30](https://github.com/JiuZhou-ailab/storyflow/issues/30)、[#31](https://github.com/JiuZhou-ailab/storyflow/issues/31) 及 #32–#37。本次没有新增依赖、设置页、TTL、全文索引或目录缓存层。

## 实施与边界

- 修正 fixture 的全局 Session ID 去重范围。真实 Electron API 确认 20 × 300 = 6000 个独立 Session、每个 workspace 的 1000-message 历史和 400 章节；验证安排在计时后，避免预热目录。旧结果不能冒充完整规模的新基线。
- 沿用现有 runtime 创建入口、每 Session mutex 和操作 lease，保留最近使用的 3 个可回收 idle runtime。忙碌、排队、权限/认证交互、后台任务、native pending requests 和失效/删除状态均受保护；Host abort 不等于 Pi settled。
- flush 后确认 Pi 和 MCP 实际退出才清理引用。失败保留原对象与 cleanup 状态，禁止替代进程；真实工作结束可再次尝试，失败回收不会自己触发无限重试。连接级清理失败不封锁其他 Session。
- 目录读取错误不再伪装成部分成功。初次加载、磁盘变更、focus/visibility 刷新共用错误状态和重试；root 归属及 revision 拦截迟到错误。连续失败保留当前目录与 dirty editor。
- 原有 warm catalog 缓存已足够快，保留现有实现。拆编辑器包、预加载/同步加载文件树与 workspace/chat surface 等试验未获得足以支持保留的收益，均已撤回。

## Runtime 资源结果

macOS / 48GiB，Bun 1.3.14，Electron 39.2.7。每次运行使用完整 fixture，模型为本机确定性 SSE，无付费 provider。下表为三轮独立 Electron 进程，RSS 单位 MiB；Pi RSS 是子进程 RSS 相加，不是去重物理内存。

| 构建 / 轮次 | 20 会话 Pi 数 / Pi RSS | 50 会话 Pi 数 / Pi RSS | 50 会话进程树 RSS |
|---|---:|---:|---:|
| before 1 | 20 / 8547.45 | 50 / 7747.19 | 8453.06 |
| before 2 | 20 / 8008.83 | 50 / 6947.17 | 7658.89 |
| before 3 | 20 / 11580.28 | 50 / 7954.53 | 8753.73 |
| after 1 | 3 / 1733.69 | 3 / 1738.66 | 2849.64 |
| after 2 | 3 / 1735.27 | 3 / 1733.41 | 2882.80 |
| after 3 | 3 / 1737.11 | 3 / 1726.89 | 2677.27 |

50 会话阶段 Pi RSS 中位数从 7747.19 降至 1733.41 MiB，减少 **77.6%**；Pi 数均收敛到 3。部分运行与构建/测试重叠，RSS 受分页和机器负载影响明显，不能据此声称固定物理内存节省或线性泄漏。阶段在正常回复结束后等待 3 秒再采样。

原始证据（`e2e/perf/results/`，gitignored）依次为 `interaction-1788847094065-before.json`、`interaction-1788847876530-before.json`、`interaction-1788848149589-before.json`、`interaction-1788848741827-after.json`、`interaction-1788849223449-after.json`、`interaction-1788849493337-after.json`。JSON 保留构建 SHA-256、完整 PID/PPID/RSS、heap 和场景完成标识。

`footprint` 额外捕获运行中的 4 个 Pi，物理 footprint 合计 1,623,267,112 bytes（约 1.51GiB）；这是进行中快照，不能与上述 3 个 idle Pi 的 RSS 或旧版物理内存直接比较。工具没有报告 errors。另一个仅主进程的快照为约 327MiB，不能拿它代表整个应用。


同一 Electron 连续三轮（累计 150 个新会话）也已完成：

| 轮次 | 20 / 50 会话阶段 Pi 数 | 50 会话进程树 RSS MiB | renderer heap MB |
|---|---:|---:|---:|
| 1 | 3 / 3 | 2789.38 | 74.17 |
| 2 | 3 / 3 | 2729.97 | 76.73 |
| 3 | 3 / 3 | 2739.95 | 80.36 |

证据 `interaction-1788850219918-after.json`，`coveragePass=true`，模型调用 156 次（150 次初始发送 + 每轮 2 次恢复）。Pi 数未累积；Host 仍保留新增 Session 的元数据，所以 renderer heap 不是恒定值。

## 恢复成本与内容连续性

首轮 20 组配对测量：冷恢复从发送到首 delta 的 P50 / P95 为 **1545.1 / 1666.9ms**；同 Session 的干净进程重启为 **1536.2 / 1666.2ms**。P95 额外 0.7ms，通过 ≤max(250ms, 10%) 门槛。这不是 warm resume 的等待时间；旧版 warm 样本每阶段仅 1 次，未据此估计 warm P95。

最终含 native history 断言的另一组 20 对恢复：P50 / P95 为 **1959.2 / 2307.2ms**，配对干净重启为 **1931.8 / 2059.5ms**，P95 额外 **247.7ms**，仍在 250ms 门槛内但余量很小。该轮与持续驻留验收并行，不能忽略负载波动或只选首轮较好数字。证据 `interaction-1788850213772-after.json`，`nativeHistoryVerified=true`、`coveragePass=true`；92 次发送恰好对应 92 次模型调用，没有 replay。受控模型实际收到恢复前的 native assistant 内容。分支/compaction 的存储协议没有改写，复用已有恢复与 rewind 回归；此项并非对所有组合的额外 live 验证。

每次冷恢复要求恰好创建一个 Pi；干净重启仅终止本次 harness 创建的那个 Pi。协议和 lease 回归覆盖取消到 `agent_end` 再到 `agent_settled`、活动操作/发送 admission、失效并发、清理失败与重试。Pi/MCP 测试使用真实子进程，失败注入限于该子进程的 OS signal 边界。SDK 已发 SIGKILL 后仍无法确认退出时继续 fail closed；外部故障解除后重试确认原退出事件，不依赖 SDK 私有字段或重复发送业务请求。

## 目录结果与未完成项

完整同规模 baseline 为 `catalog-1788847264393.json`；最终错误恢复验收为 `catalog-1788849532579.json`。

| 口径 | before P50 / P95 | after P50 / P95 | 验收 |
|---|---:|---:|---|
| Session 点击激活 Project → 真实目录行，cold n=20 | 314.4 / 360.0ms | 335.2 / 403.0ms | **P50 未达 100ms；P95 低于 500ms** |
| 同路径 warm n=30 | 16.1 / 18.9ms | 15.4 / 23.1ms | 通过 |
| 旧 project-expansion click → catalog wall-time 中位数 | 532ms | 616ms | **仍未达原 100ms 预算** |

全部其他测试/本任务 runtime 基准结束后的独立复测 `catalog-1788850363739.json`：cold n=20，P50 / P95 **281.9 / 309.9ms**；warm n=30，**14.7 / 19.2ms**。本次启用真实预算 gate，因 cold 未达标以退出码 1 结束，JSON 同时保存 `cold.pass=false` 和 `warm.pass=true`。

仪表修正和产品提速分开报告，不能把新计时起点直接与旧 wall-time 比较。`PERF_BASELINE=1` 只允许收集失败数字，不代表预算通过。此次没有保留冷路径提速改动，也不声称 cold 提速。

真实 `fs.listFiles` 常见约 20–50ms，也观察到 100ms 以上尾部；profile 未建立足以支撑更大改动的单一主因。当前证据不足以判定冷启动及 heap 没有超过 10% 的可重复退化；需隔离机器负载后补成对数据。**#36 保持未验收，#31 不能标为全部完成。** 下一步应细分 Project 激活、Session metadata hydration 与 render commit 的等待，再确定是否值得改变关键路径。

目录 QA 已实际执行：首次无文件标签、无章节正文读取；400 章节真实可见；A/B 项目重复切换；打开章节后 chmod 0、focus 刷新报错、再次重试仍报错、恢复权限重试成功。两次错误后编辑器 DOM 身份和未保存 marker 均不变。文件 RPC、目录范围/授权、rename/delete/relink 与已有保存门回归由相关测试及全量套件覆盖；未把静态复核冒充每项 Electron 交互验证。

## 验证与复现

- `bun run typecheck:all` 通过。
- i18n parity、sorted、coverage 通过。
- 根 `bun run test` 完整执行一次，合计 **5753 pass、11 skip、0 fail**；随后定向 43 个回归通过。
- 最终 `first-text,long-stream`：首片 n=20，P50 / P95 / max = **6.8 / 8.1 / 10.0ms**；1000-message 历史、2k/10k/30k 回复下键入 P95 = **1.9 / 1.5 / 1.6ms**，30k 还验证 IME 与流重叠及历史选择/滚动保持。证据 `interaction-1788849842716-after.json`。
- 复现命令、fixture 所有权、失败预算模式及参数见 [perf runbook](../../e2e/perf/README.md#runtime-residency-and-catalog-follow-up)。真实 provider、额外外部 MCP 负载和生产发布不在此次运行范围。

## Standards

最终静态审查无新增规范或正确性发现。失败回收自旋、focus 刷新遗漏、跨 Project 错误覆盖均已修复；未保留无测量收益的试验代码。

## Spec

最终增量审查无新增代码问题。生命周期与编辑内容风险已修复；冷目录 P50 仍未达标，保持 #36 开放，不宣布 #31 完成。

两轴各 0 个未解决代码发现；Spec 仍有上述性能验收缺口。


## #36 后续：冷目录请求消除（基线 f4edcaa6e）

本轮仅优化目录首次打开的已测请求路径，未更改 runtime 常驻或执行并发。新增 RPC trace 先定位：标准 fixture 初始列表加载后发出 300 次 `sessions:getPermissionModeState`；输入框预加载又发出 280 次 `workspace:readImage`。核对 image path 后确认后者来自缺失的 Skill 图标，不是状态图标；最初的“合并相同在途图标读取”试验没有降低请求数或延迟，已撤回。

保留两处改动：

- `sessions:get` 在 Host 内复用已有权限校准函数，将模式及可选版本随列表返回。初始化不再逐会话往返；旧 Host 缺版本时沿用原 RPC。初始列表只保留本次加载期间收到的更新权限事件，不能拿上一 Host 的高版本拒绝新快照。重连校准路径未改。
- `loadSkillIcon` 复用 Host catalog 的 `iconPath` 判定，删除缺失图标的重复发现；保留已知文件、emoji、URL 与现有读取授权。`SkillAvatar` 本就使用这一目录事实源。没有新增缓存、索引、依赖或并发限额。

诊断证据：`catalog-1788851472810.json`（before trace，取 cold sample 边界前）、`catalog-1788852206492.json`（after trace）；首次权限状态 RPC **300 → 0**，缺失 Skill 图片请求 **280 → 0**。trace/profile 均不用于最终耗时验收。真实 `sessions:get` 仍返回 300 条元数据，目录仍返回 406 个节点，未删数据换速度。

最终耗时使用关闭 trace/profile 的独立 Electron 运行，完整 fixture 为 6000 Session、每 workspace 1000-message 历史、400 章节。基线为 `catalog-1788851440228.json`；最终构建为 `catalog-1788852734316.json`。

| 指标 | 本轮 before | 最终 after | 结果 |
|---|---:|---:|---|
| cold，n=20，P50 / P95 | 267.85 / 289.42ms | 192.75 / 209.98ms | P50 改善约 28%，仍高于 100ms |
| warm，n=30，P50 / P95 | 11.40 / 17.44ms | 9.80 / 18.13ms | 通过 |
| 原 project-expansion → catalog wall-time 中位数 | 502.5ms | 408.0ms | 仍高于原 100ms 预算 |
| renderer surface committed 中位数，n=20 | 269.0ms | 211.0ms | 本轮未观测到启动退化 |
| 首次目录后 GC heap | 34.07MB | 34.49MB | +1.3%，单次 heap 快照 |

前一轮优化后复测也完整保留：`catalog-1788852446493.json`，cold 174.80 / 218.50ms、warm 10.50 / 19.98ms、surface 267.5ms、heap 33.97MB；该构建尚未补最终初始权限事件竞态保护。最终数字取最终构建，不选前一轮更好的 P50。上述数据是本机顺序对照，不代表所有机器；warm P95 的微小波动不能当作可重复退化。

最终以正常预算 gate 执行，因 cold P50 未达标返回退出码 1，JSON 留存 `cold.pass=false`、`warm.pass=true`。目录重试 QA 两轮都通过：首次零文件标签、零章节读取，30 次跨 Project 往返，真实目录读取失败与重复失败，恢复权限后的重试成功，未保存正文及同一 editor DOM 均保留。

剩余等待仍包括会话激活、renderer 提交和目录 RPC；trace 同时显示 ActivityRail 为折叠 Project 发起大量 Session 列表请求。下一步应隔离验证这批后台元数据工作对前台目录的影响，保留跨 Project 置顶会话语义，不直接删除必要条目或下调执行并发。**#36 和 #31 仍未全部验收。**


本轮最终交互证据 `interaction-1788852890519-after.json`：首片 n=20，P50 / P95 / max = **6.7 / 7.2 / 10.5ms**；1000-message 历史下，2k / 10k / 30k 长回复期间键入 P95 均为 **1.4ms**。30k 场景验证 IME 与流重叠、历史选择/滚动保持以及最终持久化和显示文本。模型使用本机确定性 SSE，无付费请求。

本轮 Standards / Spec 双轴最终代码复核均无未解决发现。审查发现的初始权限事件覆盖风险已用行为测试修复；批量刷新跨 Host 代际的试验已撤回，重连原实现不变。Spec 的冷打开与 legacy 100ms 预算仍未满足，与代码审查结论分别记录。

本轮 `bun run typecheck:all` 通过；最终根 `bun run test` 完整执行一次，合计 **5759 pass、11 skip、0 fail**。新增公共边界回归覆盖缺失/后来新增 Skill 图标、列表权限快照、本次加载的新权限事件、Host 版本回退及无关 thinking 更新。代码与失效的文件头、perf runbook 已同步，未改变顶层模块边界。


## #37 后续：暖目录切回与刷新正确性（2026-11-12）

实施基线 `da103f15d821eb38cc6add8c5e85e5cdf739cba2`，实现提交 `30751a61`。
沿用 AppShell 已有目录快照、root revision、load / refresh in-flight 表；没有增加目录事实源、TTL、枚举上限或章节预读，也没有改 RPC 授权。

暖切回在 layout effect 中回填同一根目录的已有快照，避免等待 passive effect 的加载帧；经过一次绘制后再用同一 loader 校验磁盘，刷新不会占用缓存目录的首帧。失败保留目录及原有错误，成功才清除错误。刷新发布检查当前 candidate roots，不能依靠可能仍指向上一 Project 的 mounted-root ref；重定位和移除使旧、新 locator 的快照及在途请求失效。文件变动签名取请求开始时的值，迟到完成不能把之后的 Agent 变动标成已经刷新。

诊断 trace 同时覆盖 cold 和 30 次 warm；warm 目录出现前没有 `fs:listFiles` 请求，等待包含 Project 切换及 renderer 提交。最慢 warm 诊断样本为 599.7ms；同一窗口内的 `sources:get` / `statuses:list` / `labels:list` / `views:list` / theme RPC 观察到约 364ms 等待，因此不能把全部切回耗时归因于目录枚举。trace 开启时的数据不用于耗时验收。

本轮发现并修正两处 harness 漂移：隔离 HOME 后，fixture 中开发者的 `~` 不再指向原目录，生成器改为绝对 locator；当前 Markdown 默认显示写作视图，就绪条件同时支持目标文件的非空写作编辑器或原文 textarea。目录计时起止点不变；这些修正不作为产品提速。首次目录之后才执行 6000 个唯一 Session、每 workspace 1000-message 历史和 400 章节的真实 API 校验，测量前没有打开章节。

`PERF_CATALOG_GATE=warm` 仅选择本票的 warm gate；默认仍验收 cold + warm，所有 cold 样本、预算判定、legacy wall time、启动 mark 及 heap 继续记录。没有把冷目录的独立优化计入本票完成条件。完整复现命令见 [perf runbook](../../e2e/perf/README.md#warm-project-return-37)。

### #37 实测记录

本轮机器为 Apple M4 / 16GiB、macOS 27.0.1，Electron 39.2.7，计时驱动 Bun 1.4.2。
下表始终使用 Session 点击激活 Project → 真实目录行的同一口径；trace 轮仅用于诊断。
每一轮保留全部 30 个 warm 样本；未完成 QA 的轮次不算通过。共享机器负载有明显波动，不能把单轮差值解释为稳定的跨机器提速比例。

| 轮次 | cold n；P50 / P95 / max ms | warm n=30；P50 / P95 / max ms | 完整结果 |
|---|---:|---:|---|
| before trace（诊断） | 1；321.90 / 321.90 / 321.90 | 50.00 / 380.28 / 599.70 | 诊断，不用于验收 |
| before（未达 warm P50） | 3；570.60 / 605.25 / 609.10 | 111.00 / 449.76 / 707.40 | AssertionError [ERR_ASSERTION]: Catalog performance budget |
| after 1（就绪判定失败） | 1；901.10 / 901.10 / 901.10 | 61.25 / 622.99 / 729.00 | Error: waitFor timeout after 15000ms: 第001章 source ready |
| after 2（就绪判定失败） | 1；1144.60 / 1144.60 / 1144.60 | 50.45 / 119.82 / 180.80 | Error: waitFor timeout after 15000ms: 第001章 source ready |
| after 3（未达 warm P95） | 3；1301.60 / 1689.14 / 1732.20 | 64.15 / 616.11 / 764.80 | AssertionError [ERR_ASSERTION]: Catalog performance budget |
| 最终构建 / 窗口恢复 QA 失败 | 1；172.20 / 172.20 / 172.20 | 26.20 / 35.52 / 44.50 | AssertionError [ERR_ASSERTION]: Expected two real Project windows  3 !== 2  |
| 最终单窗口起点 / 完整 QA | 3；122.20 / 178.63 / 184.90 | 26.50 / 29.68 / 32.90 | 通过 warm gate 和 QA |

最终报告 `catalog-1794481096449.json`：warm gate 通过，cold 原门槛仍为失败；默认 `all` gate 没有放宽。
最终三个 cold 样本都确认只有一个初始窗口。早期报告没有固定窗口恢复状态，尤其双窗口 QA 后的 cold 只能作为诊断，不能据此声称冷路径提速。
前一次完整 warm 采样后发现恢复窗口累计为三个，整轮标为 QA 失败并保留；修正仅清理测试 fixture 的恢复文件，未更改产品启动逻辑。
首次工具准备阶段的两个缺失 Electron binary 失败、一个 HOME 路径错误也保留在临时 JSON 中，均没有有效采样，不纳入统计。

最终 GC 后 renderer heap 为 **33.90MB**（预算 500MB）；首次目录没有打开章节。
启动 mark `storyflow.surface-committed:ready` 三次为 [398, 275, 314]ms。
这是 renderer timeOrigin 下的原诊断 mark，不冒充 OS launch → editable document 的完整启动验收；既有启动预算及 cold 的未达项仍保留。

<details>
<summary>全部 warm 样本、cold / legacy 样本与构建指纹</summary>

数组按实际采样顺序保留，单位 ms，显示到 0.001ms；没有剔除失败或尾部样本。

before trace（诊断）：`catalog-1794478555400.json`；renderer entry SHA-256 `90f328387c59f10030dbbee2a12d9eae1ddf3ad7b81273144f9c0205011728fe`。

```text
warm=[191.6, 98.5, 85.8, 44.8, 47.2, 52.8, 189.4, 68.8, 228.1, 372.3, 197.7, 386.8, 361.7, 599.7, 151.6, 121.1, 147.2, 39.1, 23.4, 22.7, 38.9, 26.0, 41.2, 30.6, 22.1, 23.5, 26.6, 37.2, 20, 25.8]
cold=[321.9]
legacyWall=[805]
```

before（未达 warm P50）：`catalog-1794478730232.json`；renderer entry SHA-256 `90f328387c59f10030dbbee2a12d9eae1ddf3ad7b81273144f9c0205011728fe`。

```text
warm=[132.5, 73.6, 67.1, 224.4, 77.3, 115.6, 102.3, 26.9, 102.2, 528.6, 56.3, 98.2, 206.7, 306.3, 183.5, 143.5, 25.6, 69.4, 25.7, 100.9, 353.4, 106.4, 238.7, 261.8, 169.3, 323.7, 707.4, 230.8, 46.1, 31.5]
cold=[609.1, 314.2, 570.6]
legacyWall=[1832, 1681, 1564]
```

after 1（就绪判定失败）：`catalog-1794478916746.json`；renderer entry SHA-256 `038979d6672948499e740b797d90c5d463563ab56450f1359d29e4c4a1de1d89`。

```text
warm=[729.0, 563.7, 184.7, 214.0, 615.9, 190.2, 628.8, 67.1, 142.0, 71.2, 130.2, 43.8, 181.2, 133.4, 38.1, 40.8, 32.5, 94.3, 34.9, 40.1, 40.9, 47.3, 71.4, 44, 40.2, 40.3, 55.4, 46.0, 35.1, 37.2]
cold=[901.1]
legacyWall=[3332]
```

after 2（就绪判定失败）：`catalog-1794479040588.json`；renderer entry SHA-256 `038979d6672948499e740b797d90c5d463563ab56450f1359d29e4c4a1de1d89`。

```text
warm=[76.4, 60.1, 53.4, 56.2, 147.0, 47.5, 180.8, 49.9, 51.8, 34.0, 59.4, 42.8, 49.5, 39.7, 45.2, 38.4, 33.6, 48.3, 86.6, 59.0, 69.8, 70.5, 63.0, 51, 70.3, 45.0, 39.3, 33.2, 35.7, 48.7]
cold=[1144.6]
legacyWall=[2768]
```

after 3（未达 warm P95）：`catalog-1794479209719.json`；renderer entry SHA-256 `038979d6672948499e740b797d90c5d463563ab56450f1359d29e4c4a1de1d89`。

```text
warm=[638.3, 466.2, 326, 112.1, 76.6, 108.0, 86.5, 132.4, 764.8, 185.5, 589, 88.2, 35.1, 129.1, 69.5, 306.8, 40.8, 47.3, 56.3, 42.3, 37.6, 30.0, 29.7, 34.0, 44.0, 48.5, 36.9, 35.5, 33.3, 58.8]
cold=[1301.6, 1042.7, 1732.2]
legacyWall=[2684, 3071, 4157]
```

最终构建 / 窗口恢复 QA 失败：`catalog-1794480932144.json`；renderer entry SHA-256 `e0fa6a22fc2a80a1da90f8217bfec2fe2ae97d5a3deb13fe3d6116adb5d822b6`。

```text
warm=[44.5, 27.9, 27.9, 29, 26.0, 27, 25.1, 27.1, 25.5, 23.3, 29.2, 26.2, 27.5, 26.9, 27.0, 28.0, 25.9, 25.7, 24.7, 22.6, 25.0, 23.0, 26.2, 23.6, 26.3, 24.8, 25, 40.7, 28.3, 25.8]
cold=[172.2]
legacyWall=[709]
```

最终单窗口起点 / 完整 QA：`catalog-1794481096449.json`；renderer entry SHA-256 `e0fa6a22fc2a80a1da90f8217bfec2fe2ae97d5a3deb13fe3d6116adb5d822b6`。

```text
warm=[32.9, 28.6, 27.5, 27.1, 30.4, 26.5, 25.4, 27.9, 25.5, 27.0, 25.1, 27.1, 28.4, 28.8, 25.8, 25.3, 24.2, 26.5, 26.7, 25.3, 22.9, 26.2, 26.3, 24.5, 24.5, 25.1, 28.8, 27.8, 25.3, 28.0]
cold=[98.1, 122.2, 184.9]
legacyWall=[566, 540, 706]
```

</details>


### #37 回归、输入预算与限制

- 最终报告源提交 `bcac4332fb41aba3b487d17cc418e5f1df086098`，产品实现为 `30751a61`；其间仅修正测试 fixture 和窗口恢复计时条件。
- 真实 Electron：切回后看到离开期间新增的文件；外部 rename / delete、连续目录读取失败和恢复重试通过。失败及恢复后同一 editor DOM、当次新插入的唯一未保存 marker、同一文件树、展开和滚动位置均保留；第二个真实窗口通过授权 API 写入后，第一个窗口 focus 刷新可见。
- 9 个实际异步 catalog callback / effect 回归覆盖去重、revision 乱序、首次进入 B 不借用 A、A→B→A、迟到失败、重定位/移除，以及不提前覆盖之后的文件变动签名。另有目标章节的 writing / source 就绪回归和既有 RPC scope / list / mutation 回归。
- `typecheck:all`、doc-tools smoke、lint、i18n parity / sorted / coverage 通过；主套件 **6095 pass、11 skip、0 fail**；独立 HTTP 服务 **34 pass**。本地 Bun 1.4.2 / OpenSSL 3，数据置于 Git 临时目录，测试 HOME 独立于临时 fixture，避免持久化路径缩写与父仓库依赖干扰断言。CI 固定 Bun 1.3.14 也实际尝试过，完整失败日志保留，不能将该次执行记为通过。
- 单独执行全部 29 个隔离测试文件：**327 pass、1 fail**。唯一失败是本票未修改的 `auto-update-quit.isolated.ts` 中 cleanup stalls=true 的原生 Electron 退出用例，两次复跑都超过其 15s 子进程上限；非挂起分支通过。`main/index.ts`、`quit-coordinator.ts` 及该测试相对基线没有差异，没有为本票放宽它的 deadline 或修改退出实现。
- 初次全量验证的就绪 fixture、共享 `/tmp/sessions` 权限冲突与 LibreSSL TLS 失败均已定位：就绪条件补充当前写作视图；进程退出测试使用自己拥有的临时目录，构造失败也清理子进程；TLS 在 OpenSSL 3 下 **13 pass**。使用 Git 下临时目录时，transform_data 需要临时目录自身的 CommonJS package 标记；相关 Worker / 转换测试定向复跑 **9 pass**。这些测试环境修正没有改产品权限或脚本执行逻辑。

首片和长回复证据 `interaction-1794481283153-after.json`（本机确定性 SSE，无付费 provider）：
首片 n=20，P50 / P95 / max **6.4 / 7.2 / 9.3ms**，低于原 100ms 预算；
1000-message 历史下，约 2k / 10k / 30k 回复的键入 P95 **1.2 / 1.4 / 1.2ms**，低于 16.7ms。
30k 场景验证 IME 与流重叠、历史选区/滚动、最终持久化及显示文本；`coveragePass=true`，23 次本地模型请求。

完整本地日志及 JSON 保存在 worktree 的 Git 临时目录：`validate.log`、`validate-final.log`、`test-verified.log`、`isolated-final.log`、`confirmed/`、`interactions/`。
上文已版本化保存每轮目录统计、失败、构建指纹和全部 warm / cold / legacy 耗时数组，避免只留下成功汇总。
