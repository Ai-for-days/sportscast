// ── Wager Types ──────────────────────────────────────────────────────────────

export type WagerStatus = 'open' | 'locked' | 'graded' | 'void';
export type WagerKind = 'odds' | 'over-under' | 'pointspread';
export type WagerMetric = 'actual_temp' | 'high_temp' | 'low_temp' | 'precip' | 'wind_speed' | 'wind_gust';

export interface WagerLocation {
  name: string;
  lat: number;
  lon: number;
  stationId: string;
  timeZone: string;
}

// ── Outcome types per kind ───────────────────────────────────────────────────

export interface OddsOutcome {
  label: string;       // e.g. "60-62°F"
  minValue: number;
  maxValue: number;
  odds: number;        // American odds, e.g. +135 or -110
}

export interface OverUnderSide {
  odds: number;        // American odds
}

// ── Base wager fields shared by all kinds ────────────────────────────────────

interface WagerBase {
  id: string;
  title: string;
  description?: string;
  status: WagerStatus;
  metric: WagerMetric;
  targetDate: string;  // YYYY-MM-DD — the date being wagered on
  lockTime: string;    // ISO 8601 — when wager locks (no more display changes)
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  voidReason?: string;
  observedValue?: number;
  winningOutcome?: string;
}

// ── Discriminated union by kind ──────────────────────────────────────────────

export interface OddsWager extends WagerBase {
  kind: 'odds';
  location: WagerLocation;
  outcomes: OddsOutcome[];
}

export interface OverUnderWager extends WagerBase {
  kind: 'over-under';
  location: WagerLocation;
  line: number;        // e.g. 61
  over: OverUnderSide;
  under: OverUnderSide;
}

export interface PointspreadWager extends WagerBase {
  kind: 'pointspread';
  locationA: WagerLocation;
  locationB: WagerLocation;
  spread: number;      // locationA - locationB expected diff
  locationAOdds: number;
  locationBOdds: number;
  observedValueA?: number;
  observedValueB?: number;
}

export type Wager = OddsWager | OverUnderWager | PointspreadWager;

// ── NWS Observation ──────────────────────────────────────────────────────────

export interface NWSObservation {
  stationId: string;
  date: string;        // YYYY-MM-DD
  highTemp?: number;   // °F
  lowTemp?: number;    // °F
  precip?: number;     // inches
  windSpeed?: number;  // mph
  windGust?: number;   // mph
  observationCount: number;
  fetchedAt: string;   // ISO 8601
}

// ── API request/response shapes ──────────────────────────────────────────────

export interface CreateWagerInput {
  kind: WagerKind;
  title: string;
  description?: string;
  metric: WagerMetric;
  targetDate: string;
  lockTime: string;
  // odds kind
  location?: { name: string; lat: number; lon: number };
  outcomes?: Omit<OddsOutcome, never>[];
  // over-under kind
  line?: number;
  over?: OverUnderSide;
  under?: OverUnderSide;
  // pointspread kind
  locationA?: { name: string; lat: number; lon: number };
  locationB?: { name: string; lat: number; lon: number };
  spread?: number;
  locationAOdds?: number;
  locationBOdds?: number;
}

export interface WagerListResponse {
  wagers: Wager[];
  total: number;
  cursor?: string;
}
