import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPoll } from '../../api/polls';
import type { Poll } from '../../api/models';
import { mutationErrorMessage } from './usePollMutations';

const minimumOptions = 2;
const maximumOptions = 6;

function validate(question: string, options: string[]): string | null {
  const trimmedOptions = options.map((option) => option.trim());
  if (question.trim().length < 1 || question.trim().length > 280) return 'Question must contain 1 to 280 characters.';
  if (trimmedOptions.some((option) => !option)) return 'Every option must contain text.';
  if (new Set(trimmedOptions.map((option) => option.toLocaleLowerCase())).size !== trimmedOptions.length) return 'Options must be distinct.';
  return null;
}

export function CreatePollPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [allowVoteCancellation, setAllowVoteCancellation] = useState(true);
  const [image, setImage] = useState<File>();
  const validationError = validate(question, options);
  const createMutation = useMutation({
    mutationFn: () => createPoll({ question: question.trim(), options: options.map((option) => option.trim()), allowVoteCancellation, image }),
    onSuccess: (poll: Poll) => {
      queryClient.setQueryData<Poll[]>(['polls', 'newest'], (cached = []) => [poll, ...cached.filter((item) => item.id !== poll.id)]);
      navigate('/');
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validationError && !createMutation.isPending) createMutation.mutate();
  }

  return (
    <main id="main-content" className="focused-page poll-editor">
      <h1>Create poll</h1>
      <form className="form-panel" aria-label="Create a poll" onSubmit={submit} noValidate>
        <div className="field"><label htmlFor="poll-question">Question</label>
        <textarea id="poll-question" value={question} maxLength={280} onChange={(event) => setQuestion(event.target.value)} required />
        <p>{question.length}/280</p>
        </div><fieldset className="poll-editor__options">
          <legend>Options</legend>
          {options.map((option, index) => <div className="field-row" key={index}>
            <label htmlFor={`poll-option-${index}`}>Option {index + 1}</label>
            <input id={`poll-option-${index}`} value={option} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required />
            {options.length > minimumOptions ? <button type="button" onClick={() => setOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove option {index + 1}</button> : null}
          </div>)}
          {options.length < maximumOptions ? <button className="button" type="button" onClick={() => setOptions((current) => [...current, ''])}>Add option</button> : null}
        </fieldset>
        <label className="field"><span><input type="checkbox" checked={allowVoteCancellation} onChange={(event) => setAllowVoteCancellation(event.target.checked)} /> Allow voters to cancel their vote</span></label>
        <div className="field"><label htmlFor="poll-image">Image</label>
        <input id="poll-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setImage(event.target.files?.[0])} />
        </div>{validationError ? <p className="inline-alert" role="alert">{validationError}</p> : null}
        {createMutation.error ? <p className="inline-alert" role="alert">{mutationErrorMessage(createMutation.error)}</p> : null}
        <div className="form-actions"><button className="button button--primary" type="submit" disabled={Boolean(validationError) || createMutation.isPending}>{createMutation.isPending ? 'Creating poll…' : 'Create poll'}</button></div>
      </form>
    </main>
  );
}
