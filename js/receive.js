/* ส่วนที่ 4: รับสินค้าเข้า Drop (เมนู 5) และคงเหลือแยก Drop (เมนู 7) */
let recvDrops = [];
let recvItems = [];
let stockCache = [];

const canWrite = () => state.role === 'admin' || state.role === 'warehouse';

function localNowValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/* ---------- เมนู 5: รับสินค้าเข้า ---------- */
window.PAGES.receive = async (el) => {
  const [d, i] = await Promise.all([
    sb.from('drops').select('id, code, name, active').order('id'),
    sb.from('items').select('id, code, name, unit, active').order('code')
  ]);
  if (d.error) throw d.error;
  if (i.error) throw i.error;
  recvDrops = d.data;
  recvItems = i.data;

  el.innerHTML = `
    <div class="page-head"><h1>รับสินค้าเข้า Drop</h1></div>
    ${canWrite() ? `
    <div class="card">
      <h2>บันทึกใบรับใหม่</h2>
      <form id="rc-form">
        <div class="grid two">
          <label>วันเวลารับสินค้า<input type="datetime-local" name="received_at" value="${localNowValue()}" required></label>
          <label>จุด Drop ที่รับ *
            <select name="drop" required>
              <option value="">-- เลือก --</option>
              ${recvDrops.filter(x => x.active).map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}
            </select>
          </label>
          <label>เลขที่ PO / อ้างอิง<input name="po"></label>
          <label>ตู้คอนเทนเนอร์ / เที่ยวรถ<input name="transport"></label>
          <label>ผู้ตรวจรับ *<input name="inspector" required></label>
          <label>เลขที่เอกสารซัพพลายเออร์<input name="supplier_doc"></label>
        </div>
        <label>หมายเหตุ<textarea name="note" rows="2"></textarea></label>
        <label>รูป/เอกสารหลักฐาน (เลือกได้หลายไฟล์)<input type="file" name="photos" accept="image/*" multiple></label>

        <h3 style="margin-top:12px">รายการสินค้า</h3>
        <div id="rc-lines"></div>
        <button type="button" class="btn small" id="rc-addline">+ เพิ่มรายการ</button>

        <div class="actions"><button class="btn primary" id="rc-submit" type="submit">บันทึกรับสินค้า</button></div>
      </form>
    </div>` : '<p class="muted">บัญชีของคุณดูประวัติได้อย่างเดียว</p>'}

    <div class="card">
      <h2>ประวัติการรับสินค้า (30 รายการล่าสุด)</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>วันที่รับ</th><th>Drop</th><th>PO</th><th>ตู้/รถ</th><th>ผู้ตรวจรับ</th><th></th></tr></thead>
        <tbody id="rc-history"><tr><td colspan="7">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;

  if (canWrite()) {
    addReceiptLine();
    $('#rc-addline').onclick = addReceiptLine;
    setupReceiptForm();
  }
  loadReceiptHistory();
};

function addReceiptLine() {
  const row = document.createElement('div');
  row.className = 'inline-form rc-line';
  row.innerHTML = `
    <select name="item" style="flex:2">
      <option value="">-- เลือกสินค้า --</option>
      ${recvItems.filter(x => x.active).map(x =>
        `<option value="${x.id}" data-unit="${esc(x.unit)}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}
    </select>
    <input name="qty" type="number" min="1" step="1" placeholder="จำนวน" style="max-width:120px">
    <span class="muted small" data-unit-label></span>
    <button type="button" class="btn small" data-rm>ลบ</button>`;
  row.querySelector('[name="item"]').onchange = (e) => {
    const opt = e.target.selectedOptions[0];
    row.querySelector('[data-unit-label]').textContent = opt ? (opt.dataset.unit || '') : '';
  };
  row.querySelector('[data-rm]').onclick = () => row.remove();
  $('#rc-lines').appendChild(row);
}

function setupReceiptForm() {
  const form = $('#rc-form');
  // รหัสนี้ใช้ซ้ำได้เมื่อบันทึกไม่สำเร็จ ทำให้กดซ้ำจะไม่บันทึกเบิ้ล
  let requestId = crypto.randomUUID();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const dropId = Number(fd.get('drop'));
    const lines = [...document.querySelectorAll('.rc-line')].map(r => ({
      item_id: Number(r.querySelector('[name="item"]').value),
      qty: Number(r.querySelector('[name="qty"]').value)
    }));

    if (!dropId) return toast('กรุณาเลือกจุด Drop', true);
    if (!lines.length) return toast('กรุณาเพิ่มรายการสินค้า', true);
    if (lines.some(l => !l.item_id)) return toast('มีแถวที่ยังไม่ได้เลือกสินค้า', true);
    if (lines.some(l => !Number.isInteger(l.qty) || l.qty <= 0)) {
      return toast('จำนวนรับต้องเป็นจำนวนเต็มมากกว่า 0', true);
    }
    if (new Set(lines.map(l => l.item_id)).size !== lines.length) {
      return toast('มีสินค้าซ้ำกันในใบรับเดียวกัน ให้รวมจำนวนเป็นแถวเดียว', true);
    }

    const btn = $('#rc-submit');
    btn.disabled = true;
    try {
      const paths = [];
      const files = [...form.querySelector('[name="photos"]').files];
      for (let k = 0; k < files.length; k++) {
        const f = files[k];
        const ext = ((f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
        const path = `receipts/${requestId}/${Date.now()}-${k + 1}.${ext}`;
        const up = await sb.storage.from('photos').upload(path, f, { contentType: f.type });
        if (up.error) throw up.error;
        paths.push(path);
      }

      const { data: id, error } = await sb.rpc('post_receipt', {
        p_request_id: requestId,
        p_drop_id: dropId,
        p_received_at: new Date(fd.get('received_at')).toISOString(),
        p_po_ref: fd.get('po').trim() || null,
        p_transport_ref: fd.get('transport').trim() || null,
        p_inspector: fd.get('inspector').trim(),
        p_supplier_doc: fd.get('supplier_doc').trim() || null,
        p_note: fd.get('note').trim() || null,
        p_image_paths: paths,
        p_lines: lines
      });
      if (error) throw error;

      toast('บันทึกรับสินค้าแล้ว');
      requestId = crypto.randomUUID();
      form.reset();
      form.querySelector('[name="received_at"]').value = localNowValue();
      $('#rc-lines').innerHTML = '';
      addReceiptLine();
      loadReceiptHistory();
    } catch (err) {
      toast(friendlyError(err), true);
    } finally {
      btn.disabled = false;
    }
  };
}

async function loadReceiptHistory() {
  const { data, error } = await sb.from('receipts')
    .select('id, receipt_no, received_at, po_ref, transport_ref, inspector, drop_id, image_paths')
    .order('received_at', { ascending: false })
    .limit(30);
  if (error) return toast(friendlyError(error), true);

  const dropCode = Object.fromEntries(recvDrops.map(d => [d.id, d.code]));
  const tb = $('#rc-history');
  if (!tb) return;
  tb.innerHTML = data.length ? data.map(r => `
    <tr>
      <td><b>${esc(r.receipt_no)}</b></td>
      <td>${new Date(r.received_at).toLocaleString('th-TH')}</td>
      <td>${esc(dropCode[r.drop_id] || '')}</td>
      <td>${esc(r.po_ref)}</td>
      <td>${esc(r.transport_ref)}</td>
      <td>${esc(r.inspector)}</td>
      <td><button class="btn small" data-rc="${r.id}">ดูรายการ</button></td>
    </tr>`).join('')
    : '<tr><td colspan="7">ยังไม่มีการรับสินค้า</td></tr>';

  tb.querySelectorAll('[data-rc]').forEach(btn => {
    btn.onclick = () => showReceipt(data.find(x => x.id == btn.dataset.rc));
  });
}

async function showReceipt(r) {
  const [lines, imgs] = await Promise.all([
    sb.from('receipt_lines').select('qty, items(code, name, unit)').eq('receipt_id', r.id),
    r.image_paths && r.image_paths.length
      ? sb.storage.from('photos').createSignedUrls(r.image_paths, 3600)
      : Promise.resolve({ data: [] })
  ]);
  if (lines.error) return toast(friendlyError(lines.error), true);

  const photos = (imgs.data || []).filter(x => x.signedUrl);
  openModal(`ใบรับ ${r.receipt_no}`, `
    <p class="muted small">PO: ${esc(r.po_ref || '-')} · ตู้/รถ: ${esc(r.transport_ref || '-')} · ผู้ตรวจรับ: ${esc(r.inspector)}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>จำนวน</th><th>หน่วย</th></tr></thead>
      <tbody>${lines.data.map(l => `
        <tr><td>${esc(l.items?.code)}</td><td>${esc(l.items?.name)}</td>
            <td>${num(l.qty)}</td><td>${esc(l.items?.unit)}</td></tr>`).join('')}
      </tbody>
    </table></div>
    ${photos.length
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          ${photos.map(p => `<a href="${esc(p.signedUrl)}" target="_blank">
            <img class="thumb" style="width:96px;height:96px" src="${esc(p.signedUrl)}" alt=""></a>`).join('')}
         </div>`
      : '<p class="muted small">ไม่มีรูปหลักฐาน</p>'}`);
}

/* ---------- เมนู 7: คงเหลือแยก Drop ---------- */
window.PAGES.stock = async (el) => {
  const d = await sb.from('drops').select('id, code, name').order('id');
  if (d.error) throw d.error;

  el.innerHTML = `
    <div class="page-head"><h1>คงเหลือแยกตามจุด Drop</h1></div>
    <div class="card">
      <div class="grid two">
        <label>ค้นหารหัสหรือชื่อสินค้า<input id="st-search" placeholder="เช่น MGR1"></label>
        <label>จุด Drop
          <select id="st-drop">
            <option value="">ทุกจุด</option>
            ${d.data.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>Drop</th><th>รับสะสม</th><th>จ่ายออกสะสม</th><th>ปรับยอด</th><th>คงเหลือ</th></tr></thead>
        <tbody id="st-rows"><tr><td colspan="7">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;

  const { data, error } = await sb.from('stock_balance').select('*').order('item_code');
  if (error) throw error;
  stockCache = data;

  $('#st-search').oninput = drawStock;
  $('#st-drop').onchange = drawStock;
  drawStock();
};

function drawStock() {
  const q = $('#st-search').value.trim().toLowerCase();
  const drop = $('#st-drop').value;
  const rows = stockCache.filter(r =>
    (!drop || String(r.drop_id) === drop) &&
    (!q || r.item_code.toLowerCase().includes(q) || r.item_name.toLowerCase().includes(q)));

  $('#st-rows').innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td><b>${esc(r.item_code)}</b></td>
      <td>${esc(r.item_name)}</td>
      <td>${esc(r.drop_code)}</td>
      <td>${num(r.total_received)}</td>
      <td>${num(Number(r.total_dispatched_net) || 0)}</td>
      <td>${num(r.total_adjusted)}</td>
      <td><b>${num(r.balance)}</b> ${esc(r.unit)}</td>
    </tr>`).join('')
    : '<tr><td colspan="7">ไม่พบข้อมูล</td></tr>';
}