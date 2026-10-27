/* แกนหลัก: เชื่อมต่อ Supabase, เข้าสู่ระบบ, เมนู, สิทธิ์ */
window.PAGES = window.PAGES || {};
const cfg = window.APP_CONFIG || {};
let sb = null;
const state = { user: null, profile: null, role: null };

const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', warehouse: 'เจ้าหน้าที่คลังสินค้า', viewer: 'ผู้ดูรายงาน' };

const MENU = [
  { key: 'dashboard', label: '1. Dashboard ภาพรวมโครงการ' },
  { key: 'items', label: '2. ข้อมูลสินค้า' },
  { key: 'locations', label: '3. ข้อมูลจุด Drop และอาคาร' },
  { key: 'plan', label: '4. แผนกระจายสินค้า' },
  { key: 'receive', label: '5. รับสินค้าเข้า'},
  { key: 'dispatch', label: '6. จ่ายสินค้าไปยังอาคาร' },
  { key: 'stock', label: '7. คงเหลือแยกตามจุด Drop' },
  { key: 'progress', label: '8. ติดตามยอดส่งสินค้าแยกตามอาคาร' },
  { key: 'history', label: '9. ประวัติธุรกรรม' },
  { key: 'reports', label: '10. รายงานและพิมพ์เอกสาร' },
  { key: 'users', label: '11. จัดการผู้ใช้งานและสิทธิ์', adminOnly: true },
  { key: 'assembly', label: '12. ประกอบรายวัน' },
  { key: 'defects', label: '13. รายงานสินค้ามีตำหนิ' }
];

function $(selector) { return document.querySelector(selector); }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function num(value) { return Number(value || 0).toLocaleString('th-TH'); }
function isAdmin() { return state.role === 'admin'; }

function friendlyError(e) {
  const msg = (e && e.message) || String(e);
  if (e && e.code === '23505') return 'ข้อมูลซ้ำ: รหัสนี้มีอยู่ในระบบแล้ว';
  if (msg.includes('row-level security')) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (msg.includes('Invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (msg.includes('Failed to fetch')) return 'เชื่อมต่อ Supabase ไม่ได้ ตรวจสอบอินเทอร์เน็ตและค่าใน js/config.js';
  return msg;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function openModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modal-body').innerHTML = '';
}
window.closeModal = closeModal;

function showLogin(msg = '') {
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-msg').textContent = msg;
}

function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = state.profile.full_name || state.user.email;
  $('#user-role').textContent = ROLE_LABEL[state.role];
  buildMenu();
  route();
}

function buildMenu() {
  $('#menu').innerHTML = MENU
    .filter(m => !m.adminOnly || isAdmin())
    .map(m => `<a href="#${m.key}" data-key="${m.key}">${esc(m.label)}</a>`)
    .join('');
}

async function loadProfile(user) {
  const { data, error } = await sb.from('profiles')
    .select('full_name, role, active').eq('id', user.id).maybeSingle();
  if (error) { await sb.auth.signOut(); return showLogin(friendlyError(error)); }
  if (!data || !data.active || !data.role) {
    await sb.auth.signOut();
    return showLogin('บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
  }
  state.user = user;
  state.profile = data;
  state.role = data.role;
  showApp();
}

async function route() {
  if (!state.profile) return;
  const key = (location.hash || '#dashboard').slice(1);
  const item = MENU.find(m => m.key === key) || MENU[0];
  document.querySelectorAll('#menu a').forEach(a =>
    a.classList.toggle('active', a.dataset.key === item.key));

  const el = $('#content');
  if (item.adminOnly && !isAdmin()) {
    el.innerHTML = '<div class="card"><h2>ไม่มีสิทธิ์เข้าหน้านี้</h2></div>';
    return;
  }
  if (item.soon) {
    el.innerHTML = `<div class="card"><h2>${esc(item.label)}</h2><p class="muted">หน้านี้จะพัฒนาในส่วนถัดไป</p></div>`;
    return;
  }
  el.innerHTML = '<p class="muted">กำลังโหลด...</p>';
  try {
    await window.PAGES[item.key](el);
  } catch (e) {
    el.innerHTML = `<div class="card error">เกิดข้อผิดพลาด: ${esc(friendlyError(e))}</div>`;
  }
}

function bindEvents() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    btn.disabled = true;
    $('#login-msg').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({
      email: $('#email').value.trim(),
      password: $('#password').value
    });
    btn.disabled = false;
    if (error) return showLogin(friendlyError(error));
    await loadProfile(data.user);
  });

  $('#logout-btn').onclick = async () => {
    await sb.auth.signOut();
    state.user = state.profile = state.role = null;
    location.hash = '';
    showLogin('ออกจากระบบแล้ว');
  };
  $('#menu-btn').onclick = () => document.body.classList.toggle('menu-open');
  $('#overlay').onclick = () => document.body.classList.remove('menu-open');
  $('#menu').onclick = () => document.body.classList.remove('menu-open');
  $('#modal-close').onclick = closeModal;
  window.addEventListener('hashchange', route);
}

function init() {
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.includes('ใส่')) {
    return showLogin('ยังไม่ได้ใส่ค่า SUPABASE_URL และ SUPABASE_ANON_KEY ในไฟล์ js/config.js');
  }
  if (!window.supabase) {
    return showLogin('โหลดไลบรารี Supabase ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต');
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  bindEvents();
  sb.auth.getSession().then(({ data }) => {
    if (data.session) loadProfile(data.session.user);
    else showLogin();
  });
}
window.addEventListener('load', init);
