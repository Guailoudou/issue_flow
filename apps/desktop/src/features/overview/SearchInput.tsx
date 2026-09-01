import { Search, X } from 'lucide-react';
import { forwardRef } from 'react';

export interface SearchInputProps {
  value: string;
  onChange: (val: string) => void;
  onClear: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ value, onChange, onClear, onKeyDown }, ref) {
    return (
      <div className="relative px-3 py-2 bg-slate-50/50 border-b border-slate-200/60">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2.5 size-3.5 text-slate-400" aria-hidden="true" />
          <input
            ref={ref}
            type="text"
            placeholder="搜索 Issue 标题或描述… (⌘K)"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-8 w-full rounded-md border border-slate-200 bg-white pl-8 pr-12 text-xs text-slate-800 placeholder-slate-400 transition-colors focus:border-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          {value ? (
            <button
              type="button"
              onClick={onClear}
              className="absolute right-2 flex size-4 items-center justify-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="清除搜索"
            >
              <X className="size-2.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 hidden sm:inline-block rounded border border-slate-200 bg-slate-50 px-1 text-[10px] font-mono text-slate-400">
              ⌘K
            </kbd>
          )}
        </div>
      </div>
    );
  },
);
