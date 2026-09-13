import { useState } from 'react';
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
  isVoting?: boolean;
}

export function PollCard({ poll, viewerId, onVote, onCancelVote, onLike, onDelete, onOpenComments, isVoting = false }: PollCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const authorName = poll.author.displayName || poll.author.username;
  const isClosed = Boolean(poll.endsAt && new Date(poll.endsAt).getTime() <= Date.now());
  const hasVoted = Boolean(poll.viewerVoteOptionId);
  const canCancelVote = hasVoted && poll.allowVoteCancellation && !isClosed && Boolean(onCancelVote);
  const canDeletePoll = viewerId === poll.author.id && Boolean(onDelete);
  const voteHelp = viewerId ? 'Voting is not available for this poll.' : 'Sign in to vote on this poll.';
  const likeHelp = viewerId ? 'Liking is not available for this poll.' : 'Sign in to like this poll.';
  const createdLabel = formatPollDate(poll.createdAt);
  return (
    <article className="poll-card" aria-labelledby={`poll-${poll.id}-question`}>
      <header className="poll-card-header">
        <Avatar name={authorName} src={poll.author.avatarUrl} />
        <div className="poll-author-meta">
          <p>{viewerId === poll.author.id ? 'You' : authorName} <span className="poll-author-handle" data-handle={`@${poll.author.username}`} /><time className="poll-card-time" dateTime={poll.createdAt}> · {createdLabel}</time></p>
        </div>
        <div className="poll-menu">
          <button className="poll-menu-button" type="button" aria-label="More poll actions" aria-expanded={menuOpen} aria-controls={`poll-${poll.id}-menu`} onClick={() => setMenuOpen((open) => !open)}><MaterialIcon name="more" /></button>
          {menuOpen && (canDeletePoll || canCancelVote) ? <div className="poll-menu-dropdown" id={`poll-${poll.id}-menu`} role="menu">
            {canCancelVote ? <button className="poll-cancel-action" type="button" role="menuitem" onClick={() => { setMenuOpen(false); onCancelVote?.(poll.id); }}>Cancel vote</button> : null}
            {canDeletePoll ? <button className="poll-delete-action" type="button" role="menuitem" onClick={() => { setMenuOpen(false); if (window.confirm('Delete this poll?')) onDelete?.(poll.id); }}><MaterialIcon className="poll-action-icon" name="delete_outline" /> Delete poll</button> : null}
          </div> : null}
        </div>
      </header>
      <h2 id={`poll-${poll.id}-question`}><Link to={`/polls/${poll.id}`}>{poll.question}</Link></h2>
      {poll.imageUrl ? <img src={poll.imageUrl} alt="" /> : null}
      <section aria-label="Vote on this poll">
        <fieldset className="poll-options">
          <legend>Choose an option</legend>
          {poll.options.map((option) => (
            (() => {
              const percentage = poll.votesCount ? Math.round((option.votesCount / poll.votesCount) * 100) : 0;
              const canVote = Boolean(onVote) && !hasVoted && !isClosed && !isVoting;
              return <button className={`poll-option${poll.viewerVoteOptionId === option.id ? ' is-selected' : ''}${hasVoted ? ' is-results' : ''}`} key={option.id} type="button" disabled={!canVote} onClick={() => onVote?.(poll.id, option.id)} aria-label={`${option.text} (${formatVotes(option.votesCount)})`} aria-describedby={onVote ? undefined : `poll-${poll.id}-vote-help`}>
                <span className="poll-option-label">{option.text}</span>
                <span className="poll-option-votes">{formatVotes(option.votesCount)}</span>
                <span className="poll-option-percent">{percentage}%</span>
                <span className="poll-result-bar" role="progressbar" aria-label={option.text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><span style={{ width: `${percentage}%` }} /></span>
                {isVoting && poll.viewerVoteOptionId === option.id ? <span className="poll-option-loading" aria-label="Submitting vote">…</span> : null}
              </button>;
            })()
          ))}
        </fieldset>
        {!onVote ? <p id={`poll-${poll.id}-vote-help`}>{voteHelp}</p> : null}
      </section>
      <footer className="poll-actions">
        <button className="poll-action-button" type="button" disabled={!onLike} onClick={() => onLike?.(poll.id, poll.viewerHasLiked)} aria-label={`Like (${poll.likesCount})`} aria-pressed={poll.viewerHasLiked} aria-describedby={onLike ? undefined : `poll-${poll.id}-like-help`}>
          <MaterialIcon className="poll-action-icon" name={poll.viewerHasLiked ? 'favorite' : 'favorite_border'} /><span className="poll-action-label">Like</span> <span className="poll-action-count">{poll.likesCount}</span>
        </button>
        {!onLike ? <p id={`poll-${poll.id}-like-help`}>{likeHelp}</p> : null}
        <button className="poll-action-button" type="button" disabled={!onOpenComments} onClick={() => onOpenComments?.(poll)} aria-label={`Comments (${poll.commentsCount})`} aria-describedby={onOpenComments ? undefined : `poll-${poll.id}-comments-help`}>
          <MaterialIcon className="poll-action-icon" name="mode_comment_outlined" /><span className="poll-action-label">Comments</span> <span className="poll-action-count">{poll.commentsCount}</span>
        </button>
        {!onOpenComments ? <p id={`poll-${poll.id}-comments-help`}>Comments are not available yet.</p> : null}
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
