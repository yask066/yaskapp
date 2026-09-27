import { useId, useState } from 'react';
import { mutationErrorMessage } from '../polls/usePollMutations';

interface CommentFormProps {
  onSubmit(body: string): Promise<void>;
  label?: string;
  submitLabel?: string;
  replyToLabel?: string;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function CommentForm({
  onSubmit,
  label = 'Add a comment',
  submitLabel = 'Post comment',
  replyToLabel,
  onCancel,
  cancelLabel = 'Cancel reply',
}: CommentFormProps) {
  const textareaId = useId();
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
      {replyToLabel ? <p className="comment-form__reply-to">Replying to {replyToLabel}</p> : null}
      <label className="field" htmlFor={textareaId}>{label}
        <textarea id={textareaId} value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} required />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <div className="comment-form__actions">
        <button className="button button--primary" type="submit" disabled={isSubmitting}>{submitLabel}</button>
        {onCancel ? <button className="button comment-form__cancel" type="button" onClick={onCancel} disabled={isSubmitting}>{cancelLabel}</button> : null}
      </div>
    </form>
  );
}
