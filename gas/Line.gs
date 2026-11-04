/**
 * 【LINE 顯示與訊息傳送】
 * 本檔只負責將資料組成文字、貼圖與 Flex 首頁，以及呼叫 LINE API。
 * Quick Reply 使用同步後的同一份代表主題；操作指令不混入代表關鍵字。
 */

/**
 * 固定兩個基本入口，加上本次有效的適性主題；不在聊天時重新分類。
 */
function quickReply_() {
  return { items: visibleMenuTopics_().map(function (topic) {
    return { type: 'action', action: { type: 'postback', label: topic.label, data: 'topic:' + topic.id, displayText: topic.label } };
  }) };
}

var LINE_STICKERS_ = {
  celebrate: { packageId: '11537', stickerId: '52002734' }, // 熊大慶祝（適合專案成果、代表作品、亮點成就）
  greet:     { packageId: '11537', stickerId: '52002738' }, // 兔兔與莎莉探頭招呼：開始認識
  thanks:    { packageId: '11537', stickerId: '52002739' }, // 熊大感謝（適合聯絡方式、作品連結、期待合作）
  confident: { packageId: '11537', stickerId: '52002735' }, // 兔兔比讚：有履歷依據的能力肯定，不承諾錄取或勝任
  interested:{ packageId: '11537', stickerId: '52002752' }, // 兔兔期待：回應明確表達的關注，不推定已決定合作
  attentive: { packageId: '11537', stickerId: '52002768' }, // 兔兔探頭聆聽：願意釐清，不用問號嘲弄訪客
  received:  { packageId: '11537', stickerId: '52002740' }, // 兔兔 OK：只表示已保存邀約，不代表面試已排定
  energetic: { packageId: '11537', stickerId: '52002741' }, // 莎莉跳躍（適合學歷學習、工作態度、求職熱忱）
  confused:  { packageId: '11537', stickerId: '52002744' }, // 熊大問號（適合履歷資料不足、待確認補充問題）
  happy:     { packageId: '11537', stickerId: '52002745' }  // 兔兔開心（適合一般正向熱絡交流）
};

/**
 * 從固定允許清單選貼圖，模型不能自行指定任意貼圖 ID。
 */
function stickerMessage_(mood) {
  var sticker = LINE_STICKERS_[mood];
  return sticker ? { type: 'sticker', packageId: sticker.packageId, stickerId: sticker.stickerId, quickReply: quickReply_() } : null;
}

/**
 * 貼圖表達交流目的，不猜測訪客內心。優先採取可觀察的文字訊號，再使用回答模型的意圖。
 * 技術細節、資料不足、服務錯誤或未提供關鍵條件時，留白比不相稱的表情更清楚。
 */
function dialogueStickerIntent_(text, conversation) {
  if (conversation && conversation.answerStatus === 'clarification') return 'clarification';
  if (!conversation || conversation.answerStatus !== 'answered') return 'neutral';
  var request = conversation.request || {}, answer = conversation.messages[0] && conversation.messages[0].text || '';
  if (/不太懂|看不懂|不懂|不明白|不確定|擔心|疑慮|真的嗎|確定嗎|怎麼證明|說明一下/.test(text)) return 'clarification';
  if (request.answerMode === 'intro') return 'introduction';
  if (/配色|構圖|色碼|哪個欄位|什麼欄位|用什麼技術|哪個套件|哪個函式|怎麼計算|如何計算|程式碼/.test(text)) return 'neutral';
  if (/尚未提供|未提供|無法確認|未記載|不符合|不具備|沒有相關經驗/.test(answer)) return 'neutral';
  if (/勝任|適合|符合|匹配|能力|擅長/.test(text)) return 'capability';
  if (/成果|成效|改善|節省|省了|縮短|提升/.test(text) && /\d|提升|縮短|節省|改善/.test(answer)) return 'achievement';
  return ['introduction', 'capability', 'achievement', 'interest', 'appreciation', 'clarification'].indexOf(conversation.dialogueIntent) >= 0 ? conversation.dialogueIntent : 'neutral';
}

/** 明確的簡短社交訊息不必向量搜尋，也不記成履歷缺漏；邀約草稿仍由 Contact 先處理。 */
function socialDialogue_(text, cfg, prepared) {
  if (/^(?:你好|您好|嗨|哈囉|哈啰|hello|hi)[！!。～~\s]*$/i.test(text)) return {
    intent: 'introduction', messages: [textMessage_('你好！可以從「我是誰」或「快速一覽」開始，也能直接問你感興趣的經歷與作品。')] };
  if (/^(?:謝謝(?:你|您|啦)?|多謝|感謝(?:你|您)?|了解了[，,]?謝謝|明白了[，,]?謝謝|thank you|thanks)[！!。～~\s]*$/i.test(text)) return {
    intent: 'appreciation', messages: [textMessage_('謝謝你的交流！有想深入了解的部分，隨時可以繼續問。')] };
  if (/^(?:(?:我|我們)?(?:覺得|看起來)?(?:不錯|很有意思|挺有意思)|(?:我|我們)?(?:很|蠻|滿|非常)?有興趣|(?:我|我們)?想進一步了解)[！!。～~\s]*$/.test(text)) return {
    intent: 'interest', messages: [textMessage_('謝謝你的關注！可以繼續看看經歷與作品；想進一步聊聊時，也可以使用「聯繫本人」。'), contactMessage_(cfg, prepared)] };
  return null;
}

function stickerHistoryKey_(userId) { return 'dialogue-sticker:' + sha256_(ScriptApp.getScriptId() + ':' + userId); }

/** 同一訪客 10 分鐘內不重複相同意圖；每次最多一張，不擠掉卡片或超過 LINE 五則上限。 */
function contextualSticker_(messages, intent, userId) {
  var moods = { introduction: 'greet', capability: 'confident', achievement: 'celebrate', interest: 'interested',
    appreciation: 'thanks', clarification: 'attentive', contact: 'thanks', invitation_received: 'received' };
  var mood = moods[intent];
  if (!mood || messages.length >= 5 || messages.some(function (message) { return message.type === 'sticker'; })) return null;
  try {
    var history = JSON.parse(CacheService.getScriptCache().get(stickerHistoryKey_(userId)) || 'null');
    if (history && history[intent] > Date.now() - 600000) return null;
  } catch (_) { return null; }
  return stickerMessage_(mood);
}

/** 只有 LINE 回覆成功才記錄貼圖使用時間，傳送失敗可安全重試，不保存訊息正文或 userId。 */
function rememberDialogueSticker_(intent, userId) {
  try {
    var cache = CacheService.getScriptCache(), key = stickerHistoryKey_(userId), history = JSON.parse(cache.get(key) || '{}');
    Object.keys(history).forEach(function (name) { if (history[name] <= Date.now() - 600000) delete history[name]; });
    history[intent] = Date.now(); cache.put(key, JSON.stringify(history), 600);
  } catch (_) { safeLog_('DIALOGUE_STICKER_CACHE_UNAVAILABLE'); }
}

/**
 * 建立 LINE 文字訊息，並附上相同的代表主題 Quick Reply。
 */
function textMessage_(text) {
  return { type: 'text', text: Array.from(String(text)).slice(0, 4500).join(''), quickReply: quickReply_() };
}

/**
 * 無肖像時以 LINE 原生幾何元件畫出親和人物，不使用姓名首字或生成真人照片。
 * 圖形只存在於訊息中：不用讀外部圖片、不呼叫 AI，更不寫入 Google Doc。
 */
function friendlyAvatar_() {
  function shape(width, height, left, top, color, radius, contents) {
    return { type: 'box', layout: 'vertical', position: 'absolute', width: width + 'px', height: height + 'px',
      offsetStart: left + 'px', offsetTop: top + 'px', backgroundColor: color, cornerRadius: radius + 'px', contents: contents || [] };
  }
  return { type: 'box', layout: 'vertical', width: '80px', height: '80px', cornerRadius: '40px', backgroundColor: '#E6EFE6', contents: [
    shape(56, 34, 12, 48, '#377E6B', 28),
    shape(12, 16, 34, 38, '#E6B989', 6),
    shape(34, 36, 23, 13, '#F1CCA2', 17, [
      shape(34, 12, 0, 0, '#3D5149', 8),
      shape(3, 3, 9, 17, '#3D5149', 2), shape(3, 3, 22, 17, '#3D5149', 2),
      shape(12, 9, 11, 22, '#8D5944', 6), shape(14, 6, 10, 20, '#F1CCA2', 3)
    ])
  ] };
}

/**
 * 首頁與 Quick Reply 沿用相同順序：我是誰、快速一覽、同步產生的適性主題。
 */
function welcomeMessage_(cfg, prepared) {
  var buttons = visibleMenuTopics_(), profile = {}, portrait = null;
  // 新舊索引不符時，不能把已從文件刪掉的個資繼續顯示在首頁。
  if (prepared && prepared.index && prepared.source && prepared.index.fingerprint === prepared.source.fingerprint) {
    profile = validateHomeProfile_(prepared.index.quickTopics && prepared.index.quickTopics.homeProfile, prepared.index.chunks);
    try { portrait = portfolioEntries_(prepared.index, prepared.source, cfg, null, 'portrait')[0]; } catch (_) {}
  }
  var name = profile.name || cfg.name, role = profile.role || '歡迎認識我的經歷與作品';
  function text(value, size, color, bold) {
    return { type: 'text', text: value, size: size, color: color, weight: bold ? 'bold' : 'regular', wrap: true };
  }
  function action(topic) { return { type: 'postback', label: topic.label, data: 'topic:' + topic.id, displayText: topic.label }; }
  function card(number, title, contents, footer) {
    return { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'horizontal', paddingAll: '16px', backgroundColor: '#143D35', contents: [
      text(title, 'xs', '#FFFFFF', true), { type: 'text', text: number + ' / 03', align: 'end', size: 'xxs', color: '#B7D8C9', flex: 0 }
    ] }, body: { type: 'box', layout: 'vertical', paddingAll: '18px', spacing: 'md', height: '300px', backgroundColor: '#FAFBF8', contents: contents },
      footer: { type: 'box', layout: 'vertical', paddingAll: '12px', backgroundColor: '#FAFBF8', contents: footer } };
  }
  var identity = [portrait ? { type: 'box', layout: 'vertical', width: '80px', height: '80px', cornerRadius: '40px', alignItems: 'center', contents: [
    { type: 'image', url: portrait.imageUrl, size: 'full', aspectRatio: '1:1', aspectMode: 'cover' }
  ] } : friendlyAvatar_(), text(Array.from(name).slice(0,24).join(''), 'lg', '#143D35', true), text(role, 'xs', '#53635E', false)];
  var contacts = profile.contacts || [];
  identity.push({ type: 'separator', color: '#DDE6DF', margin: 'md' });
  // 聯繫資料逐字顯示，避免把範例地址變成貌似可用的寄信按鈕。
  (contacts.length ? contacts : ['尚未提供公開聯繫方式']).forEach(function (contact) { identity.push(text(contact, 'xxs', '#53635E', false)); });
  var traits = [text('一起工作時的我', 'lg', '#143D35', true)];
  (profile.traits && profile.traits.length ? profile.traits : ['可以先從經歷與作品認識我。']).forEach(function (trait, i) {
    traits.push({ type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', contents: [
      { type: 'text', text: '0' + (i + 1), size: 'xs', color: '#A18150', flex: 0 }, text(trait, 'sm', '#31483D', false)
    ] });
  });
  var navigation = [text('從這裡開始', 'lg', '#143D35', true), text('先認識我，再探索你感興趣的領域。', 'xs', '#687770', false)];
  // 與 Quick Reply 完全同源、同序；2 欄最多 3 列，長標籤可換行。
  for (var i = 0; i < buttons.length; i += 2) {
    navigation.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: buttons.slice(i, i + 2).map(function (topic) {
      return { type: 'box', layout: 'vertical', flex: 1, height: '55px', paddingAll: '8px', cornerRadius: '10px',
        backgroundColor: topic.kind === 'adaptive' ? '#E8EFE9' : '#23735B', justifyContent: 'center', action: action(topic), contents: [
          { type: 'text', text: topic.label, size: 'xs', align: 'center', color: topic.kind === 'adaptive' ? '#143D35' : '#FFFFFF', weight: 'bold', wrap: true }
        ] };
    }) });
  }
  var compactButton = function (topic) { return { type: 'button', height: 'sm', style: 'link', color: '#23735B', action: action(topic) }; };
  return { type: 'flex', altText: Array.from(name).slice(0,50).join('') + '｜認識我・個人特質・履歷導覽', quickReply: quickReply_(), contents: { type: 'carousel', contents: [
    card('01', 'HELLO / 認識我', identity, [contactButton_('聯繫本人', 'nav:contact')]),
    card('02', 'ABOUT / 個人特質', traits, [compactButton(buttons[1])]),
    card('03', 'EXPLORE / 履歷導覽', navigation, [{ type: 'button', height: 'sm', style: 'link', color: '#23735B', action: { type: 'postback', label: '回首頁', data: 'nav:home', displayText: '首頁' } },
      { type: 'button', height: 'sm', style: 'link', color: '#23735B', action: { type: 'postback', label: '職缺對照', data: 'nav:jobmatch', displayText: '職缺對照' } }])
  ] } };
}

/**
 * 訪客輸入「使用說明」時顯示的操作方法。
 */
function helpText_() {
  return '輸入「聯繫本人」「想約面試」或「想合作」，可查看 Email 或留下邀約。\n\n人資可輸入「職缺對照」再貼上職缺需求，逐項整理有履歷依據的條件、待確認項目與建議面談問題；之後可「用這份職缺留邀約」或預約面談，並附上想先請教本人的問題。輸入「預約面談」可直接選擇本人開放的面談時段。\n\n你可以直接提問，例如：\n• 請用 30 秒介紹這位求職者。\n• 有哪些工作經歷與具體成果？\n• 做過哪些與資料分析相關的專案？\n• 這份履歷有哪些符合產品經理職缺的條件？\n• 如何聯絡本人？\n\n約 10 分鐘內可接續追問同一件作品，例如「這張用了什麼配色？」；輸入「清除對話」可重新開始。短期記憶可能提早失效，屆時請補上作品名稱。回答依據公開履歷；找不到足夠資料的問題會記錄給履歷主人確認與補充。\n\n隨時輸入「首頁」「選單」或「回首頁」，就能重新開啟三張履歷卡；輸入「隱私」查看資料使用方式。';
}

/**
 * 向訪客說明提問、短期記憶與待補充問題的資料使用方式。
 */
function privacyText_() {
  return '我是 AI 履歷助理，回答可能有誤，重要資訊請向本人確認。\n\n資料使用方式：\n• 邀約填寫內容不交給 AI。未確認草稿暫存約 30 分鐘，可能提早失效；確認後存於履歷主人的私有邀約收件匣，並以 Email 與已設定的 LINE 通知本人；由本人查看、處理或刪除，不作為 RAG 知識。\n• 僅使用履歷擁有者標示為公開的內容。\n• 「職缺對照」貼上的職缺內容只在當次送至 Google Gemini 分析，不寫入文件、索引或待補充問題；等待貼上期間只暫存不含內容的旗標約 10 分鐘；對照結果摘要（職稱與條件清單，不含職缺全文）以雜湊鍵暫存約 30 分鐘，供「用這份職缺留邀約」帶入，輸入「清除對話」可立即清除。\n• LINE 訊息由 Google Apps Script 處理，問題和檢索片段會送至 Google Gemini。\n• 資料不足的問題會寫入履歷主人的 Google 文件，包含問題文字、原因、時間與次數，供本人維護；不附上 LINE 使用者識別碼。\n• 使用雜湊識別的短期記憶，暫存近期問題及作品指向約 10 分鐘，不保存完整回答；另以雜湊快取短暫保存貼圖意圖與使用時間，避免重複；不儲存對情緒或人格的判斷。輸入「清除對話」可立即清除。LINE 與 Google 本身仍適用各自的資料政策。\n• 使用者識別碼用於處理中動畫及產生短期記憶的雜湊鍵，不保存訪客原始識別碼；主人若設定 LINE 通知，會另存本人的 userId 作為推播收件人。事件識別碼以雜湊形式保存，處理狀態保留約一天以避免重複回覆。\n\n請勿傳送密碼、證件、薪資機密或其他敏感資料。';
}

/**
 * 先要求 LINE 顯示處理中動畫；動畫失敗不能阻止正常回答。
 */
function startLoading_(userId, cfg) {
  // 動畫失敗仍繼續回答，也不會為動畫先用掉 replyToken。
  try {
    requireValue_(cfg.lineToken, 'LINE_CHANNEL_ACCESS_TOKEN');
    var response = UrlFetchApp.fetch('https://api.line.me/v2/bot/chat/loading/start', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.lineToken },
      payload: JSON.stringify({ chatId: userId, loadingSeconds: 60 }), muteHttpExceptions: true
    });
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return true;
    safeLog_('LINE_LOADING_HTTP_' + status);
  } catch (_) { safeLog_('LINE_LOADING_FAILED'); }
  return false;
}

/**
 * 使用本次 replyToken 回覆一次，最多五則訊息。
 * Token 被拒時不擅自改用 Push 補送，避免重複訊息與額外費用。
 */
function lineReply_(token, messages, cfg) {
  requireValue_(cfg.lineToken, 'LINE_CHANNEL_ACCESS_TOKEN');
  var result = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + cfg.lineToken },
    payload: JSON.stringify({ replyToken: token, messages: messages }), muteHttpExceptions: true
  });
  var status = result.getResponseCode();
  if (status >= 200 && status < 300) return 'replied';
  // replyToken 只能使用一次；結果不明時不改用 Push，避免重複或額外計費。
  if (status === 400) { safeLog_('LINE_REPLY_400'); return 'reply_rejected'; }
  throw new Error('LINE_HTTP_' + status);
}
