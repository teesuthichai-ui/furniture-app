/* ส่วนที่ 5: จ่ายสินค้า (เมนู 6), ยอดส่งแล้ว/ยังขาด (เมนู 8), คงเหลือและปรับยอด (เมนู 7) */
let dsDrops = [];
let dsBuildings = [];
let dsBalances = [];
let dsPlan = [];

const dsCanWrite = () => state.role === 'admin' || state.role === 'warehouse';

function dsNowLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ยอดที่อาคารยังขาดของสินค้านี้ (ไม่มีแผนหรือเกินแผนแล้ว = 0)
function dsRemaining(itemId) {
  const p = dsPlan.find(x => String(x.item_id) === String(itemId));
  return p ? Math.max(Number(p.qty_remaining), 0) : 0;
}

async function dsUploadFiles(files, folder) {
  const paths = [];
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${folder}/${Date.now()}-${k + 1}.${ext}`;
    const up = await sb.storage.from('photos').upload(path, f, { contentType: f.type });
    if (up.error) throw up.error;
    paths.push(path);
  }
  return paths;
}

/* ---------- เมนู 6: จ่ายสินค้า ---------- */
window.PAGES.dispatch = async (el) => {
  const d = await sb.from('drops').select('id, code, name, active').order('id');
  const b = await sb.from('buildings').select('id, code, name, zone, active').order('code');
  if (d.error) throw d.error;
  if (b.error) throw b.error;
  dsDrops = d.data;
  dsBuildings = b.data;

  el.innerHTML = `
    <div class="page-head"><h1>จ่ายสินค้าจาก Drop ไปอาคาร</h1></div>
    ${dsCanWrite() ? `
    <div class="card">
      <h2>บันทึกการจ่ายใหม่</h2>
      <form id="ds-form">
        <div class="grid two">
          <label>วันเวลาจ่าย<input type="datetime-local" name="dispatched_at" value="${dsNowLocal()}" required></label>
          <label>จุด Drop ต้นทาง *
            <select name="drop" id="ds-drop" required>
              <option value="">-- เลือก Drop --</option>
              ${dsDrops.filter(x => x.active).map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}
            </select>
          </label>
          <label>อาคารปลายทาง *
            <select name="building" id="ds-building" required>
              <option value="">-- เลือกอาคาร --</option>
              ${dsBuildings.filter(x => x.active).map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}
            </select>
          </label>
          <label>ทีมติดตั้ง / ผู้รับสินค้า<input name="team"></label>
          <label>ผู้จ่ายสินค้า *<input name="dispatcher" required></label>
          <label>ผู้รับทราบ<input name="receiver"></label>
        </div>

        <div id="ds-building-info"></div>

        <h3 style="margin-top:12px">รายการสินค้า</h3>
        <div id="ds-lines"></div>
        <button type="button" class="btn small" id="ds-addline">+ เพิ่มรายการ</button>

        <div id="ds-over" class="hidden" style="margin-top:12px;padding:12px;border:1px solid var(--danger);border-radius:8px">
          <p class="error"><b>มีรายการที่จะส่งเกินแผนของอาคาร</b></p>
          <label class="check"><input type="checkbox" name="allow_over"> ยืนยันการส่งเกินแผน (จำเป็นจริงเท่านั้น)</label>
          <label>เหตุผลการส่งเกินแผน *<textarea name="over_reason" rows="2"></textarea></label>
        </div>

        <label style="margin-top:12px">หมายเหตุ<textarea name="note" rows="2"></textarea></label>
        <label>รูปหลักฐานการส่งมอบ (เลือกได้หลายรูป)<input type="file" name="photos" accept="image/*" multiple></label>

        <div class="actions"><button class="btn primary" id="ds-submit" type="submit">ยืนยันการจ่าย</button></div>
      </form>
    </div>` : '<p class="muted">บัญชีของคุณดูประวัติได้อย่างเดียว</p>'}

    <div class="card">
      <h2>ประวัติการจ่าย (30 รายการล่าสุด)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>วันที่</th><th>Drop</th><th>อาคาร</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="ds-history"><tr><td colspan="6">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;

  if (dsCanWrite()) {
    dsBindForm();
    dsAddLine();
  }
  dsLoadHistory();
};

async function dsLoadBalances(dropId) {
  dsBalances = [];
  if (!dropId) return;
  const { data, error } = await sb.from('stock_balance')
    .select('item_id, item_code, item_name, unit, balance')
    .eq('drop_id', dropId).gt('balance', 0).order('item_code');
  if (error) throw error;
  dsBalances = data;
}

async function dsLoadPlan(bldId) {
  dsPlan = [];
  const info = $('#ds-building-info');
  if (!bldId) { info.innerHTML = ''; return; }
  const { data, error } = await sb.from('plan_progress').select('*')
    .eq('building_id', bldId).order('item_code');
  if (error) throw error;
  dsPlan = data;

  info.innerHTML = data.length ? `
    <div class="card" style="margin-top:12px">
      <p><b>แผนของอาคารนี้</b></p>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>ต้องได้รับ</th><th>ส่งแล้ว</th><th>ยังขาด</th></tr></thead>
        <tbody>${data.map(r => `
          <tr><td>${esc(r.item_code)}</td><td>${esc(r.item_name)}</td>
              <td>${num(r.qty_required)}</td><td>${num(r.qty_shipped)}</td>
              <td><b>${num(Math.max(r.qty_remaining, 0))}</b></td></tr>`).join('')}
        </tbody>
      </table></div>
    </div>`
    : `<div class="card error" style="margin-top:12px">อาคารนี้ยังไม่มีแผนจำนวนสินค้า การจ่ายทุกรายการจะนับเป็นส่งเกินแผน ให้กรอกแผนที่เมนู 4 ก่อน</div>`;
}

function dsAddLine() {
  const row = document.createElement('div');
  row.className = 'inline-form ds-line';
  row.innerHTML = `
    <select name="item" style="flex:2">
      <option value="">${dsBalances.length ? '-- เลือกสินค้า --' : '-- เลือก Drop ก่อน --'}</option>
      ${dsBalances.map(x => `<option value="${x.item_id}" data-bal="${x.balance}">
        ${esc(x.item_code)} · ${esc(x.item_name)} (คงเหลือ ${num(x.balance)} ${esc(x.unit)})</option>`).join('')}
    </select>
    <input name="qty" type="number" min="1" step="1" placeholder="จำนวน" style="max-width:120px">
    <span class="muted small" data-hint style="flex-basis:100%"></span>
    <button type="button" class="btn small" data-rm>ลบ</button>`;
  row.querySelector('[data-rm]').onclick = () => { row.remove(); dsCheck(); };
  $('#ds-lines').appendChild(row);
  dsCheck();
}

// แสดงคำเตือนแบบเรียลไทม์ก่อนกดยืนยัน
function dsCheck() {
  const form = $('#ds-form');
  if (!form) return;
  const bld = form.querySelector('[name="building"]').value;
  let over = false;

  document.querySelectorAll('.ds-line').forEach(row => {
    const sel = row.querySelector('[name="item"]');
    const qty = Number(row.querySelector('[name="qty"]').value);
    const hint = row.querySelector('[data-hint]');
    const opt = sel.selectedOptions[0];
    const bal = opt && opt.dataset.bal !== undefined ? Number(opt.dataset.bal) : null;

    let msg = '';
    if (bal !== null) msg += `คงเหลือที่ Drop ${num(bal)} `;
    if (sel.value && bld) {
      const rem = dsRemaining(sel.value);
      msg += `· แผนยังขาด ${num(rem)} `;
      if (qty > 0 && qty > rem) { over = true; msg += '· ⚠ จะเกินแผน '; }
    }
    if (bal !== null && qty > bal) msg += '· ⚠ จำนวนเกินคงเหลือ';
    hint.textContent = msg;
    hint.style.color = msg.includes('⚠') ? 'var(--danger)' : '';
  });

  $('#ds-over').classList.toggle('hidden', !over);
}

function dsBindForm() {
  const form = $('#ds-form');
  let requestId = crypto.randomUUID();

  $('#ds-drop').addEventListener('change', async (e) => {
    try {
      await dsLoadBalances(e.target.value);
    } catch (err) {
      return toast(friendlyError(err), true);
    }
    $('#ds-lines').innerHTML = '';
    dsAddLine();
  });

  $('#ds-building').addEventListener('change', async (e) => {
    try {
      await dsLoadPlan(e.target.value);
    } catch (err) {
      toast(friendlyError(err), true);
    }
    dsCheck();
  });

  $('#ds-addline').onclick = () => dsAddLine();
  form.addEventListener('input', dsCheck);
  form.addEventListener('change', dsCheck);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const dropId = Number(fd.get('drop'));
    const bldId = Number(fd.get('building'));
    const lines = [...document.querySelectorAll('.ds-line')].map(r => ({
      item_id: Number(r.querySelector('[name="item"]').value),
      qty: Number(r.querySelector('[name="qty"]').value)
    }));

    if (!dropId || !bldId) return toast('กรุณาเลือกจุด Drop และอาคารปลายทาง', true);
    if (!lines.length) return toast('กรุณาเพิ่มรายการสินค้า', true);
    if (lines.some(l => !l.item_id)) return toast('มีแถวที่ยังไม่ได้เลือกสินค้า', true);
    if (lines.some(l => !Number.isInteger(l.qty) || l.qty <= 0)) {
      return toast('จำนวนจ่ายต้องเป็นจำนวนเต็มมากกว่า 0', true);
    }
    if (new Set(lines.map(l => l.item_id)).size !== lines.length) {
      return toast('มีสินค้าซ้ำกันในใบจ่ายเดียวกัน ให้รวมเป็นแถวเดียว', true);
    }
    for (const l of lines) {
      const bal = dsBalances.find(x => x.item_id === l.item_id);
      if (!bal || l.qty > Number(bal.balance)) {
        return toast(`${bal ? bal.item_code : 'สินค้า'} มีคงเหลือไม่พอที่ Drop นี้`, true);
      }
    }

    const overLines = lines.filter(l => l.qty > dsRemaining(l.item_id));
    const allowOver = form.querySelector('[name="allow_over"]').checked;
    const reason = String(fd.get('over_reason') || '').trim();
    if (overLines.length && !allowOver) {
      return toast('มีรายการเกินแผน ต้องติ๊กยืนยันการส่งเกินก่อน', true);
    }
    if (overLines.length && !reason) {
      return toast('การส่งเกินแผนต้องระบุเหตุผล', true);
    }

    const btn = $('#ds-submit');
    btn.disabled = true;
    try {
      const paths = await dsUploadFiles(
        form.querySelector('[name="photos"]').files, `dispatches/${requestId}`);

      const { data: id, error } = await sb.rpc('post_dispatch', {
        p_request_id: requestId,
        p_drop_id: dropId,
        p_building_id: bldId,
        p_dispatched_at: new Date(fd.get('dispatched_at')).toISOString(),
        p_team: fd.get('team').trim() || null,
        p_dispatcher: fd.get('dispatcher').trim(),
        p_receiver: fd.get('receiver').trim() || null,
        p_note: fd.get('note').trim() || null,
        p_proof_paths: paths,
        p_lines: lines,
        p_allow_over_plan: overLines.length > 0,
        p_over_plan_reason: overLines.length ? reason : null
      });
      if (error) throw error;

      toast('บันทึกการจ่ายแล้ว');
      requestId = crypto.randomUUID();
      form.reset();
      form.querySelector('[name="dispatched_at"]').value = dsNowLocal();
      dsBalances = [];
      dsPlan = [];
      $('#ds-building-info').innerHTML = '';
      $('#ds-lines').innerHTML = '';
      dsAddLine();
      dsLoadHistory();
      dsPrintSlip(id);
    } catch (err) {
      toast(friendlyError(err), true);
    } finally {
      btn.disabled = false;
    }
  };
}

async function dsLoadHistory() {
  const { data, error } = await sb.from('dispatches')
    .select('id, dispatch_no, dispatched_at, status, drop_id, building_id, over_plan, cancel_reason')
    .order('dispatched_at', { ascending: false })
    .limit(30);
  if (error) return toast(friendlyError(error), true);

  const dropCode = Object.fromEntries(dsDrops.map(x => [x.id, x.code]));
  const bldName = Object.fromEntries(dsBuildings.map(x => [x.id, x.code + ' · ' + x.name]));
  const tb = $('#ds-history');
  if (!tb) return;

  tb.innerHTML = data.length ? data.map(r => `
    <tr class="${r.status === 'cancelled' ? 'inactive' : ''}">
      <td><b>${esc(r.dispatch_no)}</b></td>
      <td>${new Date(r.dispatched_at).toLocaleString('th-TH')}</td>
      <td>${esc(dropCode[r.drop_id] || '')}</td>
      <td>${esc(bldName[r.building_id] || '')}${r.over_plan ? ' <span class="badge">ส่งเกินแผน</span>' : ''}</td>
      <td>${r.status === 'cancelled'
        ? `<span class="badge">ยกเลิก</span><div class="muted small">${esc(r.cancel_reason)}</div>`
        : '<span class="badge ok">ส่งมอบแล้ว</span>'}</td>
      <td>
        <button class="btn small" data-slip="${r.id}">พิมพ์ใบจ่าย</button>
        ${dsCanWrite() && r.status === 'completed'
          ? `<button class="btn small" style="color:var(--danger)" data-cancel="${r.id}" data-no="${esc(r.dispatch_no)}">ยกเลิก</button>`
          : ''}
      </td>
    </tr>`).join('')
    : '<tr><td colspan="6">ยังไม่มีการจ่ายสินค้า</td></tr>';

  tb.querySelectorAll('[data-slip]').forEach(btn => {
    btn.onclick = () => dsPrintSlip(btn.dataset.slip);
  });
  tb.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.onclick = () => dsCancel(btn.dataset.cancel, btn.dataset.no);
  });
}

async function dsCancel(id, no) {
  const reason = prompt(`ยกเลิกใบจ่าย ${no}\nระบุเหตุผล (ยอดสินค้าจะคืนเข้า Drop และประวัติยังเก็บไว้)`);
  if (reason === null) return;
  if (!reason.trim()) return toast('ต้องระบุเหตุผลการยกเลิก', true);

  const { error } = await sb.rpc('cancel_dispatch', { p_dispatch_id: Number(id), p_reason: reason.trim() });
  if (error) return toast(friendlyError(error), true);
  toast('ยกเลิกแล้ว ยอดคืนเข้า Drop');
  dsLoadHistory();
}

/* ---------- ใบจ่าย A4 สำหรับพิมพ์แนบให้ช่าง ---------- */
async function dsPrintSlip(id) {
  const [h, lines] = await Promise.all([
    sb.from('dispatches').select('*').eq('id', id).single(),
    sb.from('dispatch_lines').select('qty, items(code, name, unit)').eq('dispatch_id', id)
  ]);
  if (h.error) return toast(friendlyError(h.error), true);
  if (lines.error) return toast(friendlyError(lines.error), true);

  const d = h.data;
  const drop = dsDrops.find(x => x.id === d.drop_id);
  const bld = dsBuildings.find(x => x.id === d.building_id);
  const cancelled = d.status === 'cancelled';

  const w = window.open('', '_blank');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', true);

  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
  <title>ใบจ่าย ${esc(d.dispatch_no)}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    body { font-family: "Sarabun","Noto Sans Thai",Tahoma,sans-serif; color:#000; font-size:14px; position:relative; }
    h1 { font-size:20px; text-align:center; margin:0 0 14px; }
    .meta { width:100%; margin-bottom:10px; }
    .meta td { padding:3px 4px; vertical-align:top; }
    table.items { width:100%; border-collapse:collapse; margin-top:8px; }
    table.items th, table.items td { border:1px solid #000; padding:6px; }
    table.items th { background:#eee; }
    .sign { display:flex; justify-content:space-between; margin-top:50px; }
    .sign div { width:30%; text-align:center; }
    .line { border-bottom:1px dotted #000; height:30px; margin-bottom:4px; }
    .stamp { position:absolute; top:40%; left:20%; font-size:60px; color:rgba(180,0,0,.25); transform:rotate(-20deg); font-weight:bold; }
  </style></head><body>
    ${cancelled ? '<div class="stamp">ยกเลิก</div>' : ''}
    <h1>ใบจ่าย / ส่งมอบสินค้าโครงการเฟอร์นิเจอร์</h1>
    <table class="meta">
      <tr><td><b>เลขที่ใบจ่าย:</b> ${esc(d.dispatch_no)}</td>
          <td><b>วันที่:</b> ${new Date(d.dispatched_at).toLocaleString('th-TH')}</td></tr>
      <tr><td><b>จุดต้นทาง:</b> ${esc(drop ? drop.code + ' · ' + drop.name : '')}</td>
          <td><b>อาคารปลายทาง:</b> ${esc(bld ? bld.code + ' · ' + bld.name : '')}</td></tr>
      <tr><td><b>ทีมติดตั้ง/ผู้รับ:</b> ${esc(d.team || '-')}</td>
          <td><b>ผู้จ่าย:</b> ${esc(d.dispatcher)}</td></tr>
      <tr><td colspan="2"><b>หมายเหตุ:</b> ${esc(d.note || '-')}</td></tr>
    </table>
    <table class="items">
      <thead><tr><th style="width:8%">ลำดับ</th><th style="width:18%">รหัสสินค้า</th><th>ชื่อสินค้า</th><th style="width:12%">จำนวน</th><th style="width:10%">หน่วย</th></tr></thead>
      <tbody>${lines.data.map((l, k) => `
        <tr><td>${k + 1}</td><td>${esc(l.items?.code)}</td><td>${esc(l.items?.name)}</td>
            <td style="text-align:right">${num(l.qty)}</td><td>${esc(l.items?.unit)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="sign">
      <div><div class="line"></div>ผู้จ่ายสินค้า<br>${esc(d.dispatcher)}</div>
      <div><div class="line"></div>ผู้รับสินค้า / ช่าง<br>${esc(d.receiver || d.team || '')}</div>
      <div><div class="line"></div>ผู้รับทราบ<br>&nbsp;</div>
    </div>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/* ---------- เมนู 8: ยอดส่งแล้ว / ยังขาด รายอาคาร ---------- */
window.PAGES.progress = async (el) => {
  const [b, p] = await Promise.all([
    sb.from('buildings').select('id, code, name, active').order('code'),
    sb.from('plan_progress').select('*').order('building_code')
  ]);
  if (b.error) throw b.error;
  if (p.error) throw p.error;

  const group = {};
  p.data.forEach(r => {
    if (!group[r.building_id]) group[r.building_id] = { rows: [], req: 0, usable: 0, rem: 0, phys: 0 };
    const g = group[r.building_id];
    g.rows.push(r);
    g.req += Number(r.qty_required);
    g.usable += Number(r.qty_usable);
    g.rem += Number(r.qty_remaining);
    g.phys += Number(r.physical_qty);
  });

  const statusOf = (id) => {
    const g = group[id];
    if (!g) return 'none';
    return g.rem === 0 ? 'done' : 'partial';
  };
  const label = {
    none: '<span class="badge">ยังไม่มีแผน</span>',
    partial: '<span class="badge">ยังส่งไม่ครบ</span>',
    done: '<span class="badge ok">ส่งครบแล้ว</span>'
  };

  const counts = { none: 0, partial: 0, done: 0 };
  b.data.forEach(x => counts[statusOf(x.id)]++);

  el.innerHTML = `
    <div class="page-head"><h1>ติดตามยอดส่งสินค้ารายอาคาร</h1></div>
    <div class="grid stats" style="margin-bottom:16px">
      <div class="stat"><span>ส่งครบแล้ว</span><b>${num(counts.done)}</b></div>
      <div class="stat"><span>ยังส่งไม่ครบ</span><b>${num(counts.partial)}</b></div>
      <div class="stat"><span>ยังไม่มีแผน</span><b>${num(counts.none)}</b></div>
      <div class="stat"><span>อาคารทั้งหมด</span><b>${num(b.data.length)}</b></div>
    </div>
    <div class="card">
      <div class="grid two">
        <label>ค้นหาอาคาร<input id="pg-search" placeholder="รหัสหรือชื่ออาคาร"></label>
        <label>สถานะ
          <select id="pg-filter">
            <option value="">ทั้งหมด</option>
            <option value="partial">ยังส่งไม่ครบ</option>
            <option value="done">ส่งครบแล้ว</option>
            <option value="none">ยังไม่มีแผน</option>
          </select>
        </label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่ออาคาร</th><th>รายการ</th><th>ต้องได้รับ</th><th>ใช้งานได้</th><th>ยังขาด</th><th>จริงในอาคาร</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="pg-rows"></tbody>
      </table></div>
    </div>`;

  const draw = () => {
    const q = $('#pg-search').value.trim().toLowerCase();
    const f = $('#pg-filter').value;
    const rows = b.data.filter(x =>
      (!q || x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) &&
      (!f || statusOf(x.id) === f));

    $('#pg-rows').innerHTML = rows.length ? rows.map(x => {
      const g = group[x.id];
      return `
        <tr class="${x.active ? '' : 'inactive'}">
          <td><b>${esc(x.code)}</b></td>
          <td>${esc(x.name)}</td>
          <td>${g ? g.rows.length : 0}</td>
          <td>${g ? num(g.req) : '-'}</td>
          <td>${g ? num(g.usable) : '-'}</td>
          <td>${g ? num(g.rem) : '-'}</td>
          <td>${g ? num(g.phys) : '-'}</td>
          <td>${label[statusOf(x.id)]}</td>
          <td>${g ? `<button class="btn small" data-detail="${x.id}">รายละเอียด</button>` : ''}</td>
        </tr>`;
    }).join('') : '<tr><td colspan="9">ไม่พบข้อมูล</td></tr>';

    $('#pg-rows').querySelectorAll('[data-detail]').forEach(btn => {
      btn.onclick = () => {
        const bld = b.data.find(x => String(x.id) === btn.dataset.detail);
        const g = group[btn.dataset.detail];
        openModal(`${bld.code} · ${bld.name}`, `
          <div class="table-wrap"><table>
            <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>ต้องได้รับ</th><th>ส่งแล้ว</th><th>ใช้งานได้</th><th>ยังขาด</th><th>จริงในอาคาร</th></tr></thead>
            <tbody>${g.rows.map(r => `
              <tr><td>${esc(r.item_code)}</td><td>${esc(r.item_name)}</td>
                  <td>${num(r.qty_required)}</td><td>${num(r.qty_shipped)}</td>
                  <td>${num(r.qty_usable)}</td><td><b>${num(r.qty_remaining)}</b></td>
                  <td>${num(r.physical_qty)}</td></tr>`).join('')}
            </tbody>
          </table></div>`);
      };
    });
  };

  $('#pg-search').oninput = draw;
  $('#pg-filter').onchange = draw;
  draw();
};
/* ---------- เมนู 7: คงเหลือแยก Drop พร้อมปรับยอดและประวัติ ---------- */
const DS_MOVE_LABEL = {
  receipt: 'รับเข้า',
  dispatch: 'จ่ายออก',
  dispatch_cancel: 'คืนจากการยกเลิกจ่าย',
  adjustment: 'ปรับยอด'
};

window.PAGES.stock = async (el) => {
  const d = await sb.from('drops').select('id, code, name, kind').order('id');
  if (d.error) throw d.error;
  const { data, error } = await sb.from('stock_balance').select('*').order('item_code');
  if (error) throw error;

  const isQuar = (r) => {
    const drop = d.data.find(x => x.id === r.drop_id);
    return drop && drop.kind === 'quarantine';
  };

  el.innerHTML = `
    <div class="page-head"><h1>คงเหลือแยกตามจุด Drop</h1></div>
    <div class="card">
      <div class="grid two">
        <label>ค้นหารหัสหรือชื่อสินค้า<input id="st-search" placeholder="เช่น CH1"></label>
        <label>จุด Drop
          <select id="st-drop">
            <option value="">ทุกจุด</option>
            ${d.data.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}${x.kind === 'quarantine' ? ' (กักกัน)' : ''}</option>`).join('')}
          </select>
        </label>
      </div>
      <h2 style="margin-top:12px">สินค้าพร้อมใช้งาน (Drop)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>Drop</th><th>รับสะสม</th><th>จ่ายออกสะสม</th><th>ปรับยอด</th><th>คงเหลือ</th><th></th></tr></thead>
        <tbody id="st-rows"></tbody>
      </table></div>
    </div>
    <div class="card">
      <h2>สินค้ามีตำหนิในจุดกักกัน</h2>
      <p class="muted small">ยอดนี้ไม่รวมในสินค้าพร้อมใช้งาน และจ่ายให้โครงการใดไม่ได้</p>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>จุดกักกัน</th><th>จำนวนในกักกัน</th></tr></thead>
        <tbody id="st-quar"></tbody>
      </table></div>
    </div>`;

  const draw = () => {
    const q = $('#st-search').value.trim().toLowerCase();
    const drop = $('#st-drop').value;
    const match = (r) => (!q || r.item_code.toLowerCase().includes(q) || r.item_name.toLowerCase().includes(q))
      && (!drop || String(r.drop_id) === drop);

    const normal = data.filter(r => !isQuar(r) && match(r));
    const quar = data.filter(r => isQuar(r) && Number(r.balance) !== 0 && match(r));

    $('#st-rows').innerHTML = normal.length ? normal.map(r => `
      <tr>
        <td><b>${esc(r.item_code)}</b></td>
        <td>${esc(r.item_name)}</td>
        <td>${esc(r.drop_code)}</td>
        <td>${num(r.total_received)}</td>
        <td>${num(r.total_dispatched_net)}</td>
        <td>${num(r.total_adjusted)}</td>
        <td><b>${num(r.balance)}</b> ${esc(r.unit)}</td>
        <td>
          <button class="btn small" data-moves="${r.item_id}|${r.drop_id}">ประวัติ</button>
          ${dsCanWrite() ? `<button class="btn small" data-adj="${r.item_id}|${r.drop_id}">ปรับยอด</button>` : ''}
        </td>
      </tr>`).join('')
      : '<tr><td colspan="8">ไม่พบข้อมูล</td></tr>';

    $('#st-quar').innerHTML = quar.length ? quar.map(r => `
      <tr>
        <td><b>${esc(r.item_code)}</b></td>
        <td>${esc(r.item_name)}</td>
        <td>${esc(r.drop_code)}</td>
        <td><b>${num(r.balance)}</b> ${esc(r.unit)}</td>
      </tr>`).join('')
      : '<tr><td colspan="4">ไม่มีสินค้ามีตำหนิในจุดกักกัน</td></tr>';

    const find = (v) => {
      const [itemId, dropId] = v.split('|');
      return data.find(r => String(r.item_id) === itemId && String(r.drop_id) === dropId);
    };
    $('#st-rows').querySelectorAll('[data-moves]').forEach(btn => {
      btn.onclick = () => dsShowMoves(find(btn.dataset.moves));
    });
    $('#st-rows').querySelectorAll('[data-adj]').forEach(btn => {
      btn.onclick = () => dsOpenAdjust(find(btn.dataset.adj));
    });
  };

  $('#st-search').oninput = draw;
  $('#st-drop').onchange = draw;
  draw();
};

function dsOpenAdjust(row) {
  openModal(`ปรับยอด ${row.item_code} ที่ ${row.drop_code}`, `
    <p class="muted small">คงเหลือปัจจุบัน ${num(row.balance)} ${esc(row.unit)}</p>
    <form id="ds-adj-form">
      <label>จำนวนที่ปรับ * (ใส่ + เพื่อเพิ่ม หรือ - เพื่อลด)
        <input name="qty" type="number" step="1" required>
      </label>
      <label>เหตุผล *<textarea name="reason" rows="2" required></textarea></label>
      <div class="actions">
        <button type="button" class="btn" onclick="closeModal()">ยกเลิก</button>
        <button class="btn primary" type="submit">บันทึกการปรับยอด</button>
      </div>
    </form>`);

  $('#ds-adj-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qty = Number(fd.get('qty'));
    if (!Number.isInteger(qty) || qty === 0) {
      return toast('จำนวนปรับต้องเป็นจำนวนเต็มและไม่เป็น 0', true);
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    const { error } = await sb.rpc('adjust_stock', {
      p_item_id: row.item_id,
      p_drop_id: row.drop_id,
      p_qty: qty,
      p_reason: fd.get('reason').trim()
    });
    btn.disabled = false;
    if (error) return toast(friendlyError(error), true);
    closeModal();
    toast('ปรับยอดแล้ว');
    window.PAGES.stock($('#content'));
  };
}

async function dsShowMoves(row) {
  const { data, error } = await sb.from('stock_movements')
    .select('created_at, movement_type, qty, reason, ref_table, ref_id')
    .eq('drop_id', row.drop_id).eq('item_id', row.item_id)
    .order('created_at', { ascending: false }).limit(50);
  if (error) return toast(friendlyError(error), true);

  const refText = (m) => {
    if (m.ref_table === 'receipts') return `ใบรับ #${m.ref_id}`;
    if (m.ref_table === 'dispatches') return `ใบจ่าย #${m.ref_id}`;
    return m.reason || '-';
  };

  openModal(`ประวัติ ${row.item_code} ที่ ${row.drop_code}`, `
    <div class="table-wrap"><table>
      <thead><tr><th>วันเวลา</th><th>รายการ</th><th>จำนวน</th><th>อ้างอิง / เหตุผล</th></tr></thead>
      <tbody>${data.length ? data.map(m => `
        <tr>
          <td>${new Date(m.created_at).toLocaleString('th-TH')}</td>
          <td>${esc(DS_MOVE_LABEL[m.movement_type] || m.movement_type)}</td>
          <td style="color:${m.qty < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</td>
          <td>${esc(refText(m))}${m.movement_type !== 'receipt' && m.reason ? `<div class="muted small">${esc(m.reason)}</div>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="4">ยังไม่มีประวัติ</td></tr>'}
      </tbody>
    </table></div>`);
}