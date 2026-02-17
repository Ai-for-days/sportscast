import { getBigQueryClient, getWeatherNextTable, isMockMode } from './bigquery';
import { getMockForecast, getMockEnsembleForecast, getMockHistorical, getMockMapGrid } from './mock-data';
import { kToF, kToC, windSpeed, windDirection, feelsLike, describeWeather, getWeatherIcon } from './weather-utils';
import type { ForecastPoint, ForecastResponse, EnsembleForecast, MapGridPoint, DailyForecast } from './types';

export async function getForecast(lat: number, lon: number, days: number = 7): Promise<ForecastResponse> {
  if (await isMockMode()) {
    return getMockForecast(lat, lon, days);
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
    const midday = pts.find(p => new Date(p.time).getHours() === 12) || pts[Math.floor(pts.length / 2)];
    daily.push({
      date,
      highF: Math.max(...temps),
      lowF: Math.min(...temps),
      precipMm: Math.round(pts.reduce((s, p) => s + p.precipMm, 0) * 10) / 10,
      precipProbability: Math.max(...pts.map(p => p.precipProbability)),
      windSpeedMph: Math.round(pts.reduce((s, p) => s + p.windSpeedMph, 0) / pts.length),
      windGustMph: Math.max(...pts.map(p => p.windGustMph)),
      humidity: Math.round(pts.reduce((s, p) => s + p.humidity, 0) / pts.length),
      description: midday.description,
      icon: midday.icon,
    });
  }

  return {
    location: { lat, lon },
    current: hourly[0],
    hourly,
    daily,
    generatedAt: new Date().toISOString(),
  };
}

export async function getEnsembleForecast(lat: number, lon: number, startTime: string, endTime: string): Promise<EnsembleForecast[]> {
  if (await isMockMode()) {
    return getMockEnsembleForecast(lat, lon, startTime, endTime);
  }

  const client = (await getBigQueryClient())!;
  const table = getWeatherNextTable();

  const query = `
    SELECT
      forecast_time,
      ensemble_member,
      temperature_2m,
      total_precipitation_6h,
      u_component_of_wind_10m,
      v_component_of_wind_10m
    FROM \`${table}\`
    WHERE ST_DISTANCE(
      ST_GEOGPOINT(@lon, @lat),
      ST_GEOGPOINT(longitude, latitude)
    ) < 25000
    AND init_time = (SELECT MAX(init_time) FROM \`${table}\`)
    AND forecast_time BETWEEN @start AND @end
    ORDER BY forecast_time, ensemble_member
  `;

  const [rows] = await client.query({
    query,
    params: { lat, lon, start: startTime, end: endTime },
  });

  // Group by forecast_time, compute percentiles
  const timeMap = new Map<string, Array<{ tempF: number; precipMm: number; windSpeedMph: number }>>();
  for (const row of rows as any[]) {
    const t = new Date(row.forecast_time).toISOString();
    if (!timeMap.has(t)) timeMap.set(t, []);
    timeMap.get(t)!.push({
      tempF: kToF(row.temperature_2m),
      precipMm: row.total_precipitation_6h / 6,
      windSpeedMph: windSpeed(row.u_component_of_wind_10m, row.v_component_of_wind_10m),
    });
  }

  const result: EnsembleForecast[] = [];
  for (const [time, members] of timeMap) {
    const sorted = {
      temp: members.map(m => m.tempF).sort((a, b) => a - b),
      precip: members.map(m => m.precipMm).sort((a, b) => a - b),
      wind: members.map(m => m.windSpeedMph).sort((a, b) => a - b),
    };
    const n = sorted.temp.length;
    const pct = (arr: number[], p: number) => arr[Math.floor(p / 100 * (n - 1))];

    result.push({
      time,
      median: { tempF: pct(sorted.temp, 50), precipMm: Math.round(pct(sorted.precip, 50) * 10) / 10, windSpeedMph: pct(sorted.wind, 50) },
      p10: { tempF: pct(sorted.temp, 10), precipMm: Math.round(pct(sorted.precip, 10) * 10) / 10, windSpeedMph: pct(sorted.wind, 10) },
      p25: { tempF: pct(sorted.temp, 25), precipMm: Math.round(pct(sorted.precip, 25) * 10) / 10, windSpeedMph: pct(sorted.wind, 25) },
      p75: { tempF: pct(sorted.temp, 75), precipMm: Math.round(pct(sorted.precip, 75) * 10) / 10, windSpeedMph: pct(sorted.wind, 75) },
      p90: { tempF: pct(sorted.temp, 90), precipMm: Math.round(pct(sorted.precip, 90) * 10) / 10, windSpeedMph: pct(sorted.wind, 90) },
      precipProbability: Math.round(members.filter(m => m.precipMm > 0.1).length / n * 100),
    });
  }

  return result;
}

export async function getHistoricalForecast(lat: number, lon: number, date: string): Promise<ForecastResponse> {
  if (await isMockMode()) {
    return getMockHistorical(lat, lon, date);
  }

  return getForecast(lat, lon, 1);
}

export async function getMapGrid(north: number, south: number, east: number, west: number): Promise<MapGridPoint[]> {
  if (await isMockMode()) {
    return getMockMapGrid(north, south, east, west);
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
