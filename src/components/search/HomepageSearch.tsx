import LocationSearch from './LocationSearch';
import { buildLocationSlug } from '../../lib/slug-utils';
import type { GeoLocation } from '../../lib/types';

export default function HomepageSearch() {
  const handleSelect = (location: GeoLocation) => {
    if (!location.zip) {
      // Fallback to old redirect route if no zip available
      window.location.href = `/forecast/${location.lat},${location.lon}`;
      return;
    }
    const country = location.country || 'us';
    const url = buildLocationSlug(location.zip, location.name || '', location.state || '', country);
    window.location.href = url;
  };

  return (
    <LocationSearch
      onSelect={handleSelect}
      placeholder="Search city, stadium, or zip code..."
    />
  );
}
