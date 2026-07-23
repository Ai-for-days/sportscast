// Admin tool search — /admin/search. Searches the shared SystemNav tool
// directory (title + description + section + path) so an operator can find any
// admin tool by what it does, not just its name. Client-side filter over static
// data; no API calls.

import React, { useMemo, useRef, useState } from 'react';
import { SECTIONS } from './SystemNav';

type FlatTool = {
  href: string;
  title: string;
  description: string;
  section: string;
  badge?: string;
  badgeColor?: string;
};

const ALL_TOOLS: FlatTool[] = SECTIONS.flatMap((s) =>
  s.items.map((i) => ({ ...i, section: s.heading })),
);

export default function AdminSearch() {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    if (!q) return ALL_TOOLS;
    const terms = q.split(/\s+/).filter(Boolean);
    return ALL_TOOLS.filter((t) => {
      const hay = `${t.title} ${t.description} ${t.section} ${t.href}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [q]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && results.length > 0) {
      window.location.href = results[0].href;
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  return (
    <div className="light-theme">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Search admin tools</h1>
        <a href="/admin" className="text-xs text-blue-600 hover:underline">Admin Home</a>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Find any admin tool by name or what it does — e.g. &ldquo;suggest bets&rdquo;, &ldquo;ideas&rdquo;, &ldquo;hedge&rdquo;, &ldquo;exposure&rdquo;, &ldquo;resolve&rdquo;.
      </p>

      <div className="relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search all admin tools…"
          aria-label="Search admin tools"
          className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
        />
      </div>

      <p className="mt-3 text-xs text-gray-500">
        {q ? `${results.length} of ${ALL_TOOLS.length} tools match` : `${ALL_TOOLS.length} admin tools`}
        {results.length > 0 && q ? ' · press Enter to open the top result' : ''}
      </p>

      {results.length === 0 ? (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
          No tools match &ldquo;{query}&rdquo;. Try a different word, or browse the full list on the{' '}
          <a href="/admin/system/command-center" className="font-semibold text-blue-600 hover:underline">Command Center</a>.
        </div>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {results.map((t) => (
            <li key={t.href}>
              <a
                href={t.href}
                className="block h-full rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-blue-300 hover:bg-blue-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900">{t.title}</span>
                  {t.badge && (
                    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium ${t.badgeColor ?? 'bg-gray-100 text-gray-600'}`}>
                      {t.badge}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-gray-500">{t.description}</div>
                <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-400">{t.section} · {t.href}</div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
