import { useCallback, useEffect, useRef, useState } from 'react';

export interface SSEEvent {
  id: number;
  type: string;
  data: any;
  timestamp: string;
}

export function useSessionSSE(sessionId: string | undefined) {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [progress, setProgress] = useState<any>(null);
  const [feedbackQuestions, setFeedbackQuestions] = useState<string[]>([]);
  const [learnings, setLearnings] = useState<string[]>([]);
  const [visitedUrls, setVisitedUrls] = useState<string[]>([]);
  const [reportReady, setReportReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);

  const processEvent = useCallback((event: SSEEvent) => {
    switch (event.type) {
      case 'status':
        setStatus(event.data.status);
        break;
      case 'progress':
        setProgress(event.data);
        break;
      case 'feedback_questions':
        setFeedbackQuestions(event.data.questions);
        break;
      case 'learnings':
        setLearnings(event.data.learnings);
        setVisitedUrls(event.data.visitedUrls);
        break;
      case 'report_ready':
        setReportReady(true);
        break;
      case 'error':
        setError(event.data.message);
        break;
      case 'log':
        setLogs(prev => [...prev, event.data.message]);
        break;
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    // Reset state
    setEvents([]);
    setIsConnected(false);
    setStatus('');
    setProgress(null);
    setFeedbackQuestions([]);
    setLearnings([]);
    setVisitedUrls([]);
    setReportReady(false);
    setError(null);
    setLogs([]);

    const connect = () => {
      const es = new EventSource(`/api/sessions/${sessionId}/events`);
      eventSourceRef.current = es;

      es.onopen = () => setIsConnected(true);

      es.onmessage = (msg) => {
        try {
          const event: SSEEvent = JSON.parse(msg.data);
          if (event.type === 'connected') return; // skip connection event
          setEvents(prev => [...prev, event]);
          processEvent(event);
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [sessionId, processEvent]);

  return {
    events,
    isConnected,
    status,
    progress,
    feedbackQuestions,
    learnings,
    visitedUrls,
    reportReady,
    error,
    logs,
  };
}
