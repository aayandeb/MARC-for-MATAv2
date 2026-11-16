"""Refresh the bundled GTFS schedule from MATA's official feed.

MATA publishes a rolling window of only a few weeks, so the files in
apps/backend/GTFS go out of date quickly. Run this, then commit and redeploy:

    python scripts/update_gtfs.py

The feed URL is the one linked from
https://www.matatransit.com/how-do-you-travel/route-schedules/gtfs-feed/
Override it with the GTFS_FEED_URL environment variable if MATA moves it.
"""

from __future__ import annotations

import csv
import io
import os
import sys
import urllib.request
import zipfile
from datetime import date

FEED_URL = os.getenv("GTFS_FEED_URL", "https://gtfs.mata.cadavl.com/MATA/GTFS/GTFS_MATA.zip")
GTFS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "GTFS")

REQUIRED = ["agency.txt", "calendar.txt", "routes.txt", "shapes.txt", "stop_times.txt", "stops.txt", "trips.txt"]
OPTIONAL = ["calendar_dates.txt", "transfers.txt", "feed_info.txt"]
MAX_ZIP_BYTES = 50 * 1024 * 1024


def check_archive(archive: zipfile.ZipFile, today: date) -> tuple[str, str]:
    """Validate the feed and return its (start, end) dates as YYYYMMDD."""
    names = set(archive.namelist())
    missing = [f for f in REQUIRED if f not in names]
    if missing:
        raise ValueError(f"feed is missing required files: {', '.join(missing)}")

    with archive.open("calendar.txt") as f:
        rows = list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))
    if not rows:
        raise ValueError("calendar.txt has no services")
    start = min(r["start_date"].strip() for r in rows)
    end = max(r["end_date"].strip() for r in rows)
    if end < today.strftime("%Y%m%d"):
        raise ValueError(f"feed already expired (covers {start} to {end})")

    for name in ("routes.txt", "stops.txt", "trips.txt"):
        with archive.open(name) as f:
            if sum(1 for _ in f) < 2:
                raise ValueError(f"{name} is empty")
    return start, end


def main() -> int:
    print(f"Downloading {FEED_URL}")
    with urllib.request.urlopen(FEED_URL, timeout=60) as resp:
        data = resp.read(MAX_ZIP_BYTES + 1)
    if len(data) > MAX_ZIP_BYTES:
        print("error: feed is unexpectedly large; refusing to use it", file=sys.stderr)
        return 1

    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        start, end = check_archive(archive, date.today())
    except (zipfile.BadZipFile, ValueError, KeyError) as e:
        print(f"error: {e}; bundled files left unchanged", file=sys.stderr)
        return 1

    # Only write the known GTFS files, by fixed name, into the bundle folder.
    written = []
    for name in REQUIRED + OPTIONAL:
        if name in archive.namelist():
            with open(os.path.join(GTFS_DIR, name), "wb") as out:
                out.write(archive.read(name))
            written.append(name)

    print(f"Updated {len(written)} files in {GTFS_DIR}")
    print(f"Schedule now covers {start} to {end}. Commit the changes and redeploy the backend.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
