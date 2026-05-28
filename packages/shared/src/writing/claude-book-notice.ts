// input: Claude-Book source metadata used for attribution
// output: Notice text for novel writing scaffolds and skill bundles
// pos: License attribution boundary for Claude-Book-inspired writing features

export const CLAUDE_BOOK_SOURCE_URL = "https://github.com/ThomasHoussin/Claude-Book";
export const CLAUDE_BOOK_LICENSE = "MIT";
export const CLAUDE_BOOK_INSPECTED_REVISION = "3fdebbb576b1be6d123b48258d2310c5dff013c4";

export function getClaudeBookNotice(): string {
  return `# Claude-Book 声明

本小说写作结构和部分 skill 概念基于 Claude-Book 改写。

- 来源：${CLAUDE_BOOK_SOURCE_URL}
- 许可证：${CLAUDE_BOOK_LICENSE}
- 已检查版本：${CLAUDE_BOOK_INSPECTED_REVISION}

本项目将相关概念改写为适配 Craft Agent 工作区和 skill 模型的版本。Claude-Book 原始 MIT 许可证适用于被改写的概念和任何复制文本。
`;
}
