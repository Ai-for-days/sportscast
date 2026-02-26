import { useState, useRef, useEffect } from 'react';
import type { GeoLocation } from '../../lib/types';

interface Props {
  onSelect: (location: GeoLocation) => void;
  placeholder?: string;
  defaultValue?: string;
}

export default function LocationSearch({ onSelect, placeholder = 'Search city, stadium, or address...', defaultValue = '' }: Props) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const searchIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
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

    // Don't search partial digits (2-4 numbers) — user is likely typing a zip code
    const isPartialZip = /^\d{2,4}$/.test(trimmed);
    if (isPartialZip) {
      return [];
    }

    // Cancel any in-flight request
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
      // Ignore if a newer search has been started
      if (thisSearchId !== searchIdRef.current) return [];
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setIsOpen(data.length > 0);
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
    setQuery(location.displayName || location.name || '');
    setIsOpen(false);
    onSelect(location);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0) {
        handleSelect(results[0]);
      } else {
        // No results yet — search immediately (bypass debounce) and auto-navigate
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
    }
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted dark:text-text-dark-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface py-3 pl-10 pr-4 text-sm text-text outline-none transition-colors focus:border-field focus:ring-2 focus:ring-field/20 dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark dark:focus:border-field"
        />
        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-field/20 border-t-field" />
          </div>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg dark:border-border-dark dark:bg-surface-dark-alt">
          {results.map((loc, i) => (
            <li key={i}>
              <button
                onClick={() => handleSelect(loc)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-surface-alt dark:hover:bg-surface-dark first:rounded-t-lg last:rounded-b-lg"
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
