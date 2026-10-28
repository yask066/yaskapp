import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionSettingsProvider } from './motion-settings';
import { EntryMotion } from './EntryMotion';
import { clearEntryMotionRegistry } from './entry-motion-registry';

function card(contextKey: string, itemId: string, visible = true) {
  return <MotionSettingsProvider flags={{ reactionsMotion: false, entryMotion: true }}>
    <EntryMotion contextKey={contextKey} itemId={itemId} visible={visible} indexInBatch={0}>
      <article aria-label={itemId}>Card {itemId}</article>
    </EntryMotion>
  </MotionSettingsProvider>;
}

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.unstubAllGlobals();
});

describe('EntryMotion', () => {
  it('animates a visible ID once across remounts and permits a new list context', () => {
    const first = render(card('feed:user-1', 'poll-1'));
    expect(screen.getByRole('article', { name: 'poll-1' })).toHaveAttribute('data-entry-motion', 'active');
    expect(screen.getByRole('article', { name: 'poll-1' })).toHaveClass('entry-motion--active');
    first.unmount();

    const remounted = render(card('feed:user-1', 'poll-1'));
    expect(screen.getByRole('article', { name: 'poll-1' })).toHaveAttribute('data-entry-motion', 'idle');
    remounted.unmount();

    render(card('search:user-1:q2:newest', 'poll-1'));
    expect(screen.getByRole('article', { name: 'poll-1' })).toHaveAttribute('data-entry-motion', 'active');
  });

  it('survives StrictMode effect cleanup before the visibility observer reports', () => {
    const observers: Array<{ callback: IntersectionObserverCallback; disconnected: boolean }> = [];
    class MockIntersectionObserver {
      disconnected = false;
      constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
      unobserve() {}
      takeRecords() { return []; }
    }
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver as unknown as typeof IntersectionObserver);
    render(<StrictMode>{card('feed:strict-mode', 'poll-strict')}</StrictMode>);

    const activeObserver = observers.find((observer) => !observer.disconnected);
    expect(activeObserver).toBeDefined();
    act(() => activeObserver?.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole('article', { name: 'poll-strict' })).toHaveAttribute('data-entry-motion', 'active');
  });

  it('consumes an initially offscreen ID so it does not animate when it becomes visible', () => {
    const { rerender } = render(card('feed:user-2', 'poll-offscreen', false));
    expect(screen.getByRole('article', { name: 'poll-offscreen' })).toHaveAttribute('data-entry-motion', 'idle');

    rerender(card('feed:user-2', 'poll-offscreen', true));
    expect(screen.getByRole('article', { name: 'poll-offscreen' })).toHaveAttribute('data-entry-motion', 'idle');
  });

  it('allows a fresh initial batch after the session registry is cleared', () => {
    const first = render(card('feed:session-reset', 'poll-1'));
    first.unmount();
    expect(screen.queryByRole('article', { name: 'poll-1' })).not.toBeInTheDocument();

    clearEntryMotionRegistry();
    render(card('feed:session-reset', 'poll-1'));
    expect(screen.getByRole('article', { name: 'poll-1' })).toHaveAttribute('data-entry-motion', 'active');
  });

  it('uses the 35 ms stagger for the first six items only', () => {
    const { container } = render(<MotionSettingsProvider flags={{ reactionsMotion: false, entryMotion: true }}>
      <EntryMotion contextKey="feed:stagger" itemId="poll-last" visible indexInBatch={99}>
        <article>Card</article>
      </EntryMotion>
    </MotionSettingsProvider>);

    expect(container.querySelector('article')).toHaveStyle('--entry-motion-delay: 0ms');
  });

  it('keeps entry static while the document is hidden', () => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    render(card('feed:hidden', 'poll-hidden'));

    expect(screen.getByRole('article', { name: 'poll-hidden' })).toHaveAttribute('data-entry-motion', 'idle');
  });

  it('cancels the active entry immediately when reduced motion turns on', () => {
    let matches = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      get matches() { return matches; },
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    render(card('feed:reduced-live', 'poll-live'));
    expect(screen.getByRole('article', { name: 'poll-live' })).toHaveAttribute('data-entry-motion', 'active');

    act(() => {
      matches = true;
      for (const listener of listeners) listener({ matches, media: mediaQuery.media } as MediaQueryListEvent);
    });
    expect(screen.getByRole('article', { name: 'poll-live' })).toHaveAttribute('data-entry-motion', 'idle');
  });
});
