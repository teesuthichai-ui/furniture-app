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
  const canWrite = fieldCanWrite();
  const bldMap = {};
  const bl = await sb.from('buildings').select('id, code, name');
  if (bl.error) throw bl.error;
  bl.data.forEach(b => { bldMap[b.id] = b.code + ' · ' + b.name; });

  el.innerHTML = `
    <div class="page-head"><h1>แจ้งสินค้ามีตำหนิ</h1>
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
          <label>อาคารที่พบ *<select name="building" required>${fieldOptions(FM.buildings, '-- เลือกอาคาร --', true, fieldCodeName)}</select></label>
          <label>รหัสไอเท็ม *<select name="item" required>${fieldOptions(FM.items, '-- เลือกสินค้า --', true, fieldCodeName)}</select></label>
          <label>จำนวนที่พบตำหนิ *<input type="number" name="qty" min="1" step="1" required></label>
        </div>
        <label>สาเหตุ / รายละเอียดตำหนิ *<textarea name="description" rows="3" required></textarea></label>
        <label>รูปภาพ (เลือกได้หลายรูป)<input type="file" name="photos" accept="image/*" multiple></label>
        <div class="actions"><button class="btn primary" type="submit">บันทึกการแจ้งตำหนิ</button></div>
      </form>
    </div>` : ''}

    <div class="card">
      <h2>สรุปตามอาคาร (เฉพาะที่ยังไม่เสร็จ)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>อาคาร</th><th>ไอเท็ม</th><th>จำนวนตำหนิค้าง</th></tr></thead>
        <tbody id="sum-bld"></tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>สรุปตามไอเท็ม (เฉพาะที่ยังไม่เสร็จ)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>จำนวนตำหนิค้าง</th><th>พบที่อาคาร</th></tr></thead>
        <tbody id="sum-itm"></tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>รายการแจ้งตำหนิ</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>วันที่แจ้ง</th><th>อาคาร</th><th>รหัส</th><th>ชื่อสินค้า</th><th>จำนวน</th><th>แหล่งที่พบ</th><th>สาเหตุ</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="df-rows"></tbody>
      </table></div>
    </div>`;

  const isOpen = (r) => r.status !== 'closed';

  const drawSummary = () => {
    const open = rows.filter(isOpen);
    const byB = {};
    const byI = {};
    open.forEach(r => {
      const bn = bldMap[r.building_id] || '';
      const k = r.building_id + '|' + r.item_id;
      byB[k] = byB[k] || { bn, code: r.items?.code, name: r.items?.name, qty: 0 };
      byB[k].qty += Number(r.qty);
      byI[r.item_id] = byI[r.item_id] || { code: r.items?.code, name: r.items?.name, qty: 0, bld: new Set() };
      byI[r.item_id].qty += Number(r.qty);
      byI[r.item_id].bld.add(bn);
    });
    $('#sum-bld').innerHTML = Object.values(byB).length ? Object.values(byB).map(x => `
      <tr><td>${esc(x.bn)}</td><td>${esc(x.code)} · ${esc(x.name)}</td><td><b>${num(x.qty)}</b></td></tr>`).join('')
      : '<tr><td colspan="3">ไม่มีตำหนิค้างตรวจ</td></tr>';
    $('#sum-itm').innerHTML = Object.values(byI).length ? Object.values(byI).map(x => `
      <tr><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td><b>${num(x.qty)}</b></td><td>${esc([...x.bld].join(', '))}</td></tr>`).join('')
      : '<tr><td colspan="4">ไม่มีตำหนิค้างตรวจ</td></tr>';
  };

  const drawRows = () => {
    $('#df-rows').innerHTML = rows.length ? rows.map(r => `
      <tr class="${isOpen(r) ? '' : 'inactive'}">
        <td>${fmtDate(r.found_at)}</td>
        <td>${esc(bldMap[r.building_id] || '')}</td>
        <td><b>${esc(r.items?.code)}</b></td>
        <td>${esc(r.items?.name)}</td>
        <td>${num(r.qty)} ${esc(r.items?.unit || '')}</td>
        <td>${esc(DEF_STAGE[r.found_stage] || r.found_stage)}</td>
        <td style="max-width:240px">${esc(r.description)}</td>
        <td>${isOpen(r)
          ? '<span class="badge">ค้างตรวจ</span>'
          : '<span class="badge ok">เสร็จแล้ว</span>'}</td>
        <td>
          ${canWrite && isOpen(r) ? `<button class="btn small primary" data-df-done="${r.id}">ตรวจแล้ว / เสร็จ</button>` : ''}
          ${(r.image_paths || []).length ? `<button class="btn small" data-df-photo="${r.id}">รูป (${r.image_paths.length})</button>` : ''}
        </td>
      </tr>`).join('')
      : '<tr><td colspan="9">ยังไม่มีการแจ้งตำหนิ</td></tr>';

    $('#df-rows').querySelectorAll('[data-df-photo]').forEach(b =>
      b.onclick = () => fieldShowPhotos(rows.find(x => String(x.id) === b.dataset.dfPhoto).image_paths));

    $('#df-rows').querySelectorAll('[data-df-done]').forEach(b => b.onclick = async () => {
      if (!confirm('ยืนยันว่าตรวจสินค้านี้เสร็จแล้ว รายการจะถูกนำออกจากสรุปค้างตรวจ')) return;
      b.disabled = true;
      const { error } = await sb.rpc('close_building_defect', { p_defect_id: Number(b.dataset.dfDone) });
      if (error) { b.disabled = false; return toast(friendlyError(error), true); }
      toast('ปิดรายการแล้ว');
      load();
    });
  };

  const load = async () => {
    try {
      rows = await fieldFetchAll(() =>
        sb.from('defects')
          .select('id, found_at, qty, found_stage, description, image_paths, status, item_id, building_id, items(code, name, unit)')
          .not('building_id', 'is', null)
          .order('found_at', { ascending: false }).order('id', { ascending: false }));
      drawRows();
      drawSummary();
    } catch (e) {
      toast(friendlyError(e), true);
    }
  };

  $('#df-csv').onclick = () => {
    if (!rows.length) return toast('ไม่มีข้อมูลให้ส่งออก', true);
    downloadCsv('แจ้งสินค้ามีตำหนิ.csv',
      ['วันที่แจ้ง', 'อาคาร', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'แหล่งที่พบ', 'สาเหตุ', 'สถานะ'],
      rows.map(r => [fmtDate(r.found_at), bldMap[r.building_id], r.items?.code, r.items?.name,
        r.qty, DEF_STAGE[r.found_stage], r.description, isOpen(r) ? 'ค้างตรวจ' : 'เสร็จแล้ว']));
  };

  const form = $('#df-form');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const qty = Number(fld(f, 'qty').value);
      const description = fld(f, 'description').value.trim();
      if (!Number.isInteger(qty) || qty <= 0) return toast('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0', true);
      if (!description) return toast('กรุณาใส่สาเหตุหรือรายละเอียดตำหนิ', true);

      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const paths = await fieldUpload(fld(f, 'photos').files, `defects/${requestId}`);
        const { error } = await sb.rpc('report_building_defect', {
          p_request_id: requestId,
          p_found_at: new Date(fld(f, 'found_at').value).toISOString(),
          p_item_id: Number(fld(f, 'item').value),
          p_qty: qty,
          p_stage: fld(f, 'stage').value,
          p_building_id: Number(fld(f, 'building').value),
          p_description: description,
          p_image_paths: paths
        });
        if (error) throw error;
        toast('บันทึกการแจ้งตำหนิแล้ว');
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