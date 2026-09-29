/**
 * PostcodeVector — batch CSV sets, map preview, GLS A0 poster export.
 */

const SVG_URL = "output/nl_pc4.svg";
const POSTER_TEMPLATE_URL = "poster-template.html";
const GLS_FILL = "#00198C";
/** Lichtere accent-outline op selectie. */
const GLS_STROKE = "#5B7CFF";
const OUTLINE_STROKE = "#9aa3ad";
/**
 * Seal in SVG-user-units (géén non-scaling-stroke).
 * CBS-geometrie heeft echte spleten; die schalen mee bij zoom — een px-stroke niet.
 */
const GLS_SEAL_WIDTH = "18";
const GLS_ACCENT_WIDTH = "1.15";
/** Bump when export SVG structure changes (e.g. labels) so cached set markup rebuilds. */
const SVG_BUILD_VERSION = 15;

/** Real GLS zone CSVs under src/ (semicolon-separated). */
const SRC_ZONE_FILES = [
  "src/Postcodes_Alle_Zones/Postcodes_Zone_10.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_25.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_35.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_41.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_44.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_52.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_60.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_65.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_75.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_80.csv",
  "src/Postcodes_Alle_Zones/Postcodes_Zone_84.csv",
];

const els = {
  badgeMap: document.getElementById("badge-map"),
  badgeData: document.getElementById("badge-data"),
  csvFile: document.getElementById("csv-file"),
  btnDemo: document.getElementById("btn-demo"),
  btnClear: document.getElementById("btn-clear"),
  btnExportAll: document.getElementById("btn-export-all"),
  btnZoomIn: document.getElementById("btn-zoom-in"),
  btnZoomOut: document.getElementById("btn-zoom-out"),
  btnZoomReset: document.getElementById("btn-zoom-reset"),
  mapWrap: document.getElementById("map-wrap"),
  mapEmpty: document.getElementById("map-empty"),
  mapTitle: document.getElementById("map-title"),
  hoverInfo: document.getElementById("hover-info"),
  tooltip: document.getElementById("tooltip"),
  tableHead: document.getElementById("table-head"),
  tableBody: document.getElementById("table-body"),
  batchSetList: document.getElementById("batch-set-list"),
  batchEmpty: document.getElementById("batch-empty"),
  batchProgress: document.getElementById("batch-progress"),
  batchProgressLabel: document.getElementById("batch-progress-label"),
  batchProgressBar: document.getElementById("batch-progress-bar"),
  batchProgressFill: document.getElementById("batch-progress-fill"),
  batchProgressMeta: document.getElementById("batch-progress-meta"),
  posterSet: document.getElementById("poster-set"),
  posterTitle: document.getElementById("poster-title"),
  posterZoneLabel: document.getElementById("poster-zone-label"),
  posterZoneNumber: document.getElementById("poster-zone-number"),
  posterFooter: document.getElementById("poster-footer"),
  posterFrame: document.getElementById("poster-frame"),
  posterPreviewMeta: document.getElementById("poster-preview-meta"),
  posterSetList: document.getElementById("poster-set-list"),
  btnPosterPdf: document.getElementById("btn-poster-pdf"),
  btnPosterPdfAll: document.getElementById("btn-poster-pdf-all"),
};

const REQUIRED_ELS = [
  "mapWrap",
  "batchSetList",
  "tableHead",
  "tableBody",
  "badgeMap",
  "badgeData",
  "btnDemo",
  "csvFile",
];

function assertDom() {
  const missing = REQUIRED_ELS.filter((k) => !els[k]);
  if (!missing.length) return;
  const msg =
    "UI-elementen ontbreken (hard refresh nodig): " +
    missing.map((k) => `#${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`).join(", ");
  console.error(msg, { els });
  document.body?.insertAdjacentHTML(
    "afterbegin",
    `<aside class="lpm-note" style="margin:16px"><strong>DOM-fout</strong><span>${msg}. Doe een hard refresh (Cmd+Shift+R).</span></aside>`,
  );
  throw new Error(msg);
}

function setHtml(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

function setText(el, text) {
  if (!el) return;
  el.textContent = text;
}

function setDisabled(el, disabled) {
  if (!el) return;
  el.disabled = disabled;
}

/** @type {SVGElement | null} */
let svgRoot = null;
/** @type {Map<string, SVGPathElement>} */
let pathByPc4 = new Map();
/** @type {Map<string, { x: number, y: number, w: number, h: number, d: string }>} */
let bboxCache = new Map();
/** @type {any[]} */
let sets = [];
let activeSetId = null;
let posterTemplateHtml = "";
let setIdSeq = 0;
let batchBusy = false;
/** @type {string[]} */
let paintedPc4s = [];

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setBatchProgress(visible, current = 0, total = 0, label = "Bezig…") {
  if (!els.batchProgress) return;
  els.batchProgress.hidden = !visible;
  if (!visible) return;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  setText(els.batchProgressLabel, label);
  setText(els.batchProgressMeta, total ? `${current} / ${total}` : "");
  if (els.batchProgressFill) els.batchProgressFill.style.width = `${pct}%`;
  els.batchProgressBar?.setAttribute("aria-valuenow", String(pct));
}

function setBusyUi(busy) {
  batchBusy = busy;
  setDisabled(els.csvFile, busy);
  setDisabled(els.btnDemo, busy);
  setDisabled(els.btnClear, busy || !sets.length);
  setDisabled(els.btnExportAll, busy || !sets.length);
  setDisabled(els.btnPosterPdf, busy || !sets.length);
  setDisabled(els.btnPosterPdfAll, busy || !sets.length);
}

/* —— Camera —— */
const SCALE_MIN = 1;
const SCALE_MAX = 120;
let mapEventsWired = false;
let isPanning = false;
let panPointerId = null;
let panOriginX = 0;
let panOriginY = 0;
let panMoved = false;
let panHitPc4 = null;
let world = null;
let camera = { cx: 0, cy: 0, scale: 1 };
let cameraRaf = 0;
let wheelRaf = 0;
let wheelAccum = 0;
let wheelX = 0;
let wheelY = 0;
let panRaf = 0;
let panDx = 0;
let panDy = 0;

/* ================================================================== helpers */
function setBadge(el, text, variant) {
  if (!el) return;
  el.textContent = text;
  el.className = "lpm-badge";
  if (variant === "success") el.classList.add("lpm-badge--success");
  if (variant === "quiet") el.classList.add("lpm-badge--quiet");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toPc4(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(0, 4) : null;
}

function baseName(fileName) {
  return String(fileName || "dataset")
    .split(/[/\\]/)
    .pop()
    .replace(/\.csv$/i, "")
    .trim() || "dataset";
}

function safeFileStem(name) {
  return baseName(name).replace(/[^\w.\-()\s\u00C0-\u024F]+/g, "_").trim() || "dataset";
}

function detectDelimiter(text) {
  const first = (text.split(/\r?\n/).find((l) => l.trim()) || "").trim();
  const semis = (first.match(/;/g) || []).length;
  const commas = (first.match(/,/g) || []).length;
  if (semis === 0 && commas === 0) return ",";
  return semis >= commas ? ";" : ",";
}

function parseCsv(text) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) throw new Error("Lege CSV");
  const delim = detectDelimiter(cleaned);
  const lines = cleaned.split(/\r?\n/);
  const headers = splitCsvLine(lines[0], delim).map((h) => h.trim()).filter(Boolean);
  if (!headers.length) throw new Error("Geen kolomkoppen");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i], delim);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  if (!rows.length) throw new Error("Geen datarijen");
  return { headers, rows, delimiter: delim };
}

/** Minimal RFC4180-ish splitter for `,` or `;`. */
function splitCsvLine(line, delim = ",") {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function findPostcodeKey(headers) {
  const lower = headers.map((h) => h.toLowerCase());
  let idx = lower.findIndex(
    (h) => h === "postcode" || h === "pc4" || h === "postcode4" || h === "pc",
  );
  if (idx < 0) idx = lower.findIndex((h) => h.includes("postcode") || h.includes("post_code"));
  return idx >= 0 ? headers[idx] : headers[0];
}

function findHeader(headers, predicates) {
  for (const pred of predicates) {
    const hit = headers.find((h) => pred(h.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function inferPosterMeta(fileName, rows, headers) {
  const stem = baseName(fileName);
  const zoneCol = findHeader(headers, [
    (h) => h === "zone_depot" || h === "zone",
    (h) => h.includes("zone") && h.includes("depot"),
    (h) => h.includes("zone"),
  ]);
  const plaatsCol = findHeader(headers, [
    (h) => h === "plaats" || h === "woonplaats",
    (h) => h.includes("plaats") || h.includes("regio"),
  ]);

  const fromFile = stem.match(/(?:zone|zona)[-_\s]?(\d+)/i);
  const fromCol =
    zoneCol && rows[0] ? String(rows[0][zoneCol]).match(/(\d+)/) : null;
  const zoneNumber = (fromCol && fromCol[1]) || (fromFile && fromFile[1]) || "";

  const places = [
    ...new Set(
      rows
        .map((r) => (plaatsCol ? String(r[plaatsCol] || "").trim() : ""))
        .filter(Boolean),
    ),
  ];

  const title = zoneNumber
    ? `ZONE ${zoneNumber}`
    : stem.replace(/[-_]+/g, " ").toUpperCase();
  const footer =
    places.length > 0
      ? places.slice(0, 5).join(" · ") + (places.length > 5 ? " …" : "")
      : "GLS Netherlands · Zone-indeling";

  return {
    title,
    zoneLabel: "ZONE",
    zoneNumber,
    footer,
  };
}

/* ================================================================== camera */
function parseViewBoxAttr(raw) {
  const parts = String(raw || "").trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function writeViewBox(vb) {
  if (!svgRoot) return;
  svgRoot.setAttribute(
    "viewBox",
    `${vb.x} ${vb.y} ${Math.max(1e-6, Math.abs(vb.w))} ${Math.max(1e-6, Math.abs(vb.h))}`,
  );
}

function applyCamera(immediate = false) {
  if (!world || !svgRoot) return;
  const run = () => {
    cameraRaf = 0;
    camera.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, camera.scale));
    const viewW = world.w / camera.scale;
    const viewH = world.h / camera.scale;
    writeViewBox({
      x: camera.cx - viewW / 2,
      y: camera.cy - viewH / 2,
      w: viewW,
      h: viewH,
    });
  };
  if (immediate) {
    if (cameraRaf) cancelAnimationFrame(cameraRaf);
    cameraRaf = 0;
    run();
    return;
  }
  if (!cameraRaf) cameraRaf = requestAnimationFrame(run);
}

function initCameraFromWorld() {
  if (!world) return;
  camera = { cx: world.x + world.w / 2, cy: world.y + world.h / 2, scale: 1 };
  applyCamera(true);
}

function clientToUser(clientX, clientY) {
  if (!svgRoot) return null;
  const ctm = svgRoot.getScreenCTM();
  if (!ctm) return null;
  const pt = svgRoot.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(ctm.inverse());
}

function zoomAt(clientX, clientY, factor) {
  if (!world || !svgRoot) return;
  const before =
    clientX != null && clientY != null ? clientToUser(clientX, clientY) : null;
  const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, camera.scale * factor));
  if (next === camera.scale) return;
  camera.scale = next;
  applyCamera(true);
  if (before) {
    const after = clientToUser(clientX, clientY);
    if (after) {
      camera.cx += before.x - after.x;
      camera.cy += before.y - after.y;
      applyCamera(true);
    }
  }
}

function panByClientDelta(dx, dy) {
  if (!svgRoot || (!dx && !dy)) return;
  const ctm = svgRoot.getScreenCTM();
  if (!ctm || !ctm.a || !ctm.d) return;
  camera.cx -= dx / ctm.a;
  camera.cy -= dy / ctm.d;
  applyCamera(true);
}

function setCameraToBounds(minX, minY, maxX, maxY, marginRatio = 0.04) {
  if (!world) return;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const pad = Math.max(bw, bh, 20) * marginRatio;
  const needW = bw + pad * 2;
  const needH = bh + pad * 2;
  camera.cx = (minX + maxX) / 2;
  camera.cy = (minY + maxY) / 2;
  camera.scale = Math.min(
    SCALE_MAX,
    Math.max(SCALE_MIN, Math.min(world.w / needW, world.h / needH)),
  );
  applyCamera(true);
}

function fitToPc4s(pc4s) {
  if (!svgRoot || !pc4s.length || !world) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = 0;
  for (const code of new Set(pc4s)) {
    const b = bboxCache.get(code);
    if (!b || (!b.w && !b.h)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    found++;
  }
  if (found) setCameraToBounds(minX, minY, maxX, maxY, 0.05);
}

function boundsForPc4s(pc4s, marginRatio = 0.04) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = 0;
  for (const code of pc4s) {
    const b = bboxCache.get(code);
    if (!b || (!b.w && !b.h)) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    found++;
  }
  if (!found) return null;
  const pad = Math.max(maxX - minX, maxY - minY, 24) * marginRatio;
  return {
    x: minX - pad,
    y: minY - pad,
    w: Math.max(40, maxX - minX + pad * 2),
    h: Math.max(40, maxY - minY + pad * 2),
  };
}

function bboxIntersects(b, vb) {
  return !(
    b.x + b.w < vb.x ||
    b.x > vb.x + vb.w ||
    b.y + b.h < vb.y ||
    b.y > vb.y + vb.h
  );
}

/** A1 print context: region fills the sheet as large as possible. */
const A1_W_MM = 594;
const A1_H_MM = 841;
/** Usable map area on A1 (margins / poster chrome). */
const A1_MAP_W_MM = A1_W_MM * 0.9;
const A1_MAP_H_MM = A1_H_MM * 0.86;
/** Target glyph height on paper (A1, region fills map area). Keep small vs polygons. */
const A1_LABEL_TARGET_MM = 1.0;

/**
 * One shared font-size for all labels in a set.
 * Assumes the set's bounding box is scaled to fill an A1 map area (contain).
 */
function uniformLabelFontSize(pc4s) {
  const vb = boundsForPc4s(pc4s, 0.04);
  if (!vb) return 4;
  const unitsPerMm = Math.max(vb.w / A1_MAP_W_MM, vb.h / A1_MAP_H_MM);
  let fontSize = A1_LABEL_TARGET_MM * unitsPerMm;
  const maxSize = Math.min(vb.w, vb.h) * 0.012;
  const minSize = Math.min(vb.w, vb.h) * 0.0035;
  return Math.min(maxSize, Math.max(minSize, fontSize));
}

/**
 * Parse SVG path `d` (M/L/Z only, as emitted by pc4_to_svg.py) into rings.
 */
function parsePathRings(d) {
  if (!d) return [];
  const rings = [];
  let pts = [];
  const parts = d.match(/[MLZ][^MLZ]*/gi) || [];
  for (const part of parts) {
    const cmd = part[0].toUpperCase();
    if (cmd === "Z") {
      if (pts.length >= 3) rings.push(pts);
      pts = [];
      continue;
    }
    const nums = part
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) {
        pts.push([nums[i], nums[i + 1]]);
      }
    }
  }
  if (pts.length >= 3) rings.push(pts);
  return rings;
}

/** Shoelace centroid + signed area for one ring. */
function ringCentroidArea(pts) {
  if (!pts || pts.length < 3) return null;
  const closed =
    pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
      ? pts
      : pts.concat([pts[0]]);
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < closed.length - 1; i++) {
    const [x0, y0] = closed[i];
    const [x1, y1] = closed[i + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return { x: sx / pts.length, y: sy / pts.length, area: 0 };
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea), area: twiceArea / 2 };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed distance from point to polygon (exterior + holes). Negative = outside. */
function pointToPolygonDist(x, y, polygon) {
  let inside = false;
  let minDistSq = Infinity;
  for (const ring of polygon) {
    if (pointInRing(x, y, ring)) inside = !inside;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[i][0];
      const ay = ring[i][1];
      const bx = ring[j][0];
      const by = ring[j][1];
      let dx = bx - ax;
      let dy = by - ay;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((x - ax) * dx + (y - ay) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx - x;
      const py = ay + t * dy - y;
      minDistSq = Math.min(minDistSq, px * px + py * py);
    }
  }
  const dist = Math.sqrt(minDistSq);
  return inside ? dist : -dist;
}

/**
 * Pole of inaccessibility — thickest interior point (Mapbox polylabel).
 * polygon = [exteriorRing, ...holeRings], each ring = [[x,y], ...]
 */
function polylabel(polygon, precision = 1) {
  const exterior = polygon[0];
  if (!exterior || exterior.length < 3) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of exterior) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (!(cellSize > 0)) return { x: minX, y: minY, distance: 0 };

  const h0 = cellSize / 2;
  /** @type {{ x: number, y: number, h: number, d: number, max: number }[]} */
  const queue = [];

  function makeCell(x, y, h) {
    const d = pointToPolygonDist(x, y, polygon);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  }

  function pushCell(cell) {
    // Insert by descending max potential (simple insertion — queue stays small)
    let i = queue.length;
    while (i > 0 && queue[i - 1].max < cell.max) i--;
    queue.splice(i, 0, cell);
  }

  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      pushCell(makeCell(x + h0, y + h0, h0));
    }
  }

  const cInfo = ringCentroidArea(exterior);
  let best = cInfo
    ? makeCell(cInfo.x, cInfo.y, 0)
    : makeCell(minX + width / 2, minY + height / 2, 0);

  // Bbox center as extra probe
  const bboxCell = makeCell(minX + width / 2, minY + height / 2, 0);
  if (bboxCell.d > best.d) best = bboxCell;

  while (queue.length) {
    const cell = queue.shift();
    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;
    const h = cell.h / 2;
    pushCell(makeCell(cell.x - h, cell.y - h, h));
    pushCell(makeCell(cell.x + h, cell.y - h, h));
    pushCell(makeCell(cell.x - h, cell.y + h, h));
    pushCell(makeCell(cell.x + h, cell.y + h, h));
  }

  return { x: best.x, y: best.y, distance: best.d };
}

/** Max gap (SVG units) between exteriors that still count as één stuk. */
const LABEL_PIECE_MERGE_GAP = 12;

function ringBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** 0 = overlapping/touching bboxes; otherwise corner-to-corner gap. */
function bboxSeparation(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/**
 * Sampled min distance between two ring boundaries (fast enough for label clustering).
 */
function ringBoundaryDistance(a, b) {
  const boxA = ringBBox(a);
  const boxB = ringBBox(b);
  const sep = bboxSeparation(boxA, boxB);
  if (sep > LABEL_PIECE_MERGE_GAP) return sep;

  // Centroids inside each other → overlapping / nested artifact
  const ca = ringCentroidArea(a);
  const cb = ringCentroidArea(b);
  if (ca && pointInRing(ca.x, ca.y, b)) return 0;
  if (cb && pointInRing(cb.x, cb.y, a)) return 0;

  let minSq = Infinity;
  const stepA = Math.max(1, Math.floor(a.length / 48));
  const stepB = Math.max(1, Math.floor(b.length / 48));
  for (let i = 0; i < a.length; i += stepA) {
    const [ax, ay] = a[i];
    for (let j = 0; j < b.length; j += stepB) {
      const dx = ax - b[j][0];
      const dy = ay - b[j][1];
      minSq = Math.min(minSq, dx * dx + dy * dy);
    }
  }
  return Math.sqrt(minSq);
}

/**
 * Group path rings into polygons using path order + containment
 * (matches pc4_to_svg: per feature exterior then holes, then next exterior…).
 */
function groupPathPolygons(rings) {
  const scored = rings
    .map((ring) => ({ ring, info: ringCentroidArea(ring) }))
    .filter((s) => s.info && Math.abs(s.info.area) > 1e-6);
  if (!scored.length) return [];

  const polygons = [];
  for (const item of scored) {
    let parent = null;
    for (let i = polygons.length - 1; i >= 0; i--) {
      const poly = polygons[i];
      if (
        Math.abs(item.info.area) < Math.abs(poly.exterior.info.area) &&
        pointInRing(item.info.x, item.info.y, poly.exterior.ring)
      ) {
        parent = poly;
        break;
      }
    }
    if (parent) {
      parent.holes.push(item);
    } else {
      polygons.push({ exterior: item, holes: [], box: ringBBox(item.ring) });
    }
  }
  return polygons;
}

/** Union-find clusters of polygons that touch / nearly touch. */
function clusterNearbyPolygons(polygons) {
  const n = polygons.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (bboxSeparation(polygons[i].box, polygons[j].box) > LABEL_PIECE_MERGE_GAP) {
        continue;
      }
      if (
        ringBoundaryDistance(polygons[i].exterior.ring, polygons[j].exterior.ring) <=
        LABEL_PIECE_MERGE_GAP
      ) {
        unite(i, j);
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(polygons[i]);
  }
  return [...groups.values()];
}

/**
 * Label anchors: één label per écht los stuk.
 * Aangrenzende/overlappinge bron-vectoren worden samengevoegd; verre eilanden blijven apart.
 */
function pathLabelPoints(d, bboxFallback) {
  const rings = parsePathRings(d);
  if (!rings.length) {
    if (bboxFallback && bboxFallback.w > 0 && bboxFallback.h > 0) {
      return [
        {
          x: bboxFallback.x + bboxFallback.w / 2,
          y: bboxFallback.y + bboxFallback.h / 2,
        },
      ];
    }
    return [];
  }

  const polygons = groupPathPolygons(rings);
  if (!polygons.length) return [];

  const clusters = clusterNearbyPolygons(polygons);
  const points = [];

  for (const cluster of clusters) {
    // Label op het dikste punt van het grootste stuk in de cluster
    let best = cluster[0];
    for (const poly of cluster) {
      if (Math.abs(poly.exterior.info.area) > Math.abs(best.exterior.info.area)) {
        best = poly;
      }
    }
    const holeRings = best.holes.map((h) => h.ring);
    const span = Math.sqrt(Math.abs(best.exterior.info.area));
    const precision = Math.max(0.4, Math.min(2, span / 80));
    const poi = polylabel([best.exterior.ring, ...holeRings], precision);
    if (poi && poi.distance >= 0) {
      points.push({ x: poi.x, y: poi.y });
    } else {
      points.push({ x: best.exterior.info.x, y: best.exterior.info.y });
    }
  }

  if (points.length) return points;
  if (bboxFallback && bboxFallback.w > 0 && bboxFallback.h > 0) {
    return [
      {
        x: bboxFallback.x + bboxFallback.w / 2,
        y: bboxFallback.y + bboxFallback.h / 2,
      },
    ];
  }
  return [];
}

function labelCenters(meta) {
  if (!meta) return [];
  if (Array.isArray(meta.centers) && meta.centers.length) {
    return meta.centers.filter(
      (c) => c && Number.isFinite(c.x) && Number.isFinite(c.y),
    );
  }
  if (Number.isFinite(meta.cx) && Number.isFinite(meta.cy)) {
    return [{ x: meta.cx, y: meta.cy }];
  }
  if (meta.w > 0 && meta.h > 0) {
    return [{ x: meta.x + meta.w / 2, y: meta.y + meta.h / 2 }];
  }
  return [];
}

/** Measure how far the rendered glyph box drifts from the nominal (x,y) anchor. */
function measureLabelGlyphNudge(fontSize, { exportMode = false } = {}) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden";
  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("class", "pc4-label");
  text.setAttribute("x", "0");
  text.setAttribute("y", "0");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("font-size", fontSize.toFixed(2));
  if (exportMode) {
    text.setAttribute("font-family", "Helvetica Neue, Helvetica, Arial, sans-serif");
    text.setAttribute("font-weight", "700");
  }
  text.textContent = "0000";
  svg.appendChild(text);
  document.body.appendChild(svg);
  let dx = 0;
  let dy = 0;
  try {
    const b = text.getBBox();
    dx = -(b.x + b.width / 2);
    dy = -(b.y + b.height / 2);
  } catch {
    /* keep 0 */
  }
  svg.remove();
  return { dx, dy };
}

function labelMarkupForPoint(code, c, fontSize, { fill = "#FFFFFF", exportMode = false, nudge = null } = {}) {
  if (!c || !fontSize) return "";
  const n = nudge || { dx: 0, dy: 0 };
  const x = c.x + n.dx;
  const y = c.y + n.dy;
  return (
    `<text class="pc4-label" data-pc4-label="${code}" ` +
    `x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
    `text-anchor="middle" dominant-baseline="central" ` +
    `font-size="${fontSize.toFixed(2)}" ` +
    `fill="${fill}" stroke="none" stroke-width="0"` +
    (exportMode
      ? ` font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700"`
      : "") +
    `>${code}</text>`
  );
}

function labelMarkup(code, meta, fontSize, opts = {}) {
  return labelCenters(meta)
    .map((c) => labelMarkupForPoint(code, c, fontSize, opts))
    .filter(Boolean)
    .join("");
}

function ensureLabelLayer() {
  if (!svgRoot) return null;
  let layer = svgRoot.querySelector("#pc4-labels");
  if (!layer) {
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("id", "pc4-labels");
    layer.setAttribute("pointer-events", "none");
    svgRoot.appendChild(layer);
  }
  return layer;
}

function clearMapLabels() {
  const layer = svgRoot?.querySelector("#pc4-labels");
  if (layer) layer.replaceChildren();
}

function renderMapLabels(pc4s) {
  const layer = ensureLabelLayer();
  if (!layer) return;
  layer.replaceChildren();
  const fontSize = uniformLabelFontSize(pc4s);
  const nudge = measureLabelGlyphNudge(fontSize, { exportMode: false });
  const frag = document.createDocumentFragment();
  for (const code of pc4s) {
    const meta = bboxCache.get(code);
    for (const c of labelCenters(meta)) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("class", "pc4-label");
      text.setAttribute("data-pc4-label", code);
      text.setAttribute("x", (c.x + nudge.dx).toFixed(2));
      text.setAttribute("y", (c.y + nudge.dy).toFixed(2));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", fontSize.toFixed(2));
      text.setAttribute("stroke", "none");
      text.setAttribute("stroke-width", "0");
      text.textContent = code;
      frag.appendChild(text);
    }
  }
  layer.appendChild(frag);
}

/**
 * Lightweight SVG builder — no cloneNode of the 4MB national map.
 * Uses precomputed bbox + path `d` cache; only writes paths in view.
 */
function buildBatchSvgMarkup(selectedPc4s, { fill = GLS_FILL } = {}) {
  if (!selectedPc4s.length || !bboxCache.size) return null;
  const vb = boundsForPc4s(selectedPc4s, 0.04);
  if (!vb) return null;
  const selectedSet = new Set(selectedPc4s);
  const fontSize = uniformLabelFontSize(selectedPc4s);
  const labelNudge = measureLabelGlyphNudge(fontSize, { exportMode: true });

  const outlines = [];
  const selectedSeal = [];
  const selectedAccent = [];
  const labels = [];

  for (const [code, meta] of bboxCache) {
    if (!bboxIntersects(meta, vb) && !selectedSet.has(code)) continue;
    if (!meta.d) continue;
    if (selectedSet.has(code)) {
      // Seal in user-units (schalt mee) → dekt topologische spleten bij zoom
      selectedSeal.push(
        `<path data-pc4="${code}" data-selected="true" fill="${fill}" stroke="${fill}" stroke-width="${GLS_SEAL_WIDTH}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill" d="${meta.d}"/>`,
      );
      // Accent blijft dun (non-scaling) voor leesbare grenzen op scherm/print
      selectedAccent.push(
        `<path data-pc4="${code}" data-accent="true" fill="none" stroke="${GLS_STROKE}" stroke-width="${GLS_ACCENT_WIDTH}" stroke-linejoin="round" vector-effect="non-scaling-stroke" d="${meta.d}"/>`,
      );
      const lbl = labelMarkup(code, meta, fontSize, {
        fill: "#FFFFFF",
        exportMode: true,
        nudge: labelNudge,
      });
      if (lbl) labels.push(lbl);
    } else {
      outlines.push(
        `<path data-pc4="${code}" data-selected="false" fill="none" stroke="${OUTLINE_STROKE}" stroke-width="0.45" vector-effect="non-scaling-stroke" d="${meta.d}"/>`,
      );
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ` +
    `data-export="batch-zones" data-crs="EPSG:28992" data-label-font="${fontSize.toFixed(2)}">` +
    `<style><![CDATA[#pc4-labels text{stroke:none!important;stroke-width:0!important;paint-order:fill}]]></style>` +
    `<g id="pc4-neighbors">${outlines.join("")}</g>` +
    `<g id="pc4-selected-seal">${selectedSeal.join("")}</g>` +
    `<g id="pc4-selected-accent" pointer-events="none">${selectedAccent.join("")}</g>` +
    `<g id="pc4-labels" pointer-events="none">${labels.join("")}</g></svg>`
  );
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function downloadBlob(filename, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** CRC-32 for ZIP (IEEE). */
const ZIP_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function zipCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = ZIP_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function zipU16(n) {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff);
}

function zipU32(n) {
  return Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

function zipConcat(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Minimal ZIP (STORE, no compression) — genoeg voor SVG-batch zonder dependencies.
 * @param {{ name: string, data: Uint8Array }[]} files
 */
function buildZipStore(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name.replaceAll("\\", "/"));
    const data = file.data;
    const crc = zipCrc32(data);
    const local = zipConcat([
      zipU32(0x04034b50),
      zipU16(20),
      zipU16(0),
      zipU16(0), // method 0 = store
      zipU16(0),
      zipU16(0),
      zipU32(crc),
      zipU32(data.length),
      zipU32(data.length),
      zipU16(nameBytes.length),
      zipU16(0),
      nameBytes,
      data,
    ]);
    const central = zipConcat([
      zipU32(0x02014b50),
      zipU16(20),
      zipU16(20),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU32(crc),
      zipU32(data.length),
      zipU32(data.length),
      zipU16(nameBytes.length),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU32(0),
      zipU32(offset),
      nameBytes,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = zipConcat(centrals);
  const end = zipConcat([
    zipU32(0x06054b50),
    zipU16(0),
    zipU16(0),
    zipU16(files.length),
    zipU16(files.length),
    zipU32(centralDir.length),
    zipU32(offset),
    zipU16(0),
  ]);
  return zipConcat([...locals, centralDir, end]);
}

function uniqueZipEntryName(base, used) {
  let name = base.endsWith(".svg") ? base : `${base}.svg`;
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const stem = name.replace(/\.svg$/i, "");
  let i = 2;
  while (used.has(`${stem}_${i}.svg`)) i++;
  name = `${stem}_${i}.svg`;
  used.add(name);
  return name;
}

function revokeSetUrls(set) {
  if (set.svgUrl) URL.revokeObjectURL(set.svgUrl);
  set.svgUrl = null;
}

/** Build one set SVG off the main thread rhythm (yield before/after). */
async function ensureSetSvg(set) {
  if (set.svgMarkup && set.svgBuildVersion === SVG_BUILD_VERSION) return set;
  set.status = "building";
  renderBatchCards();
  await yieldToMain();
  const markup = buildBatchSvgMarkup(set.selectedPc4s);
  await yieldToMain();
  revokeSetUrls(set);
  set.svgMarkup = markup;
  set.svgBuildVersion = SVG_BUILD_VERSION;
  if (markup) {
    set.svgUrl = URL.createObjectURL(
      new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
    );
  }
  set.status = markup ? "ready" : "empty";
  return set;
}

/* ================================================================== sets */
function createSetFromCsv(fileName, text) {
  const { headers, rows, delimiter } = parseCsv(text);
  const postcodeKey = findPostcodeKey(headers);
  const allPc4 = [
    ...new Set(rows.map((r) => toPc4(r[postcodeKey])).filter(Boolean)),
  ];
  const selectedPc4s = allPc4.filter((pc) => pathByPc4.has(pc));
  const poster = inferPosterMeta(fileName, rows, headers);
  return {
    id: `set-${++setIdSeq}`,
    fileName,
    baseName: safeFileStem(fileName),
    headers,
    rows,
    postcodeKey,
    delimiter,
    totalPc4: allPc4.length,
    selectedPc4s,
    poster,
    svgMarkup: null,
    svgUrl: null,
    status: "pending",
  };
}

/**
 * Process items one-by-one with progress (never build all SVGs in one sync burst).
 * @param {string} label
 * @param {any[]} items
 * @param {(item: any, index: number) => Promise<void>|void} worker
 */
async function runBatchQueue(label, items, worker) {
  if (batchBusy) {
    setText(els.hoverInfo, "Nog bezig met vorige batch…");
    return;
  }
  if (!items.length) return;
  setBusyUi(true);
  setBatchProgress(true, 0, items.length, label);
  try {
    for (let i = 0; i < items.length; i++) {
      const name = items[i].fileName || items[i].name || `#${i + 1}`;
      setBatchProgress(true, i, items.length, `${label}: ${name}`);
      await yieldToMain();
      await worker(items[i], i);
      setBatchProgress(true, i + 1, items.length, `${label}: ${name}`);
      await yieldToMain();
    }
  } finally {
    setBusyUi(false);
    setBatchProgress(false);
    refreshAllUi();
  }
}

function clearAllSets() {
  for (const s of sets) revokeSetUrls(s);
  sets = [];
  activeSetId = null;
  if (els.csvFile) els.csvFile.value = "";
  refreshAllUi();
  resetMapStyles();
  initCameraFromWorld();
  setHtml(els.tableHead, "");
  setHtml(
    els.tableBody,
    '<tr><td class="lpm-muted">Nog geen set geselecteerd.</td></tr>',
  );
  setText(els.mapTitle, "Nederland PC4");
  setText(els.hoverInfo, "Kies een set om te previewen.");
  updatePosterPreview();
}

function getSet(id) {
  return sets.find((s) => s.id === id) || null;
}

function getActiveSet() {
  return getSet(activeSetId);
}

function clearSelectedAccents() {
  const layer = svgRoot?.querySelector("#pc4-selected-accents");
  if (layer) layer.replaceChildren();
}

function ensureSelectedAccentLayer() {
  if (!svgRoot) return null;
  let layer = svgRoot.querySelector("#pc4-selected-accents");
  if (!layer) {
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.setAttribute("id", "pc4-selected-accents");
    layer.setAttribute("pointer-events", "none");
    const labels = svgRoot.querySelector("#pc4-labels");
    if (labels) svgRoot.insertBefore(layer, labels);
    else svgRoot.appendChild(layer);
  }
  return layer;
}

function resetMapStyles() {
  for (const code of paintedPc4s) {
    const path = pathByPc4.get(code);
    if (!path) continue;
    path.style.fill = "";
    path.style.stroke = "";
    path.style.strokeWidth = "";
    path.style.paintOrder = "";
    path.style.vectorEffect = "";
    path.style.strokeLinejoin = "";
    path.style.strokeLinecap = "";
    path.classList.remove("is-active", "is-selected");
  }
  paintedPc4s = [];
  clearSelectedAccents();
  clearMapLabels();
}

function paintSetOnMap(set) {
  // Only touch previously painted + newly selected paths (not all 4000)
  resetMapStyles();
  if (!set) return;
  paintedPc4s = [...set.selectedPc4s];
  const accentLayer = ensureSelectedAccentLayer();
  const accentFrag = document.createDocumentFragment();
  for (const code of paintedPc4s) {
    const path = pathByPc4.get(code);
    if (!path) continue;
    path.classList.add("is-selected");
    // Zelfde stroke als fill in USER UNITS (overschrijf non-scaling van path.pc4)
    path.style.fill = GLS_FILL;
    path.style.stroke = GLS_FILL;
    path.style.strokeWidth = GLS_SEAL_WIDTH;
    path.style.paintOrder = "stroke fill";
    path.style.vectorEffect = "none";
    path.style.strokeLinejoin = "round";
    path.style.strokeLinecap = "round";

    const d = path.getAttribute("d");
    if (accentLayer && d) {
      const accent = document.createElementNS("http://www.w3.org/2000/svg", "path");
      accent.setAttribute("class", "pc4-selected-accent");
      accent.setAttribute("d", d);
      accent.setAttribute("fill", "none");
      accent.setAttribute("stroke", GLS_STROKE);
      accent.setAttribute("stroke-width", GLS_ACCENT_WIDTH);
      accent.setAttribute("stroke-linejoin", "round");
      accent.setAttribute("vector-effect", "non-scaling-stroke");
      accentFrag.appendChild(accent);
    }
  }
  accentLayer?.appendChild(accentFrag);
  renderMapLabels(paintedPc4s);
  fitToPc4s(set.selectedPc4s);
}

function activateSet(id) {
  const set = getSet(id);
  if (!set) return;
  activeSetId = id;
  paintSetOnMap(set);
  setText(els.mapTitle, set.baseName);
  setText(
    els.hoverInfo,
    `${set.selectedPc4s.length}/${set.totalPc4 || "?"} PC4 op kaart · ${set.fileName}`,
  );
  renderTable(set);
  renderBatchCards();
  syncPosterFields(set);
  highlightPosterSelect(id);
  if (set.svgMarkup && set.svgBuildVersion === SVG_BUILD_VERSION) updatePosterPreview();
  else {
    setText(els.posterPreviewMeta, "Kaart wordt gebouwd…");
    ensureSetSvg(set).then(() => {
      renderBatchCards();
      if (activeSetId === set.id) updatePosterPreview();
    });
  }
}

function renderTable(set) {
  if (!set) {
    setHtml(els.tableHead, "");
    setHtml(
      els.tableBody,
      '<tr><td class="lpm-muted">Nog geen set geselecteerd.</td></tr>',
    );
    return;
  }
  const cols = set.headers;
  setHtml(
    els.tableHead,
    "<tr>" +
      cols.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("") +
      "<th>PC4</th><th>Kaart</th></tr>",
  );
  const frag = document.createDocumentFragment();
  // Cap table rows for UI responsiveness (full data remains in set.rows)
  const maxRows = 500;
  const slice = set.rows.slice(0, maxRows);
  for (const row of slice) {
    const pc4 = toPc4(row[set.postcodeKey]);
    const matched = pc4 && pathByPc4.has(pc4);
    const tr = document.createElement("tr");
    tr.className = matched ? "is-matched" : "is-missing";
    if (matched) tr.dataset.pc4 = pc4;
    tr.innerHTML =
      cols.map((h) => `<td>${escapeHtml(row[h] ?? "")}</td>`).join("") +
      `<td>${escapeHtml(pc4 || "—")}</td>` +
      `<td>${matched ? "Gekoppeld" : "Niet gevonden"}</td>`;
    frag.appendChild(tr);
  }
  if (!els.tableBody) return;
  els.tableBody.innerHTML = "";
  els.tableBody.appendChild(frag);
  if (set.rows.length > maxRows) {
    const note = document.createElement("tr");
    note.innerHTML = `<td colspan="${cols.length + 2}" class="lpm-muted">Toont ${maxRows} van ${set.rows.length} rijen (performance).</td>`;
    els.tableBody.appendChild(note);
  }
}

function renderBatchCards() {
  const has = sets.length > 0;
  setDisabled(els.btnClear, !has || batchBusy);
  setDisabled(els.btnExportAll, !has || !svgRoot || batchBusy);
  setDisabled(els.btnPosterPdf, !has || batchBusy);
  setDisabled(els.btnPosterPdfAll, !has || batchBusy);
  setBadge(els.badgeData, `${sets.length} set${sets.length === 1 ? "" : "s"}`, has ? "success" : "quiet");

  if (!has) {
    setHtml(
      els.batchSetList,
      '<p class="lpm-muted" id="batch-empty">Nog geen sets. Upload CSV’s of laad de GLS-zones uit <code>src/</code>.</p>',
    );
    setHtml(els.posterSetList, "");
    setHtml(els.posterSet, '<option value="">— eerst batch laden —</option>');
    setDisabled(els.posterSet, true);
    return;
  }

  setHtml(
    els.batchSetList,
    sets
      .map((s) => {
        const active = s.id === activeSetId ? " is-active" : "";
        const building = s.status === "building" || s.status === "pending" ? " is-building" : "";
        const statusLabel =
          s.status === "building"
            ? "Kaart bouwen…"
            : s.status === "pending"
              ? "In wachtrij"
              : s.status === "empty"
                ? "Geen match op kaart"
                : `${s.selectedPc4s.length}/${s.totalPc4 || s.selectedPc4s.length} PC4 op kaart`;
        const thumb = s.svgUrl
          ? `<img class="batch-card__thumb" src="${s.svgUrl}" alt="">`
          : `<div class="batch-card__thumb batch-card__thumb--empty">${s.status === "building" ? "…" : "SVG"}</div>`;
        return `<article class="batch-card${active}${building}" data-set-id="${s.id}">
        ${thumb}
        <div class="batch-card__body">
          <strong>${escapeHtml(s.baseName)}</strong>
          <span class="batch-card__status">${escapeHtml(statusLabel)}</span>
          <span class="lpm-muted">${escapeHtml(s.fileName)}</span>
          <div class="batch-card__actions">
            <button type="button" class="lpm-btn lpm-btn--brand" data-action="preview">Preview</button>
            <button type="button" class="lpm-btn lpm-btn--outline" data-action="download">SVG</button>
            <button type="button" class="lpm-btn lpm-btn--outline" data-action="poster">Poster</button>
            <button type="button" class="lpm-btn lpm-btn--outline" data-action="remove" aria-label="Verwijder set">×</button>
          </div>
        </div>
      </article>`;
      })
      .join(""),
  );

  setHtml(
    els.posterSetList,
    sets
      .map(
        (s) =>
          `<button type="button" class="batch-mini${s.id === activeSetId ? " is-active" : ""}" data-set-id="${s.id}">
          <strong>${escapeHtml(s.baseName)}</strong>
          <span>Zone ${escapeHtml(s.poster.zoneNumber || "—")}</span>
        </button>`,
      )
      .join(""),
  );

  setDisabled(els.posterSet, false);
  setHtml(
    els.posterSet,
    sets
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === activeSetId ? "selected" : ""}>${escapeHtml(s.baseName)} (${s.selectedPc4s.length}/${s.totalPc4 || s.selectedPc4s.length} PC4)</option>`,
      )
      .join(""),
  );
}

function refreshAllUi() {
  renderBatchCards();
}

function highlightPosterSelect(id) {
  if (els.posterSet) els.posterSet.value = id;
}

function syncPosterFields(set) {
  if (!set) return;
  if (els.posterTitle) els.posterTitle.value = set.poster.title;
  if (els.posterZoneLabel) els.posterZoneLabel.value = set.poster.zoneLabel;
  if (els.posterZoneNumber) els.posterZoneNumber.value = set.poster.zoneNumber;
  if (els.posterFooter) els.posterFooter.value = set.poster.footer;
}

function readPosterFieldsIntoSet(set) {
  if (!set) return;
  set.poster.title = (els.posterTitle?.value || "").trim() || set.baseName.toUpperCase();
  set.poster.zoneLabel = (els.posterZoneLabel?.value || "").trim() || "ZONE";
  set.poster.zoneNumber = (els.posterZoneNumber?.value || "").trim();
  set.poster.footer =
    (els.posterFooter?.value || "").trim() || "GLS Netherlands · Zone-indeling";
}

/* ================================================================== poster */
function fillPosterTemplate(set, { printMode = false } = {}) {
  if (!posterTemplateHtml || !set) return "";
  const mapInner = set.svgMarkup
    ? set.svgMarkup.replace(/^<\?xml[^>]*>\s*/i, "")
    : "";
  const hasMap = Boolean(mapInner);
  let html = posterTemplateHtml
    .replaceAll("{{POSTER_TITEL}}", escapeHtml(set.poster.title))
    .replaceAll("{{ZONE_LABEL_TEKST}}", escapeHtml(set.poster.zoneLabel))
    .replaceAll("{{ZONE_NUMMER}}", escapeHtml(set.poster.zoneNumber))
    .replaceAll("{{FOOTER_TEKST}}", escapeHtml(set.poster.footer))
    .replaceAll("{{MAP_HAS_CLASS}}", hasMap ? " has-map" : "")
    .replaceAll("{{MAP_SVG}}", mapInner)
    .replaceAll("{{MAP_AFBEELDING_URL}}", set.svgUrl || "");
  if (printMode) {
    html = html.replace("<body>", '<body class="is-print">');
  }
  return html;
}

function updatePosterPreview() {
  const set = getActiveSet();
  if (!els.posterFrame) return;
  if (!set || !posterTemplateHtml) {
    els.posterFrame.srcdoc =
      "<p style='font-family:sans-serif;padding:24px;color:#666'>Selecteer een set om de poster te tonen.</p>";
    setText(els.posterPreviewMeta, "Selecteer een set om de poster te tonen.");
    return;
  }
  readPosterFieldsIntoSet(set);
  els.posterFrame.srcdoc = fillPosterTemplate(set);
  setText(els.posterPreviewMeta, `${set.baseName} · A0 preview (841×1189)`);
}

function openPosterPrint(setsToPrint) {
  const list = setsToPrint.filter(Boolean);
  if (!list.length) return;
  for (const s of list) {
    if (s === getActiveSet()) readPosterFieldsIntoSet(s);
  }

  let html;
  if (list.length === 1) {
    html = fillPosterTemplate(list[0], { printMode: true });
  } else {
    const styleMatch = posterTemplateHtml.match(/<style>[\s\S]*?<\/style>/);
    const style = styleMatch ? styleMatch[0] : "";
    const bodies = list.map((s) => extractPosterContainer(fillPosterTemplate(s, { printMode: true }))).join("\n");
    html = `<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>GLS Posters A0</title>${style}
<style>@page{size:A0;margin:0}.poster-container{page-break-after:always;break-after:page}</style>
</head><body class="is-print">${bodies}</body></html>`;
  }

  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up geblokkeerd. Sta pop-ups toe om PDF te exporteren.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  const trigger = () => {
    try {
      w.focus();
      w.print();
    } catch {
      /* ignore */
    }
  };
  w.addEventListener("load", () => setTimeout(trigger, 400));
  setTimeout(trigger, 900);
}

function extractPosterContainer(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const el = doc.querySelector(".poster-container");
  return el ? el.outerHTML : "";
}

/* ================================================================== map load / events */
async function loadSvg() {
  setBadge(els.badgeMap, "Kaart laden…", "quiet");
  setBatchProgress(true, 0, 1, "Basiskaart downloaden…");
  const res = await fetch(SVG_URL);
  if (!res.ok) throw new Error(`SVG niet gevonden (${res.status})`);
  const text = await res.text();
  await yieldToMain();
  if (!els.mapWrap) throw new Error("Kaartcontainer (#map-wrap) ontbreekt");
  els.mapWrap.innerHTML = text;
  svgRoot = els.mapWrap.querySelector("svg");
  if (!svgRoot) throw new Error("Ongeldige SVG");
  const style = svgRoot.querySelector("style");
  if (style) style.remove();

  pathByPc4 = new Map();
  const nodes = [...svgRoot.querySelectorAll("path[data-pc4]")];
  for (const path of nodes) {
    pathByPc4.set(path.getAttribute("data-pc4"), path);
  }

  world = parseViewBoxAttr(svgRoot.getAttribute("viewBox"));
  svgRoot.dataset.fullViewbox = svgRoot.getAttribute("viewBox") || "";
  svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
  initCameraFromWorld();
  wireMapEvents();

  // Cache bboxes in chunks — getBBox×4071 in one go freezes the tab
  bboxCache = new Map();
  const entries = [...pathByPc4.entries()];
  const chunk = 200;
  setBatchProgress(true, 0, entries.length, "Indexeren PC4-grenzen…");
  for (let i = 0; i < entries.length; i += chunk) {
    for (const [code, path] of entries.slice(i, i + chunk)) {
      try {
        const b = path.getBBox();
        const d = path.getAttribute("d") || "";
        const box = { x: b.x, y: b.y, w: b.width, h: b.height };
        const centers = pathLabelPoints(d, box);
        const primary = centers[0] || {
          x: box.x + box.w / 2,
          y: box.y + box.h / 2,
        };
        bboxCache.set(code, {
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          d,
          cx: primary.x,
          cy: primary.y,
          centers,
        });
      } catch {
        /* skip bad path */
      }
    }
    setBatchProgress(
      true,
      Math.min(entries.length, i + chunk),
      entries.length,
      "Indexeren PC4-grenzen…",
    );
    await yieldToMain();
  }

  setBatchProgress(false);
  setBadge(els.badgeMap, `${pathByPc4.size} PC4-gebieden`, "success");
  refreshAllUi();
  if (activeSetId) activateSet(activeSetId);
}

function flushWheelZoom() {
  wheelRaf = 0;
  if (!wheelAccum) return;
  const dy = Math.max(-240, Math.min(240, wheelAccum));
  wheelAccum = 0;
  zoomAt(wheelX, wheelY, Math.exp(-dy * 0.0018));
}

function wireMapEvents() {
  if (!svgRoot || mapEventsWired) return;
  mapEventsWired = true;

  els.mapWrap.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      hideTooltip();
      const unit =
        ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? els.mapWrap.clientHeight : 1;
      wheelAccum += ev.deltaY * unit;
      wheelX = ev.clientX;
      wheelY = ev.clientY;
      if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheelZoom);
    },
    { passive: false },
  );

  els.mapWrap.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    isPanning = true;
    panMoved = false;
    panPointerId = ev.pointerId;
    panOriginX = ev.clientX;
    panOriginY = ev.clientY;
    panDx = 0;
    panDy = 0;
    panHitPc4 = ev.target.closest?.("path[data-pc4]")?.getAttribute("data-pc4") || null;
    els.mapWrap.classList.add("is-panning");
    svgRoot?.setAttribute("shape-rendering", "optimizeSpeed");
    els.mapWrap.setPointerCapture(ev.pointerId);
    hideTooltip();
  });

  els.mapWrap.addEventListener("pointermove", (ev) => {
    if (isPanning && ev.pointerId === panPointerId) {
      const dx = ev.clientX - panOriginX;
      const dy = ev.clientY - panOriginY;
      panOriginX = ev.clientX;
      panOriginY = ev.clientY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) panMoved = true;
      panDx += dx;
      panDy += dy;
      if (!panRaf) {
        panRaf = requestAnimationFrame(() => {
          panRaf = 0;
          const x = panDx;
          const y = panDy;
          panDx = 0;
          panDy = 0;
          panByClientDelta(x, y);
        });
      }
      return;
    }
    const path = ev.target.closest?.("path[data-pc4]");
    if (!path) {
      hideTooltip();
      return;
    }
    showTooltip(ev.clientX, ev.clientY, path.getAttribute("data-pc4"));
  });

  const endPan = (ev) => {
    if (ev.pointerId !== panPointerId) return;
    const wasClick = isPanning && !panMoved;
    const hit = panHitPc4;
    isPanning = false;
    panPointerId = null;
    panHitPc4 = null;
    els.mapWrap.classList.remove("is-panning");
    svgRoot?.removeAttribute("shape-rendering");
    try {
      els.mapWrap.releasePointerCapture(ev.pointerId);
    } catch {
      /* */
    }
    if (wasClick && hit) {
      setText(els.hoverInfo, `PC4 ${hit}`);
      fitToPc4s([hit]);
    }
  };

  els.mapWrap.addEventListener("pointerup", endPan);
  els.mapWrap.addEventListener("pointercancel", endPan);

  els.mapWrap.addEventListener("keydown", (ev) => {
    if (ev.key === "+" || ev.key === "=") {
      ev.preventDefault();
      zoomAt(null, null, 1.25);
    } else if (ev.key === "-" || ev.key === "_") {
      ev.preventDefault();
      zoomAt(null, null, 1 / 1.25);
    } else if (ev.key === "0") {
      ev.preventDefault();
      initCameraFromWorld();
    }
  });

  els.tableBody.addEventListener("click", (ev) => {
    const tr = ev.target.closest("tr[data-pc4]");
    if (!tr) return;
    fitToPc4s([tr.dataset.pc4]);
  });
}

function showTooltip(x, y, pc4) {
  if (!els.tooltip) return;
  const set = getActiveSet();
  const row = set?.rows.find((r) => toPc4(r[set.postcodeKey]) === pc4);
  let body = `<strong>PC4 ${escapeHtml(pc4)}</strong>`;
  if (row) {
    body += Object.entries(row)
      .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`)
      .join("<br>");
  } else {
    body += "Niet in actieve set";
  }
  els.tooltip.innerHTML = body;
  els.tooltip.hidden = false;
  els.tooltip.style.left = `${x}px`;
  els.tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  if (els.tooltip) els.tooltip.hidden = true;
}

/* ================================================================== tabs */
function setupTabs() {
  const buttons = document.querySelectorAll(".pc4-tab");
  const panels = {
    map: document.getElementById("tab-map"),
    poster: document.getElementById("tab-poster"),
  };
  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      for (const b of buttons) {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      }
      for (const [key, panel] of Object.entries(panels)) {
        panel.hidden = key !== tab;
      }
      if (tab === "poster") updatePosterPreview();
    });
  }
}

/* ================================================================== wire UI */
async function loadPosterTemplate() {
  const res = await fetch(POSTER_TEMPLATE_URL);
  if (!res.ok) throw new Error("poster-template.html niet gevonden");
  posterTemplateHtml = await res.text();
}

async function ingestFiles(fileList) {
  if (!svgRoot || !bboxCache.size) {
    alert("Wacht tot de basiskaart klaar is met indexeren.");
    return;
  }
  const files = [...fileList];
  const errors = [];
  let firstId = null;

  await runBatchQueue("CSV verwerken", files, async (file) => {
    try {
      const text = await file.text();
      await yieldToMain();
      const set = createSetFromCsv(file.name, text);
      sets.push(set);
if (firstId) {
          firstId = set.id;
          activeSetId = set.id;
          paintSetOnMap(set);
          renderTable(set);
          syncPosterFields(set);
          setText(els.mapTitle, set.baseName);
        }
        renderBatchCards();
        await ensureSetSvg(set);
        renderBatchCards();
      } catch (err) {
        errors.push(`${file.name}: ${err.message || err}`);
      }
    });

  if (firstId) activateSet(firstId);
  setText(els.hoverInfo, `${files.length - errors.length} set(s) geladen.`);
  if (errors.length) alert(errors.join("\n"));
  if (els.csvFile) els.csvFile.value = "";
}

els.csvFile?.addEventListener("change", () => {
  if (els.csvFile.files?.length) ingestFiles(els.csvFile.files);
});

els.btnDemo?.addEventListener("click", async () => {
  if (!svgRoot || !bboxCache.size) {
    alert("Wacht tot de basiskaart klaar is met indexeren.");
    return;
  }
  let firstId = null;
  const errors = [];

  await runBatchQueue(
    "GLS zones laden",
    SRC_ZONE_FILES.map((path) => ({ path, fileName: path.split("/").pop() })),
    async (item) => {
      try {
        const res = await fetch(item.path, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        await yieldToMain();
        const set = createSetFromCsv(item.fileName, text);
        sets.push(set);
        if (!firstId) {
          firstId = set.id;
          activeSetId = set.id;
          paintSetOnMap(set);
          renderTable(set);
          syncPosterFields(set);
          setText(els.mapTitle, set.baseName);
        }
        renderBatchCards();
        await ensureSetSvg(set);
        renderBatchCards();
      } catch (err) {
        errors.push(`${item.fileName}: ${err.message || err}`);
      }
    },
  );

  if (firstId) activateSet(firstId);
  const ok = SRC_ZONE_FILES.length - errors.length;
  setText(els.hoverInfo, `${ok} GLS-zone(s) uit src/ geladen.`);
  if (errors.length) alert(errors.join("\n"));
});

els.btnClear?.addEventListener("click", () => {
  if (batchBusy) return;
  clearAllSets();
});

els.btnExportAll?.addEventListener("click", async () => {
  if (!sets.length) return;
  const enc = new TextEncoder();
  const files = [];
  const usedNames = new Set();
  await runBatchQueue("SVG’s voor zip", sets, async (set) => {
    await ensureSetSvg(set);
    if (!set.svgMarkup) return;
    const name = uniqueZipEntryName(`${set.baseName}.svg`, usedNames);
    files.push({ name, data: enc.encode(set.svgMarkup) });
  });
  if (!files.length) {
    alert("Geen SVG’s om te downloaden.");
    return;
  }
  setBatchProgress(true, files.length, files.length, "Zip maken…");
  await yieldToMain();
  const zipBytes = buildZipStore(files);
  downloadBlob(
    `postcodevector-svgs-${files.length}.zip`,
    new Blob([zipBytes], { type: "application/zip" }),
  );
  setBatchProgress(false);
  setText(els.hoverInfo, `${files.length} SVG’s als zip gedownload.`);
});

els.batchSetList?.addEventListener("click", async (ev) => {
  if (batchBusy) return;
  const btn = ev.target.closest("[data-action]");
  const card = ev.target.closest("[data-set-id]");
  if (!card) return;
  const set = getSet(card.dataset.setId);
  if (!set) return;
  const action = btn?.dataset.action || "preview";
  if (action === "remove") {
    revokeSetUrls(set);
    sets = sets.filter((s) => s.id !== set.id);
    if (activeSetId === set.id) activeSetId = sets[0]?.id || null;
    refreshAllUi();
    if (activeSetId) activateSet(activeSetId);
    else clearAllSets();
    return;
  }
  if (action === "download") {
    setBatchProgress(true, 0, 1, `SVG bouwen: ${set.baseName}`);
    setBusyUi(true);
    try {
      await ensureSetSvg(set);
      if (set.svgMarkup) {
        downloadText(`${set.baseName}.svg`, set.svgMarkup, "image/svg+xml;charset=utf-8");
      }
      renderBatchCards();
    } finally {
      setBusyUi(false);
      setBatchProgress(false);
    }
    return;
  }
  if (action === "poster") {
    activateSet(set.id);
    document.getElementById("tab-btn-poster")?.click();
    return;
  }
  activateSet(set.id);
});

els.posterSetList?.addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-set-id]");
  if (!btn) return;
  activateSet(btn.dataset.setId);
});

els.posterSet?.addEventListener("change", () => {
  if (els.posterSet.value) activateSet(els.posterSet.value);
});

for (const input of [
  els.posterTitle,
  els.posterZoneLabel,
  els.posterZoneNumber,
  els.posterFooter,
]) {
  input?.addEventListener("input", () => {
    const set = getActiveSet();
    if (!set) return;
    readPosterFieldsIntoSet(set);
    updatePosterPreview();
  });
}

els.btnPosterPdf?.addEventListener("click", async () => {
  const set = getActiveSet();
  if (!set || batchBusy) return;
  setBusyUi(true);
  setBatchProgress(true, 0, 1, `Poster voorbereiden: ${set.baseName}`);
  try {
    readPosterFieldsIntoSet(set);
    await ensureSetSvg(set);
    updatePosterPreview();
    openPosterPrint([set]);
  } finally {
    setBusyUi(false);
    setBatchProgress(false);
  }
});

els.btnPosterPdfAll?.addEventListener("click", async () => {
  if (!sets.length || batchBusy) return;
  await runBatchQueue("Posters voorbereiden", sets, async (set) => {
    await ensureSetSvg(set);
  });
  openPosterPrint(sets);
});

els.btnZoomIn?.addEventListener("click", () => zoomAt(null, null, 1.35));
els.btnZoomOut?.addEventListener("click", () => zoomAt(null, null, 1 / 1.35));
els.btnZoomReset?.addEventListener("click", () => initCameraFromWorld());

setupTabs();

try {
  assertDom();
} catch (err) {
  console.error(err);
}

Promise.all([loadSvg(), loadPosterTemplate()]).catch((err) => {
  setBadge(els.badgeMap, "Laadfout", "quiet");
  console.error(err);
  setHtml(
    els.mapWrap,
    `<div class="pc4-map-empty"><p>${escapeHtml(err.message || String(err))}</p></div>`,
  );
});
