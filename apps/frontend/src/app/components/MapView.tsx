"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from "react";
import Map, {
  Marker,
  Popup,
  Source,
  Layer,
  type MapRef,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import type { FeatureCollection, LineString } from "geojson";
import { Bus3DLayer, syncBus3DLayer, BUS_3D_LAYER_ID } from "./Bus3DLayer";
import "maplibre-gl/dist/maplibre-gl.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5001";
// CARTO Voyager includes naturally colored water, parks, land use, and roads.
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
const MEMPHIS: [number, number] = [-90.049, 35.1495]; // [lng, lat]
const MAP_PITCH = 0; // default load is top-down / 2D-like; user can still tilt
/** Highlight color for selected bus / trip-plan routes on the map. */
const ROUTE_HIGHLIGHT_COLOR = "#F97316";

interface Vehicle {
  id: number;
  equipment_number: string;
  type: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  route_id: number | null;
  gtfs_route_id: string | null;
  route_short_name: string | null;
  route_long_name: string | null;
  route_color: string | null;
  route_shape_id: string | null;
  terminal_start: string | null;
  terminal_end: string | null;
  destination: string | null;
  speed: number | null;
  status: string;
  status_raw: string;
  next_stop: string | null;
  eta_minutes: number | null;
  load: string | null;
}

interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

interface RouteResult {
  id: string;
  short_name: string;
  long_name: string;
  color: string;
  text_color: string;
  headsigns?: string[];
  shape_id: string;
}

interface ReportBusInfo {
  id: number;
  equipmentNumber: string;
  routeShortName: string | null;
  routeLongName: string | null;
  routeColor: string | null;
}

interface MapViewProps {
  fromStop: Stop | null;
  toStop: Stop | null;
  routeResults: RouteResult[];
  selectedRouteId: string | null;
  onRouteSelect: (routeId: string) => void;
  onReportIssue: (bus: ReportBusInfo) => void;
  userLocation?: { lat: number; lon: number } | null;
}

function statusColor(status: string): string {
  if (status === "on-time") return "#0959b6";
  if (status === "delayed") return "#dc2626";
  if (status === "early") return "#16a34a";
  return "#555";
}

function StopDot({ color }: { color: string }) {
  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        border: "2px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
      }}
      title=""
    />
  );
}

/** Google Maps–style white stop disc along a highlighted bus route. */
function BusRouteStopCircle({
  isNext,
  faded,
  title,
}: {
  isNext?: boolean;
  faded?: boolean;
  title?: string;
}) {
  const size = isNext && !faded ? 14 : 10;
  return (
    <div
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: faded ? "rgba(255,255,255,0.45)" : "#ffffff",
        border: faded
          ? "2px solid rgba(15, 23, 42, 0.2)"
          : isNext
            ? "3px solid #F97316"
            : "2px solid rgba(15, 23, 42, 0.55)",
        boxShadow: faded
          ? "none"
          : isNext
            ? "0 0 0 4px rgba(249, 115, 22, 0.25), 0 1px 4px rgba(0,0,0,0.3)"
            : "0 1px 4px rgba(0,0,0,0.28)",
        opacity: faded ? 0.2 : 1,
      }}
    />
  );
}

function normalizeStopLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function stopNameMatches(stopName: string, nextStop: string | null): boolean {
  if (!nextStop) return false;
  const a = normalizeStopLabel(stopName);
  const b = normalizeStopLabel(nextStop);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function TerminalPin({
  color,
  label,
  stopName,
}: {
  color: string;
  label: string;
  stopName: string;
}) {
  const path =
    label === "START"
      ? "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
      : "M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: "Inter,sans-serif",
      }}
      title={stopName}
    >
      <div
        style={{
          background: color,
          color: "#fff",
          padding: "4px 8px",
          borderRadius: 8,
          fontSize: 10,
          fontWeight: 700,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          border: "2px solid #fff",
          maxWidth: 140,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="#fff">
          <path d={path} />
        </svg>
        <span>{label}</span>
        <span
          style={{
            opacity: 0.85,
            fontWeight: 400,
            maxWidth: 100,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {stopName}
        </span>
      </div>
      <div style={{ width: 2, height: 8, background: color, opacity: 0.7 }} />
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          border: "2px solid #fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        }}
      />
    </div>
  );
}

function CirclePin({ color, title }: { color: string; title?: string }) {
  return (
    <div
      title={title}
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: color,
        border: "2.5px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
        cursor: "pointer",
      }}
    />
  );
}

function UserLocationDot() {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title="Your location"
    >
      <div
        style={{
          position: "absolute",
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "rgba(9,89,182,0.25)",
          animation: "marc-pulse-ring 1.4s ease-out infinite",
        }}
      />
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "#0959b6",
          border: "2px solid #fff",
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        }}
      />
    </div>
  );
}

function BusPopupContent({
  vehicle: v,
  markerColor,
  isOnDirectRoute,
  onReport,
}: {
  vehicle: Vehicle;
  markerColor: string;
  isOnDirectRoute: boolean;
  onReport: () => void;
}) {
  const routeLabel = v.route_short_name ? `Route ${v.route_short_name}` : v.destination ?? "Bus";
  const routeName = v.route_long_name ?? v.destination ?? "";

  return (
    <div style={{ fontFamily: "Inter,sans-serif", fontSize: 12, minWidth: 190, lineHeight: 1.6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          paddingBottom: 8,
          borderBottom: "1px solid #eee",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: markerColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {v.route_short_name ? (
            <span
              style={{
                fontWeight: 900,
                fontSize: v.route_short_name.length > 2 ? 11 : 14,
                color: "#fff",
              }}
            >
              {v.route_short_name}
            </span>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#fff">
              <path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z" />
            </svg>
          )}
          {isOnDirectRoute && (
            <div
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: "#22c55e",
                border: "2px solid #fff",
              }}
            />
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap" }}>{routeLabel}</span>
            <span style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap" }}>
              · Bus #{v.equipment_number ?? v.id}
            </span>
          </div>
          {routeName && (
            <div
              style={{
                color: "#666",
                fontSize: 11,
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: 140,
                whiteSpace: "nowrap",
              }}
            >
              {routeName}
            </div>
          )}
          {isOnDirectRoute && (
            <div style={{ fontSize: 10, color: "#16a34a", fontWeight: 600 }}>● On your route</div>
          )}
        </div>
      </div>

      {(v.terminal_start || v.terminal_end) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 3,
            marginBottom: 8,
            paddingBottom: 8,
            borderBottom: "1px solid #eee",
          }}
        >
          {v.terminal_start && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#16a34a", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  Start
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>{v.terminal_start}</div>
              </div>
            </div>
          )}
          {v.terminal_end && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#dc2626", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  End
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#111" }}>{v.terminal_end}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {v.next_stop && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: "#888", fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em" }}>
            Next stop
          </span>
          <br />
          <b>{v.next_stop}</b>
          {v.eta_minutes != null && <span style={{ color: "#888" }}> · {v.eta_minutes} min</span>}
        </div>
      )}

      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: markerColor,
            background: `${markerColor}18`,
            padding: "2px 8px",
            borderRadius: 99,
          }}
        >
          {v.status_raw || v.status}
        </span>
        {v.speed != null && <span style={{ fontSize: 11, color: "#888" }}>{v.speed} mph</span>}
        {v.load && <span style={{ fontSize: 11, color: "#888" }}>{v.load}</span>}
      </div>

      <button
        type="button"
        onClick={onReport}
        style={{
          marginTop: 10,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "8px 0",
          borderRadius: 10,
          border: "none",
          background: "#ab2d00",
          color: "#fff",
          fontFamily: "Inter,sans-serif",
          fontSize: 12,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#fff">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
        </svg>
        Report Issue
      </button>
    </div>
  );
}

function SimplePopup({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: "Inter,sans-serif", fontSize: 12, lineHeight: 1.5 }}>{children}</div>
  );
}

/** API shape points are [lat, lon]; GeoJSON needs [lng, lat]. */
function toLngLatLine(points: [number, number][]): [number, number][] {
  return points.map(([lat, lon]) => [lon, lat]);
}

function bearingDeg(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDiffDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Split a route polyline at the bus: traveled (behind) vs remaining (ahead). */
function splitRouteAtBus(
  coords: [number, number][],
  lng: number,
  lat: number,
  heading: number | null
): { traveled: [number, number][]; remaining: [number, number][] } {
  if (coords.length < 2) {
    return { traveled: [], remaining: coords.slice() };
  }

  let best = {
    dist2: Infinity,
    seg: 0,
    t: 0,
    x: coords[0][0],
    y: coords[0][1],
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-18) {
      t = ((lng - ax) * dx + (lat - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const x = ax + t * dx;
    const y = ay + t * dy;
    const dist2 = (lng - x) ** 2 + (lat - y) ** 2;
    if (dist2 < best.dist2) best = { dist2, seg: i, t, x, y };
  }

  const splitPt: [number, number] = [best.x, best.y];
  const [aLng, aLat] = coords[best.seg];
  const [bLng, bLat] = coords[best.seg + 1];
  const segBearing = bearingDeg(aLng, aLat, bLng, bLat);
  // Traveling along increasing shape index?
  const forward =
    heading == null ? true : angleDiffDeg(heading, segBearing) <= 90;

  const before: [number, number][] = [
    ...coords.slice(0, best.seg + 1),
    splitPt,
  ];
  const after: [number, number][] = [splitPt, ...coords.slice(best.seg + 1)];

  // Dedupe consecutive identical points
  const clean = (line: [number, number][]) => {
    const out: [number, number][] = [];
    for (const p of line) {
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
    }
    return out;
  };

  if (forward) {
    return { traveled: clean(before), remaining: clean(after) };
  }
  return { traveled: clean(after), remaining: clean(before) };
}

/** Progress along polyline (segment index + t) for a lat/lng. */
function progressAlongLine(coords: [number, number][], lng: number, lat: number): number {
  if (coords.length < 2) return 0;
  let best = { dist2: Infinity, progress: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-18) {
      t = ((lng - ax) * dx + (lat - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const x = ax + t * dx;
    const y = ay + t * dy;
    const dist2 = (lng - x) ** 2 + (lat - y) ** 2;
    if (dist2 < best.dist2) best = { dist2, progress: i + t };
  }
  return best.progress;
}

function isStopOnTraveledSegment(
  coords: [number, number][],
  stopLon: number,
  stopLat: number,
  busLng: number,
  busLat: number,
  heading: number | null
): boolean {
  if (coords.length < 2) return false;
  const busProgress = progressAlongLine(coords, busLng, busLat);
  const stopProgress = progressAlongLine(coords, stopLon, stopLat);

  // Same forward/back sense as splitRouteAtBus
  let bestSeg = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-18;
    let t = ((busLng - ax) * dx + (busLat - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d = (busLng - x) ** 2 + (busLat - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestSeg = i;
    }
  }
  const [aLng, aLat] = coords[bestSeg];
  const [bLng, bLat] = coords[bestSeg + 1];
  const forward =
    heading == null ? true : angleDiffDeg(heading, bearingDeg(aLng, aLat, bLng, bLat)) <= 90;

  return forward ? stopProgress < busProgress - 0.02 : stopProgress > busProgress + 0.02;
}

function minDist2ToPolyline(coords: [number, number][], lng: number, lat: number): number {
  if (coords.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-18) {
      t = ((lng - ax) * dx + (lat - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const x = ax + t * dx;
    const y = ay + t * dy;
    const d = (lng - x) ** 2 + (lat - y) ** 2;
    if (d < best) best = d;
  }
  return best;
}

/** Prefer GTFS shape; if many stops sit off the shape (branch/loop), use stop-to-stop path. */
function chooseAlignedRouteLine(
  shapeCoords: [number, number][],
  stops: Stop[]
): [number, number][] {
  if (stops.length >= 2) {
    const stopLine: [number, number][] = stops.map((s) => [s.lon, s.lat]);
    if (shapeCoords.length < 2) return stopLine;

    // ~130m in degrees near Memphis (~35°N)
    const thresh2 = 0.0012 ** 2;
    let far = 0;
    for (const s of stops) {
      if (minDist2ToPolyline(shapeCoords, s.lon, s.lat) > thresh2) far += 1;
    }
    if (far / stops.length > 0.12) return stopLine;
  }
  return shapeCoords;
}

function lineFeatureCollection(coords: [number, number][]): FeatureCollection<LineString> {
  return {
    type: "FeatureCollection",
    features:
      coords.length >= 2
        ? [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            },
          ]
        : [],
  };
}

export default function MapView({
  fromStop,
  toStop,
  routeResults,
  selectedRouteId,
  onRouteSelect,
  onReportIssue,
  userLocation,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null);
  const bus3dLayerRef = useRef<Bus3DLayer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [routeShapes, setRouteShapes] = useState<Record<string, [number, number][]>>({});
  const [routeStops, setRouteStops] = useState<Stop[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<number | null>(null);
  const [busRouteCoords, setBusRouteCoords] = useState<[number, number][]>([]);
  const [busRouteStops, setBusRouteStops] = useState<Stop[]>([]);
  const [endpointPopup, setEndpointPopup] = useState<{
    lon: number;
    lat: number;
    title: string;
    name: string;
    color: string;
  } | null>(null);
  const [stopPopup, setStopPopup] = useState<{ lon: number; lat: number; label: string; name: string } | null>(
    null
  );
  const onReportIssueRef = useRef(onReportIssue);
  onReportIssueRef.current = onReportIssue;

  // Pulse keyframes once
  useEffect(() => {
    if (document.getElementById("marc-pulse-style")) return;
    const style = document.createElement("style");
    style.id = "marc-pulse-style";
    style.textContent = `
      @keyframes marc-pulse-ring {
        0%   { transform: scale(1);   opacity: 0.55; }
        100% { transform: scale(1.7); opacity: 0; }
      }
      .maplibregl-popup { z-index: 30 !important; }
      .maplibregl-popup-content { padding: 12px 14px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
      .maplibregl-popup-close-button { font-size: 18px; padding: 4px 8px; }
    `;
    document.head.appendChild(style);
  }, []);

  const refreshVehicles = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/vehicles`);
      if (!res.ok) return;
      const data = await res.json();
      setVehicles(data.vehicles ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshVehicles();
    const interval = setInterval(refreshVehicles, 15_000);
    return () => clearInterval(interval);
  }, [refreshVehicles]);

  // Fetch route shapes (API returns [lat, lon])
  useEffect(() => {
    let cancelled = false;

    async function loadShapes() {
      const next: Record<string, [number, number][]> = {};
      await Promise.all(
        routeResults.map(async (route) => {
          if (!route.shape_id) return;
          try {
            const res = await fetch(`${API}/api/shapes/${encodeURIComponent(route.shape_id)}`);
            if (!res.ok) return;
            const data = await res.json();
            const points: [number, number][] = data.points ?? [];
            if (points.length) next[route.id] = toLngLatLine(points);
          } catch {
            /* skip */
          }
        })
      );
      if (!cancelled) setRouteShapes(next);
    }

    if (routeResults.length === 0) {
      setRouteShapes({});
      return;
    }
    loadShapes();
    return () => {
      cancelled = true;
    };
  }, [routeResults]);

  // Fetch stops for selected route
  useEffect(() => {
    let cancelled = false;
    setRouteStops([]);
    setEndpointPopup(null);

    if (!selectedRouteId) return;

    (async () => {
      try {
        const res = await fetch(`${API}/api/routes/${encodeURIComponent(selectedRouteId)}/stops`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setRouteStops(data.stops ?? []);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedRouteId]);

  // Fit map to from/to
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (fromStop && toStop) {
      map.fitBounds(
        [
          [fromStop.lon, fromStop.lat],
          [toStop.lon, toStop.lat],
        ],
        { padding: 60, duration: 800 }
      );
    } else if (fromStop) {
      map.flyTo({ center: [fromStop.lon, fromStop.lat], zoom: 14, duration: 800 });
    } else if (toStop) {
      map.flyTo({ center: [toStop.lon, toStop.lat], zoom: 14, duration: 800 });
    }
  }, [fromStop, toStop]);

  const directRouteNames = useMemo(
    () => new Set(routeResults.map((r) => r.short_name).filter(Boolean)),
    [routeResults]
  );

  // Sync live vehicles into the Three.js custom layer (reuse instances — no flicker)
  useEffect(() => {
    const layer = bus3dLayerRef.current;
    if (!mapReady || !layer) return;

    const positioned = vehicles
      .filter((v): v is Vehicle & { lat: number; lng: number } => v.lat != null && v.lng != null)
      .map((v) => ({
        id: v.id,
        lat: v.lat,
        lng: v.lng,
        heading: v.heading,
        status: v.status,
        route_short_name: v.route_short_name,
      }));

    void syncBus3DLayer(layer, positioned, directRouteNames);
  }, [vehicles, directRouteNames, mapReady]);

  const selectedBus = useMemo(
    () => (selectedBusId != null ? vehicles.find((v) => v.id === selectedBusId) ?? null : null),
    [selectedBusId, vehicles]
  );

  // When a bus is clicked: load its GTFS shape + stops for highlight overlay
  useEffect(() => {
    let cancelled = false;

    if (!selectedBus) {
      setBusRouteCoords([]);
      setBusRouteStops([]);
      return;
    }

    const shapeId = selectedBus.route_shape_id;
    const gtfsRouteId = selectedBus.gtfs_route_id;

    (async () => {
      try {
        const shapeCoords: [number, number][] = [];
        let nextStops: Stop[] = [];

        await Promise.all([
          (async () => {
            if (!shapeId) return;
            const res = await fetch(`${API}/api/shapes/${encodeURIComponent(shapeId)}`);
            if (!res.ok) return;
            const data = await res.json();
            const points: [number, number][] = data.points ?? [];
            if (points.length) shapeCoords.push(...toLngLatLine(points));
          })(),
          (async () => {
            if (!gtfsRouteId) return;
            const qs = shapeId ? `?shape_id=${encodeURIComponent(shapeId)}` : "";
            const res = await fetch(
              `${API}/api/routes/${encodeURIComponent(gtfsRouteId)}/stops${qs}`
            );
            if (!res.ok) return;
            const data = await res.json();
            nextStops = data.stops ?? [];
          })(),
        ]);

        if (cancelled) return;
        setBusRouteStops(nextStops);
        setBusRouteCoords(chooseAlignedRouteLine(shapeCoords, nextStops));
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBus?.id, selectedBus?.route_shape_id, selectedBus?.gtfs_route_id]);

  const busRouteSplit = useMemo(() => {
    if (
      !selectedBus ||
      selectedBus.lat == null ||
      selectedBus.lng == null ||
      busRouteCoords.length < 2
    ) {
      return {
        traveled: [] as [number, number][],
        remaining: busRouteCoords,
      };
    }
    return splitRouteAtBus(
      busRouteCoords,
      selectedBus.lng,
      selectedBus.lat,
      selectedBus.heading
    );
  }, [busRouteCoords, selectedBus?.lat, selectedBus?.lng, selectedBus?.heading, selectedBus?.id]);

  const busRouteTraveledGeo = useMemo(
    () => lineFeatureCollection(busRouteSplit.traveled),
    [busRouteSplit.traveled]
  );
  const busRouteRemainingGeo = useMemo(
    () => lineFeatureCollection(busRouteSplit.remaining),
    [busRouteSplit.remaining]
  );

  // Keep 3D buses above the route highlight
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.getLayer(BUS_3D_LAYER_ID)) return;
    try {
      map.moveLayer(BUS_3D_LAYER_ID);
    } catch {
      /* ignore */
    }
  }, [busRouteCoords, mapReady]);

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;

    if (map.getLayer(BUS_3D_LAYER_ID)) {
      map.removeLayer(BUS_3D_LAYER_ID);
    }

    const layer = new Bus3DLayer();
    layer.setOnBusClick((busId) => {
      setSelectedBusId(busId);
      setEndpointPopup(null);
      setStopPopup(null);
    });
    map.addLayer(layer);
    bus3dLayerRef.current = layer;
    setMapReady(true);
  }, []);

  // Soft-focus only when we don't yet have a route to fit
  useEffect(() => {
    if (!selectedBus || selectedBus.lat == null || selectedBus.lng == null) return;
    if (busRouteCoords.length) return;
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({
      center: [selectedBus.lng, selectedBus.lat],
      zoom: Math.max(map.getZoom(), 13.5),
      duration: 700,
    });
  }, [selectedBus?.id, busRouteCoords.length]);

  const routeColor = ROUTE_HIGHLIGHT_COLOR;

  const interactiveLayerIds = useMemo(
    () => routeResults.filter((r) => routeShapes[r.id]?.length).map((r) => `route-line-${r.id}`),
    [routeResults, routeShapes]
  );

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      const routeId = feature?.properties?.routeId as string | undefined;
      if (routeId) {
        onRouteSelect(routeId);
        return;
      }
      // Clicked empty map — close bus popup / route overlay
      if (!e.originalEvent.defaultPrevented) {
        setSelectedBusId(null);
        setBusRouteCoords([]);
        setBusRouteStops([]);
        setEndpointPopup(null);
        setStopPopup(null);
      }
    },
    [onRouteSelect]
  );

  const handleCenter = useCallback(() => {
    mapRef.current?.flyTo({
      center: MEMPHIS,
      zoom: 13.2,
      pitch: MAP_PITCH,
      bearing: 0,
      duration: 600,
    });
  }, []);
  const handleZoomIn = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.zoomTo(map.getZoom() + 1, { duration: 250 });
  }, []);
  const handleZoomOut = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.zoomTo(map.getZoom() - 1, { duration: 250 });
  }, []);

  return (
    <div className="flex-1 relative">
      <Map
        ref={mapRef}
        mapStyle={MAP_STYLE}
        initialViewState={{
          longitude: MEMPHIS[0],
          latitude: MEMPHIS[1],
          zoom: 13.2,
          pitch: MAP_PITCH,
          bearing: 0,
        }}
        maxPitch={70}
        canvasContextAttributes={{ antialias: true, alpha: true }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        attributionControl={{ compact: true }}
        interactiveLayerIds={interactiveLayerIds}
        onClick={handleMapClick}
        onLoad={handleMapLoad}
        cursor={interactiveLayerIds.length ? "pointer" : undefined}
      >
        {routeResults.map((route) => {
          const coords = routeShapes[route.id];
          if (!coords?.length) return null;
          const isSelected = route.id === selectedRouteId;
          const data: FeatureCollection<LineString> = {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: { routeId: route.id },
                geometry: { type: "LineString", coordinates: coords },
              },
            ],
          };
          return (
            <Source key={route.id} id={`route-src-${route.id}`} type="geojson" data={data}>
              <Layer
                id={`route-line-${route.id}`}
                type="line"
                paint={{
                  "line-color": ROUTE_HIGHLIGHT_COLOR,
                  "line-width": isSelected ? 7 : 4,
                  "line-opacity": isSelected ? 1 : 0.55,
                }}
                layout={{
                  "line-join": "round",
                  "line-cap": "round",
                  // Draw selected routes on top
                  visibility: "visible",
                }}
              />
            </Source>
          );
        })}

        <Source id="bus-route-traveled-src" type="geojson" data={busRouteTraveledGeo}>
          <Layer
            id="bus-route-traveled-casing"
            type="line"
            beforeId={mapReady ? BUS_3D_LAYER_ID : undefined}
            paint={{
              "line-color": "#ffffff",
              "line-width": 10,
              "line-opacity": busRouteSplit.traveled.length >= 2 ? 0.35 : 0,
            }}
            layout={{ "line-join": "round", "line-cap": "round" }}
          />
          <Layer
            id="bus-route-traveled"
            type="line"
            beforeId={mapReady ? BUS_3D_LAYER_ID : undefined}
            paint={{
              "line-color": ROUTE_HIGHLIGHT_COLOR,
              "line-width": 5,
              "line-opacity": busRouteSplit.traveled.length >= 2 ? 0.28 : 0,
            }}
            layout={{ "line-join": "round", "line-cap": "round" }}
          />
        </Source>
        <Source id="bus-route-remaining-src" type="geojson" data={busRouteRemainingGeo}>
          <Layer
            id="bus-route-remaining-casing"
            type="line"
            beforeId={mapReady ? BUS_3D_LAYER_ID : undefined}
            paint={{
              "line-color": "#ffffff",
              "line-width": 12,
              "line-opacity": busRouteSplit.remaining.length >= 2 ? 0.95 : 0,
            }}
            layout={{ "line-join": "round", "line-cap": "round" }}
          />
          <Layer
            id="bus-route-remaining"
            type="line"
            beforeId={mapReady ? BUS_3D_LAYER_ID : undefined}
            paint={{
              "line-color": ROUTE_HIGHLIGHT_COLOR,
              "line-width": 7,
              "line-opacity": busRouteSplit.remaining.length >= 2 ? 1 : 0,
            }}
            layout={{ "line-join": "round", "line-cap": "round" }}
          />
        </Source>
        {busRouteStops.map((stop, idx) => {
          const isNext = stopNameMatches(stop.name, selectedBus?.next_stop ?? null);
          const faded =
            !!selectedBus &&
            selectedBus.lat != null &&
            selectedBus.lng != null &&
            busRouteCoords.length >= 2 &&
            isStopOnTraveledSegment(
              busRouteCoords,
              stop.lon,
              stop.lat,
              selectedBus.lng,
              selectedBus.lat,
              selectedBus.heading
            );
          return (
            <Marker
              key={`bus-stop-${stop.id}-${idx}`}
              longitude={stop.lon}
              latitude={stop.lat}
              anchor="center"
              style={{ zIndex: faded ? 0 : 1, opacity: faded ? 0.2 : 1 }}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setStopPopup({
                  lon: stop.lon,
                  lat: stop.lat,
                  label: isNext && !faded ? "Next stop" : "Stop",
                  name: stop.name,
                });
                setEndpointPopup(null);
              }}
            >
              <BusRouteStopCircle isNext={isNext && !faded} faded={faded} title={stop.name} />
            </Marker>
          );
        })}

        {routeStops.map((stop, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === routeStops.length - 1;
          const isEndpoint = isFirst || isLast;
          return (
            <Marker
              key={`stop-${stop.id}-${idx}`}
              longitude={stop.lon}
              latitude={stop.lat}
              anchor={isEndpoint ? "bottom" : "center"}
              style={{ zIndex: isEndpoint ? 5 : 1 }}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                if (isEndpoint) {
                  setEndpointPopup({
                    lon: stop.lon,
                    lat: stop.lat,
                    title: isFirst ? "Start Terminal" : "End Terminal",
                    name: stop.name,
                    color: routeColor,
                  });
                  setSelectedBusId(null);
                  setStopPopup(null);
                } else {
                  setStopPopup({ lon: stop.lon, lat: stop.lat, label: stop.name, name: stop.name });
                  setSelectedBusId(null);
                  setEndpointPopup(null);
                }
              }}
            >
              {isEndpoint ? (
                <TerminalPin color={routeColor} label={isFirst ? "START" : "END"} stopName={stop.name} />
              ) : (
                <StopDot color={routeColor} />
              )}
            </Marker>
          );
        })}

        {fromStop && (
          <Marker
            longitude={fromStop.lon}
            latitude={fromStop.lat}
            anchor="center"
            style={{ zIndex: 6 }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setStopPopup({ lon: fromStop.lon, lat: fromStop.lat, label: "FROM", name: fromStop.name });
              setSelectedBusId(null);
              setEndpointPopup(null);
            }}
          >
            <CirclePin color="#0959b6" title={`FROM: ${fromStop.name}`} />
          </Marker>
        )}

        {toStop && (
          <Marker
            longitude={toStop.lon}
            latitude={toStop.lat}
            anchor="center"
            style={{ zIndex: 6 }}
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setStopPopup({ lon: toStop.lon, lat: toStop.lat, label: "TO", name: toStop.name });
              setSelectedBusId(null);
              setEndpointPopup(null);
            }}
          >
            <CirclePin color="#ab2d00" title={`TO: ${toStop.name}`} />
          </Marker>
        )}

        {userLocation && (
          <Marker longitude={userLocation.lon} latitude={userLocation.lat} anchor="center" style={{ zIndex: 7 }}>
            <UserLocationDot />
          </Marker>
        )}

        {selectedBus && selectedBus.lat != null && selectedBus.lng != null && (
          <Popup
            longitude={selectedBus.lng}
            latitude={selectedBus.lat}
            anchor="bottom"
            offset={56}
            onClose={() => setSelectedBusId(null)}
            closeOnClick={false}
            maxWidth="280px"
          >
            <BusPopupContent
              vehicle={selectedBus}
              markerColor={statusColor(selectedBus.status)}
              isOnDirectRoute={
                selectedBus.route_short_name != null &&
                directRouteNames.has(selectedBus.route_short_name)
              }
              onReport={() => {
                setSelectedBusId(null);
                onReportIssueRef.current({
                  id: selectedBus.id,
                  equipmentNumber: selectedBus.equipment_number ?? String(selectedBus.id),
                  routeShortName: selectedBus.route_short_name,
                  routeLongName: selectedBus.route_long_name,
                  routeColor: selectedBus.route_color,
                });
              }}
            />
          </Popup>
        )}

        {endpointPopup && (
          <Popup
            longitude={endpointPopup.lon}
            latitude={endpointPopup.lat}
            anchor="bottom"
            offset={30}
            onClose={() => setEndpointPopup(null)}
            closeOnClick={false}
            maxWidth="240px"
          >
            <SimplePopup>
              <b style={{ color: endpointPopup.color }}>{endpointPopup.title}</b>
              <br />
              {endpointPopup.name}
            </SimplePopup>
          </Popup>
        )}

        {stopPopup && (
          <Popup
            longitude={stopPopup.lon}
            latitude={stopPopup.lat}
            anchor="bottom"
            offset={12}
            onClose={() => setStopPopup(null)}
            closeOnClick={false}
            maxWidth="240px"
          >
            <SimplePopup>
              <b>{stopPopup.label}</b>
              {stopPopup.label !== stopPopup.name && (
                <>
                  <br />
                  {stopPopup.name}
                </>
              )}
            </SimplePopup>
          </Popup>
        )}
      </Map>

      {vehicles.length > 0 && (
        <div className="absolute top-3 left-3 z-[1000] bg-white/90 backdrop-blur-sm shadow-sm rounded-full px-3 py-1 flex items-center gap-1.5 text-xs font-bold text-primary">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          {vehicles.length} buses live
        </div>
      )}

      <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
        <button
          onClick={handleCenter}
          className="w-9 h-9 bg-white/90 backdrop-blur-sm shadow-sm rounded-lg flex items-center justify-center text-primary hover:bg-primary hover:text-white transition-all active:scale-95"
          title="Center"
        >
          <span className="material-symbols-outlined text-[18px]">my_location</span>
        </button>
        <button
          onClick={handleZoomIn}
          className="w-9 h-9 bg-white/90 backdrop-blur-sm shadow-sm rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>
        <button
          onClick={handleZoomOut}
          className="w-9 h-9 bg-white/90 backdrop-blur-sm shadow-sm rounded-lg flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-all active:scale-95"
        >
          <span className="material-symbols-outlined text-[18px]">remove</span>
        </button>
      </div>
    </div>
  );
}
