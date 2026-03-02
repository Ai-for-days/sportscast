import { useState } from 'react';

interface Props {
  onClose: () => void;
  onDeposited: () => void;
}

const PRESETS = [1000, 2500, 5000, 10000]; // cents

export default function DepositModal({ onClose, onDeposited }: Props) {
  const [amountCents, setAmountCents] = useState<number>(2500);
  const [custom, setCustom] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = useCustom ? Math.round(parseFloat(custom || '0') * 100) : amountCents;

  const handleDeposit = async () => {
    if (effectiveAmount < 500 || effectiveAmount > 50000) {
      setError('Amount must be between $5.00 and $500.00');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/payments/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: effectiveAmount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to create checkout');
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-border-dark bg-surface-dark p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-text-dark">Deposit Funds</h3>
          <button onClick={onClose} className="text-text-dark-muted hover:text-text-dark">&times;</button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-alert/30 bg-alert/5 px-4 py-2 text-sm text-alert-light">
            {error}
          </div>
        )}

        {/* Preset amounts */}
        <div className="mb-4 grid grid-cols-4 gap-2">
          {PRESETS.map(amount => (
            <button
              key={amount}
              onClick={() => { setAmountCents(amount); setUseCustom(false); }}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                !useCustom && amountCents === amount
                  ? 'border-field bg-field/10 text-field-light'
                  : 'border-border-dark text-text-dark hover:bg-surface-dark-alt'
              }`}
            >
              ${(amount / 100).toFixed(0)}
            </button>
          ))}
        </div>

        {/* Custom amount */}
        <div className="mb-6">
          <label className="mb-1 block text-xs text-text-dark-muted">Custom amount</label>
          <div className="flex items-center gap-2">
            <span className="text-text-dark-muted">$</span>
            <input
              type="number"
              min="5"
              max="500"
              step="0.01"
              value={custom}
              onChange={e => { setCustom(e.target.value); setUseCustom(true); }}
              onFocus={() => setUseCustom(true)}
              className="w-full rounded-lg border border-border-dark bg-surface-dark-alt px-3 py-2 text-sm text-text-dark outline-none focus:border-field"
              placeholder="Enter amount"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="mb-4 rounded-lg bg-surface-dark-alt px-4 py-3 text-center">
          <span className="text-sm text-text-dark-muted">You'll deposit </span>
          <span className="font-mono text-lg font-bold text-text-dark">
            ${(effectiveAmount / 100).toFixed(2)}
          </span>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border-dark px-4 py-2.5 text-sm text-text-dark-muted hover:bg-surface-dark-alt"
          >
            Cancel
          </button>
          <button
            onClick={handleDeposit}
            disabled={loading || effectiveAmount < 500}
            className="flex-1 rounded-lg bg-field px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-field-light disabled:opacity-50"
          >
            {loading ? 'Redirecting...' : 'Continue to Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
