# ADR 0015: 身份会话、托管模型能力与 Provider 凭证分离

状态：Accepted
日期：2026-08-03

## 背景

旧链路把一次账户登录获得的短期模型 token 投影成多个 `llm_api_key`，再由 Agent 和模型发现逻辑从
CredentialManager 反向读取。一个事实因此拥有多份副本，刷新、撤销、健康检查和连接选择互相耦合；
空凭证仓库也会被误报为系统故障。

## 决策

- 桌面只持久化可续期的 Identity Session；Managed Model Access 不落盘。服务端账号授权、会话及撤销事实由 Auth Broker 的 D1 持久化。
- Host 在显式操作前将 Managed Model Access 传给 Session Runtime；运行中不轮换 token（以 ADR 0018 为准）。
- 仅受信任的内置托管连接使用 Managed Model Access；自定义 Provider 继续使用各自的 Provider Credential。
- Credential Store Health 只判断存储可读、可解密；连接可用性由连接与登录边界判断。
- 启动时只清理历史版本写入的保留托管凭证 ID，不扫描或删除用户自定义 Provider 凭证。

## 后果

托管 token 只有一个进程内事实源，刷新与撤销不再依赖凭证投影；应用重启后必须由 Identity Session
重新获取能力。自定义 Provider 行为保持不变。迁移期保留一次精确的旧投影清理，之后可删除该兼容逻辑。

## 非目标

- 不合并账户鉴权与自定义 Provider 鉴权。
- 不引入新的认证框架、凭证工厂或通用 token 抽象。
- 不用 Credential Store Health 代替模型连接诊断。

## 2026-09-16 修订：当前权限与撤销（#42）

每次真实登录建立随机 `sid`，续签保持原始认证时间、90 天绝对期限和同一会话。账号权限采用有限 scopes 与模型集合，standard/pro 保留兼容输出，不作为权限事实；新登录不覆盖已有授权。管理员通过 Cloudflare 运维身份、参数化 D1 命令修改授权，数据库事务与触发器共同提交审计和撤销。

Model/Tool Gateway 在本地验证签名及声明后，通过 Service Binding 调用 Broker 的内部授权入口，以 D1 `first-primary` 读取当前状态。每个新请求检查一次，无允许结果缓存；依赖不可用返回 503 且不调用上游。相较纯 JWT，此决策增加每次请求一次内部 RPC 和主库查询，换取撤销完成后的可见性；已通过检查的请求按原生命周期结束。

退出先清除本机身份并使迟到结果失效，再以捕获的旧身份请求撤销；远端未确认时明确提示，不保留旧凭证建立后台队列。禁用账号同时撤销旧会话，重新启用不复活旧 sid。模型恢复只供下一次显式操作，重试和兜底由 #41/Pi 持有。

迁移配置暂为 `legacy`，不宣称旧 token 可撤销。服务、数据库、客户端就绪后受控切换 `required`，旧无 sid 会话必须重新登录；不允许凭旧 token 自动建立会话。上线后禁止回滚到无状态放行版本，见 [QA 与切换流程](../managed-access-qa.md)。身份方后台封禁的实时同步不在本次边界内。
