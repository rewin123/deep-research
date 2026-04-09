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

export interface AppSettings {
  openaiKey: string;
  openaiEndpoint: string;
  customModel: string;
  tavilyApiKey: string;
  contextSize: number;
  llmTimeout: number;
  tavilyConcurrency: number;
  fireworksKey: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  openaiKey: '',
  openaiEndpoint: '',
  customModel: '',
  tavilyApiKey: '',
  contextSize: 128_000,
  llmTimeout: 180_000,
  tavilyConcurrency: 2,
  fireworksKey: '',
};
