// Environment Monitor - Supabase client (public browser key)
const SUPABASE_URL = "https://unnvwlhgxeamjnwbgkgz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_46jKJH30q8qzWUEYtivyiw_8aLgsGVk";
const TABLE = "sensor_readings";
const REFRESH_MS = 15000;
let readings = [];
let chart = null;
let map = null;
let mapMarkers = null;

const $ = (id) => document.getElementById(id);
const fmt = (value, digits=1) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
const timeLabel = (value) => value ? new Date(value).toLocaleString() : "—";

async function fetchReadings() {
  const endpoint = new URL(SUPABASE_URL + "/rest/v1/" + TABLE);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("order", "recorded_at.desc");
  endpoint.searchParams.set("limit", "300");
  const response = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: "Bearer " + SUPABASE_PUBLISHABLE_KEY
    }
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error("Supabase " + response.status + ": " + details);
  }
  readings = await response.json();
  renderDashboard();
  $("connection-text").textContent = "Database connected";
  $("last-update").textContent = new Date().toLocaleTimeString();
}

function latestPerDevice(rows) {
  const map = new Map();
  for (const row of rows) if (!map.has(row.device_number)) map.set(row.device_number, row);
  return [...map.values()];
}

function renderDashboard() {
  const latest = latestPerDevice(readings);
  const selectedDevice = $("device-filter").value;
  const current = selectedDevice === "all" ? readings[0] : readings.find(r => r.device_number === selectedDevice);
  $("temperature-value").innerHTML = (current && current.temperature != null ? fmt(current.temperature) : "—") + "<small>°C</small>";
  $("humidity-value").innerHTML = (current && current.humidity != null ? fmt(current.humidity) : "—") + "<small>%</small>";
  $("motion-value").textContent = current && current.motion != null ? (current.motion ? "Detected" : "Clear") : "—";
  $("light-value").textContent = current && current.light_adc != null ? current.light_adc : "—";
  $("temperature-note").textContent = current ? "Latest sensor reading" : "Waiting for data";
  $("humidity-note").textContent = current ? "Latest sensor reading" : "Waiting for data";
  $("motion-note").textContent = current && current.motion != null ? (current.motion ? "Movement detected" : "No movement") : "Waiting for data";
  $("light-note").textContent = "Raw ADC value · 0–4095";
  $("device-count").textContent = latest.length;
  $("network-summary").textContent = latest.length + (latest.length === 1 ? " device reporting" : " devices reporting");

  const filter = $("device-filter");
  const oldValue = filter.value;
  const options = ['<option value="all">All devices</option>', ...latest.map(r => '<option value="' + escapeHtml(r.device_number) + '">' + escapeHtml(r.device_number) + '</option>')];
  filter.innerHTML = options.join("");
  filter.value = latest.some(r => r.device_number === oldValue) ? oldValue : "all";

  $("device-list").innerHTML = latest.length ? latest.map(r => '<div class="device-row"><div><div class="device-name">' + escapeHtml(r.device_number) + '</div><div class="device-time">Last seen · ' + escapeHtml(timeLabel(r.recorded_at)) + '</div></div><span class="device-state">● RECEIVED</span></div>').join("") : '<div class="empty-state">No devices have sent data yet.</div>';
  $("readings-body").innerHTML = readings.length ? readings.slice(0,12).map(r => '<tr><td class="device-code">' + escapeHtml(r.device_number) + '</td><td>' + fmt(r.temperature) + ' °C</td><td>' + fmt(r.humidity) + ' %</td><td class="' + (r.motion ? "motion-on" : "motion-off") + '">' + (r.motion == null ? "—" : r.motion ? "Detected" : "Clear") + '</td><td>' + (r.light_adc ?? "—") + '</td><td>' + escapeHtml(timeLabel(r.recorded_at)) + '</td></tr>').join("") : '<tr><td colspan="6" class="empty-cell">No readings yet</td></tr>';
  renderChart();
  renderMap(latest);
}

function renderChart() {
  const selected = $("device-filter").value;
  const rows = [...readings].reverse().filter(r => selected === "all" || r.device_number === selected).slice(-50);
  const labels = rows.map(r => new Date(r.recorded_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}));
  const data = {
    labels,
    datasets: [
      {label:"Temperature °C",data:rows.map(r=>r.temperature),borderColor:"#ffbd79",backgroundColor:"#ffbd7918",tension:.35,pointRadius:2,borderWidth:2,spanGaps:true},
      {label:"Humidity %",data:rows.map(r=>r.humidity),borderColor:"#71c9ff",backgroundColor:"#71c9ff18",tension:.35,pointRadius:2,borderWidth:2,spanGaps:true}
    ]
  };
  if (chart) { chart.data = data; chart.update(); return; }
  chart = new Chart($("history-chart"), {type:"line",data,options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:"#17243a",borderColor:"#30415d",borderWidth:1,titleColor:"#fff",bodyColor:"#cbd7e9"}},scales:{x:{grid:{color:"#202c40"},ticks:{color:"#71809a",maxTicksLimit:7,font:{size:9}}},y:{grid:{color:"#202c40"},ticks:{color:"#71809a",font:{size:9}}}}}});
}

function renderMap(latest) {
  const points = latest.filter(r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)) && r.latitude !== null && r.longitude !== null);
  const container = $("device-map");
  if (!points.length) { if (map) { map.remove(); map = null; mapMarkers = null; } container.innerHTML = '<div class="map-placeholder">Map will appear when devices send coordinates.</div>'; return; }
  if (!map) {
    container.innerHTML = "";
    map = L.map(container, {scrollWheelZoom:false}).setView([Number(points[0].latitude),Number(points[0].longitude)], 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);
    mapMarkers = L.layerGroup().addTo(map);
  }
  mapMarkers.clearLayers();
  const bounds = [];
  for (const p of points) {
    const coords = [Number(p.latitude),Number(p.longitude)];
    bounds.push(coords);
    L.marker(coords).bindPopup("<b>"+escapeHtml(p.device_number)+"</b><br>Temperature: "+fmt(p.temperature)+" °C<br>Humidity: "+fmt(p.humidity)+" %").addTo(mapMarkers);
  }
  if (bounds.length === 1) map.setView(bounds[0], 13); else map.fitBounds(bounds,{padding:[30,30],maxZoom:13});
  setTimeout(()=>map.invalidateSize(),100);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

async function refresh() {
  try { await fetchReadings(); }
  catch (error) {
    console.error(error);
    $("connection-text").textContent = "Database connection error";
    $("last-update").textContent = "Error";
    const toast = $("toast");
    toast.textContent = "Could not load Supabase data. Check connection and table policies.";
    toast.classList.add("show");
    setTimeout(()=>toast.classList.remove("show"),4000);
  }
}

$("refresh-btn").addEventListener("click", refresh);
$("device-filter").addEventListener("change", renderDashboard);
refresh();
setInterval(refresh, REFRESH_MS);