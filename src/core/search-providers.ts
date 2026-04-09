import * as cheerio from 'cheerio';
import { search as ddgSearch } from 'duck-duck-scrape';
import pLimit from 'p-limit';

import { tavily } from '@tavily/core';

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  rawContent?: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface SearchProvider {
  search(query: string, maxResults: number): Promise<SearchResponse>;
}

// ─── Tavily ──────────────────────────────────────────────

export class TavilySearchProvider implements SearchProvider {
  private client: ReturnType<typeof tavily>;

  constructor(apiKey: string) {
    this.client = tavily({ apiKey });
  }

  async search(query: string, maxResults = 5): Promise<SearchResponse> {
    const result = await this.client.search(query, {
      maxResults,
      includeRawContent: true,
    });

    return {
      results: result.results.map(r => ({
        url: r.url,
        title: r.title,
        content: r.content,
        rawContent: r.rawContent ?? undefined,
      })),
    };
  }
}

// ─── DuckDuckGo + Cheerio ────────────────────────────────

const FETCH_TIMEOUT = 10_000;
const CONTENT_LIMIT = 50_000; // chars

async function fetchPageContent(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; DeepResearch/1.0; +research-bot)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return '';

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return '';
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Remove non-content elements
    $('script, style, nav, footer, header, aside, iframe, noscript, svg, [role="navigation"], [role="banner"], [role="complementary"]').remove();

    // Extract main content — prefer article/main, fall back to body
    let text = '';
    const mainContent = $('article, main, [role="main"]').first();
    if (mainContent.length > 0) {
      text = mainContent.text();
    } else {
      text = $('body').text();
    }

    // Clean up whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text.slice(0, CONTENT_LIMIT);
  } catch {
    return '';
  }
}

const DDG_MAX_RETRIES = 4;
const DDG_BASE_DELAY_MS = 2_000;

async function ddgSearchWithRetry(
  query: string,
  retries = DDG_MAX_RETRIES,
): Promise<Awaited<ReturnType<typeof ddgSearch>>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ddgSearch(query, { safeSearch: 0 });
    } catch (err: any) {
      const isRateLimit =
        err?.message?.includes('anomaly') ||
        err?.message?.includes('too quickly');
      if (!isRateLimit || attempt === retries) throw err;
      const jitter = Math.random() * 1_000;
      const delay = DDG_BASE_DELAY_MS * 2 ** attempt + jitter; // ~2s, ~4s, ~8s, ~16s
      console.warn(
        `[DDG] Rate-limited on attempt ${attempt + 1}, retrying in ${delay}ms…`,
      );
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

export class DuckDuckGoSearchProvider implements SearchProvider {
  private concurrency: number;

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  async search(query: string, maxResults = 5): Promise<SearchResponse> {
    const ddgResults = await ddgSearchWithRetry(query);

    if (ddgResults.noResults || !ddgResults.results.length) {
      return { results: [] };
    }

    const topResults = ddgResults.results.slice(0, maxResults);
    const limit = pLimit(this.concurrency);

    // Fetch full page content in parallel
    const results = await Promise.all(
      topResults.map(r =>
        limit(async () => {
          const rawContent = await fetchPageContent(r.url);
          return {
            url: r.url,
            title: r.title,
            content: r.rawDescription || r.description,
            rawContent: rawContent || undefined,
          };
        }),
      ),
    );

    return { results };
  }
}

// ─── Factory ─────────────────────────────────────────────

export type SearchProviderType = 'tavily' | 'duckduckgo';

export function createSearchProvider(
  type: SearchProviderType,
  options: { tavilyApiKey?: string; concurrency?: number },
): SearchProvider {
  switch (type) {
    case 'tavily': {
      if (!options.tavilyApiKey) {
        throw new Error('Tavily API key is required');
      }
      return new TavilySearchProvider(options.tavilyApiKey);
    }
    case 'duckduckgo':
      return new DuckDuckGoSearchProvider(options.concurrency);
    default:
      throw new Error(`Unknown search provider: ${type}`);
  }
}
