import test from 'node:test';
import assert from 'node:assert/strict';
import { posting, jobGas } from './job-fixture.mjs';

// 以台北時間產生相對於現在的時段，避免測試隨日期失效。
const DAY = 86400000;
function taipei(offsetMs, withEnd) {
  const d = new Date(Date.now() + offsetMs + 8 * 3600000), pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} 10:00${withEnd ? '-11:00' : ''}`;
}
function bookingGas(slots = [taipei(3 * DAY, true), taipei(5 * DAY)]) {
  const f = jobGas();
  f.state.properties.set('INTERVIEW_SLOTS', slots.join('\n'));
  return f;
}
const slotButtons = message => message.contents.footer.contents.map(b => b.action).filter(a => a.data.startsWith('book:slot:'));
function fillAfterSlot(f, prefix) {
  f.send('青禾公司 王小姐', prefix + '-c'); f.send('AI 工程師面試', prefix + '-m');
  return f.send('hr@company.tw', prefix + '-r');
}

test('B: invite with this job attaches the summary and turns unconfirmed items into questions for the owner', () => {
  const f = jobGas();
  f.send('職缺：' + posting, 'ij-1');
  assert.match(f.tap('invite:job', 'ij-2')[0].text, /留下邀約 1 \/ 4[\s\S]*下一步可附上想先請教本人的問題/);
  const ask = f.send('禾序科技 王小姐', 'ij-3')[0];
  assert.match(ask.text, /留下邀約 2 \/ 4[\s\S]*建議問題（來自待確認的條件）：\n1\. 能否說明您在「具備 SQL 經驗」方面的經驗？\n2\. 能否說明您在「英文簡報能力」方面的經驗？/);
  assert.deepEqual(ask.quickReply.items.map(i => i.action.label), ['使用建議問題', '略過', '取消邀約']);
  f.tap(ask.quickReply.items[0].action.data, 'ij-4');
  f.send('hr@company.tw', 'ij-5');
  const confirm = f.send('平日下午', 'ij-6');
  assert.match(confirm[0].text, /職缺或合作內容：職缺：資料分析師（由職缺對照帶入）\n✅ 熟悉 Python 資料處理\n❔ 具備 SQL 經驗\n❔ 英文簡報能力\n\n想先請教本人的問題：\n1\. 能否說明您在「具備 SQL 經驗」方面的經驗？/);
  f.state.properties.set('OWNER_LINE_USER_ID', 'U' + 'a'.repeat(32));
  assert.match(f.tap('invite:submit:' + f.draftId(), 'ij-7')[0].text, /已存入/);
  const push = f.state.calls.find(c => c.url.endsWith('/message/push'));
  assert.match(push.body.messages[0].text, /想先請教本人的問題：\n1\. 能否說明您在「具備 SQL 經驗」/, 'the owner sees the questions in the LINE notification');
  assert.equal(f.state.documentWrites, 0);
});

test('B: HR can type their own question or skip it', () => {
  for (const mode of ['own', 'skip']) {
    const f = jobGas();
    f.send('職缺：' + posting, mode + '-1');
    f.tap('invite:job', mode + '-2');
    const ask = f.send('公司乙', mode + '-3')[0];
    if (mode === 'skip') f.tap(ask.quickReply.items[1].action.data, mode + '-4'); else f.send('你們團隊的 SQL 用在哪些情境？', mode + '-4');
    f.send('hr@company.tw', mode + '-5');
    const text = f.send('不限', mode + '-6')[0].text;
    if (mode === 'own') assert.match(text, /想先請教本人的問題：\n你們團隊的 SQL 用在哪些情境？/);
    else { assert.doesNotMatch(text, /想先請教本人/); assert.match(text, /英文簡報能力\n\n回覆方式/); }
  }
});

test('B: when every requirement is met, no suggested questions are offered but HR can still ask', () => {
  const f = jobGas({ extract: { isJobPosting: true, title: '分析師', requirements: [{ text: '熟悉 Python 資料處理', kind: 'required' }] },
    assess: { items: [{ requirementId: 'R1', status: 'met', note: '', evidence: [{ id: 'S1', quote: '使用 pandas 整理 CSV 與 Excel 資料' }] }], questions: [] } });
  f.send('職缺：' + posting, 'm-1');
  f.tap('invite:job', 'm-2');
  const ask = f.send('公司', 'm-3')[0];
  assert.doesNotMatch(ask.text, /建議問題/);
  assert.deepEqual(ask.quickReply.items.map(i => i.action.label), ['略過', '取消邀約']);
});

test('C: only future, valid and free slots are offered; the chosen slot fills availability and skips that step', () => {
  const f = bookingGas([taipei(-DAY), taipei(3 * DAY, true), '2026-02-30 10:00', 'tomorrow 3pm', taipei(5 * DAY)]);
  const picker = f.send('預約面談', 'b-1')[0];
  assert.equal(picker.type, 'flex');
  const buttons = slotButtons(picker);
  assert.equal(buttons.length, 2, 'past and invalid entries are skipped');
  assert.match(buttons[0].label, /^\d{1,2}\/\d{1,2}（[日一二三四五六]）10:00–11:00$/);
  assert.match(f.tap(buttons[0].data, 'b-2')[0].text, /留下邀約 1 \/ 4[\s\S]*已選擇面談時段：/);
  const confirm = fillAfterSlot(f, 'b');
  assert.match(confirm[0].text, /請確認邀約內容[\s\S]*方便聯繫的時段：已預約 .*10:00–11:00（台北時間）；時段已暫時保留/);
  const id = f.draftId();
  assert.match(f.tap('invite:submit:' + id, 'b-6')[0].text, /已存入/);
  const store = f.gas.loadPortfolioStore_(f.gas.config_());
  assert.equal(Object.values(store.bookings)[0].invitationId, id);
  assert(!JSON.stringify(store.bookings).includes('user-1'));
  assert.equal(f.ai().length, 0);
  assert.equal(f.state.documentWrites, 0);
  // 已預約的時段不再提供給其他人。
  const other = slotButtons(f.as('user-2', '預約面談', 'b-7')[0]);
  assert.equal(other.length, 1);
  assert.notEqual(other[0].data, buttons[0].data);
});

test('C: when two visitors pick the same slot, only the first submission keeps it', () => {
  const f = bookingGas([taipei(3 * DAY, true)]);
  const data = slotButtons(f.as('user-1', '預約面談', 'r-1')[0])[0].data;
  for (const user of ['user-1', 'user-2']) {
    f.as(user, data, 'r-pick-' + user, true);
    f.as(user, '公司 ' + user, 'r-c-' + user); f.as(user, '面試', 'r-m-' + user); f.as(user, 'hr@company.tw', 'r-r-' + user);
  }
  const second = f.draftId('user-2');
  assert.match(f.as('user-1', 'invite:submit:' + f.draftId('user-1'), 'r-s1', true)[0].text, /已存入/);
  const late = f.as('user-2', 'invite:submit:' + second, 'r-s2', true);
  assert.match(late[0].text, /已被預約[\s\S]*尚未送出/);
  assert.match(late[1].text, /留下邀約 4 \/ 4/);
  assert.equal(Object.keys(f.gas.loadPortfolioStore_(f.gas.config_()).invitations).length, 1);
  // 改填其他時段後仍可送出一般邀約。
  const retry = f.as('user-2', '下週任一天下午', 'r-t2');
  assert.match(retry[0].text, /方便聯繫的時段：下週任一天下午/);
  assert.match(f.as('user-2', 'invite:submit:' + second, 'r-s3', true)[0].text, /已存入/);
});

test('C: deleting the invitation in the owner inbox releases the slot', () => {
  const f = bookingGas([taipei(3 * DAY, true)]);
  f.tap(slotButtons(f.send('預約面談', 'd-1')[0])[0].data, 'd-2');
  fillAfterSlot(f, 'd');
  const id = f.draftId();
  f.tap('invite:submit:' + id, 'd-6');
  assert.match(f.send('預約面談', 'd-7')[0].text, /目前沒有開放預約的面談時段/);
  f.state.properties.set('WEB_APP_URL', 'https://script.google.com/macros/s/test-public/exec');
  const token = f.gas.openInvitations().url.split('#')[1];
  f.gas.updateInvitation(token, id, 'delete');
  assert.equal(slotButtons(f.send('預約面談', 'd-8')[0]).length, 1);
});

test('B + C: booking from a job match carries the summary and owner questions, and skips the availability step', () => {
  const f = bookingGas();
  const result = f.send('職缺：' + posting, 'bj-1');
  assert(result[1].quickReply.items.some(i => i.action.data === 'book:job'));
  const data = slotButtons(f.tap('book:job', 'bj-2')[0])[0].data;
  assert.match(data, /:job$/);
  f.tap(data, 'bj-3');
  const ask = f.send('公司丙', 'bj-4')[0];
  assert.match(ask.text, /想先請教本人哪些問題/);
  f.tap(ask.quickReply.items[0].action.data, 'bj-5');
  const confirm = f.send('hr@company.tw', 'bj-6')[0].text;
  assert.match(confirm, /職缺：資料分析師[\s\S]*想先請教本人的問題：\n1\.[\s\S]*方便聯繫的時段：已預約 /);
});

test('C: no slots, stale slot buttons, the contact card and the slot parser are handled clearly', () => {
  const none = jobGas();
  assert.match(none.send('預約面談', 'n-1')[0].text, /目前沒有開放預約/);
  assert(!JSON.stringify(none.send('聯繫本人', 'n-2')).includes('book:start'), 'no booking button without slots');
  assert.match(none.tap('book:slot:abcdefabcdef', 'n-3')[0].text, /已被預約、已過期/);
  const result = none.send('職缺：' + posting, 'n-4');
  assert(!result[1].quickReply.items.some(i => i.action.data === 'book:job'), 'no job booking button without slots');
  const f = bookingGas();
  assert(JSON.stringify(f.send('聯繫本人', 'n-5')).includes('book:start'));
  assert.equal(f.gas.interviewSlots_().slots.length, 2);
  assert.equal(f.gas.parseInterviewSlot_('2026-02-30 10:00'), null);
  assert.equal(f.gas.parseInterviewSlot_('2026-11-10 15:00-14:00'), null);
  assert.equal(f.gas.parseInterviewSlot_('2026-11-10 25:00'), null);
  assert.equal(f.gas.parseInterviewSlot_('2026-11-10 14:00-15:00').label, '11/10（二）14:00–15:00');
  assert.equal(f.gas.listInterviewSlots().slots.every(s => s.status === 'open'), true);
});
