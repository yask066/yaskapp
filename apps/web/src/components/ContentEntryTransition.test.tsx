import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MotionSettingsProvider } from '../core/motion/motion-settings';
import { ContentEntryTransition } from './ContentEntryTransition';

function content(loading: boolean) {
  return <MotionSettingsProvider flags={{ reactionsMotion: false, entryMotion: true }}>
    <ContentEntryTransition loading={loading} kind="poll" rows={1}><article>Poll</article></ContentEntryTransition>
  </MotionSettingsProvider>;
}

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

it('crossfades a visible skeleton out over 120 ms when content arrives', () => {
  vi.useFakeTimers();
  const { rerender, container } = render(content(true));
  act(() => { vi.advanceTimersByTime(150); });
  expect(container.querySelector('.async-state--skeleton-visible .content-skeleton')).toBeInTheDocument();

  rerender(content(false));
  expect(container.querySelector('.content-entry-transition__skeleton--exit')).toHaveStyle('animation-duration: 120ms');
  act(() => { vi.advanceTimersByTime(120); });
  expect(container.querySelector('.content-entry-transition__skeleton--exit')).not.toBeInTheDocument();
});

it('cancels the skeleton crossfade when the document becomes hidden', () => {
  vi.useFakeTimers();
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const { rerender, container } = render(content(true));
  act(() => { vi.advanceTimersByTime(150); });
  rerender(content(false));
  expect(container.querySelector('.content-entry-transition__skeleton--exit')).toBeInTheDocument();

  act(() => {
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(container.querySelector('.content-entry-transition__skeleton--exit')).not.toBeInTheDocument();
});
