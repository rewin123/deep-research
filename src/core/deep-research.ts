import { generateText } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';

import { type ModelSettings, getModel, trimPrompt } from './ai/providers';
import { systemPrompt } from './prompt';
import {
  type SearchProvider,
  type SearchProviderType,
  type SearchResponse,
  createSearchProvider,
} from './search-providers';

function log(...args: any[]) {
  console.log(...args);
}

/** Extract content between <tag>…</tag>. Returns empty string if not found. */
function extractTag(text: string, tag: string): string {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  return re.exec(text)?.[1]?.trim() ?? '';
}

/** Extract all occurrences of <tag>…</tag>. */
function extractAllTags(text: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = m[1]?.trim();
    if (v) results.push(v);
  }
  return results;
}

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
  learnings: string[];
  visitedUrls: string[];
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

export interface ResearchConfig {
  /** Model/provider settings */
  modelSettings?: ModelSettings;
  /** Tavily API key (required when searchProvider is 'tavily') */
  tavilyApiKey?: string;
  /** Search provider: 'tavily' or 'searxng' (default: auto-detect) */
  searchProvider?: SearchProviderType;
  /** SearXNG instance URL (default: http://localhost:8080) */
  searxngUrl?: string;
  /** Max concurrent searches (default: 2) */
  tavilyConcurrency?: number;
  /** LLM timeout in ms (default: 180000) */
  llmTimeout?: number;
}

function getDefaults(config?: ResearchConfig) {
  return {
    concurrencyLimit:
      config?.tavilyConcurrency ??
      (Number(process.env.TAVILY_CONCURRENCY) || 2),
    llmTimeout:
      config?.llmTimeout ?? (Number(process.env.LLM_TIMEOUT) || 180_000),
    tavilyApiKey:
      config?.tavilyApiKey ?? (process.env.TAVILY_API_KEY ?? ''),
    searxngUrl:
      config?.searxngUrl ?? (process.env.SEARXNG_URL || 'http://localhost:8080'),
  };
}

function resolveSearchProvider(config?: ResearchConfig): SearchProvider {
  const defaults = getDefaults(config);

  // Explicit provider choice
  if (config?.searchProvider) {
    return createSearchProvider(config.searchProvider, {
      tavilyApiKey: defaults.tavilyApiKey,
      searxngUrl: defaults.searxngUrl,
      concurrency: defaults.concurrencyLimit,
    });
  }

  // Auto-detect: use Tavily if key is available, otherwise SearXNG
  if (defaults.tavilyApiKey) {
    return createSearchProvider('tavily', {
      tavilyApiKey: defaults.tavilyApiKey,
    });
  }

  return createSearchProvider('searxng', {
    searxngUrl: defaults.searxngUrl,
    concurrency: defaults.concurrencyLimit,
  });
}

async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  config,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  config?: ResearchConfig;
}) {
  const res = await generateText({
    model: getModel(config?.modelSettings),
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other.

<prompt>${query}</prompt>

${
  learnings
    ? `Here are some learnings from previous research, use them to generate more specific queries:\n${learnings.join('\n')}`
    : ''
}

Return each query inside XML tags like this:
<search_query>
<query>the search query</query>
<research_goal>the goal of this query and how to advance research once results are found</research_goal>
</search_query>`,
  });

  const text = res.text;
  const queryBlocks = extractAllTags(text, 'search_query');
  const queries = compact(
    queryBlocks.map(block => {
      const q = extractTag(block, 'query');
      const goal = extractTag(block, 'research_goal');
      return q ? { query: q, researchGoal: goal } : null;
    }),
  );

  log(`Created ${queries.length} queries`, queries);
  return queries.slice(0, numQueries);
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  config,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
  config?: ResearchConfig;
}) {
  const defaults = getDefaults(config);
  const contents = compact(
    result.results.map(item => item.rawContent ?? item.content),
  ).map(content => trimPrompt(content, 25_000));
  log(`Ran ${query}, found ${contents.length} contents`);

  const prompt = trimPrompt(
    `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates. The learnings will be used to research the topic further.\n\n<contents>${contents
      .map(content => `<content>\n${content}\n</content>`)
      .join('\n')}</contents>`,
  );

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const timeout = defaults.llmTimeout * (attempt + 1);
      const res = await generateText({
        model: getModel(config?.modelSettings),
        abortSignal: AbortSignal.timeout(timeout),
        system: systemPrompt(),
        prompt: prompt + `\n\nReturn each learning inside <learning>…</learning> tags and each follow-up question inside <follow_up>…</follow_up> tags. Return a maximum of ${numLearnings} learnings and ${numFollowUpQuestions} follow-up questions.`,
      });

      const learningsResult = extractAllTags(res.text, 'learning').slice(0, numLearnings);
      const followUpQuestions = extractAllTags(res.text, 'follow_up').slice(0, numFollowUpQuestions);
      log(
        `Created ${learningsResult.length} learnings`,
        learningsResult,
      );

      return { learnings: learningsResult, followUpQuestions };
    } catch (e: any) {
      if (
        e.name === 'TimeoutError' ||
        e.message?.includes('Timeout') ||
        e.message?.includes('timeout')
      ) {
        log(
          `Timeout on attempt ${attempt + 1}/${maxRetries} for query: ${query}`,
        );
        if (attempt === maxRetries - 1) throw e;
      } else {
        throw e;
      }
    }
  }

  throw new Error('Unexpected: all retries exhausted');
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  config,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  config?: ResearchConfig;
}) {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const res = await generateText({
    model: getModel(config?.modelSettings),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following prompt from the user, write a final report on the topic using the learnings from research. Make it as detailed as possible, aim for 3 or more pages, include ALL the learnings from research.

<prompt>${prompt}</prompt>

Here are all the learnings from previous research:

<learnings>
${learningsString}
</learnings>

Write the full report in Markdown inside <report>…</report> tags.`,
    ),
  });

  const report = extractTag(res.text, 'report') || res.text;
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return report + urlsSection;
}

export async function writeFinalAnswer({
  prompt,
  learnings,
  config,
}: {
  prompt: string;
  learnings: string[];
  config?: ResearchConfig;
}) {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const res = await generateText({
    model: getModel(config?.modelSettings),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following prompt from the user, write a final answer on the topic using the learnings from research. Follow the format specified in the prompt. Do not yap or babble or include any other text than the answer besides the format specified in the prompt. Keep the answer as concise as possible - usually it should be just a few words or maximum a sentence. Try to follow the format specified in the prompt (for example, if the prompt is using Latex, the answer should be in Latex. If the prompt gives multiple answer choices, the answer should be one of the choices).

<prompt>${prompt}</prompt>

Here are all the learnings from research on the topic that you can use to help answer the prompt:

<learnings>
${learningsString}
</learnings>

Put your final answer inside <answer>…</answer> tags.`,
    ),
  });

  return extractTag(res.text, 'answer') || res.text;
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  config,
  _sharedProgress,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  config?: ResearchConfig;
  /** @internal shared progress object across recursion tree */
  _sharedProgress?: ResearchProgress;
}): Promise<ResearchResult> {
  const defaults = getDefaults(config);
  const searchProvider = resolveSearchProvider(config);

  // Top-level call creates the shared progress; recursive calls reuse it
  const progress: ResearchProgress = _sharedProgress ?? {
    currentDepth: depth,
    totalDepth: depth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
    learnings: [...learnings],
    visitedUrls: [...visitedUrls],
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
    config,
  });

  // Accumulate totalQueries across recursion levels (additive, not replacement)
  reportProgress({
    totalQueries: progress.totalQueries + serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(defaults.concurrencyLimit);

  const results = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          const result = await searchProvider.search(serpQuery.query, 5);

          const newUrls = compact(result.results.map(item => item.url));
          const newBreadth = Math.ceil(breadth / 2);
          const newDepth = depth - 1;

          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result,
            numFollowUpQuestions: newBreadth,
            config,
          });

          // Update shared progress with new learnings and URLs incrementally
          for (const l of newLearnings.learnings) {
            if (!progress.learnings.includes(l)) {
              progress.learnings.push(l);
            }
          }
          for (const u of newUrls) {
            if (!progress.visitedUrls.includes(u)) {
              progress.visitedUrls.push(u);
            }
          }

          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls = [...visitedUrls, ...newUrls];

          if (newDepth > 0) {
            log(
              `Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`,
            );

            reportProgress({
              currentDepth: newDepth,
              currentBreadth: newBreadth,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
          `.trim();

            return deepResearch({
              query: nextQuery,
              breadth: newBreadth,
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
              onProgress,
              config,
              _sharedProgress: progress,
            });
          } else {
            reportProgress({
              currentDepth: 0,
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
            };
          }
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
          }
          return {
            learnings: [],
            visitedUrls: [],
          };
        }
      }),
    ),
  );

  return {
    learnings: [...new Set(results.flatMap(r => r.learnings))],
    visitedUrls: [...new Set(results.flatMap(r => r.visitedUrls))],
  };
}
