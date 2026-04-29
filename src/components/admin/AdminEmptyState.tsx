import React from 'react';

interface Props {
  title: string;
  /** One-paragraph plain-English explanation of what this page is for. */
  description: string;
  /** Ordered list of what the operator needs to do to populate it. Each step is a short string; embed JSX via React.ReactNode for inline links. */
  steps?: React.ReactNode[];
  /** Optional accent color (defaults to indigo). */
  accent?: string;
  /** Optional refresh handler — when provided, renders a "Refresh" button. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Optional list of "Go to X" link buttons. */
  links?: { href: string; label: string }[];
}

/**
 * Reusable empty-state card for /admin/system/* pages that depend on data
 * which may not exist yet (settled trades, calibration outcomes, paper
 * portfolio captures, etc). Replaces the silent "render cards full of zeros"
 * anti-pattern with a clear explanation of what the page does and how to
 * populate it.
 */
export default function AdminEmptyState({ title, description, steps, accent = '#6366f1', onRefresh, refreshing, links }: Props) {
  return (
    <div style={{
      background: '#0f172a',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 8,
      padding: 24,
      color: '#cbd5e1',
      marginBottom: 16,
    }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{title}</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.5 }}>{description}</p>
      {steps && steps.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>To populate it:</div>
          <ol style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 12, color: '#94a3b8' }}>
            {steps.map((step, i) => <li key={i} style={{ marginBottom: 4 }}>{step}</li>)}
          </ol>
        </>
      )}
      {(onRefresh || (links && links.length > 0)) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={!!refreshing}
              style={{
                padding: '6px 14px', borderRadius: 6, border: 'none',
                background: refreshing ? '#475569' : accent, color: '#fff',
                fontSize: 12, fontWeight: 600, cursor: refreshing ? 'default' : 'pointer',
              }}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          {(links ?? []).map(l => (
            <a
              key={l.href}
              href={l.href}
              style={{
                padding: '6px 14px', borderRadius: 6,
                background: '#334155', color: '#fff',
                fontSize: 12, fontWeight: 600, textDecoration: 'none',
              }}
            >{l.label}</a>
          ))}
        </div>
      )}
    </div>
  );
}
