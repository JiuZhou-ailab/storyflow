# Legacy Writing Compatibility

读取旧写作 manifest、目录分类与写入策略，并提供选区改写纯函数；新项目不会生成这些元数据或目录。

- `manifest.ts`、`types.ts`：旧 `craft-writing.json` 的只读解析与内部类型。
- `file-categories.ts`：旧项目展示分类兼容，不参与 Agent 写入授权。
- `selection-context.ts`、`selection-rewrite.ts`：编辑器选区上下文与改写结果处理。
- `index.ts`：共享导出。
- `__tests__/`：兼容解析、写入边界和选区回归。
