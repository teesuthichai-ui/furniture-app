/* ส่วนสำรองข้อมูล: ส่งออกทุกตารางเป็นไฟล์ Excel (เฉพาะแอดมิน) */
(function () {
  const TABLES = [
    ['สินค้า', 'items'],
    ['จุด_Drop', 'drops'],
    ['อาคาร', 'buildings'],
    ['แผนกระจาย', 'plan_lines'],
    ['ใบรับ', 'receipts'],
    ['รายการรับ', 'receipt_lines'],
    ['ใบจ่าย', 'dispatches'],
    ['รายการจ่าย', 'dispatch_lines'],
    ['การเคลื่อนไหวสินค้า', 'stock_movements'],
    ['ประวัติการแก้ไข', 'audit_log']
  ];

  // ดึงข้อมูลทั้งตาราง ทีละ 1,000 แถว เพราะ Supabase จำกัดการดึงต่อครั้ง
  async function fetchAllRows(table) {
    const PAGE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from(table)
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`อ่านตาราง ${table} ไม่สำเร็จ: ${error.message}`);
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return all;
  }

  // ค่าที่เป็นออบเจกต์ (เช่น ประวัติการแก้ไข) แปลงเป็นข้อความเพื่อให้อ่านใน Excel ได้
  function flattenRows(rows) {
    return rows.map(r => {
      const o = {};
      Object.entries(r).forEach(([k, v]) => {
        o[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
      });
      return o;
    });
  }

  async function exportAllData(btn) {
    if (!isAdmin()) return toast('เฉพาะผู้ดูแลระบบที่ส่งออกข้อมูลได้', true);
    if (typeof XLSX === 'undefined') {
      return toast('โหลดตัวสร้างไฟล์ Excel ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', true);
    }

    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'กำลังส่งออก... (อาจใช้เวลาสักครู่)';
    try {
      const wb = XLSX.utils.book_new();
      for (const [label, table] of TABLES) {
        const rows = flattenRows(await fetchAllRows(table));
        const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ หมายเหตุ: 'ไม่มีข้อมูล' }]);
        XLSX.utils.book_append_sheet(wb, ws, label);
      }
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `สำรองข้อมูล_${stamp}.xlsx`);
      toast('ส่งออกข้อมูลแล้ว เก็บไฟล์ไว้ในที่ปลอดภัย');
    } catch (e) {
      toast(friendlyError(e), true);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  // เพิ่มกล่องสำรองข้อมูลไว้บนสุดของหน้าจัดการผู้ใช้ (เมนู 11)
  const originalUsers = window.PAGES.users;
  window.PAGES.users = async (el) => {
    await originalUsers(el);
    if (!isAdmin()) return;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>สำรองข้อมูลทั้งหมด</h3>
      <p class="muted small">ส่งออกทุกตารางเป็นไฟล์ Excel หนึ่งไฟล์ มีหลายชีต ควรทำทุกสัปดาห์และเก็บไฟล์ไว้ในที่ปลอดภัย
      ไฟล์นี้มีรายการรูปภาพและเอกสาร แต่ตัวรูปจริงไม่ได้รวมอยู่ในไฟล์</p>
      <button class="btn primary" id="bk-export">ส่งออกข้อมูลทั้งหมด (Excel)</button>`;
    el.prepend(card);
    $('#bk-export').onclick = (e) => exportAllData(e.currentTarget);
  };
})();