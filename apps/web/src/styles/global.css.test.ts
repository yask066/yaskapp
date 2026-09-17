import { readFileSync } from 'node:fs';

const styles = readFileSync('src/styles/global.css', 'utf8');

describe('global responsive polish', () => {
  it('keeps shared controls and media bounded and touch-safe', () => {
    expect(styles).toContain('img { max-width: 100%; }');
    expect(styles).toContain('button, a, input, select, textarea { -webkit-tap-highlight-color: transparent; }');
  });

  it('stacks action groups and expands their buttons on narrow screens', () => {
    expect(styles).toContain('.poll-card__actions, .form-actions { align-items: stretch; flex-direction: column; }');
    expect(styles).toContain('.poll-card__actions .button, .form-actions .button { width: 100%; }');
  });

  it('does not retain legacy decorative treatments', () => {
    expect(styles).not.toMatch(/gradient|people-art|showcase-card|branding\/(?!yaskapp_logo)/);
  });
});
