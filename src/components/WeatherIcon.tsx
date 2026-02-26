/** Renders a weather condition icon — supports both image paths and legacy emoji strings. */
export default function WeatherIcon({ icon, size = 24, className = '' }: {
  icon: string;
  size?: number;
  className?: string;
}) {
  if (icon.startsWith('/')) {
    return (
      <img
        src={icon}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className={`inline-block ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  // Fallback for any legacy emoji strings
  return <span className={className}>{icon}</span>;
}
