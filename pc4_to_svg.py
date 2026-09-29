#!/usr/bin/env python3
"""
Fetch Dutch PC4 (4-digit postcode) polygons from PDOK/CBS OGC API Features
and render a clean, scale-flexible SVG map in Rijksdriehoek (EPSG:28992).

API constraints handled here:
  - Server hard-caps at 1000 features per request → follow `rel=next` / cursor
  - Multi-year dataset → filter with `jaarcode` (default: latest year)
  - Request coordinates already in EPSG:28992 to avoid client-side reprojection
  - SVG Y-axis is inverted relative to map Y

Example:
  python pc4_to_svg.py --year 2024 --out output/nl_pc4.svg
  python pc4_to_svg.py --year 2024 --simplify 10 --topo
  python pc4_to_svg.py --year 2024 --no-topo --simplify 0
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlencode

import requests
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from tqdm import tqdm

# ---------------------------------------------------------------------------
# PDOK / CBS endpoints
# ---------------------------------------------------------------------------
OGC_BASE = "https://api.pdok.nl/cbs/postcode4/ogc/v1"
ITEMS_URL = f"{OGC_BASE}/collections/postcode4/items"
CRS_RD_NEW = "http://www.opengis.net/def/crs/EPSG/0/28992"
DEFAULT_LIMIT = 1000  # PDOK hard maximum
DEFAULT_TIMEOUT = 120  # seconds; geometries are multi-MB payloads
DEFAULT_RETRIES = 5
RETRY_BACKOFF = 2.0

log = logging.getLogger("pc4_to_svg")


# ---------------------------------------------------------------------------
# HTTP helpers — pagination + graceful timeouts
# ---------------------------------------------------------------------------
def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "Accept": "application/geo+json",
            "User-Agent": "Tool_PostcodeVector/1.0 (PC4-to-SVG; PDOK open data)",
        }
    )
    return s


def fetch_page(
    session: requests.Session,
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    retries: int = DEFAULT_RETRIES,
) -> dict[str, Any]:
    """GET one OGC Features page with retries on timeout / 5xx."""
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = session.get(url, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_err = exc
            wait = RETRY_BACKOFF ** attempt
            log.warning(
                "Network error on attempt %d/%d (%s); retrying in %.1fs",
                attempt,
                retries,
                exc,
                wait,
            )
            time.sleep(wait)
        except requests.HTTPError as exc:
            # 429 / 5xx → retry; other HTTP errors fail immediately
            status = exc.response.status_code if exc.response is not None else 0
            if status in {429, 500, 502, 503, 504} and attempt < retries:
                wait = RETRY_BACKOFF ** attempt
                log.warning("HTTP %s; retrying in %.1fs", status, wait)
                time.sleep(wait)
                last_err = exc
                continue
            raise
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts") from last_err


def next_link(page: dict[str, Any]) -> str | None:
    """Return the GeoJSON/JSON-FG `rel=next` href, if present."""
    for link in page.get("links") or []:
        if link.get("rel") == "next" and link.get("href"):
            return link["href"]
    return None


def iter_pc4_features(
    *,
    year: int,
    limit: int = DEFAULT_LIMIT,
    timeout: float = DEFAULT_TIMEOUT,
) -> Iterator[dict[str, Any]]:
    """
    Stream all PC4 features for a given jaarcode, following cursor/`next` links
    until the collection is exhausted. Coordinates are requested in EPSG:28992.
    """
    if limit < 1 or limit > DEFAULT_LIMIT:
        raise ValueError(f"limit must be 1..{DEFAULT_LIMIT} (PDOK server cap)")

    params = {
        "f": "json",
        "limit": limit,
        "jaarcode": year,
        # Request RD New directly — avoids squished WGS84 SVG and client proj
        "crs": CRS_RD_NEW,
    }
    url = f"{ITEMS_URL}?{urlencode(params)}"
    session = _session()
    page_idx = 0
    total = 0

    with tqdm(desc=f"PDOK PC4 {year}", unit="feat", dynamic_ncols=True) as bar:
        while url:
            page_idx += 1
            page = fetch_page(session, url, timeout=timeout)
            features = page.get("features") or []
            n = len(features)
            total += n
            bar.update(n)
            log.info("Page %d: +%d (running total %d)", page_idx, n, total)

            for feat in features:
                yield feat

            url = next_link(page)

    log.info("Fetched %d features across %d page(s)", total, page_idx)


# ---------------------------------------------------------------------------
# Geometry → clean polygon(s)
# ---------------------------------------------------------------------------
def feature_geometry(feat: dict[str, Any]) -> BaseGeometry | None:
    """Parse GeoJSON geometry; drop empty / invalid nulls."""
    geom = feat.get("geometry")
    if not geom:
        return None
    try:
        g = shape(geom)
    except Exception as exc:  # noqa: BLE001 — bad vendor payload should not abort
        log.warning("Could not parse geometry for %s: %s", feat.get("id"), exc)
        return None
    if g.is_empty:
        return None
    # Buffer(0) repairs many self-intersections from cadastral edges
    if not g.is_valid:
        g = g.buffer(0)
    return g


def clean_for_svg(
    geom: BaseGeometry,
    *,
    simplify_m: float = 0.0,
) -> BaseGeometry | None:
    """
    Produce a single Polygon/MultiPolygon suitable for SVG path output.

    - Dissolves accidental MultiPolygon fragmentation of the *same* PC4 zone
      when parts touch (unary_union), keeping true islands as separate rings.
    - Optional per-polygon Douglas–Peucker (legacy; prefer apply_simplify/topo).
    """
    if geom is None or geom.is_empty:
        return None

    # Normalize to polygonal
    if geom.geom_type == "GeometryCollection":
        polys = [p for p in geom.geoms if isinstance(p, (Polygon, MultiPolygon))]
        if not polys:
            return None
        geom = unary_union(polys)
    elif geom.geom_type not in {"Polygon", "MultiPolygon"}:
        return None

    if simplify_m and simplify_m > 0:
        # preserve_topology: no self-collapse — NOT shared borders with neighbours
        geom = geom.simplify(simplify_m, preserve_topology=True)

    if geom.is_empty:
        return None
    return geom


def enclosed_union_holes(geoms: list[BaseGeometry]) -> tuple[int, float]:
    """
    Count interior rings of unary_union(geoms) and their total area (m²).

    Fully enclosed slivers between PC4s show up as holes in the dissolved union.
    (Large water/exclave holes from the source are included too — compare before/after.)
    """
    from shapely import make_valid

    valid: list[BaseGeometry] = []
    for g in geoms:
        if g is None or g.is_empty:
            continue
        try:
            g2 = make_valid(g)
        except Exception:  # noqa: BLE001
            continue
        if g2 is not None and not g2.is_empty:
            valid.append(g2)
    if not valid:
        return 0, 0.0
    try:
        u = unary_union(valid)
    except Exception as exc:  # noqa: BLE001 — don't abort the SVG build on metrics
        log.warning("Union hole stats skipped (%s)", exc)
        return -1, -1.0
    if isinstance(u, Polygon):
        polys: list[Polygon] = [u]
    elif isinstance(u, MultiPolygon):
        polys = list(u.geoms)
    else:
        return 0, 0.0
    holes = [Polygon(ring) for poly in polys for ring in poly.interiors]
    return len(holes), float(sum(h.area for h in holes))


def log_union_hole_stats(label: str, features: list[tuple[str, BaseGeometry]]) -> None:
    n, area = enclosed_union_holes([g for _, g in features])
    log.info(
        "Union holes [%s]: %d enclosed ring(s), total area %.1f m²",
        label,
        n,
        area,
    )


def naive_simplify_features(
    features: list[tuple[str, BaseGeometry]],
    *,
    simplify_m: float,
    precision_m: float = 1.0,
) -> list[tuple[str, BaseGeometry]]:
    """
    --no-topo: grid-snap then per-polygon simplify.

    Snap first helps a little; Douglas–Peucker per feature can still reopen gaps.
    """
    from shapely import make_valid, set_precision

    out: list[tuple[str, BaseGeometry]] = []
    for code, geom in features:
        g = make_valid(set_precision(geom, precision_m))
        if simplify_m and simplify_m > 0:
            g = g.simplify(simplify_m, preserve_topology=True)
        g = clean_for_svg(g, simplify_m=0.0)
        if g is not None and not g.is_empty:
            out.append((code, g))
    return out


def topo_simplify_features(
    features: list[tuple[str, BaseGeometry]],
    *,
    simplify_m: float,
    precision_m: float = 0.5,
) -> list[tuple[str, BaseGeometry]]:
    """
    Topology-safe simplify: snap → shared arcs → simplify per arc.

    Order is mandatory. Snapping after simplify cannot rejoin divergent edges.
    """
    try:
        import geopandas as gpd
        import topojson as tp
        from shapely import make_valid, set_precision
    except ImportError as exc:
        raise ImportError(
            "Voor --topo zijn nodig: uv pip install topojson geopandas. "
            "Of gebruik --no-topo (bij voorkeur met --simplify 0)."
        ) from exc

    codes = [c for c, _ in features]
    snapped = [make_valid(set_precision(g, precision_m)) for _, g in features]
    gdf = gpd.GeoDataFrame({"pc4": codes}, geometry=snapped, crs="EPSG:28992")

    # shared_coords=True: junctions match only on identical coords → snap first
    try:
        topo = tp.Topology(gdf, prequantize=False, shared_coords=True)
    except TypeError:
        topo = tp.Topology(gdf, prequantize=False)

    if simplify_m and simplify_m > 0:
        topo = topo.toposimplify(simplify_m)

    out_gdf = topo.to_gdf()
    if "pc4" in out_gdf.columns:
        pairs = [
            (str(getattr(row, "pc4")).zfill(4), row.geometry)
            for row in out_gdf.itertuples(index=False)
            if row.geometry is not None and not row.geometry.is_empty
        ]
    else:
        pairs = [
            (codes[i], geom)
            for i, geom in enumerate(out_gdf.geometry)
            if geom is not None and not geom.is_empty
        ]

    cleaned: list[tuple[str, BaseGeometry]] = []
    for code, geom in pairs:
        try:
            geom = make_valid(geom)
        except Exception:  # noqa: BLE001
            pass
        g = clean_for_svg(geom, simplify_m=0.0)
        if g is not None:
            cleaned.append((code, g))
    cleaned.sort(key=lambda kv: kv[0])
    return cleaned


def apply_simplify(
    features: list[tuple[str, BaseGeometry]],
    *,
    simplify_m: float,
    topo: bool,
) -> list[tuple[str, BaseGeometry]]:
    """Dispatch topo vs naive simplify; log union-hole stats before/after."""
    log_union_hole_stats("before simplify", features)
    if topo:
        log.info(
            "Topo simplify: snap 0.5 m → Topology(shared_coords) → toposimplify(%.3f m)",
            simplify_m,
        )
        out = topo_simplify_features(features, simplify_m=simplify_m, precision_m=0.5)
    else:
        log.info(
            "Naive simplify: set_precision(1.0 m) → per-polygon simplify(%.3f m)",
            simplify_m,
        )
        out = naive_simplify_features(features, simplify_m=simplify_m, precision_m=1.0)
    log_union_hole_stats("after simplify", out)
    return out


def pc4_code(feat: dict[str, Any]) -> str:
    props = feat.get("properties") or {}
    raw = props.get("postcode", feat.get("id", ""))
    return str(raw).zfill(4)


# ---------------------------------------------------------------------------
# Bounding box + SVG path generation (Y-axis flip)
# ---------------------------------------------------------------------------
def update_bounds(
    bounds: list[float],
    geom: BaseGeometry,
) -> None:
    minx, miny, maxx, maxy = geom.bounds
    bounds[0] = min(bounds[0], minx)
    bounds[1] = min(bounds[1], miny)
    bounds[2] = max(bounds[2], maxx)
    bounds[3] = max(bounds[3], maxy)


def ring_to_path(
    ring: list[tuple[float, float]],
    *,
    min_x: float,
    max_y: float,
    scale: float,
) -> str:
    """
    Map RD metres → SVG user units.

    SVG Y increases downward, RD Y increases northward, so:
        svg_x = (x - min_x) * scale
        svg_y = (max_y - y) * scale
    """
    if len(ring) < 2:
        return ""
    parts: list[str] = []
    for i, (x, y) in enumerate(ring):
        sx = (x - min_x) * scale
        sy = (max_y - y) * scale
        # Compact numbers: millimetre precision is overkill for national maps
        cmd = "M" if i == 0 else "L"
        parts.append(f"{cmd}{sx:.2f} {sy:.2f}")
    parts.append("Z")
    return "".join(parts)


def geom_to_path_d(
    geom: BaseGeometry,
    *,
    min_x: float,
    max_y: float,
    scale: float,
) -> str:
    """Concatenate exterior + interior rings into one SVG path `d` string."""
    polygons: list[Polygon]
    if isinstance(geom, Polygon):
        polygons = [geom]
    elif isinstance(geom, MultiPolygon):
        polygons = list(geom.geoms)
    else:
        return ""

    chunks: list[str] = []
    for poly in polygons:
        if poly.is_empty:
            continue
        # Exterior
        chunks.append(
            ring_to_path(
                list(poly.exterior.coords),
                min_x=min_x,
                max_y=max_y,
                scale=scale,
            )
        )
        # Holes (evenodd / nonzero both work; we use evenodd on the root <svg>)
        for interior in poly.interiors:
            chunks.append(
                ring_to_path(
                    list(interior.coords),
                    min_x=min_x,
                    max_y=max_y,
                    scale=scale,
                )
            )
    return "".join(chunks)


def write_svg(
    features: list[tuple[str, BaseGeometry]],
    out_path: Path,
    *,
    padding_m: float = 0.0,
    scale: float = 1.0,
    stroke: str = "#1a1a1a",
    fill: str = "#e8eef5",
    stroke_width_px: float = 0.4,
) -> tuple[float, float]:
    """
    Emit an SVG whose viewBox is derived from the projected RD bounding box.
    Returns (width, height) in SVG user units.
    """
    if not features:
        raise ValueError("No features to render")

    # Absolute RD bounds
    bounds = [float("inf"), float("inf"), float("-inf"), float("-inf")]
    for _, geom in features:
        update_bounds(bounds, geom)

    min_x, min_y, max_x, max_y = bounds
    min_x -= padding_m
    min_y -= padding_m
    max_x += padding_m
    max_y += padding_m

    width = (max_x - min_x) * scale
    height = (max_y - min_y) * scale

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        fh.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        fh.write(
            f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {width:.2f} {height:.2f}" '
            f'width="100%" height="100%" '
            f'fill-rule="evenodd" '
            f'data-crs="EPSG:28992" '
            f'data-source="PDOK CBS postcode4">\n'
        )
        fh.write(
            "  <title>Nederland PC4 postcodegebieden (PDOK/CBS)</title>\n"
            "  <desc>Generated from "
            f"{ITEMS_URL} in Rijksdriehoek (RD New). "
            "Attribute data-pc4 holds the 4-digit postcode.</desc>\n"
        )
        fh.write(
            f'  <style><![CDATA[\n'
            f'    path.pc4 {{ fill: {fill}; stroke: {stroke}; '
            f'stroke-width: {stroke_width_px}; '
            f'vector-effect: non-scaling-stroke; }}\n'
            f'    path.pc4:hover {{ fill: #c5d4e8; }}\n'
            f'  ]]></style>\n'
        )
        fh.write('  <g id="pc4-layer">\n')

        for code, geom in tqdm(features, desc="Writing SVG paths", unit="pc4"):
            d = geom_to_path_d(geom, min_x=min_x, max_y=max_y, scale=scale)
            if not d:
                continue
            # data-pc4 keeps paths targetable from CSS / frontend JS
            fh.write(
                f'    <path class="pc4" id="pc4-{code}" data-pc4="{code}" d="{d}"/>\n'
            )

        fh.write("  </g>\n</svg>\n")

    return width, height


# ---------------------------------------------------------------------------
# Optional GeoJSON dump (projected)
# ---------------------------------------------------------------------------
def write_geojson(
    features: list[tuple[str, BaseGeometry]],
    out_path: Path,
    *,
    year: int,
) -> None:
    fc = {
        "type": "FeatureCollection",
        "name": "pc4",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::28992"},
        },
        "features": [
            {
                "type": "Feature",
                "properties": {"postcode": code, "jaarcode": year},
                "geometry": mapping(geom),
            }
            for code, geom in features
        ],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(fc), encoding="utf-8")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Fetch PDOK/CBS PC4 polygons and render an SVG map (EPSG:28992).",
    )
    p.add_argument(
        "--year",
        type=int,
        default=2024,
        help="CBS jaarcode to fetch (default: 2024). Passed as OGC query param.",
    )
    p.add_argument(
        "--out",
        type=Path,
        default=Path("output/nl_pc4.svg"),
        help="Output SVG path (default: output/nl_pc4.svg)",
    )
    p.add_argument(
        "--geojson",
        type=Path,
        default=None,
        help="Optional path to also write projected GeoJSON (EPSG:28992).",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"Page size 1..{DEFAULT_LIMIT} (PDOK hard max is {DEFAULT_LIMIT}).",
    )
    p.add_argument(
        "--simplify",
        type=float,
        default=10.0,
        metavar="METRES",
        help=(
            "Simplify tolerance in RD metres (0 = no simplify). Default: 10. "
            "With --topo this is toposimplify per shared arc; with --no-topo "
            "it is per-polygon Douglas–Peucker (can open gaps)."
        ),
    )
    p.add_argument(
        "--topo",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Topology-safe simplify: set_precision(0.5) → topojson shared arcs → "
            "toposimplify (default: on). Use --no-topo for legacy per-polygon simplify "
            "(then prefer --simplify 0; SVG :.2f rounding is topology-safe)."
        ),
    )
    p.add_argument(
        "--padding",
        type=float,
        default=2000.0,
        metavar="METRES",
        help="Padding around NL bbox in RD metres (default: 2000).",
    )
    p.add_argument(
        "--scale",
        type=float,
        default=0.1,
        help="SVG units per RD metre (default: 0.1 → ~28k×33k viewBox for NL).",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT,
        help=f"HTTP timeout seconds per page (default: {DEFAULT_TIMEOUT}).",
    )
    p.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Debug logging.",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    # Aggregate: one geometry per PC4 (jaarcode filter already unique).
    # Do NOT simplify here — that must be batch/topo after all features exist.
    by_code: dict[str, BaseGeometry] = {}
    skipped = 0

    for feat in iter_pc4_features(
        year=args.year,
        limit=args.limit,
        timeout=args.timeout,
    ):
        code = pc4_code(feat)
        geom = feature_geometry(feat)
        geom = clean_for_svg(geom, simplify_m=0.0) if geom else None
        if geom is None:
            skipped += 1
            continue
        # If a postcode somehow appears twice, keep the larger footprint
        if code in by_code and by_code[code].area >= geom.area:
            continue
        by_code[code] = geom

    features = sorted(by_code.items(), key=lambda kv: kv[0])
    log.info(
        "Ready to simplify/render: %d PC4 zones (%d skipped empty/invalid)",
        len(features),
        skipped,
    )
    if not features:
        log.error("No geometries fetched — aborting.")
        return 1

    if not args.topo and args.simplify and args.simplify > 0:
        log.warning(
            "--no-topo with --simplify %.1f: shared borders can diverge up to that "
            "tolerance. Prefer --topo, or --no-topo --simplify 0.",
            args.simplify,
        )

    try:
        features = apply_simplify(
            features,
            simplify_m=args.simplify,
            topo=args.topo,
        )
    except ImportError as exc:
        log.error("%s", exc)
        return 1

    if args.geojson:
        write_geojson(features, args.geojson, year=args.year)
        log.info("Wrote GeoJSON → %s", args.geojson)

    w, h = write_svg(
        features,
        args.out,
        padding_m=args.padding,
        scale=args.scale,
    )
    size_mb = args.out.stat().st_size / (1024 * 1024)
    log.info(
        "Wrote SVG → %s (viewBox %.0f×%.0f, %.1f MB, %d paths)",
        args.out,
        w,
        h,
        size_mb,
        len(features),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
