import test from 'node:test';
import assert from 'node:assert/strict';
import { createGas, event, unitVector } from './harness.mjs';

const resume = '[[PUBLIC]]\n## 專業技能\nPython：使用 pandas 整理 CSV 與 Excel 資料。\n## 專案作品\n建立資料分析報表，將處理時間縮短 20%。\n[[/PUBLIC]]';
const posting = '資料分析師｜工作內容：整理營運資料並製作報表。條件：熟悉 Python 資料處理；具備 SQL 經驗；加分：英文簡報能力。';

const reply = text => ({ body: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(text) }] } }] } });
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

function jobGas(overrides = {}) {
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
  fixture.send = (text, id) => {
    fixture.gas.handleEvent_(event(text, id), fixture.gas.config_());
    return fixture.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages;
  };
  fixture.ai = () => fixture.state.calls.filter(c => c.url.includes('generativelanguage'));
  return fixture;
}

test('job match: prompt first, then requirements are checked one by one with verified sources and interview questions', () => {
  const { gas, state, send, ai } = jobGas();
  const prompt = send('職缺對照', 'jm-1');
  assert.match(prompt[0].text, /貼上職缺需求/);
  assert.equal(ai().length, 0, 'opening the flow costs no AI call');
  const flag = [...state.cache.entries()].find(([key]) => key.startsWith('jobmatch:'));
  assert(flag && !flag[1].includes('user-1'), 'only a hashed waiting flag is stored');

  const messages = send(posting, 'jm-2');
  const text = messages[0].text;
  assert.match(text, /📋 職缺對照：資料分析師/);
  assert.match(text, /✅ 有履歷依據（1）\n• ［必要］熟悉 Python 資料處理/);
  assert.match(text, /❔ 待確認（2）[\s\S]*具備 SQL 經驗[\s\S]*［加分］英文簡報能力/);
  assert.match(text, /💬 建議面談問題\n1\. 請分享使用 SQL 查詢資料的經驗。\n2\. /);
  assert.match(text, /不代表本人不具備/);
  assert.equal(messages[1].text, '資料來源：專業技能');
  assert(messages[1].quickReply.items.some(item => item.action.data === 'nav:contact'));

  const calls = ai();
  assert.deepEqual(calls.map(c => c.url.split(':').at(-1)), ['generateContent', 'batchEmbedContents', 'generateContent']);
  assert.equal(calls[1].body.requests.length, 3);
  assert(calls[1].body.requests.every(r => r.taskType === 'RETRIEVAL_QUERY'));
  // 職缺只放在使用者資料區，不混入系統指令。
  assert(!calls[0].body.systemInstruction.parts[0].text.includes('SQL'));
  assert(JSON.parse(calls[0].body.contents[0].parts[0].text).posting === posting);
  // 職缺不保存、不寫入 Doc 待補充區、不出現在記錄。
  assert.equal(state.documentWrites, 0);
  assert(![...state.cache.values(), ...state.properties.values()].some(value => String(value).includes('SQL')));
  assert(!state.logs.some(line => String(line).includes('SQL')));
  assert(![...state.cache.keys()].some(key => key.startsWith('jobmatch:')), 'waiting flag cleared after use');
  assert.equal(gas.jobMatchWaiting_('user-1'), false);
});

test('job match: a "met" claim whose quote is not in the resume is downgraded to unconfirmed', () => {
  const { send, state } = jobGas({ assess: { items: [
    { requirementId: 'R1', status: 'met', note: '有十年經驗', evidence: [{ id: 'S1', quote: '具備十年 Python 開發經驗' }] },
    { requirementId: 'R2', status: 'partial', note: '', evidence: [] }
  ], questions: [] } });
  const messages = send('職缺：' + posting, 'jm-fake');
  assert.doesNotMatch(messages[0].text, /✅|🔶|十年/);
  assert.match(messages[0].text, /❔ 待確認（3）/);
  assert.match(messages[0].text, /💬 建議面談問題\n1\. 能否分享一個與「熟悉 Python 資料處理」相關的實際經驗/);
  assert.equal(messages[1].text, '本次沒有找到可引用的公開履歷段落。');
  assert(state.logs.some(line => line.includes('JOB_MATCH_EVIDENCE_DOWNGRADED')));
});

test('job match: partial matches keep verified quotes and show their own group', () => {
  const { send } = jobGas({ assess: { items: [
    { requirementId: 'R1', status: 'partial', note: '有報表經驗，但未寫 Python 年資', evidence: [{ id: 'S2', quote: '建立資料分析報表' }] }
  ], questions: ['Python 在報表專案中的使用比例？'] } });
  const messages = send('職缺：' + posting, 'jm-partial');
  assert.match(messages[0].text, /🔶 部分相符（1）\n• ［必要］熟悉 Python 資料處理\n  有報表經驗，但未寫 Python 年資/);
  assert.equal(messages[1].text, '資料來源：專案作品');
});

test('job match: age, gender and similar non-job conditions are never assessed', () => {
  const { send, ai } = jobGas({ extract: { isJobPosting: true, title: '', excludedCount: 1, requirements: [
    { text: '熟悉 Python 資料處理', kind: 'required' }, { text: '限男性，年齡 30 歲以下', kind: 'required' }
  ] }, assess: { items: [{ requirementId: 'R1', status: 'unconfirmed', note: '', evidence: [] }], questions: ['你幾歲？', '請介紹 Python 專案。'] } });
  const messages = send('職缺：' + posting, 'jm-protected');
  const assessed = JSON.parse(ai()[2].body.contents[0].parts[0].text).requirements;
  assert.deepEqual(assessed.map(r => r.text), ['熟悉 Python 資料處理']);
  assert.doesNotMatch(messages[0].text, /男性|30 歲/);
  assert.match(messages[0].text, /不列入對照/);
  assert.match(messages[0].text, /（2 項）/);
});

test('job match: no relevant passages means every item is unconfirmed without a second generation call', () => {
  const { send, ai } = jobGas({ queryVector: unitVector(5) });
  const messages = send('職缺：' + posting, 'jm-none');
  assert.equal(ai().length, 2, 'extract + embed only');
  assert.match(messages[0].text, /❔ 待確認（3）/);
  assert.match(messages[0].text, /1\. 能否分享/);
});

test('job match: cancel, navigation and short questions leave the flow without AI calls', () => {
  const fixture = jobGas();
  const { send, ai, gas } = fixture;
  send('職缺對照', 'c-1');
  assert.match(send('取消', 'c-2')[0].text, /已取消職缺對照/);
  assert.equal(gas.jobMatchWaiting_('user-1'), false);
  send('職缺對照', 'c-3');
  assert.equal(send('首頁', 'c-4')[0].type, 'flex');
  assert.equal(gas.jobMatchWaiting_('user-1'), false);
  send('職缺對照', 'c-5');
  assert.match(send('你好', 'c-6')[0].text, /你好！/, 'short text goes back to normal dialogue');
  assert.equal(ai().length, 0);
});

test('job match: oversized, too short and non-job input are handled clearly', () => {
  const { send, ai, gas } = jobGas({ extract: { isJobPosting: false, title: '', requirements: [] } });
  send('職缺對照', 'l-1');
  assert.match(send('職缺內容'.repeat(600), 'l-2')[0].text, /超過 2000 字/);
  assert.equal(gas.jobMatchWaiting_('user-1'), true, 'still waiting for a shorter posting');
  assert.match(send('職缺：太短', 'l-3')[0].text, /太短/);
  assert.equal(ai().length, 0);
  assert.match(send('職缺：今天天氣很好，想問問你最喜歡吃什麼東西呢？', 'l-4')[0].text, /不是職缺需求/);
  assert.equal(ai().length, 1, 'only the extraction call is made');
});

test('job match: postings longer than the 800-character question limit are accepted', () => {
  const { send } = jobGas();
  const long = posting + '\n' + '負責跨部門資料整理與報表維護。'.repeat(60);
  assert(long.length > 800 && long.length <= 2000);
  send('職缺對照', 'long-1');
  assert.match(send(long, 'long-2')[0].text, /📋 職缺對照/);
});

test('job match: unsynced resume changes block analysis before any AI call', () => {
  const { send, state, ai } = jobGas();
  state.text = resume.replace('20%', '30%');
  assert.match(send('職缺：' + posting, 'stale')[0].text, /等待同步/);
  assert.equal(ai().length, 0);
});

test('job match: starting the flow cancels an unsent invitation draft so the posting is not typed into it', () => {
  const { send, state, gas } = jobGas();
  send('留下邀約', 'inv-1');
  const key = gas.invitationKey_('user-1', gas.config_());
  assert(state.cache.get(key));
  assert.match(send('職缺對照', 'inv-2')[0].text, /尚未送出的邀約草稿已取消/);
  assert.equal(state.cache.get(key), undefined);
  assert.match(send(posting, 'inv-3')[0].text, /📋 職缺對照/);
});

test('job match: model failures show the usual safe error message', () => {
  const fixture = createGas({ text: resume, response: call => {
    if (call.url.endsWith(':batchEmbedContents')) return { body: { embeddings: call.body.requests.map(() => ({ values: unitVector(0) })) } };
    if (call.url.endsWith(':generateContent')) return { status: 429, body: {} };
    return { body: {} };
  } });
  fixture.gas.syncKnowledgeBase();
  fixture.gas.handleEvent_(event('職缺：' + posting, 'err'), fixture.gas.config_());
  const text = fixture.state.calls.filter(c => c.url.endsWith('/message/reply')).at(-1).body.messages[0].text;
  assert.match(text, /HTTP 429/);
  assert(!fixture.state.logs.some(line => String(line).includes('SQL')));
});

test('home card and help text point visitors to job match', () => {
  const { send } = jobGas();
  const home = send('首頁', 'home');
  assert(home[0].contents.contents[2].footer.contents.some(button => button.action.data === 'nav:jobmatch'));
  assert.match(send('使用說明', 'help')[0].text, /職缺對照/);
  assert.match(send('隱私', 'privacy')[0].text, /職缺對照/);
});
