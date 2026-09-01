import { describe, expect, it } from 'vitest';
import { captureShortcut, formatShortcut } from './shortcutRecorder';

describe('shortcutRecorder', () => {
  it('captures a macOS shortcut in Tauri format', () => {
    expect(
      captureShortcut({
        key: 'k',
        code: 'KeyK',
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      }),
    ).toEqual({ kind: 'captured', shortcut: 'Alt+CommandOrControl+K' });
  });

  it('waits for a main key and rejects an unmodified key', () => {
    expect(
      captureShortcut({
        key: 'Meta',
        code: 'MetaLeft',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toEqual({ kind: 'pending' });

    expect(
      captureShortcut({
        key: 'i',
        code: 'KeyI',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      }).kind,
    ).toBe('invalid');
  });

  it('formats shortcuts using macOS symbols', () => {
    expect(formatShortcut('Alt+CommandOrControl+Shift+I')).toBe('⌥⌘⇧I');
  });
});
