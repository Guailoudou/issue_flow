import { useCallback } from 'react';
import type { MouseEventHandler } from 'react';
import { tauriBridge } from './bridge';

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role="button"], [data-no-window-drag]';

export function shouldStartWindowDrag(target: EventTarget | null, button: number): boolean {
  if (button !== 0 || !(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) === null;
}

export function useWindowDrag(): MouseEventHandler<HTMLElement> {
  return useCallback((event) => {
    if (!shouldStartWindowDrag(event.target, event.button)) return;
    event.preventDefault();
    void tauriBridge.startWindowDrag();
  }, []);
}
