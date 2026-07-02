// input: Short-form writing workspace root path
// output: Short-form global, manuscript, and scratch starter files
// pos: Method Pack-specific scaffold kept out of the main novel-template router

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { ensureRecommendedWritingRoots } from "./workspace-roots.ts";

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function writeFileIfMissing(path: string, content: string): void {
  ensureDir(dirname(path));
  if (!existsSync(path)) {
    writeFileSync(path, content);
  }
}

export function scaffoldShortForm(rootPath: string): void {
  ensureRecommendedWritingRoots(rootPath);

  writeFileIfMissing(join(rootPath, "全局/创作要求.md"), `# 创作要求

> 跨项目长期生效的写作风格、读者偏好、禁区。每个新项目都会复制这份模板。

## 读者与题材偏好

- 偏好的读者类型：
- 偏好的题材方向：
- 不适合当前账号或品牌的题材：

## 叙事风格偏好

- 视角偏好（如：第一人称、女主第一人称、双视角切换）：
- 语气与节奏（如：口语、短句、对白驱动）：
- 段落长度倾向：
- 章节长度倾向：

## 内容边界

- 不能触碰的红线：
- 我反感的写法：
- 必须避免的角色关系或情节：

## 输出偏好

- 默认章节长度：
- 默认文件命名偏好：
- 修订时是否直接覆盖原文件：
`);

  writeFileIfMissing(join(rootPath, "全局/简报.md"), `# 简报

> 当前这本书的题材、卖点、目标读者、核心钩子与成功条件。简报变化时整体回看大纲。

## 题材定位

- 赛道（如：情感反转 / 复仇打脸 / 追妻火葬场 / 马甲爽文 / 其他）：
- 一句话卖点：
- 对标作品或桥段：

## 主角设置

- 性别 / 身份 / 起点：
- 核心动机：
- 反向标签（角色身上最反差的一点）：

## 目标读者

- 谁会一口气追完：
- 他们最在意什么：

## 核心钩子

- 开局承诺（一句话）：
- 全书最大的反转：
- 结尾交付：

## 篇幅与生产约束

- 目标章节数：
- 单章字数：
- 总字数目标：
- 交付节奏：

## 成功条件

- 哪些章节必须让读者停不下来：
- 哪些设定不能崩：

## 待确认问题

-
`);

  writeFileIfMissing(join(rootPath, "全局/大纲.md"), `# 大纲

> 分章计划。每章一段，记录目标、主要事件、状态变化和结尾承接。简报变化时整体回扫这份大纲。

## 全书弧线

- 起：
- 承：
- 转：
- 合：

## 分章计划

### 第 01 章

- 章节目标：
- 主要事件：
- 反转 / 信息差：
- 状态变化：
- 章末勾子：

### 第 02 章

- 章节目标：
- 主要事件：
- 反转 / 信息差：
- 状态变化：
- 章末勾子：
`);

  writeFileIfMissing(join(rootPath, "全局/人物.md"), `# 人物

> 主要角色档案。出场前先建档，避免动机和口吻在正文里漂移。

## 主角

- 名字 / 称呼：
- 身份 / 背景：
- 核心动机：
- 标志性口头禅 / 说话风格：
- 弱点 / 心理伤口：
- 成长弧线：

## 关键配角

### 角色 A

- 名字：
- 与主角的关系：
- 在本书的功能（推动反转 / 制造冲突 / 情感对照 / 其他）：
- 口吻与举止：

## 反派 / 阻力

- 名字：
- 与主角的对立点：
- 不写成纸片人需要保留的灰度：

## 关系网

- 主要关系节点：
- 易混淆的称呼或身份：
`);

  writeFileIfMissing(join(rootPath, "自由区", ".gitkeep"), "");
  writeFileIfMissing(join(rootPath, "正文", ".gitkeep"), "");
}
