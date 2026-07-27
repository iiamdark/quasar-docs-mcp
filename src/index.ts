#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Base configuration — Edit these URLs to point to your documentation
// ---------------------------------------------------------------------------

const DOCS_BASE_URL =
  process.env.DOCS_BASE_URL ?? "https://docs.example.com/quasar-store";

/** CSS selectors for extracting content from documentation pages. */
const SELECTORS = {
  /** Main article container. */
  article: "article, .doc-content, .markdown-body, main",
  /** Article title element. */
  title: "h1",
  /** Navigation links to other docs pages. */
  navLinks: "nav a, .sidebar a, .toc a",
};

// ---------------------------------------------------------------------------
// Content extraction utilities
// ---------------------------------------------------------------------------

/**
 * Extracts clean approximate Markdown text from an HTML page using cheerio.
 * Strips non-content elements and structures headings, lists, tables, and code blocks.
 */
function extractContentFromHtml(html: string, url: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header").remove();

  // Find the main article container
  const article = $(SELECTORS.article).first();
  const container = article.length > 0 ? article : $("body");

  // Extract title
  const title = $(SELECTORS.title).first().text().trim() || "Untitled";

  // Convert HTML to structured Markdown-like text
  let content = `# ${title}\n\n`;

  container.children().each((_, el) => {
    const tagName = $(el).prop("tagName")?.toLowerCase();
    const text = $(el).text().trim();

    if (!text) return;

    switch (tagName) {
      case "h1":
        content += `# ${text}\n\n`;
        break;
      case "h2":
        content += `## ${text}\n\n`;
        break;
      case "h3":
        content += `### ${text}\n\n`;
        break;
      case "h4":
        content += `#### ${text}\n\n`;
        break;
      case "h5":
      case "h6":
        content += `##### ${text}\n\n`;
        break;
      case "p":
        content += `${text}\n\n`;
        break;
      case "pre": {
        const code = $(el).find("code").text() || text;
        content += "```\n" + code + "\n```\n\n";
        break;
      }
      case "ul":
      case "ol":
        $(el)
          .find("li")
          .each((i, li) => {
            const prefix = tagName === "ol" ? `${i + 1}.` : "-";
            content += `${prefix} ${$(li).text().trim()}\n`;
          });
        content += "\n";
        break;
      case "table": {
        const rows: string[][] = [];
        $(el)
          .find("tr")
          .each((_, tr) => {
            const cells: string[] = [];
            $(tr)
              .find("th, td")
              .each((__, cell) => {
                cells.push($(cell).text().trim());
              });
            rows.push(cells);
          });

        if (rows.length > 0) {
          // Header row
          content += "| " + rows[0].join(" | ") + " |\n";
          content += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
          // Data rows
          for (let i = 1; i < rows.length; i++) {
            content += "| " + rows[i].join(" | ") + " |\n";
          }
          content += "\n";
        }
        break;
      }
      case "blockquote":
        content += `> ${text}\n\n`;
        break;
      default:
        // For other elements, include text if meaningful
        if (text.length > 0) {
          content += `${text}\n\n`;
        }
        break;
    }
  });

  // Attach source attribution
  content += `---\nSource: ${url}\n`;

  return content;
}

/**
 * Extracts navigation / index links from a documentation HTML page.
 * Returns an array of objects with title and absolute URL.
 */
function extractNavLinks(
  html: string,
  baseUrl: string
): Array<{ title: string; url: string }> {
  const $ = cheerio.load(html);
  const links: Array<{ title: string; url: string }> = [];

  $(SELECTORS.navLinks).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();

    if (!href || !title) return;

    try {
      const absoluteUrl = new URL(href, baseUrl).toString();
      // Only include links that belong to the documentation domain
      if (absoluteUrl.startsWith(new URL(baseUrl).origin)) {
        links.push({ title, url: absoluteUrl });
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return links;
}

/**
 * Searches documentation articles by filtering navigation link titles
 * against the provided query term.
 */
async function searchDocs(
  query: string
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  try {
    const { data: html } = await axios.get<string>(DOCS_BASE_URL, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "QuasarStoreDocsMCP/1.0 (compatible; MCP-Client)",
      },
    });

    const links = extractNavLinks(html, DOCS_BASE_URL);
    const lowerQuery = query.toLowerCase();

    // Filter links whose title contains the search term
    const results = links
      .filter((link) => link.title.toLowerCase().includes(lowerQuery))
      .map((link) => ({
        title: link.title,
        url: link.url,
        snippet: `Documentation: ${link.title}`,
      }));

    // If no direct matches, return first 10 available links for refinement
    if (results.length === 0) {
      return links.slice(0, 10).map((link) => ({
        title: link.title,
        url: link.url,
        snippet: `(no exact match for "${query}") — available in documentation`,
      }));
    }

    return results;
  } catch (error) {
    throw new Error(
      `Error searching documentation: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Reads the full content of a documentation article from its URL.
 * Accepts both absolute URLs and relative paths.
 */
async function readDoc(urlOrId: string): Promise<string> {
  // If not a full URL, treat as a relative path from DOCS_BASE_URL
  let url: string;
  if (urlOrId.startsWith("http://") || urlOrId.startsWith("https://")) {
    url = urlOrId;
  } else {
    url = `${DOCS_BASE_URL}/${urlOrId.replace(/^\/+/, "")}`;
  }

  try {
    const { data: html } = await axios.get<string>(url, {
      timeout: 15_000,
      headers: {
        "User-Agent":
          "QuasarStoreDocsMCP/1.0 (compatible; MCP-Client)",
      },
    });

    return extractContentFromHtml(html, url);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return `Error: Article at "${url}" was not found (404). Please verify the URL is correct.`;
    }
    throw new Error(
      `Error reading article: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "quasar-store-docs-mcp",
  version: "1.0.0",
});

// ---- Tool: search_docs ----
server.tool(
  "search_docs",
  "Search Quasar Store documentation articles by a query term",
  {
    query: z
      .string()
      .describe("Search term, e.g. 'installation', 'database errors'"),
  },
  async ({ query }) => {
    try {
      const results = await searchDocs(query);

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No results found for "${query}". Try different search terms or verify the documentation base URL.`,
            },
          ],
        };
      }

      const formatted = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Results for "${query}":\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Search error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---- Tool: read_doc ----
server.tool(
  "read_doc",
  "Read the full content of a Quasar Store documentation article",
  {
    url: z
      .string()
      .describe(
        'Full article URL or relative path (e.g. "guide/installation" or "https://docs.example.com/quasar-store/guide/installation")'
      ),
  },
  async ({ url }) => {
    try {
      const content = await readDoc(url);

      return {
        content: [
          {
            type: "text" as const,
            text: content,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error reading article: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Transport initialization and server startup
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Quasar Store Docs MCP server started successfully");
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
