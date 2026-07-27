# ADR 0009: 文档原件不可变，模型消费派生表示

状态：Accepted
日期：2026-07-27

## 背景

附件存储曾把压缩后的图片写回 `storedPath`，Office Markdown、缩略图和模型输入又分别散落在可选字段
与会话 JSONL 中。这样既丢失用户原件，也让 Claude、Pi 和未来 provider 重复理解文件格式与路径。
把所有文件统一成 TXT 同样会丢失结构、版面和图像，不能成为长期事实源。

## 决策

- 用户上传的 Source Document 按原始字节不可变存储，并记录内容哈希；它是附件唯一事实源。
- Markdown、缩略图和经过尺寸约束的模型输入都是 Document Representation，拥有独立路径、媒体类型、
  字节数与哈希，可删除、重建或更换生成器。
- 会话只持久化原件和表示的元数据，不持久化用于单次传输的 base64。
- provider 复用同一个附件上下文选择器；Claude 可以继续原生消费 PDF，其他 runtime 可优先读取
  Markdown，格式转换细节不进入 provider。
- 旧会话的 `storedPath`、`markdownPath` 和 `thumbnailPath` 继续作为兼容投影，新写入同时生成
  `representations`，不执行破坏性历史迁移。

## 后果

- 原件下载、重新处理和审计不再受模型优化影响，跨 provider 行为拥有同一事实源。
- 当前保留已有 `markitdown-js` 与 CLI 文档工具作为适配器；只有实际出现扫描件需求时才增加 OCR 表示，
  只有大文档读取超过现有预算时才增加索引或 embedding。

## 非目标

- 不把所有格式强制降级为纯文本。
- 不在本次变更中建立文档数据库、任务队列、OCR 服务或 RAG 系统。
