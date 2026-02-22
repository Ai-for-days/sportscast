export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
  state?: string;
  country?: string;
  zip?: string;
  displayName?: string;
}

export interface ForecastPoint {
  time: string;
  tempK: number;
  tempF: number;
  tempC: number;
  humidity: number;
  dewPointF: number;
  precipMm: number;
  precipProbability: number;
  windSpeedMph: number;
  windDirectionDeg: number;
  windGustMph: number;
  cloudCover: number;
  pressure: number;
  feelsLikeF: number;
  uvIndex: number;
  visibility: number;
  description: string;
  icon: string;
}


export interface WeatherAlert {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: string;
  onset: string;
  expires: string;
  senderName: string;
}

export interface ForecastResponse {
  location: GeoLocation;
  current: ForecastPoint;
  hourly: ForecastPoint[];
  daily: DailyForecast[];
  airQuality?: AirQualityData;
  allergyData?: AllergyData;
  alerts?: WeatherAlert[];
  utcOffsetSeconds: number;
  generatedAt: string;
}

export interface AirQualityData {
  aqi: number;
  pm2_5: number;
  pm10: number;
  o3: number;
  no2: number;
  so2: number;
  co: number;
  category: string;
  description: string;
}

export interface DailyForecast {
  date: string;
  highF: number;
  lowF: number;
  feelsLikeHighF: number;
  feelsLikeLowF: number;
  precipMm: number;
  precipProbability: number;
  windSpeedMph: number;
  windGustMph: number;
  humidity: number;
  uvIndexMax: number;
  sunrise: string;
  sunset: string;
  description: string;
  icon: string;
  dayDescription: string;
  nightDescription: string;
}

export interface AllergyData {
  treePollen: string;
  ragweedPollen: string;
  grassPollen: string;
  mold: string;
  dustAndDander: string;
}

export type PlayabilityRating = 'excellent' | 'good' | 'fair' | 'poor' | 'dangerous';

export type SportType = 'baseball' | 'football' | 'soccer' | 'tennis' | 'golf' | 'youth';

export interface SportsMetrics {
  playability: PlayabilityRating;
  heatIndex: number | null;
  windChill: number | null;
  precipRisk: 'none' | 'low' | 'moderate' | 'high';
  sportNotes: string[];
  recommendation: 'play' | 'monitor' | 'delay' | 'cancel';
}

export interface Venue {
  id: string;
  name: string;
  team?: string;
  sport: SportType | 'multi';
  lat: number;
  lon: number;
  city: string;
  state: string;
  capacity: number;
  type: 'outdoor' | 'indoor' | 'retractable';
  league?: string;
  conference?: string;
  division?: string;
}

export interface MapGridPoint {
  lat: number;
  lon: number;
  tempF: number;
  precipMm: number;
  windSpeedMph: number;
  windDirectionDeg: number;
}
