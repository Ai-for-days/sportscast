import { useState } from 'react';
import LocationSearch from './LocationSearch';
import { buildLocationSlug } from '../../lib/slug-utils';
import type { GeoLocation } from '../../lib/types';

export default function HomepageSearch() {
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');

  const handleSelect = async (location: GeoLocation) => {
    if (!location.zip) {
      // No zip — use reverse-geocode API to build a proper URL
      try {
        const res = await fetch(`/api/reverse-geocode?lat=${location.lat}&lon=${location.lon}`);
        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
            return;
          }
        }
      } catch {}
      // Ultimate fallback if reverse-geocode also fails
      window.location.href = `/forecast/${location.lat},${location.lon}`;
      return;
    }
    const country = location.country || 'us';
    const url = buildLocationSlug(location.zip, location.name || '', location.state || '', country);
    window.location.href = url;
  };

  const handleUseMyLocation = async () => {
    if (!navigator.geolocation) {
      setLocError('Geolocation is not supported by your browser.');
      return;
    }

    // Check the permission state up front where the browser exposes it. If it
    // is already denied, getCurrentPosition may never call EITHER callback in
    // some browsers, leaving the button spinning with nothing to explain it.
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
      if (status?.state === 'denied') {
        setLocError(
          'Location is blocked for this site. Enable it in your browser (click the icon at the left of the address bar), or search for your city or ZIP above.',
        );
        return;
      }
    } catch {
      // Permissions API is unavailable in some browsers. Fall through and try.
    }

    setLocating(true);
    setLocError('');

    // Watchdog. The `timeout` option below does NOT cover the time spent
    // waiting for the user to answer the permission prompt — per spec that
    // clock only starts once permission is granted. So a prompt that is never
    // answered, dismissed, or suppressed by policy leaves the button spinning
    // forever with no error and no way out. That is the reported symptom.
    let settled = false;
    const done = () => {
      if (settled) return true;
      settled = true;
      window.clearTimeout(watchdog);
      return false;
    };
    const watchdog = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setLocating(false);
      setLocError(
        'Still waiting on your browser for location access. Allow it in the prompt or the address bar, or search for your city or ZIP above.',
      );
    }, 20000);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (done()) return;
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
        setLocError('Found you, but could not match a forecast page. Try searching instead.');
      },
      (err) => {
        if (done()) return;
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocError(
            'Location access denied. Allow it for this site in your browser, or search for your city or ZIP above.',
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocError('Your browser could not determine your location. Try searching instead.');
        } else {
          setLocError('Location request timed out. Try searching instead.');
        }
      },
      // High accuracy is for turn-by-turn navigation. This only needs to land
      // in the right ZIP code, and on desktops without GPS the high-accuracy
      // path is markedly slower and fails more often. maximumAge lets a recent
      // fix be reused instead of forcing a fresh acquisition every click.
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
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
