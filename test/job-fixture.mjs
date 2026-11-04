import { createGas, event, unitVector } from './harness.mjs';

export const resume = '[[PUBLIC]]\n## 專業技能\nPython：使用 pandas 整理 CSV 與 Excel 資料。\n## 專案作品\n建立資料分析報表，將處理時間縮短 20%。\n[[/PUBLIC]]';
export const posting = '資料分析師｜工作內容：整理營運資料並製作報表。條件：熟悉 Python 資料處理；具備 SQL 經驗；加分：英文簡報能力。';

export const reply = text => ({ body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(text) }] } }] } });
const defaults = {
  extract: { isJobPosting: true, title: '資料分析師', excludedCount: 0, requirements: [
    { text: '熟悉 Python 資料處理', kind: 'required' }, { text: '具備 SQL 經驗', kind: 'required' }, { text: '英文簡報能力', kind: 'preferred' }
  ] },
  assess: { items: [
    { requirementId: 'R1', status: 'met', note: '本人使用 pandas 整理資料', evidence: [{ id: 'S1', quote: '使用 pandas 整理 CSV 與 Excel 資料' }] },
    { requirementId: 'R2', status: 'unconfirmed', note: '', evidence: [] },
    { requirementId: 'R3', status: 'unconfirmed', note: '', evidence: [] }
  ], questions: ['請分享使用 SQL 查詢資料的經驗。'] },
  queryVector: unitVector(0)
};

/** 已同步履歷的測試環境；send 傳文字、tap 按按鈕，as 以其他訪客身分操作。 */
export function jobGas(overrides = {}) {
  const plan = { ...defaults, ...overrides };
  const fixture = createGas({ text: resume, response: call => {
    if (call.url.endsWith(':batchEmbedContents')) return { body: { embeddings: call.body.requests.map(r =>
      ({ values: r.taskType === 'RETRIEVAL_QUERY' ? plan.queryVector : unitVector(0) })) } };
    if (call.url.endsWith(':embedContent')) return { body: { embedding: { values: unitVector(0) } } };
    const props = call.body?.generationConfig?.responseSchema?.properties || {};
    if (props.isJobPosting) return reply(plan.extract);
    if (props.items) return reply(plan.assess);
    if (call.url.endsWith(':generateContent')) return reply({ grounded: false, answer: '資料不足', evidence: [], dialogueIntent: 'neutral' });
    return { body: {} };
  } });
  fixture.gas.syncKnowledgeBase();
  fixture.state.calls.length = 0; fixture.state.logs.length = 0;
  const lastReply = () => fixture.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages;
  fixture.as = (user, text, id, postback = false) => {
    const e = event(text, id); e.source.userId = user;
    if (postback) { e.type = 'postback'; e.postback = { data: text }; }
    fixture.gas.handleEvent_(e, fixture.gas.config_());
    return lastReply();
  };
  fixture.send = (text, id) => fixture.as('user-1', text, id);
  fixture.tap = (data, id) => fixture.as('user-1', data, id, true);
  fixture.draftId = (user = 'user-1') => fixture.gas.invitationDraft_(fixture.gas.invitationKey_(user, fixture.gas.config_())).id;
  fixture.ai = () => fixture.state.calls.filter(c => c.url.includes('generativelanguage'));
  return fixture;
}
