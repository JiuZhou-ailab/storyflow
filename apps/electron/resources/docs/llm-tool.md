# LLM Tool (`call_llm`)

Invoke a secondary model for a focused, single-turn task. The call has no
conversation history or tools, so it is useful for context isolation, batch
processing, summarization, classification, and extraction.

The tool uses the current session's Pi model registry and credentials, including
API key, OAuth, managed, and custom-endpoint connections.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | string | Instructions for the model (required) |
| `attachments` | array | Existing text-file paths, optionally with line ranges |
| `model` | string | Model ID or short name; defaults to the session's fast model |
| `systemPrompt` | string | Optional system prompt |
| `outputFormat` | enum | Predefined JSON shape requested through prompt instructions |
| `outputSchema` | object | Custom JSON Schema requested through prompt instructions |

Put inline content in `prompt`. Use `attachments` only for files already on disk.
Image attachments are not supported.

## Attachments

```typescript
// Simple file
attachments: ["/src/auth.ts"]

// Large file section (1-indexed, inclusive)
attachments: [{ path: "/logs/app.log", startLine: 1000, endLine: 1500 }]
```

Relative paths resolve from the current session directory. Files larger than
2,000 lines or 500 KB require a line range.

| Constraint | Limit |
|------------|-------|
| Attachments | 20 per call |
| Text per file | 2,000 lines or 500 KB |
| Selected line range | 2,000 lines |
| Total attachment content | 2 MB |

## JSON Output

`outputFormat` and `outputSchema` add explicit schema instructions to the system
prompt. This improves consistency but is not provider-native constrained
decoding. Parse and validate the returned JSON before using it as trusted data.

Predefined formats:

| Format | Requested shape |
|--------|-----------------|
| `summary` | `{ summary, key_points[], word_count }` |
| `classification` | `{ category, confidence, reasoning }` |
| `extraction` | `{ items[], count }` |
| `analysis` | `{ findings[], issues[], recommendations[] }` |
| `comparison` | `{ similarities[], differences[], verdict }` |
| `validation` | `{ valid, errors[], warnings[] }` |

## Parallel Calls

Independent calls emitted in one assistant message run in parallel:

```typescript
call_llm({ prompt: "Summarize", attachments: ["/file1.ts"] })
call_llm({ prompt: "Summarize", attachments: ["/file2.ts"] })
```

## Examples

### Summarize a File

```typescript
call_llm({
  prompt: "Summarize the main functionality",
  attachments: ["/src/auth/handler.ts"]
})
```

### Extract Structured Data

```typescript
call_llm({
  prompt: "Extract all API endpoints",
  attachments: ["/src/routes.ts"],
  outputSchema: {
    type: "object",
    properties: {
      endpoints: {
        type: "array",
        items: {
          type: "object",
          properties: {
            method: { type: "string" },
            path: { type: "string" }
          }
        }
      }
    },
    required: ["endpoints"]
  }
})
```

## When Not to Use

- The current agent can do the task directly without isolating context.
- The subtask needs conversation history.
- The subtask needs file, shell, browser, or source tools.
- A deterministic parser or script is more reliable than an LLM.
