# File workspace

- `FileViewer` routes original text and existing media previews. Text/JSON/Markdown do not pass through rich-text serialization; the explicit writing-mode action retains the specialized editor.
- `TextSource` owns only the native input, line gutter and source-search selection.
- `TextDocument` exposes explicit save, Save As, conflicts and readable recovery copies through the versioned file RPC. Runtime and Session identities accompany every operation.
- `text-document-state` owns file buffers across view remounts and rejects stale reads. Watchers may refresh clean buffers; dirty buffers retain their text and report external changes.
- `DocumentLeaveDialog` hosts the shared save/discard/cancel gate for navigation, file switching and native exit. It is mounted once at the application boundary.

The host layout accepts content without requiring a filesystem identity. No browser/chat placeholder, provider call, or plugin registry is introduced. Electron behavior is verified by the text-workspace acceptance run; concurrency and authorization are checked at the file RPC boundary.
