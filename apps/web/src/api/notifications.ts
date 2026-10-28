import { apiClient } from './client';
import {
  decodeNotificationListResponse,
  decodeNotificationPreferences,
  decodeNotificationRead,
  decodeNotificationsReadAll,
  decodeUnreadCount,
  type NotificationListResponse,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from './models';

export function listNotifications(input: { limit?: number; cursor?: string; unreadOnly?: boolean; signal?: AbortSignal } = {}): Promise<NotificationListResponse> {
  const params = new URLSearchParams({ limit: String(input.limit ?? 25), unreadOnly: String(input.unreadOnly ?? false) });
  if (input.cursor) params.set('cursor', input.cursor);
  return apiClient.send(`/notifications?${params}`, { method: 'GET', signal: input.signal }, decodeNotificationListResponse);
}

export function getUnreadCount(signal?: AbortSignal): Promise<{ unreadCount: number }> {
  return apiClient.send('/notifications/unread-count', { method: 'GET', signal }, decodeUnreadCount);
}

export function markNotificationRead(notificationId: string): Promise<{ notificationId: string; readAt: string; unreadCount: number }> {
  return apiClient.send(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST' }, decodeNotificationRead);
}

export function markAllNotificationsRead(): Promise<{ readAt: string; updatedCount: number; unreadCount: 0 }> {
  return apiClient.send('/notifications/read-all', { method: 'POST' }, decodeNotificationsReadAll);
}

export function getNotificationPreferences(): Promise<NotificationPreferences> {
  return apiClient.get('/notification-preferences', decodeNotificationPreferences);
}

export function patchNotificationPreferences(input: NotificationPreferencesPatch): Promise<NotificationPreferences> {
  return apiClient.send('/notification-preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }, decodeNotificationPreferences);
}
