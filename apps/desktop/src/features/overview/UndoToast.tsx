import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
  expiresAt?: number;
}

export function UndoToast({
  message,
  onUndo,
  onDismiss,
  durationMs = 5000,
  expiresAt,
}: UndoToastProps) {
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    const target = expiresAt ?? Date.now() + durationMs;
    return Math.max(0, target - Date.now());
  });

  useEffect(() => {
    const computedExpiresAt = expiresAt ?? Date.now() + durationMs;
    const initialRemaining = Math.max(0, computedExpiresAt - Date.now());
    setRemainingMs(initialRemaining);

    if (initialRemaining <= 0) {
      onDismiss();
      return;
    }

    const isReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (isReducedMotion) {
      // Reduced motion: disable 50ms interval animation to avoid high-frequency redraws, use single timeout
      const timer = setTimeout(() => {
        setRemainingMs(0);
        onDismiss();
      }, initialRemaining);
      return () => clearTimeout(timer);
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, computedExpiresAt - Date.now());
      setRemainingMs(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [message, durationMs, expiresAt, onDismiss]);

  const progress = Math.min(100, Math.max(0, (remainingMs / durationMs) * 100));

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute bottom-11 left-3 right-3 z-30 overflow-hidden rounded-lg bg-slate-900 text-white shadow-lg shadow-black/20"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
        <span className="truncate">{message}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onUndo}
            className="flex items-center gap-1 rounded bg-teal-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-teal-500 active:bg-teal-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <RotateCcw className="size-3" />
            <span>撤销</span>
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex size-5 items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label="关闭提示"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 w-full bg-slate-800">
        <div
          className="h-full bg-teal-500 transition-all duration-75 ease-linear motion-reduce:transition-none"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
