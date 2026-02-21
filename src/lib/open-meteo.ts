import type { ForecastPoint, ForecastResponse, DailyForecast, MapGridPoint, AirQualityData, AllergyData } from './types';
import { feelsLike, describeWeather, getWeatherIcon, reverseGeocode, parseLocalHour, generateDayDescription, generateNightDescription } from './weather-utils';

/**
 * WMO Weather interpretation codes → description
 */
function wmoCodeToDescription(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 55) return 'Drizzle';
  if (code <= 57) return 'Freezing drizzle';
  if (code <= 65) return 'Rain';
  if (code <= 67) return 'Freezing rain';
  if (code <= 75) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code <= 99) return 'Thunderstorm with hail';
  return 'Unknown';
}

/**
 * Reconcile WMO weather code description with actual cloud cover.
 * WMO codes 1-3 all say "Partly cloudy" but actual cloud cover may be 85-100%.
 * Only override for non-precipitation conditions.
 */
function reconcileDescription(wmoDesc: string, cloudCover: number): string {
  const d = wmoDesc.toLowerCase();
  // Don't override precipitation/fog descriptions — those are more specific
  if (d.includes('rain') || d.includes('drizzle') || d.includes('snow') ||
      d.includes('thunder') || d.includes('fog') || d.includes('freezing')) {
    return wmoDesc;
  }
  if (cloudCover >= 85) return 'Overcast';
  if (cloudCover >= 60) return 'Mostly cloudy';
  if (cloudCover >= 25) return 'Partly cloudy';
  if (cloudCover >= 5) return 'Mostly clear';
  return 'Clear';
}

/**
 * Override description when active precipitation contradicts a non-precip WMO code.
 * Open-Meteo's weather_code can lag behind actual conditions — the model may say
 * "Overcast" (code 3) while precipitation, wind gusts, and hourly codes all
 * indicate a thunderstorm. This function catches that mismatch.
 */
function overrideWithPrecipData(
  desc: string,
  precipMm: number,
  tempF: number,
  windGustMph: number,
  nearbyHourlyCodes?: number[],
): string {
  const d = desc.toLowerCase();
  // Already a precip description — don't downgrade it
  if (d.includes('rain') || d.includes('drizzle') || d.includes('snow') ||
      d.includes('thunder') || d.includes('freezing') || d.includes('hail')) {
    return desc;
  }

  // Check if nearby hourly codes indicate a thunderstorm the current snapshot missed
  if (nearbyHourlyCodes && nearbyHourlyCodes.length > 0) {
    const maxCode = Math.max(...nearbyHourlyCodes);
    if (maxCode >= 95) return maxCode > 95 ? 'Thunderstorm with hail' : 'Thunderstorm';
  }

  // No active precipitation — keep existing description
  if (precipMm <= 0) return desc;

  // Active precipitation but WMO code says cloudy/clear — override
  if (tempF <= 32) {
    return precipMm >= 2 ? 'Snow' : 'Light snow';
  }
  if (tempF <= 35) {
    return 'Freezing rain';
  }

  // Thunderstorm heuristic: heavy precip + strong gusts
  if (precipMm >= 2.5 && windGustMph >= 30) return 'Thunderstorm';

  // Rain intensity
  if (precipMm >= 7.5) return 'Heavy rain';
  if (precipMm >= 2.5) return 'Rain';
  if (precipMm >= 0.5) return 'Light rain';
  return 'Drizzle';
}

function aqiCategory(aqi: number): { category: string; description: string } {
  if (aqi <= 50) return { category: 'Good', description: 'Air quality is satisfactory and poses little or no risk.' };
  if (aqi <= 100) return { category: 'Moderate', description: 'Air quality is acceptable. Some pollutants may be a concern for sensitive individuals.' };
  if (aqi <= 150) return { category: 'Unhealthy for Sensitive Groups', description: 'Members of sensitive groups may experience health effects.' };
  if (aqi <= 200) return { category: 'Unhealthy', description: 'Everyone may begin to experience health effects.' };
  if (aqi <= 300) return { category: 'Very Unhealthy', description: 'Health alert: everyone may experience more serious health effects.' };
  return { category: 'Hazardous', description: 'Health warnings of emergency conditions.' };
}

async function fetchAirQuality(lat: number, lon: number): Promise<{ airQuality?: AirQualityData; allergyData?: AllergyData }> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}`
      + `&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide,alder_pollen,birch_pollen,grass_pollen,ragweed_pollen,dust`;
    const res = await fetch(url, { headers: { 'User-Agent': 'WagerOnWeather/1.0' } });
    if (!res.ok) return {};
    const data = await res.json();
    const c = data.current;
    const aqi = c.us_aqi ?? 0;
    const { category, description } = aqiCategory(aqi);
    const airQuality: AirQualityData = {
      aqi,
      pm2_5: c.pm2_5 ?? 0,
      pm10: c.pm10 ?? 0,
      o3: c.ozone ?? 0,
      no2: c.nitrogen_dioxide ?? 0,
      so2: c.sulphur_dioxide ?? 0,
      co: c.carbon_monoxide ?? 0,
      category,
      description,
    };

    // Build allergy data from pollen readings or seasonal estimates
    const allergyData = buildAllergyData(c);

    return { airQuality, allergyData };
  } catch {
    return {};
  }
}

function pollenLevel(value: number | null, thresholds: [number, number, number]): string {
  if (value == null || value <= 0) return 'Low';
  if (value < thresholds[0]) return 'Low';
  if (value < thresholds[1]) return 'Moderate';
  if (value < thresholds[2]) return 'High';
  return 'Very High';
}

function buildAllergyData(c: any): AllergyData {
  const birch = c.birch_pollen ?? null;
  const alder = c.alder_pollen ?? null;
  const grass = c.grass_pollen ?? null;
  const ragweed = c.ragweed_pollen ?? null;
  const dust = c.dust ?? null;

  // Check if we have meaningful pollen data (not just zeros)
  const treeMax = Math.max(birch ?? 0, alder ?? 0);
  const hasRealPollenData = treeMax > 0 || (grass ?? 0) > 0 || (ragweed ?? 0) > 0;

  const month = new Date().getMonth(); // 0-11

  if (hasRealPollenData) {
    return {
      treePollen: pollenLevel(treeMax, [15, 90, 1500]),
      ragweedPollen: pollenLevel(ragweed, [10, 50, 500]),
      grassPollen: pollenLevel(grass, [5, 20, 200]),
      mold: 'Low', // estimated from humidity later
      dustAndDander: dust != null && dust > 0 ? pollenLevel(dust, [50, 100, 200]) : seasonalDustLevel(month),
    };
  }

  // Seasonal fallback — tuned to match AccuWeather patterns
  return {
    treePollen: seasonalTreePollen(month),
    ragweedPollen: (month >= 7 && month <= 9) ? 'Moderate' : 'Low',
    grassPollen: (month >= 4 && month <= 8) ? 'Moderate' : 'Low',
    mold: 'Low', // adjusted from humidity later
    dustAndDander: seasonalDustLevel(month),
  };
}

function seasonalTreePollen(month: number): string {
  // Trees: very low in winter (Nov-Feb), ramps up Mar-Apr, peaks May, tapers June
  if (month >= 3 && month <= 5) return 'High';     // Apr-Jun
  if (month === 2) return 'Moderate';               // March (early spring)
  return 'Low';                                      // Jul-Feb
}

function seasonalDustLevel(month: number): string {
  // Dust & Dander: HIGH in winter (indoor heating = more dust/dander exposure)
  // Moderate in shoulder seasons, lower in summer (windows open)
  if (month >= 10 || month <= 2) return 'High';     // Nov-Mar (heating season)
  if (month >= 3 && month <= 4) return 'Moderate';  // Apr-May (shoulder)
  if (month >= 8 && month <= 9) return 'Moderate';  // Sep-Oct (shoulder)
  return 'Low';                                      // Jun-Aug (summer)
}

/**
 * Fetch the latest NWS (National Weather Service) observation for a US location.
 * Returns the textDescription (e.g., "Thunderstorm", "Heavy Rain") and timestamp,
 * or null if unavailable. US-only — international locations return null.
 */
const NWS_HEADERS = {
  'User-Agent': '(WagerOnWeather, derek@derekbdavis.com)',
  'Accept': 'application/geo+json',
};

async function fetchNWSObservation(lat: number, lon: number): Promise<{ description: string; timestamp: string } | null> {
  try {
    // NWS API requires max 4 decimal places
    const latStr = lat.toFixed(4);
    const lonStr = lon.toFixed(4);

    // Step 1: Get nearest observation stations from lat/lon
    const pointsRes = await fetch(`https://api.weather.gov/points/${latStr},${lonStr}`, {
      headers: NWS_HEADERS,
    });
    if (!pointsRes.ok) return null; // Non-US location or API error

    const pointsData = await pointsRes.json();
    const stationsUrl = pointsData.properties?.observationStations;
    if (!stationsUrl) return null;

    // Step 2: Get nearest station ID
    const stationsRes = await fetch(stationsUrl, { headers: NWS_HEADERS });
    if (!stationsRes.ok) return null;

    const stationsData = await stationsRes.json();
    const stationId = stationsData.features?.[0]?.properties?.stationIdentifier;
    if (!stationId) return null;

    // Step 3: Get latest observation
    const obsRes = await fetch(`https://api.weather.gov/stations/${stationId}/observations/latest`, {
      headers: NWS_HEADERS,
    });
    if (!obsRes.ok) return null;

    const obs = await obsRes.json();
    const props = obs.properties;
    if (!props?.textDescription || !props?.timestamp) return null;

    // Only use if observation is within 30 minutes
    const obsAge = Date.now() - new Date(props.timestamp).getTime();
    if (obsAge > 30 * 60 * 1000) return null;

    return {
      description: props.textDescription,
      timestamp: props.timestamp,
    };
  } catch {
    return null; // Network error, timeout, etc.
  }
}

/** Severity rank for weather descriptions — higher = more severe */
function descriptionSeverity(desc: string): number {
  const d = desc.toLowerCase();
  if (d.includes('thunder') || d.includes('hail')) return 5;
  if (d.includes('freezing')) return 4;
  if (d.includes('snow') && (d.includes('heavy') || d.includes('blizzard'))) return 4;
  if (d.includes('heavy rain') || d.includes('rain') && d.includes('heavy')) return 3;
  if (d.includes('rain') || d.includes('shower')) return 2;
  if (d.includes('snow') || d.includes('sleet') || d.includes('ice')) return 2;
  if (d.includes('drizzle')) return 1;
  if (d.includes('fog') || d.includes('mist') || d.includes('haze')) return 1;
  return 0; // clear, cloudy, overcast, etc.
}

export async function getOpenMeteoForecast(lat: number, lon: number, days: number = 15): Promise<ForecastResponse> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure,apparent_temperature,uv_index,visibility,weather_code`
    + `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure,apparent_temperature,uv_index,visibility,weather_code`
    + `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,weather_code,sunrise,sunset`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm&forecast_days=${Math.min(days, 16)}`
    + `&timezone=auto`;

  const [res, aqResult, nwsObs] = await Promise.all([
    fetch(url, { headers: { 'User-Agent': 'WagerOnWeather/1.0' } }),
    fetchAirQuality(lat, lon),
    fetchNWSObservation(lat, lon),
  ]);

  if (!res.ok) {
    throw new Error(`Open-Meteo API returned ${res.status}`);
  }

  const data = await res.json();

  // Build current conditions
  // IMPORTANT: Open-Meteo times are LOCAL to the weather location (timezone=auto).
  // We store them as-is (e.g., "2026-02-18T09:00") — never convert through new Date().toISOString()
  // which would corrupt the timezone by adding a Z suffix.
  const cur = data.current;
  const h = data.hourly;
  const curHour = parseLocalHour(cur.time);
  const curIsNight = curHour < 6 || curHour > 20;
  const curDescRaw = wmoCodeToDescription(cur.weather_code);
  let curDesc = reconcileDescription(curDescRaw, cur.cloud_cover);

  // Gather hourly weather codes for ±1 hour around now to catch storms the current snapshot missed
  const currentHourStr = cur.time.slice(0, 13); // "2026-02-18T09"
  const nearbyHourlyCodes: number[] = [];
  for (let i = 0; i < h.time.length; i++) {
    const hStr = h.time[i].slice(0, 13);
    const diff = parseInt(hStr.slice(11, 13)) - parseInt(currentHourStr.slice(11, 13));
    if (Math.abs(diff) <= 1 || (Math.abs(diff) === 23)) { // ±1 hour (handle midnight wrap)
      nearbyHourlyCodes.push(h.weather_code[i]);
    }
  }

  curDesc = overrideWithPrecipData(
    curDesc,
    cur.precipitation,
    Math.round(cur.temperature_2m),
    Math.round(cur.wind_gusts_10m),
    nearbyHourlyCodes,
  );

  // NWS real-time observation override — only upgrade, never downgrade
  if (nwsObs && descriptionSeverity(nwsObs.description) > descriptionSeverity(curDesc)) {
    curDesc = nwsObs.description;
  }

  const current: ForecastPoint = {
    time: cur.time,
    tempK: (cur.temperature_2m - 32) * 5 / 9 + 273.15,
    tempF: Math.round(cur.temperature_2m),
    tempC: Math.round((cur.temperature_2m - 32) * 5 / 9),
    humidity: cur.relative_humidity_2m,
    dewPointF: Math.round(cur.dew_point_2m ?? ((cur.temperature_2m - 32) * 5 / 9 * 0.9 * 9 / 5 + 32)),
    precipMm: cur.precipitation,
    precipProbability: 0,
    windSpeedMph: Math.round(cur.wind_speed_10m),
    windDirectionDeg: cur.wind_direction_10m,
    windGustMph: Math.round(cur.wind_gusts_10m),
    cloudCover: cur.cloud_cover,
    pressure: Math.round(cur.surface_pressure),
    feelsLikeF: Math.round(cur.apparent_temperature),
    uvIndex: cur.uv_index ?? 0,
    visibility: Math.round((cur.visibility ?? 10000) / 1609.34),
    description: curDesc,
    icon: getWeatherIcon(curDesc, curIsNight),
  };

  // Build hourly forecast — filter to current hour onward
  const hourly: ForecastPoint[] = [];
  let started = false;

  for (let i = 0; i < h.time.length; i++) {
    // Skip hours before the current hour
    if (!started) {
      if (h.time[i].slice(0, 13) >= currentHourStr) {
        started = true;
      } else {
        continue;
      }
    }

    const hour = parseLocalHour(h.time[i]);
    const isNight = hour < 6 || hour > 20;
    const tempF = Math.round(h.temperature_2m[i]);
    let desc = reconcileDescription(wmoCodeToDescription(h.weather_code[i]), h.cloud_cover[i]);
    desc = overrideWithPrecipData(desc, h.precipitation[i], tempF, Math.round(h.wind_gusts_10m[i]));

    hourly.push({
      time: h.time[i],
      tempK: (h.temperature_2m[i] - 32) * 5 / 9 + 273.15,
      tempF,
      tempC: Math.round((h.temperature_2m[i] - 32) * 5 / 9),
      humidity: h.relative_humidity_2m[i],
      dewPointF: Math.round(h.dew_point_2m?.[i] ?? tempF - 10),
      precipMm: h.precipitation[i],
      precipProbability: h.precipitation_probability[i],
      windSpeedMph: Math.round(h.wind_speed_10m[i]),
      windDirectionDeg: h.wind_direction_10m[i],
      windGustMph: Math.round(h.wind_gusts_10m[i]),
      cloudCover: h.cloud_cover[i],
      pressure: Math.round(h.surface_pressure[i]),
      feelsLikeF: Math.round(h.apparent_temperature[i]),
      uvIndex: h.uv_index[i] ?? 0,
      visibility: Math.round((h.visibility[i] ?? 10000) / 1609.34),
      description: desc,
      icon: getWeatherIcon(desc, isNight),
    });
  }

  // Build daily forecast
  const d = data.daily;
  const daily: DailyForecast[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const desc = wmoCodeToDescription(d.weather_code[i]);
    daily.push({
      date: d.time[i],
      highF: Math.round(d.temperature_2m_max[i]),
      lowF: Math.round(d.temperature_2m_min[i]),
      feelsLikeHighF: Math.round(d.apparent_temperature_max[i]),
      feelsLikeLowF: Math.round(d.apparent_temperature_min[i]),
      precipMm: Math.round(d.precipitation_sum[i] * 10) / 10,
      precipProbability: d.precipitation_probability_max[i],
      windSpeedMph: Math.round(d.wind_speed_10m_max[i]),
      windGustMph: Math.round(d.wind_gusts_10m_max[i]),
      humidity: 0,
      uvIndexMax: d.uv_index_max[i] ?? 0,
      sunrise: d.sunrise[i] ?? '',
      sunset: d.sunset[i] ?? '',
      description: desc,
      icon: getWeatherIcon(desc, false),
      dayDescription: '',
      nightDescription: '',
    });
  }

  // Fill in daily humidity and cloud cover from hourly averages
  const dayHourlyData = new Map<string, { humidity: number[]; cloudCover: number[] }>();
  for (const pt of hourly) {
    const dateKey = pt.time.slice(0, 10);
    if (!dayHourlyData.has(dateKey)) dayHourlyData.set(dateKey, { humidity: [], cloudCover: [] });
    const entry = dayHourlyData.get(dateKey)!;
    entry.humidity.push(pt.humidity);
    entry.cloudCover.push(pt.cloudCover);
  }
  for (const day of daily) {
    const data = dayHourlyData.get(day.date);
    if (data) {
      if (data.humidity.length > 0) {
        day.humidity = Math.round(data.humidity.reduce((a, b) => a + b, 0) / data.humidity.length);
      }
      // Reconcile daily description with actual avg cloud cover
      if (data.cloudCover.length > 0) {
        const avgCloud = Math.round(data.cloudCover.reduce((a, b) => a + b, 0) / data.cloudCover.length);
        day.description = reconcileDescription(day.description, avgCloud);
        day.icon = getWeatherIcon(day.description, false);
      }
    }
  }

  // Generate natural-language descriptions for each day
  for (let i = 0; i < daily.length; i++) {
    const prevDay = i > 0 ? daily[i - 1] : null;
    daily[i].dayDescription = generateDayDescription(daily[i], prevDay);
    daily[i].nightDescription = generateNightDescription(daily[i]);
  }

  // Update mold estimate from humidity
  const { airQuality: aqData, allergyData } = aqResult;
  if (allergyData && daily.length > 0) {
    const avgHumidity = daily[0].humidity;
    if (avgHumidity >= 80) allergyData.mold = 'High';
    else if (avgHumidity >= 65) allergyData.mold = 'Moderate';
    else allergyData.mold = 'Low';
  }

  const geo = await reverseGeocode(lat, lon);

  return {
    location: {
      lat,
      lon,
      name: geo.name,
      displayName: geo.displayName,
      state: geo.state,
      country: geo.country,
      zip: geo.zip,
    },
    current,
    hourly,
    daily,
    airQuality: aqData,
    allergyData,
    utcOffsetSeconds: data.utc_offset_seconds ?? -18000,
    generatedAt: new Date().toISOString(),
  };
}

export async function getOpenMeteoMapGrid(north: number, south: number, east: number, west: number): Promise<MapGridPoint[]> {
  const points: MapGridPoint[] = [];
  const step = 2;

  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (let lat = Math.ceil(south / step) * step; lat <= north; lat += step) {
    for (let lon = Math.ceil(west / step) * step; lon <= east; lon += step) {
      latitudes.push(lat);
      longitudes.push(lon);
    }
  }

  if (latitudes.length === 0) return [];

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitudes.join(',')}&longitude=${longitudes.join(',')}`
    + `&current=temperature_2m,precipitation,wind_speed_10m,wind_direction_10m`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WagerOnWeather/1.0' },
    });

    if (!res.ok) throw new Error(`Open-Meteo grid returned ${res.status}`);

    const data = await res.json();
    const results = Array.isArray(data) ? data : [data];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      points.push({
        lat: r.latitude,
        lon: r.longitude,
        tempF: Math.round(r.current.temperature_2m),
        precipMm: Math.round(r.current.precipitation * 10) / 10,
        windSpeedMph: Math.round(r.current.wind_speed_10m),
        windDirectionDeg: r.current.wind_direction_10m,
      });
    }
  } catch {
    return [];
  }

  return points;
}
