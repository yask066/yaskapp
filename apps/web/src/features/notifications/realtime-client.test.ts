import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRealtimeEventV1 } from '@yaskapp/shared';
import { NotificationRealtimeClient, type RealtimeWebSocket } from './realtime-client';

class FakeWebSocket implements RealtimeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  closeUnexpectedly() { this.readyState = 3; this.onclose?.(); }
}

const createdEvent: NotificationRealtimeEventV1 = {
  version: 1,
  type: 'notification.created',
  payload: {
    notification: {
      id: 'notification-1', type: 'follow', actor: null, targetType: 'profile', pollId: null,
      commentId: null, payload: {}, readAt: null, createdAt: '2026-09-19T12:00:00.000Z', isTargetAvailable: true,
    },
    unreadCount: 1,
  },
};

afterEach(() => {
  vi.useRealTimers();
  FakeWebSocket.instances = [];
});

describe('NotificationRealtimeClient', () => {
  it('uses one cookie-authenticated socket per session and forwards notification events after ready', () => {
    const events: NotificationRealtimeEventV1[] = [];
    const reconcile = vi.fn(() => Promise.resolve());
    const documentRef = {
      visibilityState: 'hidden' as Document['visibilityState'],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const client = new NotificationRealtimeClient({
      url: 'wss://example.test/realtime',
      createWebSocket: (url) => new FakeWebSocket(url),
      onEvent: (event) => events.push(event),
      onConnectionReady: reconcile,
      reconcile,
      documentRef,
    });

    client.start();
    client.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://example.test/realtime');
    expect(FakeWebSocket.instances[0].url).not.toContain('token');

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].message({ version: 1, type: 'connection.ready' });
    FakeWebSocket.instances[0].message(createdEvent);
    documentRef.visibilityState = 'visible';
    const visibilityHandler = documentRef.addEventListener.mock.calls[0]?.[1] as (() => void);
    visibilityHandler();
    expect(events).toEqual([createdEvent]);
    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('closes a socket after a heartbeat timeout and schedules only one reconnect', () => {
    vi.useFakeTimers();
    const client = new NotificationRealtimeClient({
      url: '/realtime',
      createWebSocket: (url) => new FakeWebSocket(url),
      heartbeatIntervalMs: 100,
      heartbeatTimeoutMs: 50,
      reconnectBaseMs: 100,
      reconnectJitter: 0,
    });

    client.start();
    const first = FakeWebSocket.instances[0];
    first.open();
    vi.advanceTimersByTime(100);
    expect(JSON.parse(first.sent.at(-1) ?? '{}')).toEqual({ type: 'ping' });
    vi.advanceTimersByTime(50);
    expect(first.readyState).toBe(3);
    first.closeUnexpectedly();
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('uses exponential backoff with jitter and stops reconnecting on logout', () => {
    vi.useFakeTimers();
    const client = new NotificationRealtimeClient({
      url: '/realtime',
      createWebSocket: (url) => new FakeWebSocket(url),
      reconnectBaseMs: 100,
      reconnectMaxMs: 1000,
      reconnectJitter: 0.5,
      random: () => 1,
    });

    client.start();
    FakeWebSocket.instances[0].closeUnexpectedly();
    vi.advanceTimersByTime(149);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].closeUnexpectedly();
    client.stop();
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('ignores malformed, unknown and unsupported-version messages while keeping the socket open', () => {
    const events: NotificationRealtimeEventV1[] = [];
    const onUnknownMessage = vi.fn();
    const client = new NotificationRealtimeClient({
      url: '/realtime',
      createWebSocket: (url) => new FakeWebSocket(url),
      onEvent: (event) => events.push(event),
      onUnknownMessage,
    });

    client.start();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.onmessage?.({ data: '{bad json' });
    socket.message({ version: 2, type: 'notification.created', payload: {} });
    socket.message({ version: 1, type: 'future.event', payload: {} });
    expect(events).toEqual([]);
    expect(onUnknownMessage).toHaveBeenCalledTimes(3);
    expect(socket.readyState).toBe(1);
  });
});
