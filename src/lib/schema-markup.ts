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
  humidity: number;
  windSpeedMph: number;
  feelsLikeF: number;
  uvIndex: number;
  sunrise: string;
  sunset: string;
}

function formatFAQTime(timeStr: string): string {
  if (!timeStr) return '';
  const match = timeStr.match(/T(\d{2}):(\d{2})/);
  if (!match) return timeStr;
  const h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m} ${ampm}`;
}

export function getFAQSchema(input: FAQInput) {
  const location = `${input.city}, ${input.state}`;
  const temp = Math.round(input.tempF);
  const feels = Math.round(input.feelsLikeF);
  const high = Math.round(input.highF);
  const low = Math.round(input.lowF);

  // Clothing recommendation (inline version for schema)
  let clothingAnswer: string;
  if (feels >= 95) {
    clothingAnswer = `Wear lightweight, loose-fitting clothing in light colors. It feels like ${feels}°F in ${input.city} — stay hydrated and limit sun exposure.`;
  } else if (feels >= 80 && input.humidity >= 65) {
    clothingAnswer = `Choose breathable, moisture-wicking fabrics. At ${temp}°F with ${input.humidity}% humidity, it feels hotter than the thermometer shows.`;
  } else if (feels >= 70) {
    clothingAnswer = input.precipChance > 30
      ? `Light clothing with a rain jacket or umbrella — ${temp}°F is comfortable but there's a ${input.precipChance}% chance of rain.`
      : `A t-shirt and shorts or light pants are comfortable at ${temp}°F. Sunglasses recommended.`;
  } else if (feels >= 55) {
    clothingAnswer = `Dress in layers — a light jacket over a t-shirt works well as temperatures range from ${low}°F to ${high}°F today in ${input.city}.`;
  } else if (feels >= 40) {
    clothingAnswer = `A warm coat and long pants are recommended for ${temp}°F in ${input.city}. Consider a hat and gloves if you'll be outside for a while.`;
  } else if (feels >= 25) {
    clothingAnswer = `A heavy coat, warm layers, hat, and gloves are essential at ${temp}°F in ${input.city}. Wind chill makes it feel like ${feels}°F.`;
  } else {
    clothingAnswer = `Bundle up with a heavy winter coat, thermal layers, insulated boots, hat, gloves, and scarf. It feels like ${feels}°F in ${input.city} with wind chill.`;
  }

  // Cold check
  let coldAnswer: string;
  if (temp < 32) {
    coldAnswer = `Yes, it is cold in ${input.city} right now at ${temp}°F (feels like ${feels}°F). Bundle up with winter layers if heading outdoors.`;
  } else if (temp < 50) {
    coldAnswer = `It is chilly in ${input.city} right now at ${temp}°F. A warm jacket is recommended for time spent outside.`;
  } else if (temp < 70) {
    coldAnswer = `It is cool but comfortable in ${input.city} at ${temp}°F — a light layer or jacket is a good idea.`;
  } else {
    coldAnswer = `No, it is not cold in ${input.city} right now. The current temperature is ${temp}°F — comfortable for outdoor activities.`;
  }

  // UV level
  let uvAnswer: string;
  if (input.uvIndex >= 8) {
    uvAnswer = `The UV index in ${input.city} is ${input.uvIndex} (very high). Sun protection is essential — wear SPF 30+, sunglasses, and a hat if spending time outdoors.`;
  } else if (input.uvIndex >= 6) {
    uvAnswer = `The UV index in ${input.city} is ${input.uvIndex} (high). Sunscreen and sunglasses are recommended for extended time outside.`;
  } else if (input.uvIndex >= 3) {
    uvAnswer = `The UV index in ${input.city} is ${input.uvIndex} (moderate). Some sun protection is advisable for prolonged outdoor exposure.`;
  } else {
    uvAnswer = `The UV index in ${input.city} is ${input.uvIndex} (low). Minimal sun protection is needed today.`;
  }

  // Sunrise/sunset + daylight
  const sunriseStr = formatFAQTime(input.sunrise);
  const sunsetStr = formatFAQTime(input.sunset);
  let daylightNote = '';
  if (input.sunrise && input.sunset) {
    const riseMatch = input.sunrise.match(/T(\d{2}):(\d{2})/);
    const setMatch = input.sunset.match(/T(\d{2}):(\d{2})/);
    if (riseMatch && setMatch) {
      const riseMin = parseInt(riseMatch[1]) * 60 + parseInt(riseMatch[2]);
      const setMin = parseInt(setMatch[1]) * 60 + parseInt(setMatch[2]);
      const daylight = setMin - riseMin;
      const hrs = Math.floor(daylight / 60);
      const mins = daylight % 60;
      daylightNote = ` That gives ${input.city} approximately ${hrs} hours and ${mins} minutes of daylight.`;
    }
  }

  const questions = [
    {
      q: `What is the weather in ${location} right now?`,
      a: `Current conditions in ${location}: ${temp}°F with ${input.description.toLowerCase()}. Today's high is ${high}°F and the low is ${low}°F.`,
    },
    {
      q: `Will it rain today in ${location}?`,
      a: input.precipChance > 50
        ? `Yes, there is a ${input.precipChance}% chance of rain in ${location} today. An umbrella and waterproof layers are recommended.`
        : input.precipChance > 20
          ? `There is a ${input.precipChance}% chance of rain in ${location} today — consider bringing an umbrella just in case.`
          : `Rain is unlikely in ${location} today with only a ${input.precipChance}% chance of precipitation.`,
    },
    {
      q: `Is it a good day for outdoor activities in ${location}?`,
      a: input.tempF >= 50 && input.tempF <= 85 && input.precipChance < 40
        ? `Yes! With temperatures around ${temp}°F and low rain chances, it's a great day to be outside in ${location}.`
        : `Conditions in ${location} may not be ideal for outdoor activities — ${temp}°F with a ${input.precipChance}% chance of rain. Plan accordingly.`,
    },
    {
      q: `What is the temperature in ${location} today?`,
      a: `The current temperature in ${location} is ${temp}°F (feels like ${feels}°F). Today's forecast calls for a high of ${high}°F and a low of ${low}°F.`,
    },
    {
      q: `What should I wear in ${location} today?`,
      a: clothingAnswer,
    },
    {
      q: `Is it cold in ${location} right now?`,
      a: coldAnswer,
    },
    {
      q: `What time is sunrise and sunset in ${location} today?`,
      a: `Sunrise in ${location} is at ${sunriseStr} and sunset is at ${sunsetStr}.${daylightNote}`,
    },
    {
      q: `What is the UV index in ${location} today?`,
      a: uvAnswer,
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
