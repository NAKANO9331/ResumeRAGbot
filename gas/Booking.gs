/**
 * 【預約面談時段】
 * 主人在指令碼屬性 INTERVIEW_SLOTS 列出可面談的時段（台北時間），每行或以逗號分隔一個：
 *   2026-11-10 14:00-15:00
 *   2026-11-12 10:00
 * 人資點「預約面談」→ 選時段 → 沿用邀約流程填公司、內容、回覆方式 → 確認送出。
 * 送出時在鎖內再核對一次，已被預約、已過期或主人已移除的時段不能送出；同一時段只保留給一份邀約。
 * 預約只存在主人的私有管理檔（store.bookings），不寫 Doc、不交給 AI。主人在收件匣刪除該邀約即釋出時段。
 */

var BOOKING_MIN_LEAD_MS = 3600000, BOOKING_MAX_SHOWN = 6, BOOKING_OFFSET_MS = 8 * 3600000;

/** 解析一個時段；格式或日期不正確時回傳 null，不猜測。 */
function parseInterviewSlot_(part) {
  var m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?:\s*[-~～–]\s*(\d{1,2}):(\d{2}))?\s*$/.exec(part);
  if (!m) return null;
  var n = m.slice(1).map(function (v) { return v === undefined ? null : Number(v); });
  if (n[3] > 23 || n[4] > 59 || (n[5] !== null && (n[5] > 23 || n[6] > 59))) return null;
  var start = Date.UTC(n[0], n[1] - 1, n[2], n[3], n[4]) - BOOKING_OFFSET_MS, local = new Date(start + BOOKING_OFFSET_MS);
  // 2026-02-30 這類不存在的日期會被 Date 進位，必須拒絕。
  if (local.getUTCFullYear() !== n[0] || local.getUTCMonth() !== n[1] - 1 || local.getUTCDate() !== n[2]) return null;
  var end = n[5] === null ? null : Date.UTC(n[0], n[1] - 1, n[2], n[5], n[6]) - BOOKING_OFFSET_MS;
  if (end !== null && end <= start) return null;
  function hm(h, mm) { return ('0' + h).slice(-2) + ':' + ('0' + mm).slice(-2); }
  var label = n[1] + '/' + n[2] + '（' + '日一二三四五六'.charAt(local.getUTCDay()) + '）' + hm(n[3], n[4]) + (end === null ? '' : '–' + hm(n[5], n[6]));
  var normalized = n[0] + '-' + n[1] + '-' + n[2] + ' ' + hm(n[3], n[4]) + (end === null ? '' : '-' + hm(n[5], n[6]));
  return { key: sha256_(normalized).slice(0, 12), start: start, end: end, label: label };
}

/** 讀取主人設定的全部時段（含已過期），依時間排序並去除重複。 */
function interviewSlots_() {
  var raw = String(PropertiesService.getScriptProperties().getProperty('INTERVIEW_SLOTS') || '');
  var seen = {}, slots = [], invalid = 0;
  raw.split(/[\n,;，；、]+/).forEach(function (part) {
    if (!part.trim()) return;
    var slot = parseInterviewSlot_(part);
    if (!slot) { invalid++; return; }
    if (!seen[slot.key]) { seen[slot.key] = true; slots.push(slot); }
  });
  slots.sort(function (a, b) { return a.start - b.start; });
  return { slots: slots, invalid: invalid };
}

/** 未來且未被有效邀約佔用的時段；邀約已被主人刪除的預約視為釋出。 */
function availableSlots_(store) {
  var bookings = store && store.bookings || {}, invitations = store && store.invitations || {}, now = Date.now();
  return interviewSlots_().slots.filter(function (slot) {
    var booking = bookings[slot.key];
    return slot.start > now + BOOKING_MIN_LEAD_MS && !(booking && invitations[booking.invitationId]);
  });
}

/** 聯繫卡只需知道「有沒有未來時段」，不讀管理檔。 */
function hasFutureSlots_() {
  var now = Date.now();
  return interviewSlots_().slots.some(function (slot) { return slot.start > now + BOOKING_MIN_LEAD_MS; });
}

function bookingIntent_(text) {
  return text === 'book:start' || text === 'book:job' || /^(?:預約面談|預約面試|面談預約|面試預約|約面談時間|約面試時間)$/.test(text);
}

/** 邀約欄位中的時段文字；Email、LINE 通知與收件匣都直接顯示。 */
function bookingAvailabilityText_(slot) { return '已預約 ' + slot.label + '（台北時間）；時段已暫時保留，請與對方確認。'; }

/** 時段選擇卡：最多 6 個；從職缺對照來的按鈕會帶 :job，後續帶入對照摘要。 */
function slotPickerMessage_(slots, withJob) {
  var shown = slots.slice(0, BOOKING_MAX_SHOWN);
  return { type: 'flex', altText: '選擇面談時段', quickReply: quickReply_(), contents: { type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: '預約面談', weight: 'bold', size: 'lg', color: '#143D35' },
      { type: 'text', text: '請選擇方便的時段（台北時間）。接著填寫公司與回覆方式，確認送出後才會保留時段並通知本人。', size: 'xs', wrap: true, color: '#53635E' }
    ].concat(slots.length > BOOKING_MAX_SHOWN ? [{ type: 'text', text: '僅顯示最近 ' + BOOKING_MAX_SHOWN + ' 個時段。', size: 'xxs', color: '#687770' }] : []) },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: shown.map(function (slot) {
      return contactButton_(slot.label, 'book:slot:' + slot.key + (withJob ? ':job' : ''));
    }).concat([contactButton_('改為留下邀約', 'invite:start')]) } } };
}

/**
 * 主人在 GAS 編輯器執行，檢查 INTERVIEW_SLOTS 解析結果與哪些時段已被預約；不顯示訪客資料。
 */
function listInterviewSlots() {
  requireOwner_();
  var cfg = config_(), parsed = interviewSlots_(), store = null;
  try { store = loadPortfolioStore_(cfg); } catch (_) {}
  var open = availableSlots_(store).map(function (slot) { return slot.key; }), now = Date.now();
  var result = { invalid: parsed.invalid, slots: parsed.slots.map(function (slot) {
    return { slot: slot.label, status: slot.start <= now + BOOKING_MIN_LEAD_MS ? 'past' : open.indexOf(slot.key) >= 0 ? 'open' : 'booked' };
  }) };
  console.log(JSON.stringify(result, null, 2));
  if (parsed.invalid) console.log('有 ' + parsed.invalid + ' 個時段格式不正確，請使用「2026-11-10 14:00-15:00」的格式（台北時間）。');
  return result;
}
