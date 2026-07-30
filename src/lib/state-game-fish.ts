// ── What you can hunt and fish, by state ────────────────────────────────────
//
// Every ZIP page shows the species found in its STATE. Deliberately
// state-level, not local: ranges inside a state vary (black bear is mountains
// and coastal-plain pockets in South Carolina, not the whole state), but a ZIP
// page cannot know where in the state you will actually go, and a per-ZIP guess
// would be wrong more often than a per-state fact.
//
// The old behaviour was a REGION lookup returning the same five generic fish
// and five generic game animals for a third of the country, so South Carolina
// and Kentucky read identically and neither mentioned alligator, redfish or
// offshore species at all.
//
// ⚠️ FRAMING MATTERS. These are species PRESENT AND PURSUED in the state, not a
// statement that a season is open or that anyone may take one. Several are
// draw/lottery only (bison, bighorn, elk in the eastern states), some are quota
// permits (alligator), and seasons move every year. The UI must say "check your
// state agency for seasons, licences and limits" alongside this data — see
// HuntingForecast / FishingForecast. Never phrase it as permission.
//
// Saltwater is split inshore / offshore. Landlocked states carry freshwater
// only. Great Lakes and large-reservoir species sit under freshwater, since
// that is what they are.

export interface StateFishing {
  freshwater: string[];
  /** Bays, sounds, estuaries, surf. Omitted for landlocked states. */
  inshore?: string[];
  /** Bluewater. Omitted for landlocked states. */
  offshore?: string[];
}

export interface StateGameFish {
  hunting: string[];
  fishing: StateFishing;
  /** Set when the state has no open hunting at all (DC). */
  noHunting?: boolean;
}


/**
 * Small game and furbearers pursued across essentially the whole lower 48.
 * Deliberately conservative — anything with a regional range lives in the
 * EASTERN_/SOUTHERN_ lists below instead. Repeating these 49 times by hand
 * invites copy-paste errors, but claiming a species where it does not occur is
 * worse, so the split is by actual range rather than convenience.
 */
const COMMON_SMALL_GAME = [
  'Squirrel', 'Cottontail rabbit', 'Raccoon', 'Coyote', 'Bobcat',
  'Red fox', 'Beaver', 'Muskrat', 'Mink', 'American crow',
];

/** Eastern + midwestern range: absent or marginal through the mountain west. */
const EASTERN_SMALL_GAME = [
  'Groundhog', 'Virginia opossum', 'Gray fox', 'Striped skunk',
  'River otter', 'American woodcock', 'Common snipe',
];

/** Panfish and rough fish in nearly every warmwater system nationally. */
const COMMON_PANFISH = [
  'Bluegill', 'Green sunfish', 'Black bullhead', 'Yellow bullhead',
  'Common carp', 'White bass',
];

/** Warmwater species of the south + central drainages, not the west. */
const SOUTHERN_ROUGH_FISH = [
  'Redear sunfish', 'Warmouth', 'Longnose gar', 'Bowfin',
  'Freshwater drum', 'Chain pickerel',
];

/** Coldwater/northern additions. */
const NORTHERN_FISH = ['Rock bass', 'Yellow perch', 'Lake whitefish', 'Cisco'];

/** Merge, de-duplicate, preserve first-seen order. */
const merge = (...lists: readonly string[][]) => [...new Set(lists.flat())];

const S = (
  hunting: string[],
  freshwater: string[],
  inshore?: string[],
  offshore?: string[],
): StateGameFish => ({
  hunting,
  fishing: inshore || offshore ? { freshwater, inshore, offshore } : { freshwater },
});

/** Keyed by two-letter abbreviation. Use getStateGameFish() — it normalises input. */
export const STATE_GAME_FISH: Record<string, StateGameFish> = {
  AL: S(
    merge(['Whitetail deer', 'Wild turkey', 'Feral hog', 'American alligator', 'Mourning dove', 'Bobwhite quail', 'Ducks & geese', 'Coyote', 'Bobcat', 'Squirrel', 'Rabbit'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Spotted bass', 'Crappie', 'Bream', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Striped bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum', 'Spotted seatrout', 'Flounder', 'Sheepshead', 'Black drum'],
    ['Red snapper', 'Grouper', 'King mackerel', 'Mahi-mahi', 'Amberjack', 'Cobia'],
  ),
  AK: S(
    ['Moose', 'Caribou', 'Sitka black-tailed deer', 'Dall sheep', 'Mountain goat', 'Brown bear', 'Black bear', 'Wolf', 'Ptarmigan', 'Ducks & geese'],
    ['King salmon', 'Silver salmon', 'Sockeye salmon', 'Rainbow trout', 'Arctic char', 'Dolly Varden', 'Northern pike', 'Arctic grayling'],
    ['Halibut', 'Rockfish', 'Lingcod', 'Dungeness crab'],
    ['Halibut', 'King salmon', 'Yelloweye rockfish'],
  ),
  AZ: S(
    merge(['Mule deer', 'Coues whitetail', 'Elk', 'Pronghorn', 'Javelina', 'Desert bighorn sheep', 'Black bear', 'Mountain lion', 'Merriam turkey', 'Mourning dove', 'Gambel quail', 'Mearns quail'], COMMON_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Striped bass', 'Channel catfish', 'Flathead catfish', 'Rainbow trout', 'Apache trout', 'Crappie', 'Bluegill', 'Walleye'], COMMON_PANFISH),
  ),
  AR: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'American alligator', 'Feral hog', 'Squirrel', 'Rabbit'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Crappie', 'Bream', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'Rainbow trout', 'Brown trout', 'Striped bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
  ),
  CA: S(
    merge(['Mule deer', 'Black-tailed deer', 'Tule elk', 'Roosevelt elk', 'Pronghorn', 'Wild pig', 'Black bear', 'Bighorn sheep', 'Wild turkey', 'Ducks & geese', 'Mourning dove', 'Valley quail'], COMMON_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Striped bass', 'Rainbow trout', 'Brown trout', 'Golden trout', 'Chinook salmon', 'Catfish', 'Crappie', 'White sturgeon'], COMMON_PANFISH),
    ['California halibut', 'Rockfish', 'Lingcod', 'Surfperch', 'Corbina', 'Dungeness crab'],
    ['Yellowtail', 'Bluefin tuna', 'Albacore', 'Dorado', 'White seabass', 'Swordfish'],
  ),
  CO: S(
    merge(['Elk', 'Mule deer', 'Whitetail deer', 'Pronghorn', 'Shiras moose', 'Bighorn sheep', 'Mountain goat', 'Black bear', 'Mountain lion', 'Wild turkey', 'Ducks & geese', 'Mourning dove'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Brown trout', 'Cutthroat trout', 'Brook trout', 'Lake trout', 'Kokanee salmon', 'Walleye', 'Largemouth bass', 'Smallmouth bass', 'Northern pike', 'Channel catfish'], COMMON_PANFISH),
  ),
  CT: S(
    merge(['Whitetail deer', 'Wild turkey', 'Ducks & geese', 'Ruffed grouse', 'Woodcock', 'Pheasant', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Brook trout', 'Brown trout', 'Rainbow trout', 'Northern pike', 'Walleye', 'Channel catfish', 'Panfish'], COMMON_PANFISH, NORTHERN_FISH),
    ['Striped bass', 'Bluefish', 'Summer flounder', 'Tautog', 'Scup', 'Black sea bass'],
    ['Bluefin tuna', 'Mahi-mahi', 'Shark'],
  ),
  DE: S(
    merge(['Whitetail deer', 'Wild turkey', 'Ducks & geese', 'Mourning dove', 'Squirrel', 'Rabbit', 'Red fox', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Crappie', 'Channel catfish', 'Bluegill', 'Striped bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Striped bass', 'Summer flounder', 'Weakfish', 'Tautog', 'Black sea bass', 'Bluefish'],
    ['Yellowfin tuna', 'Mahi-mahi', 'White marlin', 'Wahoo', 'Tilefish'],
  ),
  DC: {
    hunting: [],
    noHunting: true,
    fishing: {
      freshwater: ['Largemouth bass', 'Channel catfish', 'Blue catfish', 'Striped bass', 'White perch', 'Northern snakehead', 'Bluegill', 'Crappie'],
    },
  },
  FL: S(
    merge(['Whitetail deer', 'Osceola turkey', 'Feral hog', 'American alligator', 'Black bear', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Snipe'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Peacock bass', 'Black crappie', 'Bluegill', 'Channel catfish', 'Sunshine bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Snook', 'Red drum', 'Spotted seatrout', 'Tarpon', 'Flounder', 'Sheepshead', 'Pompano'],
    ['Mahi-mahi', 'Sailfish', 'Blue marlin', 'King mackerel', 'Red snapper', 'Grouper', 'Wahoo', 'Yellowfin tuna'],
  ),
  GA: S(
    merge(['Whitetail deer', 'Wild turkey', 'Feral hog', 'Black bear', 'American alligator', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Squirrel', 'Rabbit'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Shoal bass', 'Spotted bass', 'Striped bass', 'Hybrid bass', 'Crappie', 'Bream', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Rainbow trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum', 'Spotted seatrout', 'Flounder', 'Sheepshead', 'Tarpon'],
    ['King mackerel', 'Mahi-mahi', 'Red snapper', 'Grouper', 'Wahoo', 'Cobia'],
  ),
  HI: S(
    ['Axis deer', 'Black-tailed deer', 'Mouflon sheep', 'Feral goat', 'Feral pig', 'Ring-necked pheasant', 'Francolin', 'Quail', 'Wild turkey'],
    ['Peacock bass', 'Largemouth bass', 'Tilapia', 'Channel catfish'],
    ['Bonefish (oio)', 'Giant trevally (ulua)', 'Bluefin trevally (papio)', 'Goatfish'],
    ['Yellowfin tuna (ahi)', 'Mahi-mahi', 'Wahoo (ono)', 'Blue marlin', 'Skipjack tuna (aku)'],
  ),
  ID: S(
    merge(['Elk', 'Mule deer', 'Whitetail deer', 'Shiras moose', 'Pronghorn', 'Bighorn sheep', 'Mountain goat', 'Black bear', 'Mountain lion', 'Gray wolf', 'Wild turkey', 'Chukar', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Cutthroat trout', 'Bull trout', 'Brook trout', 'Steelhead', 'Chinook salmon', 'Kokanee salmon', 'White sturgeon', 'Smallmouth bass', 'Largemouth bass', 'Walleye', 'Northern pike'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  IL: S(
    merge(['Whitetail deer', 'Wild turkey', 'Ducks & geese', 'Mourning dove', 'Pheasant', 'Bobwhite quail', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'Sauger', 'Muskellunge', 'Northern pike', 'White bass', 'Chinook salmon', 'Coho salmon', 'Lake trout', 'Steelhead', 'Yellow perch'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
  ),
  IN: S(
    merge(['Whitetail deer', 'Wild turkey', 'Ducks & geese', 'Mourning dove', 'Pheasant', 'Bobwhite quail', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Flathead catfish', 'Walleye', 'Muskellunge', 'Northern pike', 'Chinook salmon', 'Coho salmon', 'Lake trout', 'Steelhead', 'Yellow perch'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
  ),
  IA: S(
    merge(['Whitetail deer', 'Wild turkey', 'Pheasant', 'Bobwhite quail', 'Ducks & geese', 'Mourning dove', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Walleye', 'Crappie', 'Bluegill', 'Channel catfish', 'Flathead catfish', 'Muskellunge', 'Northern pike', 'Rainbow trout', 'Brown trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
  ),
  KS: S(
    merge(['Whitetail deer', 'Mule deer', 'Pronghorn', 'Elk', 'Wild turkey', 'Pheasant', 'Bobwhite quail', 'Greater prairie chicken', 'Ducks & geese', 'Mourning dove'], COMMON_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'White bass', 'Walleye', 'Sauger', 'Crappie', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Wiper', 'Rainbow trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
  ),
  KY: S(
    merge(['Whitetail deer', 'Elk', 'Wild turkey', 'Black bear', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Striped bass', 'Hybrid striped bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Sauger', 'Walleye', 'Muskellunge', 'Rainbow trout', 'Brown trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
  ),
  LA: S(
    merge(['Whitetail deer', 'Wild turkey', 'American alligator', 'Feral hog', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Rabbit', 'Squirrel', 'Woodcock'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Crappie (sac-a-lait)', 'Bream', 'Blue catfish', 'Channel catfish', 'Flathead catfish', 'White bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum', 'Spotted seatrout', 'Flounder', 'Sheepshead', 'Black drum', 'Tripletail'],
    ['Yellowfin tuna', 'Red snapper', 'Grouper', 'King mackerel', 'Mahi-mahi', 'Wahoo', 'Cobia', 'Amberjack'],
  ),
  ME: S(
    merge(['Whitetail deer', 'Moose', 'Black bear', 'Wild turkey', 'Ruffed grouse', 'Woodcock', 'Ducks & geese', 'Snowshoe hare', 'Coyote', 'Bobcat'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Brook trout', 'Brown trout', 'Rainbow trout', 'Lake trout (togue)', 'Landlocked salmon', 'Smallmouth bass', 'Largemouth bass', 'Chain pickerel', 'White perch'], COMMON_PANFISH, NORTHERN_FISH),
    ['Striped bass', 'Atlantic mackerel', 'Winter flounder', 'Pollock'],
    ['Bluefin tuna', 'Cod', 'Haddock', 'Halibut'],
  ),
  MD: S(
    merge(['Whitetail deer', 'Sika deer', 'Wild turkey', 'Black bear', 'Ducks & geese', 'Mourning dove', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Rainbow trout', 'Walleye', 'Northern snakehead'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
    ['Striped bass (rockfish)', 'White perch', 'Spot', 'Croaker', 'Bluefish', 'Summer flounder'],
    ['Yellowfin tuna', 'Mahi-mahi', 'White marlin', 'Wahoo', 'Black sea bass'],
  ),
  MA: S(
    merge(['Whitetail deer', 'Wild turkey', 'Black bear', 'Ducks & geese', 'Ruffed grouse', 'Woodcock', 'Pheasant', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Brook trout', 'Brown trout', 'Rainbow trout', 'Landlocked salmon', 'Northern pike', 'Walleye', 'Panfish'], COMMON_PANFISH, NORTHERN_FISH),
    ['Striped bass', 'Bluefish', 'Summer flounder', 'Tautog', 'Scup', 'Black sea bass'],
    ['Bluefin tuna', 'Cod', 'Haddock', 'Mahi-mahi', 'Shark'],
  ),
  MI: S(
    merge(['Whitetail deer', 'Elk', 'Black bear', 'Wild turkey', 'Ducks & geese', 'Ruffed grouse', 'Woodcock', 'Pheasant', 'Rabbit', 'Coyote', 'Bobcat'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Walleye', 'Yellow perch', 'Muskellunge', 'Northern pike', 'Lake trout', 'Brown trout', 'Rainbow trout', 'Brook trout', 'Chinook salmon', 'Coho salmon', 'Steelhead', 'Lake whitefish'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  MN: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Ducks & geese', 'Ruffed grouse', 'Pheasant', 'Woodcock', 'Rabbit', 'Coyote', 'Bobcat'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Walleye', 'Northern pike', 'Muskellunge', 'Largemouth bass', 'Smallmouth bass', 'Crappie', 'Bluegill', 'Lake trout', 'Brook trout', 'Brown trout', 'Rainbow trout', 'Channel catfish', 'Lake sturgeon', 'Steelhead'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  MS: S(
    merge(['Whitetail deer', 'Wild turkey', 'Feral hog', 'American alligator', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Squirrel', 'Rabbit', 'Raccoon'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Crappie', 'Bream', 'Blue catfish', 'Channel catfish', 'Flathead catfish', 'White bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum', 'Spotted seatrout', 'Flounder', 'Sheepshead', 'Black drum'],
    ['Red snapper', 'Grouper', 'King mackerel', 'Mahi-mahi', 'Yellowfin tuna', 'Cobia'],
  ),
  MO: S(
    merge(['Whitetail deer', 'Wild turkey', 'Black bear', 'Elk', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Pheasant', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'White bass', 'Rainbow trout', 'Brown trout', 'Paddlefish'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
  ),
  MT: S(
    merge(['Elk', 'Mule deer', 'Whitetail deer', 'Pronghorn', 'Shiras moose', 'Bighorn sheep', 'Mountain goat', 'Black bear', 'Mountain lion', 'Gray wolf', 'Wild turkey', 'Sharp-tailed grouse', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Brown trout', 'Brook trout', 'Cutthroat trout', 'Bull trout', 'Walleye', 'Northern pike', 'Smallmouth bass', 'Lake trout', 'Kokanee salmon', 'Paddlefish', 'Sauger'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  NE: S(
    merge(['Whitetail deer', 'Mule deer', 'Pronghorn', 'Elk', 'Wild turkey', 'Pheasant', 'Bobwhite quail', 'Greater prairie chicken', 'Sharp-tailed grouse', 'Ducks & geese', 'Mourning dove'], COMMON_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'White bass', 'Walleye', 'Sauger', 'Crappie', 'Bluegill', 'Channel catfish', 'Flathead catfish', 'Northern pike', 'Wiper', 'Rainbow trout'], COMMON_PANFISH),
  ),
  NV: S(
    merge(['Mule deer', 'Elk', 'Pronghorn', 'Desert bighorn sheep', 'Mountain lion', 'Black bear', 'Chukar', 'California quail', 'Sage grouse', 'Ducks & geese', 'Mourning dove'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Brown trout', 'Lahontan cutthroat trout', 'Kokanee salmon', 'Largemouth bass', 'Smallmouth bass', 'Striped bass', 'Walleye', 'Channel catfish', 'Crappie', 'Wiper'], COMMON_PANFISH),
  ),
  NH: S(
    merge(['Whitetail deer', 'Moose', 'Black bear', 'Wild turkey', 'Ruffed grouse', 'Woodcock', 'Ducks & geese', 'Snowshoe hare', 'Coyote', 'Pheasant'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Brook trout', 'Brown trout', 'Rainbow trout', 'Lake trout', 'Landlocked salmon', 'Smallmouth bass', 'Largemouth bass', 'Northern pike', 'Chain pickerel', 'White perch'], COMMON_PANFISH, NORTHERN_FISH),
    ['Striped bass', 'Atlantic mackerel', 'Pollock', 'Winter flounder'],
    ['Bluefin tuna', 'Cod', 'Haddock'],
  ),
  NJ: S(
    merge(['Whitetail deer', 'Wild turkey', 'Black bear', 'Ducks & geese', 'Mourning dove', 'Pheasant', 'Bobwhite quail', 'Ruffed grouse', 'Rabbit', 'Squirrel', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Rainbow trout', 'Brown trout', 'Brook trout', 'Muskellunge', 'Northern pike', 'Walleye', 'Channel catfish', 'Panfish'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
    ['Striped bass', 'Bluefish', 'Summer flounder', 'Weakfish', 'Tautog', 'Black sea bass'],
    ['Yellowfin tuna', 'Mahi-mahi', 'White marlin', 'Wahoo', 'Golden tilefish'],
  ),
  NM: S(
    merge(['Elk', 'Mule deer', 'Coues whitetail', 'Pronghorn', 'Bighorn sheep', 'Oryx', 'Javelina', 'Barbary sheep', 'Black bear', 'Mountain lion', 'Merriam turkey', 'Scaled quail', 'Mourning dove', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Brown trout', 'Rio Grande cutthroat trout', 'Kokanee salmon', 'Largemouth bass', 'Smallmouth bass', 'Striped bass', 'White bass', 'Walleye', 'Channel catfish', 'Crappie'], COMMON_PANFISH),
  ),
  NY: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Ducks & geese', 'Ruffed grouse', 'Woodcock', 'Pheasant', 'Snowshoe hare', 'Coyote', 'Bobcat'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Walleye', 'Northern pike', 'Muskellunge', 'Lake trout', 'Brown trout', 'Rainbow trout', 'Brook trout', 'Landlocked salmon', 'Chinook salmon', 'Coho salmon', 'Steelhead', 'Yellow perch'], COMMON_PANFISH, NORTHERN_FISH),
    ['Striped bass', 'Bluefish', 'Summer flounder', 'Tautog', 'Scup', 'Black sea bass'],
    ['Yellowfin tuna', 'Mahi-mahi', 'White marlin', 'Golden tilefish'],
  ),
  NC: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Feral hog', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Ruffed grouse', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Striped bass', 'Crappie', 'Bream', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'Muskellunge', 'Rainbow trout', 'Brown trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum', 'Spotted seatrout', 'Flounder', 'Sheepshead', 'Striped bass', 'Cobia'],
    ['Mahi-mahi', 'King mackerel', 'Wahoo', 'Yellowfin tuna', 'Blue marlin', 'Red snapper', 'Grouper'],
  ),
  ND: S(
    merge(['Whitetail deer', 'Mule deer', 'Pronghorn', 'Elk', 'Moose', 'Bighorn sheep', 'Wild turkey', 'Pheasant', 'Sharp-tailed grouse', 'Greater prairie chicken', 'Ducks & geese', 'Mourning dove'], COMMON_SMALL_GAME),
    merge(['Walleye', 'Northern pike', 'Smallmouth bass', 'Yellow perch', 'Chinook salmon', 'Rainbow trout', 'Channel catfish', 'Sauger', 'Lake sturgeon'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  OH: S(
    merge(['Whitetail deer', 'Wild turkey', 'Ducks & geese', 'Mourning dove', 'Pheasant', 'Bobwhite quail', 'Ruffed grouse', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'White bass', 'Walleye', 'Saugeye', 'Crappie', 'Bluegill', 'Channel catfish', 'Flathead catfish', 'Blue catfish', 'Muskellunge', 'Steelhead', 'Yellow perch'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
  ),
  OK: S(
    merge(['Whitetail deer', 'Mule deer', 'Elk', 'Pronghorn', 'Rio Grande turkey', 'Black bear', 'Feral hog', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Greater prairie chicken'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'White bass', 'Striped bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'Paddlefish', 'Rainbow trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
  ),
  OR: S(
    merge(['Roosevelt elk', 'Rocky Mountain elk', 'Black-tailed deer', 'Mule deer', 'Pronghorn', 'Bighorn sheep', 'Mountain goat', 'Black bear', 'Cougar', 'Wild turkey', 'Chukar', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Chinook salmon', 'Coho salmon', 'Steelhead', 'Rainbow trout', 'Cutthroat trout', 'Brown trout', 'Bull trout', 'White sturgeon', 'Smallmouth bass', 'Largemouth bass', 'Walleye', 'Kokanee salmon'], COMMON_PANFISH),
    ['Rockfish', 'Lingcod', 'Surfperch', 'Dungeness crab'],
    ['Albacore tuna', 'Pacific halibut', 'Chinook salmon'],
  ),
  PA: S(
    merge(['Whitetail deer', 'Black bear', 'Elk', 'Wild turkey', 'Ruffed grouse', 'Pheasant', 'Ducks & geese', 'Mourning dove', 'Squirrel', 'Rabbit', 'Coyote', 'Bobcat'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Walleye', 'Muskellunge', 'Northern pike', 'Brown trout', 'Rainbow trout', 'Brook trout', 'Channel catfish', 'Flathead catfish', 'Steelhead', 'Yellow perch'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  RI: S(
    merge(['Whitetail deer', 'Wild turkey', 'Ducks & geese', 'Pheasant', 'Ruffed grouse', 'Rabbit', 'Squirrel', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Brook trout', 'Brown trout', 'Rainbow trout', 'Northern pike', 'Panfish'], COMMON_PANFISH, NORTHERN_FISH),
    ['Striped bass', 'Bluefish', 'Summer flounder', 'Tautog', 'Scup', 'Black sea bass'],
    ['Bluefin tuna', 'Mahi-mahi', 'Shark', 'Cod'],
  ),
  SC: S(
    merge(['Whitetail deer', 'Wild turkey', 'Black bear', 'American alligator', 'Feral hog', 'Fox', 'Coyote', 'Bobcat', 'Canada goose', 'Ducks', 'Rails', 'Mourning dove', 'Bobwhite quail', 'Squirrel', 'Rabbit'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Crappie', 'Blue catfish', 'Flathead catfish', 'Bream', 'Rainbow trout', 'Brown trout', 'Striped bass'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum (redfish)', 'Spotted seatrout', 'Flounder', 'Sheepshead'],
    ['Mahi-mahi', 'King mackerel', 'Snapper', 'Grouper', 'Billfish'],
  ),
  SD: S(
    merge(['Whitetail deer', 'Mule deer', 'Pronghorn', 'Elk', 'Bighorn sheep', 'Mountain goat', 'Wild turkey', 'Pheasant', 'Sharp-tailed grouse', 'Greater prairie chicken', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Walleye', 'Northern pike', 'Smallmouth bass', 'Yellow perch', 'Chinook salmon', 'Channel catfish', 'Rainbow trout', 'Paddlefish'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  TN: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Elk', 'Feral hog', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Ruffed grouse', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Striped bass', 'White bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'Sauger', 'Muskellunge', 'Rainbow trout', 'Brown trout', 'Brook trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
  ),
  TX: S(
    merge(['Whitetail deer', 'Mule deer', 'Pronghorn', 'Elk', 'Javelina', 'Feral hog', 'American alligator', 'Aoudad', 'Nilgai', 'Axis deer', 'Rio Grande turkey', 'Mourning dove', 'Bobwhite quail', 'Ducks & geese', 'Sandhill crane'], COMMON_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Guadalupe bass', 'White bass', 'Striped bass', 'Crappie', 'Bluegill', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Alligator gar', 'Rainbow trout'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Red drum', 'Spotted seatrout', 'Flounder', 'Sheepshead', 'Black drum'],
    ['Red snapper', 'King mackerel', 'Mahi-mahi', 'Yellowfin tuna', 'Wahoo', 'Blue marlin', 'Cobia', 'Amberjack'],
  ),
  UT: S(
    merge(['Mule deer', 'Elk', 'Pronghorn', 'Shiras moose', 'Bighorn sheep', 'Mountain goat', 'Bison', 'Black bear', 'Cougar', 'Wild turkey', 'Chukar', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Brown trout', 'Cutthroat trout', 'Brook trout', 'Tiger trout', 'Lake trout', 'Kokanee salmon', 'Largemouth bass', 'Smallmouth bass', 'Striped bass', 'Walleye', 'Channel catfish', 'Crappie', 'Tiger muskellunge'], COMMON_PANFISH),
  ),
  VT: S(
    merge(['Whitetail deer', 'Black bear', 'Moose', 'Wild turkey', 'Ruffed grouse', 'Woodcock', 'Ducks & geese', 'Snowshoe hare', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Brook trout', 'Brown trout', 'Rainbow trout', 'Lake trout', 'Landlocked salmon', 'Smallmouth bass', 'Largemouth bass', 'Northern pike', 'Walleye', 'Yellow perch', 'Panfish'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  VA: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Elk', 'Ducks & geese', 'Mourning dove', 'Bobwhite quail', 'Ruffed grouse', 'Squirrel', 'Rabbit', 'Coyote'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Striped bass', 'Crappie', 'Bream', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Walleye', 'Muskellunge', 'Rainbow trout', 'Brook trout', 'Northern snakehead'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH),
    ['Striped bass', 'Red drum', 'Spotted seatrout', 'Summer flounder', 'Cobia', 'Croaker', 'Spot'],
    ['Yellowfin tuna', 'Mahi-mahi', 'White marlin', 'Wahoo', 'Black sea bass', 'Golden tilefish'],
  ),
  WA: S(
    merge(['Roosevelt elk', 'Rocky Mountain elk', 'Black-tailed deer', 'Mule deer', 'Whitetail deer', 'Moose', 'Bighorn sheep', 'Mountain goat', 'Black bear', 'Cougar', 'Wild turkey', 'Chukar', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Chinook salmon', 'Coho salmon', 'Sockeye salmon', 'Steelhead', 'Rainbow trout', 'Cutthroat trout', 'Bull trout', 'White sturgeon', 'Walleye', 'Smallmouth bass', 'Largemouth bass', 'Kokanee salmon'], COMMON_PANFISH, NORTHERN_FISH),
    ['Rockfish', 'Lingcod', 'Pacific halibut', 'Dungeness crab', 'Surfperch'],
    ['Albacore tuna', 'Pacific halibut', 'Chinook salmon'],
  ),
  WV: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Ducks & geese', 'Ruffed grouse', 'Squirrel', 'Rabbit', 'Coyote', 'Bobcat', 'Wild boar'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Largemouth bass', 'Smallmouth bass', 'Spotted bass', 'Walleye', 'Muskellunge', 'Channel catfish', 'Blue catfish', 'Flathead catfish', 'Rainbow trout', 'Brown trout', 'Brook trout', 'Crappie', 'Bluegill'], COMMON_PANFISH, SOUTHERN_ROUGH_FISH, NORTHERN_FISH),
  ),
  WI: S(
    merge(['Whitetail deer', 'Black bear', 'Wild turkey', 'Elk', 'Ducks & geese', 'Ruffed grouse', 'Pheasant', 'Woodcock', 'Rabbit', 'Coyote', 'Bobcat'], COMMON_SMALL_GAME, EASTERN_SMALL_GAME),
    merge(['Walleye', 'Muskellunge', 'Northern pike', 'Largemouth bass', 'Smallmouth bass', 'Crappie', 'Bluegill', 'Yellow perch', 'Lake trout', 'Brown trout', 'Rainbow trout', 'Brook trout', 'Chinook salmon', 'Coho salmon', 'Lake sturgeon'], COMMON_PANFISH, NORTHERN_FISH),
  ),
  WY: S(
    merge(['Elk', 'Mule deer', 'Whitetail deer', 'Pronghorn', 'Shiras moose', 'Bighorn sheep', 'Mountain goat', 'Bison', 'Black bear', 'Mountain lion', 'Wild turkey', 'Sage grouse', 'Ducks & geese'], COMMON_SMALL_GAME),
    merge(['Rainbow trout', 'Brown trout', 'Cutthroat trout', 'Brook trout', 'Lake trout', 'Kokanee salmon', 'Walleye', 'Smallmouth bass', 'Burbot', 'Sauger'], COMMON_PANFISH, NORTHERN_FISH),
  ),
};

/** Full-name -> abbreviation, so either form works. */
const FULL_TO_ABBR: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI',
  MINNESOTA: 'MN', MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT',
  NEBRASKA: 'NE', NEVADA: 'NV', 'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM', 'NEW YORK': 'NY', 'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK', OREGON: 'OR',
  PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT',
  VERMONT: 'VT', VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI', WYOMING: 'WY',
};

/**
 * Accepts "SC" or "South Carolina". The ZIP pages pass the FULL name
 * (lookupZip returns "South Carolina"), which is exactly the mismatch that had
 * every state-keyed table in local-content.ts silently falling through to its
 * default — so this normalises rather than assuming.
 */
export function getStateGameFish(state: string | undefined): StateGameFish | null {
  if (!state) return null;
  const raw = state.trim().toUpperCase();
  const abbr = raw.length <= 3 ? raw : FULL_TO_ABBR[raw] ?? '';
  return STATE_GAME_FISH[abbr] ?? null;
}

/** True when the state has saltwater access. */
export function hasSaltwater(data: StateGameFish): boolean {
  return Boolean(data.fishing.inshore?.length || data.fishing.offshore?.length);
}
