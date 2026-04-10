const BASE = '/api';

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON response from ${path} but got ${contentType || 'unknown content-type'} (status ${res.status}). ` +
      'Is the API server running?',
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface SessionSummary {
  id: string;
  name: string;
  query: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  progress: any;
}

export interface SessionDetail {
  id: string;
  name: string;
  query: string;
  breadth: number;
  depth: number;
  status: string;
  feedbackQuestions: string[];
  feedbackAnswers: string[];
  progress: any;
  learnings: string[];
  visitedUrls: string[];
  reportMarkdown: string | null;
  pdfGenerated: boolean;
  error: string | null;
  createdAt: string;
  updatedAt: string;
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
  fastModel: string;
  fastModelEndpoint: string;
  maxQueries: number;
  maxTimeMs: number;
}

// Sessions
export const getSessions = () =>
  request<SessionSummary[]>('/sessions');

export const getSession = (id: string) =>
  request<SessionDetail>(`/sessions/${id}`);

export const createSession = (data: {
  query: string;
  breadth?: number;
  depth?: number;
}) =>
  request<SessionDetail>('/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const deleteSession = (id: string) =>
  request<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' });

export const submitFeedback = (id: string, answers: string[]) =>
  request<{ ok: boolean }>(`/sessions/${id}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });

// Settings
export const getSettings = () =>
  request<AppSettings>('/settings/raw');

export const getMaskedSettings = () =>
  request<Record<string, any>>('/settings');

export const updateSettings = (settings: Partial<AppSettings>) =>
  request<Record<string, any>>('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });

// File download URLs
export const getMarkdownUrl = (id: string) =>
  `${BASE}/sessions/${id}/download/md`;

export const getPdfUrl = (id: string) =>
  `${BASE}/sessions/${id}/download/pdf`;
