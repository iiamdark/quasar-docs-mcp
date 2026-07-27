<picture>
  <img alt="Quasar Store Docs MCP" src="banner.png">
</picture>

# Quasar Store Docs MCP

An open-source MCP (Model Context Protocol) server that lets AI coding assistants query the public **Quasar Store** documentation in real time.

Fully compatible with **Claude Desktop**, **Claude Code**, **Antigravity** (Google), **OpenCode**, **VS Code** (via Cline, Continue, or Copilot MCP), **Cursor**, and any MCP-compatible client.

By default, the server is pre-configured to work with the live [Quasar Store documentation](https://www.quasar-store.com/docs) — no environment variables or additional setup required.

---

## Table of Contents

- [Tools](#tools)
- [How It Works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Step-by-Step Setup](#step-by-step-setup)
- [Configuration](#configuration)
  - [Environment Variable](#environment-variable-optional)
  - [CSS Selectors](#css-selectors)
- [Client Integration](#client-integration)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code](#claude-code)
  - [Antigravity (Google)](#antigravity-google)
  - [OpenCode](#opencode)
  - [VS Code](#vs-code-cline-continue-copilot)
  - [Cursor](#cursor)
- [Usage Examples](#usage-examples)
- [Project Structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Tools

| Tool | Type | Description |
| --- | --- | --- |
| `list_docs` | Discovery | Lists all documentation products with article counts, overview URLs, and section names. No arguments needed. |
| `search_docs` | Search | Searches documentation by keyword. Returns matching article titles, URLs, and snippets. |
| `read_doc` | Read | Fetches full article content as formatted Markdown. Accepts a URL or relative path. |

---

## How It Works

The server connects to `https://www.quasar-store.com/docs` and extracts documentation content by scraping the public HTML pages.

The Quasar Store documentation is built with **Next.js** and uses **React Server Components (RSC)**. The server handles this with a three-layer strategy:

1. **Scans the raw HTML** for all `/docs/...` links embedded in the RSC payload, building a complete index of every documentation article (40+ products, each with multiple sub-pages).
2. **Extracts article content** from the RSC data using a best-effort text parser that pulls out headings, paragraphs, and code blocks. If the RSC method fails, it falls back to traditional **cheerio** DOM extraction.
3. **As a last resort**, it returns the article title, meta description, and a list of related documentation links so the AI still receives useful navigation.

The server communicates with your AI client via **stdio** (standard input/output) using the **JSON-RPC** protocol — no HTTP server, no open ports, no network configuration needed.

---

## Requirements

- **Node.js** >= 18
- **npm** (comes with Node.js)

---

## Installation

You have two options:

### Option A: Install via npx (recommended — no clone needed)

The package is published on npm, so you can run it directly without cloning or installing:

```bash
npx -y quasar-store-docs-mcp
```

Then in your MCP client configs, just reference `npx` as the command:

```json
{
  "command": "npx",
  "args": ["-y", "quasar-store-docs-mcp"]
}
```

> **Note:** `-y` tells npx to auto-confirm the install. Omit it if you want a confirmation prompt.

### Option B: Clone and build locally

```bash
git clone https://github.com/iiamdark/quasar-docs-mcp.git
cd quasar-docs-mcp
npm install
npm run build
npm link                    # makes `quasar-store-docs-mcp` available globally
```

To verify the link worked:

```bash
which quasar-store-docs-mcp   # macOS / Linux
where quasar-store-docs-mcp   # Windows
```

You should see a path like `/usr/local/bin/quasar-store-docs-mcp` or `C:\Users\...\npm\quasar-store-docs-mcp`.

---

## Configuration

The server works **out of the box** with `https://www.quasar-store.com` as the documentation base. You do not need to set any environment variables.

### Environment Variable (optional)

To point the server at a different documentation site:

```bash
# macOS / Linux
export DOCS_BASE_URL="https://your-docs-site.com"

# Windows (Command Prompt)
set DOCS_BASE_URL=https://your-docs-site.com

# Windows (PowerShell)
$env:DOCS_BASE_URL = "https://your-docs-site.com"
```

If not set, the server defaults to `https://www.quasar-store.com`.

### CSS Selectors

If you are using the server with a different documentation site, you may need to adjust the CSS selectors in `src/index.ts`:

```typescript
const SELECTORS = {
  article: "article, .doc-content, .markdown-body, main, .docs-content-page",
  title: "h1",
  navLinks: "nav a, .sidebar a, .toc a, aside a",
};
```

---

## Client Integration

You have three options for referencing the server in your MCP client configuration:

- **Option A (recommended — no install):** Use `npx -y quasar-store-docs-mcp` — works without cloning or building
- **Option B:** Use the global command `quasar-store-docs-mcp` (after running `npm link`)
- **Option C:** Use the full path to `build/index.js` directly

### Claude Desktop

Configuration file: `claude_desktop_config.json`

**Option A — with npx (no install needed):**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "npx",
      "args": ["-y", "quasar-store-docs-mcp"]
    }
  }
}
```

**Option B — with npm link:**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "quasar-store-docs-mcp"
    }
  }
}
```

**Option C — with direct path:**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "node",
      "args": ["/full/path/to/quasar-docs-mcp/build/index.js"]
    }
  }
}
```

### Claude Code

```bash
# Option A — with npx:
claude mcp add quasar-store-docs -- npx -y quasar-store-docs-mcp

# Option B — with npm link:
claude mcp add quasar-store-docs -- quasar-store-docs-mcp

# Option C — with direct path:
claude mcp add quasar-store-docs -- node /full/path/to/quasar-docs-mcp/build/index.js
```

### Antigravity (Google)

Antigravity reads MCP server configurations from **`~/.gemini/config/mcp_config.json`** (global) or **`.agents/mcp_config.json`** (per-project).

**Option A — with npx (no install needed):**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "npx",
      "args": ["-y", "quasar-store-docs-mcp"]
    }
  }
}
```

**Option B — with npm link or locally built:**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "quasar-store-docs-mcp"
    }
  }
}
```

After saving:
1. Restart Antigravity, or
2. Open the agent sidebar → click `...` → `MCP Servers` → `Manage MCP Servers` → the server should appear in the list.

### OpenCode

OpenCode uses a configuration file at **`~/.config/opencode/opencode.json`**. The format is different from other clients:

**Option A — with npx:**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "quasar-store-docs": {
      "type": "local",
      "command": ["npx", "-y", "quasar-store-docs-mcp"],
      "enabled": true
    }
  }
}
```

**Option B — with npm link:**

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "quasar-store-docs": {
      "type": "local",
      "command": ["quasar-store-docs-mcp"],
      "enabled": true
    }
  }
}
```

> **Differences from other clients:** OpenCode uses `"mcp"` (not `"mcpServers"`). The `command` field is an **array**. Each server requires `"type": "local"` and `"enabled": true`.

### VS Code (Cline, Continue, Copilot)

**Option A — with npx:**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "npx",
      "args": ["-y", "quasar-store-docs-mcp"]
    }
  }
}
```

**Option B — with npm link or locally built:**

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "quasar-store-docs-mcp"
    }
  }
}
```

### Cursor

**Option A — with npx:**

```
Name: quasar-store-docs
Type: command
Command: npx -y quasar-store-docs-mcp
```

**Option B — with npm link:**

```
Name: quasar-store-docs
Type: command
Command: quasar-store-docs-mcp
```

---

## Tools Quick Reference

---

### `list_docs` — Browse available documentation

Lists every product/category indexed from the Quasar Store docs (93 products total).

**Signature:**

```
list_docs()
```

No arguments needed.

**Example output (truncated):**

```
Available documentation categories (93 total):

### Advanced Inventory
Articles: 6 | Overview: https://www.quasar-store.com/docs/advanced-inventory
Sections: Commands And Exports, Convert Inventory Items, General Integrations, How To Create Missions, Installation, Item Configuration

### Housing Creator
Articles: 4 | Overview: https://www.quasar-store.com/docs/housing-creator
Sections: Commands And Exports, Installation, Inventory Items

### Smartphone
Articles: 5 | Overview: https://www.quasar-store.com/docs/smartphone
Sections: Commands And Exports, How To Install Apps, Installation
...
```

**When to use:** When you don't know what documentation exists. Start here to discover products, then search or read specific articles.

---

### `search_docs` — Find articles by keyword

Searches article titles and URLs for a query term.

**Signature:**

```
search_docs(query: string)
```

| Argument | Type | Description |
| --- | --- | --- |
| `query` | string (required) | Search term. Matches against article titles and URLs. Case insensitive. |

**Good queries:** `"installation"`, `"database errors"`, `"advanced inventory"`, `"commands"`, `"exports"`, `"common issues"`

**Example output:**

```
Results for "installation":

1. **Smartphone — Installation**
   URL: https://www.quasar-store.com/docs/smartphone/installation
   Documentation: Smartphone — Installation

2. **Advanced Inventory — Installation**
   URL: https://www.quasar-store.com/docs/advanced-inventory/installation
   Documentation: Advanced Inventory — Installation

3. **Police Creator — Installation**
   URL: https://www.quasar-store.com/docs/police-creator/installation
   Documentation: Police Creator — Installation
```

**When to use:** When you know roughly what you're looking for. The search covers article titles and URLs, so use specific keywords.

**No results?** The tool returns the first 15 available articles as a fallback, so the AI can still see what exists.

---

### `read_doc` — Read full article content

Fetches a documentation article and returns it as formatted Markdown.

**Signature:**

```
read_doc(url: string)
```

| Argument | Type | Description | Examples |
| --- | --- | --- | --- |
| `url` | string (required) | Full URL **or** relative path. The server resolves relative paths against the base URL. | `"advanced-inventory/installation"` `"https://www.quasar-store.com/docs/smartphone/installation"` `"housing-creator/commands-and-exports"` |

**Example output:**

```markdown
# Installation

> Installation guide — please follow each step carefully and exactly as described to ensure the script works correctly on your server.

---

Download the script assets from the Cfx.re portal...

## Step 1: Download

Open the Cfx.re granted assets page...

## Step 2: Add to server

Place the folder in your `resources` directory...

---
Source: https://www.quasar-store.com/docs/advanced-inventory/installation
```

**What gets extracted:**
- Article title and meta description
- Section headings (converted to Markdown `#` / `##` / `###`)
- Paragraphs of explanatory text
- Code blocks
- Lists (bulleted and numbered)
- Tables (converted to Markdown table format)
- Blockquotes

**When to use:** After finding an article via `list_docs` or `search_docs`. Pass the URL or relative path to get the full content.

---

## Usage Examples

Once configured, your AI assistant will automatically discover the 3 available tools and use them when relevant. Here are typical interaction patterns:

### Pattern: Discover → Search → Read

This is the most common workflow:

| Step | Trigger | Tool called |
| --- | --- | --- |
| 1 | "What documentation exists for housing?" | `list_docs()` → finds "Housing Creator" |
| 2 | "How do I install it?" | `search_docs("housing creator installation")` → finds the installation article |
| 3 | "Read it to me" | `read_doc("housing-creator/installation")` → returns full content |

### Conversation examples

| You ask... | The AI calls... | Result |
| --- | --- | --- |
| "What documentation is available?" | `list_docs()` | Full product listing with 93 categories |
| "How do I install Advanced Inventory?" | `search_docs("advanced inventory installation")` | Links to installation guides |
| "What are common database errors?" | `search_docs("database errors")` | Troubleshooting articles |
| "Explain the housing creator features" | `search_docs("housing creator")` + `read_doc(...)` | Full article content |
| "Read me the smartphone commands" | `read_doc("smartphone/commands-and-exports")` | Commands in Markdown |
| "What sections does Admin Menu have?" | `list_docs()` → find "Admin Menu" in output | Section listing for Admin Menu |

---

## Project Structure

```
quasar-docs-mcp/
│
├── src/
│   └── index.ts              # MCP server implementation
│
├── build/                    # Compiled JavaScript output (generated)
│
├── banner.png                # README banner image
├── package.json              # Dependencies, scripts, and metadata
├── tsconfig.json             # TypeScript compiler configuration
└── README.md                 # This file
```

### Key files explained

| File | Purpose |
|---|---|
| `src/index.ts` | Complete MCP server: initializes the server, registers `list_docs`, `search_docs`, and `read_doc` tools, implements web scraping with axios + cheerio, handles RSC payload extraction for Next.js sites, and includes an in-memory cache with TTL |
| `package.json` | Project metadata, dependencies (`@modelcontextprotocol/sdk`, `axios`, `cheerio`, `zod`), build scripts |
| `tsconfig.json` | TypeScript configuration targeting ES2022 with Node16 module resolution |
| `build/index.js` | Compiled output — this is what you reference in your MCP client configs |

---

## Troubleshooting

### "Command not found: quasar-store-docs-mcp"

You have not run `npm link`, or the npm global bin directory is not in your PATH.

- Run `npm link` from the project directory
- Or use the full path to `build/index.js` in your client config

### Server starts but tools return errors

- Check that `https://www.quasar-store.com` is accessible from your network
- Try setting a different `DOCS_BASE_URL` if you are using a custom documentation site

### "Article not found (404)"

- Make sure the URL or path is correct
- Relative paths should be relative to the docs base URL (e.g. `advanced-inventory/installation`)
- You can always use a full URL directly

### Content extraction returns mostly empty

The Quasar Store docs site uses Next.js with client-side rendering for some content. The server tries multiple extraction strategies (RSC → cheerio → related links). If all fail, the AI will still receive the article title, description, and navigation links to related articles.

---

## License

```
MIT License

Copyright (c) 2026 iiamdark

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

*Built with [Model Context Protocol](https://modelcontextprotocol.io) — an open standard for connecting AI assistants with tools and data.*
