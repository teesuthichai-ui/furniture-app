/* เมนู 12: ประกอบรายวัน | เมนู 13: รายงานสินค้ามีตำหนิ
   เฟส 1: ไม่แตะยอดสต๊อก ทุกการเขียนผ่านฟังก์ชันในฐานข้อมูล */

const ASM_STATUS = { active: 'ใช้งาน', cancelled: 'ยกเลิก' };
const DEF_STAGE = { receive: 'พบตอนรับสินค้า', assembly: 'พบระหว่างประกอบ', inspection: 'พบระหว่างตรวจเช็ก' };
const DEF_STATUS = { pending: 'รอดำเนินการ', in_progress: 'กำลังดำเนินการ', repaired: 'ซ่อมเสร็จ', return_pending: 'รอส่งคืนซัพพลายเออร์', returned: 'ส่งคืนซัพพลายเออร์แล้ว', closed: 'ปิดงาน', disposed: 'ตัดทิ้ง (เดิม)' };
const DEF_SET_STATUS = { pending: 'รอดำเนินการ', in_progress: 'กำลังดำเนินการ', repaired: 'ซ่อมเสร็จ', closed: 'ปิดงาน' };
const DEF_BADGE = { pending: '', in_progress: '', repaired: 'ok', return_pending: '', returned: '', closed: 'ok', disposed: '' };

const fieldCanWrite = () => state.role === 'admin' || state.role === 'warehouse';
const fld = (f, n) => f.querySelector(`[name="${n}"]`);
const FM = { items: [], buildings: [], drops: [] };
const fieldCodeName = (x) => `${x.code} · ${x.name}`;

function fieldLocalNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}
function fieldLocalToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function fieldOptions(list, blank, onlyActive, labelOf) {
  return `<option value="">${blank}</option>` + list
    .filter(x => !onlyActive || x.active)
    .map(x => `<option value="${x.id}">${esc(labelOf(x))}</option>`).join('');
}

async function loadFieldMasters() {
  const [i, b, d] = await Promise.all([
    sb.from('items').select('id, code, name, unit, active').order('code'),
    sb.from('buildings').select('id, code, name, active').order('code'),
    sb.from('drops').select('id, code, name, active').order('id')
  ]);
  for (const r of [i, b, d]) if (r.error) throw r.error;
  FM.items = i.data;
  FM.buildings = b.data;
  FM.drops = d.data;
}

// ดึงทุกแถวทีละ 1,000 เพราะ Supabase จำกัดจำนวนต่อครั้ง
async function fieldFetchAll(makeQuery) {
  const PAGE = 1000;
  let all = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < PAGE) break;
  }
  return all;
}

async function fieldUpload(files, folder) {
  const paths = [];
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
    const path = `${folder}/${Date.now()}-${k + 1}.${ext}`;
    const up = await sb.storage.from('photos').upload(path, f, { contentType: f.type });
    if (up.error) throw up.error;
    paths.push(path);
  }
  return paths;
}

async function fieldShowPhotos(paths) {
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  const imgs = (data || []).filter(x => x.signedUrl);
  openModal('รูปหลักฐาน', imgs.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${imgs.map(p =>
        `<a href="${esc(p.signedUrl)}" target="_blank"><img class="thumb" style="width:120px;height:120px" src="${esc(p.signedUrl)}" alt=""></a>`).join('')}</div>`
    : '<p class="muted">ไม่พบรูป</p>');
}

/* ================= เมนู 12: ประกอบรายวัน ================= */
window.PAGES.assembly = async (el) => {
  await loadFieldMasters();
  let requestId = crypto.randomUUID();
  let rows = [];

  el.innerHTML = `
    <div class="page-head"><h1>ประกอบรายวัน</h1>
      <button class="btn" id="as-csv">ส่งออก CSV</button></div>
    ${fieldCanWrite() ? `
    <div class="card">
      <h2 id="as-form-title">บันทึกการประกอบ</h2>
      <form id="as-form">
        <input type="hidden" name="rowid">
        <div class="grid two">
          <label>วันที่ประกอบ *<input type="date" name="work_date" value="${fieldLocalToday()}" required></label>
          <label>ทีมช่าง<input name="team" placeholder="เช่น ทีม A"></label>
          <label>รหัสไอเท็ม *<select name="item" required>${fieldOptions(FM.items, '-- เลือกสินค้า --', true, fieldCodeName)}</select></label>
          <label>อาคารปลายทาง *<select name="building" required>${fieldOptions(FM.buildings, '-- เลือกอาคาร --', true, fieldCodeName)}</select></label>
          <label>จำนวนที่ประกอบเสร็จ *<input type="number" name="qty" min="1" step="1" required></label>
          <label>หมายเหตุ<input name="note"></label>
        </div>
        <div class="actions">
          <button type="button" class="btn" id="as-cancel-edit" hidden>ยกเลิกการแก้ไข</button>
          <button class="btn primary" type="submit">บันทึก</button>
        </div>
      </form>
    </div>` : ''}

    <div class="card">
      <div class="grid two">
        ${dateRangeHtml('as')}
        <label>ทีมช่าง (พิมพ์เพื่อกรอง)<input id="as-team"></label>
        <label>รหัสไอเท็ม<select id="as-item">${fieldOptions(FM.items, 'ทุกรายการ', false, fieldCodeName)}</select></label>
        <label>อาคาร<select id="as-bldg">${fieldOptions(FM.buildings, 'ทุกอาคาร', false, fieldCodeName)}</select></label>
      </div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="as-go">ค้นหา</button>
      </div>
    </div>

    <div class="grid stats" id="as-stats"></div>

    <div class="card">
      <h2>สรุปยอดประกอบ</h2>
      <label style="max-width:260px">จัดกลุ่มตาม
        <select id="as-group">
          <option value="day">วัน</option>
          <option value="team">ทีมช่าง</option>
          <option value="item">รหัสไอเท็ม</option>
          <option value="bldg">อาคาร</option>
        </select>
      </label>
      <div class="table-wrap"><table>
        <thead id="as-sum-head"></thead>
        <tbody id="as-sum"></tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>รายการประกอบ</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>วันที่</th><th>ทีม</th><th>รหัส</th><th>ชื่อสินค้า</th><th>อาคาร</th><th>จำนวน</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="as-rows"></tbody>
      </table></div>
    </div>`;

  const resetForm = () => {
    const f = $('#as-form');
    if (!f) return;
    f.reset();
    fld(f, 'rowid').value = '';
    fld(f, 'work_date').value = fieldLocalToday();
    $('#as-form-title').textContent = 'บันทึกการประกอบ';
    $('#as-cancel-edit').hidden = true;
    requestId = crypto.randomUUID();
  };

  const fillForm = (r) => {
    const f = $('#as-form');
    fld(f, 'rowid').value = r.id;
    fld(f, 'work_date').value = r.work_date;
    fld(f, 'team').value = r.team || '';
    fld(f, 'item').value = r.item_id;
    fld(f, 'building').value = r.building_id;
    fld(f, 'qty').value = r.qty;
    fld(f, 'note').value = r.note || '';
    $('#as-form-title').textContent = `แก้ไขรายการ #${r.id}`;
    $('#as-cancel-edit').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelRow = async (id) => {
    const reason = prompt('เหตุผลในการยกเลิกรายการประกอบนี้ (จำเป็น)');
    if (reason === null) return;
    if (!reason.trim()) return toast('ต้องระบุเหตุผลการยกเลิก', true);
    const { error } = await sb.rpc('cancel_assembly', { p_id: Number(id), p_reason: reason.trim() });
    if (error) return toast(friendlyError(error), true);
    toast('ยกเลิกรายการแล้ว');
    load();
  };

  const drawSummary = () => {
    const active = rows.filter(r => r.status === 'active');
    const keyOf = {
      day: r => r.work_date,
      team: r => r.team || '(ไม่ระบุทีม)',
      item: r => `${r.items?.code || ''} · ${r.items?.name || ''}`,
      bldg: r => `${r.buildings?.code || ''} · ${r.buildings?.name || ''}`
    }[$('#as-group').value];
    const headLabel = { day: 'วันที่', team: 'ทีมช่าง', item: 'สินค้า', bldg: 'อาคาร' }[$('#as-group').value];

    const map = new Map();
    active.forEach(r => {
      const k = keyOf(r);
      map.set(k, (map.get(k) || 0) + Number(r.qty));
    });
    const entries = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    $('#as-sum-head').innerHTML = `<tr><th>${headLabel}</th><th>จำนวนที่ประกอบได้</th></tr>`;
    $('#as-sum').innerHTML = entries.length
      ? entries.map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${num(v)}</b></td></tr>`).join('')
      : '<tr><td colspan="2">ไม่มีข้อมูล</td></tr>';
  };

  const drawRows = () => {
    $('#as-rows').innerHTML = rows.length ? rows.map(r => `
      <tr class="${r.status === 'cancelled' ? 'inactive' : ''}">
        <td>${esc(r.work_date)}</td>
        <td>${esc(r.team)}</td>
        <td><b>${esc(r.items?.code)}</b></td>
        <td>${esc(r.items?.name)}</td>
        <td>${esc(r.buildings?.code)} · ${esc(r.buildings?.name)}</td>
        <td>${num(r.qty)} ${esc(r.items?.unit || '')}</td>
        <td>${r.status === 'active'
          ? '<span class="badge ok">ใช้งาน</span>'
          : `<span class="badge">ยกเลิก</span><div class="muted small">${esc(r.cancel_reason)}</div>`}</td>
        <td>${fieldCanWrite() && r.status === 'active'
          ? `<button class="btn small" data-as-edit="${r.id}">แก้ไข</button>
             <button class="btn small" style="color:var(--danger)" data-as-cancel="${r.id}">ยกเลิก</button>`
          : ''}</td>
      </tr>`).join('')
      : '<tr><td colspan="8">ไม่พบข้อมูล</td></tr>';

    $('#as-rows').querySelectorAll('[data-as-edit]').forEach(b =>
      b.onclick = () => fillForm(rows.find(x => String(x.id) === b.dataset.asEdit)));
    $('#as-rows').querySelectorAll('[data-as-cancel]').forEach(b =>
      b.onclick = () => cancelRow(b.dataset.asCancel));
  };

  const load = async () => {
    const from = $('#as-from').value;
    const to = $('#as-to').value;
    const item = $('#as-item').value;
    const bldg = $('#as-bldg').value;
    const team = $('#as-team').value.trim().toLowerCase();
    $('#as-rows').innerHTML = '<tr><td colspan="8">กำลังโหลด...</td></tr>';
    try {
      const all = await fieldFetchAll(() => {
        let q = sb.from('assembly_logs').select(
          'id, work_date, team, qty, note, status, cancel_reason, item_id, building_id, items(code, name, unit), buildings(code, name)');
        if (from) q = q.gte('work_date', from);
        if (to) q = q.lte('work_date', to);
        if (item) q = q.eq('item_id', item);
        if (bldg) q = q.eq('building_id', bldg);
        return q.order('work_date', { ascending: false }).order('id', { ascending: false });
      });
      const projectRows = await fieldFetchAll(() =>
        sb.from('assembly_logs').select('qty').eq('status', 'active'));
      const projectTotal = projectRows.reduce((s, x) => s + Number(x.qty), 0);

      rows = all.filter(r => !team || (r.team || '').toLowerCase().includes(team));
      const active = rows.filter(r => r.status === 'active');
      const sumQty = active.reduce((s, r) => s + Number(r.qty), 0);

      $('#as-stats').innerHTML = `
        <div class="stat"><span>จำนวนรายการ (ใช้งาน)</span><b>${num(active.length)}</b></div>
        <div class="stat"><span>ประกอบได้ในช่วงที่เลือก</span><b>${num(sumQty)}</b></div>
        <div class="stat"><span>ประกอบสะสมทั้งโครงการ</span><b>${num(projectTotal)}</b></div>
        <div class="stat"><span>รายการที่ยกเลิก</span><b>${num(rows.length - active.length)}</b></div>`;
      drawSummary();
      drawRows();
    } catch (e) {
      toast(friendlyError(e), true);
    }
  };

  $('#as-go').onclick = load;
  $('#as-group').onchange = drawSummary;
  $('#as-csv').onclick = () => {
    if (!rows.length) return toast('ไม่มีข้อมูลให้ส่งออก', true);
    downloadCsv('ประกอบรายวัน.csv',
      ['วันที่', 'ทีม', 'รหัสสินค้า', 'ชื่อสินค้า', 'อาคาร', 'จำนวน', 'สถานะ', 'หมายเหตุ'],
      rows.map(r => [r.work_date, r.team, r.items?.code, r.items?.name,
        `${r.buildings?.code || ''} ${r.buildings?.name || ''}`, r.qty, ASM_STATUS[r.status], r.note]));
  };

  const form = $('#as-form');
  if (form) {
    $('#as-cancel-edit').onclick = resetForm;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const qty = Number(fld(f, 'qty').value);
      if (!Number.isInteger(qty) || qty <= 0) return toast('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0', true);

      const base = {
        p_work_date: fld(f, 'work_date').value,
        p_item_id: Number(fld(f, 'item').value),
        p_building_id: Number(fld(f, 'building').value),
        p_team: fld(f, 'team').value.trim() || null,
        p_qty: qty,
        p_note: fld(f, 'note').value.trim() || null
      };
      const rowid = fld(f, 'rowid').value;
      const btn = f.querySelector('button[type="submit"]');
      let res;

      if (rowid) {
        const reason = prompt('เหตุผลในการแก้ไขรายการนี้ (จำเป็น)');
        if (reason === null) return;
        if (!reason.trim()) return toast('ต้องระบุเหตุผลการแก้ไข', true);
        btn.disabled = true;
        res = await sb.rpc('save_assembly_edit', { ...base, p_id: Number(rowid), p_reason: reason.trim() });
      } else {
        btn.disabled = true;
        res = await sb.rpc('save_assembly', { ...base, p_request_id: requestId });
      }
      btn.disabled = false;

      if (res.error) return toast(friendlyError(res.error), true);
      toast(rowid ? 'แก้ไขรายการแล้ว' : 'บันทึกการประกอบแล้ว');
      resetForm();
      load();
    };
  }

  load();
};

/* ================= เมนู 13: รายงานสินค้ามีตำหนิ ================= */
window.PAGES.defects = async (el) => {
  await loadFieldMasters();
  let requestId = crypto.randomUUID();
  let rows = [];
  let bldMap = {};

  const DEF_LABEL = { pending: 'รอดำเนินการ', in_progress: 'กำลังดำเนินการ', repaired: 'ซ่อมเสร็จ', return_pending: 'รอส่งคืนซัพพลายเออร์', returned: 'ส่งคืนซัพพลายเออร์แล้ว', closed: 'ปิดงาน', disposed: 'ตัดทิ้ง (เดิม)' };
  const canWrite = fieldCanWrite();
  const bl = await sb.from('buildings').select('id, code, name');
  if (bl.error) throw bl.error;
  bl.data.forEach(b => { bldMap[b.id] = b.code + ' · ' + b.name; });

  el.innerHTML = `
    <div class="page-head"><h1>รายงานสินค้ามีตำหนิ</h1>
      <button class="btn" id="df-csv">ส่งออก CSV</button></div>
    ${canWrite ? `
    <div class="card">
      <h2>แจ้งตำหนิ</h2>
      <form id="df-form">
        <div class="grid two">
          <label>วันเวลาที่พบ *<input type="datetime-local" name="found_at" value="${fieldLocalNow()}" required></label>
          <label>แหล่งที่พบ *<select name="stage" required>
            ${Object.entries(DEF_STAGE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select></label>
          <label>รหัสไอเท็ม *<select name="item" required>${fieldOptions(FM.items, '-- เลือกสินค้า --', true, fieldCodeName)}</select></label>
          <label>จำนวนที่พบตำหนิ *<input type="number" name="qty" min="1" step="1" required></label>
          <label>อาคารที่พบ<select name="building">${fieldOptions(FM.buildings, '-- ไม่ระบุอาคาร --', true, fieldCodeName)}</select></label>
          <label>หรือจุด Drop ที่พบ<select name="drop">${fieldOptions(FM.drops.filter(x => x.kind !== 'quarantine'), '-- ไม่ระบุ Drop --', true, fieldCodeName)}</select></label>
        </div>
        <p class="muted small">ต้องเลือกอาคารหรือ Drop อย่างน้อยหนึ่งอย่าง ตำหนิที่พบที่อาคารจะไม่หักยอดสต๊อก</p>
        <label>รายละเอียดตำหนิ *<textarea name="description" rows="3" required></textarea></label>
        <label>รูปหลักฐาน (เลือกได้หลายรูป)<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="actions"><button class="btn primary" type="submit">บันทึกตำหนิ</button></div>
      </form>
    </div>` : ''}

    <div class="grid stats" id="df-stats"></div>

    <div class="card">
      <div class="grid two">
        ${dateRangeHtml('df')}
        <label>สถานะ<select id="df-status">
          <option value="">ทั้งหมด</option>
          ${Object.entries(DEF_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></label>
        <label>แหล่งที่พบ<select id="df-stage">
          <option value="">ทั้งหมด</option>
          ${Object.entries(DEF_STAGE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></label>
        <label>รหัสไอเท็ม<select id="df-item">${fieldOptions(FM.items, 'ทุกรายการ', false, fieldCodeName)}</select></label>
        <label>อาคาร<select id="df-bldg">${fieldOptions(FM.buildings, 'ทุกอาคาร', false, fieldCodeName)}</select></label>
        <label>Drop / กักกัน<select id="df-drop">${fieldOptions(FM.drops, 'ทุกจุด', false, fieldCodeName)}</select></label>
      </div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="df-go">ค้นหา</button>
      </div>
    </div>

    <div class="card">
      <p class="muted small" id="df-count"></p>
      <div class="table-wrap"><table>
        <thead><tr><th>วันที่พบ</th><th>รหัส</th><th>ชื่อสินค้า</th><th>จำนวน</th><th>แหล่งที่พบ</th><th>สถานที่</th><th>ค้าง/ซ่อม/ทดแทน</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="df-rows"></tbody>
      </table></div>
    </div>`;

  const openRepair = (row) => {
    const remain = row.qty - row.repaired_qty - row.reinstated_qty - row.moved_qty;
    openModal(`บันทึกการซ่อม ${row.items?.code || ''}`, `
      <p class="muted small">ตำหนิทั้งหมด ${num(row.qty)} · ซ่อมแล้ว ${num(row.repaired_qty)} · ทดแทนแล้ว ${num(row.reinstated_qty)} · นำกลับกักกัน ${num(row.moved_qty)} · ยังค้าง ${num(Math.max(remain, 0))}</p>
      <form id="df-repair-form">
        <label>ซ่อมที่ไหน *<select name="where" required>
          <option value="building">ซ่อมที่อาคาร (ยังอยู่หน้างาน)</option>
          <option value="quarantine">ซ่อมที่จุดกักกัน (นำกลับมาแล้ว)</option>
        </select></label>
        <label>จำนวนที่ซ่อมเสร็จ *<input type="number" name="qty" min="1" step="1" required value="${Math.max(remain, 1)}"></label>
        <label>หมายเหตุ<textarea name="note" rows="2"></textarea></label>
        <div class="actions">
          <button type="button" class="btn" onclick="closeModal()">ยกเลิก</button>
          <button class="btn primary" type="submit">บันทึกการซ่อม</button>
        </div>
      </form>`);

    $('#df-repair-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { error } = await sb.rpc('repair_defect', {
        p_request_id: crypto.randomUUID(),
        p_defect_id: Number(row.id),
        p_qty: Number(fd.get('qty')),
        p_where: fd.get('where'),
        p_note: fd.get('note').trim() || null
      });
      btn.disabled = false;
      if (error) return toast(friendlyError(error), true);
      closeModal();
      toast('บันทึกการซ่อมแล้ว');
      load();
    };
  };

  const openMove = (row) => {
    const remain = row.qty - row.moved_qty;
    openModal(`นำกลับกักกัน ${row.items?.code || ''}`, `
      <p class="muted small">ทั้งหมด ${num(row.qty)} · นำกลับแล้ว ${num(row.moved_qty)} · ยังไม่ย้าย ${num(Math.max(remain, 0))}</p>
      <form id="df-move-form">
        <label>จำนวนที่นำกลับ *<input type="number" name="qty" min="1" step="1" max="${remain}" required value="${Math.max(remain, 1)}"></label>
        <label>เหตุผล *<textarea name="reason" rows="2" required></textarea></label>
        <div class="actions">
          <button type="button" class="btn" onclick="closeModal()">ยกเลิก</button>
          <button class="btn primary" type="submit">ยืนยันนำกลับ</button>
        </div>
      </form>`);

    $('#df-move-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { error } = await sb.rpc('move_defect_to_quarantine', {
        p_request_id: crypto.randomUUID(),
        p_defect_id: Number(row.id),
        p_qty: Number(fd.get('qty')),
        p_reason: fd.get('reason').trim()
      });
      btn.disabled = false;
      if (error) return toast(friendlyError(error), true);
      closeModal();
      toast('นำกลับกักกันแล้ว');
      load();
    };
  };

  const openReplace = (row) => {
    const remain = row.qty - row.reinstated_qty;
    openModal(`รับสินค้าทดแทนที่อาคาร ${row.items?.code || ''}`, `
      <p class="muted small">ตำหนิ ${num(row.qty)} · ทดแทนแล้ว ${num(row.reinstated_qty)} · ยังรับได้อีก ${num(Math.max(remain, 0))}</p>
      <form id="df-rep-form">
        <label>จำนวนทดแทนที่รับจริง *<input type="number" name="qty" min="1" step="1" max="${remain}" required value="${Math.max(remain, 1)}"></label>
        <label>หมายเหตุ<textarea name="note" rows="2"></textarea></label>
        <div class="actions">
          <button type="button" class="btn" onclick="closeModal()">ยกเลิก</button>
          <button class="btn primary" type="submit">บันทึกการรับ</button>
        </div>
      </form>`);

    $('#df-rep-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      const { error } = await sb.rpc('receive_replacement_at_building', {
        p_request_id: crypto.randomUUID(),
        p_defect_id: Number(row.id),
        p_qty: Number(fd.get('qty')),
        p_received_at: new Date().toISOString(),
        p_note: fd.get('note').trim() || null
      });
      btn.disabled = false;
      if (error) return toast(friendlyError(error), true);
      closeModal();
      toast('บันทึกสินค้าทดแทนแล้ว');
      load();
    };
  };

  const drawRows = () => {
    $('#df-rows').innerHTML = rows.length ? rows.map(r => {
      const isBuilding = !!r.building_id;
      const remain = r.qty - r.repaired_qty - r.reinstated_qty - r.moved_qty;
      const open = !['disposed', 'returned', 'closed'].includes(r.status);
      return `
      <tr>
        <td>${fmtDate(r.found_at)}</td>
        <td><b>${esc(r.items?.code)}</b></td>
        <td>${esc(r.items?.name)}</td>
        <td>${num(r.qty)} ${esc(r.items?.unit || '')}</td>
        <td>${esc(DEF_STAGE[r.found_stage] || r.found_stage)}</td>
        <td>${isBuilding ? esc(bldMap[r.building_id]) : ''}${r.drops ? esc('Drop: ' + r.drops.code) : ''}</td>
        <td class="small">ซ่อม ${num(r.repaired_qty)} · ทดแทน ${num(r.reinstated_qty)} · นำกลับ ${num(r.moved_qty)}<br>
          <b>ค้าง ${num(Math.max(remain, 0))}</b></td>
        <td><span class="badge ${r.status === 'repaired' || r.status === 'closed' ? 'ok' : ''}">${esc(DEF_LABEL[r.status] || r.status)}</span></td>
        <td>
          ${canWrite && open && isBuilding && remain > 0 ? `
            <button class="btn small" data-rep="${r.id}">ซ่อม</button>
            <button class="btn small" data-mv="${r.id}">นำกลับกักกัน</button>
            <button class="btn small" data-rp="${r.id}">รับทดแทน</button>` : ''}
          ${canWrite && open && !isBuilding && remain > 0 ? `
            <button class="btn small" data-rep="${r.id}">ซ่อม</button>` : ''}
          ${(r.image_paths || []).length ? `<button class="btn small" data-photo="${r.id}">รูป</button>` : ''}
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="9">ไม่พบข้อมูล</td></tr>';

    const find = (id) => rows.find(x => String(x.id) === id);
    $('#df-rows').querySelectorAll('[data-rep]').forEach(b => b.onclick = () => openRepair(find(b.dataset.rep)));
    $('#df-rows').querySelectorAll('[data-mv]').forEach(b => b.onclick = () => openMove(find(b.dataset.mv)));
    $('#df-rows').querySelectorAll('[data-rp]').forEach(b => b.onclick = () => openReplace(find(b.dataset.rp)));
    $('#df-rows').querySelectorAll('[data-photo]').forEach(b => b.onclick = () => fieldShowPhotos(find(b.dataset.photo).image_paths));
  };

  const load = async () => {
    const f = {
      status: $('#df-status').value,
      stage: $('#df-stage').value,
      item: $('#df-item').value,
      bldg: $('#df-bldg').value,
      drop: $('#df-drop').value
    };
    const range = readRange('df');
    $('#df-rows').innerHTML = '<tr><td colspan="9">กำลังโหลด...</td></tr>';
    try {
      rows = await fieldFetchAll(() => {
        let q = sb.from('defects').select(
          'id, found_at, qty, found_stage, status, status_note, description, image_paths, item_id, building_id, drop_id, moved_qty, reinstated_qty, repaired_qty, items(code, name, unit), drops(code)');
        if (f.status) q = q.eq('status', f.status);
        if (f.stage) q = q.eq('found_stage', f.stage);
        if (f.item) q = q.eq('item_id', f.item);
        if (f.bldg) q = q.eq('building_id', f.bldg);
        if (f.drop) q = q.eq('drop_id', f.drop);
        q = applyRange(q, 'found_at', range);
        return q.order('found_at', { ascending: false }).order('id', { ascending: false });
      });

      const count = (s) => rows.filter(r => r.status === s).length;
      const totalQty = rows.reduce((s, r) => s + Number(r.qty), 0);
      $('#df-stats').innerHTML = `
        <div class="stat"><span>รอดำเนินการ</span><b>${num(count('pending'))}</b></div>
        <div class="stat"><span>ซ่อมเสร็จ</span><b>${num(count('repaired'))}</b></div>
        <div class="stat"><span>ส่งคืนซัพพลายเออร์แล้ว</span><b>${num(count('returned'))}</b></div>
        <div class="stat"><span>ตัดทิ้ง (เดิม)</span><b>${num(count('disposed'))}</b></div>`;
      $('#df-count').textContent = `พบ ${num(rows.length)} รายการ รวมจำนวนตำหนิ ${num(totalQty)} ชิ้น`;
      drawRows();
    } catch (e) {
      toast(friendlyError(e), true);
    }
  };

  $('#df-go').onclick = load;
  $('#df-csv').onclick = () => {
    if (!rows.length) return toast('ไม่มีข้อมูลให้ส่งออก', true);
    downloadCsv('รายงานสินค้ามีตำหนิ.csv',
      ['วันที่พบ', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'แหล่งที่พบ', 'สถานที่', 'ซ่อมแล้ว', 'ทดแทนแล้ว', 'นำกลับ', 'สถานะ'],
      rows.map(r => [fmtDate(r.found_at), r.items?.code, r.items?.name, r.qty,
        DEF_STAGE[r.found_stage], r.building_id ? bldMap[r.building_id] : (r.drops?.code || ''),
        r.repaired_qty, r.reinstated_qty, r.moved_qty, DEF_LABEL[r.status]]));
  };

  const form = $('#df-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const qty = Number(fld(f, 'qty').value);
      const building = fld(f, 'building').value;
      const drop = fld(f, 'drop').value;
      const description = fld(f, 'description').value.trim();

      if (!Number.isInteger(qty) || qty <= 0) return toast('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0', true);
      if (!building && !drop) return toast('ต้องเลือกอาคารหรือ Drop อย่างน้อยหนึ่งอย่าง', true);
      if (!description) return toast('กรุณาใส่รายละเอียดตำหนิ', true);

      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const paths = await fieldUpload(fld(f, 'photos').files, `defects/${requestId}`);
        const payload = {
          p_request_id: requestId,
          p_found_at: new Date(fld(f, 'found_at').value).toISOString(),
          p_item_id: Number(fld(f, 'item').value),
          p_qty: qty,
          p_stage: fld(f, 'stage').value,
          p_description: description,
          p_image_paths: paths
        };
        const { error } = building
          ? await sb.rpc('report_building_defect', { ...payload, p_building_id: Number(building) })
          : await sb.rpc('save_defect', { ...payload, p_building_id: null, p_drop_id: Number(drop) });
        if (error) throw error;
        toast('บันทึกตำหนิแล้ว');
        requestId = crypto.randomUUID();
        f.reset();
        fld(f, 'found_at').value = fieldLocalNow();
        load();
      } catch (err) {
        toast(friendlyError(err), true);
      } finally {
        btn.disabled = false;
      }
    };
  }

  load();
};