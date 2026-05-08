// ── Step 138: Seeded city set for forecast quality batch reports ────────────
//
// A modest, geographically + climatically diverse set of US cities used by
// the Step 138 batch comparison runner. Kept small (12) on purpose so an
// operator can run a full pass without surprising rate-limit or cost
// behavior from any single forecast provider.
//
// Pure data — no I/O, no client/server distinction. Imported by the
// admin batch runner and the admin UI.

export interface ForecastQualitySeedCity {
  id: string;
  label: string;
  lat: number;
  lon: number;
  /** Coarse geographic / climate grouping for the operator to scan by. */
  region: 'NE' | 'SE' | 'MW' | 'S' | 'SW' | 'W' | 'NW';
}

export const FORECAST_QUALITY_SEED_CITIES: ForecastQualitySeedCity[] = [
  { id: 'columbia-sc',    label: 'Columbia, SC',     lat: 34.0007,  lon: -81.0348, region: 'SE' },
  { id: 'new-york-ny',    label: 'New York, NY',     lat: 40.7128,  lon: -74.0060, region: 'NE' },
  { id: 'chicago-il',     label: 'Chicago, IL',      lat: 41.8781,  lon: -87.6298, region: 'MW' },
  { id: 'dallas-tx',      label: 'Dallas, TX',       lat: 32.7767,  lon: -96.7970, region: 'S'  },
  { id: 'miami-fl',       label: 'Miami, FL',        lat: 25.7617,  lon: -80.1918, region: 'SE' },
  { id: 'denver-co',      label: 'Denver, CO',       lat: 39.7392,  lon: -104.9903, region: 'W' },
  { id: 'phoenix-az',     label: 'Phoenix, AZ',      lat: 33.4484,  lon: -112.0740, region: 'SW' },
  { id: 'seattle-wa',     label: 'Seattle, WA',      lat: 47.6062,  lon: -122.3321, region: 'NW' },
  { id: 'los-angeles-ca', label: 'Los Angeles, CA',  lat: 34.0522,  lon: -118.2437, region: 'W'  },
  { id: 'boston-ma',      label: 'Boston, MA',       lat: 42.3601,  lon: -71.0589, region: 'NE' },
  { id: 'minneapolis-mn', label: 'Minneapolis, MN',  lat: 44.9778,  lon: -93.2650, region: 'MW' },
  { id: 'new-orleans-la', label: 'New Orleans, LA',  lat: 29.9511,  lon: -90.0715, region: 'S'  },
];

export function findSeedCity(id: string): ForecastQualitySeedCity | undefined {
  return FORECAST_QUALITY_SEED_CITIES.find((c) => c.id === id);
}
