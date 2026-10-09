import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionSettingsProvider } from '../core/motion/motion-settings';
import { AnimatedCount } from './AnimatedCount';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AnimatedCount', () => {
  it('shows the final target on first mount without an entry transition', () => {
    const { container } = render(<AnimatedCount value={9} enabled />);

    expect(container.querySelector('.animated-count__current')).toHaveTextContent('9');
    expect(container.querySelectorAll('.animated-count__previous')).toHaveLength(0);
  });

  it.each([
    [9, 10],
    [99, 100],
    [999, 1000],
    [1000, 999],
  ])('crossfades %i to %i while exposing the target immediately', (from, to) => {
    const { container, rerender } = render(<AnimatedCount value={from} enabled />);

    rerender(<AnimatedCount value={to} enabled />);

    expect(container.querySelector('.animated-count__current')).toHaveTextContent(String(to));
    expect(container.querySelector('.animated-count__previous')).toHaveTextContent(String(from));
    expect(container.querySelector('.animated-count__previous')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.animated-count')).toHaveStyle('--animated-count-duration: 180ms');
  });

  it('interrupts an in-flight target without queuing older values', () => {
    const { container, rerender } = render(<AnimatedCount value={9} enabled />);
    rerender(<AnimatedCount value={10} enabled />);
    rerender(<AnimatedCount value={99} enabled />);

    expect(container.querySelector('.animated-count__current')).toHaveTextContent('99');
    expect(container.querySelector('.animated-count__previous')).toHaveTextContent('10');
    expect(container.querySelectorAll('.animated-count__previous')).toHaveLength(1);
  });

  it('clears decorative old text immediately when reduced motion changes mid-transition', () => {
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
    const { container, rerender } = render(
      <MotionSettingsProvider flags={{ reactionsMotion: true, entryMotion: false }}>
        <AnimatedCount value={9} enabled />
      </MotionSettingsProvider>,
    );
    rerender(
      <MotionSettingsProvider flags={{ reactionsMotion: true, entryMotion: false }}>
        <AnimatedCount value={10} enabled />
      </MotionSettingsProvider>,
    );
    expect(container.querySelector('.animated-count__previous')).toHaveTextContent('9');

    act(() => {
      matches = true;
      for (const listener of listeners) listener({ matches, media: mediaQuery.media } as MediaQueryListEvent);
    });

    expect(container.querySelector('.animated-count__current')).toHaveTextContent('10');
    expect(container.querySelector('.animated-count__previous')).not.toBeInTheDocument();
  });

  it('removes the outgoing value after the transition duration', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<AnimatedCount value={9} enabled />);
    rerender(<AnimatedCount value={10} enabled />);

    act(() => vi.advanceTimersByTime(179));
    expect(container.querySelector('.animated-count__previous')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(container.querySelector('.animated-count__previous')).not.toBeInTheDocument();
    expect(container.querySelector('.animated-count__current')).toHaveTextContent('10');
  });
});
