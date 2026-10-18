import { BettingSidebarProvider } from './BettingContext';
import BettingSidebar from './BettingSidebar';

/**
 * Wrapper component that provides BettingContext and renders BettingSidebar
 * Use this component in Astro pages with client:only="react"
 */
export function BettingSidebarWithProvider() {
  return (
    <BettingSidebarProvider>
      <BettingSidebar />
    </BettingSidebarProvider>
  );
}
