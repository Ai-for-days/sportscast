/** Extract a human-readable description from the icon filename for alt text. */
function iconAltText(icon: string): string {
  if (!icon.startsWith('/')) return icon;
  // /icons/weather/partly-cloudy-day.svg → "Partly cloudy day"
  const name = icon.split('/').pop()?.replace('.svg', '').replace('.png', '') ?? '';
  return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Renders a weather condition icon — supports both image paths and legacy emoji strings. */
export default function WeatherIcon({ icon, size = 24, className = '', alt }: {
  icon: string;
  size?: number;
  className?: string;
  alt?: string;
}) {
  if (icon.startsWith('/')) {
    return (
      <img
        src={icon}
        alt={alt || iconAltText(icon)}
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
  return <span className={className} role="img" aria-label={alt || 'weather icon'}>{icon}</span>;
}
