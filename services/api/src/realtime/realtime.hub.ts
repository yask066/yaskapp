import type { Poll } from '../modules/polls/polls.repository.js';

type RealtimeSocket = {
  readyState?: number;
  send(data: string): void;
};

type PollVoteCreatedEvent = {
  type: 'poll.vote.created';
  payload: {
    poll: Omit<Poll, 'viewerVoteOptionId'>;
    vote: {
      pollId: string;
      optionId: string;
      votesCount: number;
    };
  };
};

type PollVoteUpdatedEvent = {
  type: 'poll.vote.updated';
  payload: {
    poll: Omit<Poll, 'viewerVoteOptionId'>;
  };
};

type ConnectionReadyEvent = {
  type: 'connection.ready';
};

type PollDeletedEvent = {
  type: 'poll.deleted';
  payload: {
    pollId: string;
  };
};

type CommentDeletedEvent = {
  type: 'comment.deleted';
  payload: {
    commentId: string;
    pollId: string;
  };
};

type RealtimeEvent =
  | ConnectionReadyEvent
  | PollVoteCreatedEvent
  | PollVoteUpdatedEvent
  | PollDeletedEvent
  | CommentDeletedEvent;

const openReadyState = 1;
const clients = new Set<RealtimeSocket>();

function send(socket: RealtimeSocket, event: RealtimeEvent) {
  if (socket.readyState !== undefined && socket.readyState !== openReadyState) {
    return;
  }

  socket.send(JSON.stringify(event));
}

export function addRealtimeClient(socket: RealtimeSocket) {
  clients.add(socket);

  send(socket, {
    type: 'connection.ready'
  });

  return () => {
    clients.delete(socket);
  };
}

export function broadcastPollVoteCreated(payload: PollVoteCreatedEvent['payload']) {
  broadcast({
    type: 'poll.vote.created',
    payload: {
      ...payload,
      poll: sanitizePoll(payload.poll)
    }
  });
}

export function broadcastPollVoteUpdated(payload: PollVoteUpdatedEvent['payload']) {
  broadcast({
    type: 'poll.vote.updated',
    payload: {
      poll: sanitizePoll(payload.poll)
    }
  });
}

export function broadcastPollDeleted(payload: PollDeletedEvent['payload']) {
  broadcast({
    type: 'poll.deleted',
    payload
  });
}

export function broadcastCommentDeleted(payload: CommentDeletedEvent['payload']) {
  broadcast({
    type: 'comment.deleted',
    payload
  });
}

function sanitizePoll(
  poll: Poll | Omit<Poll, 'viewerVoteOptionId'>
): Omit<Poll, 'viewerVoteOptionId'> {
  const { viewerVoteOptionId: _viewerVoteOptionId, ...safePoll } = poll as Poll;

  return safePoll;
}

function broadcast(event: RealtimeEvent) {
  for (const client of clients) {
    try {
      send(client, event);
    } catch {
      clients.delete(client);
    }
  }
}
