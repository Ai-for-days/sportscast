import React, { useState } from 'react';

export type AdminActionVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'subtle';

interface Props {
  children: React.ReactNode;
  onClick: () => void | Promise<void>;
  /** External loading state. If omitted, the component manages its own loading state from the click handler's promise. */
  loading?: boolean;
  disabled?: boolean;
  /** Title attribute — short helper text on hover that explains exactly what the button does. */
  tooltip?: string;
  /** When set, requires the operator to confirm via window.confirm before running onClick. */
  confirmText?: string;
  variant?: AdminActionVariant;
  className?: string;
  /** Default: 'button'. Set to 'submit' only when this button intentionally submits a form. */
  type?: 'button' | 'submit';
}

const VARIANT: Record<AdminActionVariant, { bg: string; hover: string; text: string }> = {
  primary:   { bg: '#6366f1', hover: '#4f46e5', text: '#fff' },
  secondary: { bg: '#0ea5e9', hover: '#0284c7', text: '#fff' },
  success:   { bg: '#22c55e', hover: '#16a34a', text: '#fff' },
  warning:   { bg: '#f59e0b', hover: '#d97706', text: '#fff' },
  danger:    { bg: '#ef4444', hover: '#dc2626', text: '#fff' },
  subtle:    { bg: '#334155', hover: '#475569', text: '#e2e8f0' },
};

/**
 * Standardised admin action button. Encapsulates:
 *   - explicit type="button" by default (no accidental form submits)
 *   - automatic loading state on async onClick (parent can override)
 *   - disabled-while-loading (prevents double-click)
 *   - optional confirm dialog for destructive / irreversible actions
 *   - tooltip/title for in-context safety copy
 *
 * Use this for new admin buttons OR when an existing button needs uniform
 * behavior. Don't refactor working buttons just to use it — keep the change
 * additive.
 */
export default function AdminActionButton({
  children, onClick, loading, disabled, tooltip, confirmText, variant = 'primary', className, type = 'button',
}: Props) {
  const [internalLoading, setInternalLoading] = useState(false);
  const isLoading = loading ?? internalLoading;

  async function handleClick() {
    if (isLoading || disabled) return;
    if (confirmText) {
      const ok = typeof window !== 'undefined' && window.confirm(confirmText);
      if (!ok) return;
    }
    if (loading === undefined) setInternalLoading(true);
    try {
      await onClick();
    } finally {
      if (loading === undefined) setInternalLoading(false);
    }
  }

  const v = VARIANT[variant];
  const finalDisabled = !!disabled || !!isLoading;

  const style: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    background: finalDisabled ? '#475569' : v.bg,
    color: v.text,
    fontSize: 12,
    fontWeight: 600,
    cursor: finalDisabled ? 'not-allowed' : 'pointer',
    opacity: finalDisabled ? 0.7 : 1,
    transition: 'background 0.15s',
  };

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={finalDisabled}
      title={tooltip}
      className={className}
      style={style}
    >
      {isLoading ? 'Working…' : children}
    </button>
  );
}
