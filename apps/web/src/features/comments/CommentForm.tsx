import { useState } from 'react';
import { mutationErrorMessage } from '../polls/usePollMutations';

interface CommentFormProps {
  onSubmit(body: string): Promise<void>;
}

export function CommentForm({ onSubmit }: CommentFormProps) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (trimmedBody.length < 1 || trimmedBody.length > 1000) {
      setError('Comments must contain between 1 and 1000 non-whitespace characters.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(trimmedBody);
      setBody('');
    } catch (submissionError) {
      setError(mutationErrorMessage(submissionError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="comment-form" onSubmit={(event) => void submit(event)}>
      <label className="field" htmlFor="comment-body">Add a comment
        <textarea id="comment-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} required />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button className="button button--primary" type="submit" disabled={isSubmitting}>Post comment</button>
    </form>
  );
}
