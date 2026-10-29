/* สำรองรูปภาพทั้งหมดจาก Storage เป็นไฟล์ ZIP (เฉพาะแอดมิน, อ่านอย่างเดียว ไม่แก้ข้อมูล) */
(function () {
  // ตารางที่เก็บชื่อพาธรูป: [ตาราง, คอลัมน์, เป็นอาร์เรย์หรือไม่]
  const SOURCES = [
    ['items', 'image_path', false],
    ['receipts', 'image_paths', true],
    ['dispatches', 'proof_paths', true],
    ['defects', 'image_paths', true],
    ['supplier_returns', 'proof_paths', true]
  ];

  // รวมชื่อพาธรูปทั้งหมดจากทุกตาราง โดยไม่ซ้ำกัน
  async function collectPaths() {
    const set = new Set();
    for (const [table, col, isArray] of SOURCES) {
      const { data, error } = await sb.from(table).select(col);
      if (error) throw new Error(`อ่านตาราง ${table} ไม่สำเร็จ: ${error.message}`);
      data.forEach(row => {
        const v = row[col];
        if (isArray) (v || []).forEach(p => { if (p) set.add(p); });
        else if (v) set.add(v);
      });
    }
    return [...set];
  }

  async function exportPhotos(btn, statusEl) {
    if (!isAdmin()) return toast('เฉพาะผู้ดูแลระบบที่สำรองรูปได้', true);
    if (typeof JSZip === 'undefined') {
      return toast('โหลดตัวสร้าง ZIP ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต', true);
    }

    btn.disabled = true;
    try {
      const paths = await collectPaths();
      if (!paths.length) {
        statusEl.textContent = 'ไม่มีรูปให้สำรอง';
        return;
      }

      const zip = new JSZip();
      let ok = 0;
      const fail = [];
      for (let i = 0; i < paths.length; i++) {
        statusEl.textContent = `กำลังดึงรูป ${i + 1} / ${paths.length} ...`;
        const { data, error } = await sb.storage.from('photos').download(paths[i]);
        if (error || !data) { fail.push(paths[i]); continue; }
        zip.file(paths[i], data); // เก็บตามโครงโฟลเดอร์เดิมใน Storage
        ok++;
      }

      statusEl.textContent = 'กำลังสร้างไฟล์ ZIP ...';
      const blob = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `สำรองรูปภาพ_${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);

      statusEl.textContent = `สำรองแล้ว ${ok} / ${paths.length} รูป` +
        (fail.length ? ` (ไม่สำเร็จ ${fail.length} รูป)` : '');
      if (fail.length) console.warn('รูปที่สำรองไม่สำเร็จ:', fail);
      toast('ส่งออกรูปภาพ ZIP แล้ว');
    } catch (e) {
      statusEl.textContent = '';
      toast(friendlyError(e), true);
    } finally {
      btn.disabled = false;
    }
  }

  // เพิ่มกล่องสำรองรูปไว้บนสุดของเมนู 11 (ต่อจากกล่องสำรองข้อมูลเดิม)
  const prevUsers = window.PAGES.users;
  window.PAGES.users = async (el) => {
    await prevUsers(el);
    if (!isAdmin()) return;

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>สำรองรูปภาพทั้งหมด</h3>
      <p class="muted small">รวมรูปสินค้า รูปใบรับ รูปการส่งมอบ รูปตำหนิ และรูปเอกสารส่งคืน
      ดาวน์โหลดเป็นไฟล์ ZIP ไฟล์เดียว โครงโฟลเดอร์ในไฟล์ตรงกับตำแหน่งในระบบ</p>
      <button class="btn primary" id="bkp-photos">ส่งออกรูปภาพทั้งหมด (ZIP)</button>
      <p class="muted small" id="bkp-photos-status"></p>`;
    el.prepend(card);

    const btn = $('#bkp-photos');
    btn.onclick = () => exportPhotos(btn, $('#bkp-photos-status'));
  };
})();