/* ลบสินค้าและอาคาร (เฉพาะแอดมิน)
   ไฟล์นี้จะแทนที่ฟังก์ชันแสดงตารางสินค้าและอาคารเดิม โดยเพิ่มปุ่มลบ */

async function deleteRecord(fn, paramName, id, label) {
  if (!confirm(`ยืนยันการลบ "${label}" ?\nลบแล้วกู้คืนไม่ได้ (ลบได้เฉพาะรายการที่ยังไม่เคยรับหรือจ่าย)`)) return;
  const { error } = await sb.rpc(fn, { [paramName]: Number(id) });
  if (error) return toast(friendlyError(error), true);
  toast('ลบแล้ว');
  route();
}

function drawItems() {
  const q = $('#item-search').value.trim().toLowerCase();
  const rows = itemCache.filter(r =>
    !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));

  $('#item-rows').innerHTML = rows.length ? rows.map(r => `
    <tr class="${r.active ? '' : 'inactive'}">
      <td>${r.img_url ? `<img class="thumb" src="${esc(r.img_url)}" alt="">` : '<span class="thumb empty">ไม่มีรูป</span>'}</td>
      <td><b>${esc(r.code)}</b></td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.size)}</td>
      <td>${esc(r.unit)}</td>
      <td>${r.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิดใช้งาน</span>'}</td>
      <td>${isAdmin() ? `
        <button class="btn small" data-edit="${r.id}">แก้ไข</button>
        <button class="btn small" style="color:var(--danger)" data-del-item="${r.id}">ลบ</button>` : ''}</td>
    </tr>`).join('')
    : '<tr><td colspan="8">ไม่พบข้อมูล</td></tr>';

  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => itemForm(itemCache.find(x => x.id == btn.dataset.edit));
  });
  document.querySelectorAll('[data-del-item]').forEach(btn => {
    btn.onclick = () => {
      const it = itemCache.find(x => x.id == btn.dataset.delItem);
      deleteRecord('delete_item', 'p_id', btn.dataset.delItem, it ? it.code : '');
    };
  });
}

function drawBuildings() {
  const q = $('#bld-search').value.trim().toLowerCase();
  const rows = bldCache.filter(b =>
    !q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q));

  $('#bld-rows').innerHTML = rows.length ? rows.map(b => `
    <tr class="${b.active ? '' : 'inactive'}">
      <td><b>${esc(b.code)}</b></td>
      <td>${esc(b.name)}</td>
      <td>${esc(b.zone)}</td>
      <td>${b.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิด</span>'}</td>
      <td>${isAdmin() ? `
        <button class="btn small" data-bld="${b.id}">แก้ไข</button>
        <button class="btn small" style="color:var(--danger)" data-del-bld="${b.id}">ลบ</button>` : ''}</td>
    </tr>`).join('')
    : '<tr><td colspan="5">ไม่พบข้อมูล</td></tr>';

  document.querySelectorAll('[data-bld]').forEach(btn => {
    btn.onclick = () => bldForm(bldCache.find(x => x.id == btn.dataset.bld));
  });
  document.querySelectorAll('[data-del-bld]').forEach(btn => {
    btn.onclick = () => {
      const b = bldCache.find(x => x.id == btn.dataset.delBld);
      deleteRecord('delete_building', 'p_id', btn.dataset.delBld, b ? b.code : '');
    };
  });
}