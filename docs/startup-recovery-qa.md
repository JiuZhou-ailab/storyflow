# 启动恢复验收（Spec #45）

本单覆盖 Product Host 的配置、数据所有权、bootstrap/stop 与 Electron 原生恢复。
普通桌面仍按 shell → Agent 两阶段启动；Workspace readiness 不提升为全局门。

## 自动化入口

| 检查 | 命令 | 观察边界 |
| --- | --- | --- |
| 配置、回滚、停止、TLS | `bun test ./packages/server-core/src/bootstrap/startup-recovery.isolated.ts` | 真实文件、socket 与共享 bootstrap/stop |
| 活 owner、崩溃恢复、旧代 release | `bun test ./packages/server-core/src/bootstrap/server-lock.isolated.ts` | 两个真实进程和历史格式 |
| 页面/preload/renderer/模块加载失败 | `bun e2e/core/native-startup.ts` | 真实 Electron，受控缺失资源；不是发行安装包证明 |
| 原生入口配置/权限/owner/TLS 失败 | `bun e2e/core/startup-faults.ts` | 构建后的完整应用入口；用 headless 错误退出避免人工关闭对话框 |
| 相同 profile 连续重启 | `bun e2e/core/startup-recovery.ts` | 真实首屏、会话与文件面板 |
| 发行包核心闭环 | `CRAFT_E2E_ELECTRON_BIN=<exe> bun run e2e:core` | 实际发行可执行文件与本地模型 stub |

窗口测试前运行 `bun run electron:build`。测试使用临时数据，不调用付费模型。
`startup-faults.ts` 也接受 `CRAFT_E2E_ELECTRON_BIN`。

Windows release job 在上传资产前执行 `scripts/verify-windows-startup.ps1`，安装当前 NSIS，
通过安装器创建的快捷方式验证首屏、二次启动、正常退出重开和强制结束后重开；再使用独立
Host/profile 从上一个已发布安装器升级到当前安装器。升级链中不删锁、不换 profile。
CDP 必须看到可见应用页面并成功执行工作区 RPC；进程存在或出现任意窗口均不算成功。
验收只允许在临时 CI runner 执行；证据作为 `windows-startup-evidence` 上传。
共享 bootstrap 合同还在 Windows、macOS、Linux 的 validate matrix 执行。

## Windows 现场 QA

1. 记录应用版本、安装器版本、Windows 版本、安装或覆盖升级入口、快捷方式或 exe 启动入口。
2. 首次失败时复制原生诊断回执。它包含诊断 ID、阶段、分类、平台、版本与可用的 owner PID，
   不包含配置全文、token、文档内容、路径或任意异常堆栈。落盘位置为 Electron userData 的
   `logs/startup.jsonl`，最多保留当前和一个轮转文件。
3. 对照错误原因执行界面动作。owner 身份未知时不删锁、不结束不明进程；损坏配置仅通过
   显式选择的有效备份恢复。旧文件保留为 `config.json.damaged-*`，没有备份不创建空 registry。
4. 再启动后确认窗口可见、Project ID 和真实文件不变；最小化后重复启动会显示原窗口，
   外接屏断开后窗口仍可见。确认正常退出和强制结束后各重开一次。
5. 启用 TLS 时验证实际 WSS 连接；缺少私钥、证书过期或主机名不匹配时必须失败，不能
   观察到明文监听。用于本地桌面的证书须覆盖监听地址或 loopback/localhost。

## 证据限制

本次本地验证：`bun run test` 共 5,927 项通过、11 项跳过、0 失败；
`typecheck:all`、完整 Electron 构建及资源校验通过。真实 Electron 的 native-startup、
startup-faults（含实际 WSS preload）、core 与相同 profile 的 startup-recovery 均通过。
Standards 与 Spec 独立审查发现的退出竞态、HTTP drain、旧锁墙钟推断、重复清理和取消导航问题
已修正并复核。提交快照的 i18n coverage 通过；工作区另有本单之外的 `chat.openFolder` 缺失。

2026-09-21 本机为 macOS；原生故障注入和连续重启有实际执行证据。
Windows NSIS 安装升级与 Linux/Windows matrix 在本机不能执行，需 CI 提供证据。
用户原始 Windows 故障的弹窗原文、安装版本与 owner 状态仍未取得，不能认定现场已归因。
在 Windows 原生验收通过前，不关闭 #45，也不将本地构建通过称为修复版本已发布。
