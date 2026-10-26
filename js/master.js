/* Dashboard, ข้อมูลสินค้า, จุด Drop และอาคาร */
let itemCache = [];
let bldCache = [];

window.PAGES.dashboard = async (el) => {
  const [items, buildings, drops, plans] = await Promise.all([
    sb.from('items').select('id', { count: 'exact', head: true }).eq('active', true),
    sb.from('buildings').select('id', { count: 'exact', head: true }).eq('active', true),
    sb.from('drops').select('id', { count: 'exact', head: true }).eq('active', true),
    sb.from('plan_lines').select('id', { count: 'exact', head: true })
  ]);
  for (const r of [items, buildings, drops, plans]) if (r.error) throw r.error;
  el.innerHTML = `
    <h1>ภาพรวมโครงการ</h1>
    <div class="grid stats">
      <div class="stat"><span>สินค้าที่ใช้งาน</span><b>${num(items.count)}</b></div>
      <div class="stat"><span>อาคารที่ใช้งาน</span><b>${num(buildings.count)}</b></div>
      <div class="stat"><span>จุด Drop ที่ใช้งาน</span><b>${num(drops.count)}</b></div>
      <div class="stat"><span>รายการแผนกระจาย</span><b>${num(plans.count)}</b></div>
    </div>
    <div class="card" style="margin-top:16px">
      <p>ตัวเลขด้านบนดึงจากฐานข้อมูลจริง ยอดรับ ยอดจ่าย และยอดคงเหลือจะแสดงในส่วนที่ 4 และ 5</p>
    </div>`;
};

async function signImages(rows) {
  const paths = rows.filter(r => r.image_path).map(r => r.image_path);
  if (!paths.length) return;
  const { data } = await sb.storage.from('photos').createSignedUrls(paths, 3600);
  const map = {};
  (data || []).forEach(d => { if (d.signedUrl) map[d.path] = d.signedUrl; });
  rows.forEach(r => { r.img_url = map[r.image_path] || ''; });
}

window.PAGES.items = async (el) => {
  el.innerHTML = `
    <div class="page-head">
      <h1>ข้อมูลสินค้า</h1>
      ${isAdmin() ? '<button class="btn primary" id="add-item">+ เพิ่มสินค้า</button>' : ''}
    </div>
    <div class="card">
      <input id="item-search" class="search" placeholder="ค้นหาด้วยรหัสหรือชื่อสินค้า">
      <div class="table-wrap"><table>
        <thead><tr><th>รูป</th><th>รหัส</th><th>ชื่อสินค้า</th><th>ประเภท</th><th>ขนาด</th><th>หน่วย</th><th>สถานะ</th><th></th></tr></thead>
        <tbody id="item-rows"><tr><td colspan="8">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;
  const { data, error } = await sb.from('items').select('*').order('code');
  if (error) throw error;
  itemCache = data;
  await signImages(itemCache);
  $('#item-search').oninput = drawItems;
  if (isAdmin()) $('#add-item').onclick = () => itemForm(null);
  drawItems();
};

function drawItems() {
  const q = $('#item-search').value.trim().toLowerCase();
  const rows = itemCache.filter(r => !q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  $('#item-rows').innerHTML = rows.length ? rows.map(r => `
    <tr class="${r.active ? '' : 'inactive'}">
      <td>${r.img_url ? `<img class="thumb" src="${esc(r.img_url)}" alt="">` : '<span class="thumb empty">ไม่มีรูป</span>'}</td>
      <td><b>${esc(r.code)}</b></td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.size)}</td>
      <td>${esc(r.unit)}</td>
      <td>${r.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิดใช้งาน</span>'}</td>
      <td>${isAdmin() ? `<button class="btn small" data-edit="${r.id}">แก้ไข</button>` : ''}</td>
    </tr>`).join('')
    : '<tr><td colspan="8">ไม่พบข้อมูล</td></tr>';
  document.querySelectorAll('[data-edit]').forEach(btn => {
    btn.onclick = () => itemForm(itemCache.find(x => x.id == btn.dataset.edit));
  });
}

function itemForm(item) {
  const isNew = !item;
  const v = item || { unit: 'ชิ้น', active: true };
  openModal(isNew ? 'เพิ่มสินค้า' : 'แก้ไขสินค้า', `
    <form id="item-form">
      <label>รหัสสินค้า *<input name="code" required value="${esc(v.code)}"></label>
      <label>ชื่อสินค้า *<input name="name" required value="${esc(v.name)}"></label>
      <label>ประเภทสินค้า<input name="category" value="${esc(v.category)}"></label>
      <label>รายละเอียด<textarea name="description" rows="2">${esc(v.description)}</textarea></label>
      <label>ขนาด<input name="size" value="${esc(v.size)}"></label>
      <label>หน่วยนับ *<input name="unit" required value="${esc(v.unit)}" placeholder="เช่น ตัว ชุด กล่อง"></label>
      <label>หมายเหตุ<textarea name="note" rows="2">${esc(v.note)}</textarea></label>
      <label>รูปภาพสินค้า<input type="file" name="image" accept="image/*"></label>
      ${!isNew && item.image_path ? '<p class="muted small">มีรูปเดิมอยู่แล้ว หากเลือกไฟล์ใหม่ รูปใหม่จะแสดงแทน</p>' : ''}
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> ใช้งาน</label>
      <div class="actions">
        <button type="button" class="btn" onclick="closeModal()">ยกเลิก</button>
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`);

  $('#item-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const fd = new FormData(f);
      const code = fd.get('code').trim();
      const row = {
        code,
        name: fd.get('name').trim(),
        category: fd.get('category').trim() || null,
        description: fd.get('description').trim() || null,
        size: fd.get('size').trim() || null,
        unit: fd.get('unit').trim(),
        note: fd.get('note').trim() || null,
        active: f.querySelector('[name="active"]').checked
      };
      const file = fd.get('image');
      if (file && file.size > 0) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        const safeCode = code.replace(/[^A-Za-z0-9ก-๙_-]/g, '_');
        const path = `items/${safeCode}/${Date.now()}.${ext}`;
        const up = await sb.storage.from('photos').upload(path, file, { contentType: file.type });
        if (up.error) throw up.error;
        row.image_path = path;
      }
      const res = isNew
        ? await sb.from('items').insert(row)
        : await sb.from('items').update(row).eq('id', item.id);
      if (res.error) throw res.error;
      closeModal();
      toast('บันทึกสินค้าแล้ว');
      window.PAGES.items($('#content'));
    } catch (err) {
      toast(friendlyError(err), true);
      btn.disabled = false;
    }
  };
}

window.PAGES.locations = async (el) => {
  el.innerHTML = `
    <h1>ข้อมูลจุด Drop และอาคาร</h1>
    <div class="grid two">
      <div class="card">
        <h2>จุด Drop</h2>
        <div id="drop-list">กำลังโหลด...</div>
        ${isAdmin() ? `
        <form id="drop-form" class="inline-form">
          <input name="code" placeholder="รหัส เช่น DROP4" required>
          <input name="name" placeholder="ชื่อ เช่น Drop 4" required>
          <button class="btn primary" type="submit">เพิ่ม</button>
        </form>` : ''}
      </div>
      <div class="card">
        <div class="page-head">
          <h2>อาคารปลายทาง</h2>
          ${isAdmin() ? '<button class="btn primary" id="add-bld">+ เพิ่มอาคาร</button>' : ''}
        </div>
        <input id="bld-search" class="search" placeholder="ค้นหารหัสหรือชื่ออาคาร">
        <div class="table-wrap"><table>
          <thead><tr><th>รหัส</th><th>ชื่ออาคาร</th><th>โซน</th><th>สถานะ</th><th></th></tr></thead>
          <tbody id="bld-rows"><tr><td colspan="5">กำลังโหลด...</td></tr></tbody>
        </table></div>
      </div>
    </div>`;

  await loadDrops();
  const df = $('#drop-form');
  if (df) df.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(df);
    const { error } = await sb.from('drops').insert({ code: fd.get('code').trim(), name: fd.get('name').trim() });
    if (error) return toast(friendlyError(error), true);
    df.reset();
    toast('เพิ่มจุด Drop แล้ว');
    loadDrops();
  };
  await loadBuildings();
  $('#bld-search').oninput = drawBuildings;
  if (isAdmin()) $('#add-bld').onclick = () => bldForm(null);
};

async function loadDrops() {
  const { data, error } = await sb.from('drops').select('*').order('id');
  if (error) throw error;
  $('#drop-list').innerHTML = `<div class="table-wrap"><table><tbody>${data.map(d => `
    <tr class="${d.active ? '' : 'inactive'}">
      <td><b>${esc(d.code)}</b></td>
      <td>${esc(d.name)}</td>
      <td>${d.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิด</span>'}</td>
      <td>${isAdmin() ? `<button class="btn small" data-drop="${d.id}" data-active="${d.active}">${d.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('[data-drop]').forEach(btn => {
    btn.onclick = async () => {
      const newActive = btn.dataset.active !== 'true';
      const { error } = await sb.from('drops').update({ active: newActive }).eq('id', btn.dataset.drop);
      if (error) return toast(friendlyError(error), true);
      toast('อัปเดตจุด Drop แล้ว');
      loadDrops();
    };
  });
}

async function loadBuildings() {
  const { data, error } = await sb.from('buildings').select('*').order('code');
  if (error) throw error;
  bldCache = data;
  drawBuildings();
}

function drawBuildings() {
  const q = $('#bld-search').value.trim().toLowerCase();
  const rows = bldCache.filter(b => !q || b.code.toLowerCase().includes(q) || b.name.toLowerCase().includes(q));
  $('#bld-rows').innerHTML = rows.length ? rows.map(b => `
    <tr class="${b.active ? '' : 'inactive'}">
      <td><b>${esc(b.code)}</b></td>
      <td>${esc(b.name)}</td>
      <td>${esc(b.zone)}</td>
      <td>${b.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิด</span>'}</td>
      <td>${isAdmin() ? `<button class="btn small" data-bld="${b.id}">แก้ไข</button>` : ''}</td>
    </tr>`).join('')
    : '<tr><td colspan="5">ไม่พบข้อมูล</td></tr>';
  document.querySelectorAll('[data-bld]').forEach(btn => {
    btn.onclick = () => bldForm(bldCache.find(x => x.id == btn.dataset.bld));
  });
}

function bldForm(b) {
  const isNew = !b;
  const v = b || { active: true };
  openModal(isNew ? 'เพิ่มอาคาร' : 'แก้ไขอาคาร', `
    <form id="bld-form">
      <label>รหัสอาคาร *<input name="code" required value="${esc(v.code)}"></label>
      <label>ชื่ออาคาร *<input name="name" required value="${esc(v.name)}"></label>
      <label>โซนหรือรายละเอียดตำแหน่ง<input name="zone" value="${esc(v.zone)}"></label>
      <label>หมายเหตุ<textarea name="note" rows="2">${esc(v.note)}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> ใช้งาน</label>
      <div class="actions">
        <button type="button" class="btn" onclick="closeModal()">ยกเลิก</button>
        <button type="submit" class="btn primary">บันทึก</button>
      </div>
    </form>`);

  $('#bld-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const fd = new FormData(f);
    const row = {
      code: fd.get('code').trim(),
      name: fd.get('name').trim(),
      zone: fd.get('zone').trim() || null,
      note: fd.get('note').trim() || null,
      active: f.querySelector('[name="active"]').checked
    };
    const res = isNew
      ? await sb.from('buildings').insert(row)
      : await sb.from('buildings').update(row).eq('id', b.id);
    if (res.error) return toast(friendlyError(res.error), true);
    closeModal();
    toast('บันทึกอาคารแล้ว');
    loadBuildings();
  };
}
