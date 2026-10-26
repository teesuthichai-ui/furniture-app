วิธีเริ่มใช้งานระบบ (สำหรับผู้เริ่มต้น)

1. เปิดไฟล์ js/config.js ใน VS Code
2. ใส่ Project URL ในช่องที่ 1 และ anon public key ในช่องที่ 2 (ห้ามใส่ service_role หรือ secret key)
3. บันทึกไฟล์ (Ctrl+S หรือ Cmd+S)
4. คลิกขวาที่ index.html แล้วเลือก Open with Live Server
5. เข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบที่สร้างไว้ใน Supabase

การนำขึ้นเว็บ (GitHub Pages ฟรี)
- สร้าง Repository แบบ Public ชื่อ furniture-app แล้วอัปโหลดไฟล์และโฟลเดอร์ทั้งหมดในโฟลเดอร์นี้
- Settings > Pages > Deploy from a branch > main > / (root) > Save
- ใน Supabase > Authentication > URL Configuration ตั้ง Site URL เป็นลิงก์ของเว็บ
