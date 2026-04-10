import type { ResearchProgress } from '../core/deep-research';

export type SessionStatus =
  | 'created'
  | 'generating_feedback'
  | 'waiting_for_feedback'
  | 'researching'
  | 'generating_report'
  | 'completed'
  | 'error';

export interface Session {
  id: string;
  name: string;
  query: string;
  breadth: number;
  depth: number;
  status: SessionStatus;
  feedbackQuestions: string[];
  feedbackAnswers: string[];
  progress: ResearchProgress | null;
  learnings: string[];
  visitedUrls: string[];
  reportMarkdown: string | null;
  pdfGenerated: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionEvent {
  id: number;
  type:
    | 'status'
    | 'progress'
    | 'feedback_questions'
    | 'learnings'
    | 'report_ready'
    | 'error'
    | 'log';
  data: any;
  timestamp: string;
}

export type SearchProviderType = 'tavily' | 'searxng';

export interface AppSettings {
  openaiKey: string;
  openaiEndpoint: string;
  customModel: string;
  tavilyApiKey: string;
  searchProvider: SearchProviderType;
  searxngUrl: string;
  contextSize: number;
  llmTimeout: number;
  tavilyConcurrency: number;
  fireworksKey: string;
  /** Model name for fast tasks (extraction, summarization). Empty = use primary model. */
  fastModel: string;
  /** Endpoint for fast model. Empty = use primary endpoint. */
  fastModelEndpoint: string;
  /** Max total search queries (0 = auto from breadth/depth). */
  maxQueries: number;
  /** Max research time in ms (0 = unlimited). */
  maxTimeMs: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  openaiKey: '',
  openaiEndpoint: '',
  customModel: '',
  tavilyApiKey: '',
  searchProvider: 'searxng',
  searxngUrl: 'http://localhost:8080',
  contextSize: 128_000,
  llmTimeout: 180_000,
  tavilyConcurrency: 2,
  fireworksKey: '',
  fastModel: '',
  fastModelEndpoint: '',
  maxQueries: 0,
  maxTimeMs: 0,
};
