#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Base configuration
// ---------------------------------------------------------------------------

const DOCS_BASE_URL =
  process.env.DOCS_BASE_URL ?? "https://www.quasar-store.com";

/** CSS selectors for extracting content from documentation pages. */
const SELECTORS = {
  /** Main article container. */
  article: "article, .doc-content, .markdown-body, main, .docs-content-page",
  /** Article title element. */
  title: "h1",
  /** Navigation links to other docs pages. */
  navLinks: "nav a, .sidebar a, .toc a, aside a",
};

/** Common User-Agent header for all HTTP requests. */
const UA =
  "QuasarStoreDocsMCP/1.0 (compatible; MCP-Client; +https://github.com/iiamdark/quasar-docs-mcp)";

// ---------------------------------------------------------------------------
// Navigation link extraction (raw HTML scanning for /docs/… paths)
// ---------------------------------------------------------------------------

/**
 * Finds all documentation article URLs from the raw HTML by scanning for
 * [`/docs/…`]{@link https://www.quasar-store.com/docs} href values.
 *
 * Next.js App Router sites ship their navigation tree as React Server
 * Components data within `<script>` tags rather than as rendered `<a>`
 * elements, so we use regex on the raw HTML body.
 *
 * @remarks
 * The regex searches for literal `href="/docs/..."` in the raw HTML body.
 * These hrefs exist in the RSC data within `<script>` tags as well as in
 * server-rendered components. This approach works for the current Quasar
 * Store site; if the site moves entirely to client-side rendering, this
 * function may need updating.
 */
function extractDocLinksFromHtml(
  html: string,
  baseUrl: string
): Array<{ title: string; url: string }> {
  const seen = new Set<string>();
  const links: Array<{ title: string; url: string }> = [];

  const hrefRegex = /href="(\/docs\/[^"']+)"/g;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];

    if (href === "/docs" || seen.has(href)) continue;
    seen.add(href);

    // Build a human-readable title from the URL path segments
    const segments = href.replace("/docs/", "").split("/");
    const product = segments[0].replace(/[-_]/g, " ");
    const subpage =
      segments.length > 1
        ? segments.slice(1).join(" ").replace(/[-_]/g, " ")
        : "Overview";

    const title =
      capitalize(product) +
      (segments.length > 1 ? " \u2014 " + capitalize(subpage) : "");

    try {
      links.push({ title, url: new URL(href, baseUrl).toString() });
    } catch {
      // Ignore malformed URLs
    }
  }

  return links;
}

/** Capitalizes the first letter of each word in a string. */
function capitalize(str: string): string {
  return str
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ---------------------------------------------------------------------------
// RSC (React Server Components) content extraction
// ---------------------------------------------------------------------------

/**
 * Extracts readable text content from a Next.js RSC payload using a
 * best-effort regex approach.
 *
 * The RSC payload in `self.__next_f.push([1, "..."])` contains
 * JSON-encoded React elements. This function extracts text strings
 * that look like article content (>= 10 chars, not URLs/paths/classNames).
 *
 * This is intentionally a best-effort parser — it may not capture all
 * content, but it provides a useful starting point.
 */
function extractRscContent(html: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  // Match RSC push entries, handling JS-escaped quotes correctly.
  // Uses a pattern that treats \" as an escaped quote (not a closing quote).
  const pushRegex = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let pushMatch: RegExpExecArray | null;

  while ((pushMatch = pushRegex.exec(html)) !== null) {
    // JS-unescape the string: \" -> ", \\ -> \, etc.
    let raw: string;
    try {
      raw = JSON.parse(`"${pushMatch[1]}"`) as string;
    } catch {
      continue;
    }

    // Extract all text fragments from the JSON structure.
    const textRegex = /"((?:[^"\\]|\\.){10,})"/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(raw)) !== null) {
      const text = textMatch[1]
        .replace(/\\(["\\/])/g, "$1") // Unescape JSON escapes
        .trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);

      // Filter out non-content strings (CSS classes, URLs, icon names, etc.)
      if (
        text.startsWith("http") ||
        text.startsWith("/") ||
        text.startsWith("_") ||
        text.startsWith("data:") ||
        text.startsWith("lucide") ||
        text.startsWith("radix") ||
        text.startsWith("group/") ||
        text.length < 10 ||
        /^[a-z0-9_-]{10,30}$/.test(text)
      )
        continue;

      lines.push(text);
    }
  }

  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Content extraction utilities
// ---------------------------------------------------------------------------

/**
 * Attempts the standard cheerio-based content extraction from DOM elements.
 * Works well for traditional (non-SPA) documentation sites.
 */
function extractContentViaCheerio(
  html: string,
  url: string
): string | null {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $(
    "script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header"
  ).remove();

  // Find the main article container
  const article = $(SELECTORS.article).first();
  const container = article.length > 0 ? article : $("body");

  const title = $(SELECTORS.title).first().text().trim() || "Untitled";

  let content = `# ${title}\n\n`;

  const directText = container.text().trim();
  if (directText.length < 20) return null;

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
          content += "| " + rows[0].join(" | ") + " |\n";
          content += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
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
        if (text.length > 0) {
          content += `${text}\n\n`;
        }
        break;
    }
  });

  content += `---\nSource: ${url}\n`;
  return content;
}

/**
 * Extracts content from a documentation page with a multi-strategy approach:
 *
 * 1. Extract `<title>` and `<meta name="description">` (always reliable)
 * 2. Try RSC payload extraction (works for Next.js App Router sites)
 * 3. Fall back to standard cheerio-based extraction (traditional HTML)
 * 4. As a last resort, list related `/docs/` links found on the page
 */
function extractContentFromHtml(html: string, url: string): string {
  const $ = cheerio.load(html);

  const pageTitle =
    $("title")
      .first()
      .text()
      .replace(/ \| Quasar Store$/, "")
      .trim() || "Untitled";

  const description = $('meta[name="description"]').attr("content");

  let content = `# ${pageTitle}\n\n`;
  if (description) {
    content += `> ${description}\n\n---\n\n`;
  }

  // Strategy 1: Try RSC payload extraction (Next.js App Router sites)
  const rscContent = extractRscContent(html);
  if (rscContent.length > 150) {
    content += rscContent;
  } else {
    // Strategy 2: Fall back to cheerio-based extraction
    const cheerioContent = extractContentViaCheerio(html, url);
    if (cheerioContent) {
      const body = cheerioContent.replace(/^# .+\n\n/, "");
      content += body;
    } else {
      // Strategy 3: List related docs links as a useful fallback
      const relatedLinks = extractDocLinksFromHtml(html, DOCS_BASE_URL)
        .filter((l) => l.url !== url && l.url !== `${url}/`)
        .slice(0, 10);

      if (rscContent.length > 20) {
        content += rscContent + "\n\n";
      }

      if (relatedLinks.length > 0) {
        content += "## Related articles\n\n";
        relatedLinks.forEach(
          (l) => (content += `- [${l.title}](${l.url})\n`)
        );
        content += "\n";
      }

      if (rscContent.length <= 20 && relatedLinks.length === 0) {
        content +=
          "_Content could not be extracted from this page. " +
          "The documentation may use client-side rendering. " +
          "Try using the URL directly in a browser._\n\n";
      }
    }
  }

  content += `---\nSource: ${url}\n`;
  return content;
}

/**
 * Extracts navigation / index links from a documentation page.
 * Supports both RSC-based (Next.js) and traditional HTML sites.
 */
function extractNavLinks(
  html: string,
  baseUrl: string
): Array<{ title: string; url: string }> {
  // Try raw-HTML extraction first (works for Next.js RSC data)
  const htmlLinks = extractDocLinksFromHtml(html, baseUrl);
  if (htmlLinks.length > 0) {
    return htmlLinks;
  }

  // Fall back to DOM-based extraction (traditional HTML)
  const $ = cheerio.load(html);
  const links: Array<{ title: string; url: string }> = [];

  $(SELECTORS.navLinks).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();

    if (!href || !title) return;

    try {
      const absoluteUrl = new URL(href, baseUrl).toString();
      if (absoluteUrl.startsWith(new URL(baseUrl).origin)) {
        links.push({ title, url: absoluteUrl });
      }
    } catch {
      // Ignore malformed URLs
    }
  });

  return links;
}

// ---------------------------------------------------------------------------
// In-memory cache with TTL
// ---------------------------------------------------------------------------

/** Time-to-live for cached data in milliseconds (default: 5 minutes). */
const CACHE_TTL_MS = parseInt(process.env.DOCS_CACHE_TTL ?? "300000", 10);

class MemoryCache<T> {
  private value: T | null = null;
  private expiry = 0;
  private pending: Promise<T> | null = null;

  /**
   * Returns the cached value if fresh, otherwise calls `fetcher` once
   * and caches the result. Concurrent callers share the same fetch.
   */
  async get(fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();

    // Serve from cache if still fresh
    if (this.value !== null && now < this.expiry) {
      return this.value;
    }

    // Deduplicate concurrent requests
    if (this.pending) {
      return this.pending;
    }

    this.pending = fetcher()
      .then((result) => {
        this.value = result;
        this.expiry = now + CACHE_TTL_MS;
        return result;
      })
      .finally(() => {
        this.pending = null;
      });

    return this.pending;
  }

}

// ---------------------------------------------------------------------------
// Shared helpers for fetching docs page data
// ---------------------------------------------------------------------------

const linksCache = new MemoryCache<Array<{ title: string; url: string }>>();

/**
 * Fetches any docs page and returns all extracted navigation links.
 * Results are cached for `DOCS_CACHE_TTL` ms (default 5 minutes).
 */
async function fetchAllDocsLinks(): Promise<Array<{ title: string; url: string }>> {
  return linksCache.get(async () => {
    const docsUrl = `${DOCS_BASE_URL}/docs/advanced-inventory`;
    const { data: html } = await axios.get<string>(docsUrl, {
      timeout: 15_000,
      headers: { "User-Agent": UA },
    });
    return extractNavLinks(html, DOCS_BASE_URL);
  });
}

// ---------------------------------------------------------------------------
// Core tools
// ---------------------------------------------------------------------------

/**
 * Lists all available documentation products/categories with the number
 * of articles each contains. Useful for discovery before searching.
 */
async function listDocs(): Promise<
  Array<{
    product: string;
    articleCount: number;
    overviewUrl: string;
    sections: string[];
  }>
> {
  const links = await fetchAllDocsLinks();

  // Group links by product (first path segment after /docs/)
  const productMap = new Map<
    string,
    { urls: Set<string>; sections: Set<string>; overviewUrl: string }
  >();

  for (const link of links) {
    const pathMatch = new URL(link.url).pathname.match(/\/docs\/([^/]+)/);
    if (!pathMatch) continue;

    const productKey = pathMatch[1];
    const productName = capitalize(productKey.replace(/[-_]/g, " "));

    if (!productMap.has(productKey)) {
      productMap.set(productKey, {
        urls: new Set(),
        sections: new Set(),
        overviewUrl: link.url,
      });
    }

    const entry = productMap.get(productKey)!;
    entry.urls.add(link.url);

    // Extract the section name from the title (everything after " — ")
    const sectionMatch = link.title.match(/\u2014 (.+)/);
    if (sectionMatch) {
      entry.sections.add(sectionMatch[1]);
    }
  }

  return Array.from(productMap.entries())
    .map(([key, entry]) => ({
      product: capitalize(key.replace(/[-_]/g, " ")),
      articleCount: entry.urls.size,
      overviewUrl: entry.overviewUrl,
      sections: Array.from(entry.sections).sort(),
    }))
    .sort((a, b) => a.product.localeCompare(b.product));
}

/**
 * Searches documentation articles by filtering navigation link titles
 * against the provided query term.
 */
async function searchDocs(
  query: string
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  try {
    const links = await fetchAllDocsLinks();
    const lowerQuery = query.toLowerCase();

    const results = links
      .filter(
        (link) =>
          link.title.toLowerCase().includes(lowerQuery) ||
          link.url.toLowerCase().includes(lowerQuery)
      )
      .map((link) => ({
        title: link.title,
        url: link.url,
        snippet: `Documentation: ${link.title}`,
      }))
      .slice(0, 20);

    if (results.length === 0) {
      return links.slice(0, 15).map((link) => ({
        title: link.title,
        url: link.url,
        snippet: `(no exact match for "${query}") \u2014 available in documentation`,
      }));
    }

    return results;
  } catch (error) {
    throw new Error(
      `Error searching documentation: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Reads the full content of a documentation article from its URL.
 * Accepts both absolute URLs and relative paths.
 */
async function readDoc(urlOrId: string): Promise<string> {
  let url: string;
  if (urlOrId.startsWith("http://") || urlOrId.startsWith("https://")) {
    url = urlOrId;
  } else {
    // Ensure the path includes /docs/ prefix for Quasar Store docs site
    let path = urlOrId.replace(/^\/?/, "");
    if (!path.startsWith("docs/")) {
      path = `docs/${path}`;
    }
    url = `${DOCS_BASE_URL}/${path}`;
  }

  try {
    const { data: html } = await axios.get<string>(url, {
      timeout: 15_000,
      headers: { "User-Agent": UA },
    });

    return extractContentFromHtml(html, url);
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return `Error: Article at "${url}" was not found (404). Please verify the URL is correct.`;
    }
    throw new Error(
      `Error reading article: ${
        error instanceof Error ? error.message : String(error)
      }`
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

// ---- Tool: list_docs ----
server.tool(
  "list_docs",
  "List all available documentation products/categories with article counts and section overviews",
  {},
  async () => {
    try {
      const products = await listDocs();

      if (products.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No documentation categories found. Verify the documentation base URL.",
            },
          ],
        };
      }

      const formatted = products
        .map(
          (p) =>
            `### ${p.product}\n` +
            `Articles: ${p.articleCount} | ` +
            `Overview: ${p.overviewUrl}\n` +
            `Sections: ${p.sections.join(", ") || "Overview only"}`
        )
        .join("\n\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Available documentation categories (**${products.length}** total):\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing documentation: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ---- Tool: search_docs ----
server.tool(
  "search_docs",
  "Search Quasar Store documentation articles by a query term",
  {
    query: z
      .string()
      .describe("Search term, e.g. 'installation', 'database errors', 'advanced inventory'"),
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
            text: `Search error: ${
              error instanceof Error ? error.message : String(error)
            }`,
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
  "Read the full content of a Quasar Store documentation article by its URL or relative path",
  {
    url: z.string().describe(
      'Full article URL or relative path (e.g. "advanced-inventory/installation" or "https://www.quasar-store.com/docs/advanced-inventory/installation")'
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
            text: `Error reading article: ${
              error instanceof Error ? error.message : String(error)
            }`,
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
  console.error(
    `Quasar Store Docs MCP server started (base: ${DOCS_BASE_URL})`
  );
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
