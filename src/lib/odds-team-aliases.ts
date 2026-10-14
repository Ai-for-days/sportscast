// Team-name aliases for matching the pushed sportsbook feed to our games (2026-10-13).
//
// THIS IS THE FILE TO EDIT when a game shows up as unmatched on
// /admin/system/odds-feed. Add one line: the feed's name on the left, any
// part of our name on the right, both in plain words (case, punctuation and
// rankings like "(#16)" are ignored). Our names are ESPN display names with
// the mascot, e.g. "Middle Tennessee Blue Raiders".
//
//   'middle tennessee state': 'middle tennessee',
//
// Most games need no alias: the matcher already accepts the feed's school
// name when our name starts with it ("Alabama" -> "Alabama Crimson Tide").
// Aliases are for names that differ in the words themselves.
//
// Keyed by league so "Miami" can mean different teams in different sports.

export const TEAM_ALIASES: Record<string, Record<string, string>> = {
  'ncaa-football': {
    'middle tennessee state': 'middle tennessee',
    'florida international': 'fiu',
    'miami florida': 'miami hurricanes',
    'miami fl': 'miami hurricanes',
    'miami ohio': 'miami oh',
    'massachusetts': 'umass',
    'louisiana lafayette': 'louisiana ragin cajuns',
    'louisiana monroe': 'ul monroe',
    'ul lafayette': 'louisiana ragin cajuns',
    'southern methodist': 'smu',
    'texas christian': 'tcu',
    'central florida': 'ucf',
    'brigham young': 'byu',
    'nevada las vegas': 'unlv',
    'texas el paso': 'utep',
    'texas san antonio': 'utsa',
    'alabama birmingham': 'uab',
    'connecticut': 'uconn',
    'mississippi': 'ole miss',
    'southern california': 'usc',
    'louisiana state': 'lsu',
    'north carolina state': 'nc state',
    'hawaii': "hawai'i",
    'san jose state': 'san josé state',
    'app state': 'appalachian state',
    'sam houston state': 'sam houston',
    'jacksonville st': 'jacksonville state',
    'kennesaw st': 'kennesaw state',
    'western kentucky': 'western kentucky',
    'florida atlantic': 'florida atlantic',
    'army': 'army black knights',
    'navy': 'navy midshipmen',
    'air force': 'air force falcons',
  },
  nfl: {
    'la rams': 'los angeles rams',
    'la chargers': 'los angeles chargers',
    'ny giants': 'new york giants',
    'ny jets': 'new york jets',
    'washington': 'washington commanders',
  },
  mlb: {
    'la dodgers': 'los angeles dodgers',
    'la angels': 'los angeles angels',
    'ny yankees': 'new york yankees',
    'ny mets': 'new york mets',
    'chi cubs': 'chicago cubs',
    'chi white sox': 'chicago white sox',
    'athletics': 'athletics',
    'oakland athletics': 'athletics',
  },
  mls: {
    'la galaxy': 'la galaxy',
    'los angeles fc': 'lafc',
    'new york red bulls': 'red bull new york',
    'ny red bulls': 'red bull new york',
    'new york city fc': 'new york city fc',
    'inter miami': 'inter miami cf',
    'dc united': 'd c united',
    'minnesota united': 'minnesota united fc',
    'st louis city': 'st louis city sc',
    'sporting kansas city': 'sporting kansas city',
    'montreal impact': 'cf montreal',
    'cf montreal': 'cf montreal',
    'kansas city current': 'kansas city current',
    'nj ny gotham': 'gotham fc',
    'gotham': 'gotham fc',
    'washington spirit': 'washington spirit',
    'north carolina courage': 'north carolina courage',
    'bay fc': 'bay fc',
  },
};
