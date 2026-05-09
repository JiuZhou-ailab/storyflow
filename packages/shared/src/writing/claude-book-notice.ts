// input: Claude-Book source metadata used for attribution
// output: Notice text for novel writing scaffolds and skill bundles
// pos: License attribution boundary for Claude-Book-inspired writing features

export const CLAUDE_BOOK_SOURCE_URL = "https://github.com/ThomasHoussin/Claude-Book";
export const CLAUDE_BOOK_LICENSE = "MIT";
export const CLAUDE_BOOK_INSPECTED_REVISION = "3fdebbb576b1be6d123b48258d2310c5dff013c4";

export function getClaudeBookNotice(): string {
  return `# Claude-Book Notice

Portions of the novel writing structure and skill concepts are adapted from Claude-Book.

- Source: ${CLAUDE_BOOK_SOURCE_URL}
- License: ${CLAUDE_BOOK_LICENSE}
- Inspected revision: ${CLAUDE_BOOK_INSPECTED_REVISION}

This project rewrites the concepts for Craft Agent's workspace and skill model. Claude-Book's original MIT license applies to adapted concepts and any copied text.
`;
}
