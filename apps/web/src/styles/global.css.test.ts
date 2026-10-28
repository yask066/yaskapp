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

  it('reserves stable media, result, pending, and count geometry for poll cards', () => {
    expect(styles).toContain('.poll-card__media { position: relative; width: 100%; aspect-ratio: 16 / 9;');
    expect(styles).toContain('.poll-option { display: grid; grid-template-columns: minmax(0, 1fr) minmax(9ch, auto) minmax(4ch, auto);');
    expect(styles).toContain('.poll-option-loading { grid-column: 1 / -1; min-height: 1.2em;');
    expect(styles).toContain('font-size: .8rem; line-height: 1.2;');
    expect(styles).toContain('.poll-action-count { min-width: 4ch; font-size: .84rem; font-variant-numeric: tabular-nums;');
    expect(styles).toContain('.poll-option { grid-template-columns: minmax(0, 1fr) auto; }.poll-option-label { grid-column: 1 / -1; }');
    expect(styles).toContain('overflow-wrap: anywhere');
  });

  it('does not retain legacy decorative treatments', () => {
    expect(styles).not.toMatch(/gradient|people-art|showcase-card|branding\/(?!yaskapp_logo)/);
  });

  it('defines the motion values from the PRD as CSS tokens', () => {
    expect(styles).toContain('--motion-count-duration: 180ms;');
    expect(styles).toContain('--motion-bar-duration: 240ms;');
    expect(styles).toContain('--motion-reaction-duration: 160ms;');
    expect(styles).toContain('--motion-entry-duration: 200ms;');
    expect(styles).toContain('--motion-entry-offset: 8px;');
    expect(styles).toContain('--motion-stagger-duration: 35ms;');
    expect(styles).toContain('--motion-max-staggered-items: 6;');
    expect(styles).toContain('--motion-max-stagger-duration: 400ms;');
    expect(styles).toContain('--motion-skeleton-crossfade-duration: 120ms;');
  });
});
