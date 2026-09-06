import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { ProtectedRoute, PublicOnlyRoute } from './router';

vi.mock('./session-provider', () => ({
  useSession: () => ({ status: 'loading' }),
}));

test('keeps a main landmark available while public-route session restoration is loading', () => {
  render(<MemoryRouter><PublicOnlyRoute /></MemoryRouter>);

  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(screen.getByRole('status')).toHaveTextContent('Loading your session…');
});

test('keeps a main landmark available while protected-route session restoration is loading', () => {
  render(<MemoryRouter><ProtectedRoute /></MemoryRouter>);

  expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  expect(screen.getByRole('status')).toHaveTextContent('Loading your session…');
});
