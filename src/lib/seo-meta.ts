// Centralized SEO meta generation — keyword-optimized titles & descriptions

export interface MetaResult {
  title: string;
  description: string;
  noTitleSuffix?: boolean;
}

// ─── Homepage ────────────────────────────────────────────────────────

export function getHomepageMeta(): MetaResult {
  return {
    title: 'Accurate Weather Forecasts & Sports Weather Predictions',
    description:
      'Get accurate weather forecasts, hourly conditions, 15-day outlooks, and sport-specific playability scores for 200+ stadiums. Free weather data for 41,000+ US zip codes.',
    noTitleSuffix: true,
  };
}

// ─── Map ─────────────────────────────────────────────────────────────

export function getMapMeta(): MetaResult {
  return {
    title: 'Interactive Weather Map — Live Radar, Temperature & Wind',
    description:
      'Explore live weather conditions across the US with our interactive map. View temperature, precipitation, wind overlays and click any location for a detailed forecast.',
  };
}

// ─── Historical ──────────────────────────────────────────────────────

export function getHistoricalMeta(): MetaResult {
  return {
    title: 'Historical Weather Data Lookup — Past Conditions by Date',
    description:
      'Look up past weather conditions for any US location. Search historical temperature, precipitation, and wind data by date. Compare game-day conditions to seasonal averages.',
  };
}

// ─── Venues Hub ──────────────────────────────────────────────────────

export function getVenuesHubMeta(totalVenues: number): MetaResult {
  return {
    title: 'Stadium & Sports Venue Weather Forecasts — MLB, NFL, NCAA, MLS',
    description:
      `Browse live weather forecasts for ${totalVenues}+ sports venues. Get game-day conditions for MLB stadiums, NFL fields, NCAA football stadiums, MLS pitches, and community fields.`,
  };
}

// ─── League Pages ────────────────────────────────────────────────────

const leagueLabels: Record<string, { sport: string; label: string }> = {
  mlb: { sport: 'Baseball', label: 'MLB' },
  nfl: { sport: 'Football', label: 'NFL' },
  'ncaa-football': { sport: 'College Football', label: 'NCAA Football' },
  mls: { sport: 'Soccer', label: 'MLS & Soccer' },
  community: { sport: 'Sports', label: 'Community' },
};

export function getLeagueMeta(league: string, count: number): MetaResult {
  const info = leagueLabels[league] || { sport: 'Sports', label: league.toUpperCase() };
  return {
    title: `${info.label} Stadium Weather Forecasts — All ${count} ${info.sport} Stadiums`,
    description:
      `Live weather forecasts for all ${count} ${info.label} stadiums. Get current conditions, hourly forecasts, and game-day weather predictions for every ${info.sport.toLowerCase()} venue.`,
  };
}

// ─── Zip Code / Location Pages ───────────────────────────────────────

export interface LocationMetaInput {
  city: string;
  state: string;
  zip: string;
  tempF: number;
  description: string;
  alerts?: { event: string }[];
}

export function getLocationMeta(input: LocationMetaInput): MetaResult {
  const { city, state, zip, tempF, description, alerts } = input;
  const location = `${city}, ${state}`;

  // If there's an active weather alert, use emergency-focused title
  const activeAlert = alerts && alerts.length > 0 ? alerts[0] : null;
  const title = activeAlert
    ? `${activeAlert.event} — ${location} Weather Forecast & Alerts`
    : `${location} Weather Forecast — ${zip} Hourly & 15-Day Outlook`;

  // Dynamic description with current conditions + question-based keywords
  const metaDesc =
    `Current weather in ${location} ${zip}: ${Math.round(tempF)}°F, ${description}. ` +
    `Will it rain today in ${city}? Get hourly forecasts, 15-day outlook, fishing & hunting conditions, and sports playability scores.`;

  return { title, description: metaDesc };
}
