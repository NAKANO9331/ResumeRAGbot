/**
 * 【共用設定與小工具】
 * 金鑰只從 GAS「專案設定 → 指令碼屬性」讀取，分享程式時不會帶出。
 * appVersion_ 是安裝包版本；GAS 部署的版本 1、版本 2 是另一種快照編號。
 */

/**
 * 集中讀取設定，不直接在程式寫入任何真實金鑰。
 * 數值設定超出範圍時明確報錯，避免帶著錯誤設定繼續執行。
 */
function config_() {
  var p = PropertiesService.getScriptProperties();
  var get = function (key, fallback) {
    return String(p.getProperty(key) || '').trim() || fallback || '';
  };
  var num = function (key, fallback, min, max) {
    var value = Number(get(key, String(fallback)));
    if (!Number.isFinite(value) || value < min || value > max) throw new Error('CONFIG_' + key);
    return value;
  };
  return {
    docId: resumeDocumentId_(get('RESUME_DOC_ID')),
    tabIds: get('DOC_TAB_IDS', 't.0').split(',').map(function (s) { return s.trim(); }),
    name: get('DISPLAY_NAME', '個人履歷'),
    tagline: get('TAGLINE', '從經歷、作品與技能，認識下一位合作夥伴。'),
    lineToken: get('LINE_CHANNEL_ACCESS_TOKEN'),
    geminiKey: get('GEMINI_API_KEY'),
    webhookToken: get('WEBHOOK_TOKEN'),
    generationModel: get('GEMINI_MODEL', 'gemini-3.5-flash-lite'),
    imageModel: get('GEMINI_IMAGE_MODEL', get('GEMINI_MODEL', 'gemini-3.5-flash-lite')),
    embeddingModel: 'gemini-embedding-001',
    dimensions: 768,
    minSimilarity: num('MIN_SIMILARITY', 0.4, 0, 1),
    topK: 5,
    enabled: get('BOT_ENABLED', 'true').toLowerCase() === 'true'
  };
}

/**
 * 目前程式版本；發布時須與 package.json、學生安裝包及正式部署一致。
 */
function appVersion_() { return '3.0.0'; }

/**
 * 接受原始文件 ID 或一般 Google Docs 網址，統一取得文件 ID。
 */
function resumeDocumentId_(value) {
  var match = String(value).match(/^https:\/\/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)(?:[\/?#]|$)/);
  return match ? match[1] : value;
}

/**
 * 拒絕空值與 YOUR_ 等教學占位文字；只回報欄位名稱，不洩漏內容。
 */
function requireValue_(value, key) {
  value = String(value || '').trim();
  if (!value || /^(YOUR_|REPLACE_|貼上|待填)/i.test(value)) throw new Error('MISSING_' + key);
  return value;
}

/**
 * 用於設定診斷：只檢查有沒有填值，不能保證金鑰真的有效。
 */
function valueConfigured_(value, key) {
  try { requireValue_(value, key); return true; } catch (_) { return false; }
}

/**
 * 產生固定長度雜湊，供內容比對、事件去重與識別鍵使用。
 */
function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/**
 * 執行記錄只留下安全錯誤碼，不印出金鑰、訪客問題或 API 回應全文。
 */
function safeLog_(code) {
  // 只記錄程式錯誤碼；訪客問題、憑證、replyToken 與 API 內容不寫入記錄。
  console.log(JSON.stringify({ code: String(code).replace(/[^A-Z0-9_]/g, '').slice(0, 80) }));
}

/**
 * 只接受預期格式的錯誤碼；其他例外統一轉為 UNEXPECTED_ERROR。
 */
function errorCode_(error) {
  var message = String(error && error.message || 'UNKNOWN');
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(message) ? message : 'UNEXPECTED_ERROR';
}

/**
 * 編輯器管理功能只允許「目前登入者 = 執行者」。
 * 公開 Web App 可能取不到登入 Email，所以校對頁另使用限時管理憑證。
 */
function requireOwner_() {
  // 公開函式可經由 google.script.run 被呼叫，必須真的核對身分，不能只靠註解限制。
  var active = Session.getActiveUser().getEmail();
  var effective = Session.getEffectiveUser().getEmail();
  if (!active || !effective || active !== effective) throw new Error('OWNER_ONLY');
}
