import { render } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ScrollRestorationCoordinator } from './ScrollRestorationCoordinator';
import { listScrollState, type ListContext } from './list-scroll-state';

const sessionState = vi.hoisted(() => ({ current: null as null | { user: { id: string }; sessionEpoch: number } }));
vi.mock('../../app/session-provider', () => ({ useOptionalSession: () => sessionState.current }));

const context: ListContext = { userId: 'user-1', route: '/', list: 'feed', query: '', filter: '', sort: '' };

test('takes exclusive ownership from native browser history restoration', () => {
  Object.defineProperty(window.history, 'scrollRestoration', { configurable: true, writable: true, value: 'auto' });
  const view = render(<ScrollRestorationCoordinator />);

  expect(window.history.scrollRestoration).toBe('manual');

  view.unmount();
  expect(window.history.scrollRestoration).toBe('auto');
});

test('clears the previous user’s saved positions when the session changes', () => {
  listScrollState.clear();
  sessionState.current = { user: { id: 'user-1' }, sessionEpoch: 0 };
  listScrollState.capture(context, { id: 'poll-1', top: 60 });
  const view = render(<ScrollRestorationCoordinator />);

  sessionState.current = null;
  view.rerender(<ScrollRestorationCoordinator />);

  expect(listScrollState.read(context)).toBeNull();
  view.unmount();
  sessionState.current = null;
});
