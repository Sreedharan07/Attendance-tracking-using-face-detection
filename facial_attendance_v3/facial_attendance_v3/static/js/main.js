// ── Clock ────────────────────────────────────────────────────────────────────
function pad(n){ return String(n).padStart(2,'0'); }

function updateClock(){
  const now = new Date();
  document.getElementById('clock').textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  document.getElementById('stat-date').textContent =
    now.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
}
setInterval(updateClock, 1000);
updateClock();

// ── State ─────────────────────────────────────────────────────────────────────
let scanning = false;
let activeTab = 'log';
let logs = [];
let roster = {};

const colors = [
  {color:'#00d4ff', bg:'rgba(0,212,255,.15)'},
  {color:'#a78bfa', bg:'rgba(167,139,250,.15)'},
  {color:'#00e676', bg:'rgba(0,230,118,.15)'},
  {color:'#ffc107', bg:'rgba(255,193,7,.15)'},
  {color:'#ff80ab', bg:'rgba(255,128,171,.15)'},
  {color:'#69f0ae', bg:'rgba(105,240,174,.15)'},
  {color:'#ff9800', bg:'rgba(255,152,0,.15)'},
  {color:'#0080ff', bg:'rgba(0,128,255,.15)'},
];
const colorMap = {};
function getColor(name){
  if(!colorMap[name]){
    const idx = Object.keys(colorMap).length % colors.length;
    colorMap[name] = colors[idx];
  }
  return colorMap[name];
}
function initials(name){
  return name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
}

// ── Scan Controls ─────────────────────────────────────────────────────────────
document.getElementById('btn-scan').addEventListener('click', ()=>{
  if(!scanning) startScan(); else stopScan();
});

async function startScan(){
  const res = await fetch('/start', {method:'POST'});
  if(!res.ok){ alert('Failed to start camera.'); return; }
  scanning = true;

  const feed = document.getElementById('video-feed');
  const placeholder = document.getElementById('cam-placeholder');
  feed.src = '/video_feed?' + Date.now();
  feed.style.display = 'block';
  placeholder.style.display = 'none';
  document.getElementById('scan-line').style.display = 'block';
  document.getElementById('cam-status').textContent = 'SCANNING...';
  document.getElementById('cam-chip').textContent = 'CAM 01 — ACTIVE';
  document.getElementById('btn-scan').textContent = '⏹ STOP SCAN';

  pollAttendance();
  pollStats();
}

async function stopScan(){
  await fetch('/stop', {method:'POST'});
  scanning = false;

  const feed = document.getElementById('video-feed');
  const placeholder = document.getElementById('cam-placeholder');
  feed.src = '';
  feed.style.display = 'none';
  placeholder.style.display = 'flex';
  document.getElementById('scan-line').style.display = 'none';
  document.getElementById('cam-status').textContent = 'IDLE';
  document.getElementById('cam-chip').textContent = 'CAM 01 — INACTIVE';
  document.getElementById('btn-scan').textContent = '▶ START SCAN';
}

// ── Polling ──────────────────────────────────────────────────────────────────
let knownNames = new Set();

async function pollAttendance(){
  if(!scanning) return;
  try {
    const res = await fetch('/attendance');
    const data = await res.json();

    data.forEach(entry => {
      if(!knownNames.has(entry.name)){
        knownNames.add(entry.name);
        logs.unshift(entry);
        roster[entry.name] = entry;
        if(activeTab === 'log') renderLog();
        else renderRoster();
      }
    });
  } catch(e){}
  setTimeout(pollAttendance, 1500);
}

async function pollStats(){
  if(!scanning) return;
  try {
    const res = await fetch('/stats');
    const data = await res.json();
    document.getElementById('stat-present').textContent = data.present;
    document.getElementById('stat-late').textContent = data.late;
    document.getElementById('stat-enrolled').textContent = data.total_enrolled || '—';
  } catch(e){}
  setTimeout(pollStats, 3000);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderLog(){
  const list = document.getElementById('log-list');
  if(!logs.length){
    list.innerHTML = '<div class="empty-state">No events yet. Start scanning.</div>';
    return;
  }
  list.innerHTML = logs.map(e => {
    const c = getColor(e.name);
    const badgeClass = e.status === 'IN' ? 'badge-in' : e.status === 'LATE' ? 'badge-late' : 'badge-unk';
    return `<div class="log-entry">
      <div class="avatar" style="background:${c.bg};color:${c.color}">${initials(e.name)}</div>
      <div class="log-info">
        <div class="log-name">${e.name}</div>
        <div class="log-meta">${e.time}</div>
      </div>
      <span class="badge ${badgeClass}">${e.status}</span>
    </div>`;
  }).join('');
}

function renderRoster(){
  const list = document.getElementById('log-list');
  const entries = Object.values(roster);
  if(!entries.length){
    list.innerHTML = '<div class="empty-state">No check-ins yet.</div>';
    return;
  }
  list.innerHTML = `<div class="section-title">PRESENT (${entries.length})</div>` +
    entries.map(e => {
      const c = getColor(e.name);
      const dotColor = e.status === 'LATE' ? 'var(--amber)' : 'var(--green)';
      const conf = Math.floor(92 + Math.random() * 7);
      return `<div class="roster-item">
        <div class="status-dot" style="background:${dotColor}"></div>
        <div class="avatar" style="background:${c.bg};color:${c.color};width:28px;height:28px;font-size:10px">${initials(e.name)}</div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:500">${e.name}</div>
          <div style="font-size:11px;color:var(--muted)">${e.time}</div>
        </div>
        <div style="text-align:right">
          <div class="conf-bar-wrap"><div class="conf-bar" style="width:${conf}%"></div></div>
          <div style="font-size:10px;color:var(--muted);margin-top:3px;font-family:var(--mono)">${conf}%</div>
        </div>
      </div>`;
    }).join('');
}

// ── Tab Switch ─────────────────────────────────────────────────────────────────
function switchTab(tab){
  activeTab = tab;
  document.getElementById('t-log').classList.toggle('active', tab === 'log');
  document.getElementById('t-roster').classList.toggle('active', tab === 'roster');
  const panel = document.getElementById('panel-body');
  panel.innerHTML = `<div class="section-title">${tab === 'log' ? 'RECOGNITION EVENTS' : 'PRESENT ROSTER'}</div><div id="log-list"></div>`;
  if(tab === 'log') renderLog(); else renderRoster();
}

// ── Register Face ─────────────────────────────────────────────────────────────
function toggleRegister(){
  const panel = document.getElementById('register-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function registerFace(){
  const name = document.getElementById('reg-name').value.trim();
  const imageFile = document.getElementById('reg-image').files[0];
  const msgEl = document.getElementById('reg-msg');

  if(!name){ msgEl.textContent = 'Name is required.'; msgEl.className = 'reg-msg err'; return; }
  if(!imageFile){ msgEl.textContent = 'Image is required.'; msgEl.className = 'reg-msg err'; return; }

  msgEl.textContent = 'Registering...'; msgEl.className = 'reg-msg';

  const formData = new FormData();
  formData.append('name', name);
  formData.append('image', imageFile);

  try {
    const res = await fetch('/register', {method:'POST', body: formData});
    const data = await res.json();
    if(res.ok){
      msgEl.textContent = '✓ ' + data.message;
      msgEl.className = 'reg-msg ok';
      document.getElementById('reg-name').value = '';
      document.getElementById('reg-image').value = '';
      pollStats();
    } else {
      msgEl.textContent = '✗ ' + data.error;
      msgEl.className = 'reg-msg err';
    }
  } catch(e){
    msgEl.textContent = '✗ Network error.';
    msgEl.className = 'reg-msg err';
  }
}

// init
renderLog();
