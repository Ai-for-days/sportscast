import type { Venue } from './types';

export const venues: Venue[] = [
  // ============================================================
  // MLB STADIUMS (30)
  // ============================================================

  // AL East
  { id: 'mlb-bal', name: 'Oriole Park at Camden Yards', team: 'Baltimore Orioles', sport: 'baseball', lat: 39.2838, lon: -76.6216, city: 'Baltimore', state: 'MD', capacity: 45971, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL East' },
  { id: 'mlb-bos', name: 'Fenway Park', team: 'Boston Red Sox', sport: 'baseball', lat: 42.3467, lon: -71.0972, city: 'Boston', state: 'MA', capacity: 37755, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL East' },
  { id: 'mlb-nyy', name: 'Yankee Stadium', team: 'New York Yankees', sport: 'baseball', lat: 40.8296, lon: -73.9262, city: 'Bronx', state: 'NY', capacity: 46537, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL East' },
  { id: 'mlb-tb', name: 'Tropicana Field', team: 'Tampa Bay Rays', sport: 'baseball', lat: 27.7682, lon: -82.6534, city: 'St. Petersburg', state: 'FL', capacity: 25000, type: 'indoor', league: 'mlb', conference: 'AL', division: 'AL East' },
  { id: 'mlb-tor', name: 'Rogers Centre', team: 'Toronto Blue Jays', sport: 'baseball', lat: 43.6414, lon: -79.3894, city: 'Toronto', state: 'ON', capacity: 49282, type: 'retractable', league: 'mlb', conference: 'AL', division: 'AL East' },

  // AL Central
  { id: 'mlb-cws', name: 'Guaranteed Rate Field', team: 'Chicago White Sox', sport: 'baseball', lat: 41.8299, lon: -87.6338, city: 'Chicago', state: 'IL', capacity: 40615, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL Central' },
  { id: 'mlb-cle', name: 'Progressive Field', team: 'Cleveland Guardians', sport: 'baseball', lat: 41.4962, lon: -81.6852, city: 'Cleveland', state: 'OH', capacity: 34788, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL Central' },
  { id: 'mlb-det', name: 'Comerica Park', team: 'Detroit Tigers', sport: 'baseball', lat: 42.3390, lon: -83.0485, city: 'Detroit', state: 'MI', capacity: 41083, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL Central' },
  { id: 'mlb-kc', name: 'Kauffman Stadium', team: 'Kansas City Royals', sport: 'baseball', lat: 39.0517, lon: -94.4803, city: 'Kansas City', state: 'MO', capacity: 37903, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL Central' },
  { id: 'mlb-min', name: 'Target Field', team: 'Minnesota Twins', sport: 'baseball', lat: 44.9818, lon: -93.2776, city: 'Minneapolis', state: 'MN', capacity: 38544, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL Central' },

  // AL West
  { id: 'mlb-hou', name: 'Minute Maid Park', team: 'Houston Astros', sport: 'baseball', lat: 29.7573, lon: -95.3555, city: 'Houston', state: 'TX', capacity: 41168, type: 'retractable', league: 'mlb', conference: 'AL', division: 'AL West' },
  { id: 'mlb-laa', name: 'Angel Stadium', team: 'Los Angeles Angels', sport: 'baseball', lat: 33.8003, lon: -117.8827, city: 'Anaheim', state: 'CA', capacity: 45517, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL West' },
  { id: 'mlb-oak', name: 'Oakland Coliseum', team: 'Oakland Athletics', sport: 'baseball', lat: 37.7516, lon: -122.2005, city: 'Oakland', state: 'CA', capacity: 46847, type: 'outdoor', league: 'mlb', conference: 'AL', division: 'AL West' },
  { id: 'mlb-sea', name: 'T-Mobile Park', team: 'Seattle Mariners', sport: 'baseball', lat: 47.5914, lon: -122.3325, city: 'Seattle', state: 'WA', capacity: 47929, type: 'retractable', league: 'mlb', conference: 'AL', division: 'AL West' },
  { id: 'mlb-tex', name: 'Globe Life Field', team: 'Texas Rangers', sport: 'baseball', lat: 32.7473, lon: -97.0845, city: 'Arlington', state: 'TX', capacity: 40300, type: 'retractable', league: 'mlb', conference: 'AL', division: 'AL West' },

  // NL East
  { id: 'mlb-atl', name: 'Truist Park', team: 'Atlanta Braves', sport: 'baseball', lat: 33.8907, lon: -84.4677, city: 'Atlanta', state: 'GA', capacity: 41084, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL East' },
  { id: 'mlb-mia', name: 'LoanDepot Park', team: 'Miami Marlins', sport: 'baseball', lat: 25.7781, lon: -80.2197, city: 'Miami', state: 'FL', capacity: 36742, type: 'retractable', league: 'mlb', conference: 'NL', division: 'NL East' },
  { id: 'mlb-nym', name: 'Citi Field', team: 'New York Mets', sport: 'baseball', lat: 40.7571, lon: -73.8458, city: 'Queens', state: 'NY', capacity: 41922, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL East' },
  { id: 'mlb-phi', name: 'Citizens Bank Park', team: 'Philadelphia Phillies', sport: 'baseball', lat: 39.9061, lon: -75.1665, city: 'Philadelphia', state: 'PA', capacity: 42792, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL East' },
  { id: 'mlb-wsh', name: 'Nationals Park', team: 'Washington Nationals', sport: 'baseball', lat: 38.8730, lon: -77.0074, city: 'Washington', state: 'DC', capacity: 41339, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL East' },

  // NL Central
  { id: 'mlb-chc', name: 'Wrigley Field', team: 'Chicago Cubs', sport: 'baseball', lat: 41.9484, lon: -87.6553, city: 'Chicago', state: 'IL', capacity: 41649, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL Central' },
  { id: 'mlb-cin', name: 'Great American Ball Park', team: 'Cincinnati Reds', sport: 'baseball', lat: 39.0974, lon: -84.5065, city: 'Cincinnati', state: 'OH', capacity: 42319, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL Central' },
  { id: 'mlb-mil', name: 'American Family Field', team: 'Milwaukee Brewers', sport: 'baseball', lat: 43.0280, lon: -87.9712, city: 'Milwaukee', state: 'WI', capacity: 41900, type: 'retractable', league: 'mlb', conference: 'NL', division: 'NL Central' },
  { id: 'mlb-pit', name: 'PNC Park', team: 'Pittsburgh Pirates', sport: 'baseball', lat: 40.4469, lon: -80.0058, city: 'Pittsburgh', state: 'PA', capacity: 38362, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL Central' },
  { id: 'mlb-stl', name: 'Busch Stadium', team: 'St. Louis Cardinals', sport: 'baseball', lat: 38.6226, lon: -90.1928, city: 'St. Louis', state: 'MO', capacity: 45494, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL Central' },

  // NL West
  { id: 'mlb-ari', name: 'Chase Field', team: 'Arizona Diamondbacks', sport: 'baseball', lat: 33.4455, lon: -112.0667, city: 'Phoenix', state: 'AZ', capacity: 48519, type: 'retractable', league: 'mlb', conference: 'NL', division: 'NL West' },
  { id: 'mlb-col', name: 'Coors Field', team: 'Colorado Rockies', sport: 'baseball', lat: 39.7559, lon: -104.9942, city: 'Denver', state: 'CO', capacity: 50144, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL West' },
  { id: 'mlb-lad', name: 'Dodger Stadium', team: 'Los Angeles Dodgers', sport: 'baseball', lat: 34.0739, lon: -118.2400, city: 'Los Angeles', state: 'CA', capacity: 56000, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL West' },
  { id: 'mlb-sd', name: 'Petco Park', team: 'San Diego Padres', sport: 'baseball', lat: 32.7076, lon: -117.1570, city: 'San Diego', state: 'CA', capacity: 40209, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL West' },
  { id: 'mlb-sf', name: 'Oracle Park', team: 'San Francisco Giants', sport: 'baseball', lat: 37.7786, lon: -122.3893, city: 'San Francisco', state: 'CA', capacity: 41265, type: 'outdoor', league: 'mlb', conference: 'NL', division: 'NL West' },

  // ============================================================
  // NFL STADIUMS (32)
  // ============================================================

  // AFC East
  { id: 'nfl-buf', name: 'Highmark Stadium', team: 'Buffalo Bills', sport: 'football', lat: 42.7738, lon: -78.7870, city: 'Orchard Park', state: 'NY', capacity: 71608, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC East' },
  { id: 'nfl-mia', name: 'Hard Rock Stadium', team: 'Miami Dolphins', sport: 'football', lat: 25.9580, lon: -80.2389, city: 'Miami Gardens', state: 'FL', capacity: 64767, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC East' },
  { id: 'nfl-ne', name: 'Gillette Stadium', team: 'New England Patriots', sport: 'football', lat: 42.0909, lon: -71.2643, city: 'Foxborough', state: 'MA', capacity: 65878, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC East' },
  { id: 'nfl-nyj', name: 'MetLife Stadium', team: 'New York Jets', sport: 'football', lat: 40.8128, lon: -74.0742, city: 'East Rutherford', state: 'NJ', capacity: 82500, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC East' },

  // AFC North
  { id: 'nfl-bal', name: 'M&T Bank Stadium', team: 'Baltimore Ravens', sport: 'football', lat: 39.2780, lon: -76.6227, city: 'Baltimore', state: 'MD', capacity: 71008, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC North' },
  { id: 'nfl-cin', name: 'Paycor Stadium', team: 'Cincinnati Bengals', sport: 'football', lat: 39.0955, lon: -84.5161, city: 'Cincinnati', state: 'OH', capacity: 65515, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC North' },
  { id: 'nfl-cle', name: 'Cleveland Browns Stadium', team: 'Cleveland Browns', sport: 'football', lat: 41.5061, lon: -81.6995, city: 'Cleveland', state: 'OH', capacity: 67431, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC North' },
  { id: 'nfl-pit', name: 'Acrisure Stadium', team: 'Pittsburgh Steelers', sport: 'football', lat: 40.4468, lon: -80.0158, city: 'Pittsburgh', state: 'PA', capacity: 68400, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC North' },

  // AFC South
  { id: 'nfl-hou', name: 'NRG Stadium', team: 'Houston Texans', sport: 'football', lat: 29.6847, lon: -95.4107, city: 'Houston', state: 'TX', capacity: 72220, type: 'retractable', league: 'nfl', conference: 'AFC', division: 'AFC South' },
  { id: 'nfl-ind', name: 'Lucas Oil Stadium', team: 'Indianapolis Colts', sport: 'football', lat: 39.7601, lon: -86.1639, city: 'Indianapolis', state: 'IN', capacity: 67000, type: 'retractable', league: 'nfl', conference: 'AFC', division: 'AFC South' },
  { id: 'nfl-jax', name: 'EverBank Stadium', team: 'Jacksonville Jaguars', sport: 'football', lat: 30.3239, lon: -81.6373, city: 'Jacksonville', state: 'FL', capacity: 67814, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC South' },
  { id: 'nfl-ten', name: 'Nissan Stadium', team: 'Tennessee Titans', sport: 'football', lat: 36.1665, lon: -86.7713, city: 'Nashville', state: 'TN', capacity: 69143, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC South' },

  // AFC West
  { id: 'nfl-den', name: 'Empower Field at Mile High', team: 'Denver Broncos', sport: 'football', lat: 39.7439, lon: -105.0201, city: 'Denver', state: 'CO', capacity: 76125, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC West' },
  { id: 'nfl-kc', name: 'GEHA Field at Arrowhead Stadium', team: 'Kansas City Chiefs', sport: 'football', lat: 39.0489, lon: -94.4839, city: 'Kansas City', state: 'MO', capacity: 76416, type: 'outdoor', league: 'nfl', conference: 'AFC', division: 'AFC West' },
  { id: 'nfl-lv', name: 'Allegiant Stadium', team: 'Las Vegas Raiders', sport: 'football', lat: 36.0908, lon: -115.1833, city: 'Las Vegas', state: 'NV', capacity: 65000, type: 'indoor', league: 'nfl', conference: 'AFC', division: 'AFC West' },
  { id: 'nfl-lac', name: 'SoFi Stadium', team: 'Los Angeles Chargers', sport: 'football', lat: 33.9535, lon: -118.3392, city: 'Inglewood', state: 'CA', capacity: 70240, type: 'indoor', league: 'nfl', conference: 'AFC', division: 'AFC West' },

  // NFC East
  { id: 'nfl-dal', name: 'AT&T Stadium', team: 'Dallas Cowboys', sport: 'football', lat: 32.7473, lon: -97.0945, city: 'Arlington', state: 'TX', capacity: 80000, type: 'retractable', league: 'nfl', conference: 'NFC', division: 'NFC East' },
  { id: 'nfl-nyg', name: 'MetLife Stadium (Giants)', team: 'New York Giants', sport: 'football', lat: 40.8128, lon: -74.0742, city: 'East Rutherford', state: 'NJ', capacity: 82500, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC East' },
  { id: 'nfl-phi', name: 'Lincoln Financial Field', team: 'Philadelphia Eagles', sport: 'football', lat: 39.9008, lon: -75.1675, city: 'Philadelphia', state: 'PA', capacity: 69176, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC East' },
  { id: 'nfl-wsh', name: 'Commanders Field', team: 'Washington Commanders', sport: 'football', lat: 38.9076, lon: -76.8645, city: 'Landover', state: 'MD', capacity: 67617, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC East' },

  // NFC North
  { id: 'nfl-chi', name: 'Soldier Field', team: 'Chicago Bears', sport: 'football', lat: 41.8623, lon: -87.6167, city: 'Chicago', state: 'IL', capacity: 61500, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC North' },
  { id: 'nfl-det', name: 'Ford Field', team: 'Detroit Lions', sport: 'football', lat: 42.3400, lon: -83.0456, city: 'Detroit', state: 'MI', capacity: 65000, type: 'indoor', league: 'nfl', conference: 'NFC', division: 'NFC North' },
  { id: 'nfl-gb', name: 'Lambeau Field', team: 'Green Bay Packers', sport: 'football', lat: 44.5013, lon: -88.0622, city: 'Green Bay', state: 'WI', capacity: 81441, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC North' },
  { id: 'nfl-min', name: 'U.S. Bank Stadium', team: 'Minnesota Vikings', sport: 'football', lat: 44.9736, lon: -93.2575, city: 'Minneapolis', state: 'MN', capacity: 66655, type: 'indoor', league: 'nfl', conference: 'NFC', division: 'NFC North' },

  // NFC South
  { id: 'nfl-atl', name: 'Mercedes-Benz Stadium', team: 'Atlanta Falcons', sport: 'football', lat: 33.7554, lon: -84.4010, city: 'Atlanta', state: 'GA', capacity: 71000, type: 'retractable', league: 'nfl', conference: 'NFC', division: 'NFC South' },
  { id: 'nfl-car', name: 'Bank of America Stadium', team: 'Carolina Panthers', sport: 'football', lat: 35.2258, lon: -80.8528, city: 'Charlotte', state: 'NC', capacity: 74867, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC South' },
  { id: 'nfl-no', name: 'Caesars Superdome', team: 'New Orleans Saints', sport: 'football', lat: 29.9511, lon: -90.0812, city: 'New Orleans', state: 'LA', capacity: 73208, type: 'indoor', league: 'nfl', conference: 'NFC', division: 'NFC South' },
  { id: 'nfl-tb', name: 'Raymond James Stadium', team: 'Tampa Bay Buccaneers', sport: 'football', lat: 27.9759, lon: -82.5033, city: 'Tampa', state: 'FL', capacity: 65618, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC South' },

  // NFC West
  { id: 'nfl-ari', name: 'State Farm Stadium', team: 'Arizona Cardinals', sport: 'football', lat: 33.5276, lon: -112.2626, city: 'Glendale', state: 'AZ', capacity: 63400, type: 'retractable', league: 'nfl', conference: 'NFC', division: 'NFC West' },
  { id: 'nfl-lar', name: 'SoFi Stadium (Rams)', team: 'Los Angeles Rams', sport: 'football', lat: 33.9535, lon: -118.3392, city: 'Inglewood', state: 'CA', capacity: 70240, type: 'indoor', league: 'nfl', conference: 'NFC', division: 'NFC West' },
  { id: 'nfl-sf', name: "Levi's Stadium", team: 'San Francisco 49ers', sport: 'football', lat: 37.4033, lon: -121.9694, city: 'Santa Clara', state: 'CA', capacity: 68500, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC West' },
  { id: 'nfl-sea', name: 'Lumen Field', team: 'Seattle Seahawks', sport: 'football', lat: 47.5952, lon: -122.3316, city: 'Seattle', state: 'WA', capacity: 68740, type: 'outdoor', league: 'nfl', conference: 'NFC', division: 'NFC West' },

  // ============================================================
  // NCAA FOOTBALL STADIUMS
  // ============================================================

  // SEC
  { id: 'ncaa-alabama', name: 'Bryant-Denny Stadium', team: 'Alabama Crimson Tide', sport: 'football', lat: 33.2084, lon: -87.5504, city: 'Tuscaloosa', state: 'AL', capacity: 100077, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-auburn', name: 'Jordan-Hare Stadium', team: 'Auburn Tigers', sport: 'football', lat: 32.6024, lon: -85.4897, city: 'Auburn', state: 'AL', capacity: 87451, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-lsu', name: 'Tiger Stadium', team: 'LSU Tigers', sport: 'football', lat: 30.4120, lon: -91.1837, city: 'Baton Rouge', state: 'LA', capacity: 102321, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-uga', name: 'Sanford Stadium', team: 'Georgia Bulldogs', sport: 'football', lat: 33.9497, lon: -83.3733, city: 'Athens', state: 'GA', capacity: 92746, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-florida', name: 'Ben Hill Griffin Stadium', team: 'Florida Gators', sport: 'football', lat: 29.6500, lon: -82.3486, city: 'Gainesville', state: 'FL', capacity: 88548, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-tamu', name: 'Kyle Field', team: 'Texas A&M Aggies', sport: 'football', lat: 30.6101, lon: -96.3404, city: 'College Station', state: 'TX', capacity: 102733, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-tennessee', name: 'Neyland Stadium', team: 'Tennessee Volunteers', sport: 'football', lat: 35.9551, lon: -83.9250, city: 'Knoxville', state: 'TN', capacity: 102455, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-ole-miss', name: 'Vaught-Hemingway Stadium', team: 'Ole Miss Rebels', sport: 'football', lat: 34.3618, lon: -89.5344, city: 'Oxford', state: 'MS', capacity: 64038, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-msst', name: 'Davis Wade Stadium', team: 'Mississippi State Bulldogs', sport: 'football', lat: 33.4559, lon: -88.7932, city: 'Starkville', state: 'MS', capacity: 61337, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-arkansas', name: 'Donald W. Reynolds Razorback Stadium', team: 'Arkansas Razorbacks', sport: 'football', lat: 36.0679, lon: -94.1790, city: 'Fayetteville', state: 'AR', capacity: 76412, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-southcar', name: 'Williams-Brice Stadium', team: 'South Carolina Gamecocks', sport: 'football', lat: 33.9727, lon: -81.0194, city: 'Columbia', state: 'SC', capacity: 77559, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-missouri', name: 'Faurot Field at Memorial Stadium', team: 'Missouri Tigers', sport: 'football', lat: 38.9365, lon: -92.3331, city: 'Columbia', state: 'MO', capacity: 62621, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-kentucky', name: 'Kroger Field', team: 'Kentucky Wildcats', sport: 'football', lat: 38.0223, lon: -84.5053, city: 'Lexington', state: 'KY', capacity: 61000, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-vanderbilt', name: 'FirstBank Stadium', team: 'Vanderbilt Commodores', sport: 'football', lat: 36.1443, lon: -86.8094, city: 'Nashville', state: 'TN', capacity: 40350, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC East' },
  { id: 'ncaa-texas', name: 'Darrell K Royal-Texas Memorial Stadium', team: 'Texas Longhorns', sport: 'football', lat: 30.2836, lon: -97.7325, city: 'Austin', state: 'TX', capacity: 100119, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },
  { id: 'ncaa-oklahoma', name: 'Gaylord Family Oklahoma Memorial Stadium', team: 'Oklahoma Sooners', sport: 'football', lat: 35.2058, lon: -97.4423, city: 'Norman', state: 'OK', capacity: 80126, type: 'outdoor', league: 'ncaa-football', conference: 'SEC', division: 'SEC West' },

  // Big Ten
  { id: 'ncaa-michigan', name: 'Michigan Stadium', team: 'Michigan Wolverines', sport: 'football', lat: 42.2658, lon: -83.7486, city: 'Ann Arbor', state: 'MI', capacity: 107601, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-osu', name: 'Ohio Stadium', team: 'Ohio State Buckeyes', sport: 'football', lat: 40.0017, lon: -83.0196, city: 'Columbus', state: 'OH', capacity: 102780, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-psu', name: 'Beaver Stadium', team: 'Penn State Nittany Lions', sport: 'football', lat: 40.8122, lon: -77.8561, city: 'State College', state: 'PA', capacity: 106572, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-wisconsin', name: 'Camp Randall Stadium', team: 'Wisconsin Badgers', sport: 'football', lat: 43.0700, lon: -89.4128, city: 'Madison', state: 'WI', capacity: 80321, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-iowa', name: 'Kinnick Stadium', team: 'Iowa Hawkeyes', sport: 'football', lat: 41.6589, lon: -91.5509, city: 'Iowa City', state: 'IA', capacity: 69250, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-nebraska', name: 'Memorial Stadium', team: 'Nebraska Cornhuskers', sport: 'football', lat: 40.8206, lon: -96.7056, city: 'Lincoln', state: 'NE', capacity: 85458, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-msu', name: 'Spartan Stadium', team: 'Michigan State Spartans', sport: 'football', lat: 42.7284, lon: -84.4821, city: 'East Lansing', state: 'MI', capacity: 75005, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-minn', name: 'Huntington Bank Stadium', team: 'Minnesota Golden Gophers', sport: 'football', lat: 44.9764, lon: -93.2248, city: 'Minneapolis', state: 'MN', capacity: 50805, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-usc', name: 'Los Angeles Memorial Coliseum', team: 'USC Trojans', sport: 'football', lat: 34.0141, lon: -118.2879, city: 'Los Angeles', state: 'CA', capacity: 77500, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-ucla', name: 'Rose Bowl', team: 'UCLA Bruins', sport: 'football', lat: 34.1613, lon: -118.1676, city: 'Pasadena', state: 'CA', capacity: 88565, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-oregon', name: 'Autzen Stadium', team: 'Oregon Ducks', sport: 'football', lat: 44.0584, lon: -123.0680, city: 'Eugene', state: 'OR', capacity: 54000, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-wash', name: 'Husky Stadium', team: 'Washington Huskies', sport: 'football', lat: 47.6505, lon: -122.3017, city: 'Seattle', state: 'WA', capacity: 70083, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-indiana', name: 'Memorial Stadium (Indiana)', team: 'Indiana Hoosiers', sport: 'football', lat: 39.1806, lon: -86.5259, city: 'Bloomington', state: 'IN', capacity: 52929, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-purdue', name: 'Ross-Ade Stadium', team: 'Purdue Boilermakers', sport: 'football', lat: 40.4319, lon: -86.9189, city: 'West Lafayette', state: 'IN', capacity: 57236, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-northwestern', name: 'Ryan Field', team: 'Northwestern Wildcats', sport: 'football', lat: 42.0654, lon: -87.6991, city: 'Evanston', state: 'IL', capacity: 47130, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },
  { id: 'ncaa-maryland', name: 'SECU Stadium', team: 'Maryland Terrapins', sport: 'football', lat: 38.9910, lon: -76.9484, city: 'College Park', state: 'MD', capacity: 51802, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-rutgers', name: 'SHI Stadium', team: 'Rutgers Scarlet Knights', sport: 'football', lat: 40.5138, lon: -74.4653, city: 'Piscataway', state: 'NJ', capacity: 52454, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten East' },
  { id: 'ncaa-illinois', name: 'Memorial Stadium (Illinois)', team: 'Illinois Fighting Illini', sport: 'football', lat: 40.0993, lon: -88.2361, city: 'Champaign', state: 'IL', capacity: 60670, type: 'outdoor', league: 'ncaa-football', conference: 'Big Ten', division: 'Big Ten West' },

  // ACC
  { id: 'ncaa-clemson', name: 'Memorial Stadium (Clemson)', team: 'Clemson Tigers', sport: 'football', lat: 34.6784, lon: -82.8434, city: 'Clemson', state: 'SC', capacity: 81500, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-fsu', name: 'Doak Campbell Stadium', team: 'Florida State Seminoles', sport: 'football', lat: 30.4384, lon: -84.3045, city: 'Tallahassee', state: 'FL', capacity: 79560, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-notredame', name: 'Notre Dame Stadium', team: 'Notre Dame Fighting Irish', sport: 'football', lat: 41.6985, lon: -86.2340, city: 'Notre Dame', state: 'IN', capacity: 77622, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC' },
  { id: 'ncaa-vt', name: 'Lane Stadium', team: 'Virginia Tech Hokies', sport: 'football', lat: 37.2200, lon: -80.4181, city: 'Blacksburg', state: 'VA', capacity: 66233, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-ncstate', name: 'Carter-Finley Stadium', team: 'NC State Wolfpack', sport: 'football', lat: 35.8030, lon: -78.7117, city: 'Raleigh', state: 'NC', capacity: 57583, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-miami', name: 'Hard Rock Stadium (Miami)', team: 'Miami Hurricanes', sport: 'football', lat: 25.9580, lon: -80.2389, city: 'Miami Gardens', state: 'FL', capacity: 64767, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-unc', name: 'Kenan Memorial Stadium', team: 'North Carolina Tar Heels', sport: 'football', lat: 35.9049, lon: -79.0471, city: 'Chapel Hill', state: 'NC', capacity: 50500, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-duke', name: 'Wallace Wade Stadium', team: 'Duke Blue Devils', sport: 'football', lat: 36.0016, lon: -78.9427, city: 'Durham', state: 'NC', capacity: 40004, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-wakeforest', name: 'Allegacy Federal Credit Union Stadium', team: 'Wake Forest Demon Deacons', sport: 'football', lat: 36.1310, lon: -80.2575, city: 'Winston-Salem', state: 'NC', capacity: 31500, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-virginia', name: 'Scott Stadium', team: 'Virginia Cavaliers', sport: 'football', lat: 38.0314, lon: -78.5131, city: 'Charlottesville', state: 'VA', capacity: 61500, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-louisville', name: 'L&N Federal Credit Union Stadium', team: 'Louisville Cardinals', sport: 'football', lat: 38.2126, lon: -85.7587, city: 'Louisville', state: 'KY', capacity: 60000, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-pitt', name: 'Acrisure Stadium (Pitt)', team: 'Pittsburgh Panthers', sport: 'football', lat: 40.4468, lon: -80.0158, city: 'Pittsburgh', state: 'PA', capacity: 68400, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-syracuse', name: 'JMA Wireless Dome', team: 'Syracuse Orange', sport: 'football', lat: 43.0360, lon: -76.1363, city: 'Syracuse', state: 'NY', capacity: 49262, type: 'indoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-bc', name: 'Alumni Stadium', team: 'Boston College Eagles', sport: 'football', lat: 42.3356, lon: -71.1663, city: 'Chestnut Hill', state: 'MA', capacity: 44500, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Atlantic' },
  { id: 'ncaa-gatech', name: 'Bobby Dodd Stadium', team: 'Georgia Tech Yellow Jackets', sport: 'football', lat: 33.7724, lon: -84.3927, city: 'Atlanta', state: 'GA', capacity: 55000, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC Coastal' },
  { id: 'ncaa-smu', name: 'Gerald J. Ford Stadium', team: 'SMU Mustangs', sport: 'football', lat: 32.8363, lon: -96.7831, city: 'Dallas', state: 'TX', capacity: 32000, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC' },
  { id: 'ncaa-cal', name: 'California Memorial Stadium', team: 'California Golden Bears', sport: 'football', lat: 37.8709, lon: -122.2506, city: 'Berkeley', state: 'CA', capacity: 63186, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC' },
  { id: 'ncaa-stanford', name: 'Stanford Stadium', team: 'Stanford Cardinal', sport: 'football', lat: 37.4346, lon: -122.1609, city: 'Stanford', state: 'CA', capacity: 50424, type: 'outdoor', league: 'ncaa-football', conference: 'ACC', division: 'ACC' },

  // Big 12
  { id: 'ncaa-byu', name: 'LaVell Edwards Stadium', team: 'BYU Cougars', sport: 'football', lat: 40.2573, lon: -111.6546, city: 'Provo', state: 'UT', capacity: 63470, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-tcu', name: 'Amon G. Carter Stadium', team: 'TCU Horned Frogs', sport: 'football', lat: 32.7098, lon: -97.3684, city: 'Fort Worth', state: 'TX', capacity: 47000, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-kstate', name: 'Bill Snyder Family Stadium', team: 'Kansas State Wildcats', sport: 'football', lat: 39.2013, lon: -96.5937, city: 'Manhattan', state: 'KS', capacity: 50000, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-wvu', name: 'Milan Puskar Stadium', team: 'West Virginia Mountaineers', sport: 'football', lat: 39.6500, lon: -79.9551, city: 'Morgantown', state: 'WV', capacity: 60000, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-okstate', name: 'Boone Pickens Stadium', team: 'Oklahoma State Cowboys', sport: 'football', lat: 36.1260, lon: -97.0661, city: 'Stillwater', state: 'OK', capacity: 55509, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-ucf', name: 'FBC Mortgage Stadium', team: 'UCF Knights', sport: 'football', lat: 28.6078, lon: -81.1918, city: 'Orlando', state: 'FL', capacity: 44206, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-cincinnati', name: 'Nippert Stadium', team: 'Cincinnati Bearcats', sport: 'football', lat: 39.1315, lon: -84.5164, city: 'Cincinnati', state: 'OH', capacity: 40000, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-houston', name: 'TDECU Stadium', team: 'Houston Cougars', sport: 'football', lat: 29.7215, lon: -95.3517, city: 'Houston', state: 'TX', capacity: 40000, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-iowa-state', name: 'Jack Trice Stadium', team: 'Iowa State Cyclones', sport: 'football', lat: 42.0140, lon: -93.6356, city: 'Ames', state: 'IA', capacity: 61500, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-baylor', name: 'McLane Stadium', team: 'Baylor Bears', sport: 'football', lat: 31.5586, lon: -97.1153, city: 'Waco', state: 'TX', capacity: 45140, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-texastech', name: 'Jones AT&T Stadium', team: 'Texas Tech Red Raiders', sport: 'football', lat: 33.5907, lon: -101.8723, city: 'Lubbock', state: 'TX', capacity: 60454, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-kansas', name: 'David Booth Kansas Memorial Stadium', team: 'Kansas Jayhawks', sport: 'football', lat: 38.9584, lon: -95.2524, city: 'Lawrence', state: 'KS', capacity: 47233, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-arizona', name: 'Arizona Stadium', team: 'Arizona Wildcats', sport: 'football', lat: 32.2285, lon: -110.9488, city: 'Tucson', state: 'AZ', capacity: 50782, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-arizonast', name: 'Mountain America Stadium', team: 'Arizona State Sun Devils', sport: 'football', lat: 33.4264, lon: -111.9325, city: 'Tempe', state: 'AZ', capacity: 53599, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-colorado', name: 'Folsom Field', team: 'Colorado Buffaloes', sport: 'football', lat: 40.0092, lon: -105.2669, city: 'Boulder', state: 'CO', capacity: 50183, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },
  { id: 'ncaa-utah', name: 'Rice-Eccles Stadium', team: 'Utah Utes', sport: 'football', lat: 40.7600, lon: -111.8488, city: 'Salt Lake City', state: 'UT', capacity: 51444, type: 'outdoor', league: 'ncaa-football', conference: 'Big 12', division: 'Big 12' },

  // AAC
  { id: 'ncaa-memphis', name: 'Simmons Bank Liberty Stadium', team: 'Memphis Tigers', sport: 'football', lat: 35.0199, lon: -89.9689, city: 'Memphis', state: 'TN', capacity: 58325, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-tulane', name: 'Yulman Stadium', team: 'Tulane Green Wave', sport: 'football', lat: 29.9437, lon: -90.1190, city: 'New Orleans', state: 'LA', capacity: 30000, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-utsa', name: 'Alamodome', team: 'UTSA Roadrunners', sport: 'football', lat: 29.4168, lon: -98.4781, city: 'San Antonio', state: 'TX', capacity: 64000, type: 'indoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-smu-dallas', name: 'Gerald J. Ford Stadium (AAC)', team: 'SMU Mustangs', sport: 'football', lat: 32.8363, lon: -96.7831, city: 'Dallas', state: 'TX', capacity: 32000, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-tulsa', name: 'Skelly Field at H.A. Chapman Stadium', team: 'Tulsa Golden Hurricane', sport: 'football', lat: 36.1517, lon: -95.9462, city: 'Tulsa', state: 'OK', capacity: 30000, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-usf', name: 'Raymond James Stadium (USF)', team: 'USF Bulls', sport: 'football', lat: 27.9759, lon: -82.5033, city: 'Tampa', state: 'FL', capacity: 65618, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-navy-aac', name: 'Navy-Marine Corps Memorial Stadium', team: 'Navy Midshipmen', sport: 'football', lat: 38.9907, lon: -76.4876, city: 'Annapolis', state: 'MD', capacity: 34000, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-ecu', name: 'Dowdy-Ficklen Stadium', team: 'East Carolina Pirates', sport: 'football', lat: 35.6010, lon: -77.3659, city: 'Greenville', state: 'NC', capacity: 50000, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },
  { id: 'ncaa-temple', name: 'Lincoln Financial Field (Temple)', team: 'Temple Owls', sport: 'football', lat: 39.9008, lon: -75.1675, city: 'Philadelphia', state: 'PA', capacity: 69176, type: 'outdoor', league: 'ncaa-football', conference: 'AAC', division: 'AAC' },

  // Sun Belt
  { id: 'ncaa-appstate', name: 'Kidd Brewer Stadium', team: 'Appalachian State Mountaineers', sport: 'football', lat: 36.2135, lon: -81.6854, city: 'Boone', state: 'NC', capacity: 30000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt East' },
  { id: 'ncaa-coastcar', name: 'Brooks Stadium', team: 'Coastal Carolina Chanticleers', sport: 'football', lat: 33.7959, lon: -79.0172, city: 'Conway', state: 'SC', capacity: 21000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt East' },
  { id: 'ncaa-marshall', name: 'Joan C. Edwards Stadium', team: 'Marshall Thundering Herd', sport: 'football', lat: 38.4228, lon: -82.4277, city: 'Huntington', state: 'WV', capacity: 38019, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt East' },
  { id: 'ncaa-jmu', name: 'Bridgeforth Stadium', team: 'James Madison Dukes', sport: 'football', lat: 38.4373, lon: -78.8735, city: 'Harrisonburg', state: 'VA', capacity: 25000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt East' },
  { id: 'ncaa-georgia-south', name: 'Paulson Stadium', team: 'Georgia Southern Eagles', sport: 'football', lat: 32.4222, lon: -81.7848, city: 'Statesboro', state: 'GA', capacity: 25000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt East' },
  { id: 'ncaa-troy', name: 'Veterans Memorial Stadium', team: 'Troy Trojans', sport: 'football', lat: 31.7968, lon: -85.9605, city: 'Troy', state: 'AL', capacity: 30000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt West' },
  { id: 'ncaa-ull', name: 'Cajun Field', team: 'Louisiana Ragin\' Cajuns', sport: 'football', lat: 30.2134, lon: -92.0208, city: 'Lafayette', state: 'LA', capacity: 41426, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt West' },
  { id: 'ncaa-txstate', name: 'Bobcat Stadium', team: 'Texas State Bobcats', sport: 'football', lat: 29.8894, lon: -97.9400, city: 'San Marcos', state: 'TX', capacity: 30000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt West' },
  { id: 'ncaa-arkstate', name: 'Centennial Bank Stadium', team: 'Arkansas State Red Wolves', sport: 'football', lat: 35.8406, lon: -90.6829, city: 'Jonesboro', state: 'AR', capacity: 30406, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt West' },
  { id: 'ncaa-ulm', name: 'Malone Stadium', team: 'ULM Warhawks', sport: 'football', lat: 32.5264, lon: -92.0779, city: 'Monroe', state: 'LA', capacity: 30427, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt West' },
  { id: 'ncaa-southern-miss', name: 'M.M. Roberts Stadium', team: 'Southern Miss Golden Eagles', sport: 'football', lat: 31.3281, lon: -89.3355, city: 'Hattiesburg', state: 'MS', capacity: 36000, type: 'outdoor', league: 'ncaa-football', conference: 'Sun Belt', division: 'Sun Belt West' },

  // Mountain West
  { id: 'ncaa-boise', name: 'Albertsons Stadium', team: 'Boise State Broncos', sport: 'football', lat: 43.6026, lon: -116.1955, city: 'Boise', state: 'ID', capacity: 36387, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW Mountain' },
  { id: 'ncaa-colorado-st', name: 'Canvas Stadium', team: 'Colorado State Rams', sport: 'football', lat: 40.5762, lon: -105.0848, city: 'Fort Collins', state: 'CO', capacity: 36500, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW Mountain' },
  { id: 'ncaa-wyoming', name: 'War Memorial Stadium', team: 'Wyoming Cowboys', sport: 'football', lat: 41.3143, lon: -105.5671, city: 'Laramie', state: 'WY', capacity: 29181, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW Mountain' },
  { id: 'ncaa-airforce', name: 'Falcon Stadium', team: 'Air Force Falcons', sport: 'football', lat: 38.9981, lon: -104.8440, city: 'USAF Academy', state: 'CO', capacity: 46692, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW Mountain' },
  { id: 'ncaa-newmexico', name: 'University Stadium', team: 'New Mexico Lobos', sport: 'football', lat: 35.0629, lon: -106.6250, city: 'Albuquerque', state: 'NM', capacity: 39224, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW Mountain' },
  { id: 'ncaa-utah-st', name: 'Maverik Stadium', team: 'Utah State Aggies', sport: 'football', lat: 41.7511, lon: -111.8128, city: 'Logan', state: 'UT', capacity: 25100, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW Mountain' },
  { id: 'ncaa-sdsu', name: 'Snapdragon Stadium (SDSU)', team: 'San Diego State Aztecs', sport: 'football', lat: 32.7829, lon: -117.1198, city: 'San Diego', state: 'CA', capacity: 35000, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW West' },
  { id: 'ncaa-fresno-st', name: 'Valley Children\'s Stadium', team: 'Fresno State Bulldogs', sport: 'football', lat: 36.8143, lon: -119.7532, city: 'Fresno', state: 'CA', capacity: 40727, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW West' },
  { id: 'ncaa-sjsu', name: 'CEFCU Stadium', team: 'San Jose State Spartans', sport: 'football', lat: 37.3199, lon: -121.8663, city: 'San Jose', state: 'CA', capacity: 30456, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW West' },
  { id: 'ncaa-unlv', name: 'Allegiant Stadium (UNLV)', team: 'UNLV Rebels', sport: 'football', lat: 36.0908, lon: -115.1833, city: 'Las Vegas', state: 'NV', capacity: 65000, type: 'indoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW West' },
  { id: 'ncaa-hawaii', name: 'Clarence T.C. Ching Athletics Complex', team: 'Hawaii Rainbow Warriors', sport: 'football', lat: 21.2996, lon: -157.8175, city: 'Honolulu', state: 'HI', capacity: 9000, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW West' },
  { id: 'ncaa-nevada', name: 'Mackay Stadium', team: 'Nevada Wolf Pack', sport: 'football', lat: 39.5455, lon: -119.8139, city: 'Reno', state: 'NV', capacity: 30000, type: 'outdoor', league: 'ncaa-football', conference: 'Mountain West', division: 'MW West' },

  // C-USA
  { id: 'ncaa-liberty', name: 'Williams Stadium', team: 'Liberty Flames', sport: 'football', lat: 37.3531, lon: -79.1764, city: 'Lynchburg', state: 'VA', capacity: 25000, type: 'outdoor', league: 'ncaa-football', conference: 'C-USA', division: 'C-USA' },
  { id: 'ncaa-samhouston', name: 'Bowers Stadium', team: 'Sam Houston Bearkats', sport: 'football', lat: 30.7150, lon: -95.5431, city: 'Huntsville', state: 'TX', capacity: 14000, type: 'outdoor', league: 'ncaa-football', conference: 'C-USA', division: 'C-USA' },
  { id: 'ncaa-wku', name: 'Houchens-Smith Stadium', team: 'Western Kentucky Hilltoppers', sport: 'football', lat: 36.9868, lon: -86.4596, city: 'Bowling Green', state: 'KY', capacity: 22113, type: 'outdoor', league: 'ncaa-football', conference: 'C-USA', division: 'C-USA' },
  { id: 'ncaa-latech', name: 'Joe Aillet Stadium', team: 'Louisiana Tech Bulldogs', sport: 'football', lat: 32.5336, lon: -92.6516, city: 'Ruston', state: 'LA', capacity: 28000, type: 'outdoor', league: 'ncaa-football', conference: 'C-USA', division: 'C-USA' },
  { id: 'ncaa-mtsu', name: 'Floyd Stadium', team: 'Middle Tennessee Blue Raiders', sport: 'football', lat: 35.8510, lon: -86.3734, city: 'Murfreesboro', state: 'TN', capacity: 30788, type: 'outdoor', league: 'ncaa-football', conference: 'C-USA', division: 'C-USA' },
  { id: 'ncaa-fiu', name: 'Pitbull Stadium', team: 'FIU Panthers', sport: 'football', lat: 25.7553, lon: -80.3738, city: 'Miami', state: 'FL', capacity: 20000, type: 'outdoor', league: 'ncaa-football', conference: 'C-USA', division: 'C-USA' },

  // Independents & Other
  { id: 'ncaa-usma', name: 'Michie Stadium', team: 'Army Black Knights', sport: 'football', lat: 41.3889, lon: -73.9653, city: 'West Point', state: 'NY', capacity: 38000, type: 'outdoor', league: 'ncaa-football', conference: 'Independent', division: 'Independent' },
  { id: 'ncaa-uconn', name: 'Rentschler Field', team: 'UConn Huskies', sport: 'football', lat: 41.7585, lon: -72.7313, city: 'East Hartford', state: 'CT', capacity: 40000, type: 'outdoor', league: 'ncaa-football', conference: 'Independent', division: 'Independent' },
  { id: 'ncaa-umass', name: 'Warren McGuirk Alumni Stadium', team: 'UMass Minutemen', sport: 'football', lat: 42.3876, lon: -72.5256, city: 'Amherst', state: 'MA', capacity: 17000, type: 'outdoor', league: 'ncaa-football', conference: 'Independent', division: 'Independent' },

  // ============================================================
  // MLS STADIUMS
  // ============================================================

  { id: 'mls-atl', name: 'Mercedes-Benz Stadium (Atlanta United)', team: 'Atlanta United FC', sport: 'soccer', lat: 33.7554, lon: -84.4010, city: 'Atlanta', state: 'GA', capacity: 42500, type: 'retractable', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-lafc', name: 'BMO Stadium', team: 'Los Angeles FC', sport: 'soccer', lat: 34.0128, lon: -118.2843, city: 'Los Angeles', state: 'CA', capacity: 22000, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-lag', name: 'Dignity Health Sports Park', team: 'LA Galaxy', sport: 'soccer', lat: 33.8644, lon: -118.2611, city: 'Carson', state: 'CA', capacity: 27000, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-sea', name: 'Lumen Field (Sounders)', team: 'Seattle Sounders FC', sport: 'soccer', lat: 47.5952, lon: -122.3316, city: 'Seattle', state: 'WA', capacity: 37722, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-por', name: 'Providence Park', team: 'Portland Timbers', sport: 'soccer', lat: 45.5215, lon: -122.6916, city: 'Portland', state: 'OR', capacity: 25218, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-cin', name: 'TQL Stadium', team: 'FC Cincinnati', sport: 'soccer', lat: 39.1114, lon: -84.5218, city: 'Cincinnati', state: 'OH', capacity: 26000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-nash', name: 'Geodis Park', team: 'Nashville SC', sport: 'soccer', lat: 36.1306, lon: -86.7661, city: 'Nashville', state: 'TN', capacity: 30000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-cbus', name: 'Lower.com Field', team: 'Columbus Crew', sport: 'soccer', lat: 39.9685, lon: -83.0170, city: 'Columbus', state: 'OH', capacity: 20371, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-nyc', name: 'Yankee Stadium (NYCFC)', team: 'New York City FC', sport: 'soccer', lat: 40.8296, lon: -73.9262, city: 'Bronx', state: 'NY', capacity: 30321, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-nyrb', name: 'Red Bull Arena', team: 'New York Red Bulls', sport: 'soccer', lat: 40.7368, lon: -74.1503, city: 'Harrison', state: 'NJ', capacity: 25000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-phi', name: 'Subaru Park', team: 'Philadelphia Union', sport: 'soccer', lat: 39.8328, lon: -75.3788, city: 'Chester', state: 'PA', capacity: 18500, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-dc', name: 'Audi Field', team: 'D.C. United', sport: 'soccer', lat: 38.8686, lon: -77.0128, city: 'Washington', state: 'DC', capacity: 20000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-chi', name: 'Soldier Field (Fire)', team: 'Chicago Fire FC', sport: 'soccer', lat: 41.8623, lon: -87.6167, city: 'Chicago', state: 'IL', capacity: 20000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-min', name: 'Allianz Field', team: 'Minnesota United FC', sport: 'soccer', lat: 44.9531, lon: -93.1653, city: 'St. Paul', state: 'MN', capacity: 19400, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-hou', name: 'Shell Energy Stadium', team: 'Houston Dynamo FC', sport: 'soccer', lat: 29.7522, lon: -95.3524, city: 'Houston', state: 'TX', capacity: 22039, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-dal', name: 'Toyota Stadium', team: 'FC Dallas', sport: 'soccer', lat: 33.1543, lon: -96.8353, city: 'Frisco', state: 'TX', capacity: 20500, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-kc', name: "Children's Mercy Park", team: 'Sporting Kansas City', sport: 'soccer', lat: 38.8832, lon: -94.8213, city: 'Kansas City', state: 'KS', capacity: 18467, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-slc', name: 'America First Field', team: 'Real Salt Lake', sport: 'soccer', lat: 40.5830, lon: -111.8933, city: 'Sandy', state: 'UT', capacity: 20213, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-col', name: "Dick's Sporting Goods Park", team: 'Colorado Rapids', sport: 'soccer', lat: 39.8056, lon: -104.8919, city: 'Commerce City', state: 'CO', capacity: 18061, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-sj', name: 'PayPal Park', team: 'San Jose Earthquakes', sport: 'soccer', lat: 37.3517, lon: -121.9250, city: 'San Jose', state: 'CA', capacity: 18000, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-orl', name: 'Exploria Stadium', team: 'Orlando City SC', sport: 'soccer', lat: 28.5411, lon: -81.3892, city: 'Orlando', state: 'FL', capacity: 25500, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-ne', name: 'Gillette Stadium (Revolution)', team: 'New England Revolution', sport: 'soccer', lat: 42.0909, lon: -71.2643, city: 'Foxborough', state: 'MA', capacity: 20000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-mia', name: 'Chase Stadium', team: 'Inter Miami CF', sport: 'soccer', lat: 25.9579, lon: -80.1679, city: 'Fort Lauderdale', state: 'FL', capacity: 21550, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-austin', name: 'Q2 Stadium', team: 'Austin FC', sport: 'soccer', lat: 30.3878, lon: -97.7195, city: 'Austin', state: 'TX', capacity: 20738, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-char', name: 'Bank of America Stadium (Charlotte FC)', team: 'Charlotte FC', sport: 'soccer', lat: 35.2258, lon: -80.8528, city: 'Charlotte', state: 'NC', capacity: 38000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-stl', name: 'CityPark', team: 'St. Louis City SC', sport: 'soccer', lat: 38.6310, lon: -90.2108, city: 'St. Louis', state: 'MO', capacity: 22500, type: 'outdoor', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-van', name: 'BC Place', team: 'Vancouver Whitecaps FC', sport: 'soccer', lat: 49.2768, lon: -123.1118, city: 'Vancouver', state: 'BC', capacity: 22120, type: 'retractable', league: 'mls', conference: 'Western', division: 'Western' },
  { id: 'mls-tor', name: 'BMO Field', team: 'Toronto FC', sport: 'soccer', lat: 43.6332, lon: -79.4186, city: 'Toronto', state: 'ON', capacity: 30000, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },
  { id: 'mls-mtl', name: 'Saputo Stadium', team: 'CF Montréal', sport: 'soccer', lat: 45.5620, lon: -73.5525, city: 'Montreal', state: 'QC', capacity: 19619, type: 'outdoor', league: 'mls', conference: 'Eastern', division: 'Eastern' },

  // NWSL / International venues
  { id: 'nwsl-wave', name: 'Snapdragon Stadium', team: 'San Diego Wave FC', sport: 'soccer', lat: 32.7829, lon: -117.1198, city: 'San Diego', state: 'CA', capacity: 35000, type: 'outdoor', league: 'mls', conference: 'Other', division: 'NWSL' },
  { id: 'nwsl-courage', name: 'WakeMed Soccer Park', team: 'North Carolina Courage', sport: 'soccer', lat: 35.8479, lon: -78.7232, city: 'Cary', state: 'NC', capacity: 10000, type: 'outdoor', league: 'mls', conference: 'Other', division: 'NWSL' },
  { id: 'soccer-rose-bowl', name: 'Rose Bowl (Soccer)', sport: 'soccer', lat: 34.1613, lon: -118.1676, city: 'Pasadena', state: 'CA', capacity: 88565, type: 'outdoor', league: 'mls', conference: 'Other', division: 'International' },
  { id: 'soccer-metlife', name: 'MetLife Stadium (FIFA)', sport: 'soccer', lat: 40.8128, lon: -74.0742, city: 'East Rutherford', state: 'NJ', capacity: 82500, type: 'outdoor', league: 'mls', conference: 'Other', division: 'International' },

  // ============================================================
  // COMMUNITY / MUNICIPAL FIELDS
  // ============================================================

  { id: 'comm-kino-az', name: 'Kino Sports Complex', sport: 'multi', lat: 32.1765, lon: -110.9275, city: 'Tucson', state: 'AZ', capacity: 11000, type: 'outdoor', league: 'community' },
  { id: 'comm-maryland-sp', name: 'Maryland SoccerPlex', sport: 'soccer', lat: 39.1292, lon: -77.3964, city: 'Boyds', state: 'MD', capacity: 4000, type: 'outdoor', league: 'community' },
  { id: 'comm-toyota-park-az', name: 'Toyota Soccer Center', sport: 'soccer', lat: 33.5243, lon: -112.1133, city: 'Phoenix', state: 'AZ', capacity: 3000, type: 'outdoor', league: 'community' },
  { id: 'comm-overland-park', name: 'Overland Park Soccer Complex', sport: 'soccer', lat: 38.8824, lon: -94.6716, city: 'Overland Park', state: 'KS', capacity: 6000, type: 'outdoor', league: 'community' },
  { id: 'comm-mike-rose', name: 'Mike Rose Soccer Complex', sport: 'soccer', lat: 35.1195, lon: -89.8949, city: 'Memphis', state: 'TN', capacity: 5000, type: 'outdoor', league: 'community' },
  { id: 'comm-grand-park', name: 'Grand Park Sports Campus', sport: 'multi', lat: 40.0537, lon: -86.0172, city: 'Westfield', state: 'IN', capacity: 5000, type: 'outdoor', league: 'community' },
  { id: 'comm-toyota-sc-frisco', name: 'Toyota Soccer Center (Frisco)', sport: 'soccer', lat: 33.1493, lon: -96.8227, city: 'Frisco', state: 'TX', capacity: 4000, type: 'outdoor', league: 'community' },
  { id: 'comm-bb-sportsplex', name: 'Virginia Beach Sportsplex', sport: 'multi', lat: 36.8340, lon: -76.0730, city: 'Virginia Beach', state: 'VA', capacity: 6500, type: 'outdoor', league: 'community' },
  { id: 'comm-monmouth-park', name: 'Monmouth Park Sports Complex', sport: 'multi', lat: 40.3190, lon: -74.0098, city: 'Oceanport', state: 'NJ', capacity: 3000, type: 'outdoor', league: 'community' },
  { id: 'comm-starfire', name: 'Starfire Sports Complex', sport: 'soccer', lat: 47.4586, lon: -122.2587, city: 'Tukwila', state: 'WA', capacity: 4000, type: 'outdoor', league: 'community' },
  { id: 'comm-reach-11', name: 'Reach 11 Sports Complex', sport: 'multi', lat: 33.6700, lon: -112.0234, city: 'Phoenix', state: 'AZ', capacity: 3000, type: 'outdoor', league: 'community' },
  { id: 'comm-southside', name: 'Southside Soccer Park', sport: 'soccer', lat: 32.3504, lon: -95.2997, city: 'Tyler', state: 'TX', capacity: 2000, type: 'outdoor', league: 'community' },
  { id: 'comm-bonney', name: 'Bonney Field', sport: 'soccer', lat: 38.5802, lon: -121.4841, city: 'Sacramento', state: 'CA', capacity: 11569, type: 'outdoor', league: 'community' },
  { id: 'comm-ed-smith', name: 'Ed Smith Stadium', sport: 'baseball', lat: 27.3381, lon: -82.5230, city: 'Sarasota', state: 'FL', capacity: 8500, type: 'outdoor', league: 'community' },
  { id: 'comm-peoria-sc', name: 'Peoria Sports Complex', sport: 'baseball', lat: 33.5808, lon: -112.2360, city: 'Peoria', state: 'AZ', capacity: 12882, type: 'outdoor', league: 'community' },
  { id: 'comm-camelback', name: 'Camelback Ranch', sport: 'baseball', lat: 33.4646, lon: -112.2327, city: 'Glendale', state: 'AZ', capacity: 13000, type: 'outdoor', league: 'community' },
  { id: 'comm-steinbrenner', name: 'George M. Steinbrenner Field', sport: 'baseball', lat: 27.9783, lon: -82.5036, city: 'Tampa', state: 'FL', capacity: 11026, type: 'outdoor', league: 'community' },
  { id: 'comm-publix', name: 'CoolToday Park', sport: 'baseball', lat: 27.0897, lon: -82.2089, city: 'North Port', state: 'FL', capacity: 8200, type: 'outdoor', league: 'community' },
  { id: 'comm-hammond', name: 'Hammond Stadium', sport: 'baseball', lat: 26.5364, lon: -81.8419, city: 'Fort Myers', state: 'FL', capacity: 9300, type: 'outdoor', league: 'community' },
  { id: 'comm-cedar-park', name: 'Dell Diamond', sport: 'baseball', lat: 30.5658, lon: -97.8191, city: 'Round Rock', state: 'TX', capacity: 8631, type: 'outdoor', league: 'community' },
  { id: 'comm-bb-park-stl', name: 'T.R. Hughes Ballpark', sport: 'baseball', lat: 38.7467, lon: -90.3929, city: "O'Fallon", state: 'MO', capacity: 6500, type: 'outdoor', league: 'community' },
  { id: 'comm-eastlake-ll', name: 'Eastlake Little League Fields', sport: 'youth', lat: 32.6379, lon: -116.9631, city: 'Chula Vista', state: 'CA', capacity: 1000, type: 'outdoor', league: 'community' },
  { id: 'comm-williamsport', name: 'Howard J. Lamade Stadium', sport: 'youth', lat: 41.2112, lon: -77.0380, city: 'Williamsport', state: 'PA', capacity: 10000, type: 'outdoor', league: 'community' },
  { id: 'comm-dream-park', name: 'NJ Dream Park', sport: 'youth', lat: 39.8196, lon: -75.2127, city: 'Gloucester', state: 'NJ', capacity: 2000, type: 'outdoor', league: 'community' },
  { id: 'comm-cooperstown', name: 'Cooperstown Dreams Park', sport: 'youth', lat: 42.7030, lon: -74.9234, city: 'Cooperstown', state: 'NY', capacity: 3000, type: 'outdoor', league: 'community' },
  { id: 'comm-ymca-fields', name: 'YMCA Sports Fields at Antioch', sport: 'youth', lat: 36.0619, lon: -86.6595, city: 'Antioch', state: 'TN', capacity: 500, type: 'outdoor', league: 'community' },
  { id: 'comm-bob-lewis', name: 'Bob Lewis Ballpark', sport: 'baseball', lat: 34.2482, lon: -77.8711, city: 'Wilmington', state: 'NC', capacity: 6000, type: 'outdoor', league: 'community' },
  { id: 'comm-fretz-park', name: 'Fretz Park Recreation Center', sport: 'multi', lat: 32.8900, lon: -96.7700, city: 'Dallas', state: 'TX', capacity: 500, type: 'outdoor', league: 'community' },
  { id: 'comm-piedmont', name: 'Piedmont Park Fields', sport: 'multi', lat: 33.7878, lon: -84.3742, city: 'Atlanta', state: 'GA', capacity: 1000, type: 'outdoor', league: 'community' },
  { id: 'comm-zilker', name: 'Zilker Park Sports Fields', sport: 'multi', lat: 30.2672, lon: -97.7729, city: 'Austin', state: 'TX', capacity: 1000, type: 'outdoor', league: 'community' },
];

/**
 * Find a venue by its unique ID.
 */
export function getVenueById(id: string): Venue | undefined {
  return venues.find((v) => v.id === id);
}

/**
 * Get all venues in a given US state (two-letter code, e.g. "TX", "CA").
 */
export function getVenuesByState(state: string): Venue[] {
  const normalized = state.toUpperCase();
  return venues.filter((v) => v.state.toUpperCase() === normalized);
}

/**
 * Get all venues for a given sport.
 */
export function getVenuesBySport(sport: string): Venue[] {
  return venues.filter((v) => v.sport === sport);
}

/**
 * Get all venues in a given league (mlb, nfl, ncaa-football, mls, community).
 */
export function getVenuesByLeague(league: string): Venue[] {
  return venues.filter((v) => v.league === league);
}

/**
 * Get all venues in a given conference within a league.
 */
export function getVenuesByConference(conference: string): Venue[] {
  return venues.filter((v) => v.conference === conference);
}
