import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ADMIN_HTML } from '../src/api/admin/ui';

function panel(preferences: Record<string, string> = {}) {
  const storage = new Map(Object.entries(preferences));
  const script = ADMIN_HTML.match(/<script>\s*(function memoryAdmin\(\)[\s\S]*?)<\/script>/)![1];
  const app = runInNewContext(`${script}\nmemoryAdmin()`, {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value) },
    location: { origin: 'https://aelios.test' },
    document: { documentElement: { dataset: {} } },
    window: { setTimeout() {} }
  });
  app.icons = () => {};
  app.apiKey = 'owner';
  app.request = async (path: string) => path === '/api/gateway/config' ? {
    identities: [
      { slug: 'danjiu', readNamespaces: ['danjiu', 'shared'] },
      { slug: 'ningjiao', namespace: 'ning', readNamespaces: [] }
    ]
  } : { data: [] };
  return { app, storage };
}

test('first visit selects the first assistant; selecting another uses its write space', async () => {
  const { app, storage } = panel();
  await app.init();
  assert.equal(app.selectedIdentity, 'danjiu');
  assert.equal(app.namespace, 'danjiu');
  await app.selectIdentity('ningjiao');
  assert.equal(app.namespace, 'ning');
  assert.match(app.spaceDescription(), /召回：已关闭/);
  assert.equal(storage.get('aelios.admin.namespace'), 'ning');
});

test('read spaces remain individually selectable and survive a reload', async () => {
  const { app } = panel({ 'aelios.admin.identity': 'danjiu', 'aelios.admin.namespace': 'shared' });
  await app.init();
  assert.equal(app.namespace, 'shared');
  assert.equal(JSON.stringify(app.identitySpaces().map((s: any) => s.name)), '["danjiu","shared"]');
  assert.equal(app.gwIdentities.length, 0); // Reading never overwrites an unsaved settings editor.
});

test('legacy and explicitly chosen custom spaces are preserved', async () => {
  const cases: Record<string, string>[] = [
    { 'aelios.admin.namespace': 'old-library' },
    { 'aelios.admin.namespace': 'default', 'aelios.admin.identity': '' }
  ];
  for (const prefs of cases) {
    const { app } = panel(prefs);
    await app.init();
    assert.equal(app.namespace, prefs['aelios.admin.namespace']);
    assert.equal(app.selectedIdentity, '');
  }
});

test('switching spaces clears selections and reloads the visible diary', async () => {
  const { app } = panel();
  app.page = 'diary'; app.diaryDailies = [{ title: 'old diary' }];
  app.worldSelection = { old: true }; app.dreamHarvest = { old: true };
  app.request = async (path: string) => path.startsWith('/admin/diary') ? {
    data: { dailies: [{ title: 'new diary' }] }
  } : { data: {} };
  await app.switchSpace('ning');
  assert.equal(app.diaryDailies[0].title, 'new diary');
  assert.equal(Object.keys(app.worldSelection).length, 0);
  assert.equal(app.dreamHarvest, null);
});

test('late responses and errors cannot restore an old space after A-B-A switching', async () => {
  for (const fail of [false, true]) {
    const { app } = panel();
    app.namespace = 'a';
    let finish: (value: any) => void = () => {};
    let reject: (value: any) => void = () => {};
    app.request = () => new Promise((resolve, fail) => { finish = resolve; reject = fail; });
    const previous = app.loadWorldFacts();
    app.request = async () => ({ data: [] });
    await app.switchSpace('b'); await app.switchSpace('a');
    app.worldItems = [{ content: 'fresh data' }];
    if (fail) reject(new Error('old request failed'));
    else finish({ data: [{ content: 'stale data' }] });
    await previous;
    assert.equal(app.worldItems[0].content, 'fresh data');
    assert.equal(app.toast, '');
  }
});

test('saving the first token loads identities instead of locking the panel to default', async () => {
  const { app } = panel();
  await app.saveToken();
  assert.equal(app.selectedIdentity, 'danjiu');
  assert.equal(app.namespace, 'danjiu');
});

test('gateway editor round-trips speaker names for dream writing', async () => {
  const { app } = panel();
  const saved: any[] = [];
  app.request = async (path: string, options: any = {}) => {
    if (path === '/api/gateway/config' && options.method === 'PATCH') {
      saved.push(JSON.parse(options.body));
      return { ok: true, settings: {} };
    }
    if (path === '/api/gateway/config') {
      return {
        identities: [{ slug: 'danjiu', namespace: 'default', userName: '小南', assistantName: '小北', keys: ['CHATBOX_API_KEY'], models: ['*'] }]
      };
    }
    if (path === '/api/gateway/env') return { groups: [], secrets: [] };
    return { data: [] };
  };
  await app.gwLoad();
  assert.equal(app.gwIdentities[0].userName, '小南');
  assert.equal(app.gwIdentities[0].assistantName, '小北');
  await app.gwSave();
  assert.equal(saved[0].identities[0].userName, '小南');
  assert.equal(saved[0].identities[0].assistantName, '小北');
  assert.equal(saved[0].settings, undefined); // Settings save one by one; the assistant save never rewrites them.
  assert.match(ADMIN_HTML, /用户叫什么,如 小南/);
});

test('top identity picker saves speaker names without wiping the rest of gateway config', async () => {
  const { app } = panel();
  await app.init();
  const saved: any[] = [];
  app.request = async (path: string, options: any = {}) => {
    if (path === '/api/gateway/config' && options.method === 'PATCH') {
      saved.push(JSON.parse(options.body));
      return { ok: true, settings: {} };
    }
    if (path === '/api/gateway/config') {
      return {
        version: 3,
        upstream: { address: 'https://keep.test/v1' },
        identities: [
          { slug: 'danjiu', namespace: 'default', keys: ['CHATBOX_API_KEY'], models: ['*opus*'] },
          { slug: 'ningjiao', namespace: 'ning', keys: ['CHATBOX_API_KEY'], models: ['*'] }
        ]
      };
    }
    return { data: [] };
  };
  app.selectedIdentity = 'danjiu';
  app.speakerUserName = '小南';
  app.speakerAssistantName = '小北';
  await app.saveSpeakers();
  // Only the assistants travel; upstream and settings stay as they are on the server.
  assert.equal(saved[0].upstream, undefined);
  assert.equal(saved[0].settings, undefined);
  assert.equal(saved[0].identities[0].userName, '小南');
  assert.equal(saved[0].identities[0].assistantName, '小北');
  assert.equal(saved[0].identities[0].models[0], '*opus*');
  assert.equal(saved[0].identities[1].slug, 'ningjiao');
  assert.equal(saved[0].identities[1].userName, undefined);
  assert.match(ADMIN_HTML, /说话人名字/);
});

test('recall history in admin follows the selected assistant and keeps empty/error explanations', async () => {
  const { app } = panel();
  await app.init();
  app.page = 'settings';
  const paths: string[] = [];
  app.request = async (path: string) => {
    paths.push(path);
    return path.startsWith('/api/gateway/recalls')
      ? { items: [{ id: app.selectedIdentity, injected: 0, selection: { status: 'lexical', reason: 'reranker_timeout' } }] }
      : { data: {} };
  };
  await app.loadRecallHistory();
  assert.equal(app.recallHistory[0].id, 'danjiu');
  assert.match(app.recallReasonLabel(app.recallHistory[0].selection.reason), /超时/);
  await app.selectIdentity('ningjiao');
  assert.equal(app.recallHistory[0].id, 'ningjiao');
  assert.ok(paths.includes('/api/gateway/recalls?identity=ningjiao'));
  await app.selectCustomSpace('shared');
  assert.equal(app.recallHistory.length, 0);
  assert.equal(app.recallHistoryLoading, false);
});

test('late recall results and failures cannot cross an A-B-A identity switch', async () => {
  for (const fail of [false, true]) {
    const { app } = panel();
    await app.init();
    let resolve: (value: any) => void = () => {};
    let reject: (error: Error) => void = () => {};
    app.request = () => new Promise((ok, bad) => { resolve = ok; reject = bad; });
    const old = app.loadRecallHistory();
    app.request = async () => ({ data: {} });
    await app.selectIdentity('ningjiao');
    await app.selectIdentity('danjiu');
    app.recallHistory = [{ id: 'fresh' }];
    if (fail) reject(new Error('stale error'));
    else resolve({ items: [{ id: 'stale' }] });
    await old;
    assert.equal(app.recallHistory[0].id, 'fresh');
    assert.equal(app.recallHistoryError, '');
    assert.equal(app.recallHistoryLoading, false);
  }
});

function settingsPanel(fail = () => false) {
  const { app } = panel();
  const sent: any[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const stored: Record<string, string> = { WEEKLY_ROLLUP_DELETE_DAILIES: '' };
  app.request = async (path: string, options: any = {}) => {
    if (path === '/api/gateway/config' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      sent.push(body);
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setImmediate(resolve));
      inFlight -= 1;
      if (fail()) throw new Error('网断了');
      for (const [name, value] of Object.entries(body.settings || {})) {
        if (value) stored[name] = value as string; else delete stored[name];
      }
      return { ok: true, settings: { ...stored } };
    }
    if (path === '/api/gateway/config') {
      return { version: 3, identities: [{ slug: 'danjiu', namespace: 'default', keys: ['CHATBOX_API_KEY'], models: ['*opus*'] }] };
    }
    if (path === '/api/gateway/env') {
      return {
        groups: [
          { group: '记忆召回', items: [
            { name: 'MEMORY_FILTER_MAX_OUTPUT', label: '每次注入几条记忆', value: '', deployed: '2', common: true },
            { name: 'RELATION_EXPANSION', label: '顺着关系边再扩一跳', value: '', deployed: '', kind: 'switch', defaultOn: false }
          ] },
          { group: 'Dream 与日记', items: [
            { name: 'ENABLE_DREAM', label: '夜整总闸', value: '', deployed: '', kind: 'switch', defaultOn: true, common: true },
            { name: 'DIARY_MODEL', label: '日记和月记用的模型', hint: '留空回落 DREAM_MODEL', value: 'old/diary', deployed: '' },
            { name: 'WEEKLY_ROLLUP_DELETE_DAILIES', label: '周记落成后自动删日志', value: '', deployed: 'true', kind: 'switch', defaultOn: false },
            { name: 'CLEF_AUTO_REVIEW', label: '每天用 clef 自动审候选', value: '', deployed: '', kind: 'switch', defaultOn: false, common: true }
          ] }
        ],
        secrets: []
      };
    }
    return { data: [] };
  };
  return { app, sent, stored, maxInFlight: () => maxInFlight };
}
const item = (app: any, name: string) => app.gwItems().find((i: any) => i.name === name);

test('a switch saves the moment it is flipped, sending only that one setting', async () => {
  const { app, sent } = settingsPanel();
  await app.gwLoad();
  const clef = item(app, 'CLEF_AUTO_REVIEW');
  assert.equal(app.settingOn(clef), false);
  await app.toggleSetting(clef);
  assert.equal(JSON.stringify(sent[0]), '{"settings":{"CLEF_AUTO_REVIEW":"true"}}');
  assert.equal(app.settingOn(clef), true);
  assert.equal(clef.saved, 'true');
  assert.match(app.toast, /已打开「每天用 clef 自动审候选」/);
  // Flipping back to the default clears the override instead of storing "false".
  await app.toggleSetting(clef);
  assert.equal(JSON.stringify(sent[1]), '{"settings":{"CLEF_AUTO_REVIEW":""}}');
  assert.equal(app.settingOn(clef), false);
  assert.equal(clef.saved, '');
  assert.match(app.toast, /已关闭「每天用 clef 自动审候选」/);
  // Default-on switches store "false"; a deployed "true" counts as the baseline too.
  await app.toggleSetting(item(app, 'ENABLE_DREAM'));
  assert.equal(JSON.stringify(sent[2]), '{"settings":{"ENABLE_DREAM":"false"}}');
  const purge = item(app, 'WEEKLY_ROLLUP_DELETE_DAILIES');
  assert.equal(app.settingOn(purge), true);
  await app.toggleSetting(purge);
  assert.equal(JSON.stringify(sent[3]), '{"settings":{"WEEKLY_ROLLUP_DELETE_DAILIES":"false"}}');
  assert.equal(app.settingOn(purge), false);
});

test('text settings save on change, skip no-op edits, and restore defaults', async () => {
  const { app, sent } = settingsPanel();
  await app.gwLoad();
  const diary = item(app, 'DIARY_MODEL');
  await app.saveSetting(diary, 'old/diary ');
  assert.equal(sent.length, 0);
  await app.saveSetting(diary, ' new/diary ');
  assert.equal(JSON.stringify(sent[0]), '{"settings":{"DIARY_MODEL":"new/diary"}}');
  assert.equal(diary.saved, 'new/diary');
  await app.saveSetting(diary, '');
  assert.equal(JSON.stringify(sent[1]), '{"settings":{"DIARY_MODEL":""}}');
  assert.equal(diary.value, '');
  assert.match(app.toast, /「日记和月记用的模型」已恢复默认/);
});

test('a failed save puts the old value back and says so', async () => {
  const { app } = settingsPanel(() => true);
  await app.gwLoad();
  const clef = item(app, 'CLEF_AUTO_REVIEW');
  await app.toggleSetting(clef);
  assert.equal(app.settingOn(clef), false);
  assert.equal(clef.busy, false);
  const diary = item(app, 'DIARY_MODEL');
  await app.saveSetting(diary, 'new/diary');
  assert.equal(diary.value, 'old/diary');
  assert.match(app.toast, /没存上：网断了/);
});

test('quick taps on two switches save one after another so neither is lost', async () => {
  const { app, stored, maxInFlight } = settingsPanel();
  await app.gwLoad();
  await Promise.all([app.toggleSetting(item(app, 'CLEF_AUTO_REVIEW')), app.toggleSetting(item(app, 'RELATION_EXPANSION'))]);
  assert.equal(maxInFlight(), 1);
  assert.equal(stored.CLEF_AUTO_REVIEW, 'true');
  assert.equal(stored.RELATION_EXPANSION, 'true');
});

test('everyday settings sit on top; the rest stay folded until searched', async () => {
  const { app } = settingsPanel();
  await app.gwLoad();
  assert.equal(JSON.stringify(app.gwCommon().map((i: any) => i.name)), '["ENABLE_DREAM","CLEF_AUTO_REVIEW","MEMORY_FILTER_MAX_OUTPUT"]');
  const names = () => JSON.stringify(app.gwSections().map((s: any) => [s.group, s.items.map((i: any) => i.name)]));
  assert.equal(names(), '[["记忆召回",["RELATION_EXPANSION"]],["Dream 与日记",["DIARY_MODEL","WEEKLY_ROLLUP_DELETE_DAILIES"]]]');
  assert.equal(app.gwGroupOpen('记忆召回'), false);
  assert.equal(app.gwChangedCount(), 1);
  app.gwQuery = 'dream';
  assert.equal(names(), '[["Dream 与日记",["ENABLE_DREAM","DIARY_MODEL","WEEKLY_ROLLUP_DELETE_DAILIES","CLEF_AUTO_REVIEW"]]]');
  assert.equal(app.gwGroupOpen('Dream 与日记'), true);
  assert.match(ADMIN_HTML, /x-for="item in gwCommon\(\)"/);
});

test('assistant edits raise the save bar until saved or discarded', async () => {
  const { app, sent } = settingsPanel();
  await app.gwLoad();
  assert.equal(app.gwDirty(), false);
  assert.match(app.gwIdentitySummary(app.gwIdentities[0]), /\/danjiu · \*opus\* · 写入 default/);
  app.gwIdentities[0]._open = true; // Folding a card is not an edit.
  assert.equal(app.gwDirty(), false);
  app.gwIdentities[0].modelsText = '*opus*, *fable*';
  assert.equal(app.gwDirty(), true);
  await app.gwDiscard();
  assert.equal(app.gwIdentities[0].modelsText, '*opus*');
  assert.equal(app.gwDirty(), false);
  app.gwAddress = 'https://new.test/v1';
  assert.equal(app.gwDirty(), true);
  await app.gwSave();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].upstream.address, 'https://new.test/v1');
  assert.equal(sent[0].identities[0].slug, 'danjiu');
  assert.equal(sent[0].settings, undefined);
  assert.equal(app.gwDirty(), false);
});

test('a new assistant shares the default space unless told otherwise, and an empty space points at the memories', async () => {
  const { app } = panel();
  let identities: any[] = [];
  const sent: any[] = [];
  app.request = async (path: string, options: any = {}) => {
    if (path === '/api/gateway/config' && options.method === 'PATCH') { sent.push(JSON.parse(options.body)); return { ok: true }; }
    if (path === '/api/gateway/config') return { identities };
    if (path === '/api/gateway/spaces') return { spaces: [{ namespace: 'default', memories: 312 }, { namespace: 'ning', memories: 40 }] };
    if (path === '/api/gateway/env') return { groups: [], secrets: [] };
    return { data: [] };
  };
  await app.gwLoad();
  // The first assistant writes where MCP and the Claude Code hook write; the next one gets its own space.
  app.gwAdd();
  app.gwAdd();
  assert.deepEqual(app.gwIdentities.map((idn: any) => idn.namespace), ['default', '']);
  assert.match(ADMIN_HTML, /记忆存在哪个空间/);

  // An assistant saved with its own, still empty space is pointed at the unclaimed one that has memories.
  identities = [{ slug: 'Claude', keys: ['CHATBOX_API_KEY'], models: ['*claude*'] },
    { slug: 'ningjiao', namespace: 'ning', keys: ['CHATBOX_API_KEY'], models: ['*'] }];
  await app.gwLoad();
  const [claude, ning] = app.gwIdentities;
  assert.equal(app.gwSpaceHint(claude).text, '「Claude」里还没有记忆，default 里有 312 条。');
  assert.equal(app.gwSpaceHint(ning), null);
  app.gwUseSpace(claude);
  assert.equal(claude.namespace, 'default');
  assert.equal(app.gwSpaceHint(claude), null);
  await app.gwSave();
  assert.equal(sent[0].identities[0].namespace, 'default');

  // A space another assistant already writes to is never suggested.
  identities = [{ slug: 'Claude', keys: ['CHATBOX_API_KEY'], models: ['*'] },
    { slug: 'danjiu', namespace: 'default', keys: ['CHATBOX_API_KEY'], models: ['*'] },
    { slug: 'ningjiao', namespace: 'ning', keys: ['CHATBOX_API_KEY'], models: ['*'] }];
  await app.gwLoad();
  assert.equal(app.gwSpaceHint(app.gwIdentities[0]), null);
});
