import { useState, useEffect } from 'react';

interface UseBottomSheetOptions {
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Hook for managing bottom sheet state on mobile/tablet
 * Handles visibility and smooth transitions
 */
export function useBottomSheet(options: UseBottomSheetOptions = {}) {
  const { initialOpen = false, onOpenChange } = options;
  const [isOpen, setIsOpen] = useState(initialOpen);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  const open = () => setIsOpen(true);
  const close = () => setIsOpen(false);
  const toggle = () => setIsOpen(!isOpen);

  return { isOpen, open, close, toggle };
}
