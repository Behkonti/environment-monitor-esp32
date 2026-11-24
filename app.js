// Environment Monitor - Supabase dashboard
const SUPABASE_URL = "https://unnvwlhgxeamjnwbgkgz.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_46jKJH30q8qzWUEYtivyiw_8aLgsGVk";
const TABLE = "sensor_readings";
const REFRESH_MS = 5000;
const OFFLINE_AFTER_MS = 30000;
let readings = [];
let chart = null;
let map = null;
let mapMarkers = null;
const lastMotionAlert = new Map();

const $ = (id) => document.getElementById(id);
const fmt = (value, digits=1) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
const timeLabel = (value) => value ? new Date(value).toLocaleString() : "—";

async function fetchReadings() {
  const endpoint = new URL(SUPABASE_URL + "/rest/v1/" + TABLE);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("order", "recorded_at.desc");
  endpoint.searchParams.set("limit", "300");
  const response = await fetch(endpoint, {headers:{apikey:SUPABASE_PUBLISHABLE_KEY}});
  if (!response.ok) throw new Error("Supabase " + response.status + ": " + await response.text());
  readings = await response.json();
  renderDashboard();
  $("connection-text").textContent = "Database connected";
  $("last-update").textContent = new Date().toLocaleTimeString();
}

function latestPerDevice(rows) {
  const byDevice = new Map();
  for (const row of rows) if (!byDevice.has(row.device_number)) byDevice.set(row.device_number,row);
  return [...byDevice.values()];
}
function ageSeconds(row) {
  const time = row?.recorded_at ? new Date(row.recorded_at).getTime() : 0;
  return time ? Math.max(0,Math.floor((Date.now()-time)/1000)) : Infinity;
}
function isOnline(row) { return ageSeconds(row) <= OFFLINE_AFTER_MS/1000; }

function renderAlerts(latest) {
  const offline = latest.filter(r=>!isOnline(r));
  const moving = latest.filter(r=>isOnline(r)&&r.motion===true);
  const parts = [];
  if (offline.length) parts.push('<div class="alert-banner alert-offline"><span class="alert-symbol">⚠</span><div><strong>Устройство не отвечает</strong><span>'+offline.map(r=>escapeHtml(r.device_number)).join(", ")+': данные не поступали более 30 секунд. Проверьте питание и Wi-Fi.</span></div></div>');
  if (moving.length) parts.push('<div class="alert-banner alert-motion"><span class="alert-symbol">💡</span><div><strong>Обнаружено движение</strong><span>Движение зафиксировано устройством: '+moving.map(r=>escapeHtml(r.device_number)).join(", ")+'.</span></div></div>');
  if (!parts.length && latest.length) parts.push('<div class="alert-banner alert-ok"><span class="alert-symbol">✓</span><div><strong>Все устройства на связи</strong><span>Новых тревожных событий нет.</span></div></div>');
  $("alerts").innerHTML = parts.join("");
  for (const row of moving) {
    const marker = String(row.id ?? row.recorded_at);
    if (lastMotionAlert.get(row.device_number)!==marker) {
      lastMotionAlert.set(row.device_number,marker);
      showToast("💡 Движение обнаружено: "+row.device_number);
    }
  }
}

function renderDashboard() {
  const latest = latestPerDevice(readings);
  const filter = $("device-filter");
  const oldValue = filter.value;
  filter.innerHTML = ['<option value="all">All devices</option>',...latest.map(r=>'<option value="'+escapeHtml(r.device_number)+'">'+escapeHtml(r.device_number)+'</option>')].join("");
  filter.value = latest.some(r=>r.device_number===oldValue)?oldValue:"all";
  const current = filter.value==="all" ? latest[0] : latest.find(r=>r.device_number===filter.value);
  const online = current && isOnline(current);
  $("temperature-value").innerHTML = (current&&current.temperature!=null?fmt(current.temperature):"—")+"<small>°C</small>";
  $("humidity-value").innerHTML = (current&&current.humidity!=null?fmt(current.humidity):"—")+"<small>%</small>";
  $("motion-value").textContent = current&&current.motion!=null?(current.motion?"Detected":"Clear"):"—";
  $("light-value").textContent = current&&current.light_adc!=null?current.light_adc:"—";
  $("temperature-note").textContent = !current?"Waiting for data":!online?"Device offline":"Latest sensor reading";
  $("humidity-note").textContent = !current?"Waiting for data":!online?"Device offline":"Latest sensor reading";
  $("motion-note").textContent = !current?"Waiting for data":!online?"Device offline":current.motion?"Movement detected":"No movement";
  $("light-note").textContent = "Raw ADC value · 0–4095";

  const lamp=$("motion-lamp");
  const lampOn=!!(current&&online&&current.motion===true);
  lamp.classList.toggle("is-on",lampOn);
  $("lamp-label").textContent=lampOn?"LAMP ON · MOTION":"LAMP OFF";
  lamp.setAttribute("aria-label",lampOn?"Motion detected, lamp on":"No motion, lamp off");
  document.querySelector(".metric-card.motion").classList.toggle("motion-active",lampOn);

  $("device-count").textContent=latest.length;
  $("network-summary").textContent=latest.filter(isOnline).length+" online · "+latest.filter(r=>!isOnline(r)).length+" offline";
  $("device-list").innerHTML=latest.length?latest.map(r=>{
    const active=isOnline(r);
    return '<div class="device-row"><div><div class="device-name">'+escapeHtml(r.device_number)+'</div><div class="device-time">Last seen · '+escapeHtml(timeLabel(r.recorded_at))+' · '+(active?"just now":ageSeconds(r)+" sec ago")+'</div></div><span class="device-state '+(active?"online":"offline")+'">'+(active?"● ONLINE":"⚠ OFFLINE")+'</span></div>';
  }).join(""):'<div class="empty-state">No devices have sent data yet.</div>';
  $("readings-body").innerHTML=readings.length?readings.slice(0,12).map(r=>'<tr><td class="device-code">'+escapeHtml(r.device_number)+'</td><td>'+fmt(r.temperature)+' °C</td><td>'+fmt(r.humidity)+' %</td><td class="'+(r.motion?"motion-on":"motion-off")+'">'+(r.motion==null?"—":r.motion?"Detected":"Clear")+'</td><td>'+(r.light_adc??"—")+'</td><td>'+escapeHtml(timeLabel(r.recorded_at))+'</td></tr>').join(""):'<tr><td colspan="6" class="empty-cell">No readings yet</td></tr>';
  renderAlerts(latest);
  renderChart();
  renderMap(latest);
}
function renderChart() {
  const selected=$("device-filter").value;
  const rows=[...readings].reverse().filter(r=>selected==="all"||r.device_number===selected).slice(-50);
  const labels=rows.map(r=>new Date(r.recorded_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  const data={labels,datasets:[
    {label:"Temperature °C",data:rows.map(r=>r.temperature),borderColor:"#ffbd79",backgroundColor:"#ffbd7918",tension:.35,pointRadius:2,borderWidth:2,spanGaps:true},
    {label:"Humidity %",data:rows.map(r=>r.humidity),borderColor:"#71c9ff",backgroundColor:"#71c9ff18",tension:.35,pointRadius:2,borderWidth:2,spanGaps:true}
  ]};
  if(chart){chart.data=data;chart.update();return;}
  chart=new Chart($("history-chart"),{type:"line",data,options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{display:false},tooltip:{backgroundColor:"#17243a",borderColor:"#30415d",borderWidth:1,titleColor:"#fff",bodyColor:"#cbd7e9"}},scales:{x:{grid:{color:"#202c40"},ticks:{color:"#71809a",maxTicksLimit:7,font:{size:9}}},y:{grid:{color:"#202c40"},ticks:{color:"#71809a",font:{size:9}}}}}});
}
function renderMap(latest) {
  const points=latest.filter(r=>Number.isFinite(Number(r.latitude))&&Number.isFinite(Number(r.longitude))&&r.latitude!==null&&r.longitude!==null);
  const container=$("device-map");
  if(!points.length){if(map){map.remove();map=null;mapMarkers=null;}container.innerHTML='<div class="map-placeholder">Map will appear when devices send coordinates.</div>';return;}
  if(!map){container.innerHTML="";map=L.map(container,{scrollWheelZoom:false}).setView([Number(points[0].latitude),Number(points[0].longitude)],11);L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);mapMarkers=L.layerGroup().addTo(map);}
  mapMarkers.clearLayers();const bounds=[];
  for(const p of points){const coords=[Number(p.latitude),Number(p.longitude)];bounds.push(coords);L.marker(coords).bindPopup("<b>"+escapeHtml(p.device_number)+"</b><br>Temperature: "+fmt(p.temperature)+" °C<br>Humidity: "+fmt(p.humidity)+" %").addTo(mapMarkers);}
  if(bounds.length===1)map.setView(bounds[0],13);else map.fitBounds(bounds,{padding:[30,30],maxZoom:13});
  setTimeout(()=>map.invalidateSize(),100);
}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
let toastTimer=null;
function showToast(message){const toast=$("toast");toast.textContent=message;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),4500);}
async function refresh(){
  try{await fetchReadings();}
  catch(error){console.error(error);$("connection-text").textContent="Database connection error";$("last-update").textContent="Error";showToast("Could not load Supabase data. Check connection and table policies.");}
}
$("refresh-btn").addEventListener("click",refresh);
$("device-filter").addEventListener("change",renderDashboard);
refresh();
setInterval(refresh,REFRESH_MS);
// Update online/offline state continuously, even between database polls.
setInterval(()=>{if(readings.length)renderDashboard();},1000);
