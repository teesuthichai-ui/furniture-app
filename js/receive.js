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
    .select('id, receipt_no, received_at, po_ref, transport_ref, inspector, drop_id, image_paths, status, cancel_reason')
    .order('received_at', { ascending: false })
    .limit(30);
  if (error) return toast(friendlyError(error), true);

  const dropCode = Object.fromEntries(recvDrops.map(d => [d.id, d.code]));
  const tb = $('#rc-history');
  if (!tb) return;

  tb.innerHTML = data.length ? data.map(r => `
    <tr class="${r.status === 'cancelled' ? 'inactive' : ''}">
      <td><b>${esc(r.receipt_no)}</b></td>
      <td>${new Date(r.received_at).toLocaleString('th-TH')}</td>
      <td>${esc(dropCode[r.drop_id] || '')}</td>
      <td>${esc(r.po_ref)}</td>
      <td>${esc(r.transport_ref)}</td>
      <td>${esc(r.inspector)}</td>
      <td>${r.status === 'cancelled'
        ? `<span class="badge">ยกเลิก</span><div class="muted small">${esc(r.cancel_reason)}</div>`
        : '<span class="badge ok">ปกติ</span>'}</td>
      <td>
        <button class="btn small" data-rc="${r.id}">ดูรายการ</button>
        ${canWrite() && r.status === 'completed'
          ? `<button class="btn small" style="color:var(--danger)" data-rc-cancel="${r.id}" data-no="${esc(r.receipt_no)}">ยกเลิก</button>`
          : ''}
      </td>
    </tr>`).join('')
    : '<tr><td colspan="8">ยังไม่มีการรับสินค้า</td></tr>';

  tb.querySelectorAll('[data-rc]').forEach(btn => {
    btn.onclick = () => showReceipt(data.find(x => x.id == btn.dataset.rc));
  });
  tb.querySelectorAll('[data-rc-cancel]').forEach(btn => {
    btn.onclick = () => cancelReceiptFlow(btn.dataset.rcCancel, btn.dataset.no);
  });
}

async function cancelReceiptFlow(id, no) {
  const reason = prompt(`ยกเลิกใบรับ ${no}\nระบุเหตุผล (จำเป็น)\nยอดของใบนี้จะถูกหักออกจาก Drop และประวัติยังเก็บไว้`);
  if (reason === null) return;
  if (!reason.trim()) return toast('ต้องระบุเหตุผลการยกเลิก', true);
  if (!confirm(`ยืนยันยกเลิกใบรับ ${no} ?\nยกเลิกแล้วกลับไม่ได้`)) return;

  const { error } = await sb.rpc('cancel_receipt', { p_receipt_id: Number(id), p_reason: reason.trim() });
  if (error) return toast(friendlyError(error), true);
  toast('ยกเลิกใบรับแล้ว ยอดคงเหลือถูกหัก');
  loadReceiptHistory();
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
  const d = await sb.from('drops').select('id, code, name, kind').order('id');
  if (d.error) throw d.error;
  const { data, error } = await sb.from('stock_balance').select('*').order('item_code');
  if (error) throw error;

  const isQuar = (r) => {
    const drop = d.data.find(x => x.id === r.drop_id);
    return drop && drop.kind === 'quarantine';
  };
  const netReceived = (r) => Number(r.total_received) - Number(r.total_receipt_cancelled || 0);

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
        <thead><tr><th>รหัส</th><th>ชื่อสินค้า</th><th>Drop</th><th>รับสะสม (สุทธิ)</th><th>จ่ายออกสะสม</th><th>ปรับยอด</th><th>คงเหลือ</th><th></th></tr></thead>
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
        <td>${num(netReceived(r))}</td>
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