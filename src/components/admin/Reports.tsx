import { useState, useEffect } from 'react';

interface ReportType { key: string; label: string; description: string; }

const cardClass = 'rounded-lg border border-gray-200 bg-white p-4';
const thClass = 'px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider';
const tdClass = 'px-3 py-2 text-sm text-gray-900';

function fmtUSD(cents: number): string {
  const neg = cents < 0;
  return `${neg ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Reports() {
  const [reportTypes, setReportTypes] = useState<ReportType[]>([]);
  const [selectedType, setSelectedType] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/reports', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setReportTypes(d.reportTypes || []); setLoading(false); })
      .catch(() => { setError('Failed to load'); setLoading(false); });
  }, []);

  const buildQueryString = (extra: Record<string, string> = {}) => {
    const params = new URLSearchParams();
    params.set('reportType', selectedType);
    for (const [k, v] of Object.entries(filters)) { if (v) params.set(k, v); }
    for (const [k, v] of Object.entries(extra)) { if (v) params.set(k, v); }
    return params.toString();
  };

  const generatePreview = async () => {
    if (!selectedType) return;
    setGenerating(true);
    setReport(null);
    try {
      const res = await fetch(`/api/admin/reports?${buildQueryString()}`, { credentials: 'include' });
      if (!res.ok) { setError('Failed to generate'); return; }
      const d = await res.json();
      setReport(d);
    } catch {} finally { setGenerating(false); }
  };

  const exportReport = (format: string) => {
    const url = `/api/admin/reports?${buildQueryString({ format })}`;
    window.open(url, '_blank');
  };

  const updateFilter = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading reports...</div>;
  if (error && !reportTypes.length) return <div className="text-center py-12 text-red-600">{error}</div>;

  const summaryEntries = report?.summary ? Object.entries(report.summary).filter(([, v]) => typeof v !== 'object') : [];
  const columns = report?.rows?.length > 0 ? Object.keys(report.rows[0]) : [];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports & Export Center</h1>
        <div className="flex gap-3">
          <a href="/admin/operator-dashboard" className="text-sm text-blue-600 hover:underline">Operator</a>
          <a href="/admin/reconciliation" className="text-sm text-blue-600 hover:underline">Reconciliation</a>
          <a href="/admin/trading-desk" className="text-sm text-blue-600 hover:underline">Trading Desk</a>
        </div>
      </div>

      {/* A. Report Picker */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {reportTypes.map(rt => (
          <button
            key={rt.key}
            onClick={() => { setSelectedType(rt.key); setReport(null); }}
            className={`${cardClass} text-left hover:border-blue-400 transition-colors ${selectedType === rt.key ? 'border-blue-500 ring-2 ring-blue-200' : ''}`}
          >
            <div className="text-sm font-semibold text-gray-900">{rt.label}</div>
            <div className="text-xs text-gray-500 mt-1">{rt.description}</div>
          </button>
        ))}
      </div>

      {/* B. Filter Panel */}
      {selectedType && (
        <div className={cardClass}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Filters</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date From</label>
              <input type="date" value={filters.dateFrom || ''} onChange={e => updateFilter('dateFrom', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date To</label>
              <input type="date" value={filters.dateTo || ''} onChange={e => updateFilter('dateTo', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source</label>
              <select value={filters.source || ''} onChange={e => updateFilter('source', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">All</option>
                <option value="kalshi">Kalshi</option>
                <option value="sportsbook">Sportsbook</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mode</label>
              <select value={filters.mode || ''} onChange={e => updateFilter('mode', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">All</option>
                <option value="demo">Demo</option>
                <option value="live">Live</option>
                <option value="paper">Paper</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Confidence</label>
              <select value={filters.confidence || ''} onChange={e => updateFilter('confidence', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">All</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Sizing Tier</label>
              <select value={filters.sizingTier || ''} onChange={e => updateFilter('sizingTier', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm">
                <option value="">All</option>
                <option value="large">Large</option>
                <option value="medium">Medium</option>
                <option value="small">Small</option>
                <option value="no-trade">No Trade</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ticker</label>
              <input type="text" value={filters.ticker || ''} onChange={e => updateFilter('ticker', e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm" placeholder="Filter..." />
            </div>
          </div>
          <div className="mt-4">
            <button onClick={generatePreview} disabled={generating}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {generating ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>
      )}

      {/* C. Report Preview */}
      {report && (
        <>
          {/* Summary Cards */}
          {summaryEntries.length > 0 && (
            <div className={cardClass}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">
                  {reportTypes.find(r => r.key === report.reportType)?.label || report.reportType} — Summary
                </h2>
                <div className="flex gap-2">
                  <button onClick={() => exportReport('json-download')}
                    className="rounded bg-gray-600 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700">Export JSON</button>
                  <button onClick={() => exportReport('csv')}
                    className="rounded bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700">Export CSV</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {summaryEntries.map(([key, val]) => (
                  <div key={key} className="rounded border border-gray-100 p-2">
                    <div className="text-xs text-gray-500">{key.replace(/([A-Z])/g, ' $1').replace(/Cents$/, '').trim()}</div>
                    <div className={`text-sm font-bold ${typeof val === 'number' && key.toLowerCase().includes('pnl') ? (val >= 0 ? 'text-green-600' : 'text-red-600') : 'text-gray-900'}`}>
                      {typeof val === 'number' && key.toLowerCase().includes('cents')
                        ? fmtUSD(val as number)
                        : typeof val === 'number' ? (val as number).toLocaleString()
                        : String(val)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 mt-2">Generated: {report.generatedAt}</div>
            </div>
          )}

          {/* Preview Table */}
          {report.rows?.length > 0 && (
            <div className={cardClass}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">Data ({report.rows.length} rows)</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {columns.map(col => (
                        <th key={col} className={thClass}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.slice(0, 50).map((row: any, i: number) => (
                      <tr key={i} className="border-b border-gray-50">
                        {columns.map(col => (
                          <td key={col} className={`${tdClass} text-xs max-w-[160px] truncate`}>
                            {typeof row[col] === 'boolean' ? (row[col] ? 'yes' : 'no') : String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {report.rows.length > 50 && (
                  <div className="text-xs text-gray-400 text-center py-2">Showing 50 of {report.rows.length} rows. Export for full data.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
