import { BettingSidebarProvider } from './BettingContext';
import BettingSidebar from './BettingSidebar';
import { sportForPath } from '../../lib/sidebar-order';

/**
 * Wrapper component that provides BettingContext and renders BettingSidebar
 * Use this component in Astro pages with client:only="react"
 */
export function BettingSidebarWithProvider({ inColumn = false }: { inColumn?: boolean }) {
  return (
    <BettingSidebarProvider initialSport={sportForPath(typeof window === 'undefined' ? '' : window.location.pathname)}>
      <BettingSidebar inColumn={inColumn} />
    </BettingSidebarProvider>
  );
}
