// src/utils/fetchHolidays.js
// 台灣國定假日 — 資料來源：行政院人事行政總處辦公日曆表
// 透過 ruyut/TaiwanCalendar (GitHub) 提供的 jsDelivr CDN 取得
// CDN 網址：https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json
// 資料格式：[{ date: "20260619", week: "五", isHoliday: true, description: "端午節" }]
// week 欄位：日=週日, 一=週一 ... 六=週六

export async function fetchTaiwanHolidaysForMonth(month) {
  const [year, mon] = month.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const prefix = `${year}${pad(mon)}`; // e.g. "202606"

  // 主要來源：jsDelivr CDN（行政院官方 CSV 轉 JSON，含補假日期）
  try {
    const url = `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 過濾：指定月份 + 放假(isHoliday=true) + 非週六日（週六日本就放假，雙薪只算平日國定假日）
    const holidays = data
      .filter(r =>
        r.date.startsWith(prefix) &&
        r.isHoliday === true &&
        r.week !== '六' &&
        r.week !== '日'
      )
      .map(r => `${r.date.slice(0,4)}-${r.date.slice(4,6)}-${r.date.slice(6,8)}`);

    console.log(`[假日] ${month} 國定假日（ruyut/TaiwanCalendar）:`, holidays.length > 0 ? holidays.join(', ') : '無');
    return holidays;
  } catch (e1) {
    console.warn('[假日] jsDelivr CDN 失敗:', e1.message);
  }

  // 備用：nager.date
  try {
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/TW`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const padM = pad(mon);
    const holidays = data
      .filter(h => h.date.startsWith(`${year}-${padM}`))
      .map(h => h.date);
    console.log(`[假日] ${month} 國定假日（nager.date）:`, holidays.join(', ') || '無');
    return holidays;
  } catch (e2) {
    console.warn('[假日] nager.date 也失敗:', e2.message);
    return [];
  }
}
