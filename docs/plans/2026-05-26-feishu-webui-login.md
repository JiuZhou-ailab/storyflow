# 飞书 Web UI 登录实现计划

## 目标

为 Web UI 增加飞书 OAuth 登录：公司内部飞书租户直接登录，外部飞书账号必须先存在于注册表；保留现有密码登录作为兼容回退。

## 决策

- 登录边界放在 Web UI auth 层，不放进 Lark/Feishu 消息机器人适配器。
- 内部账号判断使用飞书用户信息里的 `tenant_key` allow-list。
- 外部注册状态通过 `FeishuRegistrationStore` 抽象隔离，生产实现使用 Postgres/Neon，测试使用内存 fake。
- Neon 项目不写死在源码里，只通过 `CRAFT_WEBUI_AUTH_DATABASE_URL` 注入。
- 授权 URL 默认不带 `scope`，需要额外权限时通过 `CRAFT_WEBUI_FEISHU_SCOPE` 显式配置，避免把非飞书 scope 写死进登录流程。

## 实现步骤

1. 增加 `feishu-auth.ts` 服务层和单元测试，覆盖授权 URL、PKCE state、token/user info 解析、内部/外部访问决策。
2. 在 `http-server.ts` 增加 `/api/auth/feishu/config`、`/api/auth/feishu/start`、`/api/auth/feishu/callback`。
3. 在 headless server 解析飞书与数据库环境变量，并把配置传入 Web UI handler。
4. 在登录页按配置展示飞书登录按钮，密码登录保持原行为。
5. 更新 `implementation-notes.md` 记录非 spec 决策、Neon 区域建议和外部注册表行为。

## 验证

- `bun test packages/server-core/src/webui/feishu-auth.test.ts packages/server-core/src/webui/__tests__/http-server.test.ts`
- `bun run --filter @craft-agent/server-core typecheck`
- `bun run --filter @craft-agent/server typecheck`
- `bun run --filter @craft-agent/webui build`
