"""Build src/lib/fcs-venues.ts from ESPN's FCS team list (2026-11-11).

Why: FBS-vs-FCS games had no HvL market because the visiting FCS team had no
venue on file. Derek: "we have to put their venues and the zip codes of those
venues in the system." See the header of src/lib/fcs-venues.ts.

ESPN's core API gives each FCS team's stadium name, city, state and ZIP, but
no coordinates, so coordinates are the ZIP centroid from us-zip-codes.json.
Also adds each team's ESPN ID and logo to team-espn-ids.json / team-logos.json
(the same files scripts/build-team-logos.mjs writes for every other venue).

Run from the repo root:  python -I scripts/build-fcs-venues.py
Review the diff before committing; ESPN's data has errors (see FIX_* below).
"""
import json
import re
import sys
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SEASON = 2026
BASE = f"https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{SEASON}"
FCS_GROUP = 81

# ESPN publishes no ZIP for UTRGV (Edinburg, TX), and gives NC A&T the ZIP of
# the Braves' Truist Park in Atlanta (30339) for its Greensboro stadium, and
# Mercer (Macon, GA) a Colorado ZIP (80229).
FIX_ZIP = {"UT Rio Grande Valley Vaqueros": "78539", "North Carolina A&T Aggies": "27411", "Mercer Bears": "31207"}
# ESPN marks this open-air stadium as indoor.
FIX_TYPE = {"UAlbany Great Danes": "outdoor"}

# Mirror of MULTI_WORD_MASCOTS in src/lib/venue-slug.ts, used only to predict
# slugs so a collision with an existing college venue can be avoided.
MULTI = [
    "Crimson Tide", "Red Sox", "White Sox", "Blue Jays", "Yellow Jackets", "Rainbow Warriors",
    "Fighting Illini", "Golden Flashes", "Thundering Herd", "Blue Raiders",
    "Golden Gophers", "Tar Heels", "Mean Green", "Fighting Irish", "Nittany Lions",
    "Scarlet Knights", "Golden Eagles", "Horned Frogs", "Red Raiders", "Green Wave",
    "Golden Hurricane", "Demon Deacons", "Ragin' Cajuns", "Golden Bears", "Blue Devils",
    "Wolf Pack", "Black Knights", "Sun Devils", "Red Wolves", "Blue Hens",
    # FCS
    "Golden Lions", "Fighting Camels", "Big Red", "Big Green", "Runnin' Bulldogs", "Fighting Hawks", "Blue Hose", "Great Danes", "Mountain Hawks", "Black Bears", "Red Foxes", "Delta Devils",
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_team(team_id):
    t = get(f"{BASE}/teams/{team_id}")
    v = t.get("venue") or {}
    a = v.get("address") or {}
    conf = None
    try:
        conf = get(t["groups"]["$ref"]).get("shortName")
    except Exception:
        pass
    return {
        "id": team_id,
        "team": t["displayName"],
        "logo": (t.get("logos") or [{}])[0].get("href"),
        "venue": v.get("fullName"),
        "city": a.get("city"),
        "state": a.get("state"),
        "zip": a.get("zipCode"),
        "indoor": v.get("indoor"),
        "conf": conf,
    }


def slugify(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


def market(team):
    for m in MULTI:
        if team.endswith(" " + m):
            return team[: -(len(m) + 1)]
    return team.rsplit(" ", 1)[0] if " " in team else team


def ts(s):
    """A single-quoted TypeScript string literal."""
    return "'" + str(s).replace("\\", "\\\\").replace("'", "\\'") + "'"


def main():
    items = get(f"{BASE}/types/2/groups/{FCS_GROUP}/teams?limit=300")["items"]
    team_ids = [i["$ref"].split("/teams/")[1].split("?")[0] for i in items]
    with ThreadPoolExecutor(12) as ex:
        teams = [t for t in ex.map(fetch_team, team_ids) if t["venue"]]

    zips = {z["z"]: z for z in json.load(open("src/data/us-zip-codes.json"))}
    # FIX_ZIP wins over ESPN's ZIP, not just when ESPN has none.
    for t in teams:
        if t["team"] in FIX_ZIP:
            t["zip"] = FIX_ZIP[t["team"]]
    src = open("src/lib/venue-data.ts", encoding="utf8").read()
    existing = set()
    for m in re.finditer(r"team: '((?:[^'\\]|\\.)*)'[^}]*league: 'ncaa-football'", src):
        existing.add(slugify(market(m.group(1).replace("\\'", "'"))))

    ids = json.load(open("src/data/team-espn-ids.json"))
    logos = json.load(open("src/data/team-logos.json"))
    # Drop rows from a previous run so a team ESPN no longer lists goes away.
    ids = {k: v for k, v in ids.items() if not k.startswith("fcs-")}
    logos = {k: v for k, v in logos.items() if not k.startswith("fcs-")}

    rows, seen, problems = [], set(), []
    for t in sorted(teams, key=lambda t: t["team"]):
        z = (t["zip"] or FIX_ZIP.get(t["team"]) or "")[:5]
        zz = zips.get(z)
        if not zz:
            problems.append(f"{t['team']}: no usable ZIP ({t['zip']!r})")
            continue
        if t["state"] and zz["s"] != t["state"]:
            problems.append(f"{t['team']}: ZIP {z} is in {zz['s']}, stadium is in {t['state']}; skipped, add a FIX_ZIP entry")
            continue
        slug = slugify(market(t["team"]))
        if slug in existing or slug in seen:
            problems.append(f"{t['team']}: slug '{slug}' collides, skipped; add a SLUG_OVERRIDES entry by hand")
            continue
        seen.add(slug)
        vid = "fcs-" + slug
        kind = FIX_TYPE.get(t["team"], "indoor" if t["indoor"] else "outdoor")
        rows.append(
            f"  {{ id: {ts(vid)}, name: {ts(t['venue'])}, team: {ts(t['team'])}, sport: 'football', "
            f"lat: {zz['lat']}, lon: {zz['lon']}, city: {ts(t['city'] or zz['c'])}, state: {ts(t['state'] or zz['s'])}, "
            f"zip: {ts(z)}, capacity: 0, type: '{kind}', league: 'ncaa-football', "
            f"conference: {ts(t['conf'] or 'FCS Indep.')}, division: 'FCS' }},"
        )
        ids[vid] = {"leaguePath": "football/college-football", "teamId": t["id"]}
        if t["logo"]:
            logos[vid] = t["logo"]

    out = open("src/lib/fcs-venues.ts", "w", encoding="utf8", newline="\n")
    out.write(HEADER)
    out.write("\n".join(rows) + "\n];\n")
    out.close()
    for path, data in (("src/data/team-espn-ids.json", ids), ("src/data/team-logos.json", logos)):
        with open(path, "w", newline="\n") as f:
            f.write(json.dumps(dict(sorted(data.items())), indent=2) + "\n")
    print(f"{len(rows)} FCS venues written")
    for p in problems:
        print("  PROBLEM:", p, file=sys.stderr)


HEADER = """// FCS football stadiums. GENERATED by scripts/build-fcs-venues.py from ESPN's
// FCS team list; edit that script, not this file.
//
// Why these exist: Derek, 2026-11-11, on FBS-vs-FCS games with no HvL market
// (Charleston Southern at Clemson, The Citadel at Texas A&M, Elon at Stanford):
// "we have to put their venues and the zip codes of those venues in the
// system." The HvL, HvH and LvL markets compare the two teams' home cities, so
// a game whose visitor had no venue on file was skipped as "missing venue data".
//
// Coordinates are the centroid of the stadium's ZIP code (ESPN publishes the
// ZIP but not the coordinates), well within the accuracy of a daily high or
// low. Capacity is 0 (unknown), which every page already hides.
//
// AWAY ONLY: an FCS venue stands for the visiting team's home city, never for
// the site of a game. See isFcsVenue() in venue-data.ts and its callers.
// Putting every FCS-vs-FCS game on the board would roughly double Saturday's
// forecast fetches (Open-Meteo already rate-limits us) and start auto-creating
// markets for games nobody asked for.

import type { Venue } from './types';

export const FCS_VENUES: Venue[] = [
"""

if __name__ == "__main__":
    main()
