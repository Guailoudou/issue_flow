import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoToast } from './UndoToast';

describe('UndoToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers onDismiss after durationMs has passed', () => {
    const onUndo = vi.fn();
    const onDismiss = vi.fn();

    render(
      <UndoToast
        message="已完成 #101"
        onUndo={onUndo}
        onDismiss={onDismiss}
        durationMs={5000}
      />,
    );

    expect(screen.getByText('已完成 #101')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();

    // Advance 4900ms - not yet dismissed
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Advance remaining 200ms
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('correctly handles consecutive close actions and re-syncs timer per item key', () => {
    const onUndo1 = vi.fn();
    const onDismiss1 = vi.fn();
    const onUndo2 = vi.fn();
    const onDismiss2 = vi.fn();

    const now = Date.now();
    const { rerender } = render(
      <UndoToast
        key="101"
        message="已完成 #101"
        onUndo={onUndo1}
        onDismiss={onDismiss1}
        expiresAt={now + 5000}
        durationMs={5000}
      />,
    );

    // Advance 2000ms on first item
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDismiss1).not.toHaveBeenCalled();

    // Second item closed immediately with a new expiry
    const newExpiry = now + 7000;
    rerender(
      <UndoToast
        key="102"
        message="已完成 #102"
        onUndo={onUndo2}
        onDismiss={onDismiss2}
        expiresAt={newExpiry}
        durationMs={5000}
      />,
    );

    expect(screen.getByText('已完成 #102')).toBeInTheDocument();

    // Advance 3100ms (total 5100ms from start) -> Item 1 would have expired, but Item 2 has not!
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(onDismiss2).not.toHaveBeenCalled();

    // Advance remaining 2000ms -> Item 2 expires
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onDismiss2).toHaveBeenCalledTimes(1);
  });

  it('calls onUndo when clicking undo button', async () => {
    vi.useRealTimers();
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <UndoToast
        message="已完成 #101"
        onUndo={onUndo}
        onDismiss={onDismiss}
        durationMs={5000}
      />,
    );

    const undoBtn = screen.getByRole('button', { name: '撤销' });
    await user.click(undoBtn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss when clicking close button', async () => {
    vi.useRealTimers();
    const onUndo = vi.fn();
    const onDismiss = vi.fn();
    const user = userEvent.setup();

    render(
      <UndoToast
        message="已完成 #101"
        onUndo={onUndo}
        onDismiss={onDismiss}
        durationMs={5000}
      />,
    );

    const closeBtn = screen.getByRole('button', { name: '关闭提示' });
    await user.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('uses a single timeout and bypasses 50ms interval animation when prefers-reduced-motion is active', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const onUndo = vi.fn();
    const onDismiss = vi.fn();

    render(
      <UndoToast
        message="已完成 #101"
        onUndo={onUndo}
        onDismiss={onDismiss}
        durationMs={5000}
      />,
    );

    // setInterval should NOT be called under prefers-reduced-motion
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // Advance 5000ms -> onDismiss is fired via single setTimeout
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    window.matchMedia = originalMatchMedia;
  });
});
