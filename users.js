/* หน้าจัดการผู้ใช้และสิทธิ์ (เฉพาะผู้ดูแลระบบ) */
window.PAGES.users = async (el) => {
  if (!isAdmin()) { el.innerHTML = '<div class="card">ไม่มีสิทธิ์เข้าหน้านี้</div>'; return; }

  el.innerHTML = `
    <h1>จัดการผู้ใช้งานและสิทธิ์</h1>
    <div class="card">
      <h3>วิธีเพิ่มผู้ใช้ใหม่</h3>
      <ol class="steps">
        <li>เข้า Supabase > Authentication > Users > กด Add user > Create new user</li>
        <li>กรอกอีเมลและรหัสผ่านชั่วคราว ติ๊ก Auto Confirm User แล้วกดสร้าง</li>
        <li>กลับมาหน้านี้แล้วรีเฟรช ผู้ใช้ใหม่จะได้สิทธิ์เริ่มต้นเป็น "ผู้ดูรายงาน"</li>
        <li>ตั้งชื่อและกำหนดสิทธิ์ในตารางด้านล่าง แล้วกดบันทึก</li>
      </ol>
      <p class="muted small">ระบบนี้ไม่มีปุ่มสร้างบัญชีในหน้าเว็บ เพื่อไม่ต้องใช้กุญแจลับ (service_role) ในหน้าเว็บ การปิดบัญชีคือเอาเครื่องหมายถูกออกจากคอลัมน์ "ใช้งาน" ไม่ใช่การลบ</p>
    </div>
    <div class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>ชื่อ</th><th>สิทธิ์</th><th>ใช้งาน</th><th></th></tr></thead>
        <tbody id="user-rows"><tr><td colspan="4">กำลังโหลด...</td></tr></tbody>
      </table></div>
    </div>`;

  const { data, error } = await sb.from('profiles').select('*').order('created_at');
  if (error) throw error;
  const rows = data;

  $('#user-rows').innerHTML = rows.map(p => `
    <tr>
      <td>
        <input data-name="${p.id}" value="${esc(p.full_name)}" placeholder="ชื่อ-นามสกุล">
        <div class="muted small">รหัส: ${esc(p.id.slice(0, 8))}${p.id === state.user.id ? ' (คุณ)' : ''}</div>
      </td>
      <td><select data-role="${p.id}">
        ${['admin', 'warehouse', 'viewer'].map(r =>
          `<option value="${r}" ${r === p.role ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
      </select></td>
      <td><input type="checkbox" data-active="${p.id}" ${p.active ? 'checked' : ''}></td>
      <td><button class="btn small primary" data-save="${p.id}">บันทึก</button></td>
    </tr>`).join('');

  document.querySelectorAll('[data-save]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.save;
      const name = $(`[data-name="${id}"]`).value.trim();
      const role = $(`[data-role="${id}"]`).value;
      const active = $(`[data-active="${id}"]`).checked;

      const otherActiveAdmins = rows.filter(p => p.id !== id && p.role === 'admin' && p.active).length;
      if (otherActiveAdmins === 0 && !(role === 'admin' && active)) {
        return toast('ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน', true);
      }
      if (id === state.user.id && (role !== 'admin' || !active)) {
        if (!confirm('คุณกำลังลดสิทธิ์หรือปิดบัญชีของตัวเอง ยืนยันหรือไม่?')) return;
      }

      btn.disabled = true;
      const { error } = await sb.from('profiles').update({ full_name: name, role, active }).eq('id', id);
      btn.disabled = false;
      if (error) return toast(friendlyError(error), true);
      toast('บันทึกแล้ว ผู้ใช้ที่ถูกแก้ไขควรรีเฟรชหน้าเว็บ');
      window.PAGES.users($('#content'));
    };
  });
};
