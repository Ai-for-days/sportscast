interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: 'red' | 'blue';
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  confirmColor = 'red',
  onConfirm,
  onCancel,
  children,
}: Props) {
  const btnClass = confirmColor === 'red'
    ? 'bg-alert hover:bg-alert-light'
    : 'bg-field hover:bg-field-light';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border border-border-dark bg-surface-dark-alt p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-text-dark">{title}</h3>
        <p className="mt-2 text-sm text-text-dark-muted">{message}</p>
        {children}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg border border-border-dark px-4 py-2 text-sm text-text-dark-muted hover:bg-surface-dark"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${btnClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
