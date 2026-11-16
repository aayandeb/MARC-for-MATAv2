import json
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Any

import requests

MEMPHIS_TZ = ZoneInfo("America/Chicago")

logger = logging.getLogger(__name__)


DEFAULT_TIMEOUT = 10


def _parse_status(avance_retard: str) -> str:

    if not avance_retard:
        return "unknown"
    lower = avance_retard.strip().lower()
    if "on time" in lower:
        return "on-time"
    if "late" in lower:
        return "delayed"
    if "early" in lower:
        return "early"
    return "unknown"


def _parse_vehicle(raw: dict[str, Any]) -> dict[str, Any]:
    localisation = raw.get("localisation") or {}
    conduite = raw.get("conduite") or {}
    arret_suiv = conduite.get("arretSuiv") or {}

    avance_retard = conduite.get("avanceRetard", "")

    return {
        "id": raw.get("id"),
        "equipment_number": raw.get("numeroEquipement"),
        "type": raw.get("type", "Bus"),
        "lat": localisation.get("lat"),
        "lng": localisation.get("lng"),
        "heading": localisation.get("cap"),
        "route_id": conduite.get("idLigne"),
        "destination": conduite.get("destination"),
        "speed": conduite.get("vitesse"),
        "status": _parse_status(avance_retard),
        "status_raw": avance_retard,
        "next_stop": arret_suiv.get("nomCommercial"),
        "eta_minutes": arret_suiv.get("estimationTemps"),
        "load": raw.get("vehiculeLoad"),
        "_raw": raw,
    }


def fetch_vehicles(
    base_url: str,
    path: str,
    lignes: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> list[dict[str, Any]]:

    url = base_url.rstrip("/") + path
    now_central = datetime.now(MEMPHIS_TZ)
    params = {"_tmp": int(now_central.timestamp()), "lignes": lignes}

    response = requests.get(url, params=params, timeout=timeout)
    response.raise_for_status()

    data = response.json()
    raw_vehicles = data.get("vehicule") or data.get("vehicules") or []

    if not isinstance(raw_vehicles, list):
        return []

    return [_parse_vehicle(v) for v in raw_vehicles]


_MOCK_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "mock_vehicles.json")


def _load_mock() -> list[dict[str, Any]]:
    try:
        with open(_MOCK_PATH) as f:
            data = json.load(f)
        raw_vehicles = data.get("vehicule") or []
        return [_parse_vehicle(v) for v in raw_vehicles]
    except Exception:
        return []


def fetch_vehicle_feed(
    base_url: str | None,
    path: str | None,
    lignes: str | None,
    *,
    use_mock: bool = False,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    Fetch vehicles and say where they came from.

    source is one of:
      "live"        - MATA's feed answered (the list may be empty: no buses out)
      "unavailable" - the feed is not configured, errored, or sent bad data
      "mock"        - bundled demo data, only when use_mock is set explicitly

    Mock data is never substituted silently: a failed feed yields an empty
    list marked "unavailable" so clients can say so instead of showing fake buses.
    """
    if use_mock:
        return {"vehicles": _load_mock(), "source": "mock"}

    if not base_url or not path:
        logger.error("MATA feed not configured (MATA_API_BASE_URL / MATA_VEHICLES_PATH)")
        return {"vehicles": [], "source": "unavailable"}

    try:
        vehicles = fetch_vehicles(base_url, path, lignes or "", timeout=timeout)
    except requests.RequestException as e:
        logger.error("MATA feed request failed: %s", e)
        return {"vehicles": [], "source": "unavailable"}
    except (KeyError, TypeError, ValueError, AttributeError) as e:
        logger.error("MATA feed returned unusable data: %s", e)
        return {"vehicles": [], "source": "unavailable"}

    return {"vehicles": vehicles, "source": "live"}


def fetch_vehicles_safe(
    base_url: str,
    path: str,
    lignes: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> list[dict[str, Any]]:
    """Fetch live vehicles; return an empty list on any failure."""
    return fetch_vehicle_feed(base_url, path, lignes, timeout=timeout)["vehicles"]
