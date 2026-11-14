// GET /api/feeds/game-weather?league=<ncaa-football|nfl|mlb|mls>
// Public, read-only weather per upcoming game (WOW-002). See
// src/lib/game-weather-feed.ts for what it may and may not contain.
import type { APIRoute } from 'astro';
import { handleGameWeatherFeedRequest } from '../../../lib/game-weather-feed';

export const prerender = false;

export const GET: APIRoute = ({ url }) => handleGameWeatherFeedRequest(url);
