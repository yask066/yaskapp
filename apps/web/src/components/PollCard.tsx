import { useState, type FormEvent } from 'react';
import type { Poll } from '../api/models';
import { Avatar } from './Avatar';

interface PollCardProps {
  poll: Poll;
  viewerId?: string | null;
  onVote?: (poll: Poll, optionId: string) => void;
  onLike?: (poll: Poll) => void;
  onOpenComments?: (poll: Poll) => void;
}

export function PollCard({ poll, viewerId, onVote, onLike, onOpenComments }: PollCardProps) {
  const [selectedOptionId, setSelectedOptionId] = useState(poll.viewerVoteOptionId ?? '');
  const authorName = poll.author.displayName || poll.author.username;
  const canVote = Boolean(onVote && selectedOptionId);

  function submitVote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (onVote && selectedOptionId) onVote(poll, selectedOptionId);
  }

  return (
    <article aria-labelledby={`poll-${poll.id}-question`}>
      <header>
        <Avatar name={authorName} src={poll.author.avatarUrl} />
        <p>{viewerId === poll.author.id ? 'You' : authorName}</p>
      </header>
      <h2 id={`poll-${poll.id}-question`}>{poll.question}</h2>
      {poll.imageUrl ? <img src={poll.imageUrl} alt="" /> : null}
      <form onSubmit={submitVote}>
        <fieldset>
          <legend>Choose an option</legend>
          {poll.options.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name={`poll-${poll.id}`}
                value={option.id}
                checked={selectedOptionId === option.id}
                disabled={!onVote}
                onChange={() => setSelectedOptionId(option.id)}
              />
              {option.text} ({option.votesCount})
            </label>
          ))}
        </fieldset>
        <button type="submit" disabled={!canVote} aria-describedby={onVote ? undefined : `poll-${poll.id}-vote-help`}>Vote</button>
        {!onVote ? <p id={`poll-${poll.id}-vote-help`}>Sign in to vote on this poll.</p> : null}
      </form>
      <footer>
        <button type="button" disabled={!onLike} onClick={() => onLike?.(poll)} aria-describedby={onLike ? undefined : `poll-${poll.id}-like-help`}>
          Like ({poll.likesCount})
        </button>
        {!onLike ? <p id={`poll-${poll.id}-like-help`}>Sign in to like this poll.</p> : null}
        <button type="button" onClick={() => onOpenComments?.(poll)}>Comments ({poll.commentsCount})</button>
      </footer>
    </article>
  );
}
