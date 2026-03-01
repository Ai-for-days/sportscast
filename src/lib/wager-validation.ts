import type { CreateWagerInput, WagerKind, WagerMetric } from './wager-types';

const VALID_KINDS: WagerKind[] = ['odds', 'over-under', 'pointspread'];
const VALID_METRICS: WagerMetric[] = ['actual_temp', 'high_temp', 'low_temp', 'precip', 'actual_wind', 'actual_gust', 'high_of_day', 'low_of_day', 'high_plus_low'];

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isValidDate(d: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d));
}

function isValidISO(d: string): boolean {
  return !isNaN(Date.parse(d));
}

function isValidLocation(loc: unknown): loc is { name: string; lat: number; lon: number } {
  if (!loc || typeof loc !== 'object') return false;
  const l = loc as Record<string, unknown>;
  return typeof l.name === 'string' && l.name.length > 0
    && typeof l.lat === 'number' && l.lat >= -90 && l.lat <= 90
    && typeof l.lon === 'number' && l.lon >= -180 && l.lon <= 180;
}

function isValidAmericanOdds(odds: unknown): odds is number {
  if (typeof odds !== 'number') return false;
  // American odds: positive (≥100) or negative (≤-100), never between -100 and 100 exclusive
  return odds >= 100 || odds <= -100;
}

export function validateCreateWager(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'] };
  }

  const data = input as CreateWagerInput;

  // Common required fields
  if (!data.kind || !VALID_KINDS.includes(data.kind)) {
    errors.push(`kind must be one of: ${VALID_KINDS.join(', ')}`);
  }
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('title is required');
  }
  if (typeof data.title === 'string' && data.title.length > 200) {
    errors.push('title must be 200 characters or less');
  }
  if (!data.metric || !VALID_METRICS.includes(data.metric)) {
    errors.push(`metric must be one of: ${VALID_METRICS.join(', ')}`);
  }
  if (!data.targetDate || !isValidDate(data.targetDate)) {
    errors.push('targetDate must be YYYY-MM-DD');
  }
  if (!data.lockTime || !isValidISO(data.lockTime)) {
    errors.push('lockTime must be a valid ISO 8601 datetime');
  }

  // Kind-specific validation
  if (data.kind === 'odds') {
    if (!isValidLocation(data.location)) {
      errors.push('location is required with name, lat, lon');
    }
    if (!Array.isArray(data.outcomes) || data.outcomes.length < 2) {
      errors.push('odds wager requires at least 2 outcomes');
    } else {
      for (let i = 0; i < data.outcomes.length; i++) {
        const o = data.outcomes[i];
        if (!o.label || typeof o.label !== 'string') {
          errors.push(`outcomes[${i}].label is required`);
        }
        if (typeof o.minValue !== 'number') {
          errors.push(`outcomes[${i}].minValue is required`);
        }
        if (typeof o.maxValue !== 'number') {
          errors.push(`outcomes[${i}].maxValue is required`);
        }
        if (typeof o.minValue === 'number' && typeof o.maxValue === 'number' && o.minValue > o.maxValue) {
          errors.push(`outcomes[${i}].minValue must be ≤ maxValue`);
        }
        if (!isValidAmericanOdds(o.odds)) {
          errors.push(`outcomes[${i}].odds must be valid American odds (≥+100 or ≤-100)`);
        }
      }
    }
  }

  if (data.kind === 'over-under') {
    if (!isValidLocation(data.location)) {
      errors.push('location is required with name, lat, lon');
    }
    if (typeof data.line !== 'number') {
      errors.push('line is required for over-under wager');
    }
    if (!data.over || !isValidAmericanOdds(data.over.odds)) {
      errors.push('over.odds must be valid American odds');
    }
    if (!data.under || !isValidAmericanOdds(data.under.odds)) {
      errors.push('under.odds must be valid American odds');
    }
  }

  if (data.kind === 'pointspread') {
    if (!isValidLocation(data.locationA)) {
      errors.push('locationA is required with name, lat, lon');
    }
    if (!isValidLocation(data.locationB)) {
      errors.push('locationB is required with name, lat, lon');
    }
    if (typeof data.spread !== 'number') {
      errors.push('spread is required for pointspread wager');
    }
    if (!isValidAmericanOdds(data.locationAOdds)) {
      errors.push('locationAOdds must be valid American odds');
    }
    if (!isValidAmericanOdds(data.locationBOdds)) {
      errors.push('locationBOdds must be valid American odds');
    }
  }

  return { valid: errors.length === 0, errors };
}
