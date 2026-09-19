import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { ProtectedRoute, PublicOnlyRoute } from './router';

let sessionStatus: 'loading' | 'anonymous' = 'loading';
vi.mock('./session-provider', () => ({
  useSession: () => ({ status: sessionStatus }),
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

test('redirects anonymous protected notification visits to login with the path preserved', () => {
  sessionStatus = 'anonymous';
  function LocationProbe() {
    const location = useLocation();
    return <output data-testid="location">{location.pathname}{location.search}</output>;
  }
  render(<MemoryRouter initialEntries={['/notifications']}><Routes><Route element={<ProtectedRoute />}><Route path="/notifications" element={<p>protected</p>} /></Route><Route path="/login" element={<LocationProbe />} /></Routes></MemoryRouter>);
  expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Fnotifications');
  sessionStatus = 'loading';
});
