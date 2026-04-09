import { useState } from 'react';

export function FeedbackForm({
  questions,
  onSubmit,
  disabled,
}: {
  questions: string[];
  onSubmit: (answers: string[]) => void;
  disabled?: boolean;
}) {
  const [answers, setAnswers] = useState<string[]>(
    questions.map(() => ''),
  );

  const handleChange = (index: number, value: string) => {
    setAnswers(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(answers);
  };

  return (
    <form className="feedback-form" onSubmit={handleSubmit}>
      <h3>Please answer these clarifying questions:</h3>
      {questions.map((question, i) => (
        <div key={i} className="feedback-question">
          <label className="feedback-label">
            {i + 1}. {question}
          </label>
          <textarea
            className="feedback-input"
            value={answers[i]}
            onChange={e => handleChange(i, e.target.value)}
            placeholder="Your answer..."
            rows={3}
            disabled={disabled}
          />
        </div>
      ))}
      <button type="submit" className="btn btn-primary" disabled={disabled}>
        Start Research
      </button>
    </form>
  );
}
