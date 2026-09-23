# #55 implementation: public connection gate

状态：首个选型门禁未通过；#55/#56 功能尚未实施。基线 `f2100057b23723c7dd48b59845a3c1b2ebd2fe6f`，macOS arm64，2026-09-23。

## 实测

使用仓库 Electron 39.2.7 / Chromium 142.0.7444.235，新建隔离 profile、两个不同 partition 的同 URL 网页与一个模拟应用 shell。候选包只装在临时研究目录：Playwright core 1.63.0、Puppeteer core 25.11.0、Playwright MCP 0.0.82。新 probe 的最终版本执行一次；早期版本另做了一次只读列表与连接验证。没有运行真实 Storyflow Session 或付费服务。

| 公开路径 | 本次结果 |
| --- | --- |
| Playwright core 显式选择 A | 实际 A 输入值改变，B 未改变 |
| Puppeteer core 显式选择 A | 实际 A 输入值改变，B 保持原值 |
| MCP createConnection + contextGetter | 列表包含 A、B、应用 shell；选择 B 后写入成功，主进程独立读取确认 B 被改变 |
| 不同 Electron partition | Playwright 仍报告同一个 BrowserContext 内的 A、B 与 shell；存储分区不是工具授权范围 |
| 直接 browser-level 调试端点 | 无鉴权 HTTP 200，可列出三类 target；这个最简单连接方式不能直接作为生产入口 |
| Puppeteer 公共 ConnectionTransport 透明转发到单页 debugger | 握手失败：`Target.getBrowserContexts: Not allowed` |

这不是 Storyflow 已发布版本存在跨会话漏洞的报告：泄漏路径发生在隔离候选集成中。也不是所有方案都不可能安全接入的证明。两个 core 库可以由可信 Host 只持有授权 Page，但仍需解决其连接入口；MCP 公共 contextGetter 本身没有提供所需的页面子集边界。

后续临时探索曾对单页 transport 补四个 Target 命令回复/事件，使 Puppeteer 的页面发现与一次 fill 成功。该实验依赖自维护的 browser-level 协议呈现，不属于透明连接；尚未验证 iframe、popup、取消、目标关闭、事件顺序与后台渲染。没有将此临时实验引入生产，也不能据一次 fill 宣称它符合“低维护成本且范围安全”的门禁。下一步需决定并验证这个局部适配是否足够小且完整，或找到可直接复用的受控连接实现；不得退回全局调试端口来假通过。

## 交付与边界

- [可复跑 probe](../../e2e/browser-reuse/README.md) 保留 Electron fixture、候选公开 API 与独立 DOM 结果验证。候选依赖不加入产品 package/lockfile。
- 返回非零表示已测试路径没有通过第一关，而非本功能实现完毕。该 probe 不取代已同意的“真实 Electron + browser_tool”主验收接口。
- 未迁移工作区、未替换生产自动化、未修改 pai-pro；Windows 产物、10 次准确率矩阵、100 次生命周期、真实 Agent 任务均未执行。
- 遵守 #55 的先决条件：在安全、同页与维护边界未通过前，不把选型当作已完成，也不继续依赖它的 #56 集成。

## 检查

- `bun run typecheck:all`：通过。
- `bun run test`：退出码 0。主测试批次 5676 pass、11 skip、0 fail；后续隔离测试批次均为 0 fail。全仓日志位于本机 `/tmp/storyflow-browser-full-test.log`，不代表新增选型门禁通过。
- 探针启动失败回归：将 Electron 路径设为不存在的文件，确认返回 ENOENT JSON、退出码 1、临时 profile 已删除；修复审阅发现的只等待 `exit` 而不等待 `close` 的清理问题。
- Standards 审阅：1 项清理问题，已修复并实测；未发现其他需处理的标准问题。
- Spec 审阅：当前有界研究增量没有阻断性偏差，但 #55 产品功能与 #56 仍未交付。不得将此次提交描述为完成这两项规格。
