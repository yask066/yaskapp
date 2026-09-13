import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Poll } from '../api/models';
import { Avatar } from './Avatar';
import { MaterialIcon } from './MaterialIcon';

interface PollCardProps {
  poll: Poll;
  viewerId?: string | null;
  onVote?: (pollId: string, optionId: string) => void;
  onCancelVote?: (pollId: string) => void;
  onLike?: (pollId: string, viewerHasLiked: boolean) => void;
  onDelete?: (pollId: string) => void;
  onOpenComments?: (poll: Poll) => void;
}

export function PollCard({ poll, viewerId, onVote, onCancelVote, onLike, onDelete, onOpenComments }: PollCardProps) {
  const [selectedOptionId, setSelectedOptionId] = useState(poll.viewerVoteOptionId ?? '');
  const authorName = poll.author.displayName || poll.author.username;
  const isClosed = Boolean(poll.endsAt && new Date(poll.endsAt).getTime() <= Date.now());
  const hasVoted = Boolean(poll.viewerVoteOptionId);
  const voteHelp = viewerId ? 'Voting is not available for this poll.' : 'Sign in to vote on this poll.';
  const likeHelp = viewerId ? 'Liking is not available for this poll.' : 'Sign in to like this poll.';
  const createdLabel = formatPollDate(poll.createdAt);
  useEffect(() => setSelectedOptionId(poll.viewerVoteOptionId ?? ''), [poll.viewerVoteOptionId]);

  return (
    <article className="poll-card" aria-labelledby={`poll-${poll.id}-question`}>
      <header className="poll-card-header">
        <Avatar name={authorName} src={poll.author.avatarUrl} />
        <div className="poll-author-meta">
          <p>{viewerId === poll.author.id ? 'You' : authorName} <span className="poll-author-handle" data-handle={`@${poll.author.username}`} /><time className="poll-card-time" dateTime={poll.createdAt}> · {createdLabel}</time></p>
        </div>
        <button className="poll-menu-button" type="button" aria-label="More poll actions"><MaterialIcon name="more" /></button>
      </header>
      <h2 id={`poll-${poll.id}-question`}><Link to={`/polls/${poll.id}`}>{poll.question}</Link></h2>
      {poll.imageUrl ? <img src={poll.imageUrl} alt="" /> : null}
      <section aria-label="Vote on this poll">
        <fieldset className="poll-options">
          <legend>Choose an option</legend>
          {poll.options.map((option) => (
            <div className={`poll-option${selectedOptionId === option.id ? ' is-selected' : ''}`} key={option.id}>
              <label>
              <input
                type="radio"
                name={`poll-${poll.id}`}
                value={option.id}
                aria-label={`${option.text} (${option.votesCount})`}
                checked={selectedOptionId === option.id}
                disabled={!onVote || hasVoted || isClosed}
                onChange={() => setSelectedOptionId(option.id)}
              />
              <span className="poll-option-label">{option.text}</span>
              <span className="poll-option-votes">{formatVotes(option.votesCount)}</span>
              {hasVoted ? <span className="poll-option-percent">{poll.votesCount ? Math.round((option.votesCount / poll.votesCount) * 100) : 0}%</span> : null}
              </label>
              {hasVoted ? (() => {
                const percentage = poll.votesCount ? Math.round((option.votesCount / poll.votesCount) * 100) : 0;
                return <div className="poll-result-bar" role="progressbar" aria-label={option.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><span style={{ width: `${percentage}%` }} /></div>;
              })() : null}
              <button type="button" disabled={!onVote || hasVoted || isClosed || selectedOptionId !== option.id} onClick={() => onVote?.(poll.id, option.id)} aria-describedby={onVote ? undefined : `poll-${poll.id}-vote-help`}>Vote for {option.text}</button>
            </div>
          ))}
        </fieldset>
        {!onVote ? <p id={`poll-${poll.id}-vote-help`}>{voteHelp}</p> : null}
        {hasVoted && poll.allowVoteCancellation && !isClosed && onCancelVote ? <button type="button" onClick={() => onCancelVote(poll.id)}>Cancel vote</button> : null}
      </section>
      <footer className="poll-actions">
        <button type="button" disabled={!onLike} onClick={() => onLike?.(poll.id, poll.viewerHasLiked)} aria-pressed={poll.viewerHasLiked} aria-describedby={onLike ? undefined : `poll-${poll.id}-like-help`}>
          <MaterialIcon className="poll-action-icon" name={poll.viewerHasLiked ? 'favorite' : 'favorite_border'} /> Like ({poll.likesCount})
        </button>
        {!onLike ? <p id={`poll-${poll.id}-like-help`}>{likeHelp}</p> : null}
        <button type="button" disabled={!onOpenComments} onClick={() => onOpenComments?.(poll)} aria-describedby={onOpenComments ? undefined : `poll-${poll.id}-comments-help`}>
          <MaterialIcon className="poll-action-icon" name="mode_comment_outlined" /> Comments ({poll.commentsCount})
        </button>
        {!onOpenComments ? <p id={`poll-${poll.id}-comments-help`}>Comments are not available yet.</p> : null}
        {viewerId === poll.author.id && onDelete ? <button className="poll-delete-action" type="button" aria-label="Delete poll" onClick={() => { if (window.confirm('Delete this poll?')) onDelete(poll.id); }}><MaterialIcon className="poll-action-icon" name="delete_outline" /> Delete</button> : null}
      </footer>
    </article>
  );
}

function formatVotes(count: number) {
  return `${count} ${count === 1 ? 'vote' : 'votes'}`;
}

function formatPollDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(
    Math.round((date.getTime() - Date.now()) / 86_400_000),
    'day',
  );
}
