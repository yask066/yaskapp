import { useEffect, useState } from 'react';
import type { NotificationType } from '@yaskapp/shared';
import { getNotificationPreferences, patchNotificationPreferences } from '../../api/notifications';
import type { NotificationPreferences } from '../../api/models';

const types: Array<{ type: NotificationType; label: string }> = [
  { type: 'poll_vote', label: 'Poll votes' },
  { type: 'comment', label: 'Comments' },
  { type: 'comment_reply', label: 'Comment replies' },
  { type: 'like', label: 'Likes' },
  { type: 'follow', label: 'New followers' },
];

export function NotificationPreferencesPage() {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<NotificationType | null>(null);

  useEffect(() => {
    let active = true;
    void getNotificationPreferences().then((next) => {
      if (active) setPreferences(next);
    }).catch(() => {
      if (active) setError('Unable to load notification settings.');
    });
    return () => { active = false; };
  }, []);

  async function toggle(type: NotificationType) {
    if (!preferences || pending) return;
    const inApp = !preferences[type].inApp;
    const previous = preferences;
    setPending(type);
    setError(null);
    setPreferences({ ...preferences, [type]: { ...preferences[type], inApp } });
    try {
      const next = await patchNotificationPreferences({ [type]: { inApp } });
      setPreferences(next);
    } catch {
      setPreferences(previous);
      setError('Unable to save that setting. Please try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <main id="main-content" className="notification-preferences-page">
      <header className="page-heading"><div><p className="eyebrow">Notifications</p><h1>Notification settings</h1></div></header>
      <p className="notification-preferences-intro">Choose which activity appears in your in-app inbox.</p>
      {error ? <p className="inline-alert" role="alert">{error}</p> : null}
      {!preferences && !error ? <p role="status">Loading notification settings…</p> : null}
      {preferences ? <div className="notification-preferences-list">
        {types.map(({ type, label }) => <label className="notification-preference" key={type}>
          <span>{label}</span>
          <input type="checkbox" role="switch" aria-label={label} checked={preferences[type].inApp} disabled={pending !== null} onChange={() => void toggle(type)} />
        </label>)}
      </div> : null}
    </main>
  );
}
