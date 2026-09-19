// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { getNotificationPreferences, getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead, patchNotificationPreferences } from './notifications';
import { decodeNotificationItem, decodeNotificationListResponse, decodeRealtimeNotificationEvent } from './models';

const actor = { id: 'user-1', username: 'member', displayName: 'Member', avatarUrl: null };
const item = {
  id: 'notification-1',
  type: 'comment',
  actor,
  targetType: 'comment',
  pollId: 'poll-1',
  commentId: 'comment-1',
  payload: { displayName: 'Member' },
  readAt: null,
  createdAt: '2026-09-19T12:00:00.000Z',
  isTargetAvailable: true,
};
const server = setupServer();

beforeAll(() => { vi.stubEnv('VITE_API_BASE_URL', 'http://localhost'); server.listen({ onUnhandledRequest: 'error' }); });
afterEach(() => server.resetHandlers());
afterAll(() => { server.close(); vi.unstubAllEnvs(); });

describe('notification decoders', () => {
  test('decodes all required notification fields and nullable actor', () => {
    expect(decodeNotificationItem({ ...item, actor: null })).toEqual({ ...item, actor: null });
  });

  test('decodes a list response and preserves the cursor and unread count', () => {
    expect(decodeNotificationListResponse({ items: [item], nextCursor: 'cursor-2', unreadCount: 1 })).toEqual({
      items: [item], nextCursor: 'cursor-2', unreadCount: 1,
    });
  });

  test('rejects unknown notification types and realtime versions', () => {
    expect(() => decodeNotificationItem({ ...item, type: 'unknown' })).toThrow();
    expect(() => decodeRealtimeNotificationEvent({ version: 2, type: 'notification.created', payload: {} })).toThrow();
  });

  test('rejects malformed timestamps instead of passing invalid dates downstream', () => {
    expect(() => decodeNotificationItem({ ...item, createdAt: 'not-a-timestamp' })).toThrow();
    expect(() => decodeNotificationItem({ ...item, readAt: '2026-99-99T00:00:00.000Z' })).toThrow();
  });

  test('calls notification endpoints with query parameters, credentials, and JSON mutation bodies', async () => {
    server.use(
      http.get('http://localhost/notifications', ({ request }) => {
        expect(request.credentials).toBe('include');
        expect(new URL(request.url).search).toBe('?limit=10&unreadOnly=true&cursor=next');
        return HttpResponse.json({ items: [item], nextCursor: null, unreadCount: 1 });
      }),
      http.get('http://localhost/notifications/unread-count', () => HttpResponse.json({ unreadCount: 1 })),
      http.post('http://localhost/notifications/notification-1/read', () => HttpResponse.json({ notificationId: 'notification-1', readAt: item.createdAt, unreadCount: 0 })),
      http.post('http://localhost/notifications/read-all', () => HttpResponse.json({ readAt: item.createdAt, updatedCount: 1, unreadCount: 0 })),
      http.get('http://localhost/notification-preferences', () => HttpResponse.json({
        poll_vote: { inApp: true, push: false }, comment: { inApp: true, push: false }, comment_reply: { inApp: true, push: false }, like: { inApp: true, push: false }, follow: { inApp: true, push: false },
      })),
      http.patch('http://localhost/notification-preferences', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('application/json');
        await expect(request.json()).resolves.toEqual({ like: { inApp: false } });
        return HttpResponse.json({
          poll_vote: { inApp: true, push: false }, comment: { inApp: true, push: false }, comment_reply: { inApp: true, push: false }, like: { inApp: false, push: false }, follow: { inApp: true, push: false },
        });
      }),
    );

    await expect(listNotifications({ limit: 10, cursor: 'next', unreadOnly: true })).resolves.toMatchObject({ unreadCount: 1 });
    await expect(getUnreadCount()).resolves.toEqual({ unreadCount: 1 });
    await expect(markNotificationRead('notification-1')).resolves.toMatchObject({ unreadCount: 0 });
    await expect(markAllNotificationsRead()).resolves.toMatchObject({ updatedCount: 1, unreadCount: 0 });
    await expect(getNotificationPreferences()).resolves.toHaveProperty('follow.inApp', true);
    await expect(patchNotificationPreferences({ like: { inApp: false } })).resolves.toHaveProperty('like.inApp', false);
  });
});
