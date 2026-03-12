import { buildLocationSlug } from '../../lib/slug-utils';
import type { GeoLocation } from '../../lib/types';
import LocationSearch from './LocationSearch';

export default function HeaderSearch() {
  const handleSelect = (location: GeoLocation) => {
    if (!location.zip) {
      window.location.href = `/forecast/${location.lat},${location.lon}`;
      return;
    }
    const country = location.country || 'us';
    window.location.href = buildLocationSlug(location.zip, location.name || '', location.state || '', country);
  };

  return (
    <LocationSearch
      onSelect={handleSelect}
      placeholder="City, stadium, or zip..."
      variant="compact"
    />
  );
}
