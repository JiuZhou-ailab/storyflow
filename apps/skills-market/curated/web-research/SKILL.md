---
name: web-research
description: Search the live web through Storyflow's managed web_search capability and synthesize source-backed answers. Use for current facts, source discovery, fact-checking, comparisons, and research that benefits from fresh web evidence.
---

# Web Research

1. Use Storyflow's built-in `web_search` tool for every live-web query.
2. Split unrelated questions into focused searches; refine only when the first results are insufficient.
3. Prefer primary and authoritative sources. Distinguish sourced facts from inference.
4. Cite the supporting URLs near the claims they support.
5. Never request, persist, or configure provider API keys, MCP endpoints, or provider CLIs. Storyflow owns authentication, routing, timeouts, and fallback.
6. If the managed tool and its fallback are unavailable, report that limitation instead of bypassing the host through a provider-specific command.
