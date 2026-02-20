import { useState } from 'react';
import LocationSearch from './LocationSearch';
import { buildLocationSlug } from '../../lib/slug-utils';
import type { GeoLocation } from '../../lib/types';

export default function HomepageSearch() {
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');

  const handleSelect = (location: GeoLocation) => {
    if (!location.zip) {
      window.location.href = `/forecast/${location.lat},${location.lon}`;
      return;
    }
    const country = location.country || 'us';
    const url = buildLocationSlug(location.zip, location.name || '', location.state || '', country);
    window.location.href = url;
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocError('Geolocation is not supported by your browser.');
      return;
    }
    setLocating(true);
    setLocError('');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        try {
          const res = await fetch(`/api/reverse-geocode?lat=${lat}&lon=${lon}`);
          if (res.ok) {
            const data = await res.json();
            if (data.url) {
              window.location.href = data.url;
              return;
            }
          }
        } catch {}
        setLocating(false);
        setLocError('Unable to determine your location. Try searching instead.');
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocError('Location access denied. Please allow location access in your browser settings.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocError('Unable to determine your location. Try searching instead.');
        } else {
          setLocError('Location request timed out. Try searching instead.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  };

  return (
    <div className="space-y-3">
      <LocationSearch
        onSelect={handleSelect}
        placeholder="Search city, stadium, or zip code..."
      />
      <button
        onClick={handleUseMyLocation}
        disabled={locating}
        className="mx-auto flex items-center gap-2 rounded-lg border-2 border-white/30 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/10 disabled:opacity-60"
      >
        {locating ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            Locating...
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Use My Location
          </>
        )}
      </button>
      {locError && (
        <p className="text-center text-xs text-red-200">{locError}</p>
      )}
    </div>
  );
}
