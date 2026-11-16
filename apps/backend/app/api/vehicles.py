from flask import Blueprint, current_app, jsonify

from app.services import fetch_vehicle_feed
from app.services.gtfs_service import gtfs

bp = Blueprint("vehicles", __name__, url_prefix="/api/vehicles")


def _enrich(vehicle: dict) -> dict:
    out = {k: v for k, v in vehicle.items() if k != "_raw"}
    route = gtfs.resolve_route_for_vehicle(
        destination=vehicle.get("destination"),
        next_stop=vehicle.get("next_stop"),
        lat=vehicle.get("lat"),
        lng=vehicle.get("lng"),
        mata_route_id=str(vehicle.get("route_id") or "") or None,
    )
    if route:
        out["gtfs_route_id"] = route["id"]
        out["route_short_name"] = route["short_name"]
        out["route_long_name"] = route["long_name"]
        out["route_color"] = route["color"]
        start, end = gtfs.route_terminals(route["id"])
        out["terminal_start"] = start
        out["terminal_end"] = end
        out["route_shape_id"] = gtfs.get_route_shape_id(
            route["id"],
            lat=vehicle.get("lat"),
            lng=vehicle.get("lng"),
        )
    else:
        out["gtfs_route_id"] = None
        out["route_short_name"] = None
        out["route_long_name"] = None
        out["route_color"] = None
        out["terminal_start"] = None
        out["terminal_end"] = None
        out["route_shape_id"] = None
    return out


@bp.route("", methods=["GET"])
@bp.route("/", methods=["GET"])
def list_vehicles():
    feed = fetch_vehicle_feed(
        base_url=current_app.config["MATA_API_BASE_URL"],
        path=current_app.config["MATA_VEHICLES_PATH"],
        lignes=current_app.config["MATA_LIGNES"],
        use_mock=current_app.config.get("USE_MOCK_VEHICLES", False),
    )
    vehicles = feed["vehicles"]
    return jsonify({
        "vehicles": [_enrich(v) for v in vehicles],
        "count": len(vehicles),
        # "live" | "unavailable" | "mock" — clients must not present
        # anything other than "live" as real-time positions.
        "source": feed["source"],
    })
