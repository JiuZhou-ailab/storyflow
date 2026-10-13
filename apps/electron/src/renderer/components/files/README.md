# File workspace

- `FileViewer` routes original text and existing media previews. Text/JSON/Markdown do not pass through rich-text serialization. In a Project, text files are hosted by the workspace document view instead (see `writing/useWritingDocument`).
- `TextSource` owns only the native input, line gutter and source-search selection.
- `TextDocument` autosaves through the versioned file RPC; the only choice it surfaces is a conflict (keep my version / use the disk version). Runtime and Session identities accompany every operation. Its parts are exported: `TextDocumentBar` (one status/conflict bar per document, any view), `TextDocumentSource` (the original-text view) and `useDocumentAutosave` (shared with the Project document view).
- `text-document-state` owns one versioned draft per file across views and remounts and rejects stale reads. Watchers may refresh clean buffers; dirty buffers retain their text and report external changes. A view holding unserialized edits registers `flush`; `autosave` drafts are saved silently on leave instead of prompting, unless they conflict; `keepDraft` resolves a conflict by writing the draft over the current disk version, or recreating a deleted file.
- `DocumentLeaveDialog` hosts the shared save/discard/cancel gate for navigation, file switching and native exit. It is mounted once at the application boundary.

The host layout accepts content without requiring a filesystem identity. No browser/chat placeholder, provider call, or plugin registry is introduced. Electron behavior is verified by the text-workspace acceptance run; concurrency and authorization are checked at the file RPC boundary.
