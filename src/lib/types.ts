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
  alerts: WeatherAlert[];
  airQuality?: AirQualityData;
  allergyData?: AllergyData;
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

// --- Solunar & Outdoor Forecast Types ---

export interface SolunarPeriod {
  start: string; // "HH:MM"
  end: string;
  type: 'major' | 'minor';
  label: string; // e.g. "Moon Overhead", "Moonrise"
}

export interface SolunarData {
  moonTransit: string;     // "HH:MM" moon highest point
  moonUnderfoot: string;   // "HH:MM" moon lowest point
  moonrise: string;
  moonset: string;
  moonPhase: string;       // e.g. "Waxing Crescent"
  phaseDay: number;        // day within synodic cycle (0-29.53)
  rating: number;          // 0-100 solunar rating
  periods: SolunarPeriod[];
}

export type FishSpecies = 'bass' | 'trout' | 'catfish' | 'crappie' | 'walleye' | 'salmon' | 'redfish' | 'mahi_mahi';

export interface FishForecast {
  species: FishSpecies;
  score: number;           // 0-100
  activityRating: 'excellent' | 'good' | 'fair' | 'poor';
  bestTimes: SolunarPeriod[];
  keyFactors: { label: string; value: string; impact: 'positive' | 'neutral' | 'negative' }[];
  tips: string[];
  inSeason: boolean;
}

export type GameSpecies = 'whitetail' | 'duck' | 'turkey' | 'elk' | 'moose' | 'mule_deer' | 'wild_boar' | 'pheasant';

export interface HuntForecast {
  species: GameSpecies;
  score: number;
  activityRating: 'excellent' | 'good' | 'fair' | 'poor';
  bestTimes: SolunarPeriod[];
  keyFactors: { label: string; value: string; impact: 'positive' | 'neutral' | 'negative' }[];
  tips: string[];
  inSeason: boolean;
}
