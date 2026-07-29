# ADR 0010: 全局 Skills 与本机用户信任域

状态：Superseded by ADR 0011
日期：2026-07-28

## 背景

Project 同时承担会话归属、默认工作目录和 Agent 授权，导致同一 Skill 在 Project 与 Free Conversation 中出现不同事实源，也让自由对话比项目对话更受限。用户实际把本机所有项目视为同一信任域，因此项目级 Skill 覆盖和项目级文件授权都没有表达真实产品边界。

## 决策

- Skills 只有一个事实源：`~/.craft-agent/skills/<slug>/`。所有本地项目共享；远端运行时使用远端用户自己的同一路径。
- 新 Skill 引用只编码全局 slug；旧的 project-qualified 引用仅作为读取兼容，不再生成。
- `workspaceId` 只负责选择会话归属、默认工作目录、项目 Source overlay、导航身份和本机/远端路由，不决定 Skill 所有权。
- Project Source overlay 保留。Sources 包含连接状态和项目语义，和 Skills 的复用范围是正交决策。
- Free Conversation 与 Project Conversation 都使用运行 Storyflow 的操作系统用户权限。Project 不是 sandbox，Explicit Attachment 也不是文件授权。
- Skill 创建、校验、删除和 Market 导入继续经过 Storyflow 的 slug、frontmatter、symlink、路径穿越和禁止静默覆盖检查。
- 旧 `<project>/.pi/skills/` 不再加载，也不自动合并。原目录保持不动，避免同 slug 冲突时发生静默覆盖或数据丢失。

## 保留的安全边界

- 凭据继续由 credential broker 管理，不进入 Skill 文档或通用上下文。
- 外部发布、消息、付费和不可逆操作仍需要各自的产品确认与服务端授权。
- 公共 Skill Package 继续执行摘要校验、内容验证、禁止 symlink/路径穿越和原子安装。

## 后果

优点：一个事实源、没有覆盖优先级、跨项目行为一致，Project 回到上下文边界而非伪安全边界。

代价：本地 Agent 拥有该操作系统用户本来就拥有的文件权限。需要强隔离的场景应运行在独立 OS 用户、容器或远端主机中，而不是重新引入项目级例外规则。

本 ADR 取代 ADR 0004 的项目级安装目标，并修订 ADR 0006 中项目 Skill overlay、Free Conversation 文件边界和 Project Resource Overlay 的相关决策。
