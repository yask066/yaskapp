import { render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { App } from './App';

vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
afterEach(() => vi.unstubAllGlobals());

test('renders the public Yaskapp application shell', () => {
  render(<App />);

  expect(screen.getByRole('link', { name: 'Yaskapp' })).toHaveAttribute('href', '/');
});
