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

const SELECTORS = {
  article: "article, .doc-content, .markdown-body, main, .docs-content-page",
  title: "h1",
  navLinks: "nav a, .sidebar a, .toc a, aside a",
};

const UA =
  "QuasarStoreDocsMCP/1.0 (compatible; MCP-Client; +https://github.com/iiamdark/quasar-docs-mcp)";

// ---------------------------------------------------------------------------
// Navigation link extraction
// ---------------------------------------------------------------------------

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
      // skip malformed URLs
    }
  }
  return links;
}

function capitalize(str: string): string {
  return str
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// ---------------------------------------------------------------------------
// RSC content extraction — improved noise filtering
// ---------------------------------------------------------------------------

/**
 * Checks whether a text string looks like real documentation content
 * (paragraph, heading, code, list item) vs. technical noise from the
 * React Server Components payload.
 *
 * The filter errs on the side of keeping content — we'd rather include
 * some noise than lose real documentation text. Noise that slips through
 * is tolerable because the AI reading the output will understand the
 * context.
 */
function isContentText(text: string): boolean {
  const len = text.length;

  // Length filters
  if (len < 12) return false;
  if (len > 2000) return false;

  // ---- Hard rejects (these are NEVER documentation content) ----

  // React RSC internals
  if (text.includes("$S")) return false;
  if (text.includes("$L")) return false;
  if (text.startsWith("$")) return false;
  if (/^(?:[a-z0-9]+:)?I\[\d+,\[/.test(text)) return false;

  // File/asset paths from Next.js
  if (text.startsWith("/_next")) return false;
  if (text.startsWith("/docs/") && len < 40) return false; // nav link path
  if (text.includes("/static/") || text.includes("/chunks/")) return false;
  if (/^\/[a-z][a-z0-9/_.-]*\.[a-z0-9]+(\?.*)?$/.test(text)) return false; // /path/to/file.ext

  // JSON-LD and object-like strings
  if (text.includes('"@context"') || text.includes('"@type"')) return false;
  if (text.includes('{"') || (text.startsWith("{") && text.endsWith("}"))) return false;

  // Pure URLs
  if (/^https?:\/\/\S+$/.test(text)) return false;
  if (/^\/[a-z0-9_-]+$/.test(text) && len > 15) return false; // /some-route (single segment)

  // HTML tags
  if (/<\/?[a-z]+[^>]*>/i.test(text)) return false;

  // ---- Aggressive noise filters ----

  // Tailwind arbitrary values: -[...] or something-[...]
  if (/[a-z-]+\[[a-z0-9._-]+\]/i.test(text)) return false;

  // Strings with many dashes and no uppercase (CSS utility classes)
  const dashCount = (text.match(/-/g) || []).length;
  const colonCount = (text.match(/:/g) || []).length;
  const hasNoUppercase = text === text.toLowerCase();
  if (dashCount > 2 && hasNoUppercase && colonCount === 0) return false;
  // Tailwind pseudo-classes/metadata with multiple colons
  // (single-colon strings like "inventory:registerStash" are valid export names)
  if (colonCount > 1 && hasNoUppercase) return false;

  // Single lowercase word (likely metadata/internal field)
  if (!text.includes(" ") && hasNoUppercase && len < 8) return false;
  // Path-like strings with multiple segments (nav links, sidebar noise)
  if (text.startsWith("/") && !text.includes(" ") && (text.match(/\//g) || []).length >= 2) return false;

  // Single short uppercase word (like "Visa", "Home") — likely nav/footer
  if (!text.includes(" ") && len < 4) return false;

  // ---- Soft filters ----

  // Too many special characters (code is OK but has threshold)
  const specialCount = (text.match(/[{}()<>;:=]/g) || []).length;
  if (specialCount > 6) return false;

  // Mostly numbers/symbols
  const alpha = (text.match(/[a-zA-Z]/g) || []).length;
  if (alpha < len * 0.3) return false;

  // Too much whitespace with too few letters (JSON-like)
  const spaceCount = (text.match(/\s/g) || []).length;
  const spaceRatio = spaceCount / len;
  if (spaceRatio > 0.4 && alpha < len * 0.25) return false;

  // ---- Known noise word blocklist ----
  const noiseWords = [
    "GoogleTagManager", "GoogleAnalytics", "gtag", "gtm",
    "crossOrigin", "suppressHydrationWarning", "dangerouslySetInnerHTML",
    "parallelRouterKey", "errorStyles", "errorScripts",
    "afterInteractive", "beforeInteractive", "lazyOnload",
    "richColors", "showSpinner", "colorScheme",
    "TiktokAnalytics", "Trustpilot", "plausible",
    "ViewportBoundary", "MetadataBoundary", "Next.MetadataOutlet",
    "CollapsibleTrigger", "CollapsibleContent",
    "OutletBoundary", "SupportBubble", "Next.Metadata",
    "enableCookie", "disableCookie", "revokeConsent", "grantConsent",
    "CodeCopyButton",
    "noopener noreferrer",
    "lucide", "hljs",
    "columnWidths", "headerColumn", "table-data-cell", "contentSelector",
    "breadcrumb-jsonld",
  ];
  for (const nw of noiseWords) {
    if (text.includes(nw)) return false;
  }

  // ---- JS pattern reject (only when very code-like) ----
  if (/function\s*\(/.test(text) && alpha < len * 0.4) return false;
  if (/var\s+\w+\s*=/.test(text) && alpha < len * 0.4) return false;
  if (/console\./.test(text)) return false;
  if (/\.addEventListener/.test(text)) return false;

  // Pass — looks like documentation content
  return true;
}

function extractRscContent(html: string): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  const pushRegex = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let pushMatch: RegExpExecArray | null;

  while ((pushMatch = pushRegex.exec(html)) !== null) {
    let raw: string;
    try {
      raw = JSON.parse(`"${pushMatch[1]}"`) as string;
    } catch {
      continue;
    }

    // Extract all JSON string values from the RSC data
    const textRegex = /"((?:[^"\\]|\\.){10,})"/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRegex.exec(raw)) !== null) {
      const text = textMatch[1]
        .replace(/\\(["\\/])/g, "$1")
        .trim();
      if (!text || seen.has(text) || !isContentText(text)) continue;
      seen.add(text);
      lines.push(text);
    }
  }

  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Content extraction — multi-strategy
// ---------------------------------------------------------------------------

function extractContentViaCheerio(html: string, url: string): string | null {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header").remove();

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
      case "h1": content += `# ${text}\n\n`; break;
      case "h2": content += `## ${text}\n\n`; break;
      case "h3": content += `### ${text}\n\n`; break;
      case "h4": content += `#### ${text}\n\n`; break;
      case "h5": case "h6": content += `##### ${text}\n\n`; break;
      case "p": content += `${text}\n\n`; break;
      case "pre": {
        const code = $(el).find("code").text() || text;
        content += "```\n" + code + "\n```\n\n";
        break;
      }
      case "ul": case "ol":
        $(el).find("li").each((i, li) => {
          const prefix = tagName === "ol" ? `${i + 1}.` : "-";
          content += `${prefix} ${$(li).text().trim()}\n`;
        });
        content += "\n";
        break;
      case "table": {
        const rows: string[][] = [];
        $(el).find("tr").each((_, tr) => {
          const cells: string[] = [];
          $(tr).find("th, td").each((__, cell) => { cells.push($(cell).text().trim()); });
          rows.push(cells);
        });
        if (rows.length > 0) {
          content += "| " + rows[0].join(" | ") + " |\n";
          content += "| " + rows[0].map(() => "---").join(" | ") + " |\n";
          for (let i = 1; i < rows.length; i++)
            content += "| " + rows[i].join(" | ") + " |\n";
          content += "\n";
        }
        break;
      }
      case "blockquote": content += `> ${text}\n\n`; break;
      default:
        if (text.length > 0) content += `${text}\n\n`;
        break;
    }
  });

  content += `---\nSource: ${url}\n`;
  return content;
}

function extractContentFromHtml(html: string, url: string): string {
  const $ = cheerio.load(html);

  const pageTitle =
    $("title").first().text().replace(/ \| Quasar Store$/, "").trim() || "Untitled";
  const description = $('meta[name="description"]').attr("content");

  let content = `# ${pageTitle}\n\n`;
  if (description) content += `> ${description}\n\n---\n\n`;

  // Strategy 1: RSC extraction (best for Next.js sites)
  const rscContent = extractRscContent(html);
  if (rscContent.length > 150) {
    content += rscContent;
  } else {
    // Strategy 2: cheerio extraction (traditional HTML sites)
    const cheerioContent = extractContentViaCheerio(html, url);
    if (cheerioContent) {
      content += cheerioContent.replace(/^# .+\n\n/, "");
    } else {
      // Strategy 3: related links fallback
      const relatedLinks = extractDocLinksFromHtml(html, DOCS_BASE_URL)
        .filter((l) => l.url !== url && l.url !== `${url}/`)
        .slice(0, 10);

      if (rscContent.length > 20) content += rscContent + "\n\n";
      if (relatedLinks.length > 0) {
        content += "## Related articles\n\n";
        relatedLinks.forEach((l) => (content += `- [${l.title}](${l.url})\n`));
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

function extractNavLinks(
  html: string,
  baseUrl: string
): Array<{ title: string; url: string }> {
  const htmlLinks = extractDocLinksFromHtml(html, baseUrl);
  if (htmlLinks.length > 0) return htmlLinks;

  const $ = cheerio.load(html);
  const links: Array<{ title: string; url: string }> = [];
  $(SELECTORS.navLinks).each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).text().trim();
    if (!href || !title) return;
    try {
      const absoluteUrl = new URL(href, baseUrl).toString();
      if (absoluteUrl.startsWith(new URL(baseUrl).origin)) links.push({ title, url: absoluteUrl });
    } catch { /* skip */ }
  });
  return links;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = parseInt(process.env.DOCS_CACHE_TTL ?? "300000", 10);

class MemoryCache<T> {
  private value: T | null = null;
  private expiry = 0;
  private pending: Promise<T> | null = null;

  async get(fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    if (this.value !== null && now < this.expiry) return this.value;
    if (this.pending) return this.pending;

    this.pending = fetcher()
      .then((result) => {
        this.value = result;
        this.expiry = now + CACHE_TTL_MS;
        return result;
      })
      .finally(() => { this.pending = null; });

    return this.pending;
  }
}

const linksCache = new MemoryCache<Array<{ title: string; url: string }>>();

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

async function listDocs(): Promise<
  Array<{ product: string; articleCount: number; overviewUrl: string; sections: string[] }>
> {
  const links = await fetchAllDocsLinks();
  const productMap = new Map<string, { urls: Set<string>; sections: Set<string>; overviewUrl: string }>();

  for (const link of links) {
    const pathMatch = new URL(link.url).pathname.match(/\/docs\/([^/]+)/);
    if (!pathMatch) continue;
    const productKey = pathMatch[1];
    if (!productMap.has(productKey)) {
      productMap.set(productKey, { urls: new Set(), sections: new Set(), overviewUrl: link.url });
    }
    const entry = productMap.get(productKey)!;
    entry.urls.add(link.url);
    const sectionMatch = link.title.match(/\u2014 (.+)/);
    if (sectionMatch) entry.sections.add(sectionMatch[1]);
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
      .map((link) => ({ title: link.title, url: link.url, snippet: `Documentation: ${link.title}` }))
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
      `Error searching documentation: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function readDoc(urlOrId: string): Promise<string> {
  let url: string;
  if (urlOrId.startsWith("http://") || urlOrId.startsWith("https://")) {
    url = urlOrId;
  } else {
    let path = urlOrId.replace(/^\/?/, "");
    if (!path.startsWith("docs/")) path = `docs/${path}`;
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
      `Error reading article: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "quasar-store-docs-mcp", version: "1.0.0" });

server.tool(
  "list_docs",
  "List all available documentation products/categories with article counts and section overviews",
  {},
  async () => {
    try {
      const products = await listDocs();
      if (products.length === 0) {
        return { content: [{ type: "text" as const, text: "No documentation categories found. Verify the documentation base URL." }] };
      }
      const formatted = products
        .map((p) =>
          `### ${p.product}\nArticles: ${p.articleCount} | Overview: ${p.overviewUrl}\nSections: ${p.sections.join(", ") || "Overview only"}`
        )
        .join("\n\n");
      return { content: [{ type: "text" as const, text: `Available documentation categories (**${products.length}** total):\n\n${formatted}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Error listing documentation: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "search_docs",
  "Search Quasar Store documentation articles by a query term",
  { query: z.string().describe("Search term, e.g. 'installation', 'database errors', 'advanced inventory'") },
  async ({ query }) => {
    try {
      const results = await searchDocs(query);
      if (results.length === 0) {
        return { content: [{ type: "text" as const, text: `No results found for "${query}". Try different search terms or verify the documentation base URL.` }] };
      }
      const formatted = results.map((r, i) => `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`).join("\n\n");
      return { content: [{ type: "text" as const, text: `Results for "${query}":\n\n${formatted}` }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Search error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

server.tool(
  "read_doc",
  "Read the full content of a Quasar Store documentation article by its URL or relative path",
  { url: z.string().describe('Full article URL or relative path (e.g. "advanced-inventory/installation" or "https://www.quasar-store.com/docs/advanced-inventory/installation")') },
  async ({ url }) => {
    try {
      const content = await readDoc(url);
      return { content: [{ type: "text" as const, text: content }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: `Error reading article: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Quasar Store Docs MCP server started (base: ${DOCS_BASE_URL})`);
}

main().catch((error) => {
  console.error("Fatal error starting MCP server:", error);
  process.exit(1);
});
