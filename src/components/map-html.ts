import type { GpsOfficer } from "../lib/gps-api"
import type { RouteSummary } from "../lib/route"
import { formatDuration, formatTime, initials, timeAgo } from "../lib/format"
import { MAP_KEY } from "../config"

export type MapPin = {
  id: number
  lat: number
  lng: number
  initials: string
  name: string
  status: GpsOfficer["status"]
  detail: string
}

export type MapMarker = { lat: number; lng: number; label: string }

/** Everything the map page draws. `fitKey` changes whenever the view should re-frame. */
export type MapData = {
  pins: MapPin[]
  selectedId: number | null
  trail: [number, number][]
  start: MapMarker | null
  stops: MapMarker[]
  fitKey: string
}

export function hasFix(o: GpsOfficer): boolean {
  return o.latitude != null && o.longitude != null && !(o.latitude === 0 && o.longitude === 0)
}

export function buildMapData(
  officers: GpsOfficer[],
  selectedId: number | null,
  route: RouteSummary | null,
  fitKey: string,
): MapData {
  const pins = officers.filter(hasFix).map((o) => ({
    id: o.userId,
    lat: o.latitude as number,
    lng: o.longitude as number,
    initials: initials(o.name || o.username),
    name: o.name || o.username,
    status: o.status,
    detail: [o.onDuty ? "On duty" : "Off duty", `Updated ${timeAgo(o.recordedAt)}`, o.batteryPct != null ? `Battery ${o.batteryPct}%` : ""]
      .filter(Boolean)
      .join(" · "),
  }))
  const start = route?.start
  return {
    pins,
    selectedId,
    trail: route ? route.points.map((p) => [p.latitude, p.longitude]) : [],
    start: start
      ? { lat: start.latitude, lng: start.longitude, label: `Route start · ${formatTime(start.recordedAt)}${start.locationName ? `<br>${start.locationName}` : ""}` }
      : null,
    stops: (route?.stops ?? []).map((s) => ({
      lat: s.latitude,
      lng: s.longitude,
      label: `Stopped ${formatDuration(s.durationSec)} · ${formatTime(s.from)}–${formatTime(s.to)}${s.locationName ? `<br>${s.locationName}` : ""}`,
    })),
    fitKey,
  }
}

/** JSON that is safe to drop inside a <script> tag. */
export function scriptJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

const MAP_SCRIPT = `
var map = L.map('map', { zoomControl: false }).setView([34.0151, 71.5249], 12);
var street = L.tileLayer(STREET_URL, {
  maxZoom: 19, subdomains: 'abc', attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 19, attribution: 'Imagery &copy; Esri'
});
L.control.zoom({ position: 'bottomright' }).addTo(map);
var routeLayer = L.layerGroup().addTo(map);
var pinLayer = L.layerGroup().addTo(map);
var last = null, lastFit = null, satellite = false;

function send(msg) {
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  else if (window.parent !== window) window.parent.postMessage({ source: 'ciis-map', payload: msg }, '*');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
// Labels may carry a <br>; escape everything else.
function label(s) { return esc(s).replace(/&lt;br&gt;/g, '<br>'); }
function bearing(a, b) {
  var r = Math.PI / 180;
  var y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  var x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return Math.atan2(y, x) / r;
}

function fit() {
  if (!last) return;
  var pts = [];
  var sel = null;
  last.pins.forEach(function (p) { if (p.id === last.selectedId) sel = p; });
  if (last.selectedId != null && (last.trail.length || sel)) {
    pts = last.trail.slice();
    if (sel) pts.push([sel.lat, sel.lng]);
  } else {
    last.pins.forEach(function (p) { pts.push([p.lat, p.lng]); });
  }
  if (!pts.length) return;
  if (pts.length === 1) map.setView(pts[0], 16);
  else map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 17 });
}

function render(d) {
  routeLayer.clearLayers();
  pinLayer.clearLayers();
  var t = d.trail;
  if (t.length > 1) {
    L.polyline(t, { color: '#ffffff', weight: 9, opacity: 0.9 }).addTo(routeLayer);
    L.polyline(t, { color: '#13294b', weight: 5 }).addTo(routeLayer);
    var step = Math.max(1, Math.floor(t.length / 14));
    for (var i = step; i < t.length; i += step) {
      var a = t[i - 1], b = t[i];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [14, 14], iconAnchor: [7, 7],
          html: '<div class="arrow" style="transform:rotate(' + bearing(a, b) + 'deg)">&#9650;</div>' })
      }).addTo(routeLayer);
    }
  }
  d.stops.forEach(function (s, i) {
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="stop">' + (i + 1) + '</div>' })
    }).bindPopup(label(s.label)).addTo(routeLayer);
  });
  if (d.start) {
    L.marker([d.start.lat, d.start.lng], {
      icon: L.divIcon({ className: '', iconSize: [24, 24], iconAnchor: [12, 12], html: '<div class="start">S</div>' })
    }).bindPopup(label(d.start.label)).addTo(routeLayer);
  }
  d.pins.forEach(function (p) {
    var sel = p.id === d.selectedId;
    var size = sel ? 44 : 34;
    var m = L.marker([p.lat, p.lng], {
      zIndexOffset: sel ? 1000 : 0,
      icon: L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: '<div class="pin ' + esc(p.status) + (sel ? ' sel' : '') + '">' + esc(p.initials) + '</div>' })
    }).bindPopup('<b>' + esc(p.name) + '</b><br><span class="pop">' + esc(p.detail) + '</span>');
    m.on('click', function () { send({ type: 'select', id: p.id }); });
    m.addTo(pinLayer);
  });
  if (d.fitKey !== lastFit) { lastFit = d.fitKey; fit(); }
}

window.__ciisUpdate = function (d) { last = d; render(d); };
document.getElementById('fit').onclick = fit;
document.getElementById('layer').onclick = function () {
  satellite = !satellite;
  map.removeLayer(satellite ? street : sat);
  (satellite ? sat : street).addTo(map);
  this.textContent = satellite ? 'Map' : 'Sat';
};
`

const MAP_CSS = `
html,body,#map{height:100%;margin:0;background:#e6ebf2;font-family:-apple-system,"Segoe UI",Roboto,sans-serif}
.pin{position:relative;width:100%;height:100%;box-sizing:border-box;border-radius:50%;background:#13294b;color:#fff;
  font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;border:3px solid #22c55e;
  box-shadow:0 2px 6px rgba(0,0,0,.35)}
.pin.stale{border-color:#f59e0b}
.pin.offline{background:#64748b;border-color:#e2e8f0}
.pin.sel{border-color:#c9a227;font-size:14px}
.pin.sel:after{content:"";position:absolute;inset:-9px;border-radius:50%;border:3px solid #c9a227;animation:pulse 1.6s ease-out infinite}
@keyframes pulse{from{transform:scale(.75);opacity:1}to{transform:scale(1.45);opacity:0}}
.arrow{color:#c9a227;font-size:12px;line-height:14px;text-align:center;text-shadow:0 0 2px #13294b}
.stop{width:22px;height:22px;border-radius:50%;background:#f59e0b;color:#fff;font-size:11px;font-weight:700;
  display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.start{width:24px;height:24px;border-radius:50%;background:#16a34a;color:#fff;font-size:12px;font-weight:800;
  display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
.pop{color:#5f6b7d;font-size:12px}
.ctl{position:absolute;z-index:1000;top:10px;right:10px;display:flex;flex-direction:column;gap:6px}
.ctl button{min-width:44px;height:34px;border:0;border-radius:8px;background:#fff;color:#13294b;font-weight:700;font-size:12px;
  box-shadow:0 1px 5px rgba(0,0,0,.3)}
.legend{position:absolute;z-index:1000;left:8px;bottom:8px;background:rgba(255,255,255,.94);border-radius:8px;padding:5px 8px;
  font-size:11px;color:#0f1b2d;display:flex;gap:9px;box-shadow:0 1px 4px rgba(0,0,0,.2)}
.legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.leaflet-control-attribution{font-size:9px}
`

export function buildMapHtml(initial: MapData): string {
  // Official OpenStreetMap tiles — the free, keyless standard basemap.
  // MAP_KEY stays wired for a future upgrade to a keyed provider (e.g. CARTO): when set it
  // switches to CARTO's voyager tiles with the key appended.
  const streetUrl = MAP_KEY
    ? `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${MAP_KEY}`
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>${MAP_CSS}</style></head><body>
<div id="map"></div>
<div class="ctl"><button id="fit">Fit</button><button id="layer">Sat</button></div>
<div class="legend"><span><i style="background:#22c55e"></i>Live</span><span><i style="background:#f59e0b"></i>Stale</span><span><i style="background:#64748b"></i>Offline</span><span><i style="background:#16a34a"></i>Start</span></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>var STREET_URL=${scriptJson(streetUrl)};
${MAP_SCRIPT}
window.__ciisUpdate(${scriptJson(initial)});</script>
</body></html>`
}
