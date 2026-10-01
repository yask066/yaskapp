import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Poll } from '../api/models';

type MotionScrollFixture = {
  cursorPages: Array<{ cursor: string | null; pollIds: string[] }>;
  cards: Poll[];
};

const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../test/fixtures/t02-motion-scroll-loading-polls.json'),
    'utf8',
  ),
) as MotionScrollFixture;

export const t02MotionScrollPolls = fixture.cards;
export const t02MotionScrollCursorPages = fixture.cursorPages;