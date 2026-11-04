/**
 * 【LINE 訊息入口與事件處理】
 * LINE → doPost → 驗證入口密鑰 → 排除重送 → 準備主題 → 問答 → Reply API。
 * 純 GAS 無法取得 LINE 簽章標頭；秘密網址只能控管入口，不能驗證來源簽章。
 */

/**
 * 一般網址顯示版本；?view=review 只提供管理頁外殼，不直接夾帶履歷。
 */
function doGet(e) {
  if (e && e.parameter && ['review', 'invitations'].indexOf(e.parameter.view) >= 0) return HtmlService.createHtmlOutput(
    e.parameter.view === 'invitations' ? reviewHtml_().replace('<body>', '<body data-start="invitations">') : reviewHtml_());
  return webhookOutput_('LINE 履歷助理已部署。版本 ' + appVersion_() +
    '<!--RESUMERAGBOT_VERSION=' + appVersion_() + '-->');
}

/**
 * LINE Webhook 的 HTTP POST 入口；請勿在編輯器手動執行代替測試。
 * 一批事件各自處理，一件錯誤不應擋住其他事件。
 */
function doPost(e) {
  if (!e) {
    console.log('doPost 需要 LINE Webhook 事件，請勿在編輯器直接測試。初次設定請執行 initializeProject；檢查設定請執行 checkSetup。');
    return webhookOutput_('請透過 LINE 傳送訊息測試，或在編輯器執行 checkSetup。');
  }
  try {
    var cfg = config_();
    // 秘密網址是入口控管，不能證明請求一定來自 LINE。
    verifyWebhookToken_(e && e.parameter && e.parameter.key, cfg.webhookToken);
    var body = e && e.postData && e.postData.contents;
    if (typeof body !== 'string' || body.length > 180000) throw new Error('INVALID_BODY');
    var payload = JSON.parse(body);
    if (!payload || !Array.isArray(payload.events) || payload.events.length > 100) throw new Error('INVALID_EVENTS');
    var receivedAt = Date.now();
    payload.events.forEach(function (event) {
      try {
        if (Date.now() - receivedAt > 45000) { safeLog_('BATCH_DEADLINE'); return; }
        handleEvent_(event, cfg);
      } catch (error) { safeLog_(errorCode_(error)); }
    });
    return webhookOutput_('OK');
  } catch (error) {
    safeLog_(errorCode_(error));
    return webhookOutput_('Ignored');
  }
}

/**
 * 使用 HtmlService 回應，避免 ContentService 的轉址干擾 LINE 驗證。
 */
function webhookOutput_(message) {
  // 回應 LINE 時使用不需 ContentService 轉址的網頁輸出。
  return HtmlService.createHtmlOutput(message);
}

/**
 * 比對網址上的入口密鑰；這不等於驗證 LINE 簽章。
 */
function verifyWebhookToken_(provided, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('MISSING_WEBHOOK_TOKEN');
  if (typeof provided !== 'string' || !constantEqual_(provided, expected)) throw new Error('INVALID_WEBHOOK_TOKEN');
}

/**
 * 逐字比較密鑰，避免在第一個不同字元就結束比較。
 */
function constantEqual_(a, b) {
  if (a.length !== b.length) return false;
  var difference = 0;
  for (var i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/**
 * 將 LINE 事件 ID 雜湊，作為去重識別，不保存原始事件 ID。
 */
function eventKey_(event) {
  var id = event.webhookEventId || (event.message && event.message.id) || event.replyToken;
  if (typeof id !== 'string' || !id) throw new Error('INVALID_EVENT_ID');
  return 'evt_' + sha256_(id).slice(0, 40);
}

/**
 * 以鎖與短期處理狀態排除重送，防止同一事件重複呼叫 AI 與回覆。
 */
function claimEvent_(key) {
  var lock = LockService.getScriptLock();
  lock.waitLock(3000);
  try {
    var props = PropertiesService.getScriptProperties(), now = Date.now();
    var previous = JSON.parse(props.getProperty(key) || 'null');
    if (previous && previous.until > now) return previous.state === 'done' ? 'duplicate' : 'busy';
    // 去重狀態有數量與時間上限；這裡不保存原始 LINE ID 或訊息文字。
    var all = props.getProperties();
    Object.keys(all).filter(function (name) { return name.indexOf('evt_') === 0; }).forEach(function (name) {
      try { if (JSON.parse(all[name]).until <= now) props.deleteProperty(name); }
      catch (_) { props.deleteProperty(name); }
    });
    if (Object.keys(props.getProperties()).filter(function (n) { return n.indexOf('evt_') === 0; }).length >= 1800) {
      throw new Error('EVENT_CAPACITY');
    }
    props.setProperty(key, JSON.stringify({ state: 'busy', until: now + 7 * 60 * 1000 }));
    return 'claimed';
  } finally { lock.releaseLock(); }
}

/**
 * 單一事件流程：準備選單 → 處理操作／問題 → LINE 回覆 → 成功後保存記憶。
 * 只處理一對一主動事件；群組、待命或沒有 replyToken 的事件略過。
 */
function handleEvent_(event, cfg) {
  if (!event || event.mode === 'standby' || !event.source || event.source.type !== 'user' ||
      typeof event.source.userId !== 'string' || typeof event.replyToken !== 'string' || !event.replyToken ||
      ['follow', 'message', 'postback'].indexOf(event.type) < 0) return 'ignored';
  var key = eventKey_(event), claim = claimEvent_(key);
  if (claim === 'duplicate') return 'duplicate';
  if (claim === 'busy') throw new Error('EVENT_BUSY');
  try {
    MESSAGE_TOPICS_ = [];
    var messages, conversation = null, social = null, dialogueIntent = 'neutral', startedAt = Date.now();
    var text = event.type === 'message' && event.message && event.message.type === 'text' ? event.message.text : '';
    if (event.type === 'postback') text = event.postback && event.postback.data || '';
    text = typeof text === 'string' ? text.trim() : '';
    var prepared = null;
    if (cfg.enabled) {
      try {
        var currentIndex = loadIndex_(cfg);
        if (currentIndex) { var currentSource = readPublicSource_(cfg); setMessageTopics_(currentIndex, currentSource);
          prepared = { index: currentIndex, source: currentSource }; }
      } catch (_) { MESSAGE_TOPICS_ = []; }
    }
    var jobMatch = null;
    if (!cfg.enabled) messages = [textMessage_('履歷助理目前暫停服務，請稍後再試。')];
    else if ((jobMatch = handleJobMatch_(event, text, cfg))) {
      // v3 職缺對照：職缺可長於一般問題，先於 800 字限制處理；職缺文字不保存、不記為待補充問題。
      if (jobMatch.analyze) {
        startLoading_(event.source.userId, cfg);
        try { messages = analyzeJobPosting_(jobMatch.analyze, cfg, prepared, event.source.userId); }
        catch (error) { safeLog_(errorCode_(error)); messages = [textMessage_(ragErrorMessage_(error))]; }
      } else messages = jobMatch.messages;
    }
    else if ((messages = handleContact_(event, text, cfg, prepared))) { /* 聯繫與邀約不經 RAG。 */ }
    else if (/^(清除對話|重新開始|reset)$/i.test(text)) {
      clearConversation_(event.source.userId);
      CacheService.getScriptCache().remove(stickerHistoryKey_(event.source.userId));
      messages = [textMessage_('短期對話記憶已清除，現在可以開始新的問題。')];
    }
    else if (event.type === 'follow' || /^(選單|首頁|回首頁|履歷首頁|menu|home|開始|nav:home)$/i.test(text)) {
      messages = [welcomeMessage_(cfg, prepared)];
    }
    else if (/^(使用說明|說明|help)$/i.test(text)) messages = [textMessage_(helpText_())];
    else if (/^(隱私|privacy)$/i.test(text)) messages = [textMessage_(privacyText_())];
    else if (event.type === 'postback' && text.indexOf('evidence:') === 0) {
      // 舊訊息的按鈕無法從 LINE 歷史中移除；僅告知停用，不讀依據或啟動 RAG。
      messages = [textMessage_('「展開答案依據」功能已取消。')];
    }
    else if (event.type === 'message' && (social = socialDialogue_(text, cfg, prepared))) {
      messages = social.messages; dialogueIntent = social.intent;
    }
    else if (!text) messages = [textMessage_('請輸入文字問題，或點選下方的履歷主題。')];
    else if (text.length > 800) messages = [textMessage_('請將問題縮短至 800 字以內；你也可以分開詢問不同的經歷或專案。')];
    else {
      var questions = {
        '個人介紹': '請根據公開履歷，用 30 秒介紹這位求職者的背景、專長與求職方向。',
        '專業技能': '有哪些專業技能？請用履歷中的經驗或作品舉例。',
        '工作經歷': '請整理主要工作經歷、職務和具體成果。',
        '專案作品': '有哪些代表專案？請說明問題、本人負責內容、技術與成果。',
        '聯絡方式': '履歷提供哪些公開聯絡方式與作品連結？請保留原文。'
      };
      startLoading_(event.source.userId, cfg);
      try {
        var selected = /^work:([a-f0-9]{64})$/.exec(text);
        var selectedTopic = /^topic:([a-f0-9]{16})$/.exec(text);
        var question = selected ? '請介紹這件作品的可見內容，以及履歷明確記載的本人角色。' : selectedTopic ? '請介紹所選主題的履歷內容。' : questions[text] || text;
        conversation = answerLineConversation_(question, cfg, selected ? '詢問選定作品' : text,
          event.source.userId, selected && selected[1], /^(作品圖庫|作品集|gallery)$/i.test(text), selectedTopic && selectedTopic[1], prepared);
        messages = conversation.messages;
      }
      catch (error) {
        safeLog_(errorCode_(error));
        MESSAGE_TOPICS_ = [];
        messages = [textMessage_(ragErrorMessage_(error))];
      }
    }
    // 先有正確的內容／操作結果，再決定貼圖；錯誤、草稿及首頁不因裝飾多加一張。
    if (conversation) dialogueIntent = dialogueStickerIntent_(text, conversation);
    else if (cfg.enabled && messages[0] && messages[0].type === 'flex' && (text === 'nav:contact' || contactIntent_(text))) dialogueIntent = 'contact';
    else if (messages[0] && /^邀約已存入/.test(messages[0].text || '')) dialogueIntent = 'invitation_received';
    var sticker = contextualSticker_(messages, dialogueIntent, event.source.userId);
    if (sticker) messages = messages.concat([sticker]);
    var result = lineReply_(event.replyToken, messages, cfg);
    if (result === 'replied' && sticker) rememberDialogueSticker_(dialogueIntent, event.source.userId);
    if (result === 'replied' && conversation && conversation.fingerprint && conversation.request) {
      try { saveConversation_(event.source.userId, conversation.fingerprint, conversation.request, conversation.works, startedAt); }
      catch (error) { safeLog_(errorCode_(error)); }
    }
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({ state: 'done', until: Date.now() + 86400000 }));
    return result;
  } catch (error) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    throw error;
  }
}
