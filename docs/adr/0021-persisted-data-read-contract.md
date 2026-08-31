# ADR 0021: 持久化数据读取契约与迁移纪律

状态：Accepted
日期：2026-08-31

## 背景

0.18.0 为项目注册引入目录指纹（`directoryConfigId`）与 fail-closed 可用性判定，
但没有为 0.17 的既有 Host 注册提供迁移。数据文件本身完好，读取路径却把"缺少
新字段"判定为"项目不可用"，用户升级后历史项目在首屏消失——效果上等同数据破坏。
0.18.1 以启动期 grandfathering（复用 registry 绑定已保存目录）修复，并补充升级 E2E。

同类风险是结构性的：Pi 侧持久化数据（会话 JSONL、settings）有版本号与自动迁移链
（`CURRENT_SESSION_VERSION` + `migrateSessionEntries`），自始未发生过读取事故；
Storyflow 自有持久化数据（产品会话 JSONL、项目注册、Sources 配置）的兼容逻辑
则是逐案补丁（`todoState` 重命名、`legacyAgentRuntime` 标记、legacy 路径回退、
root 重定位），没有统一的版本声明与守护测试。

## 决策

1. **迁移先于校验门。** 对任何 Storyflow 持久化数据的读取路径新增不变量、必填
   字段或 fail-closed 判定时，同一版本必须附带对既有数据的 grandfathering 迁移；
   fail-closed 只允许作用于迁移后仍不可解析的数据。
2. **新增持久化字段默认 additive-optional。** 读取方对缺失字段取历史等价默认值，
   不得因字段缺失拒绝数据。
3. **产品会话 JSONL 引入 `schemaVersion`。** 新写入的会话 header 携带
   `SESSION_SCHEMA_VERSION`（当前为 1）；缺失视为 1，涵盖 0.18.x 及更早的全部
   格式。版本号只随不可 additive 表达的格式变更递增，且必须同时提供按旧版本
   键控的读取期迁移。
4. **旧格式快照是受保护的测试资产。** `legacy-data-contract.test.ts` 冻结
   0.15（claude-sdk、legacy 路径、`todoState`、异机绝对路径）与 0.17/0.18
   （无版本号 Pi 会话）两代真实磁盘格式，断言当前读取器保持其可列出、可迁移、
   可重定位。快照字面量不得"现代化"；新一代格式冻结时追加新快照，不改旧快照。
5. **既有读取期迁移是本契约的一部分。** `todoState → sessionStatus`、
   `agentRuntime → legacyAgentRuntime`、legacy `sessions/` 路径回退与
   workspaceRootPath 重定位在对应快照仍存在于用户磁盘期间不得移除。

## 后果

- 数据格式演进的成本显式化：每次演进 = 版本递增 + 迁移函数 + 新冻结快照。
  这比事后修复读取事故（0.18.0 → 0.18.1 的紧急版本）廉价且可预期。
- 升级 E2E（v0.17 项目身份）与本 ADR 的会话层快照测试共同构成两级数据契约门：
  前者覆盖 Host 注册与项目身份，后者覆盖会话存储格式本身。
- Pi 侧持久化数据不在本 ADR 范围内：其版本化与迁移由 Pi 拥有（ADR 0018），
  Storyflow 升级 Pi 时仅需确认 `CURRENT_SESSION_VERSION` 兼容性。

## 非目标

- 不为 Storyflow 数据建立与 Pi `migrateSessionEntries` 对等的集中迁移框架；
  在版本号只有 1 的当下，读取期逐案迁移加冻结快照已满足需求，框架待第二个
  真实版本出现时再评估。
- 不追溯改写用户磁盘上的旧会话文件；迁移一律发生在读取投影层。
