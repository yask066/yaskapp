import type { NotificationRealtimeEventV1 } from '@yaskapp/shared';
import { decodeNotificationRealtimeEvent } from '../../api/models';

export type RealtimeConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface RealtimeWebSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(value: string): void;
  close(): void;
}

export interface NotificationRealtimeClientOptions {
  url: string;
  createWebSocket?: (url: string) => RealtimeWebSocket;
  onEvent?: (event: NotificationRealtimeEventV1) => void;
  onConnectionReady?: () => void | Promise<void>;
  onStatusChange?: (status: RealtimeConnectionStatus) => void;
  onUnknownMessage?: () => void;
  reconcile?: () => Promise<void>;
  documentRef?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  reconnectJitter?: number;
  random?: () => number;
}

export function createRealtimeUrl(apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''): string {
  const base = apiBaseUrl || (typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  const url = new URL('/realtime', base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class NotificationRealtimeClient {
  private readonly options: Required<Pick<NotificationRealtimeClientOptions,
    'heartbeatIntervalMs' | 'heartbeatTimeoutMs' | 'reconnectBaseMs' | 'reconnectMaxMs' | 'reconnectJitter' | 'random'>>;
  private socket: RealtimeWebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private started = false;
  private status: RealtimeConnectionStatus = 'idle';

  constructor(private readonly config: NotificationRealtimeClientOptions) {
    this.options = {
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 20_000,
      heartbeatTimeoutMs: config.heartbeatTimeoutMs ?? 10_000,
      reconnectBaseMs: config.reconnectBaseMs ?? 500,
      reconnectMaxMs: config.reconnectMaxMs ?? 30_000,
      reconnectJitter: config.reconnectJitter ?? 0.2,
      random: config.random ?? Math.random,
    };
  }

  get connectionStatus(): RealtimeConnectionStatus { return this.status; }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reconnectAttempt = 0;
    this.config.documentRef?.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.connect(false);
  }

  stop(): void {
    if (!this.started && !this.socket && !this.reconnectTimer) return;
    this.started = false;
    this.config.documentRef?.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.clearReconnectTimer();
    this.clearHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    this.setStatus('idle');
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.started && this.config.documentRef?.visibilityState === 'visible') void this.config.reconcile?.();
  };

  private connect(isReconnect: boolean): void {
    if (!this.started) return;
    this.setStatus(isReconnect ? 'reconnecting' : 'connecting');
    const create = this.config.createWebSocket ?? ((url: string) => new WebSocket(url) as unknown as RealtimeWebSocket);
    const socket = create(this.config.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket || !this.started) return;
      this.reconnectAttempt = 0;
      this.setStatus('open');
      this.startHeartbeat(socket);
    };
    socket.onmessage = (message: { data: string }) => this.handleMessage(socket, message.data);
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearHeartbeat();
      this.scheduleReconnect();
    };
  }

  private handleMessage(socket: RealtimeWebSocket, raw: string): void {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { this.unknown(); return; }
    if (typeof value !== 'object' || value === null) { this.unknown(); return; }
    const source = value as { version?: unknown; type?: unknown };
    if (source.version !== 1) { this.unknown(); return; }
    if (source.type === 'connection.ready') {
      void this.config.onConnectionReady?.();
      return;
    }
    if (source.type === 'pong') {
      this.clearHeartbeatTimeout();
      return;
    }
    try {
      const event = decodeNotificationRealtimeEvent(value);
      if (socket === this.socket) this.config.onEvent?.(event);
    } catch {
      this.unknown();
    }
  }

  private startHeartbeat(socket: RealtimeWebSocket): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket !== socket || !this.started || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ type: 'ping' }));
      this.clearHeartbeatTimeout();
      this.heartbeatTimeoutTimer = setTimeout(() => {
        if (this.socket === socket) socket.close();
      }, this.options.heartbeatTimeoutMs);
    }, this.options.heartbeatIntervalMs);
  }

  private scheduleReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    const exponential = Math.min(this.options.reconnectMaxMs, this.options.reconnectBaseMs * 2 ** this.reconnectAttempt);
    const jitter = 1 + (this.options.random() * 2 - 1) * this.options.reconnectJitter;
    const delay = Math.max(0, Math.round(exponential * jitter));
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(true);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.clearHeartbeatTimeout();
  }

  private clearHeartbeatTimeout(): void {
    if (this.heartbeatTimeoutTimer) clearTimeout(this.heartbeatTimeoutTimer);
    this.heartbeatTimeoutTimer = null;
  }

  private unknown(): void { this.config.onUnknownMessage?.(); }

  private setStatus(status: RealtimeConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.config.onStatusChange?.(status);
  }
}
