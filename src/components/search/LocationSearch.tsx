import { useState, useRef, useEffect } from 'react';
import type { GeoLocation } from '../../lib/types';

interface Props {
  onSelect: (location: GeoLocation) => void;
  placeholder?: string;
  defaultValue?: string;
  /** Optional class overrides for the input element */
  inputClassName?: string;
  /** 'default' = full-size with search icon, 'compact' = smaller for header/admin */
  variant?: 'default' | 'compact';
  /** If true, returns only the display name string (no lat/lon needed) */
  nameOnly?: boolean;
}

export default function LocationSearch({
  onSelect,
  placeholder = 'Search city, stadium, or address...',
  defaultValue = '',
  inputClassName,
  variant = 'default',
  nameOnly = false,
}: Props) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const searchIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Sync defaultValue changes from parent
  useEffect(() => {
    setQuery(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = async (q: string): Promise<GeoLocation[]> => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsOpen(false);
      return [];
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    const thisSearchId = ++searchIdRef.current;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}&v=2`, {
        signal: controller.signal,
      });
      if (thisSearchId !== searchIdRef.current) return [];
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setIsOpen(data.length > 0);
        setActiveIndex(-1);
        return data;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return [];
      setResults([]);
    } finally {
      if (thisSearchId === searchIdRef.current) {
        setIsLoading(false);
      }
    }
    return [];
  };

  const handleInput = (value: string) => {
    setQuery(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => search(value), 300);
  };

  const handleSelect = (location: GeoLocation) => {
    const displayName = location.displayName || location.name || '';
    setQuery(displayName);
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(location);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen && results.length > 0) {
        setIsOpen(true);
        setActiveIndex(0);
      } else if (isOpen) {
        setActiveIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen) {
        setActiveIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && activeIndex >= 0 && activeIndex < results.length) {
        handleSelect(results[activeIndex]);
      } else if (results.length > 0) {
        handleSelect(results[0]);
      } else {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        const q = query.trim();
        if (q.length >= 2) {
          search(q).then(data => {
            if (data.length > 0) {
              handleSelect(data[0]);
            }
          });
        }
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const items = listRef.current.children;
      if (items[activeIndex]) {
        (items[activeIndex] as HTMLElement).scrollIntoView({ block: 'nearest' });
      }
    }
  }, [activeIndex]);

  const isCompact = variant === 'compact';

  const defaultInputClass = isCompact
    ? 'w-full rounded-lg border border-border bg-surface-alt py-1.5 pl-8 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted/60 focus:border-field focus:ring-1 focus:ring-field/30 dark:border-border-dark dark:bg-surface-dark dark:text-text-dark dark:placeholder:text-text-dark-muted/60 dark:focus:border-field'
    : 'w-full rounded-lg border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors focus:border-field focus:ring-2 focus:ring-field/20 dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark dark:focus:border-field';

  const finalInputClass = inputClassName || defaultInputClass;

  const iconSize = isCompact ? 'h-4 w-4' : 'h-5 w-5';
  const iconLeft = isCompact ? 'left-2.5' : 'left-3';
  const spinnerSize = isCompact ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const spinnerRight = isCompact ? 'right-2.5' : 'right-3';
  const itemPadding = isCompact ? 'px-3 py-2.5 gap-2.5' : 'px-4 py-3 gap-3';
  const dropdownMin = isCompact ? 'min-w-[280px]' : '';

  return (
    <div ref={containerRef} className={`relative w-full ${isCompact ? 'max-w-sm' : ''}`}>
      <div className="relative">
        {/* Search icon — only show if using default/compact (not custom inputClassName that might not have padding) */}
        {!inputClassName && (
          <svg className={`pointer-events-none absolute ${iconLeft} top-1/2 ${iconSize} -translate-y-1/2 text-text-muted dark:text-text-dark-muted`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={finalInputClass}
        />
        {isLoading && (
          <div className={`absolute ${spinnerRight} top-1/2 -translate-y-1/2`}>
            <div className={`${spinnerSize} animate-spin rounded-full border-2 border-field/20 border-t-field`} />
          </div>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <ul
          ref={listRef}
          className={`absolute z-50 mt-1 w-full ${dropdownMin} max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg dark:border-border-dark dark:bg-surface-dark-alt`}
        >
          {results.map((loc, i) => (
            <li key={i}>
              <button
                onClick={() => handleSelect(loc)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex w-full items-start ${itemPadding} text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg ${
                  i === activeIndex
                    ? 'bg-surface-alt dark:bg-surface-dark'
                    : 'hover:bg-surface-alt dark:hover:bg-surface-dark'
                }`}
              >
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-text-muted dark:text-text-dark-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <div>
                  <div className="font-medium text-text dark:text-text-dark">{loc.name}</div>
                  <div className="text-xs text-text-muted dark:text-text-dark-muted">{loc.displayName}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
