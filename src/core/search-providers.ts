import * as cheerio from 'cheerio';
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

// ─── SearXNG ────────────────────────────────────────────

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

const DEFAULT_SEARXNG_URL = 'http://localhost:8080';

export class SearXNGSearchProvider implements SearchProvider {
  private baseUrl: string;
  private concurrency: number;

  constructor(baseUrl?: string, concurrency = 3) {
    this.baseUrl = (baseUrl || DEFAULT_SEARXNG_URL).replace(/\/+$/, '');
    this.concurrency = concurrency;
  }

  async search(query: string, maxResults = 5): Promise<SearchResponse> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'general');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let data: any;
    try {
      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `SearXNG responded with ${res.status}: ${body.slice(0, 200)}`,
        );
      }
      data = await res.json();
    } catch (err: any) {
      clearTimeout(timeout);
      if (err?.name === 'AbortError') {
        throw new Error(`SearXNG request timed out (${this.baseUrl})`);
      }
      throw err;
    }

    if (!data.results || !data.results.length) {
      return { results: [] };
    }

    const topResults = (data.results as any[]).slice(0, maxResults);
    const limit = pLimit(this.concurrency);

    const results = await Promise.all(
      topResults.map(r =>
        limit(async () => {
          const rawContent = await fetchPageContent(r.url);
          return {
            url: r.url as string,
            title: (r.title || '') as string,
            content: (r.content || '') as string,
            rawContent: rawContent || undefined,
          };
        }),
      ),
    );

    return { results };
  }
}

// ─── Factory ─────────────────────────────────────────────

export type SearchProviderType = 'tavily' | 'searxng';

export function createSearchProvider(
  type: SearchProviderType,
  options: { tavilyApiKey?: string; searxngUrl?: string; concurrency?: number },
): SearchProvider {
  switch (type) {
    case 'tavily': {
      if (!options.tavilyApiKey) {
        throw new Error('Tavily API key is required');
      }
      return new TavilySearchProvider(options.tavilyApiKey);
    }
    case 'searxng':
      return new SearXNGSearchProvider(options.searxngUrl, options.concurrency);
    default:
      throw new Error(`Unknown search provider: ${type}`);
  }
}
