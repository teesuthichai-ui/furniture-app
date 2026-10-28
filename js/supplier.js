/* เมนู 14: ส่งคืนสินค้าให้ซัพพลายเออร์ (ฉบับปรับปรุง)
   ตัดทิ้งถูกถอดออกแล้ว ตำหนิที่อาคารต้องนำกลับมาที่ Drop ก่อน */

Object.assign(MOVE_LABEL, { supplier_return: 'ส่งคืนซัพพลายเออร์', defect_disposal: 'ตัดทิ้งตำหนิ (เดิม)' });
Object.assign(DS_MOVE_LABEL, { supplier_return: 'ส่งคืนซัพพลายเออร์', defect_disposal: 'ตัดทิ้งตำหนิ (เดิม)' });

const SR_STATUS = { draft: 'ฉบับร่าง', pending: 'รอส่งคืน', returned: 'ส่งคืนแล้ว', cancelled: 'ยกเลิก' };
const SR_BADGE = { draft: '', pending: '', returned: 'ok', cancelled: '' };

window.PAGES.supplier = async (el) => {
  const canWrite = fieldCanWrite();
  const [d, i, r, df] = await Promise.all([
    sb.from('drops').select('id, code, name, active').order('id'),
    sb.from('items').select('id, code, name, unit, active').order('code'),
    sb.from('receipts').select('id, receipt_no, drop_id, received_at')
      .order('received_at', { ascending: false }).limit(300),
    sb.from('defects').select('id, item_id, drop_id, building_id, qty, description, status, items(code, name)')
      .in('status', ['pending', 'in_progress', 'repaired']).order('id', { ascending: false })
  ]);
  for (const x of [d, i, r, df]) if (x.error) throw x.error;

  const dropCode = Object.fromEntries(d.data.map(x => [x.id, x.code]));
  const bldRes = await sb.from('buildings').select('id, code, name');
  if (bldRes.error) throw bldRes.error;
  const bldCode = Object.fromEntries(bldRes.data.map(b => [b.id, b.code + ' · ' + b.name]));
  const rcNo = Object.fromEntries(r.data.map(x => [x.id, x.receipt_no]));
  const activeDrops = d.data.filter(x => x.active);
  const activeItems = i.data.filter(x => x.active);
  let requestId = crypto.randomUUID();

  const dropOpts = `<option value="">-- เลือก Drop --</option>` +
    activeDrops.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');
  const itemOpts = `<option value="">-- เลือกสินค้า --</option>` +
    activeItems.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('');

  el.innerHTML = `
    <div class="page-head"><h1>ส่งคืนสินค้าให้ซัพพลายเออร์</h1></div>

    ${canWrite ? `
    <div class="card">
      <h2>สร้างเอกสารส่งคืนใหม่ (ฉบับร่าง)</h2>
      <p class="muted small">ฉบับร่างยังไม่ตัดสต๊อก ต้องกดส่งรอส่งคืนและยืนยันส่งคืนแล้วจึงจะตัดยอด</p>
      <form id="sr-form">
        <div class="grid two">
          <label>วันที่ส่งคืน *<input type="datetime-local" name="return_date" value="${fieldLocalNow()}" required></label>
          <label>ชื่อซัพพลายเออร์ *<input name="supplier" required></label>
          <label>จุด Drop ต้นทาง *<select name="drop" required>${dropOpts}</select></label>
          <label>อ้างอิงใบรับเดิม (ไม่บังคับ)<select name="receipt"><option value="">-- ไม่อ้างอิง --</option></select></label>
          <label>เหตุผลการส่งคืน *<input name="reason" required></label>
          <label>หมายเหตุ<input name="note"></label>
        </div>
        <label>รูปหลักฐาน (เลือกได้หลายรูป)<input type="file" name="photos" accept="image/*" multiple></label>
        <h3 style="margin-top:12px">รายการสินค้า</h3>
        <div id="sr-lines"></div>
        <button type="button" class="btn small" id="sr-addline">+ เพิ่มรายการ</button>
        <div class="actions"><button class="btn primary" id="sr-submit" type="submit">บันทึกฉบับร่าง</button></div>
      </form>
    </div>` : ''}

    <div class="card">
      <h2>ตำหนิที่เกี่ยวข้อง</h2>
      <p class="muted small">ตำหนิที่อยู่ที่ Drop เลือกในฟอร์มด้านบนได้ ตำหนิที่อยู่ที่อาคารต้องนำกลับมาที่ Drop ก่อนจึงจะส่งคืนได้</p>
      <div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>รหัส</th><th>จำนวน</th><th>สถานที่</th><th>สถานะ</th><th>รายละเอียด</th></tr></thead>
        <tbody id="dx-rows"></tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>เอกสารส่งคืน</h2>
      <div class="grid two">
        <label>สถานะ<select id="sl-status">
          <option value="">ทั้งหมด</option>
          ${Object.entries(SR_STATUS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></label>
        <label>จุด Drop<select id="sl-drop"><option value="">ทุก Drop</option>
          ${activeDrops.map(x => `<option value="${x.id}">${esc(x.code)} · ${esc(x.name)}</option>`).join('')}
        </select></label>
        ${dateRangeHtml('sl')}
        <label>ค้นหาซัพพลายเออร์หรือรหัสสินค้า<input id="sl-q"></label>
      </div>
      <div class="actions" style="justify-content:flex-start">
        <button class="btn primary" id="sl-go">ค้นหา</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>เลขที่</th><th>วันที่</th><th>ซัพพลายเออร์</th><th>Drop</th><th>ใบรับอ้างอิง</th><th>รายการ</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="sl-rows"><tr><td colspan="8">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;

  const rerender = () => window.PAGES.supplier(el);

  /* ตำหนิที่เกี่ยวข้อง (แสดงอย่างเดียว) */
  $('#dx-rows').innerHTML = df.data.length ? df.data.map(x => `
    <tr>
      <td>#${x.id}</td>
      <td><b>${esc(x.items?.code)}</b></td>
      <td>${num(x.qty)}</td>
      <td>${x.drop_id
        ? 'Drop: ' + esc(dropCode[x.drop_id])
        : '<span class="badge">อาคาร: ' + esc(bldCode[x.building_id] || '') + '</span> <span class="muted small">ต้องนำกลับ Drop ก่อน</span>'}</td>
      <td><span class="badge">${esc(DEF_STATUS[x.status] || x.status)}</span></td>
      <td>${esc(x.description)}</td>
    </tr>`).join('')
    : '<tr><td colspan="6">ไม่มีตำหนิที่เกี่ยวข้อง</td></tr>';

  /* ฟอร์มสร้างฉบับร่าง */
  const refreshReceipts = () => {
    const drop = fld($('#sr-form'), 'drop').value;
    fld($('#sr-form'), 'receipt').innerHTML = `<option value="">-- ไม่อ้างอิง --</option>` +
      r.data.filter(x => String(x.drop_id) === drop)
        .map(x => `<option value="${x.id}">${esc(x.receipt_no)} · ${fmtDate(x.received_at)}</option>`).join('');
  };

  const refreshDefects = (row) => {
    const drop = fld($('#sr-form'), 'drop').value;
    const item = row.querySelector('[name="item"]').value;
    row.querySelector('[name="defect"]').innerHTML = `<option value="">ไม่ผูกตำหนิ</option>` +
      df.data.filter(x => String(x.drop_id) === drop && String(x.item_id) === item)
        .map(x => `<option value="${x.id}" data-qty="${x.qty}">ตำหนิ #${x.id} · ${num(x.qty)} ชิ้น · ${esc(String(x.description).slice(0, 30))}</option>`)
        .join('');
  };

  const addLine = () => {
    const row = document.createElement('div');
    row.className = 'inline-form sr-line';
    row.innerHTML = `
      <select name="item" style="flex:2">${itemOpts}</select>
      <input name="qty" type="number" min="1" step="1" placeholder="จำนวน" style="max-width:110px">
      <select name="defect" style="flex:2"><option value="">ไม่ผูกตำหนิ</option></select>
      <button type="button" class="btn small" data-rm>ลบ</button>`;
    row.querySelector('[name="item"]').onchange = () => refreshDefects(row);
    row.querySelector('[name="defect"]').onchange = (e) => {
      const o = e.target.selectedOptions[0];
      if (o && o.dataset.qty) row.querySelector('[name="qty"]').value = o.dataset.qty;
    };
    row.querySelector('[data-rm]').onclick = () => row.remove();
    $('#sr-lines').appendChild(row);
  };

  if (canWrite) {
    addLine();
    refreshReceipts();
    $('#sr-addline').onclick = addLine;
    fld($('#sr-form'), 'drop').onchange = () => {
      refreshReceipts();
      document.querySelectorAll('.sr-line').forEach(refreshDefects);
    };

    $('#sr-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const drop = Number(fld(f, 'drop').value);
      const receipt = fld(f, 'receipt').value;
      const lines = [...document.querySelectorAll('.sr-line')].map(row => {
        const dv = row.querySelector('[name="defect"]').value;
        return {
          item_id: Number(row.querySelector('[name="item"]').value),
          qty: Number(row.querySelector('[name="qty"]').value),
          defect_id: dv ? Number(dv) : null
        };
      });

      if (!drop) return toast('กรุณาเลือกจุด Drop', true);
      if (!fld(f, 'supplier').value.trim()) return toast('กรุณาระบุชื่อซัพพลายเออร์', true);
      if (!fld(f, 'reason').value.trim()) return toast('กรุณาระบุเหตุผล', true);
      if (!lines.length) return toast('กรุณาเพิ่มรายการสินค้า', true);
      if (lines.some(l => !l.item_id)) return toast('มีแถวที่ยังไม่ได้เลือกสินค้า', true);
      if (lines.some(l => !Number.isInteger(l.qty) || l.qty <= 0)) {
        return toast('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0', true);
      }
      if (new Set(lines.map(l => l.item_id)).size !== lines.length) {
        return toast('มีสินค้าซ้ำกัน ให้รวมเป็นแถวเดียว', true);
      }

      const btn = $('#sr-submit');
      btn.disabled = true;
      try {
        const paths = await fieldUpload(fld(f, 'photos').files, `returns/${requestId}`);
        const { error } = await sb.rpc('create_supplier_return', {
          p_request_id: requestId,
          p_return_date: new Date(fld(f, 'return_date').value).toISOString(),
          p_supplier: fld(f, 'supplier').value.trim(),
          p_drop_id: drop,
          p_receipt_id: receipt ? Number(receipt) : null,
          p_reason: fld(f, 'reason').value.trim(),
          p_note: fld(f, 'note').value.trim() || null,
          p_proof_paths: paths,
          p_lines: lines
        });
        if (error) throw error;
        toast('บันทึกฉบับร่างแล้ว ยังไม่ตัดสต๊อก');
        requestId = crypto.randomUUID();
        f.reset();
        fld(f, 'return_date').value = fieldLocalNow();
        $('#sr-lines').innerHTML = '';
        addLine();
        refreshReceipts();
        loadList();
      } catch (err) {
        toast(friendlyError(err), true);
      } finally {
        btn.disabled = false;
      }
    };
  }

  /* รายการเอกสารส่งคืน */
  const loadList = async () => {
    const status = $('#sl-status').value;
    const drop = $('#sl-drop').value;
    const from = $('#sl-from').value;
    const to = $('#sl-to').value;
    const q = $('#sl-q').value.trim().toLowerCase();
    $('#sl-rows').innerHTML = '<tr><td colspan="8">กำลังโหลด...</td></tr>';

    try {
      let rows = await fieldFetchAll(() => {
        let qb = sb.from('supplier_returns').select(
          'id, return_no, return_date, status, supplier_name, drop_id, receipt_id, cancel_reason, proof_paths, ' +
          'supplier_return_lines(qty, defect_id, items(code, name, unit))');
        if (status) qb = qb.eq('status', status);
        if (drop) qb = qb.eq('drop_id', drop);
        if (from) qb = qb.gte('return_date', new Date(from + 'T00:00:00').toISOString());
        if (to) qb = qb.lte('return_date', new Date(to + 'T23:59:59.999').toISOString());
        return qb.order('return_date', { ascending: false }).order('id', { ascending: false });
      });

      if (q) {
        rows = rows.filter(x => x.supplier_name.toLowerCase().includes(q) ||
          x.supplier_return_lines.some(l => (l.items?.code || '').toLowerCase().includes(q)));
      }

      $('#sl-rows').innerHTML = rows.length ? rows.map(x => `
        <tr class="${x.status === 'cancelled' ? 'inactive' : ''}">
          <td><b>${esc(x.return_no)}</b></td>
          <td>${fmtDate(x.return_date)}</td>
          <td>${esc(x.supplier_name)}</td>
          <td>${esc(dropCode[x.drop_id])}</td>
          <td>${esc(rcNo[x.receipt_id] || '-')}</td>
          <td>${x.supplier_return_lines.map(l =>
            `${esc(l.items?.code)} × ${num(l.qty)}${l.defect_id ? ' (ตำหนิ #' + l.defect_id + ')' : ''}`).join('<br>')}</td>
          <td><span class="badge ${SR_BADGE[x.status]}">${esc(SR_STATUS[x.status])}</span>
            ${x.cancel_reason ? `<div class="muted small">${esc(x.cancel_reason)}</div>` : ''}</td>
          <td>
            ${canWrite && x.status === 'draft' ? `<button class="btn small" data-sr-submit="${x.id}">ส่งรอส่งคืน</button>` : ''}
            ${canWrite && x.status === 'pending' ? `<button class="btn small primary" data-sr-confirm="${x.id}">ยืนยันส่งคืนแล้ว</button>` : ''}
            ${canWrite && (x.status === 'draft' || x.status === 'pending')
              ? `<button class="btn small" style="color:var(--danger)" data-sr-cancel="${x.id}">ยกเลิก</button>` : ''}
            ${(x.proof_paths || []).length ? `<button class="btn small" data-sr-photo="${x.id}">รูป</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="8">ไม่พบเอกสาร</td></tr>';

      el.querySelectorAll('[data-sr-submit]').forEach(b => b.onclick = async () => {
        const { error } = await sb.rpc('submit_supplier_return', { p_id: Number(b.dataset.srSubmit) });
        if (error) return toast(friendlyError(error), true);
        toast('ส่งเป็นรอส่งคืนแล้ว');
        loadList();
      });

      el.querySelectorAll('[data-sr-confirm]').forEach(b => b.onclick = async () => {
        if (!confirm('ยืนยันว่าส่งสินค้าคืนซัพพลายเออร์แล้วจริง\nระบบจะหักยอดคงเหลือทันที และเอกสารนี้ยกเลิกไม่ได้\nดำเนินการหรือไม่?')) return;
        const { error } = await sb.rpc('confirm_supplier_return', { p_id: Number(b.dataset.srConfirm) });
        if (error) return toast(friendlyError(error), true);
        toast('ยืนยันส่งคืนแล้ว ยอดคงเหลือถูกหัก');
        rerender();
      });

      el.querySelectorAll('[data-sr-cancel]').forEach(b => b.onclick = async () => {
        const reason = prompt('เหตุผลในการยกเลิกเอกสารนี้ (จำเป็น)');
        if (reason === null) return;
        if (!reason.trim()) return toast('ต้องระบุเหตุผลการยกเลิก', true);
        const { error } = await sb.rpc('cancel_supplier_return', { p_id: Number(b.dataset.srCancel), p_reason: reason.trim() });
        if (error) return toast(friendlyError(error), true);
        toast('ยกเลิกเอกสารแล้ว');
        loadList();
      });

      el.querySelectorAll('[data-sr-photo]').forEach(b => b.onclick = () => {
        const x = rows.find(y => String(y.id) === b.dataset.srPhoto);
        fieldShowPhotos(x.proof_paths);
      });
    } catch (e) {
      toast(friendlyError(e), true);
    }
  };

  $('#sl-go').onclick = loadList;
  loadList();
};