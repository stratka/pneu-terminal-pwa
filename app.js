/* ==========================================================================
   Pneuservis POS – PWA
   ========================================================================== */

// ---------------------------------------------------------------------------
// GitHub konfigurace
// ---------------------------------------------------------------------------
const GITHUB_REPO = 'stratka/pneu-terminal-pwa';
const GITHUB_CONFIG_PATH = 'config.json';
let GITHUB_TOKEN = localStorage.getItem('github_token') || '';

async function pushConfigToGitHub() {
  if (!GITHUB_TOKEN) {
    GITHUB_TOKEN = prompt('Zadej GitHub token (ulozi se do prohlizece, zadavas jen jednou):');
    if (!GITHUB_TOKEN) return false;
    localStorage.setItem('github_token', GITHUB_TOKEN);
  }

  const cfg = JSON.stringify({ services, settings, pricing, customWizards, pinnedItems }, null, 2);
  const content = btoa(unescape(encodeURIComponent(cfg)));

  // Ziskat aktualni SHA souboru a ulozit zalohu
  try {
    const meta = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_CONFIG_PATH}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    }).then(r => r.json());

    // Ulozit predchozi verzi jako zalohu
    if (meta.content) {
      localStorage.setItem('config_backup', atob(meta.content));
      localStorage.setItem('config_backup_time', new Date().toLocaleString('cs-CZ'));
    }

    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_CONFIG_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Aktualizace konfigurace z administrace',
        content: content,
        sha: meta.sha
      })
    });

    if (!resp.ok) {
      const err = await resp.json();
      if (resp.status === 401) {
        localStorage.removeItem('github_token');
        GITHUB_TOKEN = '';
        alert('Token neni platny. Zkus to znovu.');
      } else {
        alert('Chyba pri ukladani: ' + (err.message || resp.status));
      }
      return false;
    }
    return true;
  } catch(e) {
    alert('Chyba pripojeni: ' + e.message);
    return false;
  }
}

async function revertConfigOnGitHub() {
  const backup = localStorage.getItem('config_backup');
  const backupTime = localStorage.getItem('config_backup_time') || '?';
  if (!backup) { alert('Zadna zaloha neni k dispozici.'); return false; }
  if (!confirm(`Vratit konfiguraci z: ${backupTime}?`)) return false;

  if (!GITHUB_TOKEN) {
    GITHUB_TOKEN = prompt('Zadej GitHub token:');
    if (!GITHUB_TOKEN) return false;
    localStorage.setItem('github_token', GITHUB_TOKEN);
  }

  const content = btoa(unescape(encodeURIComponent(backup)));
  try {
    const meta = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_CONFIG_PATH}`, {
      headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
    }).then(r => r.json());

    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_CONFIG_PATH}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Vraceni predchozi konfigurace',
        content: content,
        sha: meta.sha
      })
    });
    if (!resp.ok) { alert('Chyba pri vraceni.'); return false; }

    // Nacist vracena data do aplikace
    const cfg = JSON.parse(backup);
    services = cfg.services || services;
    settings = cfg.settings || settings;
    pricing = cfg.pricing || pricing;
    customWizards = cfg.customWizards || customWizards;
    pinnedItems = cfg.pinnedItems || pinnedItems;
    renderTiles(); renderCart();
    return true;
  } catch(e) { alert('Chyba: ' + e.message); return false; }
}

// ---------------------------------------------------------------------------
// Zaloha objednavek na GitHub (privatni repo)
// ---------------------------------------------------------------------------
const GITHUB_DATA_REPO = 'stratka/pneu-terminal-data';

async function backupOrderToGitHub(order) {
  if (!GITHUB_TOKEN) return; // bez tokenu nezalohujeme

  try {
    const date = new Date();
    const fileName = `orders/${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${Date.now()}.json`;
    const content = btoa(unescape(encodeURIComponent(JSON.stringify(order, null, 2))));

    const resp = await fetch(`https://api.github.com/repos/${GITHUB_DATA_REPO}/contents/${fileName}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Objednavka ${order.spz || ''} ${order.datum || ''}`,
        content
      })
    });

    if (resp.ok) {
      order._backed_up = true;
    } else {
      order._backed_up = false;
    }
  } catch(e) {
    order._backed_up = false;
  }
}

async function backupPendingOrders() {
  if (!GITHUB_TOKEN) return;
  const orders = await db.getOrders();
  for (const order of orders) {
    if (!order._backed_up) {
      await backupOrderToGitHub(order);
      if (order._backed_up && order.id) {
        // Aktualizovat v IndexedDB
        const tx = db._db.transaction('orders', 'readwrite');
        tx.objectStore('orders').put(order);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ikony
// ---------------------------------------------------------------------------
const SERVICE_ICONS = {
  pneumatika: "\u2B24",
  vyvazeni:   "\u2696",
  geometrie:  "\u2B21",
  olej:       "\uD83D\uDEE2",
  brzdy:      "\u26D4",
  diagnostika:"\uD83D\uDD0D",
  klima:      "\u2744",
  vymena:     "\uD83D\uDD27",
  uskladneni: "\uD83D\uDCE6",
  myti:       "\uD83D\uDEBF",
  default:    "\u2699",
};

const TILE_COLORS = [
  "#2196F3","#4CAF50","#FF9800","#9C27B0",
  "#F44336","#00BCD4","#795548","#607D8B",
  "#E91E63","#3F51B5","#009688","#FFC107",
];

// ---------------------------------------------------------------------------
// Vychozi data
// ---------------------------------------------------------------------------
const DEFAULT_SERVICES = [];

const DEFAULT_SETTINGS = {
  firma:"Pneuservis s.r.o.",
  ico:"12345678",
  dic:"CZ12345678",
  adresa:"Hlavni 123, 110 00 Praha",
  telefon:"+420 123 456 789",
  email:"info@pneuservis.cz",
  banka_iban:"CZ6508000000192000145399",
  banka_bic:"GIBACZPX",
  mena:"CZK",
  dph_sazba:21,
  admin_password_hash:"c74dfc766e05ec9c8aea31b62d06171e959c727100423917d2f52943dc81ca3b",
  camera_url:"",
};

const DEFAULT_PRICING = {
  komplet:{
    "Osobni (plech)":{"R16":1000,"R17":1100},
    "Osobni (ALU)":{"R16":1200,"R17":1300,"R18":1400,"R19":1500,"R20":1700},
    "RunFlat / Profil < 50":{"R16":2000,"R17":2200,"R18":2400,"R19":2600,"R20":2700},
  },
  sada:{
    "Standardni":{"R16":800,"R17":900,"R18":1000,"R19":1100,"R20":1200,"R21":1300,"R22":1400},
  },
  defekt:{
    "Defekt do 6mm":300,
    "Defekt od 6mm (hribkem)":500,
    "Defekt v bocnici (hribkem)":600,
    "Netesnost kolem rafku":400,
  },
  dilci:{
    rozmerove:{
      "Demontaz + montaz 1ks disku z vozu":{"R16":100,"R17":100,"R18":100,"R19":125,"R20":150,"R21":200,"R22":250},
      "Demontaz 1ks pneumatiky z disku":{"R16":100,"R17":100,"R18":150,"R19":150,"R20":200},
      "Montaz 1ks pneumatiky na disk":{"R16":100,"R17":100,"R18":150,"R19":150,"R20":200},
    },
    suv_multiplier:2,
    pevne:{
      "TPMS":[
        {name:"Diagnostika TPMS",price:250},
        {name:"Programovani a vymena 1ks TPMS",price:1000},
      ],
      "Vyvazeni":[
        {name:"Vyvazeni 1ks pneumatiky",price:100},
        {name:"Pouziti zateze max 100g",price:50},
      ],
      "Manipulace":[
        {name:"Prevzeti 1ks pneu k likvidaci",price:25},
        {name:"Sleva prezuti 4ks bez vyvazeni",price:-150},
      ],
      "Olej a filtry":[
        {name:"Vymena oleje komplet",price:1200},
        {name:"Vymena oleje a filtru",price:1000},
        {name:"Vymena filtru (vzduch)",price:300},
        {name:"Vymena filtru (kabina/palivo)",price:500},
        {name:"Vymena akumulatoru",price:300},
      ],
      "Brzdy":[
        {name:"Kontrola brzd",price:350},
        {name:"Vymena kotoucu + desticky (naprava)",price:1000},
        {name:"Vymena brzd. desticek",price:750},
        {name:"Udrzba brzd",price:750},
      ],
      "Kontrola pred koupi":[
        {name:"Kontrola vozidla (provozovna)",price:3000},
        {name:"Kontrola vozidla (bazar)",price:4000},
        {name:"Kontrola vozidla (Ostrava)",price:4500},
      ],
      "Cisteni interieru":[
        {name:"Cisteni 2h (drobne)",price:2000},
        {name:"Cisteni 3h (hrube)",price:3000},
        {name:"Cisteni 4h (velmi hrube)",price:4000},
        {name:"Cisteni ozonem",price:500},
      ],
      "Klimatizace R134a":[
        {name:"Plneni klimatizace",price:900},
      ],
      "Testy":[
        {name:"Diagnostika",price:600},
        {name:"Test brzdove kapaliny",price:200},
        {name:"Test akumulatoru a alternatoru",price:300},
        {name:"Cteni chyb z jednotky",price:300},
        {name:"Nacteni pameti zavad DTC",price:500},
      ],
      "Ostatni":[
        {name:"Prirazka urgentni prace",price:500},
        {name:"Lepeni folii proti slunci",price:1500},
      ],
    },
  },
  priplatek_suv:200,
  sleva_bez_vyvazeni:-150,
  sleva_pneu_od_nas:-250,
};

// ---------------------------------------------------------------------------
// Databaze (IndexedDB wrapper)
// ---------------------------------------------------------------------------
class DB {
  constructor() {
    this._db = null;
  }
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('pneuservis', 2);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('orders')) {
          const os = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
          os.createIndex('datum', 'datum');
          os.createIndex('spz', 'spz');
        }
        if (!db.objectStoreNames.contains('invoices')) {
          db.createObjectStore('invoices', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  // Key-value store
  async getKV(key, defaultVal) {
    return new Promise((resolve) => {
      const tx = this._db.transaction('kv', 'readonly');
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : defaultVal);
      req.onerror = () => resolve(defaultVal);
    });
  }
  async setKV(key, val) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Orders
  async addOrder(order) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('orders', 'readwrite');
      const req = tx.objectStore('orders').add(order);
      req.onsuccess = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  async getOrders() {
    return new Promise((resolve) => {
      const tx = this._db.transaction('orders', 'readonly');
      const req = tx.objectStore('orders').getAll();
      req.onsuccess = () => resolve((req.result || []).reverse());
      req.onerror = () => resolve([]);
    });
  }

  // Invoice PDF blobs
  async saveInvoice(id, blob) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('invoices', 'readwrite');
      tx.objectStore('invoices').put({ id, blob, date: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async getInvoice(id) {
    return new Promise((resolve) => {
      const tx = this._db.transaction('invoices', 'readonly');
      const req = tx.objectStore('invoices').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  async getAllInvoiceIds() {
    return new Promise((resolve) => {
      const tx = this._db.transaction('invoices', 'readonly');
      const req = tx.objectStore('invoices').getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
}

const db = new DB();

// ---------------------------------------------------------------------------
// Stav aplikace
// ---------------------------------------------------------------------------
let services = [];
let settings = {};
let pricing = {};
let customWizards = []; // [ { name, icon, color, tree: { children: [...] } } ]
let pinnedItems = [];   // [ { name, price, icon, color, source } ]
let cart = {};          // { serviceIndex: qty }
let customItems = [];   // [ { name, price, qty, detail } ]
let currentSpz = '';
let photoDataUrl = null;
let pdfFontLoaded = false;

// ---------------------------------------------------------------------------
// Pomocne
// ---------------------------------------------------------------------------
function hashPassword(pwd) {
  // SHA-256 via SubtleCrypto
  const enc = new TextEncoder().encode(pwd);
  return crypto.subtle.digest('SHA-256', enc).then(buf => {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  });
}

function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function nowStr() {
  const d = new Date();
  return `${todayStr()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function dueStr() {
  const d = new Date(); d.setDate(d.getDate() + 14);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function createPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const fontName = 'Roboto';
  if (pdfFontLoaded && window._pdfFontRegular) {
    doc.addFileToVFS('Roboto-Regular.ttf', window._pdfFontRegular);
    doc.addFont('Roboto-Regular.ttf', fontName, 'normal');
    doc.addFileToVFS('Roboto-Bold.ttf', window._pdfFontBold);
    doc.addFont('Roboto-Bold.ttf', fontName, 'bold');
    doc.setFont(fontName);
  }
  // Override setFont aby fungoval s undefined jako prvni argument
  const origSetFont = doc.setFont.bind(doc);
  doc.setFont = (name, style) => {
    if (!name || name === undefined) name = pdfFontLoaded ? fontName : 'helvetica';
    if (style === 'italic' && pdfFontLoaded) style = 'normal'; // Roboto nema italic, fallback
    return origSetFont(name, style);
  };
  return doc;
}

async function nextInvoiceNumber() {
  let counter = await db.getKV('invoice_counter', 0);
  counter++;
  await db.setKV('invoice_counter', counter);
  const year = new Date().getFullYear();
  return `FA-${year}-${String(counter).padStart(4,'0')}`;
}

async function nextProtocolNumber() {
  const year = new Date().getFullYear();
  const key = `protocol_counter_${year}`;
  let counter = await db.getKV(key, 0);
  counter++;
  await db.setKV(key, counter);
  return `${year}-${String(counter).padStart(3,'0')}`;
}

function showSignaturePad(onDone) {
  const div = document.createElement('div');
  div.innerHTML = `
    <h2 style="text-align:center;margin-bottom:12px;">Podpis klienta</h2>
    <div style="text-align:center;margin-bottom:8px;font-size:13px;color:var(--text-muted);">Podepiste se prstem na plochu nize</div>
    <div style="display:flex;justify-content:center;">
      <canvas id="sig-canvas" width="600" height="250" style="background:#fff;border-radius:8px;border:2px solid #444;touch-action:none;cursor:crosshair;"></canvas>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:12px;">
      <button class="btn btn-green sig-ok" style="padding:12px 30px;font-size:15px;">POTVRDIT</button>
      <button class="btn btn-blue sig-clear" style="padding:12px 20px;font-size:15px;">SMAZAT</button>
      <button class="btn btn-red sig-skip" style="padding:12px 20px;font-size:15px;">PRESKOCIT</button>
    </div>
  `;

  const { overlay } = openModal(div, 'admin-modal');
  const canvas = div.querySelector('#sig-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';

  let drawing = false;
  let hasDrawn = false;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - rect.left) * (canvas.width / rect.width),
      y: (t.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    hasDrawn = true;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointerleave', () => { drawing = false; });

  div.querySelector('.sig-clear').onclick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  };
  div.querySelector('.sig-skip').onclick = () => {
    overlay.remove();
    onDone(null);
  };
  div.querySelector('.sig-ok').onclick = () => {
    if (!hasDrawn) { alert('Nejprve se podepiste.'); return; }
    const dataUrl = canvas.toDataURL('image/png');
    overlay.remove();
    onDone(dataUrl);
  };
}

async function generateProtocolPDF(wizName, items, formData, signatureDataUrl) {
  const protoNo = await nextProtocolNumber();
  const s = settings;
  const today = todayStr();

  const doc = createPDF();

  // Poradove cislo - velke, tucne, vpravo
  doc.setFont(undefined, 'bold');
  doc.setFontSize(36);
  doc.text(protoNo, 196, 22, { align: 'right' });

  // Hlavicka
  doc.setFont(undefined, 'bold');
  doc.setFontSize(18);
  doc.text('PŘEDÁVACÍ PROTOKOL', 14, 20);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(11);
  doc.text(`Uskladnění kol / pneu`, 14, 28);
  doc.setFontSize(10);
  doc.text(`Datum: ${today}`, 14, 36);

  // Dodavatel
  let y = 54;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Provozovatel:', 14, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  y += 7;
  doc.text(s.firma || '', 14, y); y += 6;
  doc.text(`ICO: ${s.ico || ''}  DIC: ${s.dic || ''}`, 14, y); y += 6;
  doc.text(s.adresa || '', 14, y); y += 6;
  doc.text(`Tel: ${s.telefon || ''}  Email: ${s.email || ''}`, 14, y); y += 12;

  // Zakaznik + popis (z formData)
  const fdEntries = Object.entries(formData || {});
  // Rozdelit na zakaznicke udaje a popis uskladneni
  const customerKeys = ['jmeno','jméno','prijmeni','příjmení','jméno a příjmení','adresa','telefon','email','spz'];
  const customerFields = [];
  const descFields = [];
  for (const [key, val] of fdEntries) {
    if (customerKeys.some(ck => key.toLowerCase().includes(ck))) {
      customerFields.push([key, val]);
    } else {
      descFields.push([key, val]);
    }
  }

  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Zákazník:', 14, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  y += 7;
  if (customerFields.length) {
    for (const [key, val] of customerFields) {
      doc.text(`${key}: ${val}`, 14, y); y += 6;
    }
  } else {
    doc.text('---', 14, y); y += 6;
  }
  y += 6;

  // Predmet uskladneni
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Předmět uskladnění:', 14, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  y += 7;
  if (descFields.length) {
    for (const [key, val] of descFields) {
      doc.text(`${key}: ${val}`, 14, y); y += 6;
    }
  }
  y += 4;

  // Cenova tabulka
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text('Ceník:', 14, y);
  y += 8;

  doc.setFillColor(52, 73, 94);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.rect(14, y, 182, 8, 'F');
  doc.text('#', 17, y + 6);
  doc.text('Popis', 25, y + 6);
  doc.text('Cena', 172, y + 6);
  y += 10;

  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  let totalPrice = 0;
  items.forEach((item, i) => {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.text(String(i + 1), 17, y + 5);
    doc.text((item.name || '').substring(0, 60), 25, y + 5);
    doc.text(`${item.price || 0} Kč`, 175, y + 5);
    doc.rect(14, y, 182, 7);
    totalPrice += (item.price || 0);
    y += 7;
  });

  y += 5;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(11);
  doc.text(`Celkem: ${totalPrice} Kč`, 196, y, { align: 'right' });
  y += 14;

  // Podpisy
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text('Předávající (zákazník):', 14, y);
  doc.text('Přebírající (servis):', 110, y);
  y += 4;
  if (signatureDataUrl) {
    try { doc.addImage(signatureDataUrl, 'PNG', 14, y, 70, 28); } catch(e) {}
  }
  y += 30;
  doc.line(14, y, 85, y);
  doc.line(110, y, 196, y);
  y += 5;
  doc.setFontSize(9);
  doc.text('Podpis', 45, y, { align: 'center' });
  doc.text('Podpis', 150, y, { align: 'center' });

  // Paticka
  doc.setFont(undefined, 'italic');
  doc.setFontSize(8);
  doc.text(`${s.firma || ''} | ${s.adresa || ''} | Tel: ${s.telefon || ''}`, 105, 285, { align: 'center' });

  return { doc, protoNo };
}

function showProtocol(doc, protoNo) {
  const pdfBlob = doc.output('blob');
  const url = URL.createObjectURL(pdfBlob);

  const div = document.createElement('div');
  div.innerHTML = `
    <h2 style="text-align:center;margin-bottom:12px;">Predavaci protokol ${protoNo}</h2>
    <div style="text-align:center;margin-bottom:12px;">
      <iframe src="${url}" style="width:100%;height:55vh;border:1px solid #444;border-radius:8px;"></iframe>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;">
      <button class="btn btn-blue proto-print" style="padding:12px 30px;font-size:15px;">TISK</button>
      <button class="btn btn-green proto-download" style="padding:12px 30px;font-size:15px;">STAHNOUT</button>
      <button class="btn btn-red proto-close" style="padding:12px 20px;font-size:15px;">ZAVRIT</button>
    </div>
  `;

  const { overlay } = openModal(div, 'admin-modal');

  div.querySelector('.proto-print').onclick = () => {
    const win = window.open(url, '_blank');
    if (win) { win.onload = () => { win.print(); }; }
  };
  div.querySelector('.proto-download').onclick = () => {
    const a = document.createElement('a');
    a.href = url; a.download = `protokol_${protoNo}.pdf`;
    a.click();
  };
  div.querySelector('.proto-close').onclick = () => {
    URL.revokeObjectURL(url);
    overlay.remove();
  };
}

function getTotal() {
  let t = 0;
  for (const [idx, qty] of Object.entries(cart)) {
    t += services[idx].price * qty;
  }
  for (const item of customItems) {
    t += item.price * item.qty;
  }
  return t;
}

function iconChar(key) {
  return SERVICE_ICONS[key] || SERVICE_ICONS.default;
}

// ---------------------------------------------------------------------------
// SPAYD QR
// ---------------------------------------------------------------------------
function generateSpayd(iban, amount, currency, message, vs) {
  const cleanIban = iban.replace(/\s/g, '');
  const bic = (settings.banka_bic || '').replace(/\s/g, '');
  const parts = ['SPD*1.0'];
  parts.push(`ACC:${cleanIban}${bic ? '+' + bic : ''}`);
  parts.push(`AM:${amount.toFixed(2)}`);
  parts.push(`CC:${currency}`);
  if (vs) parts.push(`X-VS:${vs}`);
  if (message) parts.push(`MSG:${message.substring(0,60)}`);
  return parts.join('*') + '*';
}

// ---------------------------------------------------------------------------
// Pripnute polozky (hvezdicky)
// ---------------------------------------------------------------------------
function isPinned(source, name) {
  return pinnedItems.some(p => p.source === source && p.name === name);
}

async function togglePin(source, name, price, icon, color) {
  const idx = pinnedItems.findIndex(p => p.source === source && p.name === name);
  if (idx >= 0) {
    pinnedItems.splice(idx, 1);
  } else {
    pinnedItems.push({ name, price, icon: icon || '', color: color || '#607D8B', source });
  }
  await db.setKV('pinnedItems', pinnedItems);
  renderTiles();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderTiles() {
  const area = document.getElementById('tiles-area');
  area.innerHTML = '';

  // Pripravit data vsech dlazdic
  const allTiles = [];

  services.forEach((svc, idx) => {
    let priceText;
    const svcType = svc.type || '';
    if (svcType === 'wizard_komplet') {
      const allP = Object.values(pricing.komplet || {}).flatMap(d => Object.values(d));
      priceText = `od ${Math.min(...allP)} Kc`;
    } else if (svcType === 'wizard_sada') {
      const allP = Object.values(pricing.sada || {}).flatMap(d => Object.values(d));
      priceText = `od ${Math.min(...allP)} Kc`;
    } else if (svcType === 'wizard_defekt') {
      const allP = Object.values(pricing.defekt || {});
      priceText = `od ${Math.min(...allP)} Kc`;
    } else if (svcType === 'wizard_dilci') {
      const dilci = pricing.dilci || {};
      let allP = [];
      for (const d of Object.values(dilci.rozmerove || {})) allP.push(...Object.values(d));
      for (const items of Object.values(dilci.pevne || {})) {
        for (const it of items) if (it.price > 0) allP.push(it.price);
      }
      priceText = allP.length ? `od ${Math.min(...allP)} Kc` : '';
    } else {
      priceText = `${svc.price} Kc`;
    }
    allTiles.push({ name: svc.name, icon: iconChar(svc.icon), color: svc.color || TILE_COLORS[idx % TILE_COLORS.length], priceText, onclick: () => addToCart(idx) });
  });

  customWizards.forEach((wiz, wIdx) => {
    let priceText = '';
    if (wiz.priceLabel) {
      priceText = wiz.priceLabel;
    } else {
      const allPrices = collectTreePrices(wiz.tree);
      if (allPrices.length) {
        const mn = Math.min(...allPrices);
        const mx = Math.max(...allPrices);
        priceText = mn === mx ? `${mn} Kc` : `od ${mn} Kc`;
      }
    }
    allTiles.push({ name: wiz.name, icon: iconChar(wiz.icon), color: wiz.color || '#607D8B', priceText, onclick: () => runCustomWizard(wiz) });
  });

  // Pripnute polozky z wizardu
  pinnedItems.forEach(pin => {
    allTiles.push({
      name: pin.name,
      icon: pin.icon ? iconChar(pin.icon) : '\u2B50',
      color: pin.color || '#607D8B',
      priceText: `${pin.price} Kc`,
      pinned: true,
      pinSource: pin.source,
      onclick: () => {
        customItems.push({ name: pin.name, price: pin.price, qty: 1, detail: pin.source });
        renderCart();
      }
    });
  });

  // Vypocitat font podle nejdelsiho nazvu
  const maxNameLen = Math.max(1, ...allTiles.map(t => t.name.length));
  // Dlazdice jsou cca 130-200px, s ikonou mame cca 2 radky pro text
  // Zakladni velikost 14px, zmensit pokud se nejdelsi nevejde
  let nameFontSize = 14;
  const tileTextWidth = 120; // priblizna sirka textu v dlazdici (px)
  const maxLines = 2;
  while (nameFontSize > 9 && (maxNameLen * nameFontSize * 0.55) > tileTextWidth * maxLines) {
    nameFontSize--;
  }
  let priceFontSize = Math.max(9, Math.floor(nameFontSize * 0.9));

  for (const t of allTiles) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.background = t.color;
    tile.innerHTML = `
      ${t.pinned ? '<div class="pin-badge" style="position:absolute;top:4px;right:6px;font-size:12px;cursor:pointer;z-index:10;">⭐</div>' : ''}
      <div class="tile-icon">${t.icon}</div>
      <div class="tile-name" style="font-size:${nameFontSize}px;">${t.name}</div>
      <div class="tile-price" style="font-size:${priceFontSize}px;">${t.priceText}</div>
    `;
    if (t.pinned) {
      tile.style.position = 'relative';
      const badge = tile.querySelector('.pin-badge');
      if (badge) {
        badge.onclick = (e) => {
          e.stopPropagation();
          if (confirm(`Odepnout "${t.name}" z hlavni strany?`)) {
            togglePin(t.pinSource, t.name, 0, '', '');
          }
        };
      }
    }
    tile.onclick = t.onclick;
    area.appendChild(tile);
  }
}

function collectTreePrices(node) {
  const prices = [];
  if (!node) return prices;
  if (node.price && node.price > 0) prices.push(node.price);
  if (node.children) {
    for (const child of node.children) prices.push(...collectTreePrices(child));
  }
  return prices;
}

function renderCart() {
  const list = document.getElementById('cart-list');
  list.innerHTML = '';
  let total = 0;

  customItems.forEach((item, i) => {
    const lineTotal = item.price * item.qty;
    total += lineTotal;
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `<span class="cart-item-name">${item.name}</span><span class="cart-item-price">${lineTotal} Kc</span>`;
    div.onclick = () => { customItems.splice(i, 1); renderCart(); };
    list.appendChild(div);
  });

  for (const [idx, qty] of Object.entries(cart)) {
    const svc = services[idx];
    const lineTotal = svc.price * qty;
    total += lineTotal;
    const div = document.createElement('div');
    div.className = 'cart-item';
    div.innerHTML = `<span class="cart-item-name">${svc.name} x${qty}</span><span class="cart-item-price">${lineTotal} Kc</span>`;
    div.onclick = () => {
      if (cart[idx] > 1) cart[idx]--;
      else delete cart[idx];
      renderCart();
    };
    list.appendChild(div);
  }

  document.getElementById('btn-finish').innerHTML = `<div style="font-size:28px;">${total} Kc</div><div>DOKONCIT A PLATIT</div>`;
}

// ---------------------------------------------------------------------------
// Kosik akce
// ---------------------------------------------------------------------------
function addToCart(idx) {
  const svc = services[idx];
  const svcType = svc.type || '';

  if (svcType === 'wizard_komplet') { showTireWizard('komplet'); return; }
  if (svcType === 'wizard_sada')    { showTireWizard('sada'); return; }
  if (svcType === 'wizard_defekt')  { showDefektWizard(); return; }
  if (svcType === 'wizard_dilci')   { showDilciWizard(); return; }

  cart[idx] = (cart[idx] || 0) + 1;
  renderCart();
}

function showCustomItemDialog() {
  const div = document.createElement('div');
  div.innerHTML = `
    <h2 style="text-align:center;margin-bottom:16px;">Rucni polozka</h2>
    <div style="max-width:350px;margin:0 auto;">
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:4px;">Nazev sluzby:</label>
        <input type="text" id="ci-name" placeholder="napr. Oprava svetla"
          style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;font-size:16px;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:4px;">Cena (Kc):</label>
        <input type="number" id="ci-price" placeholder="0"
          style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;font-size:16px;">
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn btn-green ci-ok" style="padding:12px 30px;font-size:15px;">PRIDAT</button>
        <button class="btn btn-red ci-cancel" style="padding:12px 20px;font-size:15px;">ZRUSIT</button>
      </div>
    </div>
  `;
  const { overlay } = openModal(div);
  div.querySelector('.ci-cancel').onclick = () => overlay.remove();
  div.querySelector('.ci-ok').onclick = () => {
    const name = div.querySelector('#ci-name').value.trim();
    const price = parseInt(div.querySelector('#ci-price').value) || 0;
    if (!name) { alert('Zadejte nazev sluzby.'); div.querySelector('#ci-name').focus(); return; }
    customItems.push({ name, price, qty: 1, detail: '' });
    renderCart();
    overlay.remove();
  };
  div.querySelector('#ci-name').focus();
}

function clearCart() {
  cart = {};
  customItems = [];
  currentSpz = '';
  photoDataUrl = null;
  document.getElementById('spz-display').textContent = '';
  document.getElementById('photo-area').innerHTML = '';
  renderCart();
}

// ---------------------------------------------------------------------------
// Modaly
// ---------------------------------------------------------------------------
function openModal(content, extraClass) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal' + (extraClass ? ' ' + extraClass : '');
  if (typeof content === 'string') modal.innerHTML = content;
  else modal.appendChild(content);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Klik na overlay = zavrit
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  return { overlay, modal };
}

function closeModal(overlay) {
  if (overlay) overlay.remove();
}

// ---------------------------------------------------------------------------
// Wizard: Tile selection helper
// ---------------------------------------------------------------------------
function wizardTileSelect(title, subtitle, options, big, callback, pinConfig) {
  // pinConfig: { source: string, getPin: (opt) => { name, price, icon, color } } — pokud je zadano, zobrazuji se hvezdicky
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  // Header with cancel button (right corner only)
  let html = `<div style="display:flex;justify-content:flex-end;margin-bottom:4px;flex-shrink:0;">
    <button class="btn btn-red wizard-cancel" style="font-size:13px;padding:8px 16px;">ZRUSIT</button>
  </div>`;
  // Title + subtitle directly above tiles
  html += `<div class="wizard-grid-auto" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;">
    <h2 style="margin:0 0 4px;text-align:center;">${title}</h2>
    ${subtitle ? `<div class="modal-subtitle" style="margin:0 0 10px;">${subtitle}</div>` : ''}
    <div class="wizard-tiles-container"></div>
  </div>`;
  container.innerHTML = html;

  const { overlay, modal } = openModal(container);
  modal.style.width = '95vw';
  modal.style.height = '95vh';
  modal.style.maxWidth = '100vw';
  modal.style.maxHeight = '100vh';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';

  container.querySelector('.wizard-cancel').onclick = () => overlay.remove();

  const gridWrap = container.querySelector('.wizard-tiles-container');

  // Vypocitat optimalni rozlozeni az po renderovani
  requestAnimationFrame(() => {
    const n = options.length;
    const parentWrap = container.querySelector('.wizard-grid-auto');
    const areaW = parentWrap.clientWidth;
    const areaH = parentWrap.clientHeight * 0.75;
    if (!areaW || !areaH) return;

    // Najit nejlepsi pocet sloupcu tak aby se vse veslo
    let bestCols = 1;
    let bestSize = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const gap = 10;
      const maxW = (areaW - gap * (cols + 1)) / cols;
      const maxH = (areaH - gap * (rows + 1)) / rows;
      const size = Math.min(maxW, maxH);
      if (size > bestSize) { bestSize = size; bestCols = cols; }
    }

    const cols = bestCols;
    const rows = Math.ceil(n / cols);
    const gap = 10;
    const tileSize = Math.min(260, Math.floor(Math.min(
      (areaW - gap * (cols + 1)) / cols,
      (areaH - gap * (rows + 1)) / rows
    )));

    // Najit nejdelsi label a sublabel pro urceni fontu
    const hasIcons = options.some(o => !!o.icon);
    const hasSublabels = options.some(o => !!o.sublabel);
    const maxLabelLen = Math.max(...options.map(o => (o.label || '').length));
    const maxSubLen = Math.max(0, ...options.map(o => {
      if (!o.sublabel) return 0;
      return Math.max(...o.sublabel.split('\n').map(l => l.length));
    }));
    const padding = 16;
    const availTextW = tileSize - padding;

    // Vice radku pro label pokud neni ikona ani sublabel
    const maxLabelLines = (hasIcons || hasSublabels) ? 2 : 3;
    let baseLabelSize = hasIcons ? Math.floor(tileSize * 0.13) : Math.floor(tileSize * 0.20);
    while (baseLabelSize > 9 && (maxLabelLen * baseLabelSize * 0.55) > availTextW * maxLabelLines) {
      baseLabelSize--;
    }
    baseLabelSize = Math.max(9, Math.min(baseLabelSize, 26));

    const iconSize = hasIcons ? Math.min(hasSublabels ? 28 : 42, Math.max(14, Math.floor(tileSize * (hasSublabels ? 0.15 : 0.25)))) : 0;
    let subSize = Math.max(8, Math.floor(baseLabelSize * 0.65));
    // Zmensit sublabel pokud se nevejde
    while (subSize > 8 && (maxSubLen * subSize * 0.55) > availTextW) {
      subSize--;
    }

    const grid = document.createElement('div');
    grid.style.cssText = `display:grid; grid-template-columns:repeat(${cols}, ${tileSize}px); grid-template-rows:repeat(${rows}, ${tileSize}px); gap:${gap}px;`;

    for (const opt of options) {
      const tile = document.createElement('div');
      tile.style.cssText = `
        background:${opt.color || '#2196F3'}; border-radius:12px;
        display:flex; flex-direction:column; align-items:center; justify-content:center;
        cursor:pointer; padding:8px; text-align:center; overflow:hidden;
        transition:transform 0.1s; position:relative;
      `;
      const hasIcon = !!opt.icon;

      // Hvezdicka pro pripnuti na hlavni stranu
      let starHtml = '';
      if (pinConfig && opt.pinnable !== false) {
        const pin = pinConfig.getPin(opt);
        const pinned = isPinned(pinConfig.source, pin.name);
        starHtml = `<div class="pin-star" style="position:absolute;top:4px;right:6px;font-size:16px;cursor:pointer;z-index:10;opacity:${pinned ? '1' : '0.4'};">${pinned ? '⭐' : '☆'}</div>`;
      }

      tile.innerHTML = `
        ${starHtml}
        ${hasIcon ? `<div style="font-size:${iconSize}px;margin-bottom:4px;line-height:1;">${opt.icon}</div>` : ''}
        <div style="font-size:${baseLabelSize}px;font-weight:700;line-height:1.2;word-break:break-word;">${opt.label}</div>
        ${opt.sublabel ? `<div style="font-size:${subSize}px;color:#e0e0e0;margin-top:4px;font-weight:700;white-space:pre-line;">${opt.sublabel}</div>` : ''}
      `;

      // Klik na hvezdicku = pin/unpin
      const starEl = tile.querySelector('.pin-star');
      if (starEl) {
        starEl.onclick = (e) => {
          e.stopPropagation();
          const pin = pinConfig.getPin(opt);
          togglePin(pinConfig.source, pin.name, pin.price, pin.icon, pin.color);
          const nowPinned = isPinned(pinConfig.source, pin.name);
          starEl.textContent = nowPinned ? '⭐' : '☆';
          starEl.style.opacity = nowPinned ? '1' : '0.4';
        };
      }

      tile.onpointerdown = () => { tile.style.transform = 'scale(0.95)'; };
      tile.onpointerup = () => { tile.style.transform = ''; };
      tile.onpointerleave = () => { tile.style.transform = ''; };
      tile.onclick = () => { overlay.remove(); callback(opt.value); };
      grid.appendChild(tile);
    }
    gridWrap.appendChild(grid);
  });

  return overlay;
}

// ---------------------------------------------------------------------------
// Wizard: Kompletni prezuti / Sada za sadu
// ---------------------------------------------------------------------------
function showTireWizard(mode) {
  const cenik = mode === 'komplet' ? pricing.komplet : pricing.sada;
  const state = {};

  function step1() {
    const typColors = ["#2196F3","#4CAF50","#FF9800"];
    const typIcons = ["\u2B24","\u2699","\u26A1"];
    const opts = Object.keys(cenik).map((typName, i) => {
      const sizes = cenik[typName];
      const priceMin = Math.min(...Object.values(sizes));
      const sizeKeys = Object.keys(sizes);
      return {
        label: typName,
        sublabel: `od ${priceMin} Kc\n${sizeKeys[0]}-${sizeKeys[sizeKeys.length-1]}`,
        color: typColors[i % typColors.length],
        icon: typIcons[i % typIcons.length],
        value: typName,
      };
    });
    const title = mode === 'komplet' ? 'KOMPLETNI PREZUTI - TYP DISKU' : 'SADA ZA SADU - TYP DISKU';
    const sub = mode === 'komplet' ? 'Sundani pneu, nasazeni, vyvazeni, ventilek, ocisteni' : 'Vymena kol na vozidle, vyvazeni, ocisteni';
    wizardTileSelect(title, sub, opts, false, v => { state.typ = v; step2(); });
  }

  function step2() {
    const sizes = cenik[state.typ];
    const sizeColors = ["#1abc9c","#3498db","#9b59b6","#e67e22","#e74c3c","#2c3e50","#16a085"];
    const opts = Object.entries(sizes).map(([sz, price], i) => ({
      label: sz, sublabel: `${price} Kc`,
      color: sizeColors[i % sizeColors.length], icon: '', value: sz,
    }));
    wizardTileSelect(`ROZMER KOLA - ${state.typ}`, 'Zvolte rozmer kola', opts, true, v => { state.size = v; step3(); });
  }

  function step3() {
    const opts = [
      { label:'OSOBNI VUZ', sublabel:'Bez priplatku', color:'#27ae60', icon:'\uD83D\uDE97', value:false },
      { label:'SUV / VAN / EV', sublabel:`+${pricing.priplatek_suv} Kc k sade`, color:'#e67e22', icon:'\uD83D\uDE98', value:true },
    ];
    wizardTileSelect('TYP VOZIDLA', `${state.typ} | ${state.size}`, opts, false, v => {
      state.suv = v;
      if (mode === 'sada') step4vyvazeni();
      else step5pneu();
    });
  }

  function step4vyvazeni() {
    const base = cenik[state.typ][state.size];
    let current = base + (state.suv ? pricing.priplatek_suv : 0);
    const bezVyvPrice = current + pricing.sleva_bez_vyvazeni;
    const opts = [
      { label:'S VYVAZENIM', sublabel:`${current} Kc`, color:'#27ae60', icon:'\u2696', value:false },
      { label:'BEZ VYVAZENI', sublabel:`${pricing.sleva_bez_vyvazeni} Kc\n${bezVyvPrice} Kc`, color:'#e57373', icon:'\u2696', value:true },
    ];
    wizardTileSelect('VYVAZENI', `${state.size} | ${state.suv ? 'SUV/VAN/EV' : 'Osobni'}`, opts, true, v => {
      state.bezVyv = v;
      finalize();
    });
  }

  function step5pneu() {
    const base = cenik[state.typ][state.size];
    let current = base + (state.suv ? pricing.priplatek_suv : 0);
    const discounted = Math.max(0, current + pricing.sleva_pneu_od_nas);
    const opts = [
      { label:'NE', sublabel:`${current} Kc`, color:'#e74c3c', icon:'', value:false },
      { label:'ANO', sublabel:`sleva ${pricing.sleva_pneu_od_nas} Kc\n${discounted} Kc`, color:'#27ae60', icon:'', value:true },
    ];
    wizardTileSelect('PNEU OD NAS', null, opts, true, v => {
      state.pneuOdNas = v;
      finalize();
    });
  }

  function finalize() {
    const base = cenik[state.typ][state.size];
    let total = base;
    const parts = [];
    if (mode === 'komplet') { parts.push('Komplet. prezuti', state.typ); }
    else { parts.push('Sada za sadu'); }
    parts.push(state.size);

    if (state.suv) { total += pricing.priplatek_suv; parts.push('SUV/VAN/EV'); }
    if (state.bezVyv) { total += pricing.sleva_bez_vyvazeni; parts.push('bez vyv.'); }
    if (state.pneuOdNas) { total += pricing.sleva_pneu_od_nas; parts.push('pneu od nas'); }
    total = Math.max(0, total);

    customItems.push({ name: parts.join(' | '), price: total, qty: 1, detail: '' });
    renderCart();
  }

  // Start
  if (mode === 'komplet') {
    step1();
  } else {
    // Sada - preskocit typ (jen jeden)
    state.typ = Object.keys(cenik)[0];
    step2();
  }
}

// ---------------------------------------------------------------------------
// Wizard: Defekt
// ---------------------------------------------------------------------------
function showDefektWizard() {
  const defektCenik = pricing.defekt || DEFAULT_PRICING.defekt;
  const defektInfo = [
    { key:"Defekt do 6mm", sub:"Vcetne demontaze a montaze\npneumatiky a disku z auta", color:"#27ae60", icon:"\uD83D\uDD27" },
    { key:"Defekt od 6mm (hribkem)", sub:"Studena metoda\ntzv. hribkem", color:"#2196F3", icon:"\uD83C\uDF44" },
    { key:"Defekt v bocnici (hribkem)", sub:"Pokud je to mozne\ntzv. zesilenym hribkem", color:"#e67e22", icon:"\u26A0" },
    { key:"Netesnost kolem rafku", sub:"Vcetne demontaze a montaze\npneumatiky a disku z auta", color:"#9C27B0", icon:"\uD83D\uDCA7" },
  ];
  const opts = defektInfo.map(info => ({
    label: info.key,
    sublabel: `od ${defektCenik[info.key] || 0} Kc\n${info.sub}`,
    color: info.color,
    icon: info.icon,
    value: { name: info.key, price: defektCenik[info.key] || 0 },
  }));
  wizardTileSelect('OPRAVA DEFEKTU', 'Vyberte typ opravy', opts, false, v => {
    customItems.push({ name: `Oprava defektu | ${v.name}`, price: v.price, qty: 1, detail: v.name });
    renderCart();
  }, {
    source: 'defekt',
    getPin: (opt) => ({ name: opt.value.name, price: opt.value.price, icon: 'vymena', color: '#F44336' })
  });
}

// ---------------------------------------------------------------------------
// Wizard: Dilci ukony
// ---------------------------------------------------------------------------
function showDilciWizard() {
  const dilci = pricing.dilci || DEFAULT_PRICING.dilci;
  const rozmerove = dilci.rozmerove || {};
  const suvMult = dilci.suv_multiplier || 2;
  const pevne = dilci.pevne || {};

  const catStyles = {
    "Rozmerove ukony":{icon:"\uD83D\uDD27",color:"#2196F3"},
    "TPMS":{icon:"\uD83D\uDCE1",color:"#9C27B0"},
    "Vyvazeni":{icon:"\u2696",color:"#4CAF50"},
    "Manipulace":{icon:"\uD83D\uDCE6",color:"#607D8B"},
    "Olej a filtry":{icon:"\uD83D\uDEE2",color:"#FF9800"},
    "Brzdy":{icon:"\u26D4",color:"#F44336"},
    "Klimatizace R134a":{icon:"\u2744",color:"#00BCD4"},
    "Kontrola pred koupi":{icon:"\uD83D\uDD0D",color:"#795548"},
    "Cisteni interieru":{icon:"\uD83D\uDEBF",color:"#E91E63"},
    "Testy":{icon:"\uD83D\uDCCA",color:"#3F51B5"},
    "Ostatni":{icon:"\u2699",color:"#455A64"},
  };

  function step1() {
    const opts = [];
    if (Object.keys(rozmerove).length) {
      const allP = Object.values(rozmerove).flatMap(d => Object.values(d));
      const style = catStyles["Rozmerove ukony"] || {};
      opts.push({
        label:'Rozmerove ukony',
        sublabel:`od ${Math.min(...allP)} Kc\nDemontaz, montaz disku/pneu`,
        color:style.color, icon:style.icon,
        value:{ type:'rozmerove' },
      });
    }
    for (const [catName, catItems] of Object.entries(pevne)) {
      const style = catStyles[catName] || {icon:'\u2699',color:'#607D8B'};
      const prices = catItems.filter(it => it.price > 0).map(it => it.price);
      opts.push({
        label: catName,
        sublabel: prices.length ? `od ${Math.min(...prices)} Kc` : '',
        color: style.color, icon: style.icon,
        value: { type:'pevne', catName },
      });
    }
    wizardTileSelect('DILCI UKONY', 'Vyberte kategorii sluzby', opts, false, v => {
      if (v.type === 'rozmerove') step2rozmerovy();
      else step2pevny(v.catName);
    });
  }

  function step2rozmerovy() {
    const colors = ["#1abc9c","#3498db","#9b59b6","#e67e22","#e74c3c"];
    const opts = Object.entries(rozmerove).map(([ukon, sizes], i) => {
      const allP = Object.values(sizes);
      const sizeKeys = Object.keys(sizes);
      return {
        label: ukon,
        sublabel: `od ${Math.min(...allP)} Kc\n${sizeKeys[0]}-${sizeKeys[sizeKeys.length-1]}`,
        color: colors[i % colors.length], icon: '',
        value: ukon,
      };
    });
    wizardTileSelect('ROZMEROVE UKONY', 'Vyberte ukon', opts, false, ukon => step3rozmer(ukon));
  }

  function step3rozmer(ukon) {
    const sizes = rozmerove[ukon];
    const sizeColors = ["#1abc9c","#3498db","#9b59b6","#e67e22","#e74c3c","#2c3e50","#16a085"];
    const opts = Object.entries(sizes).map(([sz, price], i) => ({
      label: sz, sublabel: `${price} Kc`,
      color: sizeColors[i % sizeColors.length], icon: '',
      value: { sz, price },
    }));
    wizardTileSelect(`ROZMER - ${ukon}`, 'Zvolte rozmer kola', opts, true, v => step4suv(ukon, v.sz, v.price));
  }

  function step4suv(ukon, sz, basePrice) {
    const suvPrice = basePrice * suvMult;
    const opts = [
      { label:'OSOBNI VUZ', sublabel:`${basePrice} Kc`, color:'#27ae60', icon:'\uD83D\uDE97', value:false },
      { label:'SUV/VAN/EV/RF', sublabel:`x${suvMult} = ${suvPrice} Kc`, color:'#e67e22', icon:'\uD83D\uDE98', value:true },
    ];
    wizardTileSelect('TYP VOZIDLA', `${ukon} | ${sz}`, opts, true, isSuv => {
      const finalPrice = isSuv ? suvPrice : basePrice;
      const veh = isSuv ? 'SUV/VAN/EV/RF' : 'Osobni';
      customItems.push({ name:`${ukon} | ${sz} | ${veh}`, price:finalPrice, qty:1, detail:'' });
      renderCart();
    });
  }

  function step2pevny(catName) {
    const items = pevne[catName] || [];
    const colors = ["#1abc9c","#3498db","#9b59b6","#e67e22","#e74c3c","#27ae60","#2c3e50","#16a085"];
    const opts = items.map((item, i) => ({
      label: item.name,
      sublabel: item.price < 0 ? `${item.price} Kc (sleva)` : `${item.price} Kc`,
      color: colors[i % colors.length], icon: '',
      value: item,
    }));
    const catColor = (catStyles[catName] || {}).color || '#607D8B';
    const catIcon = (catStyles[catName] || {}).icon || '';
    wizardTileSelect(catName.toUpperCase(), 'Vyberte sluzbu', opts, false, v => {
      customItems.push({ name: v.name, price: v.price, qty: 1, detail: catName });
      renderCart();
    }, {
      source: `dilci:${catName}`,
      getPin: (opt) => ({ name: opt.value.name, price: opt.value.price, icon: '', color: catColor })
    });
  }

  step1();
}

// ---------------------------------------------------------------------------
// Custom Wizard - pruchod stromem (scitani cen)
// ---------------------------------------------------------------------------
function runCustomWizard(wiz) {
  // Persistent overlay pro cely wizard
  let wizOverlay = null;

  const formScreen = wiz.formScreen || 0; // 0 = na konci, 1+ = cislo obrazovky
  const collectedFormData = {};  // { fieldLabel: value }

  function showMultiplyInput(node, accumulated, path) {
    if (wizOverlay) wizOverlay.remove();
    const unit = node.unit || 'ks';
    const unitPrice = node.price;

    const div = document.createElement('div');
    div.innerHTML = `
      <h2 style="text-align:center;margin-bottom:12px;">${node.label}</h2>
      <div style="text-align:center;font-size:14px;color:var(--text-muted);margin-bottom:16px;">
        Cena: ${unitPrice} Kc / ${unit}
      </div>
      <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:16px;">
        <button class="btn btn-red qty-minus" style="font-size:24px;width:50px;height:50px;border-radius:50%;">−</button>
        <input type="number" id="qty-input" value="1" min="1" style="
          font-size:32px;font-weight:700;text-align:center;width:120px;padding:10px;
          border-radius:8px;border:2px solid #444;background:#16213e;color:#fff;">
        <span style="font-size:18px;color:var(--text-muted);">${unit}</span>
        <button class="btn btn-green qty-plus" style="font-size:24px;width:50px;height:50px;border-radius:50%;">+</button>
      </div>
      <div id="qty-total" style="text-align:center;font-size:22px;font-weight:700;color:var(--accent-yellow);margin-bottom:16px;">
        Celkem: ${unitPrice} Kc
      </div>
      <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:8px;">
        <button class="btn qty-preset" data-val="10" style="background:#3498db;font-size:14px;padding:8px 14px;">10</button>
        <button class="btn qty-preset" data-val="50" style="background:#3498db;font-size:14px;padding:8px 14px;">50</button>
        <button class="btn qty-preset" data-val="100" style="background:#3498db;font-size:14px;padding:8px 14px;">100</button>
        <button class="btn qty-preset" data-val="200" style="background:#3498db;font-size:14px;padding:8px 14px;">200</button>
        <button class="btn qty-preset" data-val="500" style="background:#3498db;font-size:14px;padding:8px 14px;">500</button>
      </div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
        <button class="btn btn-green qty-ok" style="padding:14px 40px;font-size:16px;">PRIDAT DO KOSIKU</button>
        <button class="btn btn-red qty-cancel" style="padding:14px 20px;font-size:14px;">ZRUSIT</button>
      </div>
    `;

    const { overlay } = openModal(div);
    wizOverlay = overlay;
    const qtyInput = div.querySelector('#qty-input');
    const totalDiv = div.querySelector('#qty-total');

    function updateTotal() {
      const qty = Math.max(1, parseInt(qtyInput.value) || 1);
      qtyInput.value = qty;
      totalDiv.textContent = `Celkem: ${qty * unitPrice} Kc`;
    }

    div.querySelector('.qty-minus').onclick = () => { qtyInput.value = Math.max(1, (parseInt(qtyInput.value) || 1) - 1); updateTotal(); };
    div.querySelector('.qty-plus').onclick = () => { qtyInput.value = (parseInt(qtyInput.value) || 1) + 1; updateTotal(); };
    qtyInput.oninput = updateTotal;

    div.querySelectorAll('.qty-preset').forEach(btn => {
      btn.onclick = () => { qtyInput.value = btn.dataset.val; updateTotal(); };
    });

    div.querySelector('.qty-cancel').onclick = () => {
      overlay.remove();
      showStep(wiz.tree, [], [], wiz.name, 1);
    };

    div.querySelector('.qty-ok').onclick = () => {
      const qty = Math.max(1, parseInt(qtyInput.value) || 1);
      const totalPrice = qty * unitPrice;
      accumulated.push({ label: `${node.label} ${qty}${unit}`, price: totalPrice });
      finishItem(accumulated, path);
      overlay.remove();
      showStep(wiz.tree, [], [], wiz.name, 1);
    };

    qtyInput.focus();
    qtyInput.select();
  }

  function showStep(node, accumulated, path, title, level) {
    // Pokud existuje predchozi overlay, odstranit
    if (wizOverlay) wizOverlay.remove();

    if (!node.children || !node.children.length) {
      // Listovy uzel s mnozstvim — zobrazit input
      if (node.multiply && node.price) {
        showMultiplyInput(node, accumulated, path);
        return;
      }
      // Listovy uzel — pridat do kosiku a VRATIT se na zacatek
      if (node.price) accumulated.push({ label: node.label, price: node.price });
      finishItem(accumulated, path);
      // Zpet na root pro dalsi vyber
      showStep(wiz.tree, [], [], wiz.name, 1);
      return;
    }

    const colors = ["#1abc9c","#3498db","#9b59b6","#e67e22","#e74c3c","#27ae60","#2c3e50","#16a085","#2196F3","#FF9800"];
    const fields = wiz.fields || [];
    const showFormHere = fields.length > 0 && formScreen === level;

    // Sestavit obsah
    const container = document.createElement('div');
    container.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // Header
    let headerHtml = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0;">
      <h2 style="margin:0">${title}</h2>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-red wiz-cancel" style="font-size:13px;padding:8px 16px;">ZRUSIT</button>
      </div>
    </div>`;

    // Subtitle — pocet polozek v kosiku z tohoto wizardu
    const wizCartCount = customItems.filter(ci => ci._wizId === wiz._runId).length;
    if (wizCartCount > 0) {
      headerHtml += `<div style="text-align:center;color:var(--accent-yellow);font-size:13px;margin-bottom:6px;">V kosiku: ${wizCartCount} polozek z tohoto wizardu</div>`;
    }

    // Inline formular na teto obrazovce
    if (showFormHere) {
      headerHtml += `<div class="wiz-inline-form" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;max-width:700px;margin:0 auto 8px;flex-shrink:0;">`;
      fields.forEach((f, i) => {
        if (f.type === 'checkbox') {
          headerHtml += `<div style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" class="wiz-inline-input" data-idx="${i}"
              ${collectedFormData[f.label] === 'Ano' ? 'checked' : ''}
              style="width:20px;height:20px;cursor:pointer;">
            <label style="font-size:13px;color:var(--text-muted);cursor:pointer;">${f.label}</label>
          </div>`;
        } else {
          headerHtml += `<div style="display:flex;align-items:center;gap:4px;">
            <label style="font-size:13px;color:var(--text-muted);white-space:nowrap;">${f.label}${f.required ? ' *' : ''}:</label>
            <input type="${f.type || 'text'}" class="wiz-inline-input" data-idx="${i}"
              value="${collectedFormData[f.label] || ''}"
              style="padding:6px 8px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;font-size:14px;width:160px;"
              placeholder="${f.label}">
          </div>`;
        }
      });
      headerHtml += `</div>`;
    }

    headerHtml += `<div class="wizard-grid-auto" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;"></div>`;
    container.innerHTML = headerHtml;

    const { overlay, modal } = openModal(container);
    wizOverlay = overlay;
    modal.style.width = '95vw';
    modal.style.height = '95vh';
    modal.style.maxWidth = '100vw';
    modal.style.maxHeight = '100vh';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';

    container.querySelector('.wiz-cancel').onclick = () => { wizOverlay.remove(); wizOverlay = null; };

    const gridWrap = container.querySelector('.wizard-grid-auto');

    // Tile rendering (same as wizardTileSelect)
    requestAnimationFrame(() => {
      const options = node.children;
      const n = options.length;
      const areaW = gridWrap.clientWidth;
      const areaH = gridWrap.clientHeight;
      if (!areaW || !areaH) return;

      let bestCols = 1, bestSize = 0;
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const gap = 10;
        const maxW = (areaW - gap * (cols + 1)) / cols;
        const maxH = (areaH - gap * (rows + 1)) / rows;
        const size = Math.min(maxW, maxH);
        if (size > bestSize) { bestSize = size; bestCols = cols; }
      }

      const cols = bestCols;
      const rows = Math.ceil(n / cols);
      const gap = 10;
      const tileSize = Math.min(200, Math.floor(Math.min(
        (areaW - gap * (cols + 1)) / cols,
        (areaH - gap * (rows + 1)) / rows
      )));

      // Najit nejdelsi label pro urceni fontu (stejny algoritmus jako wizardTileSelect)
      const hasIcons = options.some(c => !!(c.icon));
      const maxLblLen = Math.max(...options.map(c => (c.label || '').length));
      const tilePadding = 16;
      const availTxtW = tileSize - tilePadding;
      let baseLblSz = hasIcons ? Math.floor(tileSize * 0.15) : Math.floor(tileSize * 0.22);
      const maxLns = hasIcons ? 2 : 3;
      while (baseLblSz > 10 && (maxLblLen * baseLblSz * 0.55) > availTxtW * maxLns) {
        baseLblSz--;
      }
      baseLblSz = Math.max(10, Math.min(baseLblSz, 28));
      const iconSz = Math.min(42, Math.max(16, Math.floor(tileSize * 0.25)));
      const subSz = Math.max(10, Math.floor(baseLblSz * 0.7));

      const grid = document.createElement('div');
      grid.style.cssText = `display:grid; grid-template-columns:repeat(${cols}, ${tileSize}px); grid-template-rows:repeat(${rows}, ${tileSize}px); gap:${gap}px;`;

      for (const child of options) {
        const cLabel = child.label || '';
        const cPrice = child.price || 0;
        const cIcon = child.icon ? iconChar(child.icon) : '';
        const hasIcon = !!cIcon;
        const cSub = cPrice ? `${cPrice} Kc` : (child.children && child.children.length ? `${child.children.length} moznosti` : '');
        if (child.multiply && cPrice) {
          // Zobrazit jednotkovou cenu
        }

        const tile = document.createElement('div');
        const tileColor = child.color || colors[options.indexOf(child) % colors.length];
        tile.style.cssText = `
          background:${tileColor}; border-radius:12px;
          display:flex; flex-direction:column; align-items:center; justify-content:center;
          cursor:pointer; padding:8px; text-align:center; overflow:hidden;
          transition:transform 0.1s; position:relative;
        `;

        // Hvezdicka pro pripnuti — na vsechny dlazdice (ne multiply)
        const canPin = !child.multiply;
        const pinSource = `custom:${wiz.name}`;
        const accTotal = accumulated.reduce((s, a) => s + a.price, 0) + cPrice;
        const pinName = cLabel;
        const pinPrice = accTotal > 0 ? accTotal : cPrice;
        let starHtml = '';
        if (canPin) {
          const pinned = isPinned(pinSource, pinName);
          starHtml = `<div class="pin-star" style="position:absolute;top:4px;right:6px;font-size:16px;cursor:pointer;z-index:10;opacity:${pinned ? '1' : '0.4'};">${pinned ? '⭐' : '☆'}</div>`;
        }

        tile.innerHTML = `
          ${starHtml}
          ${hasIcon ? `<div style="font-size:${iconSz}px;margin-bottom:4px;line-height:1;">${cIcon}</div>` : ''}
          <div style="font-size:${baseLblSz}px;font-weight:700;line-height:1.2;word-break:break-word;">${cLabel}</div>
          ${cSub ? `<div style="font-size:${subSz}px;color:#e0e0e0;margin-top:4px;font-weight:700;">${child.multiply ? cPrice + ' Kc/' + (child.unit||'ks') : cSub}</div>` : ''}
        `;

        // Klik na hvezdicku
        const starEl = tile.querySelector('.pin-star');
        if (starEl) {
          starEl.onclick = (e) => {
            e.stopPropagation();
            togglePin(pinSource, pinName, pinPrice, child.icon || wiz.icon, tileColor);
            const nowPinned = isPinned(pinSource, pinName);
            starEl.textContent = nowPinned ? '⭐' : '☆';
            starEl.style.opacity = nowPinned ? '1' : '0.4';
          };
        }

        tile.onpointerdown = () => { tile.style.transform = 'scale(0.95)'; };
        tile.onpointerup = () => { tile.style.transform = ''; };
        tile.onpointerleave = () => { tile.style.transform = ''; };
        tile.onclick = () => {
          // Sebrat inline formular pokud je na teto obrazovce
          if (showFormHere && !collectInlineForm(container)) return;

          const newPath = [...path, cLabel];
          const newAcc = [...accumulated];

          // Mnozstvi — zobrazit input
          if (child.multiply && cPrice && (!child.children || !child.children.length)) {
            showMultiplyInput(child, newAcc, newPath);
            return;
          }

          if (cPrice) newAcc.push({ label: cLabel, price: cPrice });

          if (child.children && child.children.length && !child.final) {
            showStep(child, newAcc, newPath, cLabel, level + 1);
          } else {
            if (child.final) {
              // Koncove — zobrazit formular, podpis, protokol, zavrit wizard
              showEndForm(() => {
                finishItem(newAcc, newPath);
                if (wizOverlay) { wizOverlay.remove(); wizOverlay = null; }

                function afterSignature(sigDataUrl) {
                  if (wiz.protocol) {
                    const protoItems = newAcc.map(a => ({ name: a.label, price: a.price }));
                    generateProtocolPDF(wiz.name, protoItems, collectedFormData, sigDataUrl).then(({ doc, protoNo }) => {
                      showProtocol(doc, protoNo);
                    });
                  }
                }

                if (wiz.signature) {
                  showSignaturePad((sigDataUrl) => afterSignature(sigDataUrl));
                } else {
                  afterSignature(null);
                }
              });
            } else {
              // Pridat do kosiku a zpet na root
              finishItem(newAcc, newPath);
              showStep(wiz.tree, [], [], wiz.name, 1);
            }
          }
        };
        grid.appendChild(tile);
      }
      gridWrap.appendChild(grid);
    });
  }

  // Sebere data z inline formulare na aktualni obrazovce
  function collectInlineForm(container) {
    const fields = wiz.fields || [];
    const inputs = container.querySelectorAll('.wiz-inline-input');
    for (const inp of inputs) {
      const idx = parseInt(inp.dataset.idx);
      const f = fields[idx];
      if (inp.type === 'checkbox') {
        collectedFormData[f.label] = inp.checked ? 'Ano' : 'Ne';
      } else {
        const val = inp.value.trim();
        if (f.required && !val) {
          alert(`Vyplnte pole: ${f.label}`);
          inp.focus();
          return false;
        }
        if (val) collectedFormData[f.label] = val;
      }
    }
    return true;
  }

  // Zobrazi formular na konci wizardu (pokud formScreen=0 a jsou pole)
  function showEndForm(onDone) {
    const fields = wiz.fields || [];
    // Pokud formular je na konkretni obrazovce (ne na konci), nebo neni zadny, rovnou done
    if (formScreen !== 0 || !fields.length) {
      applyFormData();
      onDone();
      return;
    }

    const div = document.createElement('div');
    div.innerHTML = `<h2 style="text-align:center;margin-bottom:16px;">${wiz.name} - Udaje</h2>`;

    const formDiv = document.createElement('div');
    formDiv.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;max-width:700px;margin:0 auto;';

    fields.forEach((f, i) => {
      if (f.type === 'checkbox') {
        formDiv.innerHTML += `
          <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
            <input type="checkbox" class="wiz-form-input" data-idx="${i}"
              ${collectedFormData[f.label] === 'Ano' ? 'checked' : ''}
              style="width:22px;height:22px;cursor:pointer;">
            <label style="font-size:15px;color:var(--text-muted);cursor:pointer;">${f.label}</label>
          </div>`;
      } else {
        formDiv.innerHTML += `
          <div style="margin-bottom:12px;">
            <label style="display:block;font-size:13px;color:var(--text-muted);margin-bottom:4px;">${f.label}${f.required ? ' *' : ''}:</label>
            <input type="${f.type || 'text'}" class="wiz-form-input" data-idx="${i}"
              value="${collectedFormData[f.label] || ''}"
              style="width:100%;padding:10px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;font-size:16px;"
              placeholder="${f.label}">
          </div>`;
      }
    });

    formDiv.innerHTML += `
      <div style="grid-column:1/-1;display:flex;gap:10px;justify-content:center;margin-top:8px;">
        <button class="btn btn-green wiz-form-ok" style="padding:12px 30px;font-size:15px;">POTVRDIT</button>
        <button class="btn btn-red wiz-form-cancel" style="padding:12px 20px;font-size:15px;">ZPET</button>
      </div>`;

    div.appendChild(formDiv);
    const { overlay } = openModal(div);

    div.querySelector('.wiz-form-cancel').onclick = () => overlay.remove();
    div.querySelector('.wiz-form-ok').onclick = () => {
      const inputs = div.querySelectorAll('.wiz-form-input');
      for (const inp of inputs) {
        const idx = parseInt(inp.dataset.idx);
        const f = fields[idx];
        if (inp.type === 'checkbox') {
          collectedFormData[f.label] = inp.checked ? 'Ano' : 'Ne';
        } else {
          const val = inp.value.trim();
          if (f.required && !val) {
            alert(`Vyplnte pole: ${f.label}`);
            inp.focus();
            return;
          }
          if (val) collectedFormData[f.label] = val;
        }
      }
      applyFormData();
      overlay.remove();
      onDone();
    };
  }

  function applyFormData() {
    // Ulozit formData ke vsem polozkam z tohoto wizardu
    for (const ci of customItems) {
      if (ci._wizId === wiz._runId) ci.formData = { ...collectedFormData };
    }
    wiz._formData = { ...collectedFormData };
  }

  function finishItem(accumulated, path) {
    const totalPrice = accumulated.reduce((s, a) => s + a.price, 0);
    const nameParts = [wiz.name, ...path];
    let detail = accumulated.map(a => `${a.label}: ${a.price} Kc`).join(', ');
    // Pridat formularova data do detailu
    const fieldEntries = Object.entries(collectedFormData);
    if (fieldEntries.length) {
      detail += (detail ? ' | ' : '') + fieldEntries.map(([k,v]) => `${k}: ${v}`).join(', ');
    }
    customItems.push({
      name: nameParts.join(' | '),
      price: totalPrice,
      qty: 1,
      detail,
      _wizId: wiz._runId,
      formData: { ...collectedFormData },
    });
    renderCart();
  }

  // Unikatni ID pro tuto session wizardu
  wiz._runId = Date.now();
  showStep(wiz.tree, [], [], wiz.name, 1);
}

// ---------------------------------------------------------------------------
// Dokonceni objednavky
// ---------------------------------------------------------------------------
function showFinishDialog() {
  if (!Object.keys(cart).length && !customItems.length) {
    alert('Pridejte nejprve sluzby do kosiku.');
    return;
  }

  const total = getTotal();
  // VS = rok (2 cifry) + poradove cislo z counteru
  const vsCounter = parseInt(localStorage.getItem('vs_counter') || '0') + 1;
  localStorage.setItem('vs_counter', vsCounter);
  const vs = `${new Date().getFullYear() % 100}${String(vsCounter).padStart(6, '0')}`;

  const div = document.createElement('div');
  div.className = 'finish-dialog';
  div.style.cssText = 'max-height:90vh;overflow-y:auto;';
  div.innerHTML = `
    <h2 style="margin:0 0 6px;">DOKONCENI OBJEDNAVKY</h2>
    <div style="font-size:18px;font-weight:700;color:var(--accent-red);margin:6px 0;">Celkova castka: ${total} Kc</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">VS: ${vs}</div>
    <div style="margin:8px 0;">
      <label style="font-size:14px;">SPZ vozidla:</label>
      <input type="text" id="finish-spz" value="${currentSpz}" maxlength="10" autocapitalize="characters" style="text-transform:uppercase;">
    </div>
    <div>
      <label><input type="checkbox" id="finish-print" checked> Vygenerovat fakturu (PDF)</label>
    </div>
    <div style="margin:8px 0;">
      <div style="font-size:13px;margin-bottom:4px;">QR kod pro platbu:</div>
      <div style="display:flex;justify-content:center;">
        <div id="finish-qr" style="background:#fff;padding:8px;border-radius:8px;display:inline-block;max-width:180px;max-height:180px;overflow:hidden;"></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);font-style:italic;margin-top:4px;">(naskenujte v bankovni aplikaci)</div>
      <div id="finish-spayd-debug" style="font-size:10px;color:#666;margin-top:6px;word-break:break-all;"></div>
    </div>
    <button class="btn btn-green" id="finish-confirm" style="font-size:16px;padding:12px 40px;margin-top:6px;">POTVRDIT</button>
  `;

  const { overlay } = openModal(div);

  // QR - generovat s SPZ ve zprave
  const qrDiv = div.querySelector('#finish-qr');
  const debugDiv = div.querySelector('#finish-spayd-debug');

  function regenerateQR() {
    const spz = div.querySelector('#finish-spz').value.trim().toUpperCase();
    const msg = spz ? `Pneuservis ${spz}` : 'Pneuservis';
    const spayd = generateSpayd(
      settings.banka_iban || '', total,
      settings.mena || 'CZK', msg, vs
    );
    qrDiv.innerHTML = '';
    debugDiv.textContent = spayd;
    if (typeof QRCode !== 'undefined') {
      new QRCode(qrDiv, {
        text: spayd, width: 150, height: 150,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
      // Omezit velikost vygenerovaneho obrazku
      const img = qrDiv.querySelector('img');
      if (img) { img.style.maxWidth = '150px'; img.style.maxHeight = '150px'; }
      const canvas = qrDiv.querySelector('canvas');
      if (canvas) { canvas.style.maxWidth = '150px'; canvas.style.maxHeight = '150px'; }
    }
  }

  regenerateQR();
  div.querySelector('#finish-spz').addEventListener('input', regenerateQR);

  div.querySelector('#finish-confirm').onclick = async () => {
    const spz = div.querySelector('#finish-spz').value.trim().toUpperCase();
    if (!spz) { alert('Zadejte prosim SPZ vozidla.'); return; }

    const doPrint = div.querySelector('#finish-print').checked;

    // Pripravit polozky
    const items = [];
    for (const ci of customItems) {
      items.push({ name: ci.name, price: ci.price, qty: ci.qty });
    }
    for (const [idx, qty] of Object.entries(cart)) {
      items.push({ name: services[idx].name, price: services[idx].price, qty });
    }

    let invoiceNo = '';
    if (doPrint) {
      invoiceNo = await generateInvoicePDF(spz, total, items);
    }

    // Ulozit zakazku
    const order = {
      datum: nowStr(),
      spz,
      polozky: items,
      celkem: total,
      faktura: invoiceNo,
      stav: 'dokoncena',
      _backed_up: false,
    };
    const orderId = await db.addOrder(order);
    order.id = orderId;

    // Zalohovat na GitHub (async, nezdrzuje UI)
    backupOrderToGitHub(order).then(() => {
      if (order._backed_up && order.id) {
        const tx = db._db.transaction('orders', 'readwrite');
        tx.objectStore('orders').put(order);
      }
    });

    clearCart();
    closeModal(overlay);
    alert(`Objednavka pro ${spz} byla dokoncena!`);
  };
}

// ---------------------------------------------------------------------------
// PDF generovani (jsPDF)
// ---------------------------------------------------------------------------
async function generateInvoicePDF(spz, total, items) {
  const invoiceNo = await nextInvoiceNumber();
  const s = settings;
  const today = todayStr();
  const due = dueStr();
  const dphRate = s.dph_sazba || 21;
  const zaklad = total / (1 + dphRate / 100);
  const dph = total - zaklad;

  // jsPDF
  const doc = createPDF();

  // Hlavicka
  doc.setFontSize(20);
  doc.text('FAKTURA', 105, 20, { align: 'center' });
  doc.setFontSize(11);
  doc.text(`Číslo: ${invoiceNo}`, 105, 28, { align: 'center' });

  // Dodavatel / Odberatel
  let y = 40;
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.text('Dodavatel:', 14, y);
  doc.text('Odběratel:', 110, y);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  y += 7;
  doc.text(s.firma || '', 14, y);
  doc.text(`SPZ: ${spz}`, 110, y);
  y += 6;
  doc.text(`ICO: ${s.ico || ''}`, 14, y);
  y += 6;
  doc.text(`DIC: ${s.dic || ''}`, 14, y);
  y += 6;
  doc.text(s.adresa || '', 14, y);
  y += 6;
  doc.text(`Tel: ${s.telefon || ''}`, 14, y);
  y += 10;

  // Datumy
  doc.text(`Datum vystavení: ${today}`, 14, y);
  doc.text(`Datum splatnosti: ${due}`, 100, y);
  y += 10;

  // Tabulka
  doc.setFillColor(52, 73, 94);
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, 'bold');
  doc.setFontSize(10);
  doc.rect(14, y, 182, 8, 'F');
  doc.text('#', 17, y + 6);
  doc.text('Služba', 25, y + 6);
  doc.text('Počet', 120, y + 6);
  doc.text('Cena/ks', 142, y + 6);
  doc.text('Celkem', 172, y + 6);
  y += 10;

  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  items.forEach((item, i) => {
    if (y > 260) { doc.addPage(); y = 20; }
    doc.text(String(i + 1), 17, y + 5);
    doc.text(item.name.substring(0, 45), 25, y + 5);
    doc.text(String(item.qty), 125, y + 5);
    doc.text(`${item.price} Kč`, 145, y + 5);
    doc.text(`${item.price * item.qty} Kč`, 175, y + 5);
    doc.rect(14, y, 182, 7);
    y += 7;
  });

  y += 5;
  doc.setFontSize(10);
  doc.text(`Základ daně: ${Math.round(zaklad)} Kč`, 196, y, { align: 'right' });
  y += 6;
  doc.text(`DPH ${dphRate}%: ${Math.round(dph)} Kč`, 196, y, { align: 'right' });
  y += 8;
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.text(`CELKEM K ÚHRADĚ: ${total} Kč`, 196, y, { align: 'right' });
  y += 10;

  // Bankovni udaje
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(`IBAN: ${s.banka_iban || ''}`, 14, y);
  y += 6;
  doc.text(`BIC/SWIFT: ${s.banka_bic || ''}`, 14, y);
  y += 10;

  // QR do PDF
  const spayd = generateSpayd(
    s.banka_iban || '', total, s.mena || 'CZK',
    `Faktura ${invoiceNo}`,
    invoiceNo.replace('FA-', '').replace(/-/g, '')
  );
  try {
    const qrCanvas = document.createElement('canvas');
    // Use QRCode library to generate on a canvas element
    const tempDiv = document.createElement('div');
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);
    await new Promise(resolve => {
      new QRCode(tempDiv, {
        text: spayd, width: 256, height: 256,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
      setTimeout(resolve, 100);
    });
    const qrImg = tempDiv.querySelector('canvas');
    if (qrImg) {
      doc.setFont(undefined, 'bold');
      doc.text('QR platba:', 14, y);
      y += 3;
      doc.addImage(qrImg.toDataURL(), 'PNG', 14, y, 40, 40);
      y += 45;
    }
    tempDiv.remove();
  } catch (e) { /* QR se nepodarilo */ }

  // Paticka
  doc.setFont(undefined, 'italic');
  doc.setFontSize(8);
  doc.text('Děkujeme za Vaši důvěru. Tento doklad byl vygenerován elektronicky.', 105, 285, { align: 'center' });

  // Ulozit do IndexedDB a stahnout
  const pdfBlob = doc.output('blob');
  const filename = `${invoiceNo}_${spz}.pdf`;
  await db.saveInvoice(filename, pdfBlob);

  // Stahnout / otevrit
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return invoiceNo;
}

// ---------------------------------------------------------------------------
// Evidence zakazek
// ---------------------------------------------------------------------------
async function showOrders() {
  const orders = await db.getOrders();
  const div = document.createElement('div');
  div.innerHTML = `
    <h2>EVIDENCE ZAKAZEK</h2>
    <div style="margin-bottom:10px;">
      <input type="text" id="orders-filter" placeholder="Hledat SPZ..." style="padding:8px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;font-size:14px;width:200px;">
    </div>
    <div style="max-height:55vh;overflow-y:auto;">
      <table class="orders-table">
        <thead><tr><th>Datum</th><th>SPZ</th><th>Sluzby</th><th>Celkem</th><th>Faktura</th><th>Stav</th></tr></thead>
        <tbody id="orders-tbody"></tbody>
      </table>
    </div>
    <div id="order-detail" style="margin-top:12px;padding:10px;background:#16213e;border-radius:8px;color:var(--text-muted);font-size:12px;">Kliknete na zakazku pro detail</div>
  `;

  const { overlay } = openModal(div, 'admin-modal');

  function renderOrders(filter) {
    const tbody = div.querySelector('#orders-tbody');
    tbody.innerHTML = '';
    const ft = (filter || '').toUpperCase();
    for (const o of orders) {
      if (ft && !(o.spz || '').toUpperCase().includes(ft)) continue;
      const polStr = (o.polozky || []).map(p => `${p.name} x${p.qty}`).join(', ');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${o.datum||''}</td><td>${o.spz||''}</td><td>${polStr}</td><td>${o.celkem||0} Kc</td><td>${o.faktura||'-'}</td><td>${o.stav||''}</td>`;
      tr.onclick = () => {
        const lines = [`Datum: ${o.datum}  SPZ: ${o.spz}  Faktura: ${o.faktura||'-'}  Stav: ${o.stav}`,
          `Celkem: ${o.celkem} Kc`, 'Polozky:'];
        for (const p of (o.polozky||[])) {
          lines.push(`  - ${p.name} x${p.qty} @ ${p.price} Kc = ${p.price*p.qty} Kc`);
        }
        div.querySelector('#order-detail').textContent = lines.join('\n');
        div.querySelector('#order-detail').style.whiteSpace = 'pre-wrap';
        div.querySelector('#order-detail').style.color = '#fff';
      };
      tbody.appendChild(tr);
    }
  }
  renderOrders('');
  div.querySelector('#orders-filter').oninput = e => renderOrders(e.target.value);
}

// ---------------------------------------------------------------------------
// Historie faktur
// ---------------------------------------------------------------------------
async function showInvoices() {
  const ids = await db.getAllInvoiceIds();
  const div = document.createElement('div');
  div.innerHTML = `<h2>HISTORIE FAKTUR</h2>`;

  if (!ids.length) {
    div.innerHTML += '<p style="text-align:center;color:var(--text-muted);">Zadne faktury</p>';
  } else {
    const list = document.createElement('div');
    list.style.maxHeight = '60vh';
    list.style.overflowY = 'auto';
    for (const id of ids.reverse()) {
      const btn = document.createElement('div');
      btn.className = 'cart-item';
      btn.innerHTML = `<span class="cart-item-name">${id}</span><span class="cart-item-price">PDF</span>`;
      btn.onclick = async () => {
        const rec = await db.getInvoice(id);
        if (rec && rec.blob) {
          const url = URL.createObjectURL(rec.blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
      };
      list.appendChild(btn);
    }
    div.appendChild(list);
  }

  openModal(div);
}

// ---------------------------------------------------------------------------
// Administrace
// ---------------------------------------------------------------------------
async function showAdmin() {
  const storedHash = settings.admin_password_hash || '';

  if (!storedHash) {
    // Nastavit heslo
    const pwd = prompt('Nastavte heslo pro administraci:');
    if (!pwd) return;
    const pwd2 = prompt('Zopakujte heslo:');
    if (pwd !== pwd2) { alert('Hesla se neshoduji!'); return; }
    settings.admin_password_hash = await hashPassword(pwd);
    await db.setKV('settings', settings);
    openAdminPanel();
    return;
  }

  const pwd = prompt('Zadejte heslo pro administraci:');
  if (!pwd) return;
  const h = await hashPassword(pwd);
  if (h !== storedHash) { alert('Spatne heslo!'); return; }
  openAdminPanel();
}

function openAdminPanel() {
  const div = document.createElement('div');
  div.innerHTML = `
    <h2>ADMINISTRACE</h2>
    <div class="admin-tabs">
      <button class="admin-tab active" data-tab="wizards">Wizardy</button>
      <button class="admin-tab" data-tab="firm">Udaje firmy</button>
      <button class="admin-tab" data-tab="pricing">Ceniky prezuti</button>
      <button class="admin-tab" data-tab="orders">Zakazky</button>
      <button class="admin-tab" data-tab="invoices">Faktury</button>
      <button class="admin-tab" data-tab="blank_protocol">Prazdny protokol</button>
      <button class="admin-tab" data-tab="password">Zmena hesla</button>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin:8px 0;">
      <button class="btn btn-red" id="btn-revert-github" style="font-size:13px;padding:8px 16px;">⏪ VRATIT POSLEDNI ZMENU</button>
      <button class="btn btn-blue" id="btn-save-local" style="font-size:15px;padding:10px 24px;">ULOZIT</button>
      <button class="btn btn-green" id="btn-push-github" style="font-size:15px;padding:10px 24px;">APLIKOVAT NA GITHUB</button>
    </div>
    <div class="admin-content" id="admin-content"></div>
  `;

  const { overlay, modal } = openModal(div, 'admin-modal');

  const tabs = div.querySelectorAll('.admin-tab');
  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderAdminTab(tab.dataset.tab, div.querySelector('#admin-content'), overlay);
    };
  });

  renderAdminTab('wizards', div.querySelector('#admin-content'), overlay);

  div.querySelector('#btn-revert-github').onclick = async () => {
    const btn = div.querySelector('#btn-revert-github');
    btn.disabled = true;
    const ok = await revertConfigOnGitHub();
    if (ok) {
      btn.textContent = 'VRACENO ✓';
      setTimeout(() => { btn.textContent = '⏪ VRATIT POSLEDNI ZMENU'; btn.disabled = false; }, 3000);
    } else {
      btn.disabled = false;
    }
  };
  div.querySelector('#btn-save-local').onclick = async () => {
    const btn = div.querySelector('#btn-save-local');
    btn.disabled = true;
    await Promise.all([
      db.setKV('services', services),
      db.setKV('settings', settings),
      db.setKV('pricing', pricing),
      db.setKV('customWizards', customWizards),
      db.setKV('pinnedItems', pinnedItems),
    ]);
    renderTiles();
    btn.textContent = 'ULOZENO ✓';
    setTimeout(() => { btn.textContent = 'ULOZIT'; btn.disabled = false; }, 2000);
  };
  div.querySelector('#btn-push-github').onclick = async () => {
    const btn = div.querySelector('#btn-push-github');
    btn.textContent = 'UKLADAM...';
    btn.disabled = true;
    const ok = await pushConfigToGitHub();
    if (ok) {
      btn.textContent = 'ULOZENO ✓';
      btn.style.background = '#27ae60';
      setTimeout(() => { btn.textContent = 'APLIKOVAT NA GITHUB'; btn.disabled = false; }, 3000);
    } else {
      btn.textContent = 'APLIKOVAT NA GITHUB';
      btn.disabled = false;
    }
  };
}

function renderAdminTab(tabName, container, overlay) {
  container.innerHTML = '';
  if (tabName === 'firm') renderAdminFirm(container);
  else if (tabName === 'pricing') renderAdminPricing(container);
  else if (tabName === 'wizards') renderAdminWizards(container);
  else if (tabName === 'orders') renderAdminOrders(container);
  else if (tabName === 'invoices') renderAdminInvoices(container);
  else if (tabName === 'blank_protocol') renderAdminBlankProtocol(container);
  else if (tabName === 'password') renderAdminPassword(container);
}

function renderAdminFirm(container) {
  const fields = [
    ['Nazev firmy','firma'],['ICO','ico'],['DIC','dic'],
    ['Adresa','adresa'],['Telefon','telefon'],['Email','email'],
    ['IBAN (banka)','banka_iban'],['BIC/SWIFT','banka_bic'],
    ['Mena','mena'],['Sazba DPH (%)','dph_sazba'],
    ['URL kamery','camera_url'],
  ];

  let html = '<div style="max-width:500px;margin:0 auto;">';
  for (const [label, key] of fields) {
    html += `<div class="admin-field"><label>${label}:</label><input type="text" id="firm-${key}" value="${settings[key] || ''}"></div>`;
  }
  html += `<button class="btn btn-green" id="firm-save" style="margin-top:12px;">ULOZIT UDAJE</button></div>`;
  container.innerHTML = html;

  container.querySelector('#firm-save').onclick = async () => {
    for (const [, key] of fields) {
      let val = container.querySelector(`#firm-${key}`).value.trim();
      if (key === 'dph_sazba') val = parseInt(val) || 21;
      settings[key] = val;
    }
    await db.setKV('settings', settings);
    alert('Udaje firmy ulozeny.');
  };
}

function renderAdminPricing(container) {
  let html = '<div style="max-height:55vh;overflow-y:auto;padding:5px;">';
  html += '<h3>Priplatky a slevy</h3>';

  const extras = [
    ['Priplatek SUV/VAN/EV (Kc)', 'priplatek_suv'],
    ['Sleva bez vyvazeni', 'sleva_bez_vyvazeni'],
    ['Sleva pneu od nas', 'sleva_pneu_od_nas'],
  ];
  for (const [label, key] of extras) {
    html += `<div class="admin-field" style="display:inline-block;margin-right:20px;"><label>${label}:</label><input type="number" id="px-${key}" value="${pricing[key] || 0}" style="width:100px;"></div>`;
  }

  for (const [cenikKey, cenikTitle] of [['komplet','Kompletni prezuti 4ks'],['sada','Prezuti sada za sadu']]) {
    html += `<h3 style="margin-top:14px;">${cenikTitle}</h3>`;
    const cenikData = pricing[cenikKey] || {};
    for (const [typName, sizes] of Object.entries(cenikData)) {
      html += `<div style="color:#3498db;font-weight:700;margin:8px 0 4px;">${typName.replace(/\n/g,' / ')}</div><div>`;
      for (const [sz, price] of Object.entries(sizes)) {
        const id = `px-${cenikKey}-${typName}-${sz}`.replace(/[^a-zA-Z0-9-]/g, '_');
        html += `<span style="display:inline-block;margin-right:12px;"><label style="font-size:12px;">${sz}:</label> <input type="number" id="${id}" value="${price}" style="width:80px;"> Kc</span>`;
      }
      html += '</div>';
    }
  }

  html += `<button class="btn btn-green" id="px-save" style="margin-top:16px;">ULOZIT CENIKY</button>`;
  html += '</div>';
  container.innerHTML = html;

  container.querySelector('#px-save').onclick = async () => {
    for (const [, key] of extras) {
      pricing[key] = parseInt(container.querySelector(`#px-${key}`).value) || 0;
    }
    for (const cenikKey of ['komplet','sada']) {
      const cenikData = pricing[cenikKey] || {};
      for (const [typName, sizes] of Object.entries(cenikData)) {
        for (const sz of Object.keys(sizes)) {
          const id = `px-${cenikKey}-${typName}-${sz}`.replace(/[^a-zA-Z0-9-]/g, '_');
          const el = container.querySelector(`#${id}`);
          if (el) pricing[cenikKey][typName][sz] = parseInt(el.value) || 0;
        }
      }
    }
    await db.setKV('pricing', pricing);
    renderTiles();
    alert('Ceniky ulozeny.');
  };
}

// ---------------------------------------------------------------------------
// Admin: Vlastni wizardy (stromovy editor)
// ---------------------------------------------------------------------------
// Stav sbaleni uzlu stromu (persistuje mezi renderovani)
const _treeCollapsed = new Set();

function renderAdminWizards(container) {
  let selectedWizIdx = -1;

  function render() {
    container.innerHTML = `
      <div style="display:flex;gap:16px;height:100%;">
        <div style="width:250px;flex-shrink:0;">
          <div style="font-weight:700;margin-bottom:6px;">Vlastni wizardy:</div>
          <div class="admin-svc-list" id="wiz-list" style="max-height:300px;"></div>
          <div style="margin-top:10px;display:flex;gap:6px;">
            <button class="btn btn-blue" id="wiz-add">+ Novy wizard</button>
            <button class="btn btn-red" id="wiz-del">Smazat</button>
          </div>
        </div>
        <div style="flex:1;overflow-y:auto;max-height:55vh;" id="wiz-editor">
          <div style="color:var(--text-muted);text-align:center;padding:40px;">Vyberte wizard nebo vytvorte novy</div>
        </div>
      </div>
    `;

    // Naplnit seznam
    const list = container.querySelector('#wiz-list');
    customWizards.forEach((wiz, i) => {
      const el = document.createElement('div');
      el.className = 'admin-svc-item' + (i === selectedWizIdx ? ' selected' : '');
      el.textContent = `${iconChar(wiz.icon)} ${wiz.name}`;
      el.onclick = () => { selectedWizIdx = i; render(); };
      list.appendChild(el);
    });

    // Novy wizard
    container.querySelector('#wiz-add').onclick = () => {
      customWizards.push({
        name: 'Novy wizard',
        icon: 'default',
        color: '#607D8B',
        tree: { label: 'Hlavni', children: [] }
      });
      selectedWizIdx = customWizards.length - 1;
      saveAndRender();
    };

    // Smazat
    container.querySelector('#wiz-del').onclick = () => {
      if (selectedWizIdx < 0) return;
      if (!confirm(`Smazat wizard '${customWizards[selectedWizIdx].name}'?`)) return;
      customWizards.splice(selectedWizIdx, 1);
      selectedWizIdx = -1;
      saveAndRender();
    };

    // Editor vybraneho wizardu
    if (selectedWizIdx >= 0 && selectedWizIdx < customWizards.length) {
      renderWizardEditor(container.querySelector('#wiz-editor'), customWizards[selectedWizIdx]);
    }
  }

  async function saveAndRender() {
    await db.setKV('customWizards', customWizards);
    renderTiles();
    const editor = container.querySelector('#wiz-editor');
    const scrollTop = editor ? editor.scrollTop : 0;
    render();
    requestAnimationFrame(() => {
      const editorAfter = container.querySelector('#wiz-editor');
      if (editorAfter) editorAfter.scrollTop = scrollTop;
    });
  }

  function renderWizardEditor(editorDiv, wiz) {
    editorDiv.innerHTML = '';

    // Hlavicka wizardu
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom:16px;padding:12px;background:#16213e;border-radius:8px;';
    header.innerHTML = `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <div class="admin-field" style="margin:0;"><label>Nazev dlazdice:</label><input type="text" id="wiz-name" value="${wiz.name}" style="width:180px;"></div>
        <div class="admin-field" style="margin:0;"><label>Cena (text na dlazdici):</label><input type="text" id="wiz-price-label" value="${wiz.priceLabel || ''}" placeholder="napr. od 800 Kc" style="width:140px;"></div>
        <div class="admin-field" style="margin:0;"><label>Barva:</label><input type="color" id="wiz-color" value="${wiz.color}" style="width:50px;height:34px;"></div>
        <div class="admin-field" style="margin:0;">
          <label>Ikona:</label>
          <select id="wiz-icon" style="width:120px;">
            ${Object.entries(SERVICE_ICONS).map(([k,v]) => `<option value="${k}" ${k===wiz.icon?'selected':''}>${v} ${k}</option>`).join('')}
          </select>
        </div>
        <label style="font-size:12px;color:#27ae60;cursor:pointer;display:flex;align-items:center;gap:4px;">
          <input type="checkbox" id="wiz-protocol" ${wiz.protocol?'checked':''}> Predavaci protokol
        </label>
        <label style="font-size:12px;color:#3498db;cursor:pointer;display:flex;align-items:center;gap:4px;">
          <input type="checkbox" id="wiz-signature" ${wiz.signature?'checked':''}> Podpis klienta
        </label>
        <button class="btn btn-green" id="wiz-save-header">Ulozit</button>
      </div>
    `;
    editorDiv.appendChild(header);

    header.querySelector('#wiz-save-header').onclick = async () => {
      wiz.name = header.querySelector('#wiz-name').value.trim() || 'Wizard';
      wiz.priceLabel = header.querySelector('#wiz-price-label').value.trim();
      wiz.protocol = header.querySelector('#wiz-protocol').checked;
      wiz.signature = header.querySelector('#wiz-signature').checked;
      wiz.color = header.querySelector('#wiz-color').value;
      wiz.icon = header.querySelector('#wiz-icon').value;
      await saveAndRender();
    };

    // Formularova pole wizardu (zobrazi se na konci pri dokonceni)
    if (!wiz.fields) wiz.fields = [];
    const fieldsBox = document.createElement('div');
    fieldsBox.style.cssText = 'margin-bottom:16px;padding:12px;background:#1a1a3e;border-radius:8px;border:1px solid #FF9800;';
    // Zjistit max hloubku stromu
    function getMaxDepth(node, d) { if (!node.children || !node.children.length) return d; return Math.max(...node.children.map(c => getMaxDepth(c, d + 1))); }
    const maxDepth = getMaxDepth(wiz.tree, 0);
    const screenOpts = ['<option value="0"' + ((wiz.formScreen||0)===0?' selected':'') + '>Na konci (pri dokonceni)</option>'];
    for (let s = 1; s <= Math.max(maxDepth, 3); s++) {
      screenOpts.push(`<option value="${s}" ${(wiz.formScreen||0)===s?'selected':''}>${s}. obrazovka</option>`);
    }

    fieldsBox.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font-weight:700;color:#FF9800;">Formular wizardu:</span>
        <label style="font-size:12px;color:var(--text-muted);">Zobrazit na:</label>
        <select id="wiz-form-screen" style="padding:4px;border-radius:4px;border:1px solid #444;background:#16213e;color:#fff;font-size:12px;">
          ${screenOpts.join('')}
        </select>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">Pole se zobrazi na vybrane obrazovce. Data se ulozi k objednavce.</div>
      <div id="wiz-fields-list"></div>
      <button class="btn btn-blue" id="wiz-add-field" style="margin-top:8px;font-size:12px;padding:6px 14px;">+ Pridat pole</button>`;
    editorDiv.appendChild(fieldsBox);

    function renderFields() {
      const list = fieldsBox.querySelector('#wiz-fields-list');
      list.innerHTML = '';
      wiz.fields.forEach((f, i) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;';
        row.innerHTML = `
          <input type="text" value="${f.label || ''}" placeholder="Nazev pole" class="wf-label" style="width:150px;padding:4px;border-radius:4px;border:1px solid #444;background:#16213e;color:#fff;font-size:12px;">
          <select class="wf-type" style="padding:4px;border-radius:4px;border:1px solid #444;background:#16213e;color:#fff;font-size:12px;">
            <option value="text" ${f.type==='text'?'selected':''}>Text</option>
            <option value="number" ${f.type==='number'?'selected':''}>Cislo</option>
            <option value="tel" ${f.type==='tel'?'selected':''}>Telefon</option>
            <option value="checkbox" ${f.type==='checkbox'?'selected':''}>Checkbox</option>
          </select>
          <label style="font-size:11px;color:#aaa;cursor:pointer;display:flex;align-items:center;gap:3px;">
            <input type="checkbox" class="wf-req" ${f.required?'checked':''}>Povinne
          </label>
          <button style="background:#555;border:none;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;font-weight:700;" class="wf-up" title="Nahoru">▲</button>
          <button style="background:#555;border:none;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;font-weight:700;" class="wf-down" title="Dolu">▼</button>
          <button style="background:#e74c3c;border:none;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;font-weight:700;" class="wf-del">X</button>
        `;
        row.querySelector('.wf-label').onchange = (e) => { f.label = e.target.value; saveAndRenderQuiet(); };
        row.querySelector('.wf-type').onchange = (e) => { f.type = e.target.value; saveAndRenderQuiet(); };
        row.querySelector('.wf-req').onchange = (e) => { f.required = e.target.checked; saveAndRenderQuiet(); };
        row.querySelector('.wf-up').onclick = () => { if (i > 0) { [wiz.fields[i-1], wiz.fields[i]] = [wiz.fields[i], wiz.fields[i-1]]; saveFields(); } };
        row.querySelector('.wf-down').onclick = () => { if (i < wiz.fields.length-1) { [wiz.fields[i], wiz.fields[i+1]] = [wiz.fields[i+1], wiz.fields[i]]; saveFields(); } };
        row.querySelector('.wf-del').onclick = () => { wiz.fields.splice(i, 1); saveFields(); };
        list.appendChild(row);
      });
    }

    async function saveFields() {
      await db.setKV('customWizards', customWizards);
      renderFields();
    }

    fieldsBox.querySelector('#wiz-form-screen').onchange = async (e) => {
      wiz.formScreen = parseInt(e.target.value) || 0;
      await db.setKV('customWizards', customWizards);
    };

    fieldsBox.querySelector('#wiz-add-field').onclick = () => {
      wiz.fields.push({ label: '', type: 'text', required: false });
      saveFields();
    };

    renderFields();

    // Strom - root je neviditelny, rovnou zobrazime prvni uroven
    const treeTitle = document.createElement('div');
    treeTitle.style.cssText = 'font-weight:700;margin-bottom:4px;';
    treeTitle.textContent = '1. obrazovka (po kliknuti na dlazdici):';
    editorDiv.appendChild(treeTitle);

    const treeHint = document.createElement('div');
    treeHint.style.cssText = 'font-size:12px;color:var(--text-muted);margin-bottom:10px;';
    treeHint.textContent = 'Kazda polozka = dlazdice. Pokud ma poduzly → otevre dalsi obrazovku. Pokud nema → prida cenu do kosiku.';
    editorDiv.appendChild(treeHint);

    // Tlacitko pridat na prvni uroven
    const addRootBtn = document.createElement('button');
    addRootBtn.className = 'btn btn-blue';
    addRootBtn.style.cssText = 'margin-bottom:12px;';
    addRootBtn.textContent = '+ Pridat dlazdici na 1. obrazovku';
    addRootBtn.onclick = () => {
      if (!wiz.tree.children) wiz.tree.children = [];
      wiz.tree.children.push({ label: '', price: 0, icon: '', color: '#2196F3', children: [] });
      saveAndRender();
    };
    editorDiv.appendChild(addRootBtn);

    const treeDiv = document.createElement('div');
    treeDiv.className = 'tree-builder';
    editorDiv.appendChild(treeDiv);

    // Defaultne sbalit vsechny uzly s detmi (pokud jeste nemaji stav)
    function collapseAll(node, wizName, parentIdx, level) {
      if (node.children && node.children.length) {
        node.children.forEach((child, i) => {
          if (child.children && child.children.length) {
            const nodeId = `${wizName}_${i}_${level}_${child.label}`;
            if (!_treeCollapsed._initialized || !_treeCollapsed._initialized.has(nodeId)) {
              _treeCollapsed.add(nodeId);
            }
            collapseAll(child, wizName, i, level + 1);
          }
        });
      }
    }
    if (!_treeCollapsed._initialized) _treeCollapsed._initialized = new Set();
    collapseAll(wiz.tree, wiz.name, 0, 1);

    // Rovnou zobrazime deti korenoveho uzlu
    if (wiz.tree.children && wiz.tree.children.length) {
      wiz.tree.children.forEach((child, i) => {
        renderTreeNode(treeDiv, child, wiz.tree, i, wiz, 1);
      });
    }
  }

  function renderTreeNode(parentEl, node, parentNode, parentChildIdx, wiz, level) {
    const div = document.createElement('div');
    div.className = 'tree-node';
    div.style.borderLeftColor = node.color || '#2196F3';

    const hasChildren = node.children && node.children.length > 0;
    const levelLabel = level || 1;
    const typeHint = hasChildren ? `→ otevre ${levelLabel+1}. obrazovku` : (node.price ? `→ prida ${node.price} Kc do kosiku` : '→ koncovy uzel');
    const nodeId = `${wiz.name}_${parentChildIdx}_${levelLabel}_${node.label}`;
    const isCollapsed = _treeCollapsed.has(nodeId);
    const toggleIcon = hasChildren ? (isCollapsed ? '▶' : '▼') : '•';
    const childCount = hasChildren ? ` (${node.children.length})` : '';

    div.innerHTML = `
      <div class="tree-node-header">
        <span class="node-toggle" style="font-size:12px;cursor:${hasChildren?'pointer':'default'};min-width:16px;user-select:none;color:${hasChildren?'#fff':'#555'};" title="${hasChildren?'Rozbalit/sbalit':''}">${toggleIcon}</span>
        <span style="font-size:10px;color:#888;min-width:20px;">${levelLabel}.</span>
        <input type="text" value="${node.label || ''}" placeholder="Nazev dlazdice" class="node-label">
        <input type="number" value="${node.price || 0}" placeholder="Cena" class="node-price" style="width:80px;" title="Cena pri kliknuti (scita se)">
        <span style="font-size:11px;color:var(--text-muted);">Kc</span>
        <select class="node-icon" style="width:80px;">
          <option value="">--</option>
          ${Object.entries(SERVICE_ICONS).map(([k,v]) => `<option value="${k}" ${k===node.icon?'selected':''}>${v}</option>`).join('')}
        </select>
        <input type="color" value="${node.color || '#2196F3'}" class="node-color" style="width:36px;height:30px;">
        <label style="font-size:11px;color:#f39c12;cursor:pointer;display:flex;align-items:center;gap:3px;" title="Po kliknuti ukonci wizard a prida do kosiku">
          <input type="checkbox" class="node-final" ${node.final?'checked':''}> Koncove
        </label>
        <label style="font-size:11px;color:#1abc9c;cursor:pointer;display:flex;align-items:center;gap:3px;" title="Pta se na mnozstvi a vynasobi cenu">
          <input type="checkbox" class="node-multiply" ${node.multiply?'checked':''}> Mnozstvi
        </label>
        ${node.multiply ? `<input type="text" value="${node.unit || 'ks'}" placeholder="Jednotka" class="node-unit" style="width:40px;" title="napr. ks, g, ml">` : ''}
        <div class="tree-node-actions">
          <button style="background:#555;" class="node-up" title="Posunout nahoru">▲</button>
          <button style="background:#555;" class="node-down" title="Posunout dolu">▼</button>
          <button style="background:#2196F3;" class="node-add-child" title="Pridat podmoznost (dalsi obrazovka)">+ Poduzl</button>
          <button style="background:#e74c3c;" class="node-remove" title="Smazat">X</button>
        </div>
        <span style="font-size:10px;color:#888;font-style:italic;">${typeHint}${node.final ? ' | KONCI wizard' : ''}${childCount}</span>
      </div>
    `;

    // Toggle rozbalit/sbalit
    const toggleEl = div.querySelector('.node-toggle');
    if (hasChildren) {
      toggleEl.onclick = () => {
        if (!_treeCollapsed._initialized) _treeCollapsed._initialized = new Set();
        _treeCollapsed._initialized.add(nodeId);
        if (_treeCollapsed.has(nodeId)) {
          _treeCollapsed.delete(nodeId);
        } else {
          _treeCollapsed.add(nodeId);
        }
        saveAndRender();
      };
    }

    // Auto-save pri zmene
    const labelInput = div.querySelector('.node-label');
    const priceInput = div.querySelector('.node-price');
    const iconSelect = div.querySelector('.node-icon');
    const colorInput = div.querySelector('.node-color');

    function syncNode() {
      node.label = labelInput.value;
      node.price = parseInt(priceInput.value) || 0;
      node.icon = iconSelect.value || '';
      node.color = colorInput.value;
    }

    const finalCheck = div.querySelector('.node-final');

    labelInput.onchange = () => { syncNode(); saveAndRenderQuiet(); };
    priceInput.onchange = () => { syncNode(); saveAndRenderQuiet(); };
    iconSelect.onchange = () => { syncNode(); saveAndRenderQuiet(); };
    colorInput.onchange = () => { syncNode(); saveAndRenderQuiet(); };
    finalCheck.onchange = () => { node.final = finalCheck.checked; saveAndRender(); };
    const multiplyCheck = div.querySelector('.node-multiply');
    multiplyCheck.onchange = () => { node.multiply = multiplyCheck.checked; if (!node.unit) node.unit = 'ks'; saveAndRender(); };
    const unitInput = div.querySelector('.node-unit');
    if (unitInput) unitInput.onchange = () => { node.unit = unitInput.value.trim() || 'ks'; saveAndRenderQuiet(); };

    // Posun nahoru/dolu
    div.querySelector('.node-up').onclick = () => {
      if (!parentNode || !parentNode.children || parentChildIdx <= 0) return;
      const arr = parentNode.children;
      [arr[parentChildIdx - 1], arr[parentChildIdx]] = [arr[parentChildIdx], arr[parentChildIdx - 1]];
      saveAndRender();
    };
    div.querySelector('.node-down').onclick = () => {
      if (!parentNode || !parentNode.children || parentChildIdx >= parentNode.children.length - 1) return;
      const arr = parentNode.children;
      [arr[parentChildIdx], arr[parentChildIdx + 1]] = [arr[parentChildIdx + 1], arr[parentChildIdx]];
      saveAndRender();
    };

    // Pridat potomka
    div.querySelector('.node-add-child').onclick = () => {
      if (!node.children) node.children = [];
      node.children.push({ label: '', price: 0, icon: '', color: '#2196F3', children: [] });
      saveAndRender();
    };

    // Smazat
    div.querySelector('.node-remove').onclick = () => {
      if (parentNode && parentNode.children) {
        parentNode.children.splice(parentChildIdx, 1);
        saveAndRender();
      }
    };

    parentEl.appendChild(div);

    // Deti — jen pokud neni sbaleny
    if (node.children && node.children.length && !isCollapsed) {
      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'tree-children';
      div.appendChild(childrenDiv);
      node.children.forEach((child, i) => {
        renderTreeNode(childrenDiv, child, node, i, wiz, (level || 1) + 1);
      });
    }
  }

  async function saveAndRenderQuiet() {
    await db.setKV('customWizards', customWizards);
    renderTiles();
  }

  render();
}

async function renderAdminOrders(container) {
  const orders = await db.getOrders();
  container.innerHTML = `
    <div style="margin-bottom:10px;">
      <input type="text" id="orders-filter" placeholder="Hledat SPZ..." style="padding:8px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;font-size:14px;width:200px;">
    </div>
    <div style="max-height:55vh;overflow-y:auto;">
      <table class="orders-table">
        <thead><tr><th>Datum</th><th>SPZ</th><th>Sluzby</th><th>Celkem</th><th>Faktura</th><th>Stav</th></tr></thead>
        <tbody id="orders-tbody"></tbody>
      </table>
    </div>
    <div id="order-detail" style="margin-top:12px;padding:10px;background:#16213e;border-radius:8px;color:var(--text-muted);font-size:12px;">Kliknete na zakazku pro detail</div>
  `;
  function renderOrders(filter) {
    const tbody = container.querySelector('#orders-tbody');
    tbody.innerHTML = '';
    const ft = (filter || '').toUpperCase();
    for (const o of orders) {
      if (ft && !(o.spz || '').toUpperCase().includes(ft)) continue;
      const polStr = (o.polozky || []).map(p => `${p.name} x${p.qty}`).join(', ');
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${o.datum||''}</td><td>${o.spz||''}</td><td>${polStr}</td><td>${o.celkem||0} Kc</td><td>${o.faktura||'-'}</td><td>${o.stav||''}</td>`;
      tr.onclick = () => {
        const lines = [`Datum: ${o.datum}  SPZ: ${o.spz}  Faktura: ${o.faktura||'-'}  Stav: ${o.stav}`,
          `Celkem: ${o.celkem} Kc`, 'Polozky:'];
        for (const p of (o.polozky||[])) {
          lines.push(`  - ${p.name} x${p.qty} @ ${p.price} Kc = ${p.price*p.qty} Kc`);
        }
        const det = container.querySelector('#order-detail');
        det.textContent = lines.join('\n');
        det.style.whiteSpace = 'pre-wrap';
        det.style.color = '#fff';
      };
      tbody.appendChild(tr);
    }
  }
  renderOrders('');
  container.querySelector('#orders-filter').oninput = e => renderOrders(e.target.value);
}

async function renderAdminInvoices(container) {
  const ids = await db.getAllInvoiceIds();
  if (!ids.length) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">Zadne faktury</p>';
    return;
  }
  const list = document.createElement('div');
  list.style.maxHeight = '60vh';
  list.style.overflowY = 'auto';
  for (const id of ids.reverse()) {
    const btn = document.createElement('div');
    btn.className = 'cart-item';
    btn.innerHTML = `<span class="cart-item-name">${id}</span><span class="cart-item-price">PDF</span>`;
    btn.onclick = async () => {
      const rec = await db.getInvoice(id);
      if (rec && rec.blob) {
        const url = URL.createObjectURL(rec.blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    };
    list.appendChild(btn);
  }
  container.appendChild(list);
}

function renderAdminBlankProtocol(container) {
  container.innerHTML = `
    <h3 style="margin-bottom:16px;">Tisk prazdneho predavaciho protokolu</h3>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
      <label style="font-size:14px;">Pocet kopii:</label>
      <button class="btn btn-red" id="bp-minus" style="width:40px;height:40px;font-size:20px;border-radius:50%;">−</button>
      <input type="number" id="bp-copies" value="1" min="1" max="50"
        style="width:70px;text-align:center;font-size:20px;font-weight:700;padding:8px;border-radius:6px;border:1px solid #444;background:#16213e;color:#fff;">
      <button class="btn btn-green" id="bp-plus" style="width:40px;height:40px;font-size:20px;border-radius:50%;">+</button>
    </div>
    <button class="btn btn-green" id="bp-print" style="font-size:16px;padding:12px 30px;">VYTISKNOUT</button>
  `;

  const copiesInput = container.querySelector('#bp-copies');
  container.querySelector('#bp-minus').onclick = () => { copiesInput.value = Math.max(1, (parseInt(copiesInput.value) || 1) - 1); };
  container.querySelector('#bp-plus').onclick = () => { copiesInput.value = (parseInt(copiesInput.value) || 1) + 1; };

  container.querySelector('#bp-print').onclick = async () => {
    const copies = Math.max(1, parseInt(copiesInput.value) || 1);
    const s = settings;
    const doc = createPDF();

    for (let c = 0; c < copies; c++) {
      if (c > 0) doc.addPage();

      const today = todayStr();

      // Hlavicka
      doc.setFont(undefined, 'bold');
      doc.setFontSize(18);
      doc.text('PŘEDÁVACÍ PROTOKOL', 14, 20);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(11);
      doc.text('Uskladnění kol / pneu', 14, 28);
      doc.setFontSize(10);
      doc.text(`Datum: ${today}`, 14, 36);

      let y = 50;

      // Provozovatel
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.text('Provozovatel:', 14, y);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      y += 7;
      doc.text(s.firma || '', 14, y); y += 6;
      doc.text(`IČO: ${s.ico || ''}  DIČ: ${s.dic || ''}`, 14, y); y += 6;
      doc.text(s.adresa || '', 14, y); y += 6;
      doc.text(`Tel: ${s.telefon || ''}  Email: ${s.email || ''}`, 14, y); y += 14;

      // Zakaznik — prazdne radky k vyplneni
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.text('Zákazník:', 14, y);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      y += 8;
      const custFields = ['Jméno a příjmení', 'Adresa', 'Telefon', 'Email', 'SPZ'];
      for (const label of custFields) {
        doc.text(`${label}:`, 14, y);
        doc.line(55, y, 196, y);
        y += 8;
      }
      y += 6;

      // Predmet uskladneni
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.text('Předmět uskladnění:', 14, y);
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      y += 8;
      const descFields = ['Pneumatiky (rozměr, značka)', 'Disky (typ)', 'Stav (hloubka vzorku)', 'Počet kusů', 'Poznámka'];
      for (const label of descFields) {
        doc.text(`${label}:`, 14, y);
        doc.line(70, y, 196, y);
        y += 8;
      }
      y += 8;

      // Cenik — prazdna tabulka
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.text('Ceník:', 14, y);
      y += 8;

      doc.setFillColor(52, 73, 94);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.rect(14, y, 182, 8, 'F');
      doc.text('#', 17, y + 6);
      doc.text('Popis', 25, y + 6);
      doc.text('Cena', 172, y + 6);
      y += 10;

      doc.setTextColor(0, 0, 0);
      doc.setFont(undefined, 'normal');
      for (let r = 0; r < 5; r++) {
        doc.text(String(r + 1), 17, y + 5);
        doc.rect(14, y, 182, 7);
        y += 7;
      }

      y += 5;
      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.text('Celkem:', 140, y);
      doc.line(160, y, 196, y);
      y += 14;

      // Podpisy
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      doc.text('Předávající (zákazník):', 14, y);
      doc.text('Přebírající (servis):', 110, y);
      y += 30;
      doc.line(14, y, 85, y);
      doc.line(110, y, 196, y);
      y += 5;
      doc.setFontSize(9);
      doc.text('Podpis', 45, y, { align: 'center' });
      doc.text('Podpis', 150, y, { align: 'center' });

      // Paticka
      doc.setFont(undefined, 'italic');
      doc.setFontSize(8);
      doc.text(`${s.firma || ''} | ${s.adresa || ''} | Tel: ${s.telefon || ''}`, 105, 285, { align: 'center' });
    }

    // Otevrit PDF
    const pdfBlob = doc.output('blob');
    const url = URL.createObjectURL(pdfBlob);
    const win = window.open(url, '_blank');
    if (win) { win.onload = () => { win.print(); }; }
  };
}

function renderAdminPassword(container) {
  container.innerHTML = `
    <div style="max-width:350px;margin:0 auto;text-align:center;">
      <h3>Zmena hesla administrace</h3>
      <div class="admin-field"><label>Nove heslo:</label><input type="password" id="pw1"></div>
      <div class="admin-field"><label>Zopakujte heslo:</label><input type="password" id="pw2"></div>
      <button class="btn btn-red" id="pw-save">ZMENIT HESLO</button>
    </div>
  `;
  container.querySelector('#pw-save').onclick = async () => {
    const p1 = container.querySelector('#pw1').value;
    const p2 = container.querySelector('#pw2').value;
    if (!p1) { alert('Heslo nesmi byt prazdne!'); return; }
    if (p1 !== p2) { alert('Hesla se neshoduji!'); return; }
    settings.admin_password_hash = await hashPassword(p1);
    await db.setKV('settings', settings);
    alert('Heslo zmeneno.');
  };
}

// ---------------------------------------------------------------------------
// Kamera (pro tablet)
// ---------------------------------------------------------------------------
async function capturePhoto() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const video = document.createElement('video');
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();

    const div = document.createElement('div');
    div.style.textAlign = 'center';
    div.innerHTML = `
      <h2>FOTKA SPZ</h2>
      <div id="cam-video-wrap" style="margin:10px auto;max-width:640px;"></div>
      <div style="margin-top:12px;">
        <button class="btn btn-green" id="cam-snap" style="font-size:16px;padding:12px 30px;">VYFOTIT</button>
        <button class="btn btn-red" id="cam-cancel" style="font-size:14px;padding:10px 20px;margin-left:10px;">ZRUSIT</button>
      </div>
    `;

    const { overlay } = openModal(div);
    div.querySelector('#cam-video-wrap').appendChild(video);
    video.style.width = '100%';
    video.style.borderRadius = '8px';

    div.querySelector('#cam-cancel').onclick = () => {
      stream.getTracks().forEach(t => t.stop());
      overlay.remove();
    };

    div.querySelector('#cam-snap').onclick = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      photoDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      stream.getTracks().forEach(t => t.stop());
      overlay.remove();

      // Zobrazit thumbnail
      const photoArea = document.getElementById('photo-area');
      photoArea.innerHTML = `<img src="${photoDataUrl}" onclick="showFullPhoto()"><div id="photo-status">Foto ulozeno (klik pro zvetseni)</div>`;
    };
  } catch (err) {
    alert('Kamera neni dostupna: ' + err.message);
  }
}

function showFullPhoto() {
  if (!photoDataUrl) return;
  const div = document.createElement('div');
  div.style.textAlign = 'center';
  div.innerHTML = `<h2>Fotka SPZ</h2><img src="${photoDataUrl}" style="max-width:90vw;max-height:70vh;border-radius:8px;">`;
  if (currentSpz) div.innerHTML += `<div style="font-size:20px;font-weight:700;color:var(--accent-yellow);margin-top:10px;">SPZ: ${currentSpz}</div>`;
  openModal(div);
}

// ---------------------------------------------------------------------------
// Inicializace
// ---------------------------------------------------------------------------
async function init() {
  await db.open();

  // Nacist konfiguraci:
  // 1) Zkusit stahnout config.json z GitHubu (jeden zdroj pravdy)
  // 2) Pokud neni internet (offline tablet), pouzit IndexedDB cache
  // 3) Pokud neni ani cache, pouzit vychozi defaulty
  let configLoaded = false;
  try {
    const resp = await fetch(`https://raw.githubusercontent.com/${GITHUB_REPO}/master/${GITHUB_CONFIG_PATH}?v=${Date.now()}`);
    if (resp.ok) {
      const cfg = await resp.json();
      services = cfg.services || DEFAULT_SERVICES;
      settings = cfg.settings || DEFAULT_SETTINGS;
      pricing  = cfg.pricing || DEFAULT_PRICING;
      customWizards = cfg.customWizards || [];
      pinnedItems = cfg.pinnedItems || [];
      configLoaded = true;
      // Ulozit do IndexedDB jako offline cache
      await Promise.all([
        db.setKV('services', services),
        db.setKV('settings', settings),
        db.setKV('pricing', pricing),
        db.setKV('customWizards', customWizards),
        db.setKV('pinnedItems', pinnedItems),
      ]);
    }
  } catch(e) { /* offline nebo chyba site */ }

  if (!configLoaded) {
    // Offline fallback — pouzit IndexedDB cache
    services = await db.getKV('services', DEFAULT_SERVICES);
    settings = await db.getKV('settings', DEFAULT_SETTINGS);
    pricing  = await db.getKV('pricing', DEFAULT_PRICING);
    customWizards = await db.getKV('customWizards', []);
    pinnedItems = await db.getKV('pinnedItems', []);
  }

  // Nacist fonty pro PDF
  try {
    const [regBuf, boldBuf] = await Promise.all([
      fetch('./lib/Roboto-Regular.ttf').then(r => r.arrayBuffer()),
      fetch('./lib/Roboto-Bold.ttf').then(r => r.arrayBuffer()),
    ]);
    // Prevest na base64
    function bufToBase64(buf) {
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 4096) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
      }
      return btoa(binary);
    }
    window._pdfFontRegular = bufToBase64(regBuf);
    window._pdfFontBold = bufToBase64(boldBuf);
    pdfFontLoaded = true;
  } catch(e) { console.warn('Fonty se nepodarilo nacist:', e); }

  renderTiles();
  renderCart();

  // Dozalohovat nezalohovane objednavky (offline fronta)
  backupPendingOrders();

  // Event listenery
  document.getElementById('btn-clear-cart').onclick = clearCart;
  document.getElementById('btn-custom-item').onclick = showCustomItemDialog;
  document.getElementById('btn-finish').onclick = showFinishDialog;
  document.getElementById('btn-admin').onclick = showAdmin;
  document.getElementById('btn-camera').onclick = capturePhoto;
  document.getElementById('btn-update').onclick = async () => {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    window.location.reload();
  };

  // Service Worker — pouze registrace, zadna automaticka aktualizace
  // Aktualizace probiha jen po kliknuti na tlacitko aktualizace
  if ('serviceWorker' in navigator) {
    await navigator.serviceWorker.register('./sw.js').catch(() => null);
  }
}

document.addEventListener('DOMContentLoaded', init);
