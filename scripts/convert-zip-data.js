#!/usr/bin/env node
/**
 * Convert "DBD zip code master list.xlsx" → src/data/us-zip-codes.json
 * Run once: node scripts/convert-zip-data.js
 */
import XLSX from 'xlsx';
const { readFile, utils } = XLSX;
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const XLSX_PATH = resolve(ROOT, 'Weather muse', 'DBD zip code master list.xlsx');
const OUT_PATH = resolve(ROOT, 'src', 'data', 'us-zip-codes.json');

// Valid US state abbreviations (50 states + DC + PR)
const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','PR','RI','SC','SD','TN','TX',
  'UT','VT','VA','WA','WV','WI','WY',
]);

console.log('Reading Excel file…');
const workbook = readFile(XLSX_PATH);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = utils.sheet_to_json(sheet);

console.log(`Raw rows: ${rows.length}`);

// Inspect first row to find column names
const sampleRow = rows[0];
console.log('Sample row keys:', Object.keys(sampleRow));
console.log('Sample row:', JSON.stringify(sampleRow));

// Map column names (flexible matching)
function findCol(row, ...candidates) {
  for (const c of candidates) {
    const key = Object.keys(row).find(k => k.toLowerCase().replace(/[^a-z]/g, '') === c.toLowerCase().replace(/[^a-z]/g, ''));
    if (key !== undefined) return key;
  }
  return null;
}

const colZip = findCol(sampleRow, 'zip', 'zipcode', 'postalcode', 'zip code');
const colCity = findCol(sampleRow, 'city', 'primarycity', 'primary city', 'townname', 'town name');
const colState = findCol(sampleRow, 'state', 'stateabbreviation', 'state abbreviation', 'stateabbr');
const colLat = findCol(sampleRow, 'lat', 'latitude');
const colLon = findCol(sampleRow, 'lon', 'lng', 'longitude');

console.log(`Columns: zip=${colZip}, city=${colCity}, state=${colState}, lat=${colLat}, lon=${colLon}`);

if (!colZip || !colCity || !colState || !colLat || !colLon) {
  console.error('Could not find all required columns!');
  process.exit(1);
}

const seen = new Set();
const entries = [];
let skipped = 0;

for (const row of rows) {
  const zip = String(row[colZip] || '').padStart(5, '0');
  const stateAbbr = String(row[colState] || '').trim().toUpperCase();
  const city = String(row[colCity] || '').trim();
  const lat = parseFloat(row[colLat]);
  const lon = parseFloat(row[colLon]);

  // Filter: must have valid state, valid zip, valid coords
  if (!VALID_STATES.has(stateAbbr)) { skipped++; continue; }
  if (!/^\d{5}$/.test(zip)) { skipped++; continue; }
  if (isNaN(lat) || isNaN(lon)) { skipped++; continue; }
  if (seen.has(zip)) { skipped++; continue; }

  seen.add(zip);
  entries.push({
    z: zip,
    c: city,
    s: stateAbbr,
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
  });
}

console.log(`Kept: ${entries.length}, Skipped: ${skipped}`);

// Sort by zip for consistency
entries.sort((a, b) => a.z.localeCompare(b.z));

writeFileSync(OUT_PATH, JSON.stringify(entries));
console.log(`Written to ${OUT_PATH} (${(Buffer.byteLength(JSON.stringify(entries)) / 1024 / 1024).toFixed(1)} MB)`);
