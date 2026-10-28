import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionSettingsProvider } from './motion-settings';
import { useMotionSettings } from './use-motion-settings';
import { motionTokens } from './motion-tokens';

function MotionProbe() {
  const { reactionsMotion, entryMotion, reduceMotion } = useMotionSettings();
  return <output>{`${reactionsMotion ? 'reactions:on' : 'reactions:off'};${entryMotion ? 'entry:on' : 'entry:off'};${reduceMotion ? 'reduced:on' : 'reduced:off'}`}</output>;
}

afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  vi.unstubAllGlobals();
});

describe('motion settings', () => {
  it('keeps both motion flags off by default and accepts independent app flags', () => {
    const { rerender } = render(<MotionSettingsProvider><MotionProbe /></MotionSettingsProvider>);
    expect(screen.getByText('reactions:off;entry:off;reduced:off')).toBeInTheDocument();

    rerender(<MotionSettingsProvider flags={{ reactionsMotion: true, entryMotion: false }}><MotionProbe /></MotionSettingsProvider>);
    expect(screen.getByText('reactions:on;entry:off;reduced:off')).toBeInTheDocument();
  });

  it('updates immediately when the system reduced-motion preference changes', () => {
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
    render(<MotionSettingsProvider><MotionProbe /></MotionSettingsProvider>);
    expect(screen.getByText('reactions:off;entry:off;reduced:off')).toBeInTheDocument();

    act(() => {
      matches = true;
      for (const listener of listeners) listener({ matches, media: mediaQuery.media } as MediaQueryListEvent);
    });
    expect(screen.getByText('reactions:off;entry:off;reduced:on')).toBeInTheDocument();
  });

  it('treats a hidden document as reduced motion and removes listeners on unmount', () => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const removeMediaListener = vi.fn((_type: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener));
    const mediaQuery = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: (_type: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: removeMediaListener,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    } as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
    const removeVisibilityListener = vi.spyOn(document, 'removeEventListener');
    const { unmount } = render(<MotionSettingsProvider><MotionProbe /></MotionSettingsProvider>);

    act(() => {
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText('reactions:off;entry:off;reduced:on')).toBeInTheDocument();

    unmount();
    expect(removeMediaListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeVisibilityListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('exposes the PRD motion timings as reusable tokens', () => {
    expect(motionTokens).toMatchObject({
      countDurationMs: 180,
      barDurationMs: 240,
      reactionDurationMs: 160,
      entryDurationMs: 200,
      entryOffsetPx: 8,
      staggerMs: 35,
      maxStaggeredItems: 6,
      maxStaggerDurationMs: 400,
      skeletonCrossfadeMs: 120,
    });
  });
});
