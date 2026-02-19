// US states + DC + territories + Canadian provinces
export const STATE_ABBR_TO_FULL: Record<string, string> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california',
  CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district-of-columbia',
  FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana',
  ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada',
  NH: 'new-hampshire', NJ: 'new-jersey', NM: 'new-mexico', NY: 'new-york',
  NC: 'north-carolina', ND: 'north-dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon',
  PA: 'pennsylvania', PR: 'puerto-rico', RI: 'rhode-island', SC: 'south-carolina',
  SD: 'south-dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont',
  VA: 'virginia', WA: 'washington', WV: 'west-virginia', WI: 'wisconsin', WY: 'wyoming',
  // Canadian provinces
  AB: 'alberta', BC: 'british-columbia', MB: 'manitoba', NB: 'new-brunswick',
  NL: 'newfoundland-and-labrador', NS: 'nova-scotia', NT: 'northwest-territories',
  NU: 'nunavut', ON: 'ontario', PE: 'prince-edward-island', QC: 'quebec',
  SK: 'saskatchewan', YT: 'yukon',
};

export const COUNTRY_CODE_TO_SLUG: Record<string, string> = {
  us: 'united-states',
  ca: 'canada',
  mx: 'mexico',
  gb: 'united-kingdom',
  au: 'australia',
  de: 'germany',
  fr: 'france',
  jp: 'japan',
  kr: 'south-korea',
  br: 'brazil',
};

// Reverse: slug → country code
export const COUNTRY_SLUG_TO_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTRY_CODE_TO_SLUG).map(([code, slug]) => [slug, code])
);

export function stateAbbrToSlug(abbr: string): string {
  return STATE_ABBR_TO_FULL[abbr.toUpperCase()] || abbr.toLowerCase().replace(/\s+/g, '-');
}

export function countryCodeToSlug(code: string): string {
  return COUNTRY_CODE_TO_SLUG[code.toLowerCase()] || code.toLowerCase();
}
