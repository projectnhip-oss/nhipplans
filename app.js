// ===== รายการชีท (แท็บ) ใน Google Sheet ไฟล์เดียวกัน =====
// เพิ่มรอบ/ชีทใหม่: เติมบรรทัดใน SHEETS ด้านล่าง
//   id      = ชื่อสั้นๆ ภาษาอังกฤษ ใช้ใน URL (?sheet=id)
//   label   = ชื่อที่แสดงบนปุ่มแท็บ
//   gid     = เลข gid ของแท็บนั้น (ดูได้จาก URL ตอนเปิดแท็บในชีท: ...#gid=123456789)
//   url     = (ไม่บังคับ) ลิงก์ CSV เต็มของแท็บนั้น ถ้าอยากวางลิงก์เองแทนการประกอบจาก gid
//   columns = (ไม่บังคับ) ถ้าแท็บนี้เรียงคอลัมน์ไม่เหมือนค่าเริ่มต้น ให้ระบุเฉพาะตัวที่ต่าง เช่น { owner: 'B' }
// gid เป็น null = ยังไม่ได้ตั้งค่า ปุ่มจะเป็นสีเทากดไม่ได้
const SHEET_BASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRTvT7TUeM8QPOHtoPpXs-7vuu3_akUB1Gh6MpvuXb-IMkTE_K4bQAiDbNJz5Bptg/pub';
const SHEETS = [
  { id: 'round1',  label: 'แผนการติดตั้งรอบพิเศษ รอบที่ 1', gid: null },
  { id: 'round2',  label: 'แผนการติดตั้งรอบพิเศษ รอบที่ 2', gid: null },
  { id: 'round3',  label: 'แผนการติดตั้งรอบพิเศษ รอบที่ 3', gid: '1867606921' },
  { id: 'pilot12', label: 'นำร่อง เขต 12 (ครุ ก) 102 แห่ง',  gid: '2025024087', columns: {} },
];
const DEFAULT_SHEET_ID = 'round3';

function sheetUrl(sheet){
  if (sheet.url) return sheet.url;
  return `${SHEET_BASE_URL}?gid=${sheet.gid}&single=true&output=csv`;
}
function sheetIsReady(sheet){ return !!(sheet.url || sheet.gid); }

// ชีทที่เลือกอยู่ — อ่านจาก ?sheet=xxx ใน URL ถ้าไม่มีหรือไม่ถูกต้องใช้ค่าเริ่มต้น
function pickInitialSheet(){
  const wanted = new URLSearchParams(location.search).get('sheet');
  const found = SHEETS.find(s => s.id === wanted && sheetIsReady(s));
  return found || SHEETS.find(s => s.id === DEFAULT_SHEET_ID) || SHEETS.find(sheetIsReady);
}
let currentSheet = pickInitialSheet();

const STATUS = { PENDING: 'pending', PROGRESS: 'progress', DONE: 'done', OVERDUE: 'overdue', NOTRANSFER: 'notransfer' };
const STATUS_LABEL = { pending: 'รอดำเนินการ', progress: 'กำลังดำเนินการ', done: 'ดำเนินการแล้ว', overdue: 'เลยกำหนด', notransfer: 'ไม่โอนข้อมูล' };
const STAGES = ['migration','transfer','verify','launch'];
const STAGE_LABEL = { migration:'Migration', transfer:'Transfer', verify:'ตรวจสอบข้อมูล', launch:'ประกาศใช้งาน' };

// ตำแหน่งคอลัมน์ใน Google Sheet (อ้างอิงตามตัวอักษรคอลัมน์ เช่น A, B, ... AA, AB)
// map ตรงตามที่ยืนยันแล้ว ถ้าคอลัมน์ไหนขยับตำแหน่งในชีทจริง แก้ค่าตรงนี้ได้เลย
const DEFAULT_COLUMNS = {
  followUp: 'B',     // ติดตาม (บันทึกการโทรสอบถาม/เหตุผล พิมพ์ข้อความอิสระ)
  owner: 'C',        // ผู้รับผิดชอบ
  readyDate: 'D',     // วันที่พร้อมขึ้นระบบ
  code: 'E',          // รหัสสถานพยาบาล
  org: 'F',           // ชื่อหน่วยงาน
  province: 'G',      // จังหวัด
  region: 'I',        // เขต
  oldProgram: 'K',     // โปรแกรมเดิม
  transferStatus: 'N', // สถานะ (ยืนยันโอนข้อมูล / ไม่โอนข้อมูล / เปลี่ยนรอบ ฯลฯ)
  anydesk: 'W',        // Anydesk (เลข ID อ้างอิง ไม่นับสถานะ)
  migration: 'AA',     // สถานะ Migration
  transfer: 'AB',      // สถานะ Transfer
  verify: 'AC',        // ตรวจสอบข้อมูล
  launch: 'AD',        // ประกาศใช้งาน
  usageStatus: 'AF',   // ขึ้นระบบแล้วไม่ใช้งาน (ใช้งาน / ไม่ใช้งาน / ใช้งานบางวัน)
};

// คอลัมน์ที่ใช้จริงของชีทที่เลือก = ค่าเริ่มต้น + ค่าที่แท็บนั้นระบุทับไว้ (ถ้ามี)
function getColumns(sheet){
  return Object.assign({}, DEFAULT_COLUMNS, (sheet && sheet.columns) || {});
}

// แปลงตัวอักษรคอลัมน์ (A, B, ... Z, AA, AB, ...) เป็นตำแหน่ง index แบบ 0-based
function colLetterToIndex(letters){
  let n = 0;
  for (let i = 0; i < letters.length; i++){
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

// ตัวอย่างข้อมูลสำรอง ใช้เฉพาะตอนดึงจาก Google Sheet ไม่สำเร็จ
const SAMPLE_DATA = [
  { code:'10670', org:'รพ.สต.บ้านหนองบัว', province:'ขอนแก่น', region:'เขต 7', oldProgram:'HOSxP', owner:'สมชาย ใจดี', readyDate:'2569-08-20', anydeskId:'1956633490', migration:'done', transfer:'done', verify:'done', launch:'done', transferStatusKey:'ts-confirm', transferStatusLabel:'ยืนยันโอนข้อมูล' , usageStatusKey:'us-active', usageStatusLabel:'ใช้งาน' },
  { code:'10671', org:'รพ.สต.ท่าพระ', province:'ขอนแก่น', region:'เขต 7', oldProgram:'HOSxP', owner:'สมชาย ใจดี', readyDate:'2569-08-22', anydeskId:'1877203451', migration:'done', transfer:'progress', verify:'pending', launch:'pending', transferStatusKey:'ts-confirm', transferStatusLabel:'ยืนยันโอนข้อมูล' , usageStatusKey:'us-active', usageStatusLabel:'ใช้งาน' },
  { code:'10802', org:'รพ.สต.นาจาน', province:'มหาสารคาม', region:'เขต 7', oldProgram:'JHCIS', owner:'พรทิพย์ วงศ์สุข', readyDate:'2569-08-18', anydeskId:'1023845672', migration:'progress', verify:'pending', transfer:'pending', launch:'pending', transferStatusKey:'ts-none', transferStatusLabel:'ไม่ระบุ' , usageStatusKey:'us-partial', usageStatusLabel:'ใช้งานบางวัน' },
  { code:'10803', org:'รพ.สต.เขวาใหญ่', province:'มหาสารคาม', region:'เขต 7', oldProgram:'JHCIS', owner:'พรทิพย์ วงศ์สุข', readyDate:'2569-08-25', anydeskId:'', migration:'pending', transfer:'pending', verify:'pending', launch:'pending', transferStatusKey:'ts-notransfer', transferStatusLabel:'ไม่โอนข้อมูล' , usageStatusKey:'us-inactive', usageStatusLabel:'ไม่ใช้งาน' },
  { code:'21044', org:'รพ.สต.บางพลี', province:'สมุทรปราการ', region:'เขต 6', oldProgram:'HOSxP', owner:'อรุณี ศรีสุข', readyDate:'2569-09-01', anydeskId:'1665789023', migration:'done', transfer:'done', verify:'progress', launch:'pending', transferStatusKey:'ts-confirm', transferStatusLabel:'ยืนยันโอนข้อมูล' , usageStatusKey:'us-active', usageStatusLabel:'ใช้งาน' },
  { code:'21045', org:'รพ.สต.บางเสาธง', province:'สมุทรปราการ', region:'เขต 6', oldProgram:'HOSxP', owner:'อรุณี ศรีสุข', readyDate:'2569-09-01', anydeskId:'1443298761', migration:'done', transfer:'done', verify:'done', launch:'done', transferStatusKey:'ts-confirm', transferStatusLabel:'ยืนยันโอนข้อมูล' , usageStatusKey:'us-active', usageStatusLabel:'ใช้งาน' },
  { code:'30115', org:'รพ.สต.หนองปลิง', province:'นครราชสีมา', region:'เขต 9', oldProgram:'HOSxP_PCU', owner:'วิชัย รุ่งเรือง', readyDate:'2569-08-30', anydeskId:'', migration:'pending', transfer:'pending', verify:'pending', launch:'pending', transferStatusKey:'ts-notransfer', transferStatusLabel:'ไม่โอนข้อมูล' , usageStatusKey:'us-none', usageStatusLabel:'ไม่ระบุ' },
  { code:'30116', org:'รพ.สต.โคกกรวด', province:'นครราชสีมา', region:'เขต 9', oldProgram:'HOSxP_PCU', owner:'วิชัย รุ่งเรือง', readyDate:'2569-08-30', anydeskId:'1789456123', migration:'progress', transfer:'pending', verify:'pending', launch:'pending', transferStatusKey:'ts-round2', transferStatusLabel:'เปลี่ยนรอบ 2' , usageStatusKey:'us-partial', usageStatusLabel:'ใช้งานบางวัน' },
];

let DATA = [];

// CSV parser ง่ายๆ รองรับ field ที่ครอบด้วย double quote และมี comma/newline อยู่ข้างใน
function parseCSV(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i], next = text[i+1];
    if (inQuotes){
      if (c === '"' && next === '"'){ field += '"'; i++; }
      else if (c === '"'){ inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"'){ inQuotes = true; }
      else if (c === ','){ row.push(field); field = ''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r'){ /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || row.length){ row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim() !== ''));
}

function normalizeStatus(value){
  const v = (value || '').trim();
  if (!v) return STATUS.PENDING;
  if (v.includes('ดำเนินการแล้ว') || v.includes('เสร็จ') || v.toLowerCase() === 'done') return STATUS.DONE;
  if (v.includes('กำลัง') || v.toLowerCase() === 'in progress') return STATUS.PROGRESS;
  if (v.includes('รอ')) return STATUS.PENDING;
  return STATUS.PENDING;
}

// สถานะคอลัมน์ N ในชีท (dropdown: ยืนยันโอนข้อมูล / ไม่โอนข้อมูล / เปลี่ยนรอบ 2 / เปลี่ยนรอบ 3 / สอบถามข้อมูลเพิ่มเติม / ย้ายรอบ 3)
// ใช้แยกกรณี "มีชื่อในระบบแต่ไม่ได้ติดตั้งจริง" ออกจากที่ยืนยันโอนข้อมูลแล้ว
const TRANSFER_STATUS_RULES = [
  { test: v => v.includes('ยืนยัน') && v.includes('โอน'), key: 'ts-confirm' },
  { test: v => v.includes('ไม่โอน'), key: 'ts-notransfer' },
  { test: v => v.includes('เปลี่ยนรอบ 2') || v.includes('เปลี่ยนรอบ2'), key: 'ts-round2' },
  { test: v => v.includes('เปลี่ยนรอบ 3') || v.includes('เปลี่ยนรอบ3'), key: 'ts-round3' },
  { test: v => v.includes('สอบถาม'), key: 'ts-inquiry' },
  { test: v => v.includes('ย้ายรอบ'), key: 'ts-moved' },
];
function classifyTransferStatus(raw){
  const v = (raw || '').trim();
  if (!v) return { key: 'ts-none', label: 'ไม่ระบุ' };
  const found = TRANSFER_STATUS_RULES.find(rule => rule.test(v));
  return { key: found ? found.key : 'ts-other', label: v };
}

// สถานะคอลัมน์ AF: ขึ้นระบบแล้วไม่ใช้งาน (dropdown: ใช้งาน / ไม่ใช้งาน / ใช้งานบางวัน)
function classifyUsageStatus(raw){
  const v = (raw || '').trim();
  if (!v) return { key: 'us-none', label: 'ไม่ระบุ' };
  if (v.includes('ไม่ใช้งาน')) return { key: 'us-inactive', label: 'ไม่ใช้งาน' };
  if (v.includes('บางวัน')) return { key: 'us-partial', label: 'ใช้งานบางวัน' };
  if (v.includes('ใช้งาน')) return { key: 'us-active', label: 'ใช้งาน' };
  return { key: 'us-other', label: v };
}

function csvRowsToData(rows, columns){
  const idx = {};
  Object.keys(columns).forEach(key => {
    idx[key] = colLetterToIndex(columns[key]);
  });
  return rows.slice(1).map(r => {
    const get = key => (r[idx[key]] || '').trim();
    const ts = classifyTransferStatus(get('transferStatus'));
    const us = classifyUsageStatus(get('usageStatus'));
    return {
      code: get('code'),
      org: get('org'),
      province: get('province'),
      region: get('region'),
      oldProgram: get('oldProgram'),
      owner: get('owner'),
      readyDate: get('readyDate'),
      followUp: get('followUp'),
      anydeskId: get('anydesk'),
      migration: normalizeStatus(get('migration')),
      transfer: normalizeStatus(get('transfer')),
      verify: normalizeStatus(get('verify')),
      launch: normalizeStatus(get('launch')),
      transferStatusKey: ts.key,
      transferStatusLabel: ts.label,
      usageStatusKey: us.key,
      usageStatusLabel: us.label,
    };
  }).filter(r => r.code || r.org);
}

function setRefreshing(on){
  const b = document.getElementById('btn-refresh');
  if (!b) return;
  b.disabled = on;
  b.classList.toggle('loading', on);
  b.textContent = on ? '↻ กำลังโหลด...' : '↻ รีเฟรชข้อมูล';
}
function stampLoadTime(){
  document.getElementById('updated-time').textContent = new Date().toLocaleString('th-TH', { dateStyle:'medium', timeStyle:'short' });
}

let loadToken = 0; // กันผลลัพธ์ของการโหลดเก่าที่ช้า มาทับชีทที่เพิ่งสลับไป
async function loadData(){
  const token = ++loadToken;
  setRefreshing(true);
  const sheet = currentSheet;
  const statusEl = document.getElementById('load-status');
  statusEl.classList.remove('error');
  statusEl.textContent = `กำลังโหลดข้อมูล "${sheet.label}"...`;
  let parsed = [], errorMsg = '';
  try {
    const res = await fetch(sheetUrl(sheet), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const rows = parseCSV(text);
    parsed = csvRowsToData(rows, getColumns(sheet));
    if (parsed.length === 0) throw new Error('ไม่พบข้อมูลในชีทนี้');
  } catch (err) {
    parsed = [];
    errorMsg = err.message;
  }
  if (token !== loadToken) return; // ผู้ใช้สลับชีทไปแล้ว ทิ้งผลลัพธ์นี้
  setRefreshing(false);
  const noteEl = document.getElementById('refresh-note');
  noteEl.textContent = errorMsg ? 'โหลดไม่สำเร็จ — ดูรายละเอียดท้ายหน้า' : '';
  noteEl.classList.toggle('error', !!errorMsg);
  if (!errorMsg) stampLoadTime(); // อัปเดตเวลาเฉพาะเมื่อดึงข้อมูลสำเร็จจริง

  DATA = parsed;
  if (errorMsg){
    // ไม่ใช้ข้อมูลตัวอย่างแทน เพราะมีหลายชีท อาจทำให้เข้าใจผิดว่าเป็นข้อมูลจริง
    statusEl.classList.add('error');
    statusEl.textContent = `โหลด "${sheet.label}" ไม่สำเร็จ (${errorMsg}) — ตรวจว่าแท็บนี้ถูก Publish to web แล้ว และ gid ถูกต้อง แล้วกดรีเฟรช`;
  } else {
    statusEl.textContent = `เชื่อมต่อสำเร็จ — ${sheet.label} (${DATA.length} รายการ)`;
  }
  populateFilterOptions();
  MAX_READY_DATE = computeMaxReadyDate();
  updateDateFilterBounds();
  renderKPIs(DATA);
  renderTable(DATA);
  renderOwnerView(DATA);
}

// ===== แท็บเลือกชีท =====
function renderSheetTabs(){
  const box = document.getElementById('sheet-tabs');
  box.innerHTML = '';
  SHEETS.forEach(sheet => {
    const ready = sheetIsReady(sheet);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-tab' + (sheet === currentSheet ? ' active' : '') + (ready ? '' : ' disabled');
    btn.textContent = sheet.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', sheet === currentSheet ? 'true' : 'false');
    if (!ready){
      btn.disabled = true;
      btn.title = 'ยังไม่ได้ตั้งค่า gid ของแท็บนี้';
    } else {
      btn.addEventListener('click', () => switchSheet(sheet.id));
    }
    box.appendChild(btn);
  });
  const nameEl = document.getElementById('sheet-name');
  if (nameEl) nameEl.textContent = currentSheet.label;
}

function resetAllFilters(){
  ['f-region','f-province','f-owner','f-status','f-transfer','f-usage','f-date-from','f-date-to','f-search']
    .forEach(id => { document.getElementById(id).value = ''; });
}

function switchSheet(id){
  const next = SHEETS.find(s => s.id === id && sheetIsReady(s));
  if (!next || next === currentSheet) return;
  currentSheet = next;
  // เก็บชีทที่เลือกไว้ใน URL เพื่อแชร์ลิงก์/รีเฟรชแล้วยังอยู่ชีทเดิม
  const url = new URL(location.href);
  url.searchParams.set('sheet', next.id);
  history.replaceState(null, '', url);
  resetAllFilters(); // ตัวกรองของชีทเก่าอาจไม่มีในชีทใหม่ ล้างก่อนกันข้อมูลหาย
  renderSheetTabs();
  loadData();
}

function overallStatus(row){
  const states = STAGES.map(s => row[s]);
  if (states.every(s => s === 'done')) return STATUS.DONE;
  if (states.every(s => s === 'pending')) return STATUS.PENDING;
  return STATUS.PROGRESS;
}

// ตรวจสอบสถานะ ณ วันที่ (เทียบกับ "วันที่พร้อมขึ้นระบบ" คอลัมน์ D ของแต่ละหน่วยงานเอง) -----
document.getElementById('deadline-input').value = new Date().toISOString().slice(0, 10); // ค่าเริ่มต้น = วันนี้จริง
let REFERENCE_DATE = document.getElementById('deadline-input').value;

// แปลงค่าวันที่จากชีท รองรับได้ทั้ง YYYY-MM-DD และ DD/MM/YYYY และปีแบบ พ.ศ. (แปลงเป็น ค.ศ. อัตโนมัติถ้าปี > 2400)
function parseSheetDate(raw){
  if (!raw) return null;
  const v = raw.trim();
  let m = v.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m){
    let y = +m[1], mo = +m[2], d = +m[3];
    if (y > 2400) y -= 543;
    return new Date(y, mo - 1, d);
  }
  m = v.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m){
    let d = +m[1], mo = +m[2], y = +m[3];
    if (y > 2400) y -= 543;
    return new Date(y, mo - 1, d);
  }
  return null;
}

// หน่วยงานนี้ "เลยกำหนดของตัวเอง" หรือยัง เทียบกับวันที่เลือกไว้ด้านบน (REFERENCE_DATE)
// USE_ROUND_DEADLINE = true → ใช้วันที่มากสุดที่พบในคอลัมน์ D ทั้งชีท (MAX_READY_DATE) เป็นเดดไลน์เดียวรวมของรอบล่าสุด แทนวันของแต่ละแถวเอง
let USE_ROUND_DEADLINE = false;
let MAX_READY_DATE = null;

function computeMaxReadyDate(){
  let max = null;
  DATA.forEach(r => {
    const d = parseSheetDate(r.readyDate);
    if (d && (!max || d > max)) max = d;
  });
  return max;
}
function computeMinReadyDate(){
  let min = null;
  DATA.forEach(r => {
    const d = parseSheetDate(r.readyDate);
    if (d && (!min || d < min)) min = d;
  });
  return min;
}
function toInputDateValue(d){
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function updateDateFilterBounds(){
  const min = computeMinReadyDate(), max = MAX_READY_DATE;
  const fromInput = document.getElementById('f-date-from');
  const toInput = document.getElementById('f-date-to');
  if (min){ fromInput.min = toInputDateValue(min); toInput.min = toInputDateValue(min); }
  if (max){ fromInput.max = toInputDateValue(max); toInput.max = toInputDateValue(max); }
}
function formatDateObj(d){
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function isOverdue(row){
  const due = USE_ROUND_DEADLINE ? MAX_READY_DATE : parseSheetDate(row.readyDate);
  if (!due) return false; // ไม่มีวันที่ให้เทียบ ไม่สามารถระบุได้ว่าเลยกำหนด
  const dueEndOfDay = new Date(due.getFullYear(), due.getMonth(), due.getDate(), 23, 59, 59);
  const ref = new Date(REFERENCE_DATE + 'T23:59:59');
  return ref > dueEndOfDay;
}
// สถานะที่ใช้แสดงจริง (badge หลัก / KPI / การ์ด BA) — เหมือน overallStatus ทุกประการ
// ยกเว้น 2 กรณี: (1) คอลัมน์ N ระบุ "ไม่โอนข้อมูล" ไว้ชัดเจนแล้ว จะขึ้นเป็น "ไม่โอนข้อมูล" แทน
// ไม่ใช่ "เลยกำหนด" เฉยๆ (เพราะเป็นการตัดสินใจ ไม่ใช่แค่ล่าช้า) (2) เลยวันที่พร้อมขึ้นระบบของตัวเองแล้วแต่ยังไม่ done → overdue
function displayStatus(row){
  const base = overallStatus(row);
  if (base === STATUS.DONE) return STATUS.DONE;
  if (row.transferStatusKey === 'ts-notransfer') return STATUS.NOTRANSFER;
  if (isOverdue(row)) return STATUS.OVERDUE;
  return base;
}
function updateDeadlineFlag(){
  const flag = document.getElementById('deadline-flag');
  const overdueCount = DATA.filter(r => displayStatus(r) === STATUS.OVERDUE).length;
  flag.textContent = overdueCount > 0 ? `พบเลยกำหนด ${overdueCount} แห่ง` : 'ยังไม่มีที่เลยกำหนด';
  flag.className = 'deadline-flag ' + (overdueCount > 0 ? 'over' : 'ok');
  const maxLabel = document.getElementById('max-date-label');
  maxLabel.textContent = MAX_READY_DATE ? `(รอบล่าสุด: ${formatDateObj(MAX_READY_DATE)})` : '';
}
document.getElementById('round-deadline-toggle').addEventListener('change', (e) => {
  USE_ROUND_DEADLINE = e.target.checked;
  updateDeadlineFlag();
  renderKPIs(DATA);
  applyFilters();
});
document.getElementById('deadline-input').addEventListener('change', (e) => {
  REFERENCE_DATE = e.target.value || REFERENCE_DATE;
  updateDeadlineFlag();
  renderKPIs(DATA);
  applyFilters();
});

function initials(name){
  const parts = name.trim().split(' ');
  return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
}
function escapeHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// ย่อ "โรงพยาบาลส่งเสริมสุขภาพตำบล..." ให้เหลือ "รพ.สต. ..." เพื่อให้คอลัมน์ชื่อหน่วยงานไม่กว้างเกินไป
function shortenOrgName(name){
  const v = (name || '').trim();
  return v.replace(/^โรงพยาบาลส่งเสริมสุขภาพตำบล\s*/, 'รพ.สต.');
}
function formatDate(raw){
  const d = parseSheetDate(raw);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  if (!d) return raw || '—';
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

function populateFilterOptions(){
  const regions = [...new Set(DATA.map(r => r.region).filter(Boolean))].sort();
  const provinces = [...new Set(DATA.map(r => r.province).filter(Boolean))].sort();
  const regionSel = document.getElementById('f-region');
  const provinceSel = document.getElementById('f-province');
  const ownerSel = document.getElementById('f-owner');
  const transferSel = document.getElementById('f-transfer');
  const prevRegion = regionSel.value, prevProvince = provinceSel.value, prevOwner = ownerSel.value, prevTransfer = transferSel.value;
  regionSel.innerHTML = '<option value="">ทุกเขต</option>';
  provinceSel.innerHTML = '<option value="">ทุกจังหวัด</option>';
  ownerSel.innerHTML = '<option value="">ทุกผู้รับผิดชอบ</option>';
  transferSel.innerHTML = '<option value="">ทุกสถานะโอนข้อมูล</option>';
  regions.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; regionSel.appendChild(o); });
  provinces.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; provinceSel.appendChild(o); });

  const ownerCounts = {};
  DATA.forEach(r => { if (r.owner){ ownerCounts[r.owner] = (ownerCounts[r.owner] || 0) + 1; } });
  Object.keys(ownerCounts).sort((a,b) => a.localeCompare(b, 'th')).forEach(name => {
    const o = document.createElement('option');
    o.value = name;
    o.textContent = `${name} (${ownerCounts[name]} แห่ง)`;
    ownerSel.appendChild(o);
  });

  const transferCounts = {};
  DATA.forEach(r => { const l = r.transferStatusLabel || 'ไม่ระบุ'; transferCounts[l] = (transferCounts[l] || 0) + 1; });
  Object.keys(transferCounts).sort((a,b) => a.localeCompare(b, 'th')).forEach(label => {
    const o = document.createElement('option');
    o.value = label;
    o.textContent = `${label} (${transferCounts[label]} แห่ง)`;
    transferSel.appendChild(o);
  });

  regionSel.value = prevRegion; provinceSel.value = prevProvince; ownerSel.value = prevOwner; transferSel.value = prevTransfer;
}

function renderKPIs(rows){
  const total = rows.length;
  const done = rows.filter(r => displayStatus(r) === STATUS.DONE).length;
  const progress = rows.filter(r => displayStatus(r) === STATUS.PROGRESS).length;
  const pending = rows.filter(r => displayStatus(r) === STATUS.PENDING).length;
  const overdue = rows.filter(r => displayStatus(r) === STATUS.OVERDUE).length;
  const notransfer = rows.filter(r => r.transferStatusKey === 'ts-notransfer').length;
  const unused = rows.filter(r => r.usageStatusKey === 'us-inactive').length;
  const totalSteps = total * STAGES.length;
  const doneSteps = rows.reduce((sum, r) => sum + STAGES.filter(s => r[s] === 'done').length, 0);
  const percent = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;

  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-done').textContent = done;
  document.getElementById('kpi-progress').textContent = progress;
  document.getElementById('kpi-pending').textContent = pending;
  document.getElementById('kpi-percent').textContent = percent + '%';
  document.getElementById('kpi-bar').style.width = percent + '%';
  document.getElementById('kpi-overdue').textContent = overdue;
  document.getElementById('kpi-notransfer').textContent = notransfer;
  document.getElementById('kpi-unused').textContent = unused;
  updateDeadlineFlag();
}

function renderTable(rows){
  const body = document.getElementById('table-body');
  const empty = document.getElementById('empty-state');
  body.innerHTML = '';
  document.getElementById('f-count').textContent = `แสดง ${rows.length} จาก ${DATA.length} หน่วยงาน`;

  if (rows.length === 0){ empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  rows.forEach(row => {
    const st = displayStatus(row);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="code">${row.code}</td>
      <td class="org">${shortenOrgName(row.org)}</td>
      <td>${row.province}</td>
      <td><span class="region-tag">${row.region}</span></td>
      <td>${row.oldProgram}</td>
      <td>
        <div class="owner-cell">
          <span class="avatar">${initials(row.owner)}</span>
          <span>${row.owner}</span>
        </div>
      </td>
      <td>${formatDate(row.readyDate)}</td>
      <td>
        <div class="pipeline" title="${STAGES.map(s => STAGE_LABEL[s] + ': ' + STATUS_LABEL[row[s]]).join(' / ')}">
          ${STAGES.map(s => `<div class="step ${row[s]}"></div>`).join('')}
        </div>
      </td>
      <td><span class="badge ${st}"><span class="dot"></span>${STATUS_LABEL[st]}</span></td>
      <td><span class="badge ${row.transferStatusKey}">${row.transferStatusLabel}</span></td>
      <td class="followup">${row.followUp ? escapeHtml(row.followUp) : '<span class="muted">—</span>'}</td>
      <td><span class="badge ${row.usageStatusKey}">${row.usageStatusLabel}</span></td>
    `;
    body.appendChild(tr);
  });
}

function renderOwnerView(rows){
  const grid = document.getElementById('owner-grid');
  grid.innerHTML = '';

  const owners = {};
  rows.forEach(r => {
    if (!r.owner) return;
    if (!owners[r.owner]) owners[r.owner] = [];
    owners[r.owner].push(r);
  });

  const names = Object.keys(owners).sort((a,b) => {
    // เรียงคนที่มีงาน "เลยกำหนด" / "ไม่โอนข้อมูล" / "ขึ้นระบบแล้วไม่ใช้งาน" ก่อน แล้วตามด้วยคนที่มีงานค้าง (pending) เยอะสุด
    const flagCount = list => list.filter(r => displayStatus(r) === STATUS.OVERDUE || displayStatus(r) === STATUS.NOTRANSFER || r.usageStatusKey === 'us-inactive').length;
    const flagDiff = flagCount(owners[b]) - flagCount(owners[a]);
    if (flagDiff !== 0) return flagDiff;
    const pendingA = owners[a].filter(r => displayStatus(r) === STATUS.PENDING).length;
    const pendingB = owners[b].filter(r => displayStatus(r) === STATUS.PENDING).length;
    if (pendingB !== pendingA) return pendingB - pendingA;
    return a.localeCompare(b, 'th');
  });

  if (names.length === 0){
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">ไม่พบข้อมูลที่ตรงกับตัวกรอง</div>';
    return;
  }

  names.forEach(name => {
    const list = owners[name];
    const total = list.length;
    const done = list.filter(r => displayStatus(r) === STATUS.DONE).length;
    const progress = list.filter(r => displayStatus(r) === STATUS.PROGRESS).length;
    const pending = list.filter(r => displayStatus(r) === STATUS.PENDING).length;
    const overdue = list.filter(r => displayStatus(r) === STATUS.OVERDUE).length;
    const notransfer = list.filter(r => displayStatus(r) === STATUS.NOTRANSFER).length;
    // นับแยกต่างหาก: "ประกาศใช้งานแล้วแต่ไม่ได้ใช้งานจริง" อิงจากคอลัมน์ AF (usageStatus)
    // เคสนี้ปกติจะถูกนับรวมอยู่ใน "เสร็จแล้ว" ด้วย (เพราะทำครบทุกขั้นตอนแล้ว) จึงต้องโชว์แยกไว้ ไม่ใช่ segment ในแถบสรุป
    const unused = list.filter(r => r.usageStatusKey === 'us-inactive').length;
    // แนวทาง A: แยก 2 ตัวเลขให้ชัดว่าวัดคนละเรื่องกัน ไม่ปนกัน
    // 1) % ทำครบขั้นตอน = เสร็จแล้ว / (ทั้งหมด - ไม่โอนข้อมูล)
    // ตัด "ไม่โอนข้อมูล" ออกจากตัวหาร เพราะเป็นเคสที่ผู้รับผิดชอบทำต่อให้เสร็จเองไม่ได้ (ไม่ใช่งานค้างที่ยังไม่ได้ทำ)
    // ถ้าเอาไปหารรวมกับตัวหารปกติ จะทำให้คนที่บังเอิญเจอเคสนี้เยอะ ดู % ต่ำกว่าความเป็นจริงอย่างไม่เป็นธรรม
    const workable = total - notransfer;
    const percent = workable ? Math.round((done / workable) * 100) : (total ? 100 : 0);
    const percentColor = (overdue > 0 || unused > 0) ? 'var(--overdue-text)' : (percent === 100 ? 'var(--done-text)' : 'var(--accent)');
    // 2) อัตราใช้งานจริง = ในบรรดาที่ "เสร็จแล้ว" มีกี่ที่ที่ใช้งานจริง (ไม่ถูกตีว่า "ไม่ใช้งาน" ในคอลัมน์ AF)
    const usedAmongDone = done - unused;
    const hasUsageIssue = done > 0 && unused > 0;

    const card = document.createElement('div');
    card.className = 'owner-card' + ((overdue > 0 || unused > 0) ? ' overdue-alert' : (pending > 0 && done === 0 ? ' needs-attention' : ''));
    card.innerHTML = `
      <div class="owner-card-head">
        <span class="avatar">${initials(name)}</span>
        <div>
          <div class="owner-card-name">${name}</div>
          <div class="owner-card-count">รับผิดชอบ ${total} หน่วยงาน${notransfer ? ` (ทำได้จริง ${workable})` : ''}</div>
        </div>
        <span class="owner-percent" style="color:${percentColor}" title="${done} เสร็จแล้ว จาก ${workable} ที่ทำได้จริง (ตัด ${notransfer} ที่ไม่โอนข้อมูลออกจากตัวหาร)">
          <span class="pct-value">${percent}%</span>
          <span class="pct-label">ทำครบขั้นตอน</span>
        </span>
      </div>
      <div class="owner-stackbar" title="เสร็จแล้ว ${done} / กำลังดำเนินการ ${progress} / รอดำเนินการ ${pending} / เลยกำหนด ${overdue} / ไม่โอนข้อมูล ${notransfer}">
        ${done ? `<div class="seg done" style="flex:${done}"></div>` : ''}
        ${progress ? `<div class="seg progress" style="flex:${progress}"></div>` : ''}
        ${pending ? `<div class="seg pending" style="flex:${pending}"></div>` : ''}
        ${overdue ? `<div class="seg overdue" style="flex:${overdue}"></div>` : ''}
        ${notransfer ? `<div class="seg notransfer" style="flex:${notransfer}"></div>` : ''}
      </div>
      <div class="owner-stats">
        <span class="owner-stat"><span class="dot done"></span>เสร็จแล้ว <b>${done}</b></span>
        <span class="owner-stat"><span class="dot progress"></span>กำลังทำ <b>${progress}</b></span>
        <span class="owner-stat"><span class="dot pending"></span>ยังไม่เริ่ม <b>${pending}</b></span>
        ${overdue ? `<span class="owner-stat"><span class="dot overdue"></span>เลยกำหนด <b>${overdue}</b></span>` : ''}
        ${notransfer ? `<span class="owner-stat"><span class="dot notransfer"></span>ไม่โอนข้อมูล <b>${notransfer}</b></span>` : ''}
      </div>
      ${done ? `<div class="owner-usage-rate${hasUsageIssue ? ' has-issue' : ''}">ในจำนวนที่เสร็จแล้ว ใช้งานจริง <b>${usedAmongDone}/${done}</b> ที่${hasUsageIssue ? ` <span style="color:var(--overdue-text)">(ไม่ใช้งาน ${unused})</span>` : ''}</div>` : ''}
    `;
    grid.appendChild(card);
  });
}

let currentView = 'site';
function setView(view){
  currentView = view;
  document.getElementById('site-view').style.display = view === 'site' ? '' : 'none';
  document.getElementById('owner-view').style.display = view === 'owner' ? 'block' : 'none';
  document.getElementById('view-btn-site').classList.toggle('active', view === 'site');
  document.getElementById('view-btn-owner').classList.toggle('active', view === 'owner');
}
document.getElementById('view-btn-site').addEventListener('click', () => setView('site'));
document.getElementById('view-btn-owner').addEventListener('click', () => setView('owner'));

function applyFilters(){
  const region = document.getElementById('f-region').value;
  const province = document.getElementById('f-province').value;
  const owner = document.getElementById('f-owner').value;
  const status = document.getElementById('f-status').value;
  const transfer = document.getElementById('f-transfer').value;
  const usage = document.getElementById('f-usage').value;
  const dateFrom = document.getElementById('f-date-from').value;
  const dateTo = document.getElementById('f-date-to').value;
  const search = document.getElementById('f-search').value.trim().toLowerCase();

  const filtered = DATA.filter(row => {
    if (region && row.region !== region) return false;
    if (province && row.province !== province) return false;
    if (owner && row.owner !== owner) return false;
    if (status && displayStatus(row) !== status) return false;
    if (transfer && row.transferStatusLabel !== transfer) return false;
    if (usage && row.usageStatusLabel !== usage) return false;
    if (dateFrom || dateTo){
      const d = parseSheetDate(row.readyDate);
      if (!d) return false; // ไม่มีวันที่ให้เทียบ ตัดออกเมื่อเปิดตัวกรองวันที่
      const dTime = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (dateFrom && dTime < new Date(dateFrom + 'T00:00:00').getTime()) return false;
      if (dateTo && dTime > new Date(dateTo + 'T00:00:00').getTime()) return false;
    }
    if (search){
      const hay = (row.code + ' ' + row.org + ' ' + shortenOrgName(row.org) + ' ' + row.owner + ' ' + row.followUp).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
  renderTable(filtered);
  renderOwnerView(filtered);
}

['f-region','f-province','f-owner','f-status','f-transfer','f-usage','f-date-from','f-date-to'].forEach(id => document.getElementById(id).addEventListener('change', applyFilters));
document.getElementById('f-search').addEventListener('input', applyFilters);
document.getElementById('f-reset').addEventListener('click', () => {
  document.getElementById('f-region').value = '';
  document.getElementById('f-province').value = '';
  document.getElementById('f-owner').value = '';
  document.getElementById('f-status').value = '';
  document.getElementById('f-transfer').value = '';
  document.getElementById('f-usage').value = '';
  document.getElementById('f-date-from').value = '';
  document.getElementById('f-date-to').value = '';
  document.getElementById('f-search').value = '';
  applyFilters();
});

document.getElementById('btn-refresh').addEventListener('click', () => {
  loadData();
});


renderSheetTabs();
loadData();
