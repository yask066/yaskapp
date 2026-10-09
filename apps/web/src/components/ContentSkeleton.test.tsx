import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { AsyncState } from './AsyncState';
import { ContentSkeleton } from './ContentSkeleton';

afterEach(() => vi.useRealTimers());

test.each(['poll', 'user', 'comment', 'notification'] as const)(
  'renders %s rows as static decorative skeletons',
  (kind) => {
    const { container } = render(<ContentSkeleton kind={kind} rows={2} />);
    const skeleton = container.querySelector('.content-skeleton');

    expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    expect(skeleton?.querySelectorAll('[data-skeleton-row]')).toHaveLength(2);
    expect(container.querySelector('[role="status"]')).not.toBeInTheDocument();
    expect(container.querySelector('[aria-live]')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="motion"], [class*="shimmer"]')).not.toBeInTheDocument();
  },
);

test('reserves the loading region immediately and reveals its skeleton at 150 ms', async () => {
  vi.useFakeTimers();
  render(<AsyncState state="loading" kind="poll" rows={2} />);

  const status = screen.getByRole('status');
  const skeleton = status.querySelector('.content-skeleton');
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(status).toHaveAttribute('aria-busy', 'true');
  expect(skeleton).toBeInTheDocument();
  expect(status).not.toHaveClass('async-state--skeleton-visible');

  await act(async () => { await vi.advanceTimersByTimeAsync(149); });
  expect(status).not.toHaveClass('async-state--skeleton-visible');

  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(status).toHaveClass('async-state--skeleton-visible');
});

test('does not show a skeleton when loading resolves before the delay', async () => {
  vi.useFakeTimers();
  const view = render(<AsyncState state="loading" kind="comment" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(149); });

  view.rerender(<AsyncState state="empty" emptyMessage="No comments yet." />);

  expect(screen.queryByTestId('loading-skeleton')).not.toBeInTheDocument();
  expect(screen.getByText('No comments yet.')).toBeInTheDocument();
});

test('moves keyboard focus from Retry to the persistent page landmark when a retry starts', async () => {
  const user = userEvent.setup();
  function RetryHarness() {
    const [state, setState] = useState<'error' | 'loading'>('error');
    return <main><AsyncState state={state} error={new Error('Timed out.')} onRetry={() => setState('loading')} /></main>;
  }
  render(<RetryHarness />);

  await user.tab();
  expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
  await user.keyboard('{Enter}');

  expect(screen.getByRole('main')).toHaveFocus();
});
