import { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Building2,
  CornerDownLeft,
  Factory,
  FolderKanban,
  Landmark,
  LifeBuoy,
  Search,
  ShoppingBag,
  UsersRound,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { formatCurrency } from '../lib/format';
import type { GlobalSearchResult } from '../types/erp';

interface GlobalSearchBarProps {
  onSelectResult: (result: GlobalSearchResult) => void;
}

const CATEGORY_ICONS: Record<string, typeof Search> = {
  crm: Building2,
  inventory: Boxes,
  commerce: ShoppingBag,
  billing: Landmark,
  projects: FolderKanban,
  support: LifeBuoy,
  hr: UsersRound,
  manufacturing: Factory,
};

export function GlobalSearchBar({ onSelectResult }: GlobalSearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl+K / Cmd+K focuses global search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search query
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiRequest<{ results: GlobalSearchResult[] }>(
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!cancelled) {
          setResults(res.results);
          setActiveIndex(0);
          setOpen(true);
        }
      } catch {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function handleSelect(item: GlobalSearchResult) {
    setOpen(false);
    setQuery('');
    setResults([]);
    onSelectResult(item);
  }

  return (
    <div ref={containerRef} className="relative flex-1 max-w-md min-w-[160px]">
      <div className="relative flex items-center">
        <Search
          className="w-4 h-4 text-zinc-400 dark:text-zinc-500 absolute left-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => {
            if (query.trim()) setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value.trim()) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (!open || results.length === 0) {
              if (e.key === 'Escape') {
                setOpen(false);
                inputRef.current?.blur();
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((prev) => (prev + 1) % results.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const chosen = results[activeIndex];
              if (chosen) handleSelect(chosen);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder="Search customers, products, orders, or #ID..."
          aria-label="Global record search"
          aria-expanded={open}
          role="combobox"
          aria-autocomplete="list"
          className="w-full h-9 pl-9 pr-14 text-xs sm:text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:bg-white dark:focus:bg-zinc-900 focus:ring-2 focus:ring-orange-600 focus:border-transparent transition-colors"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setOpen(false);
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-2.5 p-1 rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded absolute right-2.5 pointer-events-none">
            Ctrl K
          </kbd>
        )}
      </div>

      {open && query.trim() && (
        <div
          role="listbox"
          className="absolute left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl overflow-hidden z-50 max-h-[70vh] flex flex-col"
        >
          <div className="px-3.5 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
            <span>
              {loading
                ? 'Searching records...'
                : `${results.length} matching record${results.length === 1 ? '' : 's'}`}
            </span>
            <span className="hidden sm:inline font-mono">↑↓ Navigate · Enter Open</span>
          </div>

          <div className="overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800/80">
            {loading && results.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                Searching across ERP modules...
              </div>
            ) : results.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <p className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                  No records match "{query.trim()}"
                </p>
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Try searching by customer name, SKU, reference code, email, or numeric ID.
                </p>
              </div>
            ) : (
              results.map((item, idx) => {
                const Icon = CATEGORY_ICONS[item.moduleKey] ?? Search;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={item.uid}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleSelect(item)}
                    className={`w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-3 transition-colors ${
                      isActive
                        ? 'bg-orange-50/80 dark:bg-orange-950/40'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          isActive
                            ? 'text-orange-600 dark:text-orange-400'
                            : 'text-zinc-400 dark:text-zinc-500'
                        }`}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-medium text-orange-700 dark:text-orange-400 shrink-0">
                            {item.ref}
                          </span>
                          <span className="text-zinc-300 dark:text-zinc-700 shrink-0">·</span>
                          <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {item.title}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                          <span>{item.category}</span>
                          {item.subtitle && (
                            <>
                              <span className="mx-1.5">·</span>
                              <span>{item.subtitle}</span>
                            </>
                          )}
                          <span className="mx-1.5">·</span>
                          <span className="font-mono">#{item.id}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                      {typeof item.amount === 'number' && (
                        <span className="text-xs font-mono tabular-nums font-medium text-zinc-800 dark:text-zinc-200">
                          {formatCurrency(item.amount)}
                        </span>
                      )}
                      {isActive && (
                        <CornerDownLeft
                          className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
