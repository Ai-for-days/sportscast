import { useEffect, useState } from 'react';
import { useBetting } from './BettingContext';
import { SportSelector } from './SportSelector';
import { GamesList } from './GamesList';
import { BetSlip } from './BetSlip';
import { useBottomSheet } from './useBottomSheet';

/**
 * Responsive Betting Sidebar Component
 *
 * Desktop (1024px+): Fixed right sidebar with content
 * Tablet/Mobile: Toggle button + collapsible bottom sheet
 */
export default function BettingSidebar() {
  const { betLegs } = useBetting();
  const { isOpen, toggle, close } = useBottomSheet();
  const [isDesktop, setIsDesktop] = useState(true); // Default to desktop to avoid hydration mismatch

  // Detect if we're on desktop
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };

    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  return (
    <>
      {/* Desktop: Fixed Sidebar */}
      {isDesktop && (
        <div className="hidden lg:block fixed right-0 top-0 h-screen w-[350px] overflow-y-auto border-l border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark-alt">
          <SidebarContent />
        </div>
      )}

      {/* Mobile/Tablet: Toggle button + bottom sheet */}
      {!isDesktop && (
        <>
          {/* Toggle Button */}
          <button
            onClick={toggle}
            className="fixed bottom-4 right-4 z-40 rounded-lg bg-field px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-field-dark lg:hidden"
          >
            Betting {betLegs.length > 0 && `(${betLegs.length})`}
          </button>

          {/* Bottom Sheet Overlay */}
          {isOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                onClick={close}
              />

              {/* Bottom Sheet */}
              <div className="fixed bottom-0 left-0 right-0 z-50 max-h-[50vh] overflow-y-auto rounded-t-lg border-t border-border bg-surface p-4 dark:border-border-dark dark:bg-surface-dark-alt lg:hidden">
                <SidebarContent onClose={close} />
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

interface SidebarContentProps {
  onClose?: () => void;
}

function SidebarContent({ onClose }: SidebarContentProps) {
  const { balance, balanceLoading } = useBetting();

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <h3 className="text-lg font-bold text-text dark:text-text-dark">Place a Bet</h3>
        {balance !== null && (
          <p className="mt-1 text-sm text-text-muted dark:text-text-dark-muted">
            Balance: <span className="font-semibold text-text dark:text-text-dark">${balance.toFixed(2)}</span>
          </p>
        )}
        {balanceLoading && !balance && (
          <p className="mt-1 text-sm text-text-muted dark:text-text-dark-muted">
            Loading balance...
          </p>
        )}
      </div>

      {/* Sport Selector */}
      <div className="mb-4">
        <SportSelector />
      </div>

      {/* Games List */}
      <GamesList />

      {/* Bet Slip */}
      <BetSlip />

      {/* Close button for mobile sheet */}
      {onClose && (
        <button
          onClick={onClose}
          className="mt-4 w-full rounded border border-border-dark px-3 py-2 text-sm font-semibold text-text-dark hover:bg-surface-dark dark:border-border dark:text-text dark:hover:bg-surface"
        >
          Close
        </button>
      )}
    </div>
  );
}
