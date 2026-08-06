from __future__ import annotations
import csv
import logging
import math
import os
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

GTFS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "GTFS")
MEMPHIS_TZ = ZoneInfo("America/Chicago")


def _read_csv(filename):
    path = os.path.join(GTFS_DIR, filename)
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


class GTFSService:
    def __init__(self):
        self._loaded = False
        self._stops = {}
        self._routes = {}
        self._trips = {}
        self._calendar = {}
        self._stop_times_by_trip = {}
        self._stop_to_trips = defaultdict(set)
        self._shapes = {}
        self._route_to_shape = {}
        self._route_to_shapes: dict[str, set[str]] = defaultdict(set)
        self._name_to_stop_ids: dict[str, set[str]] = defaultdict(set)
        # headsign (uppercased) -> possible GTFS route_ids (many routes share terminals)
        self._headsign_to_route_ids: dict[str, set[str]] = defaultdict(set)
        # lazy cache: route_id -> normalized stop-name tokens for matching
        self._route_stop_names_norm: dict[str, set[str]] = {}

    def load(self):
        if self._loaded:
            return
        #logger.info("Loading GTFS data from %s", GTFS_DIR)
        self._load_routes()
        self._load_stops()
        self._load_calendar()
        self._load_trips()
        self._load_stop_times()
        self._load_shapes()
        self._loaded = True
        logger.info(
            "GTFS loaded — %d routes, %d stops, %d trips, %d shapes",
            len(self._routes), len(self._stops), len(self._trips), len(self._shapes),
        )

    def _load_routes(self):
        for row in _read_csv("routes.txt"):
            rid = row["route_id"].strip()
            self._routes[rid] = {
                "id": rid,
                "short_name": row["route_short_name"].strip(),
                "long_name": row["route_long_name"].strip(),
                "color": "#" + row.get("route_color", "0080FF").strip(),
                "text_color": "#" + row.get("route_text_color", "FFFFFF").strip(),
            }

    def _load_stops(self):
        for row in _read_csv("stops.txt"):
            sid = row["stop_id"].strip()
            try:
                lat = float(row["stop_lat"])
                lon = float(row["stop_lon"])
            except (ValueError, KeyError):
                continue
            name = row["stop_name"].strip()
            self._stops[sid] = {"id": sid, "name": name, "lat": lat, "lon": lon}
            self._name_to_stop_ids[name].add(sid)

    def _load_calendar(self):
        for row in _read_csv("calendar.txt"):
            sid = row["service_id"].strip()
            self._calendar[sid] = {
                "monday": row["monday"],
                "tuesday": row["tuesday"],
                "wednesday": row["wednesday"],
                "thursday": row["thursday"],
                "friday": row["friday"],
                "saturday": row["saturday"],
                "sunday": row["sunday"],
                "start_date": row["start_date"].strip(),
                "end_date": row["end_date"].strip(),
            }

    def _load_trips(self):
        for row in _read_csv("trips.txt"):
            tid = row["trip_id"].strip()
            rid = row["route_id"].strip()
            shape_id = row.get("shape_id", "").strip()
            self._trips[tid] = {
                "trip_id": tid,
                "route_id": rid,
                "service_id": row.get("service_id", "").strip(),
                "headsign": row.get("trip_headsign", "").strip(),
                "direction_id": row.get("direction_id", "0").strip(),
                "shape_id": shape_id,
            }
            if shape_id:
                self._route_to_shapes[rid].add(shape_id)
                if rid not in self._route_to_shape:
                    self._route_to_shape[rid] = shape_id

            headsign = row.get("trip_headsign", "").strip().upper()
            if headsign:
                self._headsign_to_route_ids[headsign].add(rid)

    def _load_stop_times(self):
        rows_by_trip = defaultdict(list)
        for row in _read_csv("stop_times.txt"):
            tid = row["trip_id"].strip()
            sid = row["stop_id"].strip()
            try:
                seq = int(row["stop_sequence"])
            except (ValueError, KeyError):
                seq = 0
            dep_time = row.get("departure_time", "").strip()
            rows_by_trip[tid].append({"stop_id": sid, "stop_sequence": seq, "departure_time": dep_time})
            self._stop_to_trips[sid].add(tid)

        for tid, entries in rows_by_trip.items():
            self._stop_times_by_trip[tid] = sorted(entries, key=lambda e: e["stop_sequence"])

    def _load_shapes(self):
        points_by_shape = defaultdict(list)
        for row in _read_csv("shapes.txt"):
            shape_id = row["shape_id"].strip()
            try:
                lat = float(row["shape_pt_lat"])
                lon = float(row["shape_pt_lon"])
                seq = int(row["shape_pt_sequence"])
            except (ValueError, KeyError):
                continue
            points_by_shape[shape_id].append((seq, lat, lon))

        for shape_id, pts in points_by_shape.items():
            self._shapes[shape_id] = [[lat, lon] for _, lat, lon in sorted(pts)]

    def _active_service_ids(self):
        today = datetime.now(MEMPHIS_TZ).date()
        today_str = today.strftime("%Y%m%d")
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        today_col = day_names[today.weekday()]

        active = set()
        for sid, cal in self._calendar.items():
            if cal["start_date"] <= today_str <= cal["end_date"] and cal[today_col] == "1":
                active.add(sid)
        return active

    def _expand_stop_ids(self, stop_id: str) -> set[str]:
        stop = self._stops.get(stop_id)
        if not stop:
            return {stop_id}
        return self._name_to_stop_ids.get(stop["name"], {stop_id})

    def _make_route_entry(self, route, headsigns, shape_id):
        return {
            **route,
            "headsigns": sorted(headsigns),
            "shape_id": shape_id or self._route_to_shape.get(route["id"], ""),
        }

    def route_terminals(self, route_id: str) -> tuple[str | None, str | None]:
        
        stops = self.get_route_stops(route_id)
        if not stops:
            return None, None
        return stops[0]["name"], stops[-1]["name"]

    def route_for_destination(self, destination: str) -> dict | None:
        """Return a route only when the headsign uniquely maps to one GTFS route."""
        if not destination:
            return None
        candidates = self._headsign_to_route_ids.get(destination.strip().upper(), set())
        if len(candidates) == 1:
            rid = next(iter(candidates))
            return self._routes.get(rid)
        return None

    @staticmethod
    def _norm_tokens(value: str) -> list[str]:
        return "".join(ch if ch.isalnum() else " " for ch in value.lower()).split()

    def _route_stop_name_tokens(self, route_id: str) -> set[str]:
        cached = self._route_stop_names_norm.get(route_id)
        if cached is not None:
            return cached
        tokens: set[str] = set()
        for stop in self.get_route_stops(route_id):
            parts = self._norm_tokens(stop["name"])
            if parts:
                tokens.add(" ".join(parts))
        self._route_stop_names_norm[route_id] = tokens
        return tokens

    def _next_stop_match_score(self, route_id: str, next_stop: str | None) -> float:
        if not next_stop:
            return 0.0
        needle_parts = self._norm_tokens(next_stop)
        if not needle_parts:
            return 0.0
        needle = " ".join(needle_parts)
        names = self._route_stop_name_tokens(route_id)
        if needle in names:
            return 3.0
        # partial contains either way
        for name in names:
            if needle in name or name in needle:
                return 2.0
        # token overlap (e.g. POPLAR @ BELVEDERE vs POPLAR AVENUE at BELVEDERE)
        needle_set = set(needle_parts)
        best = 0.0
        for name in names:
            overlap = len(needle_set & set(name.split()))
            if overlap >= 2:
                best = max(best, 1.0 + 0.25 * overlap)
        return best

    def _min_distance_m_to_shape(self, shape_id: str, lat: float, lng: float) -> float:
        points = self._shapes.get(shape_id) or []
        if not points:
            return float("inf")
        step = max(1, len(points) // 80)
        best = float("inf")
        for i in range(0, len(points), step):
            plat, plon = points[i]
            dy = (plat - lat) * 111_320
            dx = (plon - lng) * 111_320 * math.cos(math.radians(lat))
            dist = math.hypot(dx, dy)
            if dist < best:
                best = dist
        return best

    def _min_distance_m_to_route(self, route_id: str, lat: float, lng: float) -> float:
        shape_ids = self._route_to_shapes.get(route_id) or set()
        if not shape_ids and route_id in self._route_to_shape:
            shape_ids = {self._route_to_shape[route_id]}
        best = float("inf")
        for shape_id in shape_ids:
            best = min(best, self._min_distance_m_to_shape(shape_id, lat, lng))
        return best

    def get_route_shape_id(
        self,
        route_id: str,
        lat: float | None = None,
        lng: float | None = None,
    ) -> str | None:
        """Return a shape for the route; prefer the one nearest to lat/lng when given."""
        shape_ids = list(self._route_to_shapes.get(route_id) or [])
        if not shape_ids:
            return self._route_to_shape.get(route_id)
        if lat is None or lng is None or len(shape_ids) == 1:
            return shape_ids[0] if shape_ids else self._route_to_shape.get(route_id)
        return min(
            shape_ids,
            key=lambda sid: self._min_distance_m_to_shape(sid, float(lat), float(lng)),
        )

    def resolve_route_for_vehicle(
        self,
        destination: str | None,
        next_stop: str | None = None,
        lat: float | None = None,
        lng: float | None = None,
        mata_route_id: str | None = None,
    ) -> dict | None:
        """
        Map a live vehicle to a GTFS route.

        Many MATA buses share terminal headsigns like "WILLIAM HUDSON". We only
        accept a headsign match when unique; otherwise disambiguate with next
        stop name and proximity to the route shape.
        """
        dest = (destination or "").strip().upper()
        candidates: set[str] = set(self._headsign_to_route_ids.get(dest, set())) if dest else set()

        # Fuzzy headsign: destination often truncates GTFS headsigns
        if not candidates and dest:
            for headsign, rids in self._headsign_to_route_ids.items():
                if dest in headsign or headsign in dest:
                    candidates |= rids

        if len(candidates) == 1:
            rid = next(iter(candidates))
            # Unique headsign can still be wrong (truncated dest / off-route). If the
            # bus is far from that route, fall through to proximity scoring.
            if lat is None or lng is None:
                return self._routes.get(rid)
            if self._min_distance_m_to_route(rid, float(lat), float(lng)) <= 1200:
                return self._routes.get(rid)
            candidates = set(self._routes.keys())

        # MATA idLigne rarely equals GTFS route_id, but try anyway
        if mata_route_id:
            by_id = self.get_route_by_id(str(mata_route_id).strip())
            if by_id and (not candidates or by_id["id"] in candidates):
                return by_id

        # No headsign candidates — score every route by next-stop + proximity
        if not candidates:
            if lat is None or lng is None:
                return None
            candidates = set(self._routes.keys())

        scored: list[tuple[float, str]] = []
        for rid in candidates:
            score = self._next_stop_match_score(rid, next_stop)
            if lat is not None and lng is not None:
                dist = self._min_distance_m_to_route(rid, float(lat), float(lng))
                # closer to shape → higher score; 0m => +2, 2km => ~0
                if dist < float("inf"):
                    score += max(0.0, 2.0 - dist / 1000.0)
            scored.append((score, rid))

        scored.sort(key=lambda t: t[0], reverse=True)
        best_score, best_rid = scored[0]
        # When searching all routes, require being fairly close to a shape
        min_score = 1.0 if len(candidates) < len(self._routes) else 1.4
        if best_score < min_score:
            return None
        # If top two are nearly tied, prefer the nearer shape when available
        if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.15:
            if lat is not None and lng is not None:
                a, b = scored[0][1], scored[1][1]
                if self._min_distance_m_to_route(a, float(lat), float(lng)) > self._min_distance_m_to_route(
                    b, float(lat), float(lng)
                ):
                    best_rid = b
        return self._routes.get(best_rid)

    def get_route_by_id(self, route_id: str) -> dict | None:
        # Try exact match first, then zero-padded variants
        for candidate in (route_id, route_id.lstrip("0") or route_id, route_id.zfill(2)):
            if candidate in self._routes:
                return self._routes[candidate]
        return None

    def get_stops(self):
        return sorted(self._stops.values(), key=lambda s: s["name"])

    def get_routes(self):
        return sorted(self._routes.values(), key=lambda r: r["short_name"])

    def get_shape(self, shape_id):
        return self._shapes.get(shape_id, [])

    def get_route_stops(self, route_id, shape_id: str | None = None):
        """Return ordered stops for a representative trip on this route.

        When shape_id is provided, prefer a trip that uses that shape so stops
        match the drawn polyline (routes often have IB/OB or branch variants).
        """
        active = self._active_service_ids()

        def pick_trip(require_active: bool, require_shape: bool) -> str | None:
            for trip_id, trip in self._trips.items():
                if trip["route_id"] != route_id:
                    continue
                if require_active and trip["service_id"] not in active:
                    continue
                if require_shape and shape_id and trip.get("shape_id") != shape_id:
                    continue
                return trip_id
            return None

        best_trip = None
        if shape_id:
            best_trip = pick_trip(require_active=True, require_shape=True) or pick_trip(
                require_active=False, require_shape=True
            )
        if not best_trip:
            best_trip = pick_trip(require_active=True, require_shape=False) or pick_trip(
                require_active=False, require_shape=False
            )

        if not best_trip:
            return []

        stops = []
        for entry in self._stop_times_by_trip.get(best_trip, []):
            stop = self._stops.get(entry["stop_id"])
            if stop:
                stops.append(stop)
        return stops

    def _parse_gtfs_minutes(self, time_str: str) -> int | None:
        if not time_str:
            return None
        try:
            parts = time_str.split(":")
            return int(parts[0]) * 60 + int(parts[1])
        except (ValueError, IndexError):
            return None

    def _active_service_ids_for_date(self, date) -> set[str]:
        date_str = date.strftime("%Y%m%d")
        day_names = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        day_col = day_names[date.weekday()]
        active = set()
        for sid, cal in self._calendar.items():
            if cal["start_date"] <= date_str <= cal["end_date"] and cal[day_col] == "1":
                active.add(sid)
        return active

    def _departures_for_route_on_date(self, route_id: str, from_ids: set[str], active: set[str], after_minutes: int | None = None) -> list[int]:
        deps: list[int] = []
        for trip_id, trip in self._trips.items():
            if trip["route_id"] != route_id:
                continue
            if trip["service_id"] not in active:
                continue
            for entry in self._stop_times_by_trip.get(trip_id, []):
                if entry["stop_id"] in from_ids:
                    dep = self._parse_gtfs_minutes(entry.get("departure_time", ""))
                    if dep is not None and (after_minutes is None or dep > after_minutes):
                        deps.append(dep)
                    break
        deps.sort()
        return deps

    def _fmt_minutes(self, dep: int) -> str:
        h, m = divmod(dep, 60)
        suffix = "AM" if h < 12 else "PM"
        display_h = h % 12 or 12
        return f"{display_h}:{m:02d} {suffix}"

    def get_next_departures(self, route_id: str, from_stop_id: str, limit: int = 3) -> dict:
        """Return upcoming departures. If none today, report next service day."""
        from_ids = self._expand_stop_ids(from_stop_id)
        now = datetime.now(MEMPHIS_TZ)
        now_minutes = now.hour * 60 + now.minute

        today_active = self._active_service_ids_for_date(now.date())
        today_deps = self._departures_for_route_on_date(route_id, from_ids, today_active, after_minutes=now_minutes)
        if today_deps:
            return {"departures": [self._fmt_minutes(d) for d in today_deps[:limit]], "next_service": None}

        from datetime import timedelta
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        for offset in range(1, 8):
            future_date = now.date() + timedelta(days=offset)
            future_active = self._active_service_ids_for_date(future_date)
            future_deps = self._departures_for_route_on_date(route_id, from_ids, future_active)
            if future_deps:
                label = "Tomorrow" if offset == 1 else day_names[future_date.weekday()]
                first = self._fmt_minutes(future_deps[0])
                return {"departures": [], "next_service": f"{label} at {first}"}

        return {"departures": [], "next_service": None}

    def plan_trip(self, from_stop_id, to_stop_id):
        active = self._active_service_ids()

        direct = self._find_direct(from_stop_id, to_stop_id, active)
        if direct:
            return {"type": "direct", "direct": direct, "transfers": []}

        reverse = self._find_direct(to_stop_id, from_stop_id, active)
        if reverse:
            return {
                "type": "wrong_direction",
                "message": "Buses on these routes run in the opposite direction for that journey.",
                "direct": reverse,
                "transfers": [],
            }

        transfers = self._find_transfers(from_stop_id, to_stop_id, active)
        if transfers:
            return {"type": "transfer", "direct": [], "transfers": transfers}

        return {"type": "none", "message": "No routes found between these stops.", "direct": [], "transfers": []}

    def _haversine_m(self, lat1, lon1, lat2, lon2):
        R = 6_371_000
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _nearby_stops(self, lat, lon, max_m=800):
        results = []
        for stop in self._stops.values():
            d = self._haversine_m(lat, lon, stop["lat"], stop["lon"])
            if d <= max_m:
                results.append((stop, d))
        results.sort(key=lambda x: x[1])
        return results

    def plan_trip_walk(self, from_lat, from_lon, to_lat, to_lon, max_walk_m=800):
        """Find a route between two coordinates, allowing walking to/from nearby stops."""
        active = self._active_service_ids()

        from_candidates = self._nearby_stops(from_lat, from_lon, max_walk_m)[:8]
        to_candidates = self._nearby_stops(to_lat, to_lon, max_walk_m)[:8]

        if not from_candidates or not to_candidates:
            return {"type": "none", "message": "No bus stops within walking distance.", "direct": [], "transfers": []}

        WALK_SPEED_MPS = 1.3  # ~5 km/h

        def make_walk(stop, dist):
            return {
                "stop": stop,
                "distance_m": round(dist),
                "minutes": max(1, round(dist / WALK_SPEED_MPS / 60)),
            }

        # Pass 1: prefer direct routes (fewest transfers)
        for from_stop, from_dist in from_candidates:
            for to_stop, to_dist in to_candidates:
                if from_stop["id"] == to_stop["id"]:
                    continue
                direct = self._find_direct(from_stop["id"], to_stop["id"], active)
                if direct:
                    return {
                        "type": "direct",
                        "direct": direct,
                        "transfers": [],
                        "from_walk": make_walk(from_stop, from_dist),
                        "to_walk": make_walk(to_stop, to_dist),
                    }

        # Pass 2: allow one transfer
        for from_stop, from_dist in from_candidates:
            for to_stop, to_dist in to_candidates:
                if from_stop["id"] == to_stop["id"]:
                    continue
                transfers = self._find_transfers(from_stop["id"], to_stop["id"], active)
                if transfers:
                    return {
                        "type": "transfer",
                        "direct": [],
                        "transfers": transfers,
                        "from_walk": make_walk(from_stop, from_dist),
                        "to_walk": make_walk(to_stop, to_dist),
                    }

        return {"type": "none", "message": "No routes found within walking distance.", "direct": [], "transfers": []}

    def _find_direct(self, from_stop_id, to_stop_id, active_services):
        from_ids = self._expand_stop_ids(from_stop_id)
        to_ids = self._expand_stop_ids(to_stop_id)
        found = {}

        for trip_id, trip in self._trips.items():
            if trip["service_id"] not in active_services:
                continue

            stops = self._stop_times_by_trip.get(trip_id, [])
            stop_positions = {entry["stop_id"]: i for i, entry in enumerate(stops)}

            from_positions = [stop_positions[sid] for sid in from_ids if sid in stop_positions]
            to_positions = [stop_positions[sid] for sid in to_ids if sid in stop_positions]

            if not from_positions or not to_positions:
                continue
            if min(from_positions) >= min(to_positions):
                continue

            route_id = trip["route_id"]
            route = self._routes.get(route_id)
            if not route:
                continue

            if route_id not in found:
                found[route_id] = {"route": route, "headsigns": set(), "shape_id": trip["shape_id"]}
            found[route_id]["headsigns"].add(trip["headsign"])

        result = []
        for entry in found.values():
            result.append(self._make_route_entry(entry["route"], entry["headsigns"], entry["shape_id"]))

        return sorted(result, key=lambda r: r["short_name"])

    def _find_transfers(self, from_stop_id, to_stop_id, active_services):
        from_ids = self._expand_stop_ids(from_stop_id)
        to_ids = self._expand_stop_ids(to_stop_id)

        reachable_via = defaultdict(set)
        leads_to_via = defaultdict(set)

        for trip_id, trip in self._trips.items():
            if trip["service_id"] not in active_services:
                continue

            stops = self._stop_times_by_trip.get(trip_id, [])
            stop_ids = [e["stop_id"] for e in stops]
            route_id = trip["route_id"]

            matched_from = next((stop_ids.index(sid) for sid in from_ids if sid in stop_ids), None)
            matched_to = next((stop_ids.index(sid) for sid in to_ids if sid in stop_ids), None)

            if matched_from is not None:
                for stop_id in stop_ids[matched_from + 1:]:
                    reachable_via[stop_id].add(route_id)

            if matched_to is not None:
                for stop_id in stop_ids[:matched_to]:
                    leads_to_via[stop_id].add(route_id)

        transfer_stops = set(reachable_via.keys()) & set(leads_to_via.keys())

        options = []
        seen = set()

        for transfer_stop_id in transfer_stops:
            stop = self._stops.get(transfer_stop_id)
            if not stop:
                continue

            for r1_id in reachable_via[transfer_stop_id]:
                for r2_id in leads_to_via[transfer_stop_id]:
                    if r1_id == r2_id:
                        continue
                    key = (r1_id, transfer_stop_id, r2_id)
                    if key in seen:
                        continue
                    seen.add(key)

                    r1 = self._routes.get(r1_id)
                    r2 = self._routes.get(r2_id)
                    if r1 and r2:
                        options.append({
                            "leg1": {**r1, "shape_id": self._route_to_shape.get(r1_id, "")},
                            "transfer_stop": stop,
                            "leg2": {**r2, "shape_id": self._route_to_shape.get(r2_id, "")},
                        })

        options.sort(key=lambda o: (o["leg1"]["short_name"], o["leg2"]["short_name"]))
        return options[:15]


gtfs = GTFSService()
