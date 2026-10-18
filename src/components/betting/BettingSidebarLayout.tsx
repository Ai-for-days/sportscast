import type { ReactNode } from 'react';

interface BettingSidebarLayoutProps {
  children: ReactNode;
  sidebar: ReactNode;
}

/**
 * Responsive layout wrapper that manages the grid layout for betting sidebar
 *
 * Desktop: 2-column grid with sticky sidebar
 * Tablet/Mobile: Full-width with bottom sheet (handled by BettingSidebar component)
 */
export function BettingSidebarLayout({ children, sidebar }: BettingSidebarLayoutProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4 lg:pr-[350px]">
      {/* Main content */}
      <div className="min-w-0">
        {children}
      </div>

      {/* Sidebar - only visible on desktop via sticky positioning */}
      <div className="hidden lg:block">
        {sidebar}
      </div>

      {/* Bottom sheet and toggle button handled by BettingSidebar component itself */}
    </div>
  );
}
