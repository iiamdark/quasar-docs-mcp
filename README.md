# Quasar Store Docs MCP

An open-source MCP (Model Context Protocol) server that lets AI assistants query the public **Quasar Store** documentation via web scraping. Fully compatible with **Claude Desktop**, **Claude Code**, **OpenCode**, **Cursor**, **VS Code Copilot (via MCP)**, and any MCP-compatible client.

## Tools

| Tool         | Description                                                        |
| ------------ | ------------------------------------------------------------------ |
| `search_docs`| Search documentation articles by a query term.                     |
| `read_doc`   | Read the full content of a documentation article by URL or path.   |

## Requirements

- Node.js >= 18
- npm

## Installation

```bash
git clone https://github.com/iiamdark/quasar-docs-mcp.git
cd quasar-docs-mcp
npm install
```

## Build

```bash
npm run build
```

The compiled output goes to `build/`.

## Configuration

### Environment variable

Set the base URL of your documentation:

```bash
# Linux / macOS
export DOCS_BASE_URL="https://docs.example.com/quasar-store"

# Windows (Command Prompt)
set DOCS_BASE_URL=https://docs.example.com/quasar-store

# Windows (PowerShell)
$env:DOCS_BASE_URL = "https://docs.example.com/quasar-store"
```

If not set, the server defaults to `https://docs.example.com/quasar-store`.

### CSS Selectors

In `src/index.ts` you can adjust the `SELECTORS` object to match your documentation site's HTML structure:

```typescript
const SELECTORS = {
  article: "article, .doc-content, .markdown-body, main",
  title: "h1",
  navLinks: "nav a, .sidebar a, .toc a",
};
```

### Integration with MCP clients

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "node",
      "args": ["/path/to/quasar-docs-mcp/build/index.js"],
      "env": {
        "DOCS_BASE_URL": "https://docs.example.com/quasar-store"
      }
    }
  }
}
```

#### Claude Code

```bash
claude mcp add quasar-store-docs -e DOCS_BASE_URL=https://docs.example.com/quasar-store -- node /path/to/quasar-docs-mcp/build/index.js
```

#### OpenCode (VS Code)

Add to your `settings.json`:

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "node",
      "args": ["/path/to/quasar-docs-mcp/build/index.js"],
      "env": {
        "DOCS_BASE_URL": "https://docs.example.com/quasar-store"
      }
    }
  }
}
```

## Usage

Once configured, any MCP client can:

1. **Search articles** with `search_docs` using a term like `"script installation"` or `"database errors"`.
2. **Read full articles** with `read_doc` using the URL or path returned by the search.

## Project structure

```
quasar-docs-mcp/
├── src/
│   └── index.ts          # MCP server implementation
├── build/                # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
