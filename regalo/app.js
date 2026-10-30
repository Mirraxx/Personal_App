'use strict';

/* ================= configuración ================= */
/* Mismo proyecto de Firebase que la app de finanzas. Los valores son públicos por diseño: la seguridad la dan
   las reglas de Firestore (firestore.rules) y, sobre todo, el cifrado del contenido con la contraseña del regalo. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyD1d9LRDe_-WTgu4Swbs152auer33gmSC4",
  authDomain: "personal-app-cf4fe.firebaseapp.com",
  projectId: "personal-app-cf4fe",
  storageBucket: "personal-app-cf4fe.firebasestorage.app",
  messagingSenderId: "795055974870",
  appId: "1:795055974870:web:d16dca1e401866825e1c77"
};
const FB_VER = '10.12.2';
const ADMIN_EMAIL = 'israllaire@gmail.com';   // debe coincidir con firestore.rules
const KDF_ITER = 300000;                      // vueltas de PBKDF2: frenan a quien intente adivinar la contraseña
const MAX_PHOTOS = 40;
const PHOTO_MAX_PX = 1400;
const PHOTO_MAX_BYTES = 420 * 1024;           // cada foto va en su propio documento (límite de Firestore: 1 MB)
const REMEMBER_KEY = 'regalo.recordar';
const DEMO = new URLSearchParams(location.search).has('demo');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const THEMES = [
  { id: 'jardin', name: 'Jardín', swatch: 'linear-gradient(120deg,#F9DDE2,#CFE6F5 52%,#C4D9C2)', meta: '#FFF3EE' },
  { id: 'atardecer', name: 'Atardecer', swatch: 'linear-gradient(120deg,#2C0B1B,#7D2A47 55%,#EBA5B5)', meta: '#2C0B1B' },
  { id: 'cielo', name: 'Cielo', swatch: 'linear-gradient(120deg,#CFE6F5,#F2F8FC 50%,#F9DDE2)', meta: '#F2F8FC' }
];

/* ================= utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = {
  enc(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); },
  dec(str) { const s = atob(str); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
};
const loadScript = src => new Promise((ok, fail) => {
  const el = document.createElement('script');
  el.src = src; el.onload = ok; el.onerror = () => fail(new Error('No se pudo cargar ' + src));
  document.head.appendChild(el);
});
let toastT;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3600);
}
/* La contraseña no distingue mayúsculas, tildes ni espacios de más: en el teléfono es muy fácil equivocarse con eso. */
const normPw = p => String(p).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const setPath = (obj, path, val) => {
  const keys = path.split('.'); const last = keys.pop();
  const t = keys.reduce((o, k) => o[k], obj); t[last] = val;
};

/* ----- fechas ----- */
const parseDate = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const fmtDate = s => parseDate(s).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' });
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const defaultStart = () => { const n = new Date(); const y = n >= new Date(n.getFullYear(), 0, 6) ? n.getFullYear() : n.getFullYear() - 1; return `${y}-01-06`; };
function addMonths(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes(), d.getSeconds());
  r.setDate(Math.min(d.getDate(), new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()));
  return r;
}
function elapsed(start, now) {
  if (now < start) return { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0, months: 0, days: 0, future: true };
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (addMonths(start, months) > now) months--;
  const s = Math.floor((now - addMonths(start, months)) / 1000);
  const utc = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return {
    y: Math.floor(months / 12), mo: months % 12, d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), mi: Math.floor(s % 3600 / 60), s: s % 60,
    months, days: Math.round((utc(now) - utc(start)) / 864e5)
  };
}
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const spanLabel = m => (m % 12 === 0 ? plural(m / 12, 'año', 'años') : plural(m, 'mes', 'meses'));

/* ================= cifrado (todo ocurre en el navegador) =================
   contraseña --PBKDF2--> llave KEK --desenvuelve--> llave del contenido (CK) --AES-GCM--> carta y fotos.
   Cambiar la contraseña solo vuelve a envolver la CK, así que las fotos no se re-cifran. */
const Crypto = {
  async kek(password, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  },
  newKey: () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']),
  async seal(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
    return { iv: b64.enc(iv), ct: b64.enc(ct) };
  },
  async open(key, o) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(o.iv) }, key, b64.dec(o.ct))); },
  async wrap(kek, ck) { return this.seal(kek, new Uint8Array(await crypto.subtle.exportKey('raw', ck))); },
  async unwrap(kek, o) { return crypto.subtle.importKey('raw', await this.open(kek, o), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']); }
};

/* ================= almacenamiento ================= */
/* Firebase (producción). Colecciones: gift/config, giftPhotos/{id}, giftVisits/{id}. */
const fbBackend = {
  db: null, auth: null, user: null, loading: null, listeners: [],
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const base = `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-`;
        await loadScript(base + 'app-compat.js');
        await Promise.all([loadScript(base + 'auth-compat.js'), loadScript(base + 'firestore-compat.js')]);
        firebase.initializeApp(FIREBASE_CONFIG);
        this.auth = firebase.auth(); this.db = firebase.firestore();
        this.auth.onAuthStateChanged(u => { this.user = u; this.listeners.forEach(f => f()); });
      })().catch(e => { this.loading = null; throw e; });
    }
    return this.loading;
  },
  isAdmin() { return !!this.user && this.user.emailVerified === true && String(this.user.email || '').toLowerCase() === ADMIN_EMAIL; },
  onAuth(f) { this.listeners.push(f); },
  async signIn() {
    await this.load();
    await this.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    if (!this.isAdmin()) { await this.auth.signOut(); const e = new Error('no-admin'); e.code = 'app/not-admin'; throw e; }
  },
  async signOut() { await this.load(); await this.auth.signOut(); },
  async getConfig() { await this.load(); const s = await this.db.collection('gift').doc('config').get(); return s.exists ? s.data() : null; },
  async setConfig(o) { await this.db.collection('gift').doc('config').set(o); },
  async getPhoto(id) { const s = await this.db.collection('giftPhotos').doc(id).get(); return s.exists ? s.data() : null; },
  async setPhoto(id, o) { await this.db.collection('giftPhotos').doc(id).set(o); },
  async delPhoto(id) { await this.db.collection('giftPhotos').doc(id).delete(); },
  async addVisit() { await this.db.collection('giftVisits').add({ t: Date.now() }); },
  async visits() { const s = await this.db.collection('giftVisits').orderBy('t', 'desc').limit(30).get(); return s.docs.map(d => d.data().t); },
  async clearAll() {
    const batch = this.db.batch();
    (await this.db.collection('giftPhotos').get()).forEach(d => batch.delete(d.ref));
    (await this.db.collection('giftVisits').get()).forEach(d => batch.delete(d.ref));
    batch.delete(this.db.collection('gift').doc('config'));
    await batch.commit();
  }
};

/* Modo prueba (?demo): todo queda en este navegador, sin Firebase. Sirve para ensayar el diseño y el editor. */
const demoBackend = {
  KEY: 'regalo.demo', db: null, admin: false, listeners: [],
  open() {
    if (this.db) return;
    try { this.db = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) { /* sin almacenamiento */ }
    this.db = this.db || { config: null, photos: {}, visits: [] };
  },
  persist() { try { localStorage.setItem(this.KEY, JSON.stringify(this.db)); } catch (e) { /* demasiado grande: queda en memoria */ } },
  isAdmin() { return this.admin; },
  onAuth(f) { this.listeners.push(f); },
  async signIn() { this.admin = true; this.listeners.forEach(f => f()); },
  async signOut() { this.admin = false; this.listeners.forEach(f => f()); },
  async getConfig() { this.open(); return this.db.config; },
  async setConfig(o) { this.open(); this.db.config = o; this.persist(); },
  async getPhoto(id) { this.open(); return this.db.photos[id] || null; },
  async setPhoto(id, o) { this.open(); this.db.photos[id] = o; this.persist(); },
  async delPhoto(id) { this.open(); delete this.db.photos[id]; this.persist(); },
  async addVisit() { this.open(); this.db.visits.push(Date.now()); this.persist(); },
  async visits() { this.open(); return [...this.db.visits].reverse().slice(0, 30); },
  async clearAll() { this.db = { config: null, photos: {}, visits: [] }; this.persist(); }
};
const backend = DEMO ? demoBackend : fbBackend;

/* ================= estado ================= */
const S = {
  cfg: null,            // documento gift/config (cifrado)
  ck: null,             // llave del contenido, solo en memoria
  content: null,        // contenido ya descifrado
  media: new Map(),     // id -> { bytes, url, dirty }
  removed: new Set(),   // fotos a borrar de la base al guardar
  admin: false, unlocked: false, dirty: false, saving: false, tab: 'general', fails: 0
};

function defaultContent(o = {}) {
  const start = o.start || defaultStart();
  return {
    v: 1, to: o.to || '', from: o.from || '', start, theme: 'jardin', petals: true,
    letter: {
      greet: o.to ? `${o.to},` : 'Mi amor,',
      body: 'Hay días que quisiera guardar en un cajón para abrirlos cuando el mundo se ponga gris. Los días contigo son casi todos ellos.\n\nHice esta página para tener, en un solo lugar, un poquito de lo mucho que siento: nuestras fotos, nuestra música y las cosas que a veces me cuesta decir en voz alta.\n\nGracias por ser mi calma, mi risa y mi lugar favorito.',
      sign: 'Con todo mi cariño,'
    },
    photos: [],
    timeline: [{ date: start, emoji: '💌', title: 'Donde empezó todo', text: 'El día en que nuestra historia comenzó.' }],
    reasons: ['Cómo te ríes cuando algo te da mucha gracia', 'La forma en que me cuidas sin que te lo pida', 'Lo bien que me siento cuando estoy contigo', 'Tus abrazos largos', 'Que contigo todo se siente como en casa'],
    music: { url: '', title: 'Nuestra banda sonora', note: 'Las canciones que suenan a nosotros.' },
    finale: { text: 'Gracias por ser mi lugar favorito.\nTe quiero hoy y todos los días.', btn: 'Te quiero' }
  };
}
function normalizeContent(c) {
  const d = defaultContent({ start: c.start });
  return {
    ...d, ...c,
    letter: { ...d.letter, ...c.letter }, music: { ...d.music, ...c.music }, finale: { ...d.finale, ...c.finale },
    photos: Array.isArray(c.photos) ? c.photos : [], timeline: Array.isArray(c.timeline) ? c.timeline : [], reasons: Array.isArray(c.reasons) ? c.reasons : []
  };
}

/* ================= ambiente: pétalos y corazones ================= */
const ambient = {
  c: $('#ambient'), ctx: null, parts: [], pops: [], colors: ['#EBA5B5'], on: !REDUCED, run: false, last: 0, dpr: 1, W: 0, H: 0,
  init() {
    this.ctx = this.c.getContext('2d');
    this.resize(); this.setColors();
    addEventListener('resize', () => { this.resize(); this.fill(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.kick(); });
    this.fill(); this.kick();
  },
  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2); this.W = innerWidth; this.H = innerHeight;
    this.c.width = this.W * this.dpr; this.c.height = this.H * this.dpr; this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },
  setColors() {
    const cs = getComputedStyle(document.body); const g = n => cs.getPropertyValue(n).trim();
    this.colors = [g('--rose'), g('--blush'), g('--sky-deep'), g('--sage-deep'), g('--rose-deep')].filter(Boolean);
  },
  setOn(v) { this.on = v && !REDUCED; if (this.on) { this.fill(); this.kick(); } },
  make(initial) {
    return { x: Math.random() * this.W, y: initial ? Math.random() * this.H : -20, s: 6 + Math.random() * 9, vy: 16 + Math.random() * 26, sw: .5 + Math.random() * 1.2, ph: Math.random() * 6.28,
      rot: Math.random() * 6.28, vr: (Math.random() - .5) * 1.2, a: .35 + Math.random() * .4, heart: Math.random() < .22, ci: Math.random() };
  },
  fill() { const n = this.W < 640 ? 14 : 24; while (this.parts.length < n) this.parts.push(this.make(true)); this.parts.length = n; },
  burst(x, y) {
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 2.6, v = 130 + Math.random() * 230;
      this.pops.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: 8 + Math.random() * 10, t: 0, max: 1.1 + Math.random() * .9, ci: Math.random(), rot: Math.random() * 6 });
    }
    this.kick();
  },
  kick() {
    if (this.run || document.hidden) return;
    if (!this.on && !this.pops.length) { this.ctx.clearRect(0, 0, this.W, this.H); return; }
    this.run = true; this.last = performance.now(); requestAnimationFrame(t => this.frame(t));
  },
  shape(p, color, alpha) {
    const c = this.ctx; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.globalAlpha = alpha; c.fillStyle = color; c.beginPath();
    const s = p.s;
    if (p.heart) { c.moveTo(0, s * .9); c.bezierCurveTo(-s * 1.3, s * .1, -s * .8, -s * 1, 0, -s * .35); c.bezierCurveTo(s * .8, -s * 1, s * 1.3, s * .1, 0, s * .9); }
    else { c.moveTo(0, -s); c.bezierCurveTo(s * .8, -s * .6, s * .6, s * .6, 0, s); c.bezierCurveTo(-s * .6, s * .6, -s * .8, -s * .6, 0, -s); }
    c.fill(); c.restore();
  },
  frame(t) {
    const dt = Math.min(.05, (t - this.last) / 1000); this.last = t;
    const c = this.ctx; c.clearRect(0, 0, this.W, this.H);
    if (this.on) {
      for (const p of this.parts) {
        p.y += p.vy * dt; p.ph += dt * p.sw; p.x += Math.sin(p.ph) * 22 * dt; p.rot += p.vr * dt;
        if (p.y > this.H + 20) Object.assign(p, this.make(false));
        this.shape(p, this.colors[Math.floor(p.ci * this.colors.length)], p.a);
      }
    }
    this.pops = this.pops.filter(p => (p.t += dt) < p.max);
    for (const p of this.pops) {
      p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += dt * 2; p.heart = true;
      this.shape(p, this.colors[Math.floor(p.ci * this.colors.length)], Math.max(0, 1 - p.t / p.max));
    }
    if (document.hidden || (!this.on && !this.pops.length)) { this.run = false; if (!this.pops.length) c.clearRect(0, 0, this.W, this.H); return; }
    requestAnimationFrame(t2 => this.frame(t2));
  }
};

/* ================= tema ================= */
function applyTheme() {
  const t = THEMES.find(x => x.id === S.content?.theme) || THEMES[0];
  document.body.dataset.theme = t.id;
  $('meta[name="theme-color"]').content = t.meta;
  ambient.setColors();
  ambient.setOn(S.content ? S.content.petals !== false : true);
}

/* ================= puerta: contraseña ================= */
const gateState = html => { const el = $('#gate-state'); el.innerHTML = html; el.hidden = !html; };

function creatorLine() {
  const el = $('.creator-line');
  if (!S.admin) { el.innerHTML = '<button class="linkish" type="button" data-act="signin">Modo creador</button>'; return; }
  el.innerHTML = '<span class="muted small">Sesión de creador ✓</span> ' +
    '<button class="linkish" type="button" data-act="signout">Salir</button>' +
    (S.cfg && !S.unlocked ? ' <button class="linkish" type="button" data-act="reset">Olvidé la contraseña</button>' : '');
}

function showLocked() {
  S.empty = false; gateState('');
  $('#hint-text').textContent = S.cfg.hint;
  const h2 = $('#hint2-text'); h2.hidden = true; h2.textContent = S.cfg.hint2 || '';
  $('#gate-form').hidden = false;
}
function showEmpty() {
  S.empty = true; $('#gate-form').hidden = true;
  gateState(S.admin
    ? '<b>Todavía no hay carta</b>Prepárala: eliges la contraseña, la pista y la fecha.<br><button class="btn" type="button" data-act="setup">Preparar la carta</button>'
    : '<b>Esta carta se está escribiendo</b>Vuelve en un ratito. Alguien está preparando algo para ti.');
}
function showGateError(e) {
  console.error(e);
  const denied = e && e.code === 'permission-denied';
  $('#gate-form').hidden = true;
  gateState(`<b>No se pudo abrir el sobre</b>${denied ? 'Falta publicar las reglas de la base de datos.' : 'Revisa tu conexión e inténtalo de nuevo.'}<br><button class="btn" type="button" data-act="retry">Reintentar</button>`);
}

async function unlockWith(pw) {
  const cfg = S.cfg;
  const kek = await Crypto.kek(normPw(pw), b64.dec(cfg.salt), cfg.iter);
  const ck = await Crypto.unwrap(kek, { iv: cfg.wiv, ct: cfg.wct });
  return { ck, content: JSON.parse(dec.decode(await Crypto.open(ck, { iv: cfg.iv, ct: cfg.ct }))) };
}

$('#gate-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#pw').value; if (!pw) return;
  const btn = $('#gate-go'); btn.disabled = true; btn.textContent = 'Abriendo…'; $('#gate-msg').textContent = '';
  try {
    const r = await unlockWith(pw);
    S.ck = r.ck; S.content = normalizeContent(r.content);
    if ($('#remember').checked) rememberDevice();
    ambient.burst(innerWidth / 2, innerHeight * .55);
    await enterPage();
  } catch (err) {
    S.fails++;
    $('#gate-msg').textContent = 'Esa no es la contraseña. Prueba otra vez 💌';
    const card = $('#gate-form'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    if (S.fails >= 3 && S.cfg.hint2) $('#hint2-text').hidden = false;
    $('#pw').select();
  } finally { btn.disabled = false; btn.textContent = 'Abrir'; }
});

async function rememberDevice() {
  try {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', S.ck));
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ salt: S.cfg.salt, ck: b64.enc(raw) }));
  } catch (e) { /* sin almacenamiento */ }
}
async function tryRemembered() {
  try {
    const r = JSON.parse(localStorage.getItem(REMEMBER_KEY));
    if (!r || r.salt !== S.cfg.salt) { localStorage.removeItem(REMEMBER_KEY); return false; }
    const ck = await crypto.subtle.importKey('raw', b64.dec(r.ck), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    S.content = normalizeContent(JSON.parse(dec.decode(await Crypto.open(ck, { iv: S.cfg.iv, ct: S.cfg.ct }))));
    S.ck = ck; return true;
  } catch (e) { try { localStorage.removeItem(REMEMBER_KEY); } catch (e2) { /* nada */ } return false; }
}

/* ================= preparar la carta (primera vez) ================= */
function openSetup() {
  $('#gate').hidden = true; $('#setup').hidden = false;
  const f = $('#setup-form'); f.start.value = defaultStart();
}
$('#setup-show').addEventListener('change', e => { $('#setup-form').pw.type = e.target.checked ? 'text' : 'password'; });
$('#setup-cancel').addEventListener('click', () => { $('#setup').hidden = true; $('#gate').hidden = false; });
$('#setup-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; const msg = $('#setup-msg'); msg.textContent = '';
  const v = n => f[n].value.trim();
  if (normPw(f.pw.value).length < 6) { msg.textContent = 'La contraseña necesita al menos 6 caracteres.'; return; }
  const btn = $('#setup-go'); btn.disabled = true; btn.textContent = 'Creando…';
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const kek = await Crypto.kek(normPw(f.pw.value), salt, KDF_ITER);
    S.ck = await Crypto.newKey();
    const w = await Crypto.wrap(kek, S.ck);
    S.content = defaultContent({ to: v('to'), from: v('from'), start: f.start.value });
    S.cfg = { v: 1, salt: b64.enc(salt), iter: KDF_ITER, hint: v('hint'), hint2: v('hint2'), wiv: w.iv, wct: w.ct };
    await writeConfig();
    $('#setup').hidden = true; $('#gate').hidden = false;
    await enterPage({ animate: false });
    ED.open('carta');
    toast('Carta creada. Ahora personalízala.');
  } catch (err) {
    console.error(err); S.cfg = null; S.ck = null; S.content = null;
    msg.textContent = friendly(err);
  } finally { btn.disabled = false; btn.textContent = 'Crear la carta'; }
});

/* ================= entrar a la carta ================= */
async function enterPage({ animate = true } = {}) {
  S.unlocked = true;
  renderAll();
  if (animate && !REDUCED) { $('#envelope').classList.add('open'); await sleep(1600); }
  $('#page').hidden = false;
  window.scrollTo(0, 0);
  const gate = $('#gate'); gate.classList.add('leaving');
  setTimeout(() => { gate.hidden = true; }, 1000);
  reveal(); startTicker(); syncAdminUI(); loadPhotos();
  setTimeout(() => { if (!backend.isAdmin()) backend.addVisit().catch(() => { }); }, 2500);
}

/* ================= secciones ================= */
const emptyNote = (msg, tab) => `<div class="empty-note">${msg}<br><button class="btn small" type="button" data-open-tab="${tab}">Agregar</button></div>`;

function renderAll() {
  applyTheme(); renderLetter(false); renderCounter(); renderGallery(); renderTimeline(); renderReasons(); renderMusic(); renderFinale();
}

/* --- carta --- */
function renderLetter(instant) {
  const c = S.content, L = c.letter;
  $('#l-to').textContent = L.greet;
  const paras = String(L.body).split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const total = paras.join(' ').split(/\s+/).filter(Boolean).length || 1;
  let i = 0;
  const body = $('#l-body');
  body.style.setProperty('--d', Math.max(18, Math.min(70, 6500 / total)) + 'ms');
  body.classList.toggle('static', !!instant);
  body.innerHTML = paras.map(p => '<p>' + p.split('\n').map(line => line.split(/\s+/).filter(Boolean).map(w => `<span class="w" style="--i:${i++}">${esc(w)}</span>`).join(' ')).join('<br>') + '</p>').join('');
  $('#l-sign').innerHTML = esc(L.sign) + (c.from ? '<br>' + esc(c.from) : '');
}
/* tocar la carta mientras escribe: se muestra completa */
$('#paper').addEventListener('click', () => $('#l-body').classList.add('static'));

/* --- contador --- */
const ticker = { id: 0, sig: '' };
function renderCounter() {
  $('#c-title').textContent = 'Nuestro tiempo juntos';
  ticker.sig = ''; tickCounter();
}
function startTicker() { clearInterval(ticker.id); tickCounter(); ticker.id = setInterval(tickCounter, 1000); }
function tickCounter() {
  const c = S.content; if (!c) return;
  const start = parseDate(c.start); if (isNaN(start)) return;
  const now = new Date(), e = elapsed(start, now);
  const defs = [];
  if (e.y > 0) defs.push(['y', e.y, 'año', 'años']);
  if (e.y > 0 || e.mo > 0) defs.push(['mo', e.mo, 'mes', 'meses']);
  defs.push(['d', e.d, 'día', 'días'], ['h', e.h, 'hora', 'horas'], ['mi', e.mi, 'minuto', 'minutos'], ['s', e.s, 'segundo', 'segundos']);
  const box = $('#c-units'), sig = defs.map(d => d[0]).join();
  if (sig !== ticker.sig) { ticker.sig = sig; box.innerHTML = defs.map(d => `<div class="unit"><b data-u="${d[0]}"></b><span data-l="${d[0]}"></span></div>`).join(''); }
  for (const [k, n, one, many] of defs) {
    $(`[data-u="${k}"]`, box).textContent = ['h', 'mi', 's'].includes(k) ? String(n).padStart(2, '0') : n;
    $(`[data-l="${k}"]`, box).textContent = n === 1 ? one : many;
  }
  $('#c-since').textContent = 'Desde el ' + fmtDate(c.start);
  $('#c-days').innerHTML = e.future ? '' : `Son <b>${e.days.toLocaleString('es')}</b> ${e.days === 1 ? 'día' : 'días'} de amor`;
  const next = $('#c-next');
  if (e.future) { next.className = 'next'; next.textContent = ''; }
  else if (e.d === 0 && e.months > 0) { next.className = 'next party'; next.textContent = `¡Hoy cumplen ${spanLabel(e.months)}! 🎉`; }
  else {
    const left = Math.ceil((addMonths(start, e.months + 1) - now) / 864e5);
    next.className = 'next'; next.textContent = `Faltan ${plural(left, 'día', 'días')} para cumplir ${spanLabel(e.months + 1)}.`;
  }
}

/* --- galería --- */
const ROT = [-2.4, 1.8, -1.2, 2.5, -2, 1.1];
function renderGallery() {
  const sec = $('#s-gallery'), list = S.content.photos;
  sec.hidden = !list.length && !S.admin;
  const car = $('#carousel'), keep = car.scrollLeft;
  $('.carousel-wrap', sec).hidden = !list.length; $('#car-dots').hidden = !list.length;
  $('.empty-note', sec)?.remove();
  if (!list.length) { $('.wrap', sec).insertAdjacentHTML('beforeend', emptyNote('Aquí van sus fotos. Se suben ya cifradas.', 'fotos')); return; }
  car.innerHTML = list.map((p, i) => `<figure class="polaroid" data-reveal data-i="${i}" data-pid="${esc(p.id)}" style="--rot:${ROT[i % ROT.length]}deg"><div class="ph"><img alt="${esc(p.cap || 'Foto ' + (i + 1))}" decoding="async"></div><figcaption>${esc(p.cap)}</figcaption></figure>`).join('');
  $('#car-dots').innerHTML = list.map(() => '<i></i>').join('');
  list.forEach(p => setImg(p.id));
  car.scrollLeft = keep; markDots(); reveal(car);
}
function setImg(id) {
  const m = S.media.get(id); if (!m) return;
  $$(`[data-pid="${CSS.escape(id)}"] .ph`).forEach(ph => {
    const img = $('img', ph); if (img.src === m.url) return;
    img.onload = () => ph.classList.add('ready'); img.src = m.url; if (img.complete) ph.classList.add('ready');
  });
}
function markDots() {
  const car = $('#carousel'), figs = $$('.polaroid', car); if (!figs.length) return;
  const mid = car.scrollLeft + car.clientWidth / 2; let best = 0, bd = 1e9;
  figs.forEach((f, i) => { const d = Math.abs(f.offsetLeft + f.offsetWidth / 2 - mid); if (d < bd) { bd = d; best = i; } });
  $$('#car-dots i').forEach((d, i) => d.classList.toggle('on', i === best));
}
let dotsRaf = 0;
$('#carousel').addEventListener('scroll', () => { cancelAnimationFrame(dotsRaf); dotsRaf = requestAnimationFrame(markDots); }, { passive: true });
const slide = dir => { const car = $('#carousel'), f = $('.polaroid', car); if (f) car.scrollBy({ left: dir * (f.offsetWidth + 22), behavior: 'smooth' }); };
$('#car-prev').onclick = () => slide(-1); $('#car-next').onclick = () => slide(1);
$('#carousel').addEventListener('keydown', e => { if (e.key === 'ArrowRight') slide(1); if (e.key === 'ArrowLeft') slide(-1); });
$('#carousel').addEventListener('click', e => { const f = e.target.closest('.polaroid'); if (f) openLightbox(+f.dataset.i); });

/* visor de fotos */
const LB = { i: 0 };
function openLightbox(i) { LB.i = i; $('#lightbox').hidden = false; drawLightbox(); }
function drawLightbox() {
  const list = S.content.photos, p = list[LB.i]; if (!p) return;
  const m = S.media.get(p.id);
  $('#lb-img').src = m ? m.url : ''; $('#lb-img').alt = p.cap || ''; $('#lb-cap').textContent = p.cap || '';
}
const lbMove = d => { const n = S.content.photos.length; LB.i = (LB.i + d + n) % n; drawLightbox(); };
$('#lb-close').onclick = () => { $('#lightbox').hidden = true; };
$('#lb-prev').onclick = () => lbMove(-1); $('#lb-next').onclick = () => lbMove(1);
$('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; });
addEventListener('keydown', e => {
  if ($('#lightbox').hidden) return;
  if (e.key === 'Escape') $('#lightbox').hidden = true; if (e.key === 'ArrowRight') lbMove(1); if (e.key === 'ArrowLeft') lbMove(-1);
});
let tx = 0;
$('#lightbox').addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
$('#lightbox').addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) lbMove(dx < 0 ? 1 : -1); });

async function loadPhotos() {
  const ids = S.content.photos.map(p => p.id).filter(id => !S.media.has(id));
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const doc = await backend.getPhoto(id); if (!doc) continue;
        const bytes = await Crypto.open(S.ck, doc);
        S.media.set(id, { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), dirty: false });
        setImg(id);
        if (!$('#lightbox').hidden) drawLightbox();
        if (S.tab === 'fotos' && !$('#editor').hidden) ED.renderBody();
      } catch (e) { console.warn('Foto no disponible', id, e); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

/* --- línea del tiempo --- */
function renderTimeline() {
  const sec = $('#s-timeline'), list = S.content.timeline.filter(t => t.title || t.text);
  sec.hidden = !list.length && !S.admin;
  $('.empty-note', sec)?.remove();
  const ol = $('#timeline');
  if (!list.length) { ol.innerHTML = ''; $('.wrap', sec).insertAdjacentHTML('beforeend', emptyNote('Aquí va la historia de ustedes.', 'historia')); return; }
  ol.innerHTML = [...list].sort((a, b) => String(a.date).localeCompare(String(b.date))).map((t, i) =>
    `<li class="tl" data-reveal style="transition-delay:${(i % 3) * 80}ms"><span class="tl-dot">${esc(t.emoji || '💗')}</span><div class="tl-card"><p class="tl-date">${t.date ? esc(fmtDate(t.date)) : ''}</p><h3>${esc(t.title)}</h3><p>${esc(t.text)}</p></div></li>`).join('');
  reveal(ol);
}

/* --- razones --- */
function renderReasons() {
  const sec = $('#s-reasons'), list = S.content.reasons.filter(Boolean);
  sec.hidden = !list.length && !S.admin;
  $('.empty-note', sec)?.remove();
  const box = $('#reasons');
  if (!list.length) { box.innerHTML = ''; $('#reasons-progress').textContent = ''; $('.wrap', sec).insertAdjacentHTML('beforeend', emptyNote('Escribe las cosas que amas de esa persona.', 'razones')); return; }
  box.innerHTML = list.map((r, i) => `<button class="reason" type="button" data-reveal style="transition-delay:${(i % 4) * 70}ms" aria-pressed="false"><span class="r-in"><span class="face front"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-heart"/></svg><b>${i + 1}</b></span><span class="face back">${esc(r)}</span></span></button>`).join('');
  updateReasons(); reveal(box);
}
function updateReasons() {
  const all = $$('#reasons .reason'), open = all.filter(b => b.classList.contains('flipped')).length;
  $('#reasons-progress').textContent = !all.length ? '' : open === all.length ? '¡Las descubriste todas! Y aún hay más. 💗' : `Has descubierto ${open} de ${all.length}`;
}
$('#reasons').addEventListener('click', e => {
  const b = e.target.closest('.reason'); if (!b) return;
  const on = b.classList.toggle('flipped'); b.setAttribute('aria-pressed', on);
  if (on) { const r = b.getBoundingClientRect(); ambient.burst(r.left + r.width / 2, r.top + r.height / 2); }
  updateReasons();
});

/* --- música (Spotify) --- */
function spotify(url) {
  const m = String(url || '').match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|track|artist|episode|show)\/([A-Za-z0-9]+)/) || String(url || '').match(/spotify:(playlist|album|track|artist|episode|show):([A-Za-z0-9]+)/);
  return m ? { type: m[1], id: m[2], src: `https://open.spotify.com/embed/${m[1]}/${m[2]}?utm_source=generator`, link: `https://open.spotify.com/${m[1]}/${m[2]}` } : null;
}
function renderMusic() {
  const sec = $('#s-music'), m = S.content.music, sp = spotify(m.url);
  sec.hidden = !sp && !S.admin;
  $('#m-title').textContent = m.title || 'Nuestra banda sonora';
  $('#m-note').textContent = m.note || '';
  const box = $('#player');
  if (!sp) { box.dataset.src = ''; box.innerHTML = emptyNote('Pega el enlace de tu playlist de Spotify.', 'musica'); return; }
  if (box.dataset.src === sp.src) return;
  box.dataset.src = sp.src;
  box.innerHTML = `<iframe src="${esc(sp.src)}" height="${sp.type === 'track' || sp.type === 'episode' ? 152 : 380}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="Reproductor de Spotify"></iframe><a class="open-sp" href="${esc(sp.link)}" target="_blank" rel="noopener">Abrir en Spotify ↗</a>`;
}

/* --- final --- */
function renderFinale() {
  const c = S.content;
  $('#f-text').textContent = c.finale.text;
  $('#f-btn').textContent = c.finale.btn || 'Te quiero';
  $('#f-foot').textContent = `Hecho con amor${c.from ? ' por ' + c.from : ''}`;
}
$('#f-btn').addEventListener('click', e => {
  const r = e.currentTarget.getBoundingClientRect();
  ambient.burst(r.left + r.width / 2, r.top + r.height / 2);
  setTimeout(() => ambient.burst(r.left + r.width * .25, r.top), 180); setTimeout(() => ambient.burst(r.left + r.width * .75, r.top), 320);
});

/* --- aparecer al hacer scroll --- */
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: .12, rootMargin: '0px 0px -6% 0px' }) : null;
function reveal(root = document) { $$('[data-reveal]:not(.in)', root).forEach(el => (io ? io.observe(el) : el.classList.add('in'))); }
$$('.sec:not(.s-letter) .wrap > *').forEach(el => el.setAttribute('data-reveal', ''));
document.addEventListener('click', e => {
  const s = e.target.closest('[data-scroll]'); if (s) $(s.dataset.scroll).scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth' });
  const t = e.target.closest('[data-open-tab]'); if (t) ED.open(t.dataset.openTab);
});

/* ================= modo creador ================= */
function syncAdminUI() {
  S.admin = backend.isAdmin();
  creatorLine();
  $('#fab-edit').hidden = !(S.admin && S.unlocked) || !$('#editor').hidden;
  if (S.unlocked) { renderGallery(); renderTimeline(); renderReasons(); renderMusic(); }
  else if (S.empty) showEmpty();
  if (!S.admin && !$('#editor').hidden) ED.close();
}

function authError(e) {
  const map = {
    'app/not-admin': 'Esa cuenta no es la del creador.',
    'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase (Authentication > Settings > Authorized domains).',
    'auth/operation-not-allowed': 'El inicio de sesión con Google no está activado en Firebase.',
    'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permítela e inténtalo de nuevo.'
  };
  return map[e.code] || (e.message ? 'No se pudo iniciar sesión: ' + e.message : 'No se pudo iniciar sesión.');
}
function friendly(e) {
  const c = e && e.code;
  if (c === 'permission-denied') return 'Firebase rechazó la operación. ¿Publicaste las reglas nuevas de firestore.rules y entraste con la cuenta del creador?';
  if (c === 'unavailable' || !navigator.onLine) return 'Sin conexión. Inténtalo de nuevo en un momento.';
  if (c === 'invalid-argument' || /size|large|exceeds/i.test(e?.message || '')) return 'Algo pesa demasiado para guardarse (¿una foto muy grande?).';
  return (e && e.message) || 'Algo salió mal.';
}

$('.creator-line').addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'); if (a) await gateAction(a.dataset.act);
});
$('#gate-state').addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'); if (a) await gateAction(a.dataset.act);
});
async function gateAction(act) {
  try {
    if (act === 'signin') { await backend.signIn(); }
    else if (act === 'signout') { await backend.signOut(); }
    else if (act === 'setup') { openSetup(); }
    else if (act === 'retry') { location.reload(); }
    else if (act === 'reset') {
      if (!confirm('Esto borra la carta y todas las fotos para empezar de cero. ¿Seguro?')) return;
      await backend.clearAll(); try { localStorage.removeItem(REMEMBER_KEY); } catch (e) { /* nada */ }
      S.cfg = null; showEmpty(); syncAdminUI(); toast('Todo borrado. Ya puedes preparar una carta nueva.');
    }
  } catch (err) { toast(act === 'signin' ? authError(err) : friendly(err)); }
}

/* --- editor --- */
const ED = {
  tabs: [['general', 'General'], ['carta', 'Carta'], ['fotos', 'Fotos'], ['historia', 'Historia'], ['razones', 'Razones'], ['musica', 'Música'], ['acceso', 'Acceso'], ['compartir', 'Compartir']],
  open(tab) {
    if (tab) S.tab = tab;
    $('#editor').hidden = false; $('#fab-edit').hidden = true; document.body.classList.add('editing');
    this.renderTabs(); this.renderBody(); markDirty(S.dirty);
  },
  close() { $('#editor').hidden = true; document.body.classList.remove('editing'); $('#fab-edit').hidden = !(S.admin && S.unlocked); },
  renderTabs() {
    $('#ed-tabs').innerHTML = this.tabs.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" class="${k === S.tab ? 'on' : ''}" aria-selected="${k === S.tab}">${n}</button>`).join('');
  },
  renderBody() {
    const body = $('#ed-body'), top = body.scrollTop;
    body.innerHTML = this.views[S.tab]();
    body.scrollTop = top;
    if (S.tab === 'compartir') { loadQr(); loadVisits(); }
  },
  views: {
    general() {
      const c = S.content;
      return `<label class="f"><span>Para (su nombre)</span><input data-k="to" value="${esc(c.to)}" maxlength="40"></label>
        <label class="f"><span>De (tu nombre)</span><input data-k="from" value="${esc(c.from)}" maxlength="40"></label>
        <label class="f"><span>Fecha en que empezó todo</span><input type="date" data-k="start" value="${esc(c.start)}"><small>Revisa el año: el contador y los aniversarios salen de esta fecha.</small></label>
        <div class="f"><span>Tema de color</span><div class="themes">${THEMES.map(t => `<button type="button" class="theme-pick ${c.theme === t.id ? 'on' : ''}" data-act="theme" data-id="${t.id}"><i style="background:${t.swatch}"></i>${t.name}</button>`).join('')}</div></div>
        <label class="chk"><input type="checkbox" data-k="petals" ${c.petals !== false ? 'checked' : ''}> Pétalos y corazones cayendo de fondo</label>`;
    },
    carta() {
      const c = S.content;
      return `<h4>La carta del inicio</h4>
        <label class="f"><span>Saludo</span><input data-k="letter.greet" value="${esc(c.letter.greet)}" maxlength="80"></label>
        <label class="f"><span>Carta</span><textarea data-k="letter.body" rows="12">${esc(c.letter.body)}</textarea><small>Deja una línea en blanco para separar párrafos.</small></label>
        <label class="f"><span>Despedida</span><input data-k="letter.sign" value="${esc(c.letter.sign)}" maxlength="80"><small>Debajo aparece tu nombre.</small></label>
        <h4>Mensaje final</h4>
        <label class="f"><span>Texto</span><textarea data-k="finale.text" rows="3">${esc(c.finale.text)}</textarea></label>
        <label class="f"><span>Texto del botón</span><input data-k="finale.btn" value="${esc(c.finale.btn)}" maxlength="30"></label>`;
    },
    fotos() {
      const list = S.content.photos;
      return `<p class="note">Las fotos se reducen y se cifran antes de subirse. Máximo ${MAX_PHOTOS}. Se guardan al tocar <b>Guardar cambios</b>.</p>
        <label class="drop" for="file-photos"><span id="ph-progress">+ Elegir fotos</span><small>${list.length} de ${MAX_PHOTOS}</small></label>
        <input id="file-photos" type="file" accept="image/*" multiple hidden>
        ${list.map((p, i) => {
          const m = S.media.get(p.id);
          return `<div class="item photo-item">${m ? `<img src="${m.url}" alt="">` : '<div class="thumb-ph"></div>'}<div><input data-k="photos.${i}.cap" value="${esc(p.cap)}" maxlength="80" placeholder="Pie de foto (opcional)"><div class="ctl">
            <button type="button" class="mini" data-act="ph-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Mover antes">↑</button>
            <button type="button" class="mini" data-act="ph-down" data-i="${i}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Mover después">↓</button>
            <button type="button" class="mini del" data-act="ph-del" data-i="${i}" aria-label="Quitar foto">🗑</button></div></div></div>`;
        }).join('')}`;
    },
    historia() {
      const list = S.content.timeline;
      return `<p class="note">Los momentos se ordenan solos por fecha.</p>
        ${list.map((t, i) => `<div class="item"><div class="top"><input data-emoji data-k="timeline.${i}.emoji" value="${esc(t.emoji)}" maxlength="4" aria-label="Emoji"><input type="date" data-k="timeline.${i}.date" value="${esc(t.date)}"><button type="button" class="mini del" data-act="tl-del" data-i="${i}" aria-label="Quitar momento">🗑</button></div>
          <input data-k="timeline.${i}.title" value="${esc(t.title)}" maxlength="70" placeholder="Título"><textarea data-k="timeline.${i}.text" placeholder="Qué pasó">${esc(t.text)}</textarea></div>`).join('')}
        <button type="button" class="btn ghost" data-act="tl-add">+ Agregar momento</button>`;
    },
    razones() {
      const list = S.content.reasons;
      return `<p class="note">Cada razón es un corazón que se da vuelta al tocarlo.</p>
        ${list.map((r, i) => `<div class="item"><div class="top"><input data-k="reasons.${i}" value="${esc(r)}" maxlength="120" placeholder="Algo que amas de esa persona"><button type="button" class="mini del" data-act="rs-del" data-i="${i}" aria-label="Quitar">🗑</button></div></div>`).join('')}
        <button type="button" class="btn ghost" data-act="rs-add">+ Agregar razón</button>`;
    },
    musica() {
      const m = S.content.music;
      return `<label class="f"><span>Enlace de Spotify</span><input data-k="music.url" value="${esc(m.url)}" placeholder="https://open.spotify.com/playlist/…" inputmode="url" autocapitalize="none"><small id="m-status"></small></label>
        <p class="note">En Spotify: abre la playlist, toca los tres puntos, <b>Compartir</b> y <b>Copiar enlace</b>. Debe ser pública. Funciona también con álbumes y canciones.</p>
        <label class="f"><span>Título</span><input data-k="music.title" value="${esc(m.title)}" maxlength="60"></label>
        <label class="f"><span>Texto breve</span><input data-k="music.note" value="${esc(m.note)}" maxlength="120"></label>
        <p class="note warn">Spotify solo reproduce canciones completas a quien tenga sesión iniciada en su navegador; sin sesión suenan fragmentos de 30 segundos.</p>`;
    },
    acceso() {
      const cfg = S.cfg;
      return `<p class="note warn">La contraseña cifra todo el contenido. <b>Si la olvidas no hay forma de recuperarlo</b> (por eso existe el respaldo en la pestaña Compartir). No distingue mayúsculas ni tildes.</p>
        <label class="f"><span>Nueva contraseña</span><input id="ac-pw" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder="Déjala vacía para no cambiarla"></label>
        <label class="f"><span>Pista</span><input id="ac-hint" value="${esc(cfg.hint)}" maxlength="200"></label>
        <label class="f"><span>Segunda pista <em>(opcional, aparece tras 3 intentos fallidos)</em></span><input id="ac-hint2" value="${esc(cfg.hint2 || '')}" maxlength="200"></label>
        <button type="button" class="btn" data-act="access-save">Guardar acceso</button>`;
    },
    compartir() {
      return `<div class="share-box"><div class="qr" id="qr" aria-label="Código QR del enlace"></div><code>${esc(shareLink())}</code>
        <div class="row"><button type="button" class="btn small" data-act="copy">Copiar enlace</button><button type="button" class="btn small ghost" data-act="qr-save">Guardar QR</button></div></div>
        <p class="note">Imprime el QR en una tarjeta o mándalo por mensaje. Para entrar hace falta la contraseña.</p>
        <h4>Aperturas</h4><div id="visits" class="note">Cargando…</div>
        <h4>Respaldo</h4>
        <p class="note warn">El respaldo se descarga <b>sin cifrar</b> (con tus fotos). Guárdalo en un lugar privado.</p>
        <div class="row"><button type="button" class="btn small ghost" data-act="export">Descargar</button><label class="btn small ghost" for="file-import" style="text-align:center;cursor:pointer">Restaurar</label></div>
        <input id="file-import" type="file" accept="application/json,.json" hidden>
        <h4>Sesión</h4><button type="button" class="btn small ghost" data-act="signout-ed">Cerrar sesión de creador</button>`;
    }
  }
};
const shareLink = () => location.origin + location.pathname.replace(/index\.html$/, '');

function markDirty(v = true) {
  S.dirty = v;
  const el = $('#ed-state'); el.textContent = v ? 'Cambios sin guardar' : 'Todo guardado'; el.classList.toggle('dirty', v);
}
addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

const refreshT = {};
function refreshFor(k) {
  const root = k.split('.')[0];
  clearTimeout(refreshT[root]);
  refreshT[root] = setTimeout(() => {
    if (root === 'to' || root === 'from' || root === 'letter') { renderLetter(true); renderFinale(); }
    else if (root === 'finale') renderFinale();
    else if (root === 'start') { renderCounter(); renderTimeline(); }
    else if (root === 'petals') applyTheme();
    else if (root === 'photos') renderGallery();
    else if (root === 'timeline') renderTimeline();
    else if (root === 'reasons') renderReasons();
    else if (root === 'music') { renderMusic(); musicStatus(); }
  }, 250);
}
function musicStatus() {
  const el = $('#m-status'); if (!el) return;
  const url = S.content.music.url, sp = spotify(url);
  el.className = sp ? 'ok' : url ? 'bad' : ''; el.textContent = sp ? `Enlace válido (${{ playlist: 'playlist', album: 'álbum', track: 'canción', artist: 'artista', episode: 'episodio', show: 'podcast' }[sp.type]}) ✓` : url ? 'Ese enlace no parece de Spotify.' : '';
}

const edBody = $('#ed-body');
edBody.addEventListener('input', e => {
  const el = e.target.closest('[data-k]'); if (!el) return;
  setPath(S.content, el.dataset.k, el.type === 'checkbox' ? el.checked : el.value);
  markDirty(); refreshFor(el.dataset.k);
});
edBody.addEventListener('change', async e => {
  if (e.target.id === 'file-photos') { await addPhotos(e.target.files); e.target.value = ''; }
  if (e.target.id === 'file-import') { await importBackup(e.target.files[0]); e.target.value = ''; }
});
edBody.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const c = S.content, i = +b.dataset.i, act = b.dataset.act;
  if (act === 'theme') { c.theme = b.dataset.id; applyTheme(); markDirty(); ED.renderBody(); return; }
  if (act === 'tl-add') { c.timeline.push({ date: isoDay(new Date()), emoji: '💗', title: '', text: '' }); }
  else if (act === 'tl-del') { c.timeline.splice(i, 1); }
  else if (act === 'rs-add') { c.reasons.push(''); }
  else if (act === 'rs-del') { c.reasons.splice(i, 1); }
  else if (act === 'ph-up' || act === 'ph-down') { const j = act === 'ph-up' ? i - 1 : i + 1; [c.photos[i], c.photos[j]] = [c.photos[j], c.photos[i]]; }
  else if (act === 'ph-del') { removePhoto(i); }
  else if (act === 'access-save') { await saveAccess(); return; }
  else if (act === 'copy') { try { await navigator.clipboard.writeText(shareLink()); toast('Enlace copiado'); } catch (err) { toast('Cópialo a mano desde el recuadro'); } return; }
  else if (act === 'qr-save') { saveQr(); return; }
  else if (act === 'export') { exportBackup(); return; }
  else if (act === 'signout-ed') { await backend.signOut(); return; }
  else return;
  markDirty(); ED.renderBody();
  ({ 'tl-add': renderTimeline, 'tl-del': renderTimeline, 'rs-add': renderReasons, 'rs-del': renderReasons, 'ph-up': renderGallery, 'ph-down': renderGallery, 'ph-del': renderGallery })[act]();
});
$('#ed-tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) { S.tab = b.dataset.tab; ED.renderTabs(); ED.renderBody(); } });
$('#ed-close').onclick = () => ED.close();
$('#fab-edit').onclick = () => ED.open();
$('#ed-save').onclick = () => save();

/* --- fotos --- */
async function compress(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    bmp = await new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = fail; im.src = URL.createObjectURL(file); });
  }
  const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
  let scale = Math.min(1, PHOTO_MAX_PX / Math.max(w, h)), q = .82, blob;
  for (let n = 0; n < 9; n++) {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= PHOTO_MAX_BYTES) break;
    if (q > .6) q -= .08; else scale *= .85;
  }
  if (!blob) throw new Error('No se pudo procesar la imagen');
  return new Uint8Array(await blob.arrayBuffer());
}
async function addPhotos(fileList) {
  let files = [...fileList]; if (!files.length) return;
  const room = MAX_PHOTOS - S.content.photos.length;
  if (files.length > room) { toast(`Máximo ${MAX_PHOTOS} fotos.`); files = files.slice(0, Math.max(0, room)); }
  const label = $('#ph-progress');
  for (let n = 0; n < files.length; n++) {
    if (label) label.textContent = `Preparando foto ${n + 1} de ${files.length}…`;
    try {
      const bytes = await compress(files[n]), id = uid();
      S.media.set(id, { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), dirty: true });
      S.content.photos.push({ id, cap: '' });
    } catch (e) { console.warn(e); toast('No se pudo usar ' + files[n].name); }
  }
  markDirty(); renderGallery(); ED.renderBody();
}
function removePhoto(i) {
  const [p] = S.content.photos.splice(i, 1); const m = S.media.get(p.id);
  if (m) { if (!m.dirty) S.removed.add(p.id); URL.revokeObjectURL(m.url); S.media.delete(p.id); } else S.removed.add(p.id);
}

/* --- guardar --- */
async function writeConfig() {
  const sealed = await Crypto.seal(S.ck, enc.encode(JSON.stringify(S.content)));
  S.cfg = { ...S.cfg, iv: sealed.iv, ct: sealed.ct, updatedAt: Date.now() };
  await backend.setConfig(S.cfg);
}
async function save() {
  if (S.saving) return false;
  S.saving = true; const btn = $('#ed-save'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const valid = new Set(S.content.photos.map(p => p.id));
    for (const [id, m] of S.media) {
      if (m.dirty && valid.has(id)) { await backend.setPhoto(id, { ...(await Crypto.seal(S.ck, m.bytes)), updatedAt: Date.now() }); m.dirty = false; }
    }
    for (const id of [...S.removed]) { await backend.delPhoto(id); S.removed.delete(id); }
    await writeConfig();
    markDirty(false); toast('Guardado ✓'); return true;
  } catch (e) { console.error(e); toast(friendly(e)); return false; }
  finally { S.saving = false; btn.disabled = false; btn.textContent = 'Guardar cambios'; }
}
async function saveAccess() {
  const pw = $('#ac-pw').value, hint = $('#ac-hint').value.trim(), hint2 = $('#ac-hint2').value.trim();
  if (!hint) { toast('La pista no puede quedar vacía.'); return; }
  if (pw && normPw(pw).length < 6) { toast('La contraseña necesita al menos 6 caracteres.'); return; }
  const prev = S.cfg;
  try {
    const patch = { hint, hint2 };
    if (pw) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const w = await Crypto.wrap(await Crypto.kek(normPw(pw), salt, KDF_ITER), S.ck);
      Object.assign(patch, { salt: b64.enc(salt), iter: KDF_ITER, wiv: w.iv, wct: w.ct });
    }
    S.cfg = { ...prev, ...patch };
    if (await save()) { $('#ac-pw').value = ''; toast(pw ? 'Contraseña actualizada ✓' : 'Pista actualizada ✓'); } else S.cfg = prev;
  } catch (e) { S.cfg = prev; toast(friendly(e)); }
}

/* --- compartir, aperturas y respaldo --- */
async function loadQr() {
  const box = $('#qr'); if (!box) return;
  try {
    if (!window.qrcode) await loadScript('vendor/qrcode.js');
    const q = window.qrcode(0, 'M'); q.addData(shareLink()); q.make();
    box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }).replace(/fill="black"/g, 'fill="#5E1B33"');
  } catch (e) { box.textContent = ''; }
}
function saveQr() {
  const svg = $('#qr svg'); if (!svg) return;
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'qr-carta.svg' }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function loadVisits() {
  const el = $('#visits'); if (!el) return;
  try {
    const list = await backend.visits();
    el.innerHTML = list.length ? `Se ha abierto ${list.length >= 30 ? 'más de 30' : list.length} ${list.length === 1 ? 'vez' : 'veces'}. Última: <b>${esc(new Date(list[0]).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }))}</b>` : 'Todavía nadie la ha abierto.';
  } catch (e) { el.textContent = 'No se pudo cargar.'; }
}
function exportBackup() {
  const photos = {};
  for (const p of S.content.photos) { const m = S.media.get(p.id); if (m) photos[p.id] = b64.enc(m.bytes); }
  const blob = new Blob([JSON.stringify({ v: 1, content: S.content, photos })], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: `carta-respaldo-${isoDay(new Date())}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importBackup(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.v !== 1 || !data.content || !data.content.letter) throw new Error('Ese archivo no es un respaldo válido.');
    if (!confirm('Esto reemplaza lo que ves ahora por el contenido del respaldo. ¿Seguir?')) return;
    for (const p of S.content.photos) { const m = S.media.get(p.id); if (m) { if (!m.dirty) S.removed.add(p.id); URL.revokeObjectURL(m.url); } }
    S.media.clear();
    const c = normalizeContent(data.content), kept = [];
    for (const p of c.photos) {
      const s = data.photos && data.photos[p.id]; if (!s) continue;
      const id = uid(), bytes = b64.dec(s);
      S.media.set(id, { bytes, url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), dirty: true }); kept.push({ id, cap: p.cap || '' });
    }
    c.photos = kept; S.content = c;
    renderAll(); markDirty(); ED.renderBody(); toast('Respaldo cargado. Toca Guardar cambios para publicarlo.');
  } catch (e) { toast(e.message || 'No se pudo leer el archivo.'); }
}

/* ================= arranque ================= */
async function boot() {
  ambient.init();
  creatorLine();
  if (DEMO) $('#demo-badge').hidden = false;
  backend.onAuth(syncAdminUI);
  try { S.cfg = await backend.getConfig(); }
  catch (e) { showGateError(e); return; }
  S.admin = backend.isAdmin(); creatorLine();
  if (!S.cfg) { showEmpty(); return; }
  if (await tryRemembered()) { await enterPage(); return; }
  showLocked();
}
boot();
