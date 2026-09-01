export interface ShortcutKeyboardInput {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export type ShortcutCaptureResult =
  | { kind: 'pending' }
  | { kind: 'invalid'; message: string }
  | { kind: 'captured'; shortcut: string };

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift']);
const NAMED_CODES = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backquote',
  'Backslash',
  'BracketLeft',
  'BracketRight',
  'Comma',
  'Equal',
  'Minus',
  'Period',
  'Quote',
  'Semicolon',
  'Slash',
  'Space',
  'Tab',
  'Enter',
  'Backspace',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape',
]);

function normalizeMainKey(input: ShortcutKeyboardInput): string | null {
  if (/^Key[A-Z]$/.test(input.code)) return input.code.slice(3);
  if (/^Digit[0-9]$/.test(input.code)) return input.code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(input.code)) return input.code;
  if (NAMED_CODES.has(input.code)) return input.code;
  return null;
}

export function captureShortcut(input: ShortcutKeyboardInput): ShortcutCaptureResult {
  if (MODIFIER_KEYS.has(input.key)) return { kind: 'pending' };

  const modifiers: string[] = [];
  if (input.ctrlKey) modifiers.push('Control');
  if (input.altKey) modifiers.push('Alt');
  if (input.metaKey) modifiers.push('CommandOrControl');
  if (input.shiftKey) modifiers.push('Shift');

  if (modifiers.length === 0) {
    return { kind: 'invalid', message: '请至少同时按下一个修饰键（⌘、⌥、⌃ 或 ⇧）' };
  }

  const mainKey = normalizeMainKey(input);
  if (!mainKey) {
    return { kind: 'invalid', message: '该按键暂不支持，请使用字母、数字、功能键或方向键' };
  }

  return { kind: 'captured', shortcut: [...modifiers, mainKey].join('+') };
}

export function formatShortcut(shortcut?: string): string {
  if (!shortcut) return '未设置';
  return shortcut
    .split('+')
    .map((part) => {
      const normalized = part.trim().toLowerCase();
      if (normalized === 'commandorcontrol' || normalized === 'command') return '⌘';
      if (normalized === 'control' || normalized === 'ctrl') return '⌃';
      if (normalized === 'alt' || normalized === 'option') return '⌥';
      if (normalized === 'shift') return '⇧';
      if (normalized === 'space') return 'Space';
      return part.trim();
    })
    .join('');
}
