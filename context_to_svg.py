#!/usr/bin/env python3
"""
Context layer for the PC4 map: sea, Belgium, Germany, and the NL land outline.

Separate file from nl_pc4.svg. The viewBox matches that basemap, so app.js can
stack this SVG underneath without a transform.

  python context_to_svg.py
  python context_to_svg.py --pc4 output/nl_pc4.svg --out output/context.svg

pc4_to_svg.py calls write_context_svg() as its last step. Natural Earth is
cached; only the NL union is recomputed from the PC4 geometries.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path

import requests
from shapely import make_valid, unary_union
from shapely.geometry import Polygon, box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform

log = logging.getLogger("context_to_svg")

ROOT = Path(__file__).resolve().parent
NE_URL = (
    "https://github.com/nvkelso/natural-earth-vector/raw/master/geojson/"
    "ne_10m_admin_0_countries.geojson"
)
NE_CACHE = ROOT / "cache" / "ne_10m_admin_0_countries.geojson"
COUNTRIES = ("BE", "DE")
MARGIN_M = 50_000


def gls_palette(root: Path = ROOT) -> dict[str, str]:
    """Sea and gray from the existing GLS constants. No new hex values."""
    app = (root / "app.js").read_text(encoding="utf-8")
    poster = (root / "poster-template.html").read_text(encoding="utf-8")
    sea = re.search(r'const GLS_STROKE = "([^"]+)"', app)
    gray = re.search(r"--gls-gray:\s*(#[0-9A-Fa-f]{3,8})", poster)
    white = re.search(r"--gls-white:\s*(#[0-9A-Fa-f]{3,8})", poster)
    if not sea or not gray or not white:
        raise RuntimeError("GLS palette constants missing in app.js or poster-template.html")
    return {"sea": sea.group(1), "abroad": gray.group(1), "land": white.group(1)}


def load_countries(cache_path: Path = NE_CACHE) -> dict[str, BaseGeometry]:
    """BE and DE in WGS84. Download is cached."""
    if not cache_path.is_file():
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        log.info("Downloading Natural Earth admin-0 → %s", cache_path)
        resp = requests.get(
            NE_URL,
            timeout=180,
            headers={"User-Agent": "Tool_PostcodeVector/1.0 (context layer; Natural Earth)"},
        )
        resp.raise_for_status()
        cache_path.write_bytes(resp.content)
    else:
        log.info("Natural Earth cache hit → %s", cache_path)

    fc = json.loads(cache_path.read_text(encoding="utf-8"))
    found: dict[str, BaseGeometry] = {}
    for feat in fc.get("features") or []:
        props = feat.get("properties") or {}
        iso = str(props.get("ISO_A2") or props.get("ISO_A2_EH") or "").upper()
        if iso == "-99":
            iso = str(props.get("ADM0_A3") or "").upper()
            iso = {"BEL": "BE", "DEU": "DE"}.get(iso, iso)
        if iso not in COUNTRIES or iso in found:
            continue
        geom = shape(feat["geometry"])
        if geom.is_empty:
            continue
        found[iso] = geom
    missing = [code for code in COUNTRIES if code not in found]
    if missing:
        raise RuntimeError(f"Natural Earth mist {', '.join(missing)}")
    return found


def project_to_rd(geom: BaseGeometry) -> BaseGeometry:
    from pyproj import Transformer

    transformer = Transformer.from_crs("EPSG:4326", "EPSG:28992", always_xy=True)
    return transform(transformer.transform, geom)


def read_viewbox(svg_path: Path) -> str:
    text = svg_path.read_text(encoding="utf-8")
    match = re.search(r'viewBox="([^"]+)"', text)
    if not match:
        raise RuntimeError(f"Geen viewBox in {svg_path}")
    return match.group(1)


def _rings_from_d(d: str) -> list[list[tuple[float, float]]]:
    rings: list[list[tuple[float, float]]] = []
    pts: list[tuple[float, float]] = []
    tokens = re.findall(r"[MLZ]|[-+]?(?:\d+\.\d+|\d+)", d)
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token in "MLZ":
            if token == "Z" and len(pts) >= 3:
                if pts[0] != pts[-1]:
                    pts.append(pts[0])
                rings.append(pts)
                pts = []
            i += 1
            continue
        pts.append((float(token), float(tokens[i + 1])))
        i += 2
    return rings


def polygons_from_svg(svg_path: Path) -> list[tuple[str, Polygon]]:
    """PC4 paths are already in the basemap's SVG user space."""
    text = svg_path.read_text(encoding="utf-8")
    paths = re.findall(r'data-pc4="(\d+)" d="([^"]+)"', text)
    polygons: list[tuple[str, Polygon]] = []
    for code, d in paths:
        current: list[tuple[float, float]] | None = None
        holes: list[list[tuple[float, float]]] = []

        def flush() -> None:
            nonlocal current, holes
            if current is None:
                return
            poly = Polygon(current, holes)
            if not poly.is_valid:
                poly = make_valid(poly)
            if isinstance(poly, Polygon) and not poly.is_empty and poly.area > 0:
                polygons.append((code, poly))
            elif poly.geom_type == "MultiPolygon":
                polygons.extend(
                    (code, g) for g in poly.geoms if isinstance(g, Polygon) and g.area > 0
                )
            current = None
            holes = []

        for ring in _rings_from_d(d):
            ring_poly = Polygon(ring)
            if ring_poly.is_empty or ring_poly.area <= 0:
                continue
            if current is None:
                current = ring
                continue
            host = Polygon(current, holes)
            if host.contains(ring_poly.representative_point()):
                holes.append(ring)
            else:
                flush()
                current = ring
        flush()
    return polygons


def content_bbox(polygons: list[tuple[str, Polygon]]) -> tuple[float, float, float, float]:
    geoms = [p for _, p in polygons]
    min_x = min(p.bounds[0] for p in geoms)
    min_y = min(p.bounds[1] for p in geoms)
    max_x = max(p.bounds[2] for p in geoms)
    max_y = max(p.bounds[3] for p in geoms)
    return min_x, min_y, max_x, max_y


def frame_from_pc4_sample(
    svg_path: Path,
    polygons: list[tuple[str, Polygon]],
    *,
    scale: float,
    padding_m: float,
    year: int = 2024,
) -> dict[str, float]:
    """
    Recover the RD → SVG frame by matching PDOK centroids to the basemap.

    svg_x = (rd_x - min_x) * scale, svg_y = (max_y - rd_y) * scale.
    """
    from pc4_to_svg import CRS_RD_NEW, ITEMS_URL, feature_geometry, pc4_code
    from urllib.parse import urlencode

    params = {"f": "json", "limit": 100, "jaarcode": year, "crs": CRS_RD_NEW}
    page = requests.get(f"{ITEMS_URL}?{urlencode(params)}", timeout=120).json()
    by_code: dict[str, list[Polygon]] = {}
    for code, poly in polygons:
        by_code.setdefault(code, []).append(poly)

    min_xs: list[float] = []
    max_ys: list[float] = []
    for feat in page.get("features") or []:
        code = pc4_code(feat)
        geom = feature_geometry(feat)
        parts = by_code.get(code)
        if geom is None or not parts:
            continue
        rd_c = geom.centroid
        svg_c = unary_union(parts).centroid
        min_xs.append(rd_c.x - svg_c.x / scale)
        max_ys.append(rd_c.y + svg_c.y / scale)
    if len(min_xs) < 5:
        raise RuntimeError("Te weinig PC4-matches om het RD-frame te herstellen")
    min_xs.sort()
    max_ys.sort()
    min_x = min_xs[len(min_xs) // 2]
    max_y = max_ys[len(max_ys) // 2]
    svg_min_x, svg_min_y, svg_max_x, svg_max_y = content_bbox(polygons)
    # NL bbox for the clip: invert the SVG content box with the recovered frame.
    data_min_x = min_x + svg_min_x / scale
    data_max_y = max_y - svg_min_y / scale
    data_max_x = min_x + svg_max_x / scale
    data_min_y = max_y - svg_max_y / scale
    log.info(
        "Frame uit %d PC4-centroids: min_x %.1f max_y %.1f (spread %.1f / %.1f m)",
        len(min_xs),
        min_x,
        max_y,
        min_xs[-1] - min_xs[0],
        max_ys[-1] - max_ys[0],
    )
    view = read_viewbox(svg_path).split()
    return {
        "min_x": min_x,
        "max_y": max_y,
        "scale": scale,
        "width": float(view[2]),
        "height": float(view[3]),
        "data_min_x": data_min_x,
        "data_min_y": data_min_y,
        "data_max_x": data_max_x,
        "data_max_y": data_max_y,
        "padding_m": padding_m,
    }
    view = read_viewbox(svg_path).split()
    width = float(view[2])
    height = float(view[3])
    return {
        "min_x": min_x,
        "max_y": max_y,
        "scale": scale,
        "width": width,
        "height": height,
        "data_min_x": rd_min_x,
        "data_min_y": rd_min_y,
        "data_max_x": rd_max_x,
        "data_max_y": rd_max_y,
        "padding_m": padding_m,
    }


def _svg_path(geom: BaseGeometry, *, min_x: float, max_y: float, scale: float) -> str:
    from pc4_to_svg import geom_to_path_d

    return geom_to_path_d(geom, min_x=min_x, max_y=max_y, scale=scale)


def _ring_d(coords: list[tuple[float, float]]) -> str:
    if len(coords) < 2:
        return ""
    parts: list[str] = []
    for i, (x, y) in enumerate(coords):
        cmd = "M" if i == 0 else "L"
        parts.append(f"{cmd}{x:.2f} {y:.2f}")
    parts.append("Z")
    return "".join(parts)


def _svg_path_user(geom: BaseGeometry) -> str:
    """Geometry is already in SVG user space (parsed from nl_pc4.svg). No Y flip."""
    polygons: list[Polygon] = []
    if isinstance(geom, Polygon):
        polygons = [geom]
    elif geom.geom_type == "MultiPolygon":
        polygons = [g for g in geom.geoms if isinstance(g, Polygon)]
    elif geom.geom_type == "GeometryCollection":
        for child in geom.geoms:
            if isinstance(child, Polygon):
                polygons.append(child)
            elif child.geom_type == "MultiPolygon":
                polygons.extend(g for g in child.geoms if isinstance(g, Polygon))
    chunks: list[str] = []
    for poly in polygons:
        if poly.is_empty:
            continue
        chunks.append(_ring_d(list(poly.exterior.coords)))
        for interior in poly.interiors:
            chunks.append(_ring_d(list(interior.coords)))
    return "".join(chunks)


def write_context_svg(
    features: list[tuple[str, BaseGeometry]],
    *,
    padding_m: float,
    scale: float,
    out_path: Path,
    margin_m: float = MARGIN_M,
) -> Path:
    """Build context.svg from pipeline PC4 geometries. viewBox matches nl_pc4.svg."""
    from pc4_to_svg import compute_svg_frame

    frame = compute_svg_frame(features, padding_m=padding_m, scale=scale)
    log.info("NL union van %d PC4-geometrieën", len(features))
    land = unary_union([geom for _, geom in features if geom is not None and not geom.is_empty])
    land = make_valid(land)
    colors = gls_palette()
    countries = _countries_in_rd(frame, margin_m)
    return _emit(
        out_path,
        viewbox=f"0 0 {frame['width']:.2f} {frame['height']:.2f}",
        width=frame["width"],
        height=frame["height"],
        sea=colors["sea"],
        abroad=colors["abroad"],
        land_fill=colors["land"],
        country_ds={
            iso: _svg_path(geom, min_x=frame["min_x"], max_y=frame["max_y"], scale=scale)
            for iso, geom in countries.items()
        },
        land_d=_svg_path(land, min_x=frame["min_x"], max_y=frame["max_y"], scale=scale),
    )


def _countries_in_rd(frame: dict[str, float], margin_m: float) -> dict[str, BaseGeometry]:
    clipper = box(
        frame["data_min_x"] - margin_m,
        frame["data_min_y"] - margin_m,
        frame["data_max_x"] + margin_m,
        frame["data_max_y"] + margin_m,
    )
    out: dict[str, BaseGeometry] = {}
    for iso, geom_wgs in load_countries().items():
        projected = make_valid(project_to_rd(geom_wgs))
        clipped = projected.intersection(clipper)
        if clipped.is_empty:
            log.warning("%s valt buiten de NL-bbox + %.0f km", iso, margin_m / 1000)
            continue
        out[iso] = clipped
    return out


def write_context_from_svg(
    pc4_svg: Path,
    out_path: Path,
    *,
    scale: float = 0.1,
    padding_m: float = 2000.0,
    margin_m: float = MARGIN_M,
) -> Path:
    """
    Rebuild context.svg from an existing basemap.

    NL land is the union of the SVG paths, so it uses the same coordinates.
    BE/DE are projected with the recovered RD frame.
    """
    log.info("PC4-paden lezen uit %s", pc4_svg)
    polygons = polygons_from_svg(pc4_svg)
    if not polygons:
        raise RuntimeError(f"Geen PC4-paden in {pc4_svg}")
    log.info("NL union van %d vlakken", len(polygons))
    land = make_valid(unary_union([poly for _, poly in polygons]))
    frame = frame_from_pc4_sample(pc4_svg, polygons, scale=scale, padding_m=padding_m)
    colors = gls_palette()
    countries = _countries_in_rd(frame, margin_m)
    country_ds = {
        iso: _svg_path(geom, min_x=frame["min_x"], max_y=frame["max_y"], scale=scale)
        for iso, geom in countries.items()
    }
    return _emit(
        out_path,
        viewbox=read_viewbox(pc4_svg),
        width=frame["width"],
        height=frame["height"],
        sea=colors["sea"],
        abroad=colors["abroad"],
        land_fill=colors["land"],
        country_ds=country_ds,
        land_d=_svg_path_user(land),
    )


def _emit(
    out_path: Path,
    *,
    viewbox: str,
    width: float,
    height: float,
    sea: str,
    abroad: str,
    land_fill: str,
    country_ds: dict[str, str],
    land_d: str,
) -> Path:
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>\n',
        (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" '
            f'width="100%" height="100%" fill-rule="evenodd" '
            f'data-crs="EPSG:28992" data-layer="context">\n'
        ),
        f'  <g id="sea" pointer-events="none">\n'
        f'    <rect x="0" y="0" width="{width:.2f}" height="{height:.2f}" fill="{sea}"/>\n'
        f"  </g>\n",
        '  <g id="abroad" pointer-events="none">\n',
    ]
    for iso in COUNTRIES:
        d = country_ds.get(iso)
        if not d:
            continue
        parts.append(
            f'    <path id="country-{iso}" data-iso="{iso}" fill="{abroad}" stroke="none" d="{d}"/>\n'
        )
    parts.append("  </g>\n")
    parts.append(
        f'  <g id="nl-land" pointer-events="none">\n'
        f'    <path fill="{land_fill}" stroke="none" d="{land_d}"/>\n'
        f"  </g>\n"
    )
    parts.append("</svg>\n")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("".join(parts), encoding="utf-8")
    log.info("Wrote %s (viewBox %s)", out_path, viewbox)
    return out_path


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Build output/context.svg (sea, BE, DE, NL land).")
    p.add_argument("--pc4", type=Path, default=ROOT / "output" / "nl_pc4.svg")
    p.add_argument("--out", type=Path, default=ROOT / "output" / "context.svg")
    p.add_argument("--scale", type=float, default=0.1, help="SVG units per RD metre. Must match nl_pc4.svg.")
    p.add_argument("--padding", type=float, default=2000.0, help="RD padding used when nl_pc4.svg was written.")
    p.add_argument("--margin-km", type=float, default=50.0, help="Clip BE/DE to the NL bbox plus this margin.")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )
    if not args.pc4.is_file():
        log.error("Basiskaart ontbreekt: %s", args.pc4)
        return 1
    write_context_from_svg(
        args.pc4,
        args.out,
        scale=args.scale,
        padding_m=args.padding,
        margin_m=args.margin_km * 1000,
    )
    pc4_box = read_viewbox(args.pc4)
    ctx_box = read_viewbox(args.out)
    if pc4_box != ctx_box:
        log.error("viewBox wijkt af: nl_pc4 %s, context %s", pc4_box, ctx_box)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
