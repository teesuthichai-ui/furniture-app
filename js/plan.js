/* ส่วนที่ 3: แผนกระจายสินค้ารายอาคาร (เมนู 4) */
let planBuildings = [];
let planItems = [];
let pendingRows = [];

window.PAGES.plan = async (el) => {
  const [b, i] = await Promise.all([
    sb.from('buildings').select('id, code, name, active').order('code'),
    sb.from('items').select('id, code, name, unit, active').order('code')
  ]);
  if (b.error) throw b.error;
  if (i.error) throw i.error;
  planBuildings = b.data;
  planItems = i.data;

  el.innerHTML = `
    <div class="page-head"><h1>แผนกระจายสินค้ารายอาคาร</h1></div>
    <div class="card">
      <label>เลือกอาคาร
        <select id="plan-bld">
          <option value="">-- เลือกอาคาร --</option>
          ${planBuildings.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}${x.active ? '' : ' (ปิดใช้งาน)'}</option>`).join('')}
        </select>
      </label>
      <div id="plan-body" class="muted">เลือกอาคารเพื่อดูหรือกำหนดแผน</div>
    </div>
    <div class="card">
      <h2>นำเข้าแผนจาก Excel หรือ CSV</h2>
      <p class="muted small">ไฟล์ต้องมีหัวคอลัมน์ชื่อ <b>รหัสอาคาร</b>, <b>รหัสสินค้า</b>, <b>จำนวนตามแผน</b> และ <b>หมายเหตุ</b> (ไม่บังคับ)</p>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn" id="plan-template">ดาวน์โหลดแม่แบบ CSV</button>
      </div>
      ${isAdmin()
        ? '<input type="file" id="plan-file" accept=".xlsx,.xls,.csv" style="margin-top:12px">'
        : '<p class="muted">เฉพาะผู้ดูแลระบบที่นำเข้าแผนได้</p>'}
      <div id="plan-preview"></div>
    </div>`;

  $('#plan-bld').onchange = (e) => loadPlanForBuilding(e.target.value);
  $('#plan-template').onclick = downloadPlanTemplate;
  if (isAdmin()) $('#plan-file').onchange = (e) => previewPlanFile(e.target.files[0]);
};

/* ---------- แม่แบบ CSV ---------- */
function downloadPlanTemplate() {
  const lines = [
    'รหัสอาคาร,รหัสสินค้า,จำนวนตามแผน,หมายเหตุ',
    'LM001,MGR1,3,ตัวอย่าง'
  ];
  // \uFEFF ช่วยให้ Excel อ่านภาษาไทยถูกต้อง
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'แม่แบบแผนกระจายสินค้า.csv';
  a.click();
}

/* ---------- แผนของอาคารหนึ่งแห่ง ---------- */
async function loadPlanForBuilding(buildingId) {
  const body = $('#plan-body');
  if (!buildingId) { body.innerHTML = 'เลือกอาคารเพื่อดูหรือกำหนดแผน'; return; }
  body.innerHTML = 'กำลังโหลด...';

  const { data, error } = await sb.from('plan_progress').select('*')
    .eq('building_id', buildingId).order('item_code');
  if (error) return toast(friendlyError(error), true);

  const planned = new Set(data.map(r => r.item_id));
  const addable = planItems.filter(i => i.active && !planned.has(i.id));

  body.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr>
        <th>รหัส</th><th>ชื่อสินค้า</th><th>ต้องได้รับ</th>
        <th>ส่งแล้ว</th><th>ยังขาด</th><th>%</th>${isAdmin() ? '<th></th>' : ''}
      </tr></thead>
      <tbody>${data.length ? data.map(r => `
        <tr>
          <td><b>${esc(r.item_code)}</b></td>
          <td>${esc(r.item_name)}</td>
          <td>${isAdmin()
            ? `<input type="number" min="0" step="1" value="${r.qty_required}" data-qty="${r.item_id}" style="width:90px">`
            : num(r.qty_required)}</td>
          <td>${num(r.qty_shipped)}</td>
          <td>${num(r.qty_remaining)}</td>
          <td>${r.percent_done ?? 0}%</td>
          ${isAdmin() ? `<td><button class="btn small primary" data-save="${r.item_id}">บันทึก</button></td>` : ''}
        </tr>`).join('')
        : `<tr><td colspan="${isAdmin() ? 7 : 6}">ยังไม่มีแผนของอาคารนี้</td></tr>`}
      </tbody>
    </table></div>
    ${isAdmin() && addable.length ? `
    <form id="plan-add" class="inline-form">
      <select name="item" required>
        <option value="">+ เลือกสินค้าที่จะเพิ่มในอาคารนี้</option>
        ${addable.map(i => `<option value="${i.id}">${esc(i.code)} · ${esc(i.name)}</option>`).join('')}
      </select>
      <input name="qty" type="number" min="0" step="1" placeholder="จำนวน" required>
      <button class="btn primary" type="submit">เพิ่ม</button>
    </form>` : ''}`;

  if (isAdmin()) {
    body.querySelectorAll('[data-save]').forEach(btn => {
      btn.onclick = () => {
        const qty = Number($(`[data-qty="${btn.dataset.save}"]`).value);
        savePlan(buildingId, btn.dataset.save, qty, btn);
      };
    });
    const form = $('#plan-add');
    if (form) form.onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      savePlan(buildingId, fd.get('item'), Number(fd.get('qty')), form.querySelector('button'));
    };
  }
}

async function savePlan(buildingId, itemId, qty, btn) {
  if (!Number.isInteger(qty) || qty < 0) {
    return toast('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป', true);
  }
  btn.disabled = true;
  const { error } = await sb.from('plan_lines').upsert({
    building_id: Number(buildingId),
    item_id: Number(itemId),
    qty_required: qty,
    updated_by: state.user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'building_id,item_id' });
  btn.disabled = false;
  if (error) return toast(friendlyError(error), true);
  toast('บันทึกแผนแล้ว');
  loadPlanForBuilding(buildingId);
}

/* ---------- นำเข้าจากไฟล์ (ตรวจก่อนบันทึกเสมอ) ---------- */
async function previewPlanFile(file) {
  const box = $('#plan-preview');
  pendingRows = [];
  if (!file) { box.innerHTML = ''; return; }
  if (typeof XLSX === 'undefined') {
    return toast('โหลดตัวอ่าน Excel ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', true);
  }

  box.innerHTML = 'กำลังอ่านไฟล์...';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

    const headers = Object.keys(raw[0] || {});
    const required = ['รหัสอาคาร', 'รหัสสินค้า', 'จำนวนตามแผน'];
    const missing = required.filter(h => !headers.includes(h));
    if (missing.length) {
      box.innerHTML = `<div class="card error">ไม่พบหัวคอลัมน์: ${missing.join(', ')} (ต้องพิมพ์ให้ตรงทุกตัวอักษร)</div>`;
      return;
    }

    const bldByCode = new Map(planBuildings.map(b => [b.code.trim().toUpperCase(), b]));
    const itemByCode = new Map(planItems.map(i => [i.code.trim().toUpperCase(), i]));
    const seen = new Set();
    const rows = [];
    const errors = [];

    raw.forEach((r, idx) => {
      const line = idx + 2; // แถวที่ 1 เป็นหัวตาราง
      const bCode = String(r['รหัสอาคาร'] ?? '').trim().toUpperCase();
      const iCode = String(r['รหัสสินค้า'] ?? '').trim().toUpperCase();
      const qtyRaw = String(r['จำนวนตามแผน'] ?? '').trim();
      const note = String(r['หมายเหตุ'] ?? '').trim();
      if (!bCode && !iCode && !qtyRaw) return; // ข้ามแถวว่าง

      const bld = bldByCode.get(bCode);
      const itm = itemByCode.get(iCode);
      const qty = Number(qtyRaw);

      if (!bld) errors.push(`แถว ${line}: ไม่พบรหัสอาคาร "${bCode}" ในระบบ`);
      if (!itm) errors.push(`แถว ${line}: ไม่พบรหัสสินค้า "${iCode}" ในระบบ`);
      if (qtyRaw === '' || !Number.isInteger(qty) || qty < 0) {
        errors.push(`แถว ${line}: จำนวนต้องเป็นจำนวนเต็ม 0 ขึ้นไป`);
      }
      if (bld && itm) {
        const key = bld.id + '-' + itm.id;
        if (seen.has(key)) errors.push(`แถว ${line}: ซ้ำกับแถวก่อนหน้า (อาคาร ${bCode} สินค้า ${iCode})`);
        seen.add(key);
      }
      rows.push({ line, bld, itm, qty, note, bCode, iCode });
    });

    if (!rows.length) errors.push('ไม่พบข้อมูลในไฟล์');

    // นับว่าจะเพิ่มใหม่กี่รายการ และจะเขียนทับกี่รายการ
    let updates = 0;
    let inserts = 0;
    if (!errors.length) {
      const { data: existing, error } = await sb.from('plan_lines').select('building_id, item_id');
      if (error) throw error;
      const exist = new Set(existing.map(e => e.building_id + '-' + e.item_id));
      rows.forEach(r => exist.has(r.bld.id + '-' + r.itm.id) ? updates++ : inserts++);
    }

    box.innerHTML = `
      <div class="card">
        <p><b>อ่านได้ ${rows.length} แถว</b> · เพิ่มใหม่ ${inserts} · เขียนทับของเดิม ${updates} · ข้อผิดพลาด ${errors.length}</p>
        ${errors.length ? `
          <div class="error">
            <ul>${errors.slice(0, 30).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
            ${errors.length > 30 ? `<p>และอีก ${errors.length - 30} รายการ</p>` : ''}
            <p>แก้ไขไฟล์ให้ถูกต้องแล้วเลือกไฟล์ใหม่ ระบบยังไม่ได้บันทึกข้อมูลใดเลย</p>
          </div>`
        : `
          <div class="table-wrap"><table>
            <thead><tr><th>แถว</th><th>รหัสอาคาร</th><th>รหัสสินค้า</th><th>จำนวน</th><th>หมายเหตุ</th></tr></thead>
            <tbody>${rows.slice(0, 50).map(r => `
              <tr><td>${r.line}</td><td>${esc(r.bCode)}</td><td>${esc(r.iCode)}</td>
                  <td>${num(r.qty)}</td><td>${esc(r.note)}</td></tr>`).join('')}
            </tbody>
          </table></div>
          ${rows.length > 50 ? `<p class="muted small">แสดง 50 แถวแรกจากทั้งหมด ${rows.length} แถว</p>` : ''}
          <div class="actions"><button class="btn primary" id="plan-import">นำเข้า ${rows.length} รายการ</button></div>`}
      </div>`;

    if (!errors.length) {
      pendingRows = rows;
      $('#plan-import').onclick = () => importPlan(updates);
    }
  } catch (e) {
    box.innerHTML = `<div class="card error">อ่านไฟล์ไม่สำเร็จ: ${esc(friendlyError(e))}</div>`;
  }
}

async function importPlan(updates) {
  if (updates && !confirm(`มี ${updates} รายการที่มีแผนอยู่แล้ว จะถูกเขียนทับด้วยค่าจากไฟล์ ยืนยันหรือไม่?`)) return;

  const btn = $('#plan-import');
  btn.disabled = true;
  const payload = pendingRows.map(r => ({
    building_id: r.bld.id,
    item_id: r.itm.id,
    qty_required: r.qty,
    note: r.note || null,
    updated_by: state.user.id,
    updated_at: new Date().toISOString()
  }));

  // บันทึกเป็นชุดละ 500 แถว ถ้าเกิดข้อผิดพลาดกลางคัน นำไฟล์เดิมมาเลือกใหม่ได้เลย เพราะเป็นการเขียนทับ ไม่เกิดรายการซ้ำ
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await sb.from('plan_lines')
      .upsert(payload.slice(i, i + 500), { onConflict: 'building_id,item_id' });
    if (error) {
      btn.disabled = false;
      return toast(`บันทึกไม่สำเร็จที่แถวที่ ${i + 1}: ${friendlyError(error)}`, true);
    }
  }

  toast(`นำเข้าแผนแล้ว ${payload.length} รายการ`);
  pendingRows = [];
  $('#plan-file').value = '';
  $('#plan-preview').innerHTML = '';
  const sel = $('#plan-bld');
  if (sel.value) loadPlanForBuilding(sel.value);
}