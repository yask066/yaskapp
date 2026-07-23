import type { Poll } from '../modules/polls/polls.repository.js';

type RealtimeSocket = {
  readyState?: number;
  send(data: string): void;
};

type PollVoteCreatedEvent = {
  type: 'poll.vote.created';
  payload: {
    poll: Poll;
    vote: {
      pollId: string;
      optionId: string;
      votesCount: number;
    };
  };
};

type ConnectionReadyEvent = {
  type: 'connection.ready';
};

type RealtimeEvent = ConnectionReadyEvent | PollVoteCreatedEvent;

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
  const event: PollVoteCreatedEvent = {
    type: 'poll.vote.created',
    payload
  };

  for (const client of clients) {
    try {
      send(client, event);
    } catch {
      clients.delete(client);
    }
  }
}
