export default function LoadingSpinner({ size = 'md', label = 'Loading...' }: { size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const sizeClasses = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' };

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className={`animate-spin rounded-full border-2 border-field/20 border-t-field ${sizeClasses[size]}`} />
      <p className="text-sm text-text-muted dark:text-text-dark-muted">{label}</p>
    </div>
  );
}
