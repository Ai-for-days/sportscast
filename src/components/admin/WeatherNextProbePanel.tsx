// ── Step 171: WeatherNext Vertex contract probe admin panel ─────────────
//
// **Admin-only diagnostic UI.** Reads the GET readiness on mount and
// lets the operator fire a single POST probe to the configured Vertex
// AI endpoint. **No public surface.** No raw credentials are ever
// displayed — the API sanitizes its own output.

import { useEffect, useState } from 'react';

interface ProbeConfig {
  weatherNextEnabled: boolean;
  probeEnabled: boolean;
  hasProjectId: boolean;
  hasCredentials: boolean;
  hasRegion: boolean;
  hasEndpointId: boolean;
}

interface ProbeResult {
  ok: boolean;
  status:
    | 'disabled'
    | 'probe_disabled'
    | 'missing_config'
    | 'credentials_invalid'
    | 'endpoint_unreachable'
    | 'contract_rejected'
    | 'contract_confirmed'
    | 'unexpected_response'
    | 'ready_to_probe'
    | 'not_ready'
    | 'unexpected_error';
  config: ProbeConfig;
  endpoint?: { region?: string; endpointIdPresent: boolean };
  requestShapeAttempted?: string;
  httpStatus?: number;
  responseShapeSummary?: {
    topLevelKeys: string[];
    sampleFieldTypes: Record<string, string>;
    forecastLikeFields?: string[];
  };
  notes: string[];
  nextAction?: string;
  publicForecastFlow?: string;
}

const STATUS_TONE: Record<string, string> = {
  contract_confirmed: '#15803d',
  ready_to_probe: '#0369a1',
  not_ready: '#475569',
  disabled: '#475569',
  probe_disabled: '#475569',
  missing_config: '#b45309',
  credentials_invalid: '#b91c1c',
  endpoint_unreachable: '#b91c1c',
  contract_rejected: '#b45309',
  unexpected_response: '#b45309',
  unexpected_error: '#b91c1c',
};

export default function WeatherNextProbePanel() {
  const [readiness, setReadiness] = useState<ProbeResult | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [probing, setProbing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lat, setLat] = useState<string>('');
  const [lon, setLon] = useState<string>('');

  async function loadReadiness() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/system/weathernext-probe');
      const j = await r.json();
      if (!r.ok) {
        setError(j?.error ?? `HTTP ${r.status}`);
        return;
      }
      setReadiness(j as ProbeResult);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReadiness();
  }, []);

  async function runProbe() {
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      const body: any = {};
      if (lat.trim()) body.lat = Number(lat);
      if (lon.trim()) body.lon = Number(lon);
      const r = await fetch('/api/admin/system/weathernext-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      setProbe(j as ProbeResult);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setProbing(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          background: 'linear-gradient(135deg, #0f172a, #1e293b)',
          color: '#e2e8f0',
        }}
      >
        <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.3 }}>
          WeatherNext Vertex AI contract probe
        </div>
        <h1 style={{ margin: '4px 0 0 0', fontSize: 20, fontWeight: 700 }}>
          What does the WeatherNext endpoint actually accept?
        </h1>
        <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 6, lineHeight: 1.5 }}>
          Admin-only diagnostic. Reads env readiness on load. POST fires one Vertex AI call only when both
          <code style={{ background: '#1e293b', padding: '0 4px', borderRadius: 3, margin: '0 4px' }}>
            WEATHER_PROVIDER_WEATHERNEXT_ENABLED
          </code>
          and
          <code style={{ background: '#1e293b', padding: '0 4px', borderRadius: 3, margin: '0 4px' }}>
            WEATHERNEXT_VERTEX_PROBE_ENABLED
          </code>
          are explicitly true. The public ZIP-code forecast flow is unaffected (Open-Meteo).
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 14px',
            border: '1px solid #fca5a5',
            background: '#fef2f2',
            color: '#7f1d1d',
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Readiness</h2>
          <button
            onClick={loadReadiness}
            disabled={loading}
            style={{
              padding: '5px 10px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#fff',
              color: '#0f172a',
              fontSize: 11,
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {readiness && <ProbeBlock result={readiness} />}
      </div>

      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Run a probe</h2>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 4, lineHeight: 1.5 }}>
          Defaults to New York City (lat 40.7128, lon -74.006). Override below if you want to test a specific
          coordinate. One call per click — no retries, no looping.
        </div>
        <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <div>
            <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 2 }}>Lat</label>
            <input
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, width: '100%' }}
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="40.7128"
            />
          </div>
          <div>
            <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 2 }}>Lon</label>
            <input
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 12, width: '100%' }}
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              placeholder="-74.006"
            />
          </div>
        </div>
        <button
          onClick={runProbe}
          disabled={probing}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            borderRadius: 6,
            border: '1px solid #1d4ed8',
            background: probing ? '#334155' : '#2563eb',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: probing ? 'wait' : 'pointer',
          }}
        >
          {probing ? 'Probing…' : 'Send one probe'}
        </button>

        {probe && (
          <div style={{ marginTop: 14 }}>
            <ProbeBlock result={probe} />
          </div>
        )}
      </div>

      <div style={{ fontSize: 10, color: '#64748b' }}>
        Admin-only operator intelligence. Not customer-facing. Probe outputs are sanitized — no raw
        credentials, tokens, endpoint ids, or full payloads ever leave the server. Public ZIP-code
        forecasts continue to be served by Open-Meteo regardless of probe results.
      </div>
    </div>
  );
}

function ProbeBlock({ result }: { result: ProbeResult }) {
  const tone = STATUS_TONE[result.status] ?? '#475569';
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip color={tone}>{result.status}</Chip>
        {typeof result.httpStatus === 'number' && (
          <Chip color="#475569">HTTP {result.httpStatus}</Chip>
        )}
        {result.requestShapeAttempted && (
          <span style={{ fontSize: 11, color: '#475569' }}>
            request shape: <code>{result.requestShapeAttempted}</code>
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#1f2937' }}>
        <strong>Config:</strong>{' '}
        <Pill ok={result.config.weatherNextEnabled}>WN_ENABLED</Pill>{' '}
        <Pill ok={result.config.probeEnabled}>PROBE_ENABLED</Pill>{' '}
        <Pill ok={result.config.hasProjectId}>PROJECT</Pill>{' '}
        <Pill ok={result.config.hasCredentials}>CREDS</Pill>{' '}
        <Pill ok={result.config.hasRegion}>REGION</Pill>{' '}
        <Pill ok={result.config.hasEndpointId}>ENDPOINT</Pill>
      </div>

      {result.endpoint && (
        <div style={{ fontSize: 11, color: '#475569' }}>
          Region: <code>{result.endpoint.region ?? '—'}</code> · endpoint id present:{' '}
          {result.endpoint.endpointIdPresent ? 'yes' : 'no'}
        </div>
      )}

      {result.responseShapeSummary && (
        <div
          style={{
            padding: 10,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 11,
            color: '#0f172a',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Response shape summary (sanitized)</div>
          <div>
            <strong>Top-level keys:</strong>{' '}
            <code>{result.responseShapeSummary.topLevelKeys.join(', ') || '(none)'}</code>
          </div>
          {result.responseShapeSummary.forecastLikeFields && (
            <div style={{ marginTop: 4 }}>
              <strong>Forecast-like fields:</strong>{' '}
              <code>{result.responseShapeSummary.forecastLikeFields.join(', ')}</code>
            </div>
          )}
          {Object.keys(result.responseShapeSummary.sampleFieldTypes).length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Field types</summary>
              <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                {Object.entries(result.responseShapeSummary.sampleFieldTypes).map(([k, v]) => (
                  <li key={k}>
                    <code>{k}</code>: {v}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {result.notes && result.notes.length > 0 && (
        <ul style={{ paddingLeft: 18, margin: 0, fontSize: 11, color: '#475569' }}>
          {result.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {result.nextAction && (
        <div
          style={{
            padding: '6px 10px',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 6,
            fontSize: 11,
            color: '#1e3a8a',
          }}
        >
          <strong>Next action:</strong> {result.nextAction}
        </div>
      )}
    </div>
  );
}

function Chip({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: '#fff',
        background: color,
        padding: '3px 8px',
        borderRadius: 999,
        textTransform: 'uppercase',
        letterSpacing: 0.3,
      }}
    >
      {children}
    </span>
  );
}

function Pill({ children, ok }: { children: React.ReactNode; ok: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 10,
        fontWeight: 700,
        color: '#fff',
        background: ok ? '#15803d' : '#7f1d1d',
        padding: '2px 6px',
        borderRadius: 999,
        marginRight: 4,
        letterSpacing: 0.3,
      }}
    >
      {ok ? '✓ ' : '· '}
      {children}
    </span>
  );
}
