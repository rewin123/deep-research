import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

import type { Response } from 'express';

import { deepResearch, writeFinalReport } from '../core/deep-research';
import { generateFeedback } from '../core/feedback';
import { generatePdf, saveMarkdown } from './pdf';
import { loadSettings, settingsToResearchConfig } from './settings';
import type { Session, SessionEvent, SessionStatus } from './types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private eventLogs: Map<string, SessionEvent[]> = new Map();
  private sseClients: Map<string, Set<Response>> = new Map();
  private heartbeatIntervals: Map<string, NodeJS.Timeout> = new Map();

  async init() {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    await this.loadSessions();
  }

  private async loadSessions() {
    try {
      const files = await fs.readdir(SESSIONS_DIR);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await fs.readFile(
            path.join(SESSIONS_DIR, file),
            'utf-8',
          );
          const session: Session = JSON.parse(raw);
          this.sessions.set(session.id, session);
          this.eventLogs.set(session.id, []);
          // Re-emit initial state as event for reconnecting clients
          this.emitEvent(session.id, {
            type: 'status',
            data: { status: session.status },
          });
          if (session.progress) {
            this.emitEvent(session.id, {
              type: 'progress',
              data: session.progress,
            });
          }
          if (session.learnings.length > 0) {
            this.emitEvent(session.id, {
              type: 'learnings',
              data: { learnings: session.learnings, visitedUrls: session.visitedUrls },
            });
          }
          if (session.feedbackQuestions.length > 0) {
            this.emitEvent(session.id, {
              type: 'feedback_questions',
              data: { questions: session.feedbackQuestions },
            });
          }
          if (session.reportMarkdown) {
            this.emitEvent(session.id, {
              type: 'report_ready',
              data: { name: session.name },
            });
          }
          if (session.error) {
            this.emitEvent(session.id, {
              type: 'error',
              data: { message: session.error },
            });
          }
        } catch (e) {
          console.error(`Failed to load session from ${file}:`, e);
        }
      }
    } catch {
      // Directory empty or doesn't exist — fine
    }
  }

  private async persistSession(session: Session) {
    session.updatedAt = new Date().toISOString();
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    await fs.writeFile(
      path.join(SESSIONS_DIR, `${session.id}.json`),
      JSON.stringify(session, null, 2),
      'utf-8',
    );
  }

  private emitEvent(
    sessionId: string,
    event: Omit<SessionEvent, 'id' | 'timestamp'>,
  ) {
    const events = this.eventLogs.get(sessionId) ?? [];
    const fullEvent: SessionEvent = {
      ...event,
      id: events.length,
      timestamp: new Date().toISOString(),
    };
    events.push(fullEvent);
    this.eventLogs.set(sessionId, events);

    // Broadcast to connected SSE clients
    const clients = this.sseClients.get(sessionId);
    if (clients) {
      const data = `data: ${JSON.stringify(fullEvent)}\n\n`;
      for (const client of clients) {
        try {
          client.write(data);
        } catch {
          clients.delete(client);
        }
      }
    }
  }

  private updateStatus(session: Session, status: SessionStatus) {
    session.status = status;
    this.emitEvent(session.id, { type: 'status', data: { status } });
    this.persistSession(session).catch(console.error);
  }

  generateSessionName(query: string): string {
    const date = new Date().toISOString().slice(0, 10);
    // Take first 50 chars of query, sanitize for filesystem
    const slug = query
      .slice(0, 50)
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+$/, '');
    return `${date}-${slug || 'research'}`;
  }

  async createSession(
    query: string,
    breadth = 4,
    depth = 2,
  ): Promise<Session> {
    const id = uuidv4();
    const name = this.generateSessionName(query);

    const session: Session = {
      id,
      name,
      query,
      breadth,
      depth,
      status: 'created',
      feedbackQuestions: [],
      feedbackAnswers: [],
      progress: null,
      learnings: [],
      visitedUrls: [],
      reportMarkdown: null,
      pdfGenerated: false,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(id, session);
    this.eventLogs.set(id, []);
    await this.persistSession(session);

    // Start the research pipeline in background (fire-and-forget)
    this.runResearchPipeline(session).catch(err => {
      console.error(`Pipeline error for session ${id}:`, err);
    });

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getAllSessions(): Session[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async deleteSession(id: string) {
    this.sessions.delete(id);
    this.eventLogs.delete(id);
    const clients = this.sseClients.get(id);
    if (clients) {
      for (const client of clients) {
        try {
          client.end();
        } catch { /* ignore */ }
      }
    }
    this.sseClients.delete(id);
    const interval = this.heartbeatIntervals.get(id);
    if (interval) clearInterval(interval);
    this.heartbeatIntervals.delete(id);
    try {
      await fs.unlink(path.join(SESSIONS_DIR, `${id}.json`));
    } catch { /* ignore */ }
  }

  getEvents(id: string): SessionEvent[] {
    return this.eventLogs.get(id) ?? [];
  }

  addSSEClient(sessionId: string, res: Response) {
    if (!this.sseClients.has(sessionId)) {
      this.sseClients.set(sessionId, new Set());
    }
    this.sseClients.get(sessionId)!.add(res);

    // Replay all past events
    const events = this.eventLogs.get(sessionId) ?? [];
    for (const event of events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    // Heartbeat
    if (!this.heartbeatIntervals.has(sessionId)) {
      const interval = setInterval(() => {
        const clients = this.sseClients.get(sessionId);
        if (!clients || clients.size === 0) {
          clearInterval(interval);
          this.heartbeatIntervals.delete(sessionId);
          return;
        }
        for (const client of clients) {
          try {
            client.write(': heartbeat\n\n');
          } catch {
            clients.delete(client);
          }
        }
      }, 30_000);
      this.heartbeatIntervals.set(sessionId, interval);
    }
  }

  removeSSEClient(sessionId: string, res: Response) {
    this.sseClients.get(sessionId)?.delete(res);
  }

  submitFeedback(id: string, answers: string[]): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'waiting_for_feedback') {
      return false;
    }
    session.feedbackAnswers = answers;
    // The pipeline is waiting for this — resolve it
    const resolver = this.feedbackResolvers.get(id);
    if (resolver) {
      resolver(answers);
      this.feedbackResolvers.delete(id);
    }
    return true;
  }

  // Feedback waiting mechanism
  private feedbackResolvers: Map<string, (answers: string[]) => void> =
    new Map();

  private waitForFeedback(sessionId: string): Promise<string[]> {
    return new Promise(resolve => {
      this.feedbackResolvers.set(sessionId, resolve);
    });
  }

  private async runResearchPipeline(session: Session) {
    try {
      const settings = await loadSettings();
      const researchConfig = settingsToResearchConfig(settings);

      // Step 1: Generate feedback questions
      this.updateStatus(session, 'generating_feedback');
      this.emitEvent(session.id, {
        type: 'log',
        data: { message: 'Generating clarifying questions...' },
      });

      const questions = await generateFeedback({
        query: session.query,
        modelSettings: researchConfig.modelSettings,
      });

      session.feedbackQuestions = questions;
      await this.persistSession(session);

      this.emitEvent(session.id, {
        type: 'feedback_questions',
        data: { questions },
      });

      // Step 2: Wait for user feedback
      this.updateStatus(session, 'waiting_for_feedback');

      const answers = await this.waitForFeedback(session.id);
      session.feedbackAnswers = answers;
      await this.persistSession(session);

      // Build combined query
      const combinedQuery = `
Initial Query: ${session.query}
Follow-up Questions and Answers:
${session.feedbackQuestions.map((q, i) => `Q: ${q}\nA: ${answers[i] ?? ''}`).join('\n')}
`.trim();

      // Step 3: Deep research
      this.updateStatus(session, 'researching');
      this.emitEvent(session.id, {
        type: 'log',
        data: { message: 'Starting deep research...' },
      });

      const { learnings, visitedUrls } = await deepResearch({
        query: combinedQuery,
        breadth: session.breadth,
        depth: session.depth,
        config: researchConfig,
        onProgress: progress => {
          session.progress = progress;
          session.learnings = progress.learnings;
          session.visitedUrls = progress.visitedUrls;
          this.emitEvent(session.id, { type: 'progress', data: progress });
          this.emitEvent(session.id, {
            type: 'learnings',
            data: { learnings: progress.learnings, visitedUrls: progress.visitedUrls },
          });
        },
      });

      session.learnings = learnings;
      session.visitedUrls = visitedUrls;
      await this.persistSession(session);

      // Step 4: Generate report
      this.updateStatus(session, 'generating_report');
      this.emitEvent(session.id, {
        type: 'log',
        data: { message: 'Generating final report...' },
      });

      const report = await writeFinalReport({
        prompt: combinedQuery,
        learnings,
        visitedUrls,
        config: researchConfig,
      });

      session.reportMarkdown = report;
      await this.persistSession(session);

      // Save files
      await saveMarkdown(session.name, report);

      try {
        await generatePdf(session.name, report);
        session.pdfGenerated = true;
      } catch (pdfErr) {
        console.error('PDF generation failed (non-fatal):', pdfErr);
        session.pdfGenerated = false;
        this.emitEvent(session.id, {
          type: 'log',
          data: {
            message:
              'PDF generation failed — markdown report is still available.',
          },
        });
      }

      this.updateStatus(session, 'completed');
      this.emitEvent(session.id, {
        type: 'report_ready',
        data: { name: session.name },
      });
    } catch (err: any) {
      console.error(`Session ${session.id} failed:`, err);
      session.error = err.message ?? String(err);
      this.updateStatus(session, 'error');
      this.emitEvent(session.id, {
        type: 'error',
        data: { message: session.error },
      });
    }
  }
}
