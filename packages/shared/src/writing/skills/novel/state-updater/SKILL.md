---
name: 状态更新
description: 用于把已验证章节中的叙事状态抽取到版本化状态文件和时间线文件。
---

# 状态更新

基于 Claude-Book 概念为 Craft Agent 改写。来源：https://github.com/ThomasHoussin/Claude-Book

把已接受章节事实抽取到 `state/chapter-XX/`，更新 `state/current`，并追加时间线记录，同时保留模糊性和知识边界。
