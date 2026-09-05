import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the public Yaskapp application shell', () => {
  render(<App />);

  expect(screen.getByRole('link', { name: 'Yaskapp' })).toHaveAttribute('href', '/');
});
