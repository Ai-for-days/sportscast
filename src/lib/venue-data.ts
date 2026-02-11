import type { Venue } from './types';

export const venues: Venue[] = [
  // ============================================================
  // MLB STADIUMS (30)
  // ============================================================

  // AL East
  { id: 'mlb-bal', name: 'Oriole Park at Camden Yards', sport: 'baseball', lat: 39.2838, lon: -76.6216, city: 'Baltimore', state: 'MD', capacity: 45971, type: 'outdoor' },
  { id: 'mlb-bos', name: 'Fenway Park', sport: 'baseball', lat: 42.3467, lon: -71.0972, city: 'Boston', state: 'MA', capacity: 37755, type: 'outdoor' },
  { id: 'mlb-nyy', name: 'Yankee Stadium', sport: 'baseball', lat: 40.8296, lon: -73.9262, city: 'Bronx', state: 'NY', capacity: 46537, type: 'outdoor' },
  { id: 'mlb-tb', name: 'Tropicana Field', sport: 'baseball', lat: 27.7682, lon: -82.6534, city: 'St. Petersburg', state: 'FL', capacity: 25000, type: 'indoor' },
  { id: 'mlb-tor', name: 'Rogers Centre', sport: 'baseball', lat: 43.6414, lon: -79.3894, city: 'Toronto', state: 'ON', capacity: 49282, type: 'retractable' },

  // AL Central
  { id: 'mlb-cws', name: 'Guaranteed Rate Field', sport: 'baseball', lat: 41.8299, lon: -87.6338, city: 'Chicago', state: 'IL', capacity: 40615, type: 'outdoor' },
  { id: 'mlb-cle', name: 'Progressive Field', sport: 'baseball', lat: 41.4962, lon: -81.6852, city: 'Cleveland', state: 'OH', capacity: 34788, type: 'outdoor' },
  { id: 'mlb-det', name: 'Comerica Park', sport: 'baseball', lat: 42.3390, lon: -83.0485, city: 'Detroit', state: 'MI', capacity: 41083, type: 'outdoor' },
  { id: 'mlb-kc', name: 'Kauffman Stadium', sport: 'baseball', lat: 39.0517, lon: -94.4803, city: 'Kansas City', state: 'MO', capacity: 37903, type: 'outdoor' },
  { id: 'mlb-min', name: 'Target Field', sport: 'baseball', lat: 44.9818, lon: -93.2776, city: 'Minneapolis', state: 'MN', capacity: 38544, type: 'outdoor' },

  // AL West
  { id: 'mlb-hou', name: 'Minute Maid Park', sport: 'baseball', lat: 29.7573, lon: -95.3555, city: 'Houston', state: 'TX', capacity: 41168, type: 'retractable' },
  { id: 'mlb-laa', name: 'Angel Stadium', sport: 'baseball', lat: 33.8003, lon: -117.8827, city: 'Anaheim', state: 'CA', capacity: 45517, type: 'outdoor' },
  { id: 'mlb-oak', name: 'Oakland Coliseum', sport: 'baseball', lat: 37.7516, lon: -122.2005, city: 'Oakland', state: 'CA', capacity: 46847, type: 'outdoor' },
  { id: 'mlb-sea', name: 'T-Mobile Park', sport: 'baseball', lat: 47.5914, lon: -122.3325, city: 'Seattle', state: 'WA', capacity: 47929, type: 'retractable' },
  { id: 'mlb-tex', name: 'Globe Life Field', sport: 'baseball', lat: 32.7473, lon: -97.0845, city: 'Arlington', state: 'TX', capacity: 40300, type: 'retractable' },

  // NL East
  { id: 'mlb-atl', name: 'Truist Park', sport: 'baseball', lat: 33.8907, lon: -84.4677, city: 'Atlanta', state: 'GA', capacity: 41084, type: 'outdoor' },
  { id: 'mlb-mia', name: 'LoanDepot Park', sport: 'baseball', lat: 25.7781, lon: -80.2197, city: 'Miami', state: 'FL', capacity: 36742, type: 'retractable' },
  { id: 'mlb-nym', name: 'Citi Field', sport: 'baseball', lat: 40.7571, lon: -73.8458, city: 'Queens', state: 'NY', capacity: 41922, type: 'outdoor' },
  { id: 'mlb-phi', name: 'Citizens Bank Park', sport: 'baseball', lat: 39.9061, lon: -75.1665, city: 'Philadelphia', state: 'PA', capacity: 42792, type: 'outdoor' },
  { id: 'mlb-wsh', name: 'Nationals Park', sport: 'baseball', lat: 38.8730, lon: -77.0074, city: 'Washington', state: 'DC', capacity: 41339, type: 'outdoor' },

  // NL Central
  { id: 'mlb-chc', name: 'Wrigley Field', sport: 'baseball', lat: 41.9484, lon: -87.6553, city: 'Chicago', state: 'IL', capacity: 41649, type: 'outdoor' },
  { id: 'mlb-cin', name: 'Great American Ball Park', sport: 'baseball', lat: 39.0974, lon: -84.5065, city: 'Cincinnati', state: 'OH', capacity: 42319, type: 'outdoor' },
  { id: 'mlb-mil', name: 'American Family Field', sport: 'baseball', lat: 43.0280, lon: -87.9712, city: 'Milwaukee', state: 'WI', capacity: 41900, type: 'retractable' },
  { id: 'mlb-pit', name: 'PNC Park', sport: 'baseball', lat: 40.4469, lon: -80.0058, city: 'Pittsburgh', state: 'PA', capacity: 38362, type: 'outdoor' },
  { id: 'mlb-stl', name: 'Busch Stadium', sport: 'baseball', lat: 38.6226, lon: -90.1928, city: 'St. Louis', state: 'MO', capacity: 45494, type: 'outdoor' },

  // NL West
  { id: 'mlb-ari', name: 'Chase Field', sport: 'baseball', lat: 33.4455, lon: -112.0667, city: 'Phoenix', state: 'AZ', capacity: 48519, type: 'retractable' },
  { id: 'mlb-col', name: 'Coors Field', sport: 'baseball', lat: 39.7559, lon: -104.9942, city: 'Denver', state: 'CO', capacity: 50144, type: 'outdoor' },
  { id: 'mlb-lad', name: 'Dodger Stadium', sport: 'baseball', lat: 34.0739, lon: -118.2400, city: 'Los Angeles', state: 'CA', capacity: 56000, type: 'outdoor' },
  { id: 'mlb-sd', name: 'Petco Park', sport: 'baseball', lat: 32.7076, lon: -117.1570, city: 'San Diego', state: 'CA', capacity: 40209, type: 'outdoor' },
  { id: 'mlb-sf', name: 'Oracle Park', sport: 'baseball', lat: 37.7786, lon: -122.3893, city: 'San Francisco', state: 'CA', capacity: 41265, type: 'outdoor' },

  // ============================================================
  // NFL STADIUMS (32)
  // ============================================================

  // AFC East
  { id: 'nfl-buf', name: 'Highmark Stadium', sport: 'football', lat: 42.7738, lon: -78.7870, city: 'Orchard Park', state: 'NY', capacity: 71608, type: 'outdoor' },
  { id: 'nfl-mia', name: 'Hard Rock Stadium', sport: 'football', lat: 25.9580, lon: -80.2389, city: 'Miami Gardens', state: 'FL', capacity: 64767, type: 'outdoor' },
  { id: 'nfl-ne', name: 'Gillette Stadium', sport: 'football', lat: 42.0909, lon: -71.2643, city: 'Foxborough', state: 'MA', capacity: 65878, type: 'outdoor' },
  { id: 'nfl-nyj', name: 'MetLife Stadium', sport: 'football', lat: 40.8128, lon: -74.0742, city: 'East Rutherford', state: 'NJ', capacity: 82500, type: 'outdoor' },

  // AFC North
  { id: 'nfl-bal', name: 'M&T Bank Stadium', sport: 'football', lat: 39.2780, lon: -76.6227, city: 'Baltimore', state: 'MD', capacity: 71008, type: 'outdoor' },
  { id: 'nfl-cin', name: 'Paycor Stadium', sport: 'football', lat: 39.0955, lon: -84.5161, city: 'Cincinnati', state: 'OH', capacity: 65515, type: 'outdoor' },
  { id: 'nfl-cle', name: 'Cleveland Browns Stadium', sport: 'football', lat: 41.5061, lon: -81.6995, city: 'Cleveland', state: 'OH', capacity: 67431, type: 'outdoor' },
  { id: 'nfl-pit', name: 'Acrisure Stadium', sport: 'football', lat: 40.4468, lon: -80.0158, city: 'Pittsburgh', state: 'PA', capacity: 68400, type: 'outdoor' },

  // AFC South
  { id: 'nfl-hou', name: 'NRG Stadium', sport: 'football', lat: 29.6847, lon: -95.4107, city: 'Houston', state: 'TX', capacity: 72220, type: 'retractable' },
  { id: 'nfl-ind', name: 'Lucas Oil Stadium', sport: 'football', lat: 39.7601, lon: -86.1639, city: 'Indianapolis', state: 'IN', capacity: 67000, type: 'retractable' },
  { id: 'nfl-jax', name: 'EverBank Stadium', sport: 'football', lat: 30.3239, lon: -81.6373, city: 'Jacksonville', state: 'FL', capacity: 67814, type: 'outdoor' },
  { id: 'nfl-ten', name: 'Nissan Stadium', sport: 'football', lat: 36.1665, lon: -86.7713, city: 'Nashville', state: 'TN', capacity: 69143, type: 'outdoor' },

  // AFC West
  { id: 'nfl-den', name: 'Empower Field at Mile High', sport: 'football', lat: 39.7439, lon: -105.0201, city: 'Denver', state: 'CO', capacity: 76125, type: 'outdoor' },
  { id: 'nfl-kc', name: 'GEHA Field at Arrowhead Stadium', sport: 'football', lat: 39.0489, lon: -94.4839, city: 'Kansas City', state: 'MO', capacity: 76416, type: 'outdoor' },
  { id: 'nfl-lv', name: 'Allegiant Stadium', sport: 'football', lat: 36.0908, lon: -115.1833, city: 'Las Vegas', state: 'NV', capacity: 65000, type: 'indoor' },
  { id: 'nfl-lac', name: 'SoFi Stadium', sport: 'football', lat: 33.9535, lon: -118.3392, city: 'Inglewood', state: 'CA', capacity: 70240, type: 'indoor' },

  // NFC East
  { id: 'nfl-dal', name: 'AT&T Stadium', sport: 'football', lat: 32.7473, lon: -97.0945, city: 'Arlington', state: 'TX', capacity: 80000, type: 'retractable' },
  { id: 'nfl-nyg', name: 'MetLife Stadium (Giants)', sport: 'football', lat: 40.8128, lon: -74.0742, city: 'East Rutherford', state: 'NJ', capacity: 82500, type: 'outdoor' },
  { id: 'nfl-phi', name: 'Lincoln Financial Field', sport: 'football', lat: 39.9008, lon: -75.1675, city: 'Philadelphia', state: 'PA', capacity: 69176, type: 'outdoor' },
  { id: 'nfl-wsh', name: 'Commanders Field', sport: 'football', lat: 38.9076, lon: -76.8645, city: 'Landover', state: 'MD', capacity: 67617, type: 'outdoor' },

  // NFC North
  { id: 'nfl-chi', name: 'Soldier Field', sport: 'football', lat: 41.8623, lon: -87.6167, city: 'Chicago', state: 'IL', capacity: 61500, type: 'outdoor' },
  { id: 'nfl-det', name: 'Ford Field', sport: 'football', lat: 42.3400, lon: -83.0456, city: 'Detroit', state: 'MI', capacity: 65000, type: 'indoor' },
  { id: 'nfl-gb', name: 'Lambeau Field', sport: 'football', lat: 44.5013, lon: -88.0622, city: 'Green Bay', state: 'WI', capacity: 81441, type: 'outdoor' },
  { id: 'nfl-min', name: 'U.S. Bank Stadium', sport: 'football', lat: 44.9736, lon: -93.2575, city: 'Minneapolis', state: 'MN', capacity: 66655, type: 'indoor' },

  // NFC South
  { id: 'nfl-atl', name: 'Mercedes-Benz Stadium', sport: 'football', lat: 33.7554, lon: -84.4010, city: 'Atlanta', state: 'GA', capacity: 71000, type: 'retractable' },
  { id: 'nfl-car', name: 'Bank of America Stadium', sport: 'football', lat: 35.2258, lon: -80.8528, city: 'Charlotte', state: 'NC', capacity: 74867, type: 'outdoor' },
  { id: 'nfl-no', name: 'Caesars Superdome', sport: 'football', lat: 29.9511, lon: -90.0812, city: 'New Orleans', state: 'LA', capacity: 73208, type: 'indoor' },
  { id: 'nfl-tb', name: 'Raymond James Stadium', sport: 'football', lat: 27.9759, lon: -82.5033, city: 'Tampa', state: 'FL', capacity: 65618, type: 'outdoor' },

  // NFC West
  { id: 'nfl-ari', name: 'State Farm Stadium', sport: 'football', lat: 33.5276, lon: -112.2626, city: 'Glendale', state: 'AZ', capacity: 63400, type: 'retractable' },
  { id: 'nfl-lar', name: 'SoFi Stadium (Rams)', sport: 'football', lat: 33.9535, lon: -118.3392, city: 'Inglewood', state: 'CA', capacity: 70240, type: 'indoor' },
  { id: 'nfl-sf', name: "Levi's Stadium", sport: 'football', lat: 37.4033, lon: -121.9694, city: 'Santa Clara', state: 'CA', capacity: 68500, type: 'outdoor' },
  { id: 'nfl-sea', name: 'Lumen Field', sport: 'football', lat: 47.5952, lon: -122.3316, city: 'Seattle', state: 'WA', capacity: 68740, type: 'outdoor' },

  // ============================================================
  // MAJOR COLLEGE FOOTBALL STADIUMS (~50)
  // ============================================================

  // SEC
  { id: 'ncaa-alabama', name: 'Bryant-Denny Stadium', sport: 'football', lat: 33.2084, lon: -87.5504, city: 'Tuscaloosa', state: 'AL', capacity: 100077, type: 'outdoor' },
  { id: 'ncaa-auburn', name: 'Jordan-Hare Stadium', sport: 'football', lat: 32.6024, lon: -85.4897, city: 'Auburn', state: 'AL', capacity: 87451, type: 'outdoor' },
  { id: 'ncaa-lsu', name: 'Tiger Stadium', sport: 'football', lat: 30.4120, lon: -91.1837, city: 'Baton Rouge', state: 'LA', capacity: 102321, type: 'outdoor' },
  { id: 'ncaa-uga', name: 'Sanford Stadium', sport: 'football', lat: 33.9497, lon: -83.3733, city: 'Athens', state: 'GA', capacity: 92746, type: 'outdoor' },
  { id: 'ncaa-florida', name: 'Ben Hill Griffin Stadium', sport: 'football', lat: 29.6500, lon: -82.3486, city: 'Gainesville', state: 'FL', capacity: 88548, type: 'outdoor' },
  { id: 'ncaa-tamu', name: 'Kyle Field', sport: 'football', lat: 30.6101, lon: -96.3404, city: 'College Station', state: 'TX', capacity: 102733, type: 'outdoor' },
  { id: 'ncaa-tennessee', name: 'Neyland Stadium', sport: 'football', lat: 35.9551, lon: -83.9250, city: 'Knoxville', state: 'TN', capacity: 102455, type: 'outdoor' },
  { id: 'ncaa-ole-miss', name: 'Vaught-Hemingway Stadium', sport: 'football', lat: 34.3618, lon: -89.5344, city: 'Oxford', state: 'MS', capacity: 64038, type: 'outdoor' },
  { id: 'ncaa-msst', name: 'Davis Wade Stadium', sport: 'football', lat: 33.4559, lon: -88.7932, city: 'Starkville', state: 'MS', capacity: 61337, type: 'outdoor' },
  { id: 'ncaa-arkansas', name: 'Donald W. Reynolds Razorback Stadium', sport: 'football', lat: 36.0679, lon: -94.1790, city: 'Fayetteville', state: 'AR', capacity: 76412, type: 'outdoor' },
  { id: 'ncaa-southcar', name: 'Williams-Brice Stadium', sport: 'football', lat: 33.9727, lon: -81.0194, city: 'Columbia', state: 'SC', capacity: 77559, type: 'outdoor' },
  { id: 'ncaa-missouri', name: 'Faurot Field at Memorial Stadium', sport: 'football', lat: 38.9365, lon: -92.3331, city: 'Columbia', state: 'MO', capacity: 62621, type: 'outdoor' },
  { id: 'ncaa-kentucky', name: 'Kroger Field', sport: 'football', lat: 38.0223, lon: -84.5053, city: 'Lexington', state: 'KY', capacity: 61000, type: 'outdoor' },
  { id: 'ncaa-vanderbilt', name: 'FirstBank Stadium', sport: 'football', lat: 36.1443, lon: -86.8094, city: 'Nashville', state: 'TN', capacity: 40350, type: 'outdoor' },
  { id: 'ncaa-texas', name: 'Darrell K Royal-Texas Memorial Stadium', sport: 'football', lat: 30.2836, lon: -97.7325, city: 'Austin', state: 'TX', capacity: 100119, type: 'outdoor' },
  { id: 'ncaa-oklahoma', name: 'Gaylord Family Oklahoma Memorial Stadium', sport: 'football', lat: 35.2058, lon: -97.4423, city: 'Norman', state: 'OK', capacity: 80126, type: 'outdoor' },

  // Big Ten
  { id: 'ncaa-michigan', name: 'Michigan Stadium', sport: 'football', lat: 42.2658, lon: -83.7486, city: 'Ann Arbor', state: 'MI', capacity: 107601, type: 'outdoor' },
  { id: 'ncaa-osu', name: 'Ohio Stadium', sport: 'football', lat: 40.0017, lon: -83.0196, city: 'Columbus', state: 'OH', capacity: 102780, type: 'outdoor' },
  { id: 'ncaa-psu', name: 'Beaver Stadium', sport: 'football', lat: 40.8122, lon: -77.8561, city: 'State College', state: 'PA', capacity: 106572, type: 'outdoor' },
  { id: 'ncaa-wisconsin', name: 'Camp Randall Stadium', sport: 'football', lat: 43.0700, lon: -89.4128, city: 'Madison', state: 'WI', capacity: 80321, type: 'outdoor' },
  { id: 'ncaa-iowa', name: 'Kinnick Stadium', sport: 'football', lat: 41.6589, lon: -91.5509, city: 'Iowa City', state: 'IA', capacity: 69250, type: 'outdoor' },
  { id: 'ncaa-nebraska', name: 'Memorial Stadium', sport: 'football', lat: 40.8206, lon: -96.7056, city: 'Lincoln', state: 'NE', capacity: 85458, type: 'outdoor' },
  { id: 'ncaa-msu', name: 'Spartan Stadium', sport: 'football', lat: 42.7284, lon: -84.4821, city: 'East Lansing', state: 'MI', capacity: 75005, type: 'outdoor' },
  { id: 'ncaa-minn', name: 'Huntington Bank Stadium', sport: 'football', lat: 44.9764, lon: -93.2248, city: 'Minneapolis', state: 'MN', capacity: 50805, type: 'outdoor' },
  { id: 'ncaa-usc', name: 'Los Angeles Memorial Coliseum', sport: 'football', lat: 34.0141, lon: -118.2879, city: 'Los Angeles', state: 'CA', capacity: 77500, type: 'outdoor' },
  { id: 'ncaa-ucla', name: 'Rose Bowl', sport: 'football', lat: 34.1613, lon: -118.1676, city: 'Pasadena', state: 'CA', capacity: 88565, type: 'outdoor' },
  { id: 'ncaa-oregon', name: 'Autzen Stadium', sport: 'football', lat: 44.0584, lon: -123.0680, city: 'Eugene', state: 'OR', capacity: 54000, type: 'outdoor' },
  { id: 'ncaa-wash', name: 'Husky Stadium', sport: 'football', lat: 47.6505, lon: -122.3017, city: 'Seattle', state: 'WA', capacity: 70083, type: 'outdoor' },

  // ACC
  { id: 'ncaa-clemson', name: 'Memorial Stadium (Clemson)', sport: 'football', lat: 34.6784, lon: -82.8434, city: 'Clemson', state: 'SC', capacity: 81500, type: 'outdoor' },
  { id: 'ncaa-fsu', name: 'Doak Campbell Stadium', sport: 'football', lat: 30.4384, lon: -84.3045, city: 'Tallahassee', state: 'FL', capacity: 79560, type: 'outdoor' },
  { id: 'ncaa-notredame', name: 'Notre Dame Stadium', sport: 'football', lat: 41.6985, lon: -86.2340, city: 'Notre Dame', state: 'IN', capacity: 77622, type: 'outdoor' },
  { id: 'ncaa-vt', name: 'Lane Stadium', sport: 'football', lat: 37.2200, lon: -80.4181, city: 'Blacksburg', state: 'VA', capacity: 66233, type: 'outdoor' },
  { id: 'ncaa-ncstate', name: 'Carter-Finley Stadium', sport: 'football', lat: 35.8030, lon: -78.7117, city: 'Raleigh', state: 'NC', capacity: 57583, type: 'outdoor' },
  { id: 'ncaa-miami', name: 'Hard Rock Stadium (Miami)', sport: 'football', lat: 25.9580, lon: -80.2389, city: 'Miami Gardens', state: 'FL', capacity: 64767, type: 'outdoor' },

  // Big 12
  { id: 'ncaa-byu', name: 'LaVell Edwards Stadium', sport: 'football', lat: 40.2573, lon: -111.6546, city: 'Provo', state: 'UT', capacity: 63470, type: 'outdoor' },
  { id: 'ncaa-tcu', name: 'Amon G. Carter Stadium', sport: 'football', lat: 32.7098, lon: -97.3684, city: 'Fort Worth', state: 'TX', capacity: 47000, type: 'outdoor' },
  { id: 'ncaa-kstate', name: 'Bill Snyder Family Stadium', sport: 'football', lat: 39.2013, lon: -96.5937, city: 'Manhattan', state: 'KS', capacity: 50000, type: 'outdoor' },
  { id: 'ncaa-wvu', name: 'Milan Puskar Stadium', sport: 'football', lat: 39.6500, lon: -79.9551, city: 'Morgantown', state: 'WV', capacity: 60000, type: 'outdoor' },

  // Other notable
  { id: 'ncaa-boise', name: 'Albertsons Stadium', sport: 'football', lat: 43.6026, lon: -116.1955, city: 'Boise', state: 'ID', capacity: 36387, type: 'outdoor' },
  { id: 'ncaa-usma', name: 'Michie Stadium', sport: 'football', lat: 41.3889, lon: -73.9653, city: 'West Point', state: 'NY', capacity: 38000, type: 'outdoor' },
  { id: 'ncaa-navy', name: 'Navy-Marine Corps Memorial Stadium', sport: 'football', lat: 38.9907, lon: -76.4876, city: 'Annapolis', state: 'MD', capacity: 34000, type: 'outdoor' },

  // ============================================================
  // MAJOR SOCCER VENUES (~30)
  // ============================================================

  // MLS Stadiums
  { id: 'mls-atl', name: 'Mercedes-Benz Stadium (Atlanta United)', sport: 'soccer', lat: 33.7554, lon: -84.4010, city: 'Atlanta', state: 'GA', capacity: 42500, type: 'retractable' },
  { id: 'mls-lafc', name: 'BMO Stadium', sport: 'soccer', lat: 34.0128, lon: -118.2843, city: 'Los Angeles', state: 'CA', capacity: 22000, type: 'outdoor' },
  { id: 'mls-lag', name: 'Dignity Health Sports Park', sport: 'soccer', lat: 33.8644, lon: -118.2611, city: 'Carson', state: 'CA', capacity: 27000, type: 'outdoor' },
  { id: 'mls-sea', name: 'Lumen Field (Sounders)', sport: 'soccer', lat: 47.5952, lon: -122.3316, city: 'Seattle', state: 'WA', capacity: 37722, type: 'outdoor' },
  { id: 'mls-por', name: 'Providence Park', sport: 'soccer', lat: 45.5215, lon: -122.6916, city: 'Portland', state: 'OR', capacity: 25218, type: 'outdoor' },
  { id: 'mls-cin', name: 'TQL Stadium', sport: 'soccer', lat: 39.1114, lon: -84.5218, city: 'Cincinnati', state: 'OH', capacity: 26000, type: 'outdoor' },
  { id: 'mls-nash', name: 'Geodis Park', sport: 'soccer', lat: 36.1306, lon: -86.7661, city: 'Nashville', state: 'TN', capacity: 30000, type: 'outdoor' },
  { id: 'mls-cbus', name: 'Lower.com Field', sport: 'soccer', lat: 39.9685, lon: -83.0170, city: 'Columbus', state: 'OH', capacity: 20371, type: 'outdoor' },
  { id: 'mls-nyc', name: 'Yankee Stadium (NYCFC)', sport: 'soccer', lat: 40.8296, lon: -73.9262, city: 'Bronx', state: 'NY', capacity: 30321, type: 'outdoor' },
  { id: 'mls-nyrb', name: 'Red Bull Arena', sport: 'soccer', lat: 40.7368, lon: -74.1503, city: 'Harrison', state: 'NJ', capacity: 25000, type: 'outdoor' },
  { id: 'mls-phi', name: 'Subaru Park', sport: 'soccer', lat: 39.8328, lon: -75.3788, city: 'Chester', state: 'PA', capacity: 18500, type: 'outdoor' },
  { id: 'mls-dc', name: 'Audi Field', sport: 'soccer', lat: 38.8686, lon: -77.0128, city: 'Washington', state: 'DC', capacity: 20000, type: 'outdoor' },
  { id: 'mls-chi', name: 'Soldier Field (Fire)', sport: 'soccer', lat: 41.8623, lon: -87.6167, city: 'Chicago', state: 'IL', capacity: 20000, type: 'outdoor' },
  { id: 'mls-min', name: 'Allianz Field', sport: 'soccer', lat: 44.9531, lon: -93.1653, city: 'St. Paul', state: 'MN', capacity: 19400, type: 'outdoor' },
  { id: 'mls-hou', name: 'Shell Energy Stadium', sport: 'soccer', lat: 29.7522, lon: -95.3524, city: 'Houston', state: 'TX', capacity: 22039, type: 'outdoor' },
  { id: 'mls-dal', name: 'Toyota Stadium', sport: 'soccer', lat: 33.1543, lon: -96.8353, city: 'Frisco', state: 'TX', capacity: 20500, type: 'outdoor' },
  { id: 'mls-kc', name: "Children's Mercy Park", sport: 'soccer', lat: 38.8832, lon: -94.8213, city: 'Kansas City', state: 'KS', capacity: 18467, type: 'outdoor' },
  { id: 'mls-slc', name: 'America First Field', sport: 'soccer', lat: 40.5830, lon: -111.8933, city: 'Sandy', state: 'UT', capacity: 20213, type: 'outdoor' },
  { id: 'mls-col', name: "Dick's Sporting Goods Park", sport: 'soccer', lat: 39.8056, lon: -104.8919, city: 'Commerce City', state: 'CO', capacity: 18061, type: 'outdoor' },
  { id: 'mls-sj', name: 'PayPal Park', sport: 'soccer', lat: 37.3517, lon: -121.9250, city: 'San Jose', state: 'CA', capacity: 18000, type: 'outdoor' },
  { id: 'mls-orl', name: 'Exploria Stadium', sport: 'soccer', lat: 28.5411, lon: -81.3892, city: 'Orlando', state: 'FL', capacity: 25500, type: 'outdoor' },
  { id: 'mls-ne', name: 'Gillette Stadium (Revolution)', sport: 'soccer', lat: 42.0909, lon: -71.2643, city: 'Foxborough', state: 'MA', capacity: 20000, type: 'outdoor' },
  { id: 'mls-mia', name: 'Chase Stadium', sport: 'soccer', lat: 25.9579, lon: -80.1679, city: 'Fort Lauderdale', state: 'FL', capacity: 21550, type: 'outdoor' },
  { id: 'mls-austin', name: 'Q2 Stadium', sport: 'soccer', lat: 30.3878, lon: -97.7195, city: 'Austin', state: 'TX', capacity: 20738, type: 'outdoor' },
  { id: 'mls-char', name: 'Bank of America Stadium (Charlotte FC)', sport: 'soccer', lat: 35.2258, lon: -80.8528, city: 'Charlotte', state: 'NC', capacity: 38000, type: 'outdoor' },
  { id: 'mls-stl', name: 'CityPark', sport: 'soccer', lat: 38.6310, lon: -90.2108, city: 'St. Louis', state: 'MO', capacity: 22500, type: 'outdoor' },

  // NWSL / International venues
  { id: 'nwsl-wave', name: 'Snapdragon Stadium', sport: 'soccer', lat: 32.7829, lon: -117.1198, city: 'San Diego', state: 'CA', capacity: 35000, type: 'outdoor' },
  { id: 'nwsl-courage', name: 'WakeMed Soccer Park', sport: 'soccer', lat: 35.8479, lon: -78.7232, city: 'Cary', state: 'NC', capacity: 10000, type: 'outdoor' },
  { id: 'soccer-rose-bowl', name: 'Rose Bowl (Soccer)', sport: 'soccer', lat: 34.1613, lon: -118.1676, city: 'Pasadena', state: 'CA', capacity: 88565, type: 'outdoor' },
  { id: 'soccer-metlife', name: 'MetLife Stadium (FIFA)', sport: 'soccer', lat: 40.8128, lon: -74.0742, city: 'East Rutherford', state: 'NJ', capacity: 82500, type: 'outdoor' },

  // ============================================================
  // COMMUNITY / MUNICIPAL FIELDS (~30)
  // ============================================================

  { id: 'comm-kino-az', name: 'Kino Sports Complex', sport: 'multi', lat: 32.1765, lon: -110.9275, city: 'Tucson', state: 'AZ', capacity: 11000, type: 'outdoor' },
  { id: 'comm-maryland-sp', name: 'Maryland SoccerPlex', sport: 'soccer', lat: 39.1292, lon: -77.3964, city: 'Boyds', state: 'MD', capacity: 4000, type: 'outdoor' },
  { id: 'comm-toyota-park-az', name: 'Toyota Soccer Center', sport: 'soccer', lat: 33.5243, lon: -112.1133, city: 'Phoenix', state: 'AZ', capacity: 3000, type: 'outdoor' },
  { id: 'comm-overland-park', name: 'Overland Park Soccer Complex', sport: 'soccer', lat: 38.8824, lon: -94.6716, city: 'Overland Park', state: 'KS', capacity: 6000, type: 'outdoor' },
  { id: 'comm-mike-rose', name: 'Mike Rose Soccer Complex', sport: 'soccer', lat: 35.1195, lon: -89.8949, city: 'Memphis', state: 'TN', capacity: 5000, type: 'outdoor' },
  { id: 'comm-grand-park', name: 'Grand Park Sports Campus', sport: 'multi', lat: 40.0537, lon: -86.0172, city: 'Westfield', state: 'IN', capacity: 5000, type: 'outdoor' },
  { id: 'comm-toyota-sc-frisco', name: 'Toyota Soccer Center (Frisco)', sport: 'soccer', lat: 33.1493, lon: -96.8227, city: 'Frisco', state: 'TX', capacity: 4000, type: 'outdoor' },
  { id: 'comm-bb-sportsplex', name: 'Virginia Beach Sportsplex', sport: 'multi', lat: 36.8340, lon: -76.0730, city: 'Virginia Beach', state: 'VA', capacity: 6500, type: 'outdoor' },
  { id: 'comm-monmouth-park', name: 'Monmouth Park Sports Complex', sport: 'multi', lat: 40.3190, lon: -74.0098, city: 'Oceanport', state: 'NJ', capacity: 3000, type: 'outdoor' },
  { id: 'comm-starfire', name: 'Starfire Sports Complex', sport: 'soccer', lat: 47.4586, lon: -122.2587, city: 'Tukwila', state: 'WA', capacity: 4000, type: 'outdoor' },
  { id: 'comm-reach-11', name: 'Reach 11 Sports Complex', sport: 'multi', lat: 33.6700, lon: -112.0234, city: 'Phoenix', state: 'AZ', capacity: 3000, type: 'outdoor' },
  { id: 'comm-southside', name: 'Southside Soccer Park', sport: 'soccer', lat: 32.3504, lon: -95.2997, city: 'Tyler', state: 'TX', capacity: 2000, type: 'outdoor' },
  { id: 'comm-bonney', name: 'Bonney Field', sport: 'soccer', lat: 38.5802, lon: -121.4841, city: 'Sacramento', state: 'CA', capacity: 11569, type: 'outdoor' },
  { id: 'comm-ed-smith', name: 'Ed Smith Stadium', sport: 'baseball', lat: 27.3381, lon: -82.5230, city: 'Sarasota', state: 'FL', capacity: 8500, type: 'outdoor' },
  { id: 'comm-peoria-sc', name: 'Peoria Sports Complex', sport: 'baseball', lat: 33.5808, lon: -112.2360, city: 'Peoria', state: 'AZ', capacity: 12882, type: 'outdoor' },
  { id: 'comm-camelback', name: 'Camelback Ranch', sport: 'baseball', lat: 33.4646, lon: -112.2327, city: 'Glendale', state: 'AZ', capacity: 13000, type: 'outdoor' },
  { id: 'comm-steinbrenner', name: 'George M. Steinbrenner Field', sport: 'baseball', lat: 27.9783, lon: -82.5036, city: 'Tampa', state: 'FL', capacity: 11026, type: 'outdoor' },
  { id: 'comm-publix', name: 'CoolToday Park', sport: 'baseball', lat: 27.0897, lon: -82.2089, city: 'North Port', state: 'FL', capacity: 8200, type: 'outdoor' },
  { id: 'comm-hammond', name: 'Hammond Stadium', sport: 'baseball', lat: 26.5364, lon: -81.8419, city: 'Fort Myers', state: 'FL', capacity: 9300, type: 'outdoor' },
  { id: 'comm-cedar-park', name: 'Dell Diamond', sport: 'baseball', lat: 30.5658, lon: -97.8191, city: 'Round Rock', state: 'TX', capacity: 8631, type: 'outdoor' },
  { id: 'comm-bb-park-stl', name: 'T.R. Hughes Ballpark', sport: 'baseball', lat: 38.7467, lon: -90.3929, city: "O'Fallon", state: 'MO', capacity: 6500, type: 'outdoor' },
  { id: 'comm-eastlake-ll', name: 'Eastlake Little League Fields', sport: 'youth', lat: 32.6379, lon: -116.9631, city: 'Chula Vista', state: 'CA', capacity: 1000, type: 'outdoor' },
  { id: 'comm-williamsport', name: 'Howard J. Lamade Stadium', sport: 'youth', lat: 41.2112, lon: -77.0380, city: 'Williamsport', state: 'PA', capacity: 10000, type: 'outdoor' },
  { id: 'comm-dream-park', name: 'NJ Dream Park', sport: 'youth', lat: 39.8196, lon: -75.2127, city: 'Gloucester', state: 'NJ', capacity: 2000, type: 'outdoor' },
  { id: 'comm-cooperstown', name: 'Cooperstown Dreams Park', sport: 'youth', lat: 42.7030, lon: -74.9234, city: 'Cooperstown', state: 'NY', capacity: 3000, type: 'outdoor' },
  { id: 'comm-ymca-fields', name: 'YMCA Sports Fields at Antioch', sport: 'youth', lat: 36.0619, lon: -86.6595, city: 'Antioch', state: 'TN', capacity: 500, type: 'outdoor' },
  { id: 'comm-bob-lewis', name: 'Bob Lewis Ballpark', sport: 'baseball', lat: 34.2482, lon: -77.8711, city: 'Wilmington', state: 'NC', capacity: 6000, type: 'outdoor' },
  { id: 'comm-fretz-park', name: 'Fretz Park Recreation Center', sport: 'multi', lat: 32.8900, lon: -96.7700, city: 'Dallas', state: 'TX', capacity: 500, type: 'outdoor' },
  { id: 'comm-piedmont', name: 'Piedmont Park Fields', sport: 'multi', lat: 33.7878, lon: -84.3742, city: 'Atlanta', state: 'GA', capacity: 1000, type: 'outdoor' },
  { id: 'comm-zilker', name: 'Zilker Park Sports Fields', sport: 'multi', lat: 30.2672, lon: -97.7729, city: 'Austin', state: 'TX', capacity: 1000, type: 'outdoor' },
];

/**
 * Find a venue by its unique ID.
 * Returns undefined if no venue matches.
 */
export function getVenueById(id: string): Venue | undefined {
  return venues.find((v) => v.id === id);
}

/**
 * Get all venues in a given US state (two-letter code, e.g. "TX", "CA").
 * Comparison is case-insensitive.
 */
export function getVenuesByState(state: string): Venue[] {
  const normalized = state.toUpperCase();
  return venues.filter((v) => v.state.toUpperCase() === normalized);
}

/**
 * Get all venues for a given sport.
 * Accepts the same sport strings used in the Venue type.
 */
export function getVenuesBySport(sport: string): Venue[] {
  return venues.filter((v) => v.sport === sport);
}
