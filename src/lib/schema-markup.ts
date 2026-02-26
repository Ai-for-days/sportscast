// JSON-LD structured data generators for all page types

const SITE_URL = 'https://wageronweather.com';
const SITE_NAME = 'Wager on Weather';
const LOGO_URL = `${SITE_URL}/og-logo.png`;

// ─── Organization (Homepage) ─────────────────────────────────────────

export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: LOGO_URL,
    sameAs: [],
    description: 'Sports weather intelligence — accurate forecasts, stadium weather, and outdoor activity conditions for 41,000+ US locations.',
  };
}

// ─── WebSite + SearchAction (Homepage) ───────────────────────────────

export function getWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/api/geocode?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

// ─── BreadcrumbList ──────────────────────────────────────────────────

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function getBreadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
    })),
  };
}

// ─── Place + GeoCoordinates (Zip pages) ──────────────────────────────

export interface PlaceSchemaInput {
  city: string;
  state: string;
  zip: string;
  lat: number;
  lon: number;
  tempF: number;
  description: string;
  humidity: number;
  windSpeedMph: number;
  url: string;
}

export function getPlaceSchema(input: PlaceSchemaInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: `${input.city}, ${input.state} ${input.zip}`,
    geo: {
      '@type': 'GeoCoordinates',
      latitude: input.lat,
      longitude: input.lon,
    },
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Temperature',
        value: `${Math.round(input.tempF)}°F`,
      },
      {
        '@type': 'PropertyValue',
        name: 'Conditions',
        value: input.description,
      },
      {
        '@type': 'PropertyValue',
        name: 'Humidity',
        value: `${input.humidity}%`,
      },
      {
        '@type': 'PropertyValue',
        name: 'Wind Speed',
        value: `${input.windSpeedMph} mph`,
      },
    ],
    url: input.url.startsWith('http') ? input.url : `${SITE_URL}${input.url}`,
  };
}

// ─── SpecialAnnouncement (Zip pages with alerts) ─────────────────────

export interface AlertSchemaInput {
  event: string;
  headline: string;
  description: string;
  onset?: string;
  expires?: string;
  city: string;
  state: string;
  url: string;
}

export function getSpecialAnnouncementSchema(alert: AlertSchemaInput) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SpecialAnnouncement',
    name: alert.event,
    text: alert.headline || alert.description.slice(0, 300),
    datePosted: alert.onset || new Date().toISOString(),
    expires: alert.expires || undefined,
    spatialCoverage: {
      '@type': 'Place',
      name: `${alert.city}, ${alert.state}`,
    },
    category: 'https://www.wikidata.org/wiki/Q3839081', // weather warning
    url: alert.url.startsWith('http') ? alert.url : `${SITE_URL}${alert.url}`,
  };
}

// ─── FAQPage (Zip pages) ─────────────────────────────────────────────

export interface FAQInput {
  city: string;
  state: string;
  tempF: number;
  description: string;
  precipChance: number;
  highF: number;
  lowF: number;
}

export function getFAQSchema(input: FAQInput) {
  const location = `${input.city}, ${input.state}`;
  const questions = [
    {
      q: `What is the weather in ${location} right now?`,
      a: `Current conditions in ${location}: ${Math.round(input.tempF)}°F with ${input.description.toLowerCase()}.`,
    },
    {
      q: `Will it rain today in ${location}?`,
      a: input.precipChance > 50
        ? `Yes, there is a ${input.precipChance}% chance of rain in ${location} today.`
        : input.precipChance > 20
          ? `There is a ${input.precipChance}% chance of rain in ${location} today. Consider bringing an umbrella.`
          : `Rain is unlikely in ${location} today with only a ${input.precipChance}% chance of precipitation.`,
    },
    {
      q: `Is it a good day for outdoor activities in ${location}?`,
      a: input.tempF >= 50 && input.tempF <= 85 && input.precipChance < 40
        ? `Yes! With temperatures around ${Math.round(input.tempF)}°F and low rain chances, it's a good day to be outside in ${location}.`
        : `Conditions in ${location} may not be ideal for outdoor activities — ${Math.round(input.tempF)}°F with ${input.precipChance}% chance of rain.`,
    },
  ];

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: a,
      },
    })),
  };
}

// ─── CollectionPage + ItemList (Venues hub, league pages) ────────────

export interface CollectionItem {
  name: string;
  url: string;
  description?: string;
}

export function getCollectionPageSchema(
  name: string,
  description: string,
  url: string,
  items: CollectionItem[],
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url: url.startsWith('http') ? url : `${SITE_URL}${url}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.slice(0, 50).map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.name,
        url: item.url.startsWith('http') ? item.url : `${SITE_URL}${item.url}`,
        ...(item.description ? { description: item.description } : {}),
      })),
    },
  };
}
