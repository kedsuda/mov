// ค่าเริ่มต้นสำหรับเปิดไฟล์โดยตรง — ตอน build (npm run build) ไฟล์นี้ใน dist/ จะถูกสร้างใหม่
// จาก environment variables (TMDB_API_KEY ฯลฯ) ดู .env.example
// หมายเหตุ: คีย์ที่ build เข้าไปจะมองเห็นได้สาธารณะในเบราว์เซอร์ — ใช้คีย์แบบอ่านอย่างเดียวเท่านั้น
window.CONFIG = {
  TMDB_KEY: "",
  REGION: "TH",
  LANGUAGE: "th-TH",
  REFRESH_MINUTES: 5
};
