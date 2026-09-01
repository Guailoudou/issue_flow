import { describe, expect, it } from 'vitest';
import { shouldStartWindowDrag } from './useWindowDrag';

describe('shouldStartWindowDrag', () => {
  it('starts a primary-button drag from a non-interactive title area', () => {
    const title = document.createElement('span');
    expect(shouldStartWindowDrag(title, 0)).toBe(true);
  });

  it('does not steal clicks from controls or secondary buttons', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.append(icon);
    expect(shouldStartWindowDrag(icon, 0)).toBe(false);
    expect(shouldStartWindowDrag(document.createElement('div'), 2)).toBe(false);
  });
});
