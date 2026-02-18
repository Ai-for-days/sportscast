import { getBigQueryClient, getWeatherNextTable, isMockMode } from './bigquery';
import { getOpenMeteoForecast, getOpenMeteoMapGrid } from './open-meteo';
import { getMockForecast, getMockHistorical, getMockMapGrid } from './mock-data';
import { kToF, kToC, windSpeed, windDirection, feelsLike, describeWeather, getWeatherIcon, reverseGeocode } from './weather-utils';
import type { ForecastPoint, ForecastResponse, MapGridPoint, DailyForecast } from './types';

export async function getForecast(lat: number, lon: number, days: number = 15): Promise<ForecastResponse> {
  if (await isMockMode()) {
    // Use real Open-Meteo data; fall back to mock only if that fails
    try {
      return await getOpenMeteoForecast(lat, lon, days);
    } catch (err) {
      console.warn('Open-Meteo failed, falling back to mock data:', err);
      return getMockForecast(lat, lon, days);
    }
  }

  const client = (await getBigQueryClient())!;
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
    });
  }

  const geo = await reverseGeocode(lat, lon);

  return {
    location: { lat, lon, name: geo.name, displayName: geo.displayName, state: geo.state, country: geo.country },
    current: hourly[0],
    hourly,
    daily,
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
  if (await isMockMode()) {
    try {
      return await getOpenMeteoMapGrid(north, south, east, west);
    } catch {
      return getMockMapGrid(north, south, east, west);
    }
  }

  const client = (await getBigQueryClient())!;
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
