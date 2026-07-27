# Quasar Store Docs MCP

An open-source MCP (Model Context Protocol) server that lets AI assistants query the public **Quasar Store** documentation via web scraping. Fully compatible with **Claude Desktop**, **Claude Code**, **OpenCode**, **Cursor**, **VS Code Copilot (via MCP)**, and any MCP-compatible client.

By default, the server is pre-configured to work with the live [Quasar Store documentation](https://www.quasar-store.com/docs) — no extra setup required.

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

The server works out of the box with **https://www.quasar-store.com** as the documentation base. No environment variables are required.

### Environment variable (optional)

To point the server at a different documentation site:

```bash
export DOCS_BASE_URL="https://your-docs-site.com"
```

If not set, the server defaults to `https://www.quasar-store.com`.

### CSS Selectors

In `src/index.ts` you can adjust the `SELECTORS` object to match your documentation site's HTML structure:

```typescript
const SELECTORS = {
  article: "article, .doc-content, .markdown-body, main, .docs-content-page",
  title: "h1",
  navLinks: "nav a, .sidebar a, .toc a, aside a",
};
```

### How it works with the Quasar Store site

The Quasar Store documentation is built with Next.js and uses React Server Components (RSC). The server handles this by:

1. **Search**: Scans the raw HTML for `/docs/...` links embedded in the RSC payload, building a complete index of all documentation articles and their categories.
2. **Content reading**: Extracts article text from the RSC data using a best-effort parser that pulls out headings and paragraphs. Falls back gracefully to cheerio-based extraction for traditional HTML sites.
3. **Fallback**: If content extraction fails, the server returns the page title, meta description, and a list of related documentation links.

### Integration with MCP clients

#### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "node",
      "args": ["/path/to/quasar-docs-mcp/build/index.js"]
    }
  }
}
```

#### Claude Code

```bash
claude mcp add quasar-store-docs -- node /path/to/quasar-docs-mcp/build/index.js
```

#### OpenCode (VS Code)

Add to your `settings.json`:

```json
{
  "mcpServers": {
    "quasar-store-docs": {
      "command": "node",
      "args": ["/path/to/quasar-docs-mcp/build/index.js"]
    }
  }
}
```

## Usage

Once configured, any MCP client can:

1. **Search articles** with `search_docs` using a term like `"installation"`, `"database errors"`, or `"advanced inventory"`.
2. **Read full articles** with `read_doc` using the URL or path returned by the search (e.g. `"advanced-inventory/installation"` or a full URL).

### Example queries

| User says... | Tool called | Result |
|---|---|---|
| "How do I install Advanced Inventory?" | `search_docs("advanced inventory installation")` | Returns matching docs pages |
| "What are common database errors?" | `search_docs("database errors")` | Returns relevant troubleshooting articles |
| "Read me the installation guide" | `read_doc("advanced-inventory/installation")` | Returns full article content in Markdown |

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
