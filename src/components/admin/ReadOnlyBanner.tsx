import { useEffect, useState } from 'react';

/**
 * Fetches session info and, if read-only, renders a banner and injects
 * a global style that disables all buttons, inputs, selects, and textareas.
 */
export default function ReadOnlyBanner() {
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    fetch('/api/admin/session')
      .then(r => r.json())
      .then(d => { if (d.readOnly) setReadOnly(true); })
      .catch(() => {});
  }, []);

  if (!readOnly) return null;

  return (
    <>
      <style>{`
        .read-only-disabled button:not([data-allow-readonly]),
        .read-only-disabled input:not([data-allow-readonly]),
        .read-only-disabled select:not([data-allow-readonly]),
        .read-only-disabled textarea:not([data-allow-readonly]),
        .read-only-disabled [role="button"]:not([data-allow-readonly]) {
          pointer-events: none !important;
          opacity: 0.45 !important;
          cursor: not-allowed !important;
        }
      `}</style>
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: '#e7c70d',
        color: '#002868',
        textAlign: 'center',
        padding: '8px 16px',
        fontWeight: 700,
        fontSize: '14px',
        letterSpacing: '0.5px',
      }}>
        VIEW-ONLY MODE — You can browse but cannot make changes
      </div>
      {/* Push page content down so banner doesn't overlap */}
      <div style={{ height: '40px' }} />
    </>
  );
}
