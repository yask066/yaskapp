import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

type ChangeListener = (event: MediaQueryListEvent) => void;

function mockColorSchemeMedia(initialMatchesDark: boolean, reducedMotion = false) {
  let matches = initialMatchesDark;
  const listeners = new Set<ChangeListener>();

  const colorSchemeQueryList = {
    media: '(prefers-color-scheme: dark)',
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      listeners.delete(listener);
    },
    addListener: (listener: ChangeListener) => {
      listeners.add(listener);
    },
    removeListener: (listener: ChangeListener) => {
      listeners.delete(listener);
    },
    dispatchEvent: (): boolean => true,
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      if (query === '(prefers-reduced-motion: reduce)') {
        return {
          media: query,
          matches: reducedMotion,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: (): boolean => true,
        };
      }
      return colorSchemeQueryList;
    }),
  );

  return {
    setDark(next: boolean) {
      matches = next;
      const event = { matches: next, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.head.querySelectorAll('meta[name="color-scheme"]').forEach((node) => node.remove());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (document as Partial<Document>).startViewTransition;
  window.localStorage.clear();
  document.head.querySelectorAll('meta[name="color-scheme"]').forEach((node) => node.remove());
});

test('defaults to System and switches cleanly between Light, Dark, and System', async () => {
  mockColorSchemeMedia(false);
  const user = userEvent.setup();

  render(<ThemeToggle />);

  const lightButton = screen.getByRole('button', { name: 'Light' });
  const darkButton = screen.getByRole('button', { name: 'Dark' });
  const systemButton = screen.getByRole('button', { name: /System \(currently light\)/i });

  expect(systemButton).toHaveAttribute('aria-pressed', 'true');
  expect(lightButton).toHaveAttribute('aria-pressed', 'false');
  expect(darkButton).toHaveAttribute('aria-pressed', 'false');
  expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');

  await user.click(darkButton);
  expect(darkButton).toHaveAttribute('aria-pressed', 'true');
  expect(window.localStorage.getItem('color-scheme')).toBe('dark');
  expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark');

  await user.click(lightButton);
  expect(lightButton).toHaveAttribute('aria-pressed', 'true');
  expect(window.localStorage.getItem('color-scheme')).toBe('light');
  expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');

  await user.click(systemButton);
  expect(systemButton).toHaveAttribute('aria-pressed', 'true');
  expect(window.localStorage.getItem('color-scheme')).toBeNull();
  expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
});

test('reflects OS changes in System label, preserves explicit overrides, and syncs across tabs', async () => {
  const media = mockColorSchemeMedia(true);
  const user = userEvent.setup();

  render(<ThemeToggle />);

  const systemButton = screen.getByRole('button', { name: /System \(currently dark\)/i });
  expect(systemButton).toHaveAttribute('aria-pressed', 'true');

  act(() => {
    media.setDark(false);
  });
  expect(screen.getByRole('button', { name: /System \(currently light\)/i })).toHaveAttribute('aria-pressed', 'true');

  await user.click(screen.getByRole('button', { name: 'Dark' }));
  expect(window.localStorage.getItem('color-scheme')).toBe('dark');

  act(() => {
    window.localStorage.setItem('color-scheme', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'color-scheme', newValue: 'light' }));
  });
  expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
  expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'light');
});

test('uses document.startViewTransition when effective theme changes and motion is allowed', async () => {
  mockColorSchemeMedia(false, false);
  const startViewTransition = vi.fn((callback: () => void) => {
    callback();
    return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition: vi.fn() } as unknown as ViewTransition;
  });
  document.startViewTransition = startViewTransition;
  const user = userEvent.setup();

  render(<ThemeToggle />);

  // System (light) -> Light does not change effective theme, so no transition needed.
  await user.click(screen.getByRole('button', { name: 'Light' }));
  expect(startViewTransition).not.toHaveBeenCalled();

  // Light -> Dark changes effective theme, so startViewTransition runs.
  await user.click(screen.getByRole('button', { name: 'Dark' }));
  expect(startViewTransition).toHaveBeenCalledTimes(1);
});
