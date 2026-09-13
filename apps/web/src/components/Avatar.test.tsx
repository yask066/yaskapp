import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Avatar } from './Avatar';

test('renders a sized inline fallback avatar when no image is available', () => {
  render(<Avatar name="Ada Lovelace" size={28} />);

  const avatar = screen.getByLabelText("Ada Lovelace's avatar");
  expect(avatar).toHaveStyle({
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    borderRadius: '50%',
  });
});

test('renders uploaded avatars as round cropped images', () => {
  render(<Avatar name="Ada Lovelace" src="/ada.webp" />);

  expect(screen.getByRole('img', { name: "Ada Lovelace's avatar" })).toHaveStyle({
    borderRadius: '50%',
    objectFit: 'cover',
  });
});
