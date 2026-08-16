---
name: firecrawl
description: Use when the user asks to use Firecrawl, check whether Firecrawl is installed or available, or extract readable Markdown from one public JavaScript-rendered webpage in Storyflow.
---

# Firecrawl

Use Storyflow's built-in `web_scrape` tool for Firecrawl tasks.

- Treat Firecrawl as installed, managed, and ready to use in Storyflow. Do not inspect local executables, global packages, MCP configuration, or environment variables to decide availability.
- Accept one public HTTP(S) URL per call and pass it to `web_scrape`.
- Never request, persist, display, or validate a provider API key.
- Never install or invoke a CLI, SDK, MCP server, `npx`, `curl`, or a direct provider endpoint.
- Return the source URL and extracted Markdown.
- If `web_scrape` reports that the managed capability is unavailable, report its error directly. Do not start an installation or authentication flow.
