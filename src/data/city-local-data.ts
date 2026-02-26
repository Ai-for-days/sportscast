// Curated local data for top ~50 cities (expandable to 200+)
// Keyed by "CityName-ST" for fast lookup

export interface CityLocalData {
  landmarks: string[];
  neighborhoods: string[];
  majorRoads: string[];
  employers: string[];
  universities: string[];
}

const cityData: Record<string, CityLocalData> = {
  'New York-NY': {
    landmarks: ['Central Park', 'Statue of Liberty', 'Times Square', 'Brooklyn Bridge', 'Empire State Building'],
    neighborhoods: ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island', 'Harlem', 'SoHo'],
    majorRoads: ['I-95', 'FDR Drive', 'West Side Highway', 'BQE', 'Cross Bronx Expressway'],
    employers: ['JPMorgan Chase', 'NYC Health + Hospitals', 'Citigroup', 'Morgan Stanley'],
    universities: ['Columbia University', 'NYU', 'City University of New York', 'Fordham University'],
  },
  'Los Angeles-CA': {
    landmarks: ['Hollywood Sign', 'Santa Monica Pier', 'Griffith Observatory', 'Getty Center', 'Venice Beach'],
    neighborhoods: ['Hollywood', 'Downtown LA', 'Santa Monica', 'Venice', 'Silver Lake', 'Koreatown'],
    majorRoads: ['I-405', 'I-10', 'US-101', 'I-110', 'Pacific Coast Highway'],
    employers: ['Walt Disney Company', 'Kaiser Permanente', 'UCLA Health', 'SpaceX'],
    universities: ['UCLA', 'USC', 'Cal State LA', 'Loyola Marymount', 'Pepperdine'],
  },
  'Chicago-IL': {
    landmarks: ['Millennium Park', 'Willis Tower', 'Navy Pier', 'Art Institute of Chicago', 'Wrigley Field'],
    neighborhoods: ['The Loop', 'Lincoln Park', 'Wicker Park', 'Hyde Park', 'Lakeview', 'River North'],
    majorRoads: ['I-90/94', 'I-290', 'Lake Shore Drive', 'I-55', 'I-88'],
    employers: ['United Airlines', 'Abbott Laboratories', 'Boeing', 'McDonald\'s Corp'],
    universities: ['University of Chicago', 'Northwestern', 'UIC', 'DePaul', 'Loyola Chicago'],
  },
  'Houston-TX': {
    landmarks: ['Space Center Houston', 'Houston Museum District', 'Hermann Park', 'Buffalo Bayou Park'],
    neighborhoods: ['Montrose', 'The Heights', 'Midtown', 'River Oaks', 'Memorial', 'Galleria'],
    majorRoads: ['I-610 Loop', 'I-45', 'I-10', 'US-59/I-69', 'Beltway 8'],
    employers: ['Texas Medical Center', 'ExxonMobil', 'Shell', 'MD Anderson Cancer Center'],
    universities: ['University of Houston', 'Rice University', 'Texas Southern', 'Houston Baptist'],
  },
  'Phoenix-AZ': {
    landmarks: ['Camelback Mountain', 'Desert Botanical Garden', 'Papago Park', 'South Mountain Park'],
    neighborhoods: ['Scottsdale', 'Tempe', 'Downtown Phoenix', 'Arcadia', 'Chandler', 'Mesa'],
    majorRoads: ['I-10', 'I-17', 'Loop 101', 'Loop 202', 'US-60'],
    employers: ['Banner Health', 'Arizona State University', 'Intel', 'Honeywell'],
    universities: ['Arizona State University', 'University of Arizona', 'Grand Canyon University'],
  },
  'Philadelphia-PA': {
    landmarks: ['Liberty Bell', 'Independence Hall', 'Philadelphia Museum of Art', 'Reading Terminal Market'],
    neighborhoods: ['Center City', 'Old City', 'South Philadelphia', 'University City', 'Fishtown', 'Manayunk'],
    majorRoads: ['I-76', 'I-95', 'I-676', 'Roosevelt Boulevard', 'Broad Street'],
    employers: ['Comcast', 'University of Pennsylvania Health System', 'Thomas Jefferson University'],
    universities: ['University of Pennsylvania', 'Temple University', 'Drexel', 'Villanova'],
  },
  'San Antonio-TX': {
    landmarks: ['The Alamo', 'River Walk', 'San Antonio Missions National Historical Park', 'Tower of the Americas'],
    neighborhoods: ['Downtown', 'Alamo Heights', 'Southtown', 'Stone Oak', 'The Pearl'],
    majorRoads: ['I-10', 'I-35', 'Loop 410', 'Loop 1604', 'US-281'],
    employers: ['USAA', 'Valero Energy', 'H-E-B', 'Joint Base San Antonio'],
    universities: ['University of Texas at San Antonio', 'Trinity University', 'St. Mary\'s University'],
  },
  'San Diego-CA': {
    landmarks: ['San Diego Zoo', 'Balboa Park', 'Coronado Bridge', 'Gaslamp Quarter', 'La Jolla Cove'],
    neighborhoods: ['Gaslamp Quarter', 'La Jolla', 'Pacific Beach', 'North Park', 'Hillcrest', 'Ocean Beach'],
    majorRoads: ['I-5', 'I-8', 'I-15', 'CA-163', 'CA-56'],
    employers: ['Qualcomm', 'UC San Diego Health', 'General Atomics', 'Naval Base San Diego'],
    universities: ['UC San Diego', 'San Diego State University', 'University of San Diego'],
  },
  'Dallas-TX': {
    landmarks: ['Dallas Arboretum', 'Reunion Tower', 'Dealey Plaza', 'Perot Museum', 'AT&T Stadium'],
    neighborhoods: ['Uptown', 'Deep Ellum', 'Bishop Arts', 'Highland Park', 'Oak Cliff', 'Knox-Henderson'],
    majorRoads: ['I-35E', 'I-30', 'I-635 LBJ', 'US-75 Central Expressway', 'Dallas North Tollway'],
    employers: ['AT&T', 'Southwest Airlines', 'Texas Instruments', 'Baylor Scott & White'],
    universities: ['UT Dallas', 'SMU', 'UNT Dallas', 'Dallas Baptist University'],
  },
  'Austin-TX': {
    landmarks: ['Texas State Capitol', 'Lady Bird Lake', 'Barton Springs Pool', 'South Congress Avenue'],
    neighborhoods: ['Downtown', 'South Congress', 'East Austin', 'Hyde Park', 'Zilker', 'Domain'],
    majorRoads: ['I-35', 'MoPac (Loop 1)', 'US-183', 'US-290', 'SH-130'],
    employers: ['Dell Technologies', 'University of Texas', 'Apple', 'Tesla', 'Samsung'],
    universities: ['University of Texas at Austin', 'St. Edward\'s', 'Huston-Tillotson'],
  },
  'Denver-CO': {
    landmarks: ['Red Rocks Amphitheatre', 'Denver Art Museum', 'Union Station', 'Coors Field', 'City Park'],
    neighborhoods: ['LoDo', 'RiNo', 'Capitol Hill', 'Cherry Creek', 'Five Points', 'Highlands'],
    majorRoads: ['I-25', 'I-70', 'I-225', 'US-36', 'C-470'],
    employers: ['Lockheed Martin', 'Ball Aerospace', 'DaVita', 'Newmont Mining'],
    universities: ['University of Denver', 'University of Colorado Denver', 'MSU Denver', 'Regis University'],
  },
  'Miami-FL': {
    landmarks: ['South Beach', 'Vizcaya Museum', 'Freedom Tower', 'Bayfront Park', 'Wynwood Walls'],
    neighborhoods: ['South Beach', 'Brickell', 'Wynwood', 'Little Havana', 'Coconut Grove', 'Coral Gables'],
    majorRoads: ['I-95', 'I-395', 'US-1', 'Dolphin Expressway (SR-836)', 'Palmetto Expressway (SR-826)'],
    employers: ['Baptist Health South Florida', 'Royal Caribbean', 'World Fuel Services'],
    universities: ['University of Miami', 'Florida International University', 'Miami Dade College'],
  },
  'Atlanta-GA': {
    landmarks: ['Georgia Aquarium', 'World of Coca-Cola', 'Centennial Olympic Park', 'Atlanta Botanical Garden'],
    neighborhoods: ['Midtown', 'Buckhead', 'Virginia-Highland', 'Decatur', 'Inman Park', 'Old Fourth Ward'],
    majorRoads: ['I-285 Perimeter', 'I-85', 'I-75', 'I-20', 'GA-400'],
    employers: ['Delta Air Lines', 'Home Depot', 'UPS', 'Coca-Cola', 'Cox Enterprises'],
    universities: ['Georgia Tech', 'Emory University', 'Georgia State', 'Morehouse', 'Spelman'],
  },
  'Seattle-WA': {
    landmarks: ['Space Needle', 'Pike Place Market', 'Museum of Pop Culture', 'Seattle Waterfront'],
    neighborhoods: ['Capitol Hill', 'Fremont', 'Ballard', 'Queen Anne', 'Georgetown', 'University District'],
    majorRoads: ['I-5', 'I-90', 'SR-520', 'I-405', 'SR-99'],
    employers: ['Amazon', 'Microsoft', 'Boeing', 'Starbucks', 'Alaska Airlines'],
    universities: ['University of Washington', 'Seattle University', 'Seattle Pacific University'],
  },
  'Nashville-TN': {
    landmarks: ['Grand Ole Opry', 'Broadway honky-tonks', 'The Parthenon', 'Country Music Hall of Fame'],
    neighborhoods: ['The Gulch', 'East Nashville', 'Germantown', '12South', 'Music Row', 'Midtown'],
    majorRoads: ['I-40', 'I-65', 'I-24', 'I-440', 'Briley Parkway'],
    employers: ['Vanderbilt University Medical Center', 'HCA Healthcare', 'Bridgestone', 'Nissan'],
    universities: ['Vanderbilt University', 'Belmont University', 'Tennessee State University', 'Lipscomb'],
  },
  'Charlotte-NC': {
    landmarks: ['Charlotte Motor Speedway', 'Discovery Place Science', 'Freedom Park', 'Carowinds'],
    neighborhoods: ['Uptown', 'NoDa', 'South End', 'Dilworth', 'Plaza Midwood', 'Myers Park'],
    majorRoads: ['I-77', 'I-85', 'I-485 Outer Loop', 'US-74', 'Independence Boulevard'],
    employers: ['Bank of America', 'Lowe\'s', 'Duke Energy', 'Atrium Health', 'Honeywell'],
    universities: ['UNC Charlotte', 'Queens University', 'Johnson C. Smith University'],
  },
  'Minneapolis-MN': {
    landmarks: ['Chain of Lakes', 'Mall of America', 'Stone Arch Bridge', 'Walker Art Center', 'Target Field'],
    neighborhoods: ['Downtown', 'Uptown', 'North Loop', 'Northeast', 'Linden Hills', 'Dinkytown'],
    majorRoads: ['I-94', 'I-35W', 'I-394', 'I-494/694', 'MN-62 Crosstown'],
    employers: ['Target Corporation', 'UnitedHealth Group', '3M', 'General Mills', 'US Bancorp'],
    universities: ['University of Minnesota', 'Augsburg University', 'Minneapolis College of Art and Design'],
  },
  'San Francisco-CA': {
    landmarks: ['Golden Gate Bridge', 'Alcatraz Island', 'Fisherman\'s Wharf', 'Chinatown', 'Lombard Street'],
    neighborhoods: ['Mission District', 'SoMa', 'North Beach', 'Castro', 'Haight-Ashbury', 'Marina'],
    majorRoads: ['I-80', 'US-101', 'I-280', 'CA-1 (19th Avenue)', 'Bay Bridge'],
    employers: ['Salesforce', 'Wells Fargo', 'Uber', 'Lyft', 'Gap Inc.'],
    universities: ['UCSF', 'San Francisco State University', 'University of San Francisco'],
  },
  'Boston-MA': {
    landmarks: ['Fenway Park', 'Freedom Trail', 'Boston Common', 'Faneuil Hall', 'Harvard Square'],
    neighborhoods: ['Back Bay', 'Beacon Hill', 'South End', 'North End', 'Seaport', 'Cambridge'],
    majorRoads: ['I-93', 'I-90 (Mass Pike)', 'I-95/Route 128', 'Storrow Drive', 'Route 2'],
    employers: ['Mass General Brigham', 'State Street Corporation', 'Liberty Mutual', 'Raytheon'],
    universities: ['Harvard University', 'MIT', 'Boston University', 'Northeastern', 'Boston College'],
  },
  'Portland-OR': {
    landmarks: ['Powell\'s City of Books', 'International Rose Test Garden', 'Forest Park', 'Pittock Mansion'],
    neighborhoods: ['Pearl District', 'Alberta Arts', 'Hawthorne', 'Division', 'St. Johns', 'Sellwood'],
    majorRoads: ['I-5', 'I-84', 'I-205', 'US-26', 'I-405'],
    employers: ['Nike', 'Intel', 'OHSU', 'PGE', 'Daimler Trucks North America'],
    universities: ['Portland State University', 'University of Portland', 'Reed College', 'Lewis & Clark'],
  },
  'Las Vegas-NV': {
    landmarks: ['The Strip', 'Fremont Street Experience', 'Hoover Dam', 'Red Rock Canyon'],
    neighborhoods: ['The Strip', 'Downtown', 'Summerlin', 'Henderson', 'Spring Valley', 'North Las Vegas'],
    majorRoads: ['I-15', 'I-215 Beltway', 'US-95', 'Las Vegas Boulevard', 'Sahara Avenue'],
    employers: ['MGM Resorts', 'Caesars Entertainment', 'Wynn Resorts', 'Station Casinos'],
    universities: ['UNLV', 'Nevada State College', 'College of Southern Nevada'],
  },
  'Columbus-OH': {
    landmarks: ['Ohio State University campus', 'COSI', 'Franklin Park Conservatory', 'Nationwide Arena'],
    neighborhoods: ['Short North', 'German Village', 'Clintonville', 'Upper Arlington', 'Grandview', 'Bexley'],
    majorRoads: ['I-70', 'I-71', 'I-270 Outerbelt', 'US-33', 'US-23'],
    employers: ['Ohio State University', 'Nationwide Insurance', 'Cardinal Health', 'L Brands'],
    universities: ['Ohio State University', 'Capital University', 'Columbus State Community College'],
  },
  'Kansas City-MO': {
    landmarks: ['National WWI Museum', 'Nelson-Atkins Museum of Art', 'Union Station', 'Arrowhead Stadium'],
    neighborhoods: ['Country Club Plaza', 'Westport', 'Crossroads', 'River Market', 'Brookside', 'Waldo'],
    majorRoads: ['I-35', 'I-70', 'I-435 Loop', 'I-29', 'US-71'],
    employers: ['Cerner', 'Sprint', 'Hallmark Cards', 'H&R Block', 'Burns & McDonnell'],
    universities: ['UMKC', 'Rockhurst University', 'University of Kansas Medical Center'],
  },
  'Indianapolis-IN': {
    landmarks: ['Indianapolis Motor Speedway', 'Monument Circle', 'Children\'s Museum of Indianapolis'],
    neighborhoods: ['Broad Ripple', 'Fountain Square', 'Mass Ave', 'Irvington', 'Meridian-Kessler'],
    majorRoads: ['I-65', 'I-70', 'I-465 Loop', 'I-69', 'US-31'],
    employers: ['Eli Lilly', 'Anthem', 'Salesforce (ExactTarget)', 'IU Health', 'Rolls-Royce'],
    universities: ['Indiana University-Purdue University Indianapolis', 'Butler University', 'Marian University'],
  },
  'New Orleans-LA': {
    landmarks: ['French Quarter', 'Garden District', 'Jackson Square', 'Bourbon Street', 'Audubon Zoo'],
    neighborhoods: ['French Quarter', 'Garden District', 'Marigny', 'Bywater', 'Uptown', 'Mid-City'],
    majorRoads: ['I-10', 'I-610', 'US-90', 'Pontchartrain Expressway', 'Causeway Bridge'],
    employers: ['Ochsner Health System', 'Entergy', 'Port of New Orleans', 'Tulane Medical Center'],
    universities: ['Tulane University', 'Loyola University New Orleans', 'University of New Orleans', 'Xavier University'],
  },
  'Salt Lake City-UT': {
    landmarks: ['Temple Square', 'Natural History Museum of Utah', 'Great Salt Lake', 'Big Cottonwood Canyon'],
    neighborhoods: ['Downtown', 'Sugar House', 'The Avenues', '9th and 9th', 'Liberty Park', 'Marmalade'],
    majorRoads: ['I-15', 'I-80', 'I-215 Belt Route', 'US-89', 'Bangerter Highway'],
    employers: ['Intermountain Health', 'University of Utah', 'Goldman Sachs', 'Adobe', 'Pluralsight'],
    universities: ['University of Utah', 'Westminster University', 'Salt Lake Community College'],
  },
  'Pittsburgh-PA': {
    landmarks: ['Point State Park', 'PNC Park', 'Carnegie Museum', 'Duquesne Incline', 'PPG Place'],
    neighborhoods: ['Shadyside', 'Squirrel Hill', 'Lawrenceville', 'Strip District', 'Oakland', 'South Side'],
    majorRoads: ['I-376', 'I-79', 'I-279', 'US-22/30', 'PA Turnpike (I-76)'],
    employers: ['UPMC', 'PNC Financial', 'PPG Industries', 'US Steel', 'Highmark Health'],
    universities: ['University of Pittsburgh', 'Carnegie Mellon', 'Duquesne University', 'Chatham University'],
  },
  'Raleigh-NC': {
    landmarks: ['North Carolina Museum of Art', 'Pullen Park', 'NC State Capitol', 'William B. Umstead State Park'],
    neighborhoods: ['Downtown', 'North Hills', 'Glenwood South', 'Cameron Village', 'Five Points', 'ITB'],
    majorRoads: ['I-40', 'I-440 Beltline', 'I-540', 'US-1', 'US-70'],
    employers: ['NC State University', 'WakeMed', 'Cisco', 'Red Hat (IBM)', 'SAS Institute'],
    universities: ['NC State University', 'Meredith College', 'Shaw University', 'William Peace University'],
  },
  'Tampa-FL': {
    landmarks: ['Busch Gardens', 'Tampa Riverwalk', 'Bayshore Boulevard', 'Florida Aquarium'],
    neighborhoods: ['Ybor City', 'Hyde Park', 'Seminole Heights', 'South Tampa', 'Channelside', 'Westshore'],
    majorRoads: ['I-275', 'I-75', 'I-4', 'US-41', 'Selmon Expressway'],
    employers: ['BayCare Health', 'USAA', 'USCENTCOM (MacDill AFB)', 'University of South Florida'],
    universities: ['University of South Florida', 'University of Tampa', 'Hillsborough Community College'],
  },
  'Orlando-FL': {
    landmarks: ['Walt Disney World', 'Universal Studios', 'Lake Eola', 'ICON Park', 'Kennedy Space Center'],
    neighborhoods: ['Downtown', 'Thornton Park', 'Mills 50', 'Winter Park', 'College Park', 'Baldwin Park'],
    majorRoads: ['I-4', 'FL-408 East-West Expressway', 'FL-417 Greeneway', 'FL-528 Bee Line', 'US-192'],
    employers: ['Walt Disney World', 'Universal Orlando', 'Lockheed Martin', 'AdventHealth'],
    universities: ['University of Central Florida', 'Rollins College', 'Valencia College', 'Full Sail University'],
  },
  'St. Louis-MO': {
    landmarks: ['Gateway Arch', 'Forest Park', 'Busch Stadium', 'City Museum', 'Missouri Botanical Garden'],
    neighborhoods: ['Central West End', 'Soulard', 'The Hill', 'Tower Grove', 'Delmar Loop', 'Lafayette Square'],
    majorRoads: ['I-64', 'I-70', 'I-44', 'I-55', 'I-270'],
    employers: ['Anheuser-Busch', 'Edward Jones', 'Emerson Electric', 'BJC HealthCare', 'Centene'],
    universities: ['Washington University in St. Louis', 'Saint Louis University', 'UMSL', 'Maryville University'],
  },
  'Detroit-MI': {
    landmarks: ['Detroit Institute of Arts', 'GM Renaissance Center', 'Ford Field', 'Belle Isle Park'],
    neighborhoods: ['Downtown', 'Midtown', 'Corktown', 'Eastern Market', 'Mexicantown', 'Grosse Pointe'],
    majorRoads: ['I-94', 'I-75', 'I-96', 'I-696', 'M-10 Lodge Freeway'],
    employers: ['General Motors', 'Ford Motor Company', 'Stellantis', 'Henry Ford Health System'],
    universities: ['Wayne State University', 'University of Detroit Mercy', 'College for Creative Studies'],
  },
  'Milwaukee-WI': {
    landmarks: ['Milwaukee Art Museum', 'Lakefront Brewery', 'Fiserv Forum', 'Harley-Davidson Museum'],
    neighborhoods: ['Third Ward', 'Bay View', 'Walker\'s Point', 'East Side', 'Riverwest', 'Shorewood'],
    majorRoads: ['I-94', 'I-43', 'I-894', 'I-794', 'US-45'],
    employers: ['Northwestern Mutual', 'Johnson Controls', 'Kohl\'s', 'Manpower Group', 'Rockwell Automation'],
    universities: ['University of Wisconsin-Milwaukee', 'Marquette University', 'MSOE'],
  },
  'Oklahoma City-OK': {
    landmarks: ['Oklahoma City National Memorial', 'Bricktown', 'Myriad Botanical Gardens', 'Science Museum'],
    neighborhoods: ['Bricktown', 'Midtown', 'Paseo Arts District', 'Plaza District', 'Edmond', 'Norman'],
    majorRoads: ['I-35', 'I-40', 'I-44', 'I-240', 'Lake Hefner Parkway'],
    employers: ['Tinker Air Force Base', 'Paycom', 'Devon Energy', 'Chesapeake Energy', 'INTEGRIS Health'],
    universities: ['University of Oklahoma', 'Oklahoma State University-OKC', 'Oklahoma City University'],
  },
  'Louisville-KY': {
    landmarks: ['Churchill Downs', 'Louisville Slugger Museum', 'Big Four Bridge', 'Muhammad Ali Center'],
    neighborhoods: ['NuLu', 'Bardstown Road', 'Germantown', 'Old Louisville', 'Butchertown', 'St. Matthews'],
    majorRoads: ['I-64', 'I-65', 'I-71', 'I-264 Watterson Expressway', 'I-265 Gene Snyder Freeway'],
    employers: ['UPS Worldport', 'Humana', 'Yum! Brands', 'GE Appliances', 'Norton Healthcare'],
    universities: ['University of Louisville', 'Bellarmine University', 'Spalding University'],
  },
  'Richmond-VA': {
    landmarks: ['Virginia State Capitol', 'The Fan District architecture', 'Lewis Ginter Botanical Garden', 'James River parks'],
    neighborhoods: ['The Fan', 'Carytown', 'Scott\'s Addition', 'Shockoe Bottom', 'Church Hill', 'Short Pump'],
    majorRoads: ['I-95', 'I-64', 'I-295', 'US-1', 'Powhite Parkway'],
    employers: ['Capital One', 'Dominion Energy', 'Altria Group', 'CarMax', 'VCU Health System'],
    universities: ['Virginia Commonwealth University', 'University of Richmond', 'Virginia Union University'],
  },
};

export function getCityLocalData(city: string, state: string): CityLocalData | null {
  const key = `${city}-${state}`;
  return cityData[key] || null;
}
