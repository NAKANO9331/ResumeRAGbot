/**
 * 【聯繫本人與邀約收件匣】
 * Email 直接讀取 Doc 當下的公開正文，不經模型、不使用過期索引。
 * 邀約草稿只在訪客專屬快取內；確認後寫入私有管理檔，不寫 Doc、不送 Gemini。
 * 確認後先保存，再寄通知到 Doc 的公開 Email；通知寄出不代表面試已排定或對方已讀。
 */

/** 排除保留範例網域；有正常信箱才提供寄信按鈕。 */
function usableEmail_(email) {
  if (!/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}$/i.test(email || '')) return false;
  var domain = email.split('@')[1].toLowerCase();
  return !/(?:^|\.)(?:example\.(?:com|net|org)|invalid|test|localhost|example)$/.test(domain);
}

/** 優先使用聯絡章節的信箱，其次採用正文中明確標示 Email 的行；圖片與私人區不讀取。 */
function publicContact_(cfg, prepared) {
  var source = prepared && prepared.source || readPublicSource_(cfg);
  var chunks = source.chunks.filter(function (chunk) { return !chunk.imageKey; });
  var labelled = chunks.filter(function (chunk) { return /聯絡|聯繫|contact/i.test(chunk.section); }).map(function (chunk) { return chunk.text; });
  var lines = chunks.map(function (chunk) { return chunk.text; }).join('\n').split('\n')
    .filter(function (line) { return /(?:e-?mail|電子郵件|電子信箱|信箱)\s*[：:]/i.test(line); });
  var emails = (labelled.join('\n') + '\n' + lines.join('\n')).match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  emails = Array.from(new Set(emails));
  return { email: emails.find(usableEmail_) || emails[0] || '', available: emails.some(usableEmail_) };
}

/** 自然的聯繫意圖才進入邀約入口，單純詢問過去的合作經驗仍走 RAG。 */
function contactIntent_(text) {
  if (/^(?:聯繫本人|聯絡本人|聯絡方式|聯繫方式|如何聯絡|如何聯繫|contact)[？?！!。]?$/i.test(text)) return true;
  if (/不想|不打算|不要|沒有要|沒打算/.test(text)) return false;
  if (/(?:邀請|邀約).{0,12}(?:面試|合作)/.test(text)) return true;
  if (/(?:了解|知道|詢問).{0,15}(?:合作|面試)|(?:過去|之前).{0,5}合作|合作.{0,5}(?:經驗|案例)/.test(text)) return false;
  return /(?:想|希望|打算|有意|可以|能否|能不能|可否).{0,18}(?:約.{0,4}面試|邀.{0,5}面試|安排.{0,4}面試|面試邀約|與.{0,5}合作|跟.{0,5}合作|合作洽談|合作|聯絡(?:你|您|本人)|聯繫(?:你|您|本人))/.test(text) ||
    /(?:邀請|邀約).{0,12}(?:面試|合作)|^(?:想約面試|面試邀約|合作邀約|合作洽詢|合作洽談)[？?！!。]?$/.test(text);
}

function contactButton_(label, data) { return { type: 'button', height: 'sm', style: 'secondary', action: { type: 'postback', label: label, data: data, displayText: label } }; }

/** 以原生 Flex 幾何圖形畫小型複製圖示，不需外部圖片網址。 */
function copyEmailIcon_(email) {
  function sheet(left, top, fill) { return { type: 'box', layout: 'vertical', position: 'absolute',
    width: '12px', height: '14px', offsetStart: left + 'px', offsetTop: top + 'px', cornerRadius: '2px',
    borderWidth: '1px', borderColor: '#23735B', backgroundColor: fill, contents: [] }; }
  return { type: 'box', layout: 'vertical', width: '32px', height: '32px', flex: 0, cornerRadius: '8px',
    backgroundColor: '#E8EFE9', action: { type: 'clipboard', label: '複製 Email', clipboardText: email },
    contents: [sheet(11, 6, '#E8EFE9'), sheet(7, 10, '#FAFBF8')] };
}

/** 首頁、文字意圖與「聯繫本人」按鈕共用這張卡片。 */
function contactMessage_(cfg, prepared) {
  var contact;
  try { contact = publicContact_(cfg, prepared); } catch (_) { contact = { email: '', available: false, unavailable: true }; }
  var contents = [{ type: 'text', text: '聯繫本人', size: 'lg', weight: 'bold', color: '#143D35' },
    { type: 'text', text: '面試邀約、職缺介紹或合作洽詢，都可以從這裡開始。', size: 'sm', wrap: true, color: '#53635E', margin: 'md' }];
  if (contact.email) {
    var address = { type: 'text', text: contact.email, size: 'sm', wrap: true, flex: 1, color: '#23735B' };
    if (contact.available) address.action = { type: 'postback', label: '取得 Email', data: 'contact:email', displayText: '取得 Email' };
    contents.push({ type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', margin: 'md',
      contents: contact.available ? [address, copyEmailIcon_(contact.email)] : [address] });
  }
  var buttons = [];
  if (contact.available) {
    contents.push({ type: 'text', text: '點右側圖示複製信箱；也可點信箱取得純文字，再自行寄信。', size: 'xs', wrap: true, color: '#687770', margin: 'md' });
  }
  else contents.push({ type: 'text', text: contact.unavailable ? '目前無法讀取聯絡資料，可先留下邀約。' : '目前尚未提供可收信的 Email，可先留下邀約。', size: 'xs', wrap: true, color: '#687770', margin: 'md' });
  contents.push({ type: 'text', text: 'LINE 邀約：在這裡填寫，確認送出後由機器人通知本人。', size: 'xs', wrap: true, color: '#687770', margin: 'md' });
  var invitationButton = contactButton_('在 LINE 留邀約', 'invite:start');
  invitationButton.style = 'primary'; invitationButton.color = '#23735B';
  buttons.push(invitationButton, contactButton_('回首頁', 'nav:home'));
  return { type: 'flex', altText: '聯繫本人｜Email 與留下邀約', quickReply: quickReply_(), contents: { type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', paddingAll: '20px', contents: contents },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } } };
}

function invitationKey_(userId, cfg) { return 'invite:' + sha256_(ScriptApp.getScriptId() + ':' + cfg.docId + ':' + userId); }
function invitationVisitor_(userId) { return sha256_(ScriptApp.getScriptId() + ':' + userId); }

/** 到期時間明確保存在草稿內，快取提早消失時也不把未確認資料送出。 */
function invitationDraft_(key) {
  var value;
  try { value = JSON.parse(CacheService.getScriptCache().get(key) || 'null'); } catch (_) {}
  if (!value || value.expiresAt <= Date.now()) { CacheService.getScriptCache().remove(key); return null; }
  return value;
}

var INVITATION_FIELDS_ = [
  { key: 'company', label: '公司與您的稱呼', prompt: '請輸入公司／單位與您的稱呼。', limit: 120 },
  { key: 'message', label: '職缺或合作內容', prompt: '請描述想邀約的職缺或合作內容。', limit: 800 },
  { key: 'replyTo', label: '回覆方式', prompt: '請留下本人可回覆您的方式，例如 Email、電話或 LINE ID。', limit: 200 },
  { key: 'availability', label: '方便聯繫的時段', prompt: '方便聯繫的時段？不限定可按「略過時段」。', limit: 120 }
];

function invitationPrompt_(draft) {
  var field = INVITATION_FIELDS_[draft.step], message = textMessage_('留下邀約 ' + (draft.step + 1) + ' / 4\n' + field.prompt +
    (draft.step === 0 && draft.jobPrefilled ? '\n\n「職缺或合作內容」已帶入剛才的職缺對照摘要，確認前可檢查或重新填寫。' : '') +
    (draft.step === 0 ? '\n\n確認後才會存入履歷主人的私有邀約收件匣，並以 Email 與已設定的 LINE 通知本人；填寫內容不交給 AI。30 分鐘內可繼續，輸入「取消」可離開。' : ''));
  message.quickReply = { items: [{ type: 'action', action: { type: 'postback', label: '取消邀約', data: 'invite:cancel', displayText: '取消邀約' } }] };
  if (draft.step === 3) message.quickReply.items.unshift({ type: 'action', action: { type: 'postback', label: '略過時段', data: 'invite:skip:' + draft.id, displayText: '略過時段' } });
  return [message];
}

function invitationConfirmation_(draft) {
  var lines = INVITATION_FIELDS_.map(function (field) { return field.label + '：' + (draft.fields[field.key] || '不限定'); });
  var summary = textMessage_('請確認邀約內容\n\n' + lines.join('\n\n') + '\n\n按「確認送出」後，以上資料會存入履歷主人的私有收件匣，並以 Email 與已設定的 LINE 通知本人。這不代表面試或合作已排定。');
  delete summary.quickReply;
  return [summary, { type: 'flex', altText: '確認送出邀約，或重新填寫', contents: { type: 'bubble', size: 'kilo',
    body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '要送出這份邀約嗎？', weight: 'bold', wrap: true }] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [contactButton_('確認送出', 'invite:submit:' + draft.id),
      contactButton_('重新填寫', 'invite:restart:' + draft.id), contactButton_('取消邀約', 'invite:cancel')] } } }];
}

function invitationReceipt_(record) {
  var status = record && record.notification && record.notification.status;
  var lineSent = record && record.lineNotification && record.lineNotification.status === 'sent';
  var detail = status === 'sent' ? 'Email 通知已送交 Google 寄送，請等候本人透過您留下的方式回覆。' :
    lineSent ? 'LINE 通知已送交平台推播，請等候本人透過您留下的方式回覆。' :
    status && status !== 'test_skipped' ? 'Email 通知尚未確認寄出，您也可以使用「聯繫本人」中的 Email 直接聯絡。' : '供本人確認並透過您留下的方式回覆。';
  return [textMessage_('邀約已存入履歷主人的私有收件匣。' + detail + '這不代表面試或合作已排定。')];
}

/** 通知信附完整邀約，主人可直接閱讀；只使用純文字，不執行訪客提供的 HTML。 */
function invitationEmail_(record, recipient) {
  var fields = record.fields;
  var message = { to: recipient, name: 'ResumeRAGbot 邀約通知', subject: '【ResumeRAGbot】收到新的面試／合作邀約',
    body: '有人透過您的履歷機器人留下邀約。\n\n' +
      INVITATION_FIELDS_.map(function (field) { return field.label + '：\n' + (fields[field.key] || '不限定'); }).join('\n\n') +
      '\n\n收到時間：' + Utilities.formatDate(new Date(record.createdAt), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss') + '（台北時間）' +
      '\n邀約編號：' + record.id + '\n\n邀約已保存在您的私人收件匣。請依對方留下的回覆方式聯繫；系統沒有自動安排面試。' };
  // Reply-To 只接受完整、單一的信箱；電話、LINE ID 或混合文字不當作郵件標頭。
  var replyTo = String(fields.replyTo || '').trim();
  if (usableEmail_(replyTo)) message.replyTo = replyTo;
  return message;
}

/**
 * 呼叫者已持有鎖且邀約已保存。先持久化 attempting，再呼叫寄信，避免重送事件重複發信。
 * MailApp 和 Drive 無法形成同一筆交易：寄送中斷或結果無法保存時保留待查狀態，不盲目重寄。
 * 通知失敗也不刪除邀約，且不把含訪客內容的原始服務錯誤寫入記錄。
 */
function notifyInvitation_(store, record, cfg, options) {
  if (record.notification) return;
  var notification = { status: 'preparing', updatedAt: new Date().toISOString() };
  record.notification = notification;
  function persist() { try { savePortfolioStore_(store, cfg); } catch (_) { safeLog_('INVITATION_NOTIFICATION_STATUS_SAVE_FAILED'); } }
  if (options && options.skipNotification) { notification.status = 'test_skipped'; persist(); return; }
  var contact;
  try { contact = publicContact_(cfg); } catch (_) { notification.status = 'source_unavailable'; persist(); return; }
  if (!contact.available) { notification.status = 'no_email'; persist(); return; }
  try {
    if (MailApp.getRemainingDailyQuota() < 1) { notification.status = 'quota_exhausted'; persist(); return; }
  } catch (_) { notification.status = 'permission_or_service_unavailable'; persist(); return; }
  notification.status = 'attempting';
  try { savePortfolioStore_(store, cfg); }
  catch (_) { notification.status = 'not_attempted'; safeLog_('INVITATION_NOTIFICATION_NOT_ATTEMPTED'); return; }
  try {
    MailApp.sendEmail(invitationEmail_(record, contact.email));
    notification.status = 'sent'; notification.sentAt = new Date().toISOString();
  } catch (_) { notification.status = 'delivery_unknown'; safeLog_('INVITATION_NOTIFICATION_DELIVERY_UNKNOWN'); }
  persist();
}

/**
 * 主人在編輯器執行一次，完成 Google 新增寄信權限授權，並寄啟用測試信到 Doc 信箱。
 * 不讀取 Gmail，不更改履歷／既有設定；測試信失敗時明確報錯，不宣稱啟用成功。
 */
function enableInvitationEmailNotifications() {
  requireOwner_();
  var contact = publicContact_(config_());
  if (!contact.available) throw new Error('請先在 Doc 的公開聯絡方式填入可收信的 Email。');
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('Google 今日寄信額度已用完，請待額度恢復後再執行。');
  MailApp.sendEmail({ to: contact.email, name: 'ResumeRAGbot 邀約通知', subject: '【ResumeRAGbot】邀約通知啟用測試',
    body: '這是您在 GAS 執行啟用功能所寄出的測試信。\n\n寄信權限已就緒。更新正式部署後，每當訪客確認送出邀約，通知信會包含邀約全文與對方的回覆方式，您不必進入 GAS 才能閱讀。\n\n這不是一份訪客邀約，不會寫入履歷或邀約收件匣。' });
  console.log('寄信權限已就緒，測試信已送交 Google 寄至 Doc 的聯絡信箱。請查看收件匣／垃圾郵件，並確認正式部署已更新。');
  return { status: 'ready', version: appVersion_() };
}

/**
 * 有鎖的單一事件交易：先保存草稿／確認紀錄，再交由入口傳 LINE 回覆。
 * 回覆失敗重送時沿用同一事件的結果；確認鍵以草稿 ID 去重，不能送出其他訪客或新版草稿。
 */
function handleContact_(event, text, cfg, prepared, options) {
  var key = invitationKey_(event.source.userId, cfg), cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  var pendingKey = 'pending_' + key;
  if (/^(?:使用說明|說明|help|隱私|privacy)$/i.test(text)) return null;
  if (event.type === 'follow' || /^(?:首頁|選單|回首頁|履歷首頁|home|menu|開始|nav:home|清除對話|重新開始|reset)$/i.test(text) || /^(?:topic|work):/.test(text)) {
    cache.remove(key); props.deleteProperty(pendingKey); return null;
  }
  if (text === 'nav:contact') { cache.remove(key); props.deleteProperty(pendingKey); return [contactMessage_(cfg, prepared)]; }
  // 回傳獨立純文字信箱，手機可長按、電腦可右鍵複製；不依賴 mailto 或剪貼簿動作的支援。
  if (text === 'contact:email' || /^(?:取得\s*Email|寄信地址)$/i.test(text)) {
    var contact;
    try { contact = publicContact_(cfg, prepared); } catch (_) {}
    if (!contact || !contact.available) return [textMessage_('目前無法取得可收信的 Email，請使用「聯繫本人」留下邀約。')];
    return [textMessage_(contact.email), textMessage_('請複製上一則信箱，貼到慣用的郵件服務寄信。若要直接在 LINE 完成，請選「在 LINE 留邀約」。')];
  }
  var lock = LockService.getScriptLock(); lock.waitLock(5000);
  try {
    var draft = invitationDraft_(key), eventId = eventKey_(event), outcomeKey = key + ':' + eventId;
    var outcome; try { outcome = JSON.parse(cache.get(outcomeKey) || 'null'); } catch (_) {}
    if (outcome && outcome.expiresAt > Date.now()) return outcome.messages;
    if (draft && draft.lastEvent === eventId) return draft.lastMessages;
    function remember(messages) {
      if (draft) { draft.lastEvent = eventId; draft.lastMessages = messages; cache.put(key, JSON.stringify(draft), 1800); }
      cache.put(outcomeKey, JSON.stringify({ expiresAt: Date.now() + 1800000, messages: messages }), 1800);
      return messages;
    }
    if (text === 'invite:cancel' || /^(?:取消|取消邀約)$/.test(text)) {
      cache.remove(key); props.deleteProperty(pendingKey); draft = null; return remember([textMessage_('已取消填寫，未送出新的邀約。')]);
    }
    if (text === 'invite:job') {
      // 由職缺對照帶入「職缺或合作內容」；摘要過期時不猜測內容，請訪客重新對照或手動填寫。
      var summary = jobMatchSummary_(event.source.userId);
      if (!summary) return remember([textMessage_('職缺對照結果已過期（約 30 分鐘）。請重新輸入「職缺對照」，或選「留下邀約」手動填寫。')]);
      draft = { id: sha256_(Utilities.getUuid()).slice(0, 32), step: 0, fields: { message: summary }, jobPrefilled: true, expiresAt: Date.now() + 1800000 };
      props.setProperty(pendingKey, draft.id);
      return remember(invitationPrompt_(draft));
    }
    if (text === 'invite:start' || text === '留下邀約' || draft && text === 'invite:restart:' + draft.id) {
      draft = { id: sha256_(Utilities.getUuid()).slice(0, 32), step: 0, fields: {}, expiresAt: Date.now() + 1800000 };
      props.setProperty(pendingKey, draft.id);
      return remember(invitationPrompt_(draft));
    }
    var submit = /^invite:submit:([a-f0-9]{32})$/.exec(text);
    if (submit) {
      var store = loadPortfolioStore_(cfg), records = store.invitations || {}, existing = records[submit[1]], visitor = invitationVisitor_(event.source.userId);
      if (existing && existing.visitor === visitor) { props.deleteProperty(pendingKey); return invitationReceipt_(existing); }
      if (!draft || draft.id !== submit[1] || draft.step !== 4) return [textMessage_('這份確認已過期或已被新的草稿取代。請使用最新確認卡片，或重新選擇「留下邀約」。')];
      try {
        records[draft.id] = { id: draft.id, visitor: visitor, createdAt: new Date().toISOString(), status: 'new', fields: draft.fields };
        store.invitations = records;
        // 本函式已持鎖，不再次呼叫會取得同一把鎖的 updatePortfolioStore_。
        savePortfolioStore_(store, cfg);
      } catch (_) { safeLog_('INVITATION_SAVE_FAILED'); return [textMessage_('邀約尚未保存成功，請稍後再按一次「確認送出」。目前沒有寄出 Email。')].concat(invitationConfirmation_(draft)); }
      notifyInvitation_(store, records[draft.id], cfg, options);
      notifyInvitationLine_(store, records[draft.id], cfg, options);
      props.deleteProperty(pendingKey);
      var receipt = invitationReceipt_(records[draft.id]);
      draft.step = 5; draft.fields = {}; return remember(receipt);
    }
    // 快取提早清除後，用不含個資的待填旗標攔住下一則訊息，避免誤送 RAG。
    if (!draft && props.getProperty(pendingKey)) { props.deleteProperty(pendingKey); return remember([textMessage_('邀約草稿已過期，剛才的內容沒有交給 AI 或送出。請重新選擇「留下邀約」，或輸入「首頁」離開。')]); }
    if (draft && draft.step < 4) {
      var field = INVITATION_FIELDS_[draft.step], value = text;
      if (text === 'invite:skip:' + draft.id && draft.step === 3) value = '';
      else if (event.type !== 'message' || !text || /^invite:/.test(text)) return invitationPrompt_(draft);
      else if (text.length > field.limit) return [textMessage_('這一欄請控制在 ' + field.limit + ' 字內，再傳送一次。')];
      draft.fields[field.key] = value; draft.step++;
      // 職缺內容已由對照結果帶入，略過這一欄；確認頁仍完整顯示，可選「重新填寫」改為手動。
      if (draft.jobPrefilled && INVITATION_FIELDS_[draft.step] && INVITATION_FIELDS_[draft.step].key === 'message') draft.step++;
      return remember(draft.step === 4 ? invitationConfirmation_(draft) : invitationPrompt_(draft));
    }
    if (draft && draft.step === 4) return invitationConfirmation_(draft);
    if (/^invite:/.test(text)) return [textMessage_('邀約草稿已失效，請重新選擇「留下邀約」。')];
    if (contactIntent_(text)) return [contactMessage_(cfg, prepared)];
    return null;
  } finally { lock.releaseLock(); }
}

/** 主人在 GAS 執行此入口；收件匣與圖片管理共用限時身分驗證。 */
function openInvitations() { return openOwnerPage_('invitations'); }

function getInvitations(token) {
  return reviewRpc_(token, function (cfg) {
    var store = loadPortfolioStore_(cfg), records = store.invitations || {};
    return { expiresAt: store.sessions[sha256_(token)].expiresAt, ownerLineConfigured: !!ownerLineUserId_(), invitations: Object.keys(records).map(function (id) {
      var r = records[id]; return { id: r.id, createdAt: r.createdAt, status: r.status, fields: r.fields,
        notification: r.notification ? { status: r.notification.status, sentAt: r.notification.sentAt } : null,
        lineNotification: r.lineNotification ? { status: r.lineNotification.status, sentAt: r.lineNotification.sentAt } : null };
    }).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }) };
  });
}

/** 僅持有效主人憑證者可標記處理或刪除；訪客無法讀取收件匣。 */
function updateInvitation(token, id, action) {
  return reviewRpc_(token, function (cfg) {
    if (!/^[a-f0-9]{32}$/.test(String(id)) || ['handled', 'new', 'delete'].indexOf(action) < 0) throw new Error('REVIEW_INVALID_INPUT');
    updatePortfolioStore_(cfg, function (store) {
      if (!store.invitations || !store.invitations[id]) return;
      if (action === 'delete') delete store.invitations[id];
      else store.invitations[id].status = action;
    });
    return { status: 'ok' };
  });
}

/**
 * 主人專用實測：用隔離的測試訪客完成填寫、確認、去重及私有保存，再清除本次測試紀錄。
 * 僅呼叫 LINE 的格式驗證 API；不向任何使用者傳送訊息，也不寄信。
 */
function testContactFlow(token) {
  return reviewRpc_(token, function (cfg) {
    var source = readPublicSource_(cfg), index = loadIndex_(cfg), prepared = { index: index, source: source };
    setMessageTopics_(index, source);
    var user = 'owner-contact-test:' + Utilities.getUuid(), events = [], messages = [], id = null;
    var key = invitationKey_(user, cfg), cache = CacheService.getScriptCache();
    function step(text, postback) {
      var e = { type: postback ? 'postback' : 'message', source: { type: 'user', userId: user }, webhookEventId: Utilities.getUuid() };
      events.push(e); return handleContact_(e, text, cfg, prepared, { skipNotification: true });
    }
    try {
      var contact = contactMessage_(cfg, prepared), home = welcomeMessage_(cfg, prepared);
      messages.push(home, contact);
      // 也驗證交流意圖會使用的官方貼圖，只檢查格式，不實際寄送或消耗推播額度。
      ['greet', 'confident', 'celebrate', 'interested', 'thanks', 'attentive', 'received'].forEach(function (mood) {
        messages.push(stickerMessage_(mood));
      });
      // 固定測試地址只驗證 Email 複製按鈕，沒有寄信，也不寫進 Doc 或實際聯繫卡。
      messages.push(contactMessage_(cfg, { source: { chunks: [{ section: '公開聯絡方式', text: 'Email：contact@resume-rag-bot-demo.org' }] } }));
      messages = messages.concat(step('invite:start', true));
      step('功能測試／測試聯絡人', false); step('驗證邀約確認與儲存流程。', false); step('test@example.invalid', false);
      id = invitationDraft_(key).id;
      messages = messages.concat(step('invite:skip:' + id, true));
      if ((loadPortfolioStore_(cfg).invitations || {})[id]) throw new Error('INVITATION_TEST_EARLY_SAVE');
      step('invite:submit:' + id, true); step('invite:submit:' + id, true);
      var stored = (loadPortfolioStore_(cfg).invitations || {})[id];
      if (!stored || stored.fields.replyTo !== 'test@example.invalid') throw new Error('INVITATION_TEST_SAVE_FAILED');
      for (var start = 0; start < messages.length; start += 5) {
        var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/validate/reply', {
          method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + cfg.lineToken },
          payload: JSON.stringify({ messages: messages.slice(start, start + 5) }), muteHttpExceptions: true
        });
        if (response.getResponseCode() !== 200) throw new Error('LINE_CARD_VALIDATION_' + response.getResponseCode());
      }
      return { status: 'passed', version: appVersion_(), emailAvailable: publicContact_(cfg, prepared).available,
        lineValidation: 'valid', persistedBeforeCleanup: true, contact: contact, home: home, confirmation: messages.slice(-2) };
    } finally {
      if (id) updatePortfolioStore_(cfg, function (store) { if (store.invitations) delete store.invitations[id]; });
      cache.remove(key); events.forEach(function (e) { cache.remove(key + ':' + eventKey_(e)); });
      PropertiesService.getScriptProperties().deleteProperty('pending_' + key);
    }
  });
}
