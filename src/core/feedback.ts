import { generateText } from 'ai';

import { type ModelSettings, getModel } from './ai/providers';
import { systemPrompt } from './prompt';

export async function generateFeedback({
  query,
  numQuestions = 3,
  modelSettings,
}: {
  query: string;
  numQuestions?: number;
  modelSettings?: ModelSettings;
}) {
  const res = await generateText({
    model: getModel(modelSettings),
    system: systemPrompt(),
    prompt: `Given the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear.

<query>${query}</query>

Return each question inside <question>…</question> tags.`,
  });

  const re = /<question>([\s\S]*?)<\/question>/g;
  const questions: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(res.text)) !== null) {
    const q = m[1]?.trim();
    if (q) questions.push(q);
  }

  return questions.slice(0, numQuestions);
}
