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
// OpenFreeMap Positron — free vector style (Carto CDN also works once the MapLibre worker loads)
const MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const MEMPHIS: [number, number] = [-90.049, 35.1495]; // [lng, lat]
const MAP_PITCH = 0; // default load is top-down / 2D-like; user can still tilt

interface Vehicle {
  id: number;
  equipment_number: string;
  type: string;
  lat: number | null;
  lng: number | null;
  heading: number | null;
  route_id: number | null;
  route_short_name: string | null;
  route_long_name: string | null;
  route_color: string | null;
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

  const selectedRoute = routeResults.find((r) => r.id === selectedRouteId);
  const routeColor = selectedRoute?.color ?? "#0959b6";

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
      // Clicked empty map — close bus popup
      if (!e.originalEvent.defaultPrevented) {
        setSelectedBusId(null);
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
                  "line-color": route.color ?? "#0959b6",
                  "line-width": isSelected ? 6 : 3,
                  "line-opacity": isSelected ? 1 : 0.5,
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
