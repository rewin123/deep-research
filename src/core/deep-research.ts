import { generateText } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';

import { type ModelSettings, getModel, getModelForRole, trimPrompt } from './ai/providers';
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

// ── ReAct & Adaptive-depth types ──────────────────────────────────────

export type ResearchAction = 'continue' | 'pivot' | 'stop';

export interface ResearchDecision {
  action: ResearchAction;
  reasoning: string;
  gaps: string[];
  contradictions: string[];
  pivotQueries: string[];
  confidence: number;
  saturated: boolean;
}

export interface ResearchBudget {
  maxDepth: number;
  maxQueries: number;
  usedQueries: number;
  startTime: number;
  maxTimeMs?: number;
}

export type StopReason =
  | 'max_depth'
  | 'budget_exhausted'
  | 'sufficient_coverage'
  | 'saturated';

// ── Core types ────────────────────────────────────────────────────────

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
  /** The ReAct decision from the last reasoning step */
  lastDecision?: ResearchDecision;
  /** Budget tracking */
  budget?: { maxQueries: number; usedQueries: number; maxDepth: number };
  /** Why research stopped */
  stopReason?: StopReason;
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
  /** Max total search queries across all levels (0 = compute from breadth/depth) */
  maxQueries?: number;
  /** Max wall-clock time in ms (0 = no limit) */
  maxTimeMs?: number;
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

// ── Budget utilities ──────────────────────────────────────────────────

function computeDefaultMaxQueries(breadth: number, depth: number): number {
  let total = 0;
  let b = breadth;
  for (let d = 0; d < depth; d++) {
    total += b;
    b = Math.ceil(b / 2);
  }
  return total;
}

function createBudget(
  breadth: number,
  depth: number,
  config?: ResearchConfig,
): ResearchBudget {
  const defaultMax = computeDefaultMaxQueries(breadth, depth);
  return {
    maxDepth: depth,
    maxQueries: config?.maxQueries || defaultMax,
    usedQueries: 0,
    startTime: Date.now(),
    maxTimeMs: config?.maxTimeMs || undefined,
  };
}

function isBudgetExhausted(budget: ResearchBudget): boolean {
  if (budget.usedQueries >= budget.maxQueries) return true;
  if (budget.maxTimeMs && Date.now() - budget.startTime >= budget.maxTimeMs)
    return true;
  return false;
}

// ── ReAct reasoning step ──────────────────────────────────────────────

async function evaluateResearch({
  originalQuery,
  learnings,
  visitedUrls,
  currentDepth,
  maxDepth,
  budget,
  config,
}: {
  originalQuery: string;
  learnings: string[];
  visitedUrls: string[];
  currentDepth: number;
  maxDepth: number;
  budget: ResearchBudget;
  config?: ResearchConfig;
}): Promise<ResearchDecision> {
  const defaults = getDefaults(config);
  const learningsXml = learnings
    .map(l => `<learning>${l}</learning>`)
    .join('\n');

  try {
    const res = await generateText({
      model: getModelForRole(config?.modelSettings, 'thinking'),
      abortSignal: AbortSignal.timeout(defaults.llmTimeout),
      system: systemPrompt(),
      prompt: trimPrompt(`You are evaluating the current state of a research investigation.

<original_query>${originalQuery}</original_query>

<accumulated_learnings>
${learningsXml}
</accumulated_learnings>

<research_state>
- Sources consulted: ${visitedUrls.length}
- Current depth: ${currentDepth} of ${maxDepth} max
- Search queries used: ${budget.usedQueries} of ${budget.maxQueries} max
</research_state>

Evaluate the research so far and decide what to do next. Consider:
1. Are there knowledge GAPS — important aspects of the query that have not been covered?
2. Are there CONTRADICTIONS between sources that need resolution?
3. Is the research SATURATED — are we finding the same information repeatedly?
4. Do we have SUFFICIENT coverage to answer the original query confidently?

Return your evaluation in this format:

<evaluation>
<reasoning>Your detailed reasoning about the current research state</reasoning>
<confidence>A number between 0 and 1</confidence>
<saturated>true or false</saturated>
<gaps>
<gap>description of a knowledge gap</gap>
</gaps>
<contradictions>
<contradiction>description of a contradiction</contradiction>
</contradictions>
<action>continue, pivot, or stop</action>
<pivot_queries>
<query>new search query if pivoting</query>
</pivot_queries>
</evaluation>`),
    });

    const text = res.text;
    const evalBlock = extractTag(text, 'evaluation') || text;

    return {
      action: (extractTag(evalBlock, 'action') || 'continue') as ResearchAction,
      reasoning: extractTag(evalBlock, 'reasoning'),
      gaps: extractAllTags(evalBlock, 'gap'),
      contradictions: extractAllTags(evalBlock, 'contradiction'),
      pivotQueries: extractAllTags(evalBlock, 'query'),
      confidence: parseFloat(extractTag(evalBlock, 'confidence')) || 0,
      saturated: extractTag(evalBlock, 'saturated') === 'true',
    };
  } catch (e: any) {
    log('evaluateResearch failed, defaulting to continue:', e.message);
    return {
      action: 'continue',
      reasoning: 'Evaluation failed, continuing by default',
      gaps: [],
      contradictions: [],
      pivotQueries: [],
      confidence: 0,
      saturated: false,
    };
  }
}

// ── Search query generation ───────────────────────────────────────────

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
    model: getModelForRole(config?.modelSettings, 'thinking'),
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
        model: getModelForRole(config?.modelSettings, 'fast'),
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
    model: getModelForRole(config?.modelSettings, 'thinking'),
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
    model: getModelForRole(config?.modelSettings, 'thinking'),
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
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  config?: ResearchConfig;
  /** @internal kept for API compat — ignored in iterative implementation */
  _sharedProgress?: ResearchProgress;
}): Promise<ResearchResult> {
  const defaults = getDefaults(config);
  const searchProvider = resolveSearchProvider(config);
  const budget = createBudget(breadth, depth, config);

  let accumulatedLearnings = [...learnings];
  let accumulatedUrls = [...visitedUrls];
  let currentBreadth = breadth;
  let currentQueries = [query]; // seed queries for level 0
  let stopReason: StopReason | undefined;

  const progress: ResearchProgress = {
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

  for (let level = 0; level < depth; level++) {
    if (isBudgetExhausted(budget)) {
      stopReason = 'budget_exhausted';
      log(`Budget exhausted at level ${level}`);
      break;
    }

    // Step 1: Generate search queries for this level
    const allSerpQueries: Array<{ query: string; researchGoal: string }> = [];
    const queriesPerSeed = Math.max(
      1,
      Math.ceil(currentBreadth / currentQueries.length),
    );

    for (const q of currentQueries) {
      const queries = await generateSerpQueries({
        query: q,
        learnings: accumulatedLearnings,
        numQueries: queriesPerSeed,
        config,
      });
      allSerpQueries.push(...queries);
    }

    log(
      `Level ${level}: generated ${allSerpQueries.length} queries (breadth=${currentBreadth})`,
    );

    reportProgress({
      currentDepth: depth - level,
      currentBreadth: currentBreadth,
      totalQueries: progress.totalQueries + allSerpQueries.length,
      currentQuery: allSerpQueries[0]?.query,
      budget: {
        maxQueries: budget.maxQueries,
        usedQueries: budget.usedQueries,
        maxDepth: depth,
      },
    });

    // Step 2: Execute searches and extract learnings (parallel)
    const limit = pLimit(defaults.concurrencyLimit);
    let levelFollowUps: string[] = [];

    const results = await Promise.all(
      allSerpQueries.map(serpQuery =>
        limit(async () => {
          if (isBudgetExhausted(budget)) {
            return { learnings: [], followUps: [], urls: [] };
          }

          try {
            budget.usedQueries++;
            const result = await searchProvider.search(serpQuery.query, 5);
            const newUrls = compact(result.results.map(item => item.url));

            const processed = await processSerpResult({
              query: serpQuery.query,
              result,
              numFollowUpQuestions: Math.ceil(currentBreadth / 2),
              config,
            });

            reportProgress({
              completedQueries: progress.completedQueries + 1,
              currentQuery: serpQuery.query,
            });

            return {
              learnings: processed.learnings,
              followUps: processed.followUpQuestions,
              urls: newUrls,
            };
          } catch (e: any) {
            log(`Error running query: ${serpQuery.query}: `, e);
            return { learnings: [], followUps: [], urls: [] };
          }
        }),
      ),
    );

    // Step 3: Merge results into accumulated state
    const newLearnings = results.flatMap(r => r.learnings);
    const newUrls = results.flatMap(r => r.urls);
    levelFollowUps = results.flatMap(r => r.followUps);

    for (const l of newLearnings) {
      if (!accumulatedLearnings.includes(l)) accumulatedLearnings.push(l);
    }
    for (const u of newUrls) {
      if (!accumulatedUrls.includes(u)) accumulatedUrls.push(u);
    }

    reportProgress({
      learnings: [...accumulatedLearnings],
      visitedUrls: [...accumulatedUrls],
    });

    // Step 4: ReAct reasoning (skip on last level — no point evaluating if we can't recurse)
    if (level < depth - 1 && !isBudgetExhausted(budget)) {
      log(`ReAct evaluation after level ${level}...`);

      const decision = await evaluateResearch({
        originalQuery: query,
        learnings: accumulatedLearnings,
        visitedUrls: accumulatedUrls,
        currentDepth: level + 1,
        maxDepth: depth,
        budget,
        config,
      });

      log(
        `ReAct decision: ${decision.action} (confidence=${decision.confidence}, saturated=${decision.saturated})`,
      );
      reportProgress({ lastDecision: decision });

      if (decision.action === 'stop') {
        stopReason = decision.saturated ? 'saturated' : 'sufficient_coverage';
        log(`Stopping early: ${stopReason}`);
        break;
      } else if (decision.action === 'pivot') {
        currentQueries =
          decision.pivotQueries.length > 0
            ? decision.pivotQueries
            : levelFollowUps.slice(0, currentBreadth);
        log(`Pivoting to ${currentQueries.length} new queries`);
      } else {
        // 'continue': use follow-up questions
        currentQueries = levelFollowUps.slice(0, currentBreadth);
      }

      if (currentQueries.length === 0) {
        stopReason = 'saturated';
        log('No follow-up queries available, stopping');
        break;
      }
    }

    // Halve breadth for next level (matches original behavior)
    currentBreadth = Math.ceil(currentBreadth / 2);
  }

  if (!stopReason) stopReason = 'max_depth';

  reportProgress({
    currentDepth: 0,
    stopReason,
  });

  log(
    `Research complete: ${accumulatedLearnings.length} learnings, ${accumulatedUrls.length} URLs, reason=${stopReason}`,
  );

  return {
    learnings: [...new Set(accumulatedLearnings)],
    visitedUrls: [...new Set(accumulatedUrls)],
  };
}
