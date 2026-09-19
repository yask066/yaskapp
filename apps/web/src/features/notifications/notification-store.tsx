import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { NotificationItem, NotificationRealtimeEventV1 } from '@yaskapp/shared';
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '../../api/notifications';
import { useSession } from '../../app/session-provider';
import { NotificationRealtimeClient, type RealtimeConnectionStatus, createRealtimeUrl } from './realtime-client';

export interface NotificationStoreState {
  itemsById: Record<string, NotificationItem>;
  ids: string[];
  pendingIds: string[];
  unreadCount: number;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export const initialNotificationState: NotificationStoreState = {
  itemsById: {}, ids: [], pendingIds: [], unreadCount: 0, nextCursor: null,
  loading: false, error: null, hasLoaded: false,
};

type NotificationAction =
  | { type: 'reset' }
  | { type: 'merge'; items: NotificationItem[]; unreadCount: number; nextCursor: string | null }
  | { type: 'unreadCount'; unreadCount: number }
  | { type: 'reconcile'; items: NotificationItem[]; unreadCount: number; nextCursor: string | null }
  | { type: 'createdEvent'; item: NotificationItem; unreadCount: number; atTop: boolean }
  | { type: 'readEvent'; notificationId: string; readAt: string; unreadCount: number }
  | { type: 'readAllEvent'; readAt: string }
  | { type: 'optimisticRead'; notificationId: string; readAt: string }
  | { type: 'optimisticReadAll'; readAt: string }
  | { type: 'clearPending' }
  | { type: 'rollback'; snapshot: NotificationStoreState }
  | { type: 'loading'; value: boolean }
  | { type: 'error'; message: string | null };

function timestamp(value: string | null): number {
  return value ? Date.parse(value) : Number.NEGATIVE_INFINITY;
}

function sortIds(itemsById: Record<string, NotificationItem>): string[] {
  return Object.values(itemsById)
    .sort((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt) || right.id.localeCompare(left.id))
    .map((item) => item.id);
}

function mergeItem(existing: NotificationItem | undefined, incoming: NotificationItem, authoritative: boolean): NotificationItem {
  if (!existing) return incoming;
  if (authoritative) return incoming;
  const existingReadAt = timestamp(existing.readAt);
  const incomingReadAt = timestamp(incoming.readAt);
  return {
    ...existing,
    ...incoming,
    readAt: incomingReadAt >= existingReadAt ? incoming.readAt : existing.readAt,
  };
}

function mergeItems(state: NotificationStoreState, items: NotificationItem[], authoritative: boolean): NotificationStoreState {
  const itemsById = { ...state.itemsById };
  for (const item of items) itemsById[item.id] = mergeItem(itemsById[item.id], item, authoritative);
  const itemIds = new Set(items.map((item) => item.id));
  return {
    ...state,
    itemsById,
    ids: sortIds(itemsById),
    pendingIds: state.pendingIds.filter((id) => !itemIds.has(id)),
    hasLoaded: true,
  };
}

// eslint-disable-next-line react-refresh/only-export-components
export function notificationReducer(state: NotificationStoreState, action: NotificationAction): NotificationStoreState {
  switch (action.type) {
    case 'reset': return initialNotificationState;
    case 'loading': return { ...state, loading: action.value, error: action.value ? null : state.error };
    case 'error': return { ...state, loading: false, error: action.message };
    case 'unreadCount': return { ...state, unreadCount: action.unreadCount, loading: false, error: null };
    case 'rollback': return action.snapshot;
    case 'clearPending': return { ...state, pendingIds: [] };
    case 'merge': return { ...mergeItems(state, action.items, false), unreadCount: action.unreadCount, nextCursor: action.nextCursor, loading: false, error: null };
    case 'reconcile': return { ...mergeItems(state, action.items, true), unreadCount: action.unreadCount, nextCursor: action.nextCursor, loading: false, error: null };
    case 'createdEvent': {
      const existed = Boolean(state.itemsById[action.item.id]);
      const merged = mergeItems(state, [action.item], false);
      const pendingIds = action.atTop
        ? merged.pendingIds.filter((id) => id !== action.item.id)
        : [...new Set([...state.pendingIds, action.item.id])];
      return { ...merged, pendingIds, unreadCount: existed ? Math.max(state.unreadCount, action.unreadCount) : action.unreadCount };
    }
    case 'readEvent': {
      const current = state.itemsById[action.notificationId];
      if (current && timestamp(action.readAt) < timestamp(current.readAt)) return state;
      if (!current) return { ...state, unreadCount: Math.min(state.unreadCount, action.unreadCount) };
      return {
        ...state,
        itemsById: { ...state.itemsById, [current.id]: { ...current, readAt: action.readAt } },
        unreadCount: action.unreadCount,
      };
    }
    case 'readAllEvent': {
      const itemsById = Object.fromEntries(Object.entries(state.itemsById).map(([id, item]) => [
        id, timestamp(action.readAt) >= timestamp(item.readAt) ? { ...item, readAt: action.readAt } : item,
      ]));
      return { ...state, itemsById, unreadCount: 0 };
    }
    case 'optimisticRead': {
      const item = state.itemsById[action.notificationId];
      if (!item || item.readAt) return state;
      return { ...state, itemsById: { ...state.itemsById, [item.id]: { ...item, readAt: action.readAt } }, unreadCount: Math.max(0, state.unreadCount - 1) };
    }
    case 'optimisticReadAll': {
      const itemsById = Object.fromEntries(Object.entries(state.itemsById).map(([id, item]) => [id, item.readAt ? item : { ...item, readAt: action.readAt }]));
      return { ...state, itemsById, unreadCount: 0 };
    }
  }
}

export interface NotificationStoreActions {
  reconcile(): Promise<void>;
  loadMore(): Promise<void>;
  markRead(notificationId: string): Promise<void>;
  markAllRead(): Promise<void>;
  applyRealtime(event: NotificationRealtimeEventV1, atTop?: boolean): void;
  clearPending(): void;
}

export interface NotificationStoreContextValue extends NotificationStoreState {
  actions: NotificationStoreActions;
  realtimeStatus: RealtimeConnectionStatus;
}

const NotificationContext = createContext<NotificationStoreContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const userId = session.user?.id;
  const [state, dispatch] = useReducer(notificationReducer, initialNotificationState);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeConnectionStatus>('idle');
  const epoch = useRef(0);
  const stateRef = useRef(state);
  const reconcileFlight = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  stateRef.current = state;

  useEffect(() => {
    const currentEpoch = ++epoch.current;
    const controller = new AbortController();
    dispatch({ type: 'reset' });
    if (session.status !== 'authenticated' || !userId) return () => controller.abort();
    dispatch({ type: 'loading', value: true });
    void getUnreadCount(controller.signal).then(({ unreadCount }) => {
      if (epoch.current === currentEpoch) dispatch({ type: 'unreadCount', unreadCount });
    }).catch(() => {
      if (epoch.current === currentEpoch && !controller.signal.aborted) dispatch({ type: 'error', message: 'Unable to load notifications.' });
    });
    return () => controller.abort();
  }, [session.sessionEpoch, session.status, userId]);

  const reconcile = useCallback(async () => {
    const currentEpoch = epoch.current;
    if (reconcileFlight.current?.epoch === currentEpoch) return reconcileFlight.current.promise;
    dispatch({ type: 'loading', value: true });
    const request = Promise.resolve().then(async () => {
      try {
        const response = await listNotifications({ limit: 25, unreadOnly: false });
        if (epoch.current === currentEpoch) dispatch({ type: 'reconcile', ...response });
      } catch {
        if (epoch.current === currentEpoch) dispatch({ type: 'error', message: 'Unable to refresh notifications.' });
      } finally {
        if (reconcileFlight.current?.promise === request) reconcileFlight.current = null;
      }
    });
    reconcileFlight.current = { epoch: currentEpoch, promise: request };
    return request;
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = stateRef.current.nextCursor;
    if (!cursor || stateRef.current.loading) return;
    const currentEpoch = epoch.current;
    dispatch({ type: 'loading', value: true });
    try {
      const response = await listNotifications({ limit: 25, cursor, unreadOnly: false });
      if (epoch.current === currentEpoch) dispatch({ type: 'merge', ...response });
    } catch {
      if (epoch.current === currentEpoch) dispatch({ type: 'error', message: 'Unable to load more notifications.' });
    }
  }, []);

  const markRead = useCallback(async (notificationId: string) => {
    const snapshot = stateRef.current;
    dispatch({ type: 'optimisticRead', notificationId, readAt: new Date().toISOString() });
    try {
      const response = await markNotificationRead(notificationId);
      dispatch({ type: 'readEvent', ...response });
    } catch {
      dispatch({ type: 'rollback', snapshot });
      await reconcile();
    }
  }, [reconcile]);

  const markAllRead = useCallback(async () => {
    const snapshot = stateRef.current;
    dispatch({ type: 'optimisticReadAll', readAt: new Date().toISOString() });
    try {
      const response = await markAllNotificationsRead();
      dispatch({ type: 'readAllEvent', readAt: response.readAt });
    } catch {
      dispatch({ type: 'rollback', snapshot });
      await reconcile();
    }
  }, [reconcile]);

  const applyRealtime = useCallback((event: NotificationRealtimeEventV1, atTop = true) => {
    if (event.type === 'notification.created') dispatch({ type: 'createdEvent', item: event.payload.notification, unreadCount: event.payload.unreadCount, atTop });
    if (event.type === 'notification.read') dispatch({ type: 'readEvent', ...event.payload });
    if (event.type === 'notifications.read_all') dispatch({ type: 'readAllEvent', readAt: event.payload.readAt });
  }, []);

  const clearPending = useCallback(() => {
    dispatch({ type: 'clearPending' });
  }, []);

  useEffect(() => {
    if (session.status !== 'authenticated' || !userId) {
      setRealtimeStatus('idle');
      return undefined;
    }
    const client = new NotificationRealtimeClient({
      url: createRealtimeUrl(),
      onEvent: (event) => applyRealtime(event),
      onConnectionReady: reconcile,
      reconcile,
      onStatusChange: setRealtimeStatus,
    });
    client.start();
    return () => client.stop();
  }, [applyRealtime, reconcile, session.sessionEpoch, session.status, userId]);

  const actions = useMemo<NotificationStoreActions>(() => ({ reconcile, loadMore, markRead, markAllRead, applyRealtime, clearPending }), [applyRealtime, clearPending, loadMore, markAllRead, markRead, reconcile]);
  return <NotificationContext.Provider value={{ ...state, actions, realtimeStatus }}>{children}</NotificationContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationStoreContextValue {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('useNotifications must be used within a NotificationProvider.');
  return value;
}

// The shell is also rendered by isolated feature tests without the app provider.
// It still needs a stable zero badge in that environment.
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalNotificationUnreadCount(): number {
  return useContext(NotificationContext)?.unreadCount ?? 0;
}
