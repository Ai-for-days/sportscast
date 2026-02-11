export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
  state?: string;
  country?: string;
  displayName?: string;
}

export interface ForecastPoint {
  time: string;
  tempK: number;
  tempF: number;
  tempC: number;
  humidity: number;
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

export interface EnsembleMember {
  member: number;
  time: string;
  tempF: number;
  precipMm: number;
  windSpeedMph: number;
}

export interface EnsembleForecast {
  time: string;
  median: { tempF: number; precipMm: number; windSpeedMph: number };
  p10: { tempF: number; precipMm: number; windSpeedMph: number };
  p25: { tempF: number; precipMm: number; windSpeedMph: number };
  p75: { tempF: number; precipMm: number; windSpeedMph: number };
  p90: { tempF: number; precipMm: number; windSpeedMph: number };
  precipProbability: number;
}

export interface ForecastResponse {
  location: GeoLocation;
  current: ForecastPoint;
  hourly: ForecastPoint[];
  daily: DailyForecast[];
  generatedAt: string;
}

export interface DailyForecast {
  date: string;
  highF: number;
  lowF: number;
  precipMm: number;
  precipProbability: number;
  windSpeedMph: number;
  windGustMph: number;
  humidity: number;
  description: string;
  icon: string;
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
  sport: SportType | 'multi';
  lat: number;
  lon: number;
  city: string;
  state: string;
  capacity: number;
  type: 'outdoor' | 'indoor' | 'retractable';
}

export interface MapGridPoint {
  lat: number;
  lon: number;
  tempF: number;
  precipMm: number;
  windSpeedMph: number;
  windDirectionDeg: number;
}
