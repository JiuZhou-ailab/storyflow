# File workspace

- `FileViewer` routes original text and existing media previews. Text/JSON/Markdown do not pass through rich-text serialization. In a Project, text files are hosted by the workspace document view instead (see `writing/useWritingDocument`).
- `TextSource` owns only the native input, line gutter and source-search selection.
- `TextDocument` exposes explicit save, Save As, conflicts and readable recovery copies through the versioned file RPC. Runtime and Session identities accompany every operation. Its parts are exported: `TextDocumentBar` (one status/save/recovery bar per document, any view) and `TextDocumentSource` (the original-text view).
- `text-document-state` owns one versioned draft per file across views and remounts and rejects stale reads. Watchers may refresh clean buffers; dirty buffers retain their text and report external changes. A view holding unserialized edits registers `flush`; `autosave` drafts are saved silently on leave instead of prompting, unless they conflict.
- `DocumentLeaveDialog` hosts the shared save/discard/cancel gate for navigation, file switching and native exit. It is mounted once at the application boundary.

The host layout accepts content without requiring a filesystem identity. No browser/chat placeholder, provider call, or plugin registry is introduced. Electron behavior is verified by the text-workspace acceptance run; concurrency and authorization are checked at the file RPC boundary.
