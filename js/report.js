/* ส่วนที่ 6: Dashboard (เมนู 1), ประวัติธุรกรรม (เมนู 9), รายงานและพิมพ์ (เมนู 10) */

const MOVE_LABEL = {
  receipt: 'รับเข้า',
  dispatch: 'จ่ายออก',
  dispatch_cancel: 'คืนจากการยกเลิกจ่าย',
  adjustment: 'ปรับยอด'
};

const REPORTS = [
  { key: 'receipt_lines', label: 'รายงานรับสินค้า', note: 'กรองตามวันที่และจุด Drop ได้' },
  { key: 'dispatch_lines', label: 'รายงานจ่ายสินค้า (รวมรายการที่ยกเลิก)', note: 'กรองตามวันที่และจุด Drop ได้' },
  { key: 'balance', label: 'รายงานคงเหลือแยกตาม Drop', note: 'เป็นยอดปัจจุบัน ไม่กรองตามวันที่' },
  { key: 'plan', label: 'รายงานแผนเทียบยอดส่งจริงรายอาคาร', note: 'เป็นยอดปัจจุบัน ไม่กรองตามวันที่' },
  { key: 'incomplete', label: 'รายงานสินค้าและอาคารที่ยังส่งไม่ครบ', note: 'เป็นยอดปัจจุบัน ไม่กรองตามวันที่' },
  { key: 'receipt_docs', label: 'พิมพ์ใบรับสินค้า (รายการเอกสาร)', note: 'กดพิมพ์ทีละใบ หรือดูรูปหลักฐาน' },
  { key: 'dispatch_docs', label: 'พิมพ์ใบจ่ายสินค้า (รายการเอกสาร)', note: 'กดพิมพ์ทีละใบ หรือดูรูปหลักฐาน' }
];

/* ---------- ฟังก์ชันช่วย ---------- */
const fmtDate = (v) => (v ? new Date(v).toLocaleString('th-TH') : '-');

function dateRangeHtml(prefix) {
  return `
    <label>ตั้งแต่วันที่<input type="date" id="${prefix}-from"></label>
    <label>ถึงวันที่<input type="date" id="${prefix}-to"></label>`;
}

function readRange(prefix) {
  const f = $(`#${prefix}-from`).value;
  const t = $(`#${prefix}-to`).value;
  return {
    from: f ? new Date(f + 'T00:00:00').toISOString() : null,
    to: t ? new Date(t + 'T23:59:59.999').toISOString() : null
  };
}

function applyRange(q, column, range) {
  if (range.from) q = q.gte(column, range.from);
  if (range.to) q = q.lte(column, range.to);
  return q;
}

function dropOptions(drops) {
  return '<option value="">ทุกจุด</option>' +
    drops.map(d => `<option value="${d.id}">${esc(d.code)} · ${esc(d.name)}</option>`).join('');
}

function downloadCsv(name, headers, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  // \uFEFF ช่วยให้ Excel อ่านภาษาไทยถูกต้อง
  const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

function printDoc(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต pop-up', true);
  w.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8">
  <title>${esc(title)}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    body { font-family: "Sarabun","Noto Sans Thai",Tahoma,sans-serif; color:#000; font-size:13px; }
    h1 { font-size:18px; text-align:center; margin:0 0 12px; }
    table { width:100%; border-collapse:collapse; margin-top:8px; }
    th, td { border:1px solid #000; padding:5px; vertical-align:top; }
    th { background:#eee; }
    table.meta td { border:none; padding:2px 4px; }
    .sign { display:flex; justify-content:space-between; margin-top:40px; }
    .sign div { width:30%; text-align:center; }
    .line { border-bottom:1px dotted #000; height:28px; margin-bottom:4px; }
  </style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// แปลงรหัสอ้างอิงในประวัติให้เป็นเลขที่เอกสาร (ใบรับ/ใบจ่าย)
async function refResolver(movs) {
  const rIds = [...new Set(movs.filter(m => m.ref_table === 'receipts').map(m => m.ref_id))];
  const dIds = [...new Set(movs.filter(m => m.ref_table === 'dispatches').map(m => m.ref_id))];
  const map = {};
  if (rIds.length) {
    const { data } = await sb.from('receipts').select('id, receipt_no').in('id', rIds);
    (data || []).forEach(x => { map['R' + x.id] = x.receipt_no; });
  }
  if (dIds.length) {
    const { data } = await sb.from('dispatches').select('id, dispatch_no').in('id', dIds);
    (data || []).forEach(x => { map['D' + x.id] = x.dispatch_no; });
  }
  return (m) => m.ref_table === 'receipts' ? (map['R' + m.ref_id] || '')
    : m.ref_table === 'dispatches' ? (map['D' + m.ref_id] || '')
    : (m.reason || '');
}

async function showDispatchPhotos(paths) {
  if (!paths || !paths.length) return toast('ใบจ่ายนี้ไม่มีรูปหลักฐาน', true);
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  const imgs = (data || []).filter(x => x.signedUrl);
  openModal('รูปหลักฐานการส่งมอบ', imgs.length
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${imgs.map(p =>
        `<a href="${esc(p.signedUrl)}" target="_blank"><img class="thumb" style="width:120px;height:120px" src="${esc(p.signedUrl)}" alt=""></a>`).join('')}</div>`
    : '<p class="muted">ไม่พบรูป</p>');
}

/* ---------- เมนู 1: Dashboard ---------- */
window.PAGES.dashboard = async (el) => {
  el.innerHTML = `
    <div class="page-head"><h1>ภาพรวมโครงการ</h1></div>
    <div class="card">
      <div class="grid two">${dateRangeHtml('db')}</div>
      <p class="muted small">ช่วงวันที่ใช้กับประวัติรับและจ่ายด้านล่างเท่านั้น ยอดคงเหลือและยอดแผนแสดงสถานะปัจจุบันเสมอ</p>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="db-apply">ดูข้อมูล</button>
        <button class="btn" id="db-clear">ล้างวันที่</button>
      </div>
    </div>
    <div id="db-body">กำลังโหลด...</div>`;
  $('#db-apply').onclick = () => loadDashboard();
  $('#db-clear').onclick = () => { $('#db-from').value = ''; $('#db-to').value = ''; loadDashboard(); };
  await loadDashboard();
};

async function loadDashboard() {
  const body = $('#db-body');
  body.innerHTML = 'กำลังโหลด...';
  const range = readRange('db');

  let rq = applyRange(sb.from('receipts')
    .select('receipt_no, received_at, po_ref, inspector, drop_id'), 'received_at', range)
    .order('received_at', { ascending: false }).limit(15);
  let dq = applyRange(sb.from('dispatches')
    .select('dispatch_no, dispatched_at, status, drop_id, building_id'), 'dispatched_at', range)
    .order('dispatched_at', { ascending: false }).limit(15);

  try {
    const [bal, plan, blds, rc, dp, drops] = await Promise.all([
      sb.from('stock_balance').select('*'),
      sb.from('plan_progress').select('*'),
      sb.from('buildings').select('id, code, name').eq('active', true).order('code'),
      rq, dq,
      sb.from('drops').select('id, code')
    ]);
    for (const x of [bal, plan, blds, rc, dp, drops]) if (x.error) throw x.error;

    const sum = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);
    const totalReceived = sum(bal.data, x => x.total_received);
    const totalDispatched = sum(bal.data, x => x.total_dispatched_net);
    const totalBalance = sum(bal.data, x => x.balance);

    // สถานะรายอาคาร
    const byB = new Map();
    plan.data.forEach(r => {
      if (!byB.has(r.building_id)) byB.set(r.building_id, { required: 0, shipped: 0, remaining: 0, lines: 0 });
      const g = byB.get(r.building_id);
      g.required += Number(r.qty_required);
      g.shipped += Number(r.qty_shipped);
      g.remaining += Math.max(Number(r.qty_remaining), 0);
      g.lines++;
    });
    const complete = blds.data.filter(b => byB.has(b.id) && byB.get(b.id).remaining === 0);
    const incomplete = blds.data.filter(b => byB.has(b.id) && byB.get(b.id).remaining > 0);
    const noPlan = blds.data.filter(b => !byB.has(b.id));

    // สินค้าที่ยอดคงเหลือรวมไม่พอต่อแผนที่ยังค้างส่ง
    const itemMap = new Map();
    const ensure = (r) => {
      if (!itemMap.has(r.item_id)) itemMap.set(r.item_id, { code: r.item_code, name: r.item_name, unit: r.unit, balance: 0, need: 0 });
      return itemMap.get(r.item_id);
    };
    bal.data.forEach(r => { ensure(r).balance += Number(r.balance); });
    plan.data.forEach(r => { ensure(r).need += Math.max(Number(r.qty_remaining), 0); });
    const shortItems = [...itemMap.values()]
      .filter(x => x.need > x.balance)
      .map(x => ({ ...x, short: x.need - x.balance }))
      .sort((a, b) => b.short - a.short);

    const dropCode = Object.fromEntries(drops.data.map(d => [d.id, d.code]));
    const bldCode = Object.fromEntries(blds.data.map(b => [b.id, b.code + ' · ' + b.name]));
    const totalRemaining = [...byB.values()].reduce((s, g) => s + g.remaining, 0);

    body.innerHTML = `
      <div class="grid stats" style="margin-bottom:16px">
        <div class="stat"><span>รับเข้าทั้งหมด (ชิ้น)</span><b>${num(totalReceived)}</b></div>
        <div class="stat"><span>จ่ายออกสุทธิ (ชิ้น)</span><b>${num(totalDispatched)}</b></div>
        <div class="stat"><span>คงเหลือรวมทุก Drop</span><b>${num(totalBalance)}</b></div>
        <div class="stat"><span>อาคารส่งครบแล้ว</span><b>${num(complete.length)} / ${num(blds.data.length)}</b></div>
      </div>
      <div class="grid stats" style="margin-bottom:16px">
        <div class="stat"><span>อาคารยังส่งไม่ครบ</span><b>${num(incomplete.length)}</b></div>
        <div class="stat"><span>ยอดยังต้องส่งรวม (ชิ้น)</span><b>${num(totalRemaining)}</b></div>
        <div class="stat"><span>สินค้าไม่พอต่อแผน</span><b>${num(shortItems.length)}</b></div>
        <div class="stat"><span>อาคารที่ยังไม่มีแผน</span><b>${num(noPlan.length)}</b></div>
      </div>

      <div class="grid two">
        <div class="card">
          <h2>อาคารที่ยังส่งไม่ครบ</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>รหัส</th><th>ชื่ออาคาร</th><th>ยังขาด (ชิ้น)</th></tr></thead>
            <tbody>${incomplete.length ? incomplete.slice(0, 30).map(b => `
              <tr><td><b>${esc(b.code)}</b></td><td>${esc(b.name)}</td>
                  <td>${num(byB.get(b.id).remaining)}</td></tr>`).join('')
              : '<tr><td colspan="3">ส่งครบทุกอาคารแล้ว</td></tr>'}</tbody>
          </table></div>
          ${incomplete.length > 30 ? `<p class="muted small">แสดง 30 แห่งแรก จากทั้งหมด ${incomplete.length} แห่ง</p>` : ''}
        </div>
        <div class="card">
          <h2>สินค้าที่เหลือไม่พอต่อแผน</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>คงเหลือรวม</th><th>ยังต้องส่ง</th><th>ขาด</th></tr></thead>
            <tbody>${shortItems.length ? shortItems.slice(0, 30).map(x => `
              <tr><td><b>${esc(x.code)}</b></td><td>${esc(x.name)}</td>
                  <td>${num(x.balance)}</td><td>${num(x.need)}</td>
                  <td style="color:var(--danger)"><b>${num(x.short)}</b></td></tr>`).join('')
              : '<tr><td colspan="5">สินค้ามีเพียงพอต่อแผน</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>

      <div class="grid two">
        <div class="card">
          <h2>การรับสินค้าล่าสุด (ตามช่วงวันที่)</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>เลขที่</th><th>วันที่</th><th>Drop</th><th>PO</th><th>ผู้ตรวจรับ</th></tr></thead>
            <tbody>${rc.data.length ? rc.data.map(r => `
              <tr><td>${esc(r.receipt_no)}</td><td>${fmtDate(r.received_at)}</td>
                  <td>${esc(dropCode[r.drop_id])}</td><td>${esc(r.po_ref)}</td><td>${esc(r.inspector)}</td></tr>`).join('')
              : '<tr><td colspan="5">ไม่มีรายการในช่วงนี้</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h2>การจ่ายสินค้าล่าสุด (ตามช่วงวันที่)</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>เลขที่</th><th>วันที่</th><th>Drop</th><th>อาคาร</th><th>สถานะ</th></tr></thead>
            <tbody>${dp.data.length ? dp.data.map(r => `
              <tr class="${r.status === 'cancelled' ? 'inactive' : ''}">
                <td>${esc(r.dispatch_no)}</td><td>${fmtDate(r.dispatched_at)}</td>
                <td>${esc(dropCode[r.drop_id])}</td><td>${esc(bldCode[r.building_id])}</td>
                <td>${esc(STATUS_LABEL[r.status] || r.status)}</td></tr>`).join('')
              : '<tr><td colspan="5">ไม่มีรายการในช่วงนี้</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<div class="card error">${esc(friendlyError(e))}</div>`;
  }
}

/* ---------- เมนู 9: ประวัติธุรกรรม ---------- */
window.PAGES.history = async (el) => {
  const d = await sb.from('drops').select('id, code, name').order('id');
  if (d.error) throw d.error;

  el.innerHTML = `
    <div class="page-head"><h1>ประวัติธุรกรรม</h1>
      <button class="btn" id="hs-csv">ส่งออก Excel/CSV</button></div>
    <div class="card">
      <div class="grid two">
        <label>ค้นหารหัสหรือชื่อสินค้า<input id="hs-q" placeholder="เช่น MGR1"></label>
        <label>ประเภทรายการ
          <select id="hs-type">
            <option value="">ทั้งหมด</option>
            ${Object.entries(MOVE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </label>
        <label>จุด Drop<select id="hs-drop">${dropOptions(d.data)}</select></label>
        ${dateRangeHtml('hs')}
      </div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="hs-go">ค้นหา</button>
      </div>
    </div>
    <div class="card">
      <p class="muted small" id="hs-count"></p>
      <div class="table-wrap"><table>
        <thead><tr><th>วันเวลา</th><th>ประเภท</th><th>Drop</th><th>รหัส</th><th>ชื่อสินค้า</th><th>จำนวน</th><th>อ้างอิง / เหตุผล</th></tr></thead>
        <tbody id="hs-rows"><tr><td colspan="7">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;

  let last = [];
  const run = async () => {
    const range = readRange('hs');
    const type = $('#hs-type').value;
    const drop = $('#hs-drop').value;
    const q = $('#hs-q').value.trim().toLowerCase();
    $('#hs-rows').innerHTML = '<tr><td colspan="7">กำลังโหลด...</td></tr>';

    let qb = sb.from('stock_movements')
      .select('created_at, movement_type, qty, reason, ref_table, ref_id, drop_id, items(code, name, unit), drops(code)');
    if (type) qb = qb.eq('movement_type', type);
    if (drop) qb = qb.eq('drop_id', drop);
    qb = applyRange(qb, 'created_at', range);
    const { data, error } = await qb.order('created_at', { ascending: false }).limit(1000);
    if (error) return toast(friendlyError(error), true);

    const refOf = await refResolver(data);
    const rows = data.filter(m => !q ||
      (m.items?.code || '').toLowerCase().includes(q) ||
      (m.items?.name || '').toLowerCase().includes(q));

    last = rows.map(m => [
      fmtDate(m.created_at), MOVE_LABEL[m.movement_type] || m.movement_type,
      m.drops?.code || '', m.items?.code || '', m.items?.name || '', m.qty, refOf(m)
    ]);

    $('#hs-count').textContent = `พบ ${num(rows.length)} รายการ (แสดงสูงสุด 1,000 รายการล่าสุด)`;
    $('#hs-rows').innerHTML = rows.length ? rows.map((m, k) => `
      <tr>
        <td>${last[k][0]}</td>
        <td>${esc(last[k][1])}</td>
        <td>${esc(last[k][2])}</td>
        <td><b>${esc(last[k][3])}</b></td>
        <td>${esc(last[k][4])}</td>
        <td style="color:${m.qty < 0 ? 'var(--danger)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${num(m.qty)}</td>
        <td>${esc(last[k][6])}</td>
      </tr>`).join('')
      : '<tr><td colspan="7">ไม่พบข้อมูล</td></tr>';
  };

  $('#hs-go').onclick = run;
  $('#hs-csv').onclick = () => {
    if (!last.length) return toast('ไม่มีข้อมูลให้ส่งออก', true);
    downloadCsv('ประวัติธุรกรรม.csv',
      ['วันเวลา', 'ประเภท', 'Drop', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'อ้างอิง/เหตุผล'], last);
  };
  run();
};

/* ---------- เมนู 10: รายงานและพิมพ์เอกสาร ---------- */
window.PAGES.reports = async (el) => {
  const d = await sb.from('drops').select('id, code, name').order('id');
  if (d.error) throw d.error;

  el.innerHTML = `
    <div class="page-head"><h1>รายงานและพิมพ์เอกสาร</h1></div>
    <div class="card">
      <div class="grid two">
        <label>ประเภทรายงาน
          <select id="rp-type">${REPORTS.map(r => `<option value="${r.key}">${r.label}</option>`).join('')}</select>
        </label>
        <label>จุด Drop<select id="rp-drop">${dropOptions(d.data)}</select></label>
        ${dateRangeHtml('rp')}
      </div>
      <p class="muted small" id="rp-note"></p>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="rp-run">ดูรายงาน</button>
        <button class="btn" id="rp-csv">ส่งออก Excel/CSV</button>
        <button class="btn" id="rp-print">พิมพ์ A4</button>
      </div>
    </div>
    <div class="card" id="rp-out"></div>`;

  let current = null;
  const reportLabel = () => REPORTS.find(r => r.key === $('#rp-type').value)?.label || '';

  const syncNote = () => {
    const r = REPORTS.find(x => x.key === $('#rp-type').value);
    $('#rp-note').textContent = r ? r.note : '';
  };

  const run = async () => {
    const key = $('#rp-type').value;
    const range = readRange('rp');
    const dropId = $('#rp-drop').value;
    const out = $('#rp-out');
    syncNote();
    out.innerHTML = 'กำลังโหลด...';
    current = null;
    try {
      if (key === 'receipt_docs') return await renderReceiptDocs(out, range, dropId);
      if (key === 'dispatch_docs') return await renderDispatchDocs(out, range, dropId);
      current = await fetchReport(key, range, dropId);
      const tableHtml = `
        <div class="table-wrap"><table>
          <thead><tr>${current.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${current.rows.length ? current.rows.map(r =>
            `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${current.headers.length}">ไม่พบข้อมูล</td></tr>`}</tbody>
        </table></div>`;
      current.html = tableHtml;
      out.innerHTML = `
        <p class="muted small">พบ ${num(current.rows.length)} แถว${current.rows.length >= 1000 ? ' (แสดงสูงสุด 1,000 แถว ให้กรองให้แคบลง)' : ''}</p>
        ${tableHtml}`;
    } catch (e) {
      out.innerHTML = `<div class="error">${esc(friendlyError(e))}</div>`;
    }
  };

  $('#rp-run').onclick = run;
  $('#rp-type').onchange = () => { syncNote(); $('#rp-out').innerHTML = ''; current = null; };
  $('#rp-csv').onclick = () => {
    if (!current) return toast('รายงานประเภทนี้ไม่มีไฟล์ CSV ให้ใช้ปุ่มพิมพ์ในรายการ', true);
    if (!current.rows.length) return toast('ไม่มีข้อมูลให้ส่งออก', true);
    downloadCsv(`${reportLabel()}.csv`, current.headers, current.rows);
  };
  $('#rp-print').onclick = () => {
    if (!current) return toast('กรุณากดดูรายงานก่อนพิมพ์', true);
    const range = readRange('rp');
    const period = `ช่วงวันที่: ${$('#rp-from').value || 'ทั้งหมด'} ถึง ${$('#rp-to').value || 'ปัจจุบัน'}`;
    printDoc(reportLabel(), `
      <h1>${esc(reportLabel())}</h1>
      <p>${esc(period)} · พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</p>
      ${current.html}`);
  };

  syncNote();
};

async function fetchReport(key, range, dropId) {
  const [drops, blds] = await Promise.all([
    sb.from('drops').select('id, code'),
    sb.from('buildings').select('id, code, name')
  ]);
  if (drops.error) throw drops.error;
  if (blds.error) throw blds.error;
  const dropMap = Object.fromEntries(drops.data.map(x => [x.id, x.code]));
  const bldMap = Object.fromEntries(blds.data.map(x => [x.id, x.code + ' · ' + x.name]));

  if (key === 'receipt_lines') {
    let q = sb.from('receipt_lines').select(
      'qty, items(code, name, unit), receipts!inner(receipt_no, received_at, po_ref, transport_ref, inspector, drop_id)');
    q = applyRange(q, 'receipts.received_at', range);
    if (dropId) q = q.eq('receipts.drop_id', dropId);
    const { data, error } = await q.limit(1000);
    if (error) throw error;
    const rows = data
      .sort((a, b) => new Date(a.receipts.received_at) - new Date(b.receipts.received_at))
      .map(x => [x.receipts.receipt_no, fmtDate(x.receipts.received_at), dropMap[x.receipts.drop_id] || '',
        x.receipts.po_ref || '', x.receipts.transport_ref || '', x.receipts.inspector || '',
        x.items?.code || '', x.items?.name || '', x.qty, x.items?.unit || '']);
    return {
      headers: ['เลขที่รับ', 'วันที่', 'Drop', 'PO', 'ตู้/รถ', 'ผู้ตรวจรับ', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'หน่วย'],
      rows
    };
  }

  if (key === 'dispatch_lines') {
    let q = sb.from('dispatch_lines').select(
      'qty, items(code, name, unit), dispatches!inner(dispatch_no, dispatched_at, status, drop_id, building_id, team, dispatcher)');
    q = applyRange(q, 'dispatches.dispatched_at', range);
    if (dropId) q = q.eq('dispatches.drop_id', dropId);
    const { data, error } = await q.limit(1000);
    if (error) throw error;
    const rows = data
      .sort((a, b) => new Date(a.dispatches.dispatched_at) - new Date(b.dispatches.dispatched_at))
      .map(x => [x.dispatches.dispatch_no, fmtDate(x.dispatches.dispatched_at),
        STATUS_LABEL[x.dispatches.status] || x.dispatches.status,
        dropMap[x.dispatches.drop_id] || '', bldMap[x.dispatches.building_id] || '',
        x.items?.code || '', x.items?.name || '', x.qty, x.items?.unit || '',
        x.dispatches.dispatcher || '', x.dispatches.team || '']);
    return {
      headers: ['เลขที่จ่าย', 'วันที่', 'สถานะ', 'Drop', 'อาคาร', 'รหัสสินค้า', 'ชื่อสินค้า', 'จำนวน', 'หน่วย', 'ผู้จ่าย', 'ทีม/ผู้รับ'],
      rows
    };
  }

  if (key === 'balance') {
    let q = sb.from('stock_balance').select('*').order('drop_code').order('item_code');
    if (dropId) q = q.eq('drop_id', dropId);
    const { data, error } = await q;
    if (error) throw error;
    return {
      headers: ['รหัสสินค้า', 'ชื่อสินค้า', 'Drop', 'รับสะสม', 'จ่ายออกสะสม', 'ปรับยอด', 'คงเหลือ', 'หน่วย'],
      rows: data.map(r => [r.item_code, r.item_name, r.drop_code, r.total_received,
        r.total_dispatched_net, r.total_adjusted, r.balance, r.unit])
    };
  }

  if (key === 'plan' || key === 'incomplete') {
    let q = sb.from('plan_progress').select('*').order('building_code').order('item_code');
    if (key === 'incomplete') q = q.gt('qty_remaining', 0);
    const { data, error } = await q;
    if (error) throw error;
    return {
      headers: ['รหัสอาคาร', 'ชื่ออาคาร', 'รหัสสินค้า', 'ชื่อสินค้า', 'ต้องได้รับ', 'ส่งแล้ว', 'ยังขาด', '% ความคืบหน้า'],
      rows: data.map(r => [r.building_code, r.building_name, r.item_code, r.item_name,
        r.qty_required, r.qty_shipped, Math.max(r.qty_remaining, 0), r.percent_done ?? 0])
    };
  }

  throw new Error('ไม่รู้จักประเภทรายงานนี้');
}

// รายการใบรับ สำหรับพิมพ์และดูรูปหลักฐาน
async function renderReceiptDocs(out, range, dropId) {
  let q = sb.from('receipts')
    .select('id, receipt_no, received_at, po_ref, transport_ref, inspector, drop_id, image_paths, supplier_doc, note');
  q = applyRange(q, 'received_at', range);
  if (dropId) q = q.eq('drop_id', dropId);
  const { data, error } = await q.order('received_at', { ascending: false }).limit(200);
  if (error) throw error;

  const drops = await sb.from('drops').select('id, code');
  const dropMap = Object.fromEntries((drops.data || []).map(x => [x.id, x.code]));
  const byId = new Map(data.map(r => [String(r.id), r]));

  out.innerHTML = `
    <p class="muted small">พบ ${num(data.length)} ใบ (แสดงสูงสุด 200 ใบล่าสุด)</p>
    <div class="table-wrap"><table>
      <thead><tr><th>เลขที่รับ</th><th>วันที่</th><th>Drop</th><th>PO</th><th>ตู้/รถ</th><th>ผู้ตรวจรับ</th><th>รูป</th><th></th></tr></thead>
      <tbody>${data.length ? data.map(r => `
        <tr>
          <td><b>${esc(r.receipt_no)}</b></td>
          <td>${fmtDate(r.received_at)}</td>
          <td>${esc(dropMap[r.drop_id])}</td>
          <td>${esc(r.po_ref)}</td>
          <td>${esc(r.transport_ref)}</td>
          <td>${esc(r.inspector)}</td>
          <td>${(r.image_paths || []).length || '-'}</td>
          <td>
            <button class="btn small" data-rprint="${r.id}">พิมพ์</button>
            <button class="btn small" data-rphoto="${r.id}">รูป</button>
          </td>
        </tr>`).join('')
        : '<tr><td colspan="8">ไม่พบใบรับในช่วงนี้</td></tr>'}</tbody>
    </table></div>`;

  out.querySelectorAll('[data-rprint]').forEach(b => b.onclick = () => printReceiptSlip(b.dataset.rprint));
  out.querySelectorAll('[data-rphoto]').forEach(b => b.onclick = () => showReceipt(byId.get(b.dataset.rphoto)));
}

// รายการใบจ่าย สำหรับพิมพ์และดูรูปหลักฐานการส่งมอบ
async function renderDispatchDocs(out, range, dropId) {
  let q = sb.from('dispatches')
    .select('id, dispatch_no, dispatched_at, status, drop_id, building_id, proof_paths, dispatcher');
  q = applyRange(q, 'dispatched_at', range);
  if (dropId) q = q.eq('drop_id', dropId);
  const { data, error } = await q.order('dispatched_at', { ascending: false }).limit(200);
  if (error) throw error;

  const [drops, blds] = await Promise.all([
    sb.from('drops').select('id, code'),
    sb.from('buildings').select('id, code, name')
  ]);
  const dropMap = Object.fromEntries((drops.data || []).map(x => [x.id, x.code]));
  const bldMap = Object.fromEntries((blds.data || []).map(x => [x.id, x.code + ' · ' + x.name]));
  const byId = new Map(data.map(r => [String(r.id), r]));

  out.innerHTML = `
    <p class="muted small">พบ ${num(data.length)} ใบ (แสดงสูงสุด 200 ใบล่าสุด) ใบที่ยกเลิกจะมีตราประทับ "ยกเลิก" เมื่อพิมพ์</p>
    <div class="table-wrap"><table>
      <thead><tr><th>เลขที่จ่าย</th><th>วันที่</th><th>Drop</th><th>อาคาร</th><th>สถานะ</th><th>รูป</th><th></th></tr></thead>
      <tbody>${data.length ? data.map(r => `
        <tr class="${r.status === 'cancelled' ? 'inactive' : ''}">
          <td><b>${esc(r.dispatch_no)}</b></td>
          <td>${fmtDate(r.dispatched_at)}</td>
          <td>${esc(dropMap[r.drop_id])}</td>
          <td>${esc(bldMap[r.building_id])}</td>
          <td>${esc(STATUS_LABEL[r.status] || r.status)}</td>
          <td>${(r.proof_paths || []).length || '-'}</td>
          <td>
            <button class="btn small" data-dprint="${r.id}">พิมพ์</button>
            <button class="btn small" data-dphoto="${r.id}">รูป</button>
          </td>
        </tr>`).join('')
        : '<tr><td colspan="7">ไม่พบใบจ่ายในช่วงนี้</td></tr>'}</tbody>
    </table></div>`;

  out.querySelectorAll('[data-dprint]').forEach(b => b.onclick = () => dsPrintSlip(b.dataset.dprint));
  out.querySelectorAll('[data-dphoto]').forEach(b =>
    b.onclick = () => showDispatchPhotos(byId.get(b.dataset.dphoto).proof_paths));
}

async function printReceiptSlip(id) {
  const [h, lines, drops] = await Promise.all([
    sb.from('receipts').select('*').eq('id', id).single(),
    sb.from('receipt_lines').select('qty, items(code, name, unit)').eq('receipt_id', id),
    sb.from('drops').select('id, code, name')
  ]);
  if (h.error) return toast(friendlyError(h.error), true);
  if (lines.error) return toast(friendlyError(lines.error), true);

  const r = h.data;
  const drop = (drops.data || []).find(x => x.id === r.drop_id);
  printDoc(`ใบรับ ${r.receipt_no}`, `
    <h1>ใบรับสินค้าเข้าโครงการเฟอร์นิเจอร์</h1>
    <table class="meta">
      <tr><td><b>เลขที่รับ:</b> ${esc(r.receipt_no)}</td><td><b>วันที่รับ:</b> ${fmtDate(r.received_at)}</td></tr>
      <tr><td><b>จุด Drop:</b> ${esc(drop ? drop.code + ' · ' + drop.name : '')}</td><td><b>PO / อ้างอิง:</b> ${esc(r.po_ref || '-')}</td></tr>
      <tr><td><b>ตู้ / เที่ยวรถ:</b> ${esc(r.transport_ref || '-')}</td><td><b>เลขที่เอกสารซัพพลายเออร์:</b> ${esc(r.supplier_doc || '-')}</td></tr>
      <tr><td colspan="2"><b>หมายเหตุ:</b> ${esc(r.note || '-')}</td></tr>
    </table>
    <table>
      <thead><tr><th style="width:8%">ลำดับ</th><th style="width:18%">รหัส</th><th>ชื่อสินค้า</th><th style="width:12%">จำนวน</th><th style="width:10%">หน่วย</th></tr></thead>
      <tbody>${lines.data.map((l, k) => `
        <tr><td>${k + 1}</td><td>${esc(l.items?.code)}</td><td>${esc(l.items?.name)}</td>
            <td style="text-align:right">${num(l.qty)}</td><td>${esc(l.items?.unit)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="sign">
      <div><div class="line"></div>ผู้ตรวจรับ<br>${esc(r.inspector)}</div>
      <div><div class="line"></div>ผู้ส่งของ / ซัพพลายเออร์</div>
      <div><div class="line"></div>ผู้รับทราบ</div>
    </div>`);
}