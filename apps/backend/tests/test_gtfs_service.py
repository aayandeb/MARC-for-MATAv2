"""
Unit tests for GTFS service-day logic (which trips run on a given date).
"""

from datetime import date

from app.services.gtfs_service import GTFSService


def _service() -> GTFSService:
    """A service with a 3-week calendar window and one holiday exception."""
    svc = GTFSService()
    window = {"start_date": "20261115", "end_date": "20261205"}
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

    def cal(on: set[str]) -> dict:
        return {**{d: "1" if d in on else "0" for d in days}, **window}

    svc._calendar = {
        "0_Weekday": cal({"monday", "tuesday", "wednesday", "thursday", "friday"}),
        "2-Sat": cal({"saturday"}),
        "3-Sun": cal({"sunday"}),
    }
    # Thanksgiving (Thu 2026-11-26) runs the Sunday schedule.
    svc._calendar_removed["20261126"].add("0_Weekday")
    svc._calendar_added["20261126"].add("3-Sun")
    return svc


class TestActiveServices:
    def test_weekday_inside_window(self):
        assert _service()._active_service_ids_for_date(date(2026, 11, 18)) == {"0_Weekday"}

    def test_weekend_inside_window(self):
        svc = _service()
        assert svc._active_service_ids_for_date(date(2026, 11, 21)) == {"2-Sat"}
        assert svc._active_service_ids_for_date(date(2026, 11, 22)) == {"3-Sun"}

    def test_holiday_exception_swaps_service(self):
        assert _service()._active_service_ids_for_date(date(2026, 11, 26)) == {"3-Sun"}

    def test_after_window_falls_back_to_weekday_pattern(self):
        # An expired feed must not mean "no buses run": use the day-of-week pattern.
        svc = _service()
        assert svc._active_service_ids_for_date(date(2027, 3, 3)) == {"0_Weekday"}
        assert svc._active_service_ids_for_date(date(2027, 3, 6)) == {"2-Sat"}

    def test_before_window_falls_back_to_weekday_pattern(self):
        assert _service()._active_service_ids_for_date(date(2026, 11, 1)) == {"3-Sun"}


class TestScheduleStatus:
    def test_current_inside_window(self):
        status = _service().schedule_status(today=date(2026, 11, 20))
        assert status == {"valid_from": "2026-11-15", "valid_until": "2026-12-05", "outdated": False}

    def test_last_day_is_still_current(self):
        assert _service().schedule_status(today=date(2026, 12, 5))["outdated"] is False

    def test_outdated_after_window(self):
        assert _service().schedule_status(today=date(2026, 12, 6))["outdated"] is True

    def test_outdated_when_no_calendar(self):
        status = GTFSService().schedule_status(today=date(2026, 11, 20))
        assert status == {"valid_from": None, "valid_until": None, "outdated": True}


class TestBundledFeed:
    """Sanity checks on the real files in apps/backend/GTFS."""

    def test_bundle_loads_and_plans_a_trip(self):
        svc = GTFSService()
        svc.load()
        assert len(svc._routes) > 0 and len(svc._stops) > 0 and len(svc._shapes) > 0

        # Two consecutive stops on some trip must be directly connected,
        # whatever today's date is relative to the feed window.
        active = svc._active_service_ids()
        assert active, "no service resolved for today"
        trip_id = next(t for t, trip in svc._trips.items() if trip["service_id"] in active)
        stops = svc._stop_times_by_trip[trip_id]
        result = svc.plan_trip(stops[0]["stop_id"], stops[1]["stop_id"])
        assert result["type"] == "direct"
