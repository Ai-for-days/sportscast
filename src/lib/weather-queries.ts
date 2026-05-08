import { getBigQueryClient, getWeatherNextTable, isMockMode } from './bigquery';
import { getOpenMeteoForecast, getOpenMeteoMapGrid } from './open-meteo';
import { getMockForecast, getMockHistorical, getMockMapGrid } from './mock-data';
import { kToF, kToC, windSpeed, windDirection, feelsLike, describeWeather, getWeatherIcon, reverseGeocode, generateDayDescription, generateNightDescription } from './weather-utils';
import type { ForecastPoint, ForecastResponse, MapGridPoint, DailyForecast } from './types';

/**
 * Forecast source selection.
 *
 * Open-Meteo (default): blends ECMWF IFS + GFS + HRRR + ICON, refreshed
 * hourly. State-of-the-art free consumer forecast accuracy. Same gold-
 * standard models that power weather.com and most "good" weather apps
 * under the hood. Returns real precipitation_probability, uv_index, and
 * visibility values (the BigQuery WeatherNext path fabricates these).
 *
 * BigQuery WeatherNext (opt-in via USE_BIGQUERY_FORECAST=true): Google
 * DeepMind's WeatherNext sample table on `bigquery-public-data`. Useful
 * for research / A-B comparisons but is a downsampled preview that
 * updates ~daily, not hourly. Several fields (UV, real precip
 * probability, visibility) aren't in the schema and are filled with
 * formulaic placeholders. Not recommended as the live source.
 */
function shouldUseBigQueryForecast(): boolean {
  return import.meta.env.USE_BIGQUERY_FORECAST === 'true';
}

async function tryOpenMeteoOrMock(lat: number, lon: number, days: number): Promise<ForecastResponse> {
  try {
    return await getOpenMeteoForecast(lat, lon, days);
  } catch (err) {
    console.warn('Open-Meteo failed, falling back to mock data:', err);
    return getMockForecast(lat, lon, days);
  }
}

export async function getForecast(lat: number, lon: number, days: number = 15): Promise<ForecastResponse> {
  // Default path: Open-Meteo. The BigQuery WeatherNext path is gated
  // behind an explicit opt-in flag so production traffic doesn't
  // silently land on the slow / under-populated public sample table.
  if (!shouldUseBigQueryForecast()) {
    return tryOpenMeteoOrMock(lat, lon, days);
  }

  // Opt-in BigQuery WeatherNext path (research / A-B only).
  const client = await getBigQueryClient();
  if (!client) {
    console.warn('USE_BIGQUERY_FORECAST=true but BigQuery is unavailable — falling back to Open-Meteo.');
    return tryOpenMeteoOrMock(lat, lon, days);
  }
  const table = getWeatherNextTable();

  const query = `
    SELECT
      init_time,
      forecast_time,
      temperature_2m,
      relative_humidity_2m,
      total_precipitation_6h,
      u_component_of_wind_10m,
      v_component_of_wind_10m,
      total_cloud_cover,
      mean_sea_level_pressure
    FROM \`${table}\`
    WHERE ST_DISTANCE(
      ST_GEOGPOINT(@lon, @lat),
      ST_GEOGPOINT(longitude, latitude)
    ) < 25000
    AND init_time = (SELECT MAX(init_time) FROM \`${table}\`)
    AND forecast_time BETWEEN CURRENT_TIMESTAMP() AND TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @days DAY)
    ORDER BY forecast_time
  `;

  const [rows] = await client.query({
    query,
    params: { lat, lon, days },
  });

  const hourly: ForecastPoint[] = rows.map((row: any) => {
    const tempF = kToF(row.temperature_2m);
    const windMph = windSpeed(row.u_component_of_wind_10m, row.v_component_of_wind_10m);
    const windDir = windDirection(row.u_component_of_wind_10m, row.v_component_of_wind_10m);
    const humidity = row.relative_humidity_2m;
    const cloudCover = Math.round(row.total_cloud_cover * 100);
    const precipMm = row.total_precipitation_6h / 6;
    const precipProb = precipMm > 0 ? Math.min(90, Math.round(precipMm * 30)) : 0;
    const isNight = new Date(row.forecast_time).getHours() < 6 || new Date(row.forecast_time).getHours() > 20;
    const description = describeWeather(tempF, humidity, precipProb, windMph, cloudCover);

    return {
      time: new Date(row.forecast_time).toISOString(),
      tempK: row.temperature_2m,
      tempF,
      tempC: kToC(row.temperature_2m),
      humidity,
      dewPointF: Math.round(tempF - ((100 - humidity) / 5)),
      precipMm: Math.round(precipMm * 10) / 10,
      precipProbability: precipProb,
      windSpeedMph: windMph,
      windDirectionDeg: windDir,
      windGustMph: Math.round(windMph * 1.4),
      cloudCover,
      pressure: Math.round(row.mean_sea_level_pressure / 100),
      feelsLikeF: feelsLike(tempF, humidity, windMph),
      uvIndex: isNight ? 0 : 5,
      visibility: 10,
      description,
      icon: getWeatherIcon(description, isNight),
    };
  });

  // Group into daily
  const dayMap = new Map<string, ForecastPoint[]>();
  for (const pt of hourly) {
    const dateKey = pt.time.slice(0, 10);
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, []);
    dayMap.get(dateKey)!.push(pt);
  }

  const daily: DailyForecast[] = [];
  for (const [date, pts] of dayMap) {
    const temps = pts.map(p => p.tempF);
    const feelsLikes = pts.map(p => p.feelsLikeF);
    const midday = pts.find(p => new Date(p.time).getHours() === 12) || pts[Math.floor(pts.length / 2)];
    daily.push({
      date,
      highF: Math.max(...temps),
      lowF: Math.min(...temps),
      feelsLikeHighF: Math.max(...feelsLikes),
      feelsLikeLowF: Math.min(...feelsLikes),
      precipMm: Math.round(pts.reduce((s, p) => s + p.precipMm, 0) * 10) / 10,
      precipProbability: Math.max(...pts.map(p => p.precipProbability)),
      windSpeedMph: Math.round(pts.reduce((s, p) => s + p.windSpeedMph, 0) / pts.length),
      windGustMph: Math.max(...pts.map(p => p.windGustMph)),
      humidity: Math.round(pts.reduce((s, p) => s + p.humidity, 0) / pts.length),
      uvIndexMax: Math.max(...pts.map(p => p.uvIndex)),
      sunrise: '',
      sunset: '',
      description: midday.description,
      icon: midday.icon,
      dayDescription: '',
      nightDescription: '',
    });
  }

  // Generate descriptions
  for (let i = 0; i < daily.length; i++) {
    const prevDay = i > 0 ? daily[i - 1] : null;
    daily[i].dayDescription = generateDayDescription(daily[i], prevDay);
    daily[i].nightDescription = generateNightDescription(daily[i]);
  }

  const geo = await reverseGeocode(lat, lon);

  return {
    location: { lat, lon, name: geo.name, displayName: geo.displayName, state: geo.state, country: geo.country, zip: geo.zip },
    current: hourly[0],
    hourly,
    daily,
    alerts: [],
    utcOffsetSeconds: Math.round(lon / 15) * 3600,
    generatedAt: new Date().toISOString(),
  };
}

export async function getHistoricalForecast(lat: number, lon: number, date: string): Promise<ForecastResponse> {
  if (await isMockMode()) {
    return getMockHistorical(lat, lon, date);
  }

  return getForecast(lat, lon, 1);
}

export async function getMapGrid(north: number, south: number, east: number, west: number): Promise<MapGridPoint[]> {
  // Mirrors getForecast: Open-Meteo by default, BigQuery WeatherNext only
  // when USE_BIGQUERY_FORECAST=true is set explicitly.
  if (!shouldUseBigQueryForecast()) {
    try {
      return await getOpenMeteoMapGrid(north, south, east, west);
    } catch {
      return getMockMapGrid(north, south, east, west);
    }
  }

  const client = await getBigQueryClient();
  if (!client) {
    try {
      return await getOpenMeteoMapGrid(north, south, east, west);
    } catch {
      return getMockMapGrid(north, south, east, west);
    }
  }
  const table = getWeatherNextTable();

  const query = `
    SELECT
      latitude as lat,
      longitude as lon,
      temperature_2m,
      total_precipitation_6h,
      u_component_of_wind_10m,
      v_component_of_wind_10m
    FROM \`${table}\`
    WHERE latitude BETWEEN @south AND @north
    AND longitude BETWEEN @west AND @east
    AND init_time = (SELECT MAX(init_time) FROM \`${table}\`)
    AND forecast_time = (
      SELECT MIN(forecast_time)
      FROM \`${table}\`
      WHERE init_time = (SELECT MAX(init_time) FROM \`${table}\`)
      AND forecast_time > CURRENT_TIMESTAMP()
    )
    AND MOD(CAST(latitude * 4 AS INT64), 8) = 0
    AND MOD(CAST(longitude * 4 AS INT64), 8) = 0
  `;

  const [rows] = await client.query({
    query,
    params: { north, south, east, west },
  });

  return (rows as any[]).map(row => ({
    lat: row.lat,
    lon: row.lon,
    tempF: kToF(row.temperature_2m),
    precipMm: Math.round(row.total_precipitation_6h / 6 * 10) / 10,
    windSpeedMph: windSpeed(row.u_component_of_wind_10m, row.v_component_of_wind_10m),
    windDirectionDeg: windDirection(row.u_component_of_wind_10m, row.v_component_of_wind_10m),
  }));
}
