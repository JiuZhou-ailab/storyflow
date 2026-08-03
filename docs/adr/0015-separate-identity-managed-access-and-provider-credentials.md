# ADR 0015: 身份会话、托管模型能力与 Provider 凭证分离

状态：Accepted
日期：2026-08-03

## 背景

旧链路把一次账户登录获得的短期模型 token 投影成多个 `llm_api_key`，再由 Agent 和模型发现逻辑从
CredentialManager 反向读取。一个事实因此拥有多份副本，刷新、撤销、健康检查和连接选择互相耦合；
空凭证仓库也会被误报为系统故障。

## 决策

- 只持久化可续期的 Identity Session；Managed Model Access 不落盘。
- Host 将 Managed Model Access 直接传给 Session Runtime，并在运行中通过显式 token update 更新。
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
