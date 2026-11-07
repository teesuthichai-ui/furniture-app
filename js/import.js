/* นำเข้าข้อมูลหลักจาก CSV: สินค้า (เมนู 2) และอาคาร (เมนู 3)
   ตรวจทั้งไฟล์ก่อนบันทึก ถ้ามีข้อผิดพลาดจะไม่บันทึกเลย */

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

function importTemplate(headers, sample, fileName) {
  const lines = [headers.join(','), sample.join(',')];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
}

async function importItemsFile(file, btn) {
  if (!isAdmin()) return toast('เฉพาะผู้ดูแลระบบที่นำเข้าได้', true);
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('ไม่พบข้อมูลในไฟล์', true);

  const head = rows[0].map(h => h.trim());
  const need = ['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย'];
  const miss = need.filter(h => !head.includes(h));
  if (miss.length) return toast('ไม่พบหัวคอลัมน์: ' + miss.join(', '), true);

  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const get = (r, k) => (idx[k] !== undefined ? String(r[idx[k]] ?? '').trim() : '');

  const existing = new Set(
    (await fieldFetchAll(() => sb.from('items').select('code'))).map(x => x.code.toUpperCase()));
  const seen = new Set();
  const errors = [];
  const data = [];

  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const code = get(r, 'รหัสสินค้า').toUpperCase();
    const name = get(r, 'ชื่อสินค้า');
    const unit = get(r, 'หน่วย');
    if (!code) errors.push(`แถว ${line}: ไม่มีรหัสสินค้า`);
    if (!name) errors.push(`แถว ${line}: ไม่มีชื่อสินค้า`);
    if (!unit) errors.push(`แถว ${line}: ไม่มีหน่วยนับ`);
    if (code && seen.has(code)) errors.push(`แถว ${line}: รหัส ${code} ซ้ำในไฟล์`);
    if (code && existing.has(code)) errors.push(`แถว ${line}: รหัส ${code} มีอยู่ในระบบแล้ว`);
    if (code) seen.add(code);
    data.push({
      code, name, unit,
      category: get(r, 'ประเภท') || null,
      description: get(r, 'รายละเอียด') || null,
      size: get(r, 'ขนาด') || null,
      note: get(r, 'หมายเหตุ') || null,
      active: true
    });
  });

  if (errors.length) {
    openModal('ไม่สามารถนำเข้าได้ แก้ไขไฟล์ก่อน', `
      <p class="error">พบข้อผิดพลาด ${errors.length} รายการ ยังไม่ได้บันทึกข้อมูลใดเลย</p>
      <ul>${errors.slice(0, 40).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
      ${errors.length > 40 ? `<p class="muted">และอีก ${errors.length - 40} รายการ</p>` : ''}`);
    return;
  }

  if (!confirm(`จะนำเข้าสินค้า ${data.length} รายการ ยืนยันหรือไม่?`)) return;
  btn.disabled = true;
  const { error } = await sb.from('items').insert(data);
  btn.disabled = false;
  if (error) return toast(friendlyError(error), true);
  toast(`นำเข้าสินค้า ${data.length} รายการแล้ว`);
  window.PAGES.items($('#content'));
}

async function importBuildingsFile(file, btn) {
  if (!isAdmin()) return toast('เฉพาะผู้ดูแลระบบที่นำเข้าได้', true);
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return toast('ไม่พบข้อมูลในไฟล์', true);

  const head = rows[0].map(h => h.trim());
  const need = ['รหัสอาคาร', 'ชื่ออาคาร'];
  const miss = need.filter(h => !head.includes(h));
  if (miss.length) return toast('ไม่พบหัวคอลัมน์: ' + miss.join(', '), true);

  const idx = Object.fromEntries(head.map((h, i) => [h, i]));
  const get = (r, k) => (idx[k] !== undefined ? String(r[idx[k]] ?? '').trim() : '');

  const existing = new Set(
    (await fieldFetchAll(() => sb.from('buildings').select('code'))).map(x => x.code.toUpperCase()));
  const seen = new Set();
  const errors = [];
  const data = [];

  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const code = get(r, 'รหัสอาคาร').toUpperCase();
    const name = get(r, 'ชื่ออาคาร');
    if (!code) errors.push(`แถว ${line}: ไม่มีรหัสอาคาร`);
    if (!name) errors.push(`แถว ${line}: ไม่มีชื่ออาคาร`);
    if (code && seen.has(code)) errors.push(`แถว ${line}: รหัส ${code} ซ้ำในไฟล์`);
    if (code && existing.has(code)) errors.push(`แถว ${line}: รหัส ${code} มีอยู่ในระบบแล้ว`);
    if (code) seen.add(code);
    data.push({
      code, name,
      zone: get(r, 'โซน') || null,
      note: get(r, 'หมายเหตุ') || null,
      active: true
    });
  });

  if (errors.length) {
    openModal('ไม่สามารถนำเข้าได้ แก้ไขไฟล์ก่อน', `
      <p class="error">พบข้อผิดพลาด ${errors.length} รายการ ยังไม่ได้บันทึกข้อมูลใดเลย</p>
      <ul>${errors.slice(0, 40).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
      ${errors.length > 40 ? `<p class="muted">และอีก ${errors.length - 40} รายการ</p>` : ''}`);
    return;
  }

  if (!confirm(`จะนำเข้าอาคาร ${data.length} แห่ง ยืนยันหรือไม่?`)) return;
  btn.disabled = true;
  const { error } = await sb.from('buildings').insert(data);
  btn.disabled = false;
  if (error) return toast(friendlyError(error), true);
  toast(`นำเข้าอาคาร ${data.length} แห่งแล้ว`);
  window.PAGES.locations($('#content'));
}

function addImportBox(el, kind) {
  if (!isAdmin()) return;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = kind === 'items' ? `
    <h3>นำเข้าสินค้าจาก CSV</h3>
    <p class="muted small">ดาวน์โหลดแม่แบบ กรอกใน Excel แล้วบันทึกเป็น CSV UTF-8 ระบบจะตรวจทั้งไฟล์ก่อนบันทึก</p>
    <div class="actions" style="justify-content:flex-start">
      <button class="btn" id="imp-tpl">ดาวน์โหลดแม่แบบ</button>
      <input type="file" id="imp-file" accept=".csv" style="width:auto">
    </div>` : `
    <h3>นำเข้าอาคารจาก CSV</h3>
    <p class="muted small">ดาวน์โหลดแม่แบบ กรอกใน Excel แล้วบันทึกเป็น CSV UTF-8 ระบบจะตรวจทั้งไฟล์ก่อนบันทึก</p>
    <div class="actions" style="justify-content:flex-start">
      <button class="btn" id="imp-tpl">ดาวน์โหลดแม่แบบ</button>
      <input type="file" id="imp-file" accept=".csv" style="width:auto">
    </div>`;
  el.prepend(card);

  $('#imp-tpl').onclick = () => kind === 'items'
    ? importTemplate(['รหัสสินค้า','ชื่อสินค้า','ประเภท','รายละเอียด','ขนาด','หน่วย','หมายเหตุ'],
        ['TEST3','ตัวอย่างสินค้า','โต๊ะ','','120x60','ตัว',''], 'แม่แบบสินค้า.csv')
    : importTemplate(['รหัสอาคาร','ชื่ออาคาร','โซน','หมายเหตุ'],
        ['B0003','อาคารตัวอย่าง','โซน A',''], 'แม่แบบอาคาร.csv');

  $('#imp-file').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const btn = $('#imp-tpl');
    kind === 'items' ? importItemsFile(f, btn) : importBuildingsFile(f, btn);
    e.target.value = '';
  };
}
(function () {
  const origItems = window.PAGES.items;
  window.PAGES.items = async (el) => {
    await origItems(el);
    addImportBox(el, 'items');
  };
  const origLoc = window.PAGES.locations;
  window.PAGES.locations = async (el) => {
    await origLoc(el);
    addImportBox(el, 'buildings');
  };
})();