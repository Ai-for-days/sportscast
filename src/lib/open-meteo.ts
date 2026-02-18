import type { ForecastPoint, ForecastResponse, DailyForecast, MapGridPoint, AirQualityData } from './types';
import { feelsLike, describeWeather, getWeatherIcon, reverseGeocode, parseLocalHour } from './weather-utils';

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

function aqiCategory(aqi: number): { category: string; description: string } {
  if (aqi <= 50) return { category: 'Good', description: 'Air quality is satisfactory and poses little or no risk.' };
  if (aqi <= 100) return { category: 'Moderate', description: 'Air quality is acceptable. Some pollutants may be a concern for sensitive individuals.' };
  if (aqi <= 150) return { category: 'Unhealthy for Sensitive Groups', description: 'Members of sensitive groups may experience health effects.' };
  if (aqi <= 200) return { category: 'Unhealthy', description: 'Everyone may begin to experience health effects.' };
  if (aqi <= 300) return { category: 'Very Unhealthy', description: 'Health alert: everyone may experience more serious health effects.' };
  return { category: 'Hazardous', description: 'Health warnings of emergency conditions.' };
}

async function fetchAirQuality(lat: number, lon: number): Promise<AirQualityData | undefined> {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}`
      + `&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide`;
    const res = await fetch(url, { headers: { 'User-Agent': 'SportsCast/1.0' } });
    if (!res.ok) return undefined;
    const data = await res.json();
    const c = data.current;
    const aqi = c.us_aqi ?? 0;
    const { category, description } = aqiCategory(aqi);
    return {
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
  } catch {
    return undefined;
  }
}

export async function getOpenMeteoForecast(lat: number, lon: number, days: number = 15): Promise<ForecastResponse> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure,apparent_temperature,uv_index,visibility,weather_code`
    + `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,surface_pressure,apparent_temperature,uv_index,visibility,weather_code`
    + `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,weather_code,sunrise,sunset`
    + `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=mm&forecast_days=${Math.min(days, 16)}`
    + `&timezone=auto`;

  const [res, aqData] = await Promise.all([
    fetch(url, { headers: { 'User-Agent': 'SportsCast/1.0' } }),
    fetchAirQuality(lat, lon),
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
  const curHour = parseLocalHour(cur.time);
  const curIsNight = curHour < 6 || curHour > 20;
  const curDesc = wmoCodeToDescription(cur.weather_code);

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
    visibility: Math.round((cur.visibility ?? 10000) / 1000),
    description: curDesc,
    icon: getWeatherIcon(curDesc, curIsNight),
  };

  // Build hourly forecast — filter to current hour onward
  const h = data.hourly;
  const currentHourStr = cur.time.slice(0, 13); // "2026-02-18T09"
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
    const desc = wmoCodeToDescription(h.weather_code[i]);

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
      visibility: Math.round((h.visibility[i] ?? 10000) / 1000),
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
    });
  }

  // Fill in daily humidity from hourly averages
  const dayHumidity = new Map<string, number[]>();
  for (const pt of hourly) {
    const dateKey = pt.time.slice(0, 10);
    if (!dayHumidity.has(dateKey)) dayHumidity.set(dateKey, []);
    dayHumidity.get(dateKey)!.push(pt.humidity);
  }
  for (const day of daily) {
    const humidities = dayHumidity.get(day.date);
    if (humidities && humidities.length > 0) {
      day.humidity = Math.round(humidities.reduce((a, b) => a + b, 0) / humidities.length);
    }
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
      headers: { 'User-Agent': 'SportsCast/1.0' },
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
