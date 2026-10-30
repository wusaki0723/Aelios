import { chatParseBrowserScript } from "../../memory/transfer/chatParse";

// 后台页面是一整串 HTML：Alpine 管交互，Tailwind CDN 只用来排版，颜色和部件都走下面的 CSS 变量。
// 中英两套文字：静态文字写成 t('中文', 'English') 两个 span，按 <html data-lang> 只显示一个；
// 绑定里的文字用组件里的 L('中文', 'English')。

const svg = (body: string, size = 18): string =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const t = (zh: string, en: string): string => `<span class="zh">${zh}</span><span class="en">${en}</span>`;

const I = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>'),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'),
  book: svg('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'),
  db: svg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>'),
  spark: svg('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4"/>'),
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>'),
  swap: svg('<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>'),
  sliders: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>'),
  updown: svg('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>', 16),
  refresh: svg('<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
  heart: svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  checkBig: svg('<path d="M20 6 9 17l-5-5"/>', 20),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 16),
  minus: svg('<path d="M5 12h14"/>', 16),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>', 16),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>', 16),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>', 16),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  ext: svg('<path d="M7 17 17 7M8 7h9v9"/>', 14),
  upload: svg('<path d="M12 3v12"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  list: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>'),
  play: svg('<path d="m6 4 14 8-14 8z"/>', 16),
  pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z"/>', 16),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>', 16),
  pencil: svg('<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>', 16),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', 16),
  alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>', 16)
};
const ICON_LINK = svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 16);
const ICON_SPIN = svg('<path d="M21 12a9 9 0 1 1-6.22-8.56"/>', 16);
const HEART_FILLED = I.heart.replace('fill="none"', 'fill="currentColor"');

// 侧栏里的一项：点了换页。星图是另一个独立页面，跳过去。
const navLink = (id: string, icon: string, zh: string, en: string, extra = ""): string =>
  `<button type="button" @click="go('${id}')" class="nav-link" :class="page === '${id}' ? 'is-active' : ''" :aria-current="page === '${id}' ? 'page' : null">${icon}<span class="flex-1 text-left">${t(zh, en)}</span>${extra}</button>`;

// 设置页每一项：名字一行，说明收在 ⓘ 里点开才看；开关点了就存，文字改完离开输入框就存。
const SETTING_ROW = String.raw`<div class="set-row" :title="item.name">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span x-show="item.saved" class="dot-changed" aria-hidden="true"></span>
                    <template x-if="item.kind === 'switch'"><span class="set-label" :id="'lb-' + item.name" x-text="sLabel(item)"></span></template>
                    <template x-if="item.kind !== 'switch'"><label class="set-label" :for="'setting-' + item.name" x-text="sLabel(item)"></label></template>
                    <button type="button" x-show="sHint(item)" @click="toggleHint(item.name)" class="info-btn" :aria-expanded="hintOpen(item.name) ? 'true' : 'false'" :aria-label="L('说明：', 'About: ') + sLabel(item)">${I.info}</button>
                    <button type="button" x-show="item.saved" @click="saveSetting(item, '')" :disabled="item.busy" class="reset-btn" x-text="L('已改 · 恢复默认', 'Changed · Reset')"></button>
                  </div>
                  <div x-show="hintOpen(item.name)" class="set-hint"><span x-text="sHint(item)"></span><code x-text="item.name"></code></div>
                </div>
                <template x-if="item.kind === 'switch'">
                  <button type="button" role="switch" :aria-checked="settingOn(item) ? 'true' : 'false'" :aria-labelledby="'lb-' + item.name" :disabled="item.busy" @click="toggleSetting(item)" class="switch" :class="settingOn(item) ? 'is-on' : ''"><span></span></button>
                </template>
                <template x-if="item.kind !== 'switch'">
                  <input :id="'setting-' + item.name" x-model="item.value" @change="saveSetting(item, item.value)" @keydown.enter.prevent="$event.target.blur()" @keydown.escape="item.value = item.saved; $event.target.blur()" :disabled="item.busy" :placeholder="item.deployed ? L('留空用 ', 'Blank uses ') + item.deployed : L('留空用默认值', 'Blank uses the default')" class="field set-input">
                </template>
              </div>`;

// 待审里的一张卡，日常和导入两栏共用；导入的没有勾选框，批量走 clef 那两个按钮。
const CANDIDATE_CARD = String.raw`<article class="panel cand">
              <input type="checkbox" x-show="!candidate.import_id" class="cand-check" :checked="!!reviewSelected[candidate.id]" @change="reviewToggle(candidate.id)" :aria-label="L('选择这条', 'Select this one')">
              <div class="cand-body">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="chip" :class="typeChipClass(candidate.type)" x-text="typeLabel(candidate.type)"></span>
                  <span class="chip" :class="candidateKindClass(candidate)" x-text="candidateKindLabel(candidate)"></span>
                  <span x-show="candidate.import_id && candidate.day" class="chip chip-dim" x-text="candidate.day"></span>
                  <span x-show="candidate.clef_worth !== null && candidate.clef_worth !== undefined" class="chip" :class="clefLooksYes(candidate) ? 'chip-ok' : 'chip-dim'" x-text="clefOpinionLabel(candidate)"></span>
                  <span x-show="!candidate.import_id && candidate.confidence != null" class="conf">
                    <span x-text="L('把握 ', 'Confidence ') + pct(candidate.confidence)"></span>
                    <span class="meter" aria-hidden="true"><span :style="'width:' + pct(candidate.confidence)"></span></span>
                  </span>
                </div>
                <template x-if="candidate.existing_content">
                  <div class="was-now">
                    <span class="muted" x-text="L('原来', 'Was')"></span><span class="line-through-soft" x-text="candidate.existing_content"></span>
                    <span class="muted" x-text="L('改成', 'Now')"></span><span x-text="candidate.content"></span>
                  </div>
                </template>
                <p x-show="!candidate.editing && !candidate.existing_content" class="cand-text" x-text="candidate.content"></p>
                <p x-show="candidate.source === 'dream_delete'" class="cand-note">
                  <span x-text="L('原因：', 'Why: ') + (candidate.decision_note || L('整理时觉得不再成立', 'no longer seemed true'))"></span>
                  <span class="mono" x-text="candidate.target_memory_id ? ' · ' + candidate.target_memory_id : ''"></span>
                </p>
                <template x-if="candidate.editing">
                  <div class="mt-3 grid gap-2">
                    <textarea x-model="candidate.draft.content" class="field min-h-28" :aria-label="L('内容', 'Content')"></textarea>
                    <div class="grid gap-2 sm:grid-cols-2">
                      <select x-model="candidate.draft.type" class="field" :aria-label="L('类型', 'Type')">
                        <template x-for="type in canonicalMemoryTypes" :key="type"><option :value="type" x-text="typeLabel(type)"></option></template>
                      </select>
                      <input x-model="candidate.draft.fact_key" class="field mono" placeholder="fact_key">
                    </div>
                  </div>
                </template>
                <div x-show="candidate.mergeOpen" class="mt-3 flex flex-wrap gap-2">
                  <input x-model="candidate.target_id" class="field min-w-0 flex-1" :placeholder="L('要并进去的那条记忆的 id', 'id of the memory to merge into')">
                  <button type="button" @click="mergeCandidate(candidate)" class="btn btn-sm" x-text="L('合并', 'Merge')"></button>
                </div>
                <button type="button" @click="toggleCandidateSources(candidate)" class="link-btn mt-2" :aria-expanded="candidate.sourcesOpen ? 'true' : 'false'">
                  <span x-text="candidate.sourcesOpen ? L('收起原话', 'Hide source') : L('看原话', 'Show source')"></span>
                  <span class="chev" :class="candidate.sourcesOpen ? 'is-open' : ''">${I.chevron}</span>
                </button>
                <div x-show="candidate.sourcesOpen" class="quotes">
                  <p x-show="!candidate.sources" class="muted text-xs" x-text="L('加载中…', 'Loading…')"></p>
                  <template x-for="message in (candidate.sources || [])" :key="message.id">
                    <blockquote>
                      <span class="muted text-xs" x-text="roleName(message.role) + (message.created_at ? ' · ' + quoteTime(message.created_at) : '')"></span>
                      <span class="block whitespace-pre-wrap" x-text="message.content"></span>
                    </blockquote>
                  </template>
                  <p x-show="candidate.sources && candidate.sources.length === 0" class="muted text-xs" x-text="L('这条没有挂原话（整理好的条目本身就是原文）。', 'No source lines attached (a prepared list item is its own source).')"></p>
                </div>
              </div>
              <div class="cand-actions">
                <button type="button" @click="approveCandidate(candidate)" class="btn btn-primary btn-sm">${I.check}<span x-text="candidate.editing ? L('改好记住', 'Save & remember') : candidateApproveLabel(candidate)"></span></button>
                <button type="button" @click="discardCandidate(candidate)" class="btn btn-sm" x-text="candidateDiscardLabel(candidate)"></button>
                <div class="relative">
                  <button type="button" @click="candidate.moreOpen = !candidate.moreOpen" class="btn btn-sm btn-icon-sm" :aria-expanded="candidate.moreOpen ? 'true' : 'false'" :aria-label="L('更多操作', 'More actions')">${I.more}</button>
                  <div x-show="candidate.moreOpen" @click.outside="candidate.moreOpen = false" class="menu">
                    <button type="button" @click="toggleCandidateEdit(candidate); candidate.moreOpen = false" x-text="candidate.editing ? L('取消编辑', 'Cancel editing') : L('编辑后记住', 'Edit, then remember')"></button>
                    <button type="button" x-show="!candidate.import_id" @click="candidate.mergeOpen = !candidate.mergeOpen; candidate.moreOpen = false" x-text="L('并进已有的一条', 'Merge into an existing one')"></button>
                  </div>
                </div>
              </div>
            </article>`;

// 导入聊天记录时在浏览器里拆文件、按天切段的那几个函数 (跟服务端是同一份代码)。
const CHAT_PARSE_SCRIPT = chatParseBrowserScript();

export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Aelios</title>
<script>
// 先定好语言和明暗，免得页面先闪一下另一套。没选过语言就看浏览器：中文浏览器用中文，其余用英文。
(function() {
  var root = document.documentElement;
  var lang = null, theme = null;
  try { lang = localStorage.getItem('aelios.admin.lang'); theme = localStorage.getItem('aelios.admin.colorMode'); } catch (error) {}
  if (lang !== 'zh' && lang !== 'en') {
    var browser = navigator.language || '';
    lang = browser && !/^zh/i.test(browser) ? 'en' : 'zh';
  }
  root.dataset.lang = lang;
  root.lang = lang === 'en' ? 'en' : 'zh-CN';
  root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
})();
</script>
<script src="https://cdn.tailwindcss.com"></script>
<script>
// Tailwind 只用来排版；它自带的重置会盖掉下面按钮、输入框的颜色，关掉，用这里自己的一小段重置。
tailwind.config = { corePlugins: { preflight: false } };
</script>
<script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
<style>
  /* ===== 色板：白天是晨昏渐变，夜里是深空星野。整页颜色都从这组变量来 ===== */
  :root {
    color-scheme: light;
    --page: #EEEDF8;
    --bg: linear-gradient(165deg, #F6EEF3 0%, #EEEDF8 42%, #E5EBFA 100%);
    --neb1: rgba(244, 160, 124, .42); --neb2: rgba(139, 124, 246, .32); --neb3: rgba(103, 232, 249, .18); --band: rgba(255, 255, 255, 0);
    --s1: rgba(124, 108, 220, .6); --s2: rgba(244, 160, 124, .65); --s3: rgba(103, 180, 249, .55); --halo: rgba(139, 124, 246, .16);
    --so: .7; --shoot: 0;
    --side: rgba(255, 255, 255, .32); --panel: rgba(255, 255, 255, .56); --solid: rgba(255, 255, 255, .9);
    --line: rgba(109, 92, 210, .2); --div: rgba(109, 92, 210, .11);
    --glow: 0 1px 0 rgba(255, 255, 255, .75) inset, 0 10px 28px rgba(88, 76, 160, .14);
    --t1: #232437; --t2: #3C3E5C; --t3: #5A5D86; --soft: rgba(124, 108, 220, .08);
    --coral: #F4A07C; --on-coral: #2A1608; --ct: #A84B22;
    --aur: linear-gradient(135deg, rgba(139, 124, 246, .26), rgba(103, 232, 249, .18)); --aurb: rgba(139, 124, 246, .5);
    --vline: #6D5CD2; --vt: #5B4BC4; --vbg: rgba(139, 124, 246, .15);
    --ok: #1D7350; --okbg: rgba(110, 231, 183, .26); --okdot: #2F9E6E;
    --warn: #7A4A00; --warnbg: rgba(251, 191, 36, .22);
    --err: #A0281C; --errbg: rgba(248, 113, 113, .16); --errb: rgba(200, 70, 60, .4);
    --off: rgba(109, 92, 210, .24); --knob: #FFFFFF; --scrim: rgba(35, 36, 55, .35);
    --fa: #2F5A8A; --fab: rgba(103, 160, 249, .18); --pr: #A84B22; --prb: rgba(244, 160, 124, .22);
    --bo: #9F2A3B; --bob: rgba(240, 110, 140, .16); --de: #5B4BC4; --deb: rgba(139, 124, 246, .18);
    --ev: #1C6B6B; --evb: rgba(80, 200, 200, .18); --ha: #2F6B2A; --hab: rgba(120, 200, 110, .2);
    --re: #8A3A7A; --reb: rgba(220, 120, 200, .16); --no: #3C3E5C; --nob: rgba(109, 92, 210, .09);
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #070A16;
    --bg: linear-gradient(170deg, #05071A 0%, #0A0E2C 50%, #140C33 100%);
    --neb1: rgba(124, 93, 250, .34); --neb2: rgba(56, 189, 248, .2); --neb3: rgba(236, 72, 153, .13); --band: rgba(165, 155, 255, .12);
    --s1: rgba(255, 255, 255, .98); --s2: rgba(205, 214, 255, .9); --s3: rgba(255, 196, 168, .85); --halo: rgba(170, 160, 255, .38);
    --so: 1; --shoot: 1;
    --side: rgba(8, 11, 30, .32); --panel: rgba(20, 26, 58, .48); --solid: rgba(23, 29, 62, .9);
    --line: rgba(148, 163, 255, .18); --div: rgba(148, 163, 255, .1);
    --glow: 0 1px 0 rgba(180, 190, 255, .08) inset, 0 10px 30px rgba(2, 5, 18, .5);
    --t1: #EEF0FF; --t2: #C9CDEA; --t3: #9EA4CC; --soft: rgba(148, 163, 255, .08);
    --ct: #F4A07C;
    --aur: linear-gradient(135deg, rgba(139, 124, 246, .3), rgba(103, 232, 249, .16)); --aurb: rgba(139, 124, 246, .6);
    --vline: #9B8CFF; --vt: #B9AFFF; --vbg: rgba(139, 124, 246, .18);
    --ok: #6EE7B7; --okbg: rgba(110, 231, 183, .12); --okdot: #6EE7B7;
    --warn: #FBBF24; --warnbg: rgba(251, 191, 36, .12);
    --err: #F87171; --errbg: rgba(248, 113, 113, .12); --errb: rgba(248, 113, 113, .4);
    --off: rgba(148, 163, 255, .22); --knob: #EEF0FF; --scrim: rgba(2, 4, 14, .6);
    --fa: #93C5FD; --fab: rgba(103, 160, 249, .15); --pr: #F4A07C; --prb: rgba(244, 160, 124, .15);
    --bo: #F9A8B8; --bob: rgba(240, 110, 140, .15); --de: #B9AFFF; --deb: rgba(139, 124, 246, .2);
    --ev: #67E8F9; --evb: rgba(80, 200, 220, .13); --ha: #A3E39A; --hab: rgba(120, 200, 110, .13);
    --re: #F0ABE0; --reb: rgba(220, 120, 200, .13); --no: #C9CDEA; --nob: rgba(148, 163, 255, .11);
  }

  /* 中英两套文字只显示一套 */
  :root[data-lang="en"] .zh, :root:not([data-lang="en"]) .en { display: none !important; }
  [x-cloak] { display: none !important; }
  *, *::before, *::after { box-sizing: border-box; }
  p, h1, h2, h3, ol, ul, figure, blockquote, pre { margin: 0; }
  ol, ul { padding: 0; }
  button { border: 0; background: none; padding: 0; }
  details > summary { cursor: pointer; }

  html, body { min-height: 100%; background: var(--page); }
  body { margin: 0; color: var(--t1); font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
  * { scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
  button, input, textarea, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: default; }
  :focus-visible { outline: 2px solid var(--vline); outline-offset: 2px; }
  h1, h2, h3, button { word-break: keep-all; }
  a { color: var(--ct); }
  svg.i { display: inline-block; flex: none; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: .92em; }
  .muted { color: var(--t3); }

  /* ===== 星空：渐变底 + 三层星点 + 两颗流星（白天流星不显示），只动 opacity / transform ===== */
  .sky { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
    background:
      radial-gradient(60% 45% at 82% 6%, var(--neb1), transparent 70%),
      radial-gradient(55% 45% at 6% 88%, var(--neb2), transparent 70%),
      radial-gradient(42% 36% at 38% 42%, var(--neb3), transparent 72%),
      linear-gradient(118deg, transparent 28%, var(--band) 46%, transparent 64%),
      var(--bg); }
  .sky .l { position: absolute; inset: 0; background-repeat: repeat; }
  .sky .a { background-image: radial-gradient(1.2px 1.2px at 24px 36px, var(--s1) 50%, transparent), radial-gradient(1px 1px at 128px 96px, var(--s2) 50%, transparent), radial-gradient(1.6px 1.6px at 212px 180px, var(--s1) 50%, transparent), radial-gradient(1px 1px at 320px 64px, var(--s2) 50%, transparent), radial-gradient(1.2px 1.2px at 392px 240px, var(--s3) 50%, transparent), radial-gradient(1px 1px at 72px 300px, var(--s2) 50%, transparent), radial-gradient(1.6px 1.6px at 268px 356px, var(--s1) 50%, transparent), radial-gradient(1px 1px at 428px 400px, var(--s2) 50%, transparent), radial-gradient(1.2px 1.2px at 168px 424px, var(--s1) 50%, transparent), radial-gradient(1px 1px at 350px 140px, var(--s1) 50%, transparent), radial-gradient(1px 1px at 40px 200px, var(--s3) 50%, transparent), radial-gradient(1px 1px at 240px 20px, var(--s2) 50%, transparent);
    background-size: 460px 460px; animation: sky-a 7s ease-in-out infinite alternate; }
  .sky .b { background-image: radial-gradient(1.8px 1.8px at 96px 148px, var(--s2) 50%, transparent), radial-gradient(2px 2px at 336px 44px, var(--s1) 50%, transparent), radial-gradient(1.4px 1.4px at 512px 208px, var(--s2) 50%, transparent), radial-gradient(1.6px 1.6px at 184px 392px, var(--s3) 50%, transparent), radial-gradient(1.4px 1.4px at 568px 460px, var(--s1) 50%, transparent), radial-gradient(2px 2px at 48px 520px, var(--s2) 50%, transparent), radial-gradient(1.4px 1.4px at 432px 584px, var(--s1) 50%, transparent), radial-gradient(1.2px 1.2px at 280px 270px, var(--s1) 50%, transparent);
    background-size: 620px 620px; animation: sky-b 11s ease-in-out infinite alternate; }
  .sky .c { background-image: radial-gradient(2.4px 2.4px at 140px 120px, var(--s1) 55%, transparent), radial-gradient(12px 12px at 140px 120px, var(--halo), transparent), radial-gradient(2.2px 2.2px at 700px 380px, var(--s2) 55%, transparent), radial-gradient(11px 11px at 700px 380px, var(--halo), transparent), radial-gradient(2.6px 2.6px at 420px 760px, var(--s3) 55%, transparent), radial-gradient(13px 13px at 420px 760px, var(--halo), transparent), radial-gradient(2.2px 2.2px at 860px 860px, var(--s1) 55%, transparent), radial-gradient(10px 10px at 860px 860px, var(--halo), transparent);
    background-size: 960px 960px; animation: sky-c 5s ease-in-out infinite alternate; }
  .sky .shoot { position: absolute; width: 160px; height: 1.5px; border-radius: 999px; background: linear-gradient(90deg, rgba(255, 255, 255, .95), rgba(190, 180, 255, .5) 30%, transparent); opacity: 0; transform: rotate(-28deg); }
  .sky .s1 { top: 90px; left: 68%; animation: sky-shoot 12s ease-in 2s infinite; }
  .sky .s2 { top: 520px; left: 88%; animation: sky-shoot 17s ease-in 9s infinite; }
  @keyframes sky-a { from { opacity: calc(var(--so) * .45); } to { opacity: var(--so); } }
  @keyframes sky-b { from { opacity: var(--so); } to { opacity: calc(var(--so) * .35); } }
  @keyframes sky-c { from { opacity: calc(var(--so) * .55); } to { opacity: var(--so); } }
  @keyframes sky-shoot { 0% { opacity: 0; transform: translate(0, 0) rotate(-28deg); } 2% { opacity: var(--shoot); } 9% { opacity: 0; transform: translate(-300px, 160px) rotate(-28deg); } 100% { opacity: 0; transform: translate(-300px, 160px) rotate(-28deg); } }

  /* ===== 外壳：手机上是一整屏的列，内容区自己滚、底栏钉在下面；宽屏是侧栏 + 正文，整页滚 ===== */
  .app { position: relative; z-index: 1; display: flex; flex-direction: column; height: 100dvh; }
  .main { position: relative; flex: 1; min-width: 0; min-height: 0; overflow-y: auto; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 20px 16px max(40px, env(safe-area-inset-bottom)); }
  .side { position: fixed; inset: 0 auto 0 0; z-index: 60; width: 272px; max-width: 86vw; box-sizing: border-box; padding: 20px 14px; display: flex; flex-direction: column; gap: 22px; overflow-y: auto;
    background: var(--solid); box-shadow: var(--glow); transform: translateX(-104%); transition: transform .2s ease; }
  .side.is-open { transform: none; }
  .side-scrim { position: fixed; inset: 0; z-index: 55; background: var(--scrim); }
  @media (min-width: 768px) {
    .app { flex-direction: row; height: auto; min-height: 100dvh; }
    .main { overflow: visible; }
    .wrap { padding: 32px clamp(16px, 4vw, 40px) 56px; }
    .side { position: sticky; top: 0; height: 100dvh; width: 240px; max-width: none; flex: none; transform: none; transition: none; z-index: 2;
      background: var(--side); box-shadow: inset -1px 0 0 var(--div); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); }
    .side-scrim, .topbar { display: none !important; }
  }
  .brand { display: flex; align-items: center; gap: 10px; padding: 0 6px; font-size: 16px; font-weight: 600; letter-spacing: -.01em; }
  .logo { width: 32px; height: 32px; border-radius: 9px; background: var(--coral); color: var(--on-coral); display: grid; place-items: center; font-size: 15px; font-weight: 700; flex: none; }
  .viewing { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); text-align: left; width: 100%; }
  .nav-title { padding: 0 12px 6px; font-size: 11px; font-weight: 600; letter-spacing: .04em; color: var(--t3); }
  .nav-link { display: flex; width: 100%; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border-radius: 10px; color: var(--t2); font-size: 14px; font-weight: 500; background: transparent; border: 0; }
  .nav-link:hover { background: var(--soft); color: var(--t1); }
  .nav-link.is-active { background: var(--aur); box-shadow: inset 0 0 0 1px var(--aurb); color: var(--t1); font-weight: 600; }
  .badge { min-width: 22px; padding: 2px 7px; box-sizing: border-box; border-radius: 999px; background: var(--coral); color: var(--on-coral); font-size: 12px; font-weight: 600; text-align: center; line-height: 1.4; }
  .topbar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--div); background: var(--side); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); position: sticky; top: 0; z-index: 30; }
  .topbar .badge { position: absolute; top: -4px; right: -4px; min-width: 18px; padding: 0 5px; font-size: 10px; }

  /* ===== 部件 ===== */
  .page { display: flex; flex-direction: column; gap: 24px; }
  .page-head { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
  .h1 { margin: 0; font-size: 28px; font-weight: 600; letter-spacing: -.01em; line-height: 1.25; }
  .h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .sub { margin: 6px 0 0; font-size: 14px; color: var(--t3); }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: var(--glow); }
  .panel-pad { padding: 18px; }
  .panel-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; padding: 16px 18px 0; }
  .divide > * + * { border-top: 1px solid var(--div); }
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
  .empty { padding: 28px 18px; text-align: center; color: var(--t3); }
  .stats { display: flex; flex-wrap: wrap; gap: 12px; }
  .stat { flex: 1 1 150px; padding: 16px 18px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .stat-label { font-size: 13px; color: var(--t3); }
  .stat-num { font-size: 28px; font-weight: 600; letter-spacing: -.01em; font-variant-numeric: tabular-nums; line-height: 1.3; }
  .stat-sub { font-size: 12px; color: var(--t3); }
  /* overflow 裁剪：顶上那条极光是直的，不裁会从圆角卡片两侧探出去 */
  .dream-stat { position: relative; overflow: hidden; }
  .dream-stat::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: linear-gradient(90deg, #8B7CF6, #67E8F9); opacity: .75; }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--t2); font-size: 14px; font-weight: 500; white-space: nowrap; transition: border-color .15s ease, background-color .15s ease, color .15s ease; }
  .btn:hover:not(:disabled) { border-color: var(--aurb); color: var(--t1); }
  .btn:disabled { opacity: .45; }
  .btn-primary { border: 0; background: var(--coral); color: var(--on-coral); font-weight: 600; }
  .btn-primary:hover:not(:disabled) { color: var(--on-coral); filter: brightness(1.04); }
  .btn-sm { min-height: 36px; padding: 0 12px; font-size: 13px; }
  .btn-icon { width: 44px; padding: 0; }
  .btn-icon-sm { width: 36px; padding: 0; }
  .btn-danger { color: var(--err); }
  .btn-danger:hover:not(:disabled) { border-color: var(--errb); color: var(--err); }
  .btn-warn { border-color: var(--warnbg); background: var(--warnbg); color: var(--warn); font-weight: 600; }
  .link-btn { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: var(--vt); font-size: 13px; font-weight: 500; }
  .link-btn:hover { text-decoration: underline; }
  .link { color: var(--ct); font-size: 13px; font-weight: 500; background: none; border: 0; padding: 0; }
  .link:hover { text-decoration: underline; }
  .field { min-height: 44px; width: 100%; box-sizing: border-box; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--solid); color: var(--t1); outline: none; transition: border-color .15s ease; }
  textarea.field { padding: 10px 12px; line-height: 1.7; resize: vertical; }
  .field:focus { border-color: var(--vline); }
  .field-sm { min-height: 36px; width: auto; }
  .search { position: relative; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--solid); color: var(--t3); box-sizing: border-box; }
  .search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--t1); }
  .search:focus-within { border-color: var(--vline); }
  .label { display: block; font-size: 13px; color: var(--t3); margin-bottom: 6px; }
  .check { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; font-size: 13px; color: var(--t2); }
  input[type="checkbox"], input[type="radio"] { width: 16px; height: 16px; accent-color: var(--vline); flex: none; }

  .tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--line); }
  .tab { min-height: 44px; padding: 0 14px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--t2); font-size: 14px; }
  .tab.is-active { border-bottom-color: var(--vline); color: var(--t1); font-weight: 600; }
  .tab .count { margin-left: 4px; color: var(--t3); font-weight: 500; }
  .pill { min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--t2); font-size: 13px; }
  .pill.is-active { border-color: var(--aurb); background: var(--aur); color: var(--t1); font-weight: 600; }
  .pill .count { color: var(--t3); margin-left: 2px; }
  .seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); }
  .seg button { min-height: 32px; padding: 0 12px; border-radius: 8px; border: 0; background: transparent; color: var(--t2); font-size: 13px; }
  .seg button.is-active { background: var(--solid); color: var(--t1); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .08); }

  .chip { display: inline-flex; align-items: center; gap: 5px; border-radius: 999px; padding: 2px 9px; font-size: 12px; line-height: 1.6; color: var(--t2); background: var(--soft); white-space: nowrap; }
  .chip-ok { color: var(--ok); background: var(--okbg); }
  .chip-warn { color: var(--warn); background: var(--warnbg); }
  .chip-err { color: var(--err); background: var(--errbg); }
  .chip-dim { color: var(--t3); background: var(--soft); }
  .chip-violet { color: var(--vt); background: var(--vbg); }
  .chip-coral { color: var(--pr); background: var(--prb); }
  .t-fact { color: var(--fa); background: var(--fab); } .t-preference { color: var(--pr); background: var(--prb); }
  .t-boundary { color: var(--bo); background: var(--bob); } .t-decision { color: var(--de); background: var(--deb); }
  .t-event { color: var(--ev); background: var(--evb); } .t-habit { color: var(--ha); background: var(--hab); }
  .t-relationship { color: var(--re); background: var(--reb); } .t-note { color: var(--no); background: var(--nob); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--t3); }
  .dot-ok { background: var(--okdot); } .dot-err { background: var(--err); } .dot-warn { background: var(--warn); }
  .meter { display: inline-block; position: relative; width: 48px; height: 4px; border-radius: 999px; background: var(--off); overflow: hidden; vertical-align: middle; }
  .meter > span { position: absolute; inset: 0 auto 0 0; border-radius: 999px; background: var(--vline); }
  .bar { height: 8px; border-radius: 999px; background: var(--off); overflow: hidden; }
  .bar > div { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #8B7CF6, #67E8F9); transition: width .3s ease; }
  .conf { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--t3); }
  .banner { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 12px; background: var(--soft); color: var(--t2); font-size: 13px; }
  .banner-ok { background: var(--okbg); color: var(--ok); }
  .banner-warn { background: var(--warnbg); color: var(--warn); }
  .note { padding: 14px 16px; font-size: 13px; color: var(--t2); line-height: 1.7; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 13px; font-weight: 600; background: var(--vbg); color: var(--vt); }
  .avatar-user { background: var(--prb); color: var(--pr); }
  .heart { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; flex: none; border: 0; background: transparent; color: var(--t3); }
  .heart:hover { background: var(--soft); color: var(--coral); }
  .heart.is-on { color: var(--coral); }
  .quotes { margin-top: 8px; display: grid; gap: 8px; }
  .quotes blockquote { margin: 0; padding: 8px 12px; border-left: 3px solid var(--aurb); border-radius: 0 8px 8px 0; background: var(--soft); font-size: 13px; color: var(--t2); line-height: 1.7; }
  .cand { display: flex; flex-wrap: wrap; gap: 14px; padding: 16px 18px; align-items: flex-start; }
  .cand-check { margin-top: 4px; }
  .cand-body { flex: 1 1 280px; min-width: 0; }
  .cand-text { margin: 10px 0 0; font-size: 15px; line-height: 1.7; white-space: pre-wrap; color: var(--t1); }
  .cand-note { margin: 6px 0 0; font-size: 13px; color: var(--t3); }
  .cand-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-left: auto; }
  .was-now { margin-top: 10px; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 14px; line-height: 1.7; }
  .line-through-soft { color: var(--t3); text-decoration: line-through; text-decoration-color: var(--line); white-space: pre-wrap; }
  .menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 180px; padding: 6px; border-radius: 12px; border: 1px solid var(--line); background: var(--solid); box-shadow: var(--glow); display: grid; }
  .menu button { text-align: left; padding: 9px 12px; border-radius: 8px; border: 0; background: transparent; color: var(--t1); font-size: 13px; }
  .menu button:hover { background: var(--soft); }
  .chev { display: inline-grid; place-items: center; flex: none; color: var(--t3); transition: transform .15s ease; }
  .chev.is-open { transform: rotate(180deg); }
  .icon-btn { display: inline-grid; place-items: center; flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 999px; color: var(--t3); border: 0; background: transparent; transition: color .15s ease, background-color .15s ease; }
  .icon-btn:hover:not(:disabled) { color: var(--ct); background: var(--soft); }
  .icon-btn:disabled { opacity: .5; }
  .toast { position: fixed; left: 16px; right: 16px; top: 16px; z-index: 80; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--solid); box-shadow: var(--glow); font-size: 14px; }
  @media (min-width: 768px) { .toast { left: auto; right: 24px; width: 380px; } }
  .modal { position: fixed; inset: 0; z-index: 70; }
  .modal-scrim { position: absolute; inset: 0; background: var(--scrim); }
  .sheet { position: absolute; inset: auto 0 0 0; max-height: 86dvh; overflow-y: auto; padding: 18px 18px max(18px, env(safe-area-inset-bottom)); border-radius: 18px 18px 0 0; border: 1px solid var(--line); background: var(--solid); box-shadow: var(--glow); }
  @media (min-width: 768px) { .sheet { inset: 72px auto auto 50%; transform: translateX(-50%); width: 34rem; border-radius: 16px; } }

  /* 记忆库的表格行 */
  .mem-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; width: 100%; padding: 14px 18px; border: 0; background: transparent; text-align: left; }
  .mem-head:hover { background: var(--soft); }
  .mem-text { flex: 1 1 320px; min-width: 0; font-size: 14px; color: var(--t1); line-height: 1.6; }
  .mem-col { flex: 0 0 96px; font-size: 13px; color: var(--t3); }
  .mem-detail { padding: 4px 18px 18px; display: grid; gap: 14px; }
  .facts { display: flex; flex-wrap: wrap; gap: 10px 28px; font-size: 13px; }
  .facts > div { display: grid; gap: 2px; }
  .facts .k { color: var(--t3); font-size: 12px; }

  /* 设置 */
  .set-row { display: flex; align-items: flex-start; gap: 16px; padding: 14px 0; border-top: 1px solid var(--div); }
  .set-row:first-child { border-top: 0; }
  .set-label { font-size: 14px; font-weight: 500; color: var(--t1); }
  .set-hint { margin-top: 6px; padding: 8px 12px; border-radius: 8px; background: var(--soft); font-size: 13px; color: var(--t2); line-height: 1.7; }
  .set-hint code { display: inline-block; margin-left: 8px; color: var(--t3); font-size: 12px; }
  .set-input { width: 240px; max-width: 46%; flex: none; }
  .info-btn { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 999px; border: 0; background: transparent; color: var(--t3); }
  .info-btn:hover { color: var(--vt); background: var(--soft); }
  .reset-btn { border: 0; background: var(--vbg); color: var(--vt); border-radius: 999px; padding: 1px 9px; font-size: 12px; }
  .dot-changed { width: 7px; height: 7px; border-radius: 50%; background: var(--vline); flex: none; }
  .switch { position: relative; flex-shrink: 0; width: 44px; height: 26px; border-radius: 999px; border: 0; background: var(--off); transition: background-color .15s ease; margin-top: 1px; }
  .switch > span { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 999px; background: var(--knob); box-shadow: 0 1px 3px rgba(0, 0, 0, .2); transition: transform .15s ease; }
  .switch.is-on { background: var(--coral); }
  .switch.is-on > span { transform: translateX(18px); }
  .switch:disabled { opacity: .6; }
  .subnav a, .subnav button { display: block; width: 100%; text-align: left; padding: 8px 12px; border-radius: 8px; border: 0; background: transparent; color: var(--t2); font-size: 13px; text-decoration: none; }
  .subnav button:hover { background: var(--soft); color: var(--t1); }
  .group-btn { display: flex; width: 100%; align-items: center; gap: 10px; min-height: 52px; padding: 0 18px; border: 0; background: transparent; text-align: left; }
  .savebar { position: sticky; bottom: 12px; z-index: 30; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px; border-radius: 12px; border: 1px solid var(--coral); background: var(--solid); box-shadow: var(--glow); }

  /* 日记 */
  .journal { display: grid; gap: 16px; }
  .journal-back { display: none; }
  @media (max-width: 1023px) {
    .journal.is-reading .journal-list, .journal:not(.is-reading) .reading { display: none; }
    .journal-back { display: inline-flex; }
  }
  @media (min-width: 1024px) {
    .journal { grid-template-columns: 320px 1fr; align-items: start; }
    .journal .reading { position: sticky; top: 24px; max-height: calc(100dvh - 48px); overflow-y: auto; }
  }
  .entry-btn { display: grid; gap: 2px; width: 100%; padding: 12px 16px; border: 0; background: transparent; text-align: left; }
  .entry-btn:hover { background: var(--soft); }
  .entry-btn.is-active { background: var(--aur); box-shadow: inset 3px 0 0 var(--vline); }
  .reading { padding: 24px clamp(18px, 3vw, 36px); }
  .reading p { margin: 0 0 14px; font-size: 15px; line-height: 1.9; color: var(--t1); }

  /* 夜间整理 */
  .dream-rail { position: relative; }
  .dream-rail::before { content: ""; position: absolute; left: 7px; top: 12px; bottom: 12px; width: 1px; background: linear-gradient(to bottom, var(--aurb), transparent); }
  .dream-rail-item { position: relative; padding-left: 26px; }
  .dream-rail-item::before { content: ""; position: absolute; left: 3px; top: 8px; width: 9px; height: 9px; border-radius: 999px; background: var(--rail-dot, var(--t3)); box-shadow: 0 0 10px 1px var(--rail-glow, transparent); }
  .rail-ok { --rail-dot: var(--okdot); --rail-glow: rgba(110, 231, 183, .4); }
  .rail-err { --rail-dot: var(--err); --rail-glow: rgba(248, 113, 113, .4); }
  .rail-dim { --rail-dot: var(--t3); }
  .rail-run { --rail-dot: var(--warn); --rail-glow: rgba(251, 191, 36, .4); }
  .breathe { animation: dream-breathe 2.2s ease-in-out infinite; }
  @keyframes dream-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
  .day-bar { display: flex; align-items: center; gap: 12px; font-size: 13px; }
  .raw-bar-track { flex: 1; min-width: 0; height: 8px; border-radius: 999px; background: var(--off); overflow: hidden; }
  .raw-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, #8B7CF6, #67E8F9); }
  .raw-bar-fill.is-done { background: var(--t3); opacity: .4; }
  .harvest-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: var(--coral); box-shadow: 0 0 10px 2px rgba(244, 160, 124, .5); }

  .steps { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 0; list-style: none; font-size: 13px; color: var(--t3); }
  .steps .n { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 6px; border-radius: 50%; background: var(--soft); font-size: 12px; font-weight: 600; }
  .steps .is-done .n { background: var(--okbg); color: var(--ok); }
  .steps .is-now { color: var(--t1); font-weight: 600; }
  .steps .is-now .n { background: var(--coral); color: var(--on-coral); }
  .steps .sep { width: 24px; height: 1px; background: var(--line); }
  .mode-card { display: flex; gap: 14px; align-items: flex-start; padding: 16px 18px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel); text-align: left; }
  .mode-card.is-active { border-color: var(--aurb); background: var(--aur); }
  .mode-card .ico { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; flex: none; background: var(--vbg); color: var(--vt); }
  pre.out { margin: 0; max-height: 420px; overflow: auto; padding: 14px 16px; border-radius: 10px; background: var(--soft); font-size: 12px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }

  /* 星空只是氛围：减少动态时全部静止 */
  @media (prefers-reduced-motion: reduce) {
    .sky *, .breathe { animation: none !important; }
    *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
  }
</style>
</head>
<body>
<div class="sky" aria-hidden="true"><span class="l a"></span><span class="l b"></span><span class="l c"></span><span class="shoot s1"></span><span class="shoot s2"></span></div>
<div x-data="memoryAdmin()" x-init="init()" x-cloak class="app" @keydown.escape.window="navOpen = false">
  <div x-show="navOpen" x-transition.opacity.duration.150ms class="side-scrim" @click="navOpen = false"></div>
  <aside class="side" :class="navOpen ? 'is-open' : ''" :aria-label="L('主导航', 'Main navigation')">
    <div class="brand"><span class="logo" aria-hidden="true">A</span><span>Aelios</span></div>

    <button type="button" @click="spaceOpen = true; navOpen = false" class="viewing" :aria-label="L('切换查看的记忆空间', 'Switch the memory space you are viewing')">
      <span class="min-w-0 flex-1">
        <span class="block text-[11px] muted">${t("正在查看", "Viewing")}</span>
        <span class="block truncate text-sm font-semibold" :style="identityLoadError || emptySpaceHint() ? 'color: var(--ct)' : ''" x-text="viewingLabel()"></span>
      </span>
      <span class="muted">${I.updown}</span>
    </button>

    <nav class="flex flex-col gap-4">
      <div class="flex flex-col gap-0.5">
        <div class="nav-title">${t("日常", "Daily")}</div>
        ${navLink("today", I.home, "首页", "Home")}
        ${navLink("review", I.inbox, "待审", "Review", `<span x-show="pendingCount" class="badge" x-text="pendingCount"></span>`)}
        ${navLink("diary", I.book, "日记", "Journal")}
      </div>
      <div class="flex flex-col gap-0.5">
        <div class="nav-title">${t("记忆", "Memory")}</div>
        ${navLink("memory", I.db, "记忆库", "Memories")}
        ${navLink("starmap", I.spark, "星图", "Star map", `<span class="muted" :title="L('在新页面打开', 'Opens its own page')">${I.ext}</span>`)}
      </div>
      <div class="flex flex-col gap-0.5">
        <div class="nav-title">${t("后台", "System")}</div>
        ${navLink("dream", I.moon, "夜间整理", "Nightly")}
        ${navLink("transfer", I.swap, "导入导出", "Import &amp; export")}
        ${navLink("settings", I.sliders, "设置", "Settings")}
      </div>
    </nav>

    <div class="mt-auto flex flex-col gap-3">
      <div class="flex min-w-0 items-center gap-2 px-1.5 text-xs muted">
        <span class="dot" :class="connected === true ? 'dot-ok' : connected === false ? 'dot-err' : ''" aria-hidden="true"></span>
        <span class="flex-none" x-text="connected === true ? L('已连接', 'Connected') : connected === false ? L('连不上', 'Can’t connect') : savedApiKey.trim() ? L('连接中…', 'Connecting…') : L('还没连接', 'Not connected')"></span>
        <span class="min-w-0 truncate" x-text="baseHost()"></span>
      </div>
      <div class="flex items-center justify-between gap-2">
        <div class="seg" role="group" :aria-label="L('界面语言', 'Language')">
          <button type="button" @click="setLang('zh')" :class="lang === 'zh' ? 'is-active' : ''" :aria-pressed="lang === 'zh' ? 'true' : 'false'">中文</button>
          <button type="button" @click="setLang('en')" :class="lang === 'en' ? 'is-active' : ''" :aria-pressed="lang === 'en' ? 'true' : 'false'">EN</button>
        </div>
        <button type="button" @click="toggleTheme()" class="btn btn-icon" :aria-label="theme === 'dark' ? L('切换到白天', 'Switch to light') : L('切换到夜间', 'Switch to dark')" :title="theme === 'dark' ? L('切换到白天', 'Switch to light') : L('切换到夜间', 'Switch to dark')">
          <span x-show="theme === 'dark'">${I.sun}</span><span x-show="theme !== 'dark'">${I.moon}</span>
        </button>
      </div>
    </div>
  </aside>

  <main class="main">
    <!-- 手机上只有这一条：左边 ☰ 打开侧边栏（导航只有那一套），右边刷新。 -->
    <header class="topbar">
      <button type="button" @click="navOpen = true" class="btn btn-icon relative" :aria-label="L('打开菜单', 'Open menu')">${I.menu}<span x-show="pendingCount" class="badge" x-text="pendingCount"></span></button>
      <div class="brand min-w-0 flex-1"><span class="logo" aria-hidden="true">A</span><span>Aelios</span></div>
      <button type="button" @click="reloadAll()" class="btn btn-icon" :aria-label="L('刷新', 'Refresh')">${I.refresh}</button>
    </header>

    <div class="wrap">
      <section x-show="!savedApiKey.trim()" class="page">
        <header>
          <h1 class="h1">${t("连接你的 Aelios", "Connect to your Aelios")}</h1>
          <p class="sub">${t("填上 Worker 地址和主钥匙（CHATBOX_API_KEY），只存在这台设备的浏览器里。", "Enter your Worker address and main key (CHATBOX_API_KEY). They’re saved only in this browser.")}</p>
        </header>
        <div class="panel panel-pad grid max-w-xl gap-4">
          <label class="block"><span class="label">${t("Worker 地址", "Worker address")}</span>
            <input x-model="workerUrl" @change="savePrefs()" class="field" placeholder="https://…workers.dev">
          </label>
          <label class="block"><span class="label">Token</span>
            <input x-model="apiKey" @keydown.enter.prevent="saveToken()" type="password" class="field" autocomplete="current-password" placeholder="sk-…">
          </label>
          <div><button type="button" @click="saveToken()" :disabled="!apiKey.trim()" class="btn btn-primary">${t("连接", "Connect")}</button></div>
        </div>
      </section>

      <!-- ===== 首页 ===== -->
      <section x-show="savedApiKey.trim() && page === 'today'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("今天", "Today")}</h1>
            <p class="sub" x-text="todayLabel()"></p>
          </div>
          <button type="button" @click="reloadAll()" class="btn btn-icon hidden md:inline-flex" :aria-label="L('刷新', 'Refresh')" :title="L('刷新', 'Refresh')">${I.refresh}</button>
        </header>

        <div class="stats">
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("今天的对话", "Today’s chats")}</span>
            <span class="stat-num" x-text="stats.today_raw_count || 0"></span>
            <span class="stat-sub" x-text="lastMessageTime() ? L('最近一条 ', 'Latest at ') + lastMessageTime() : L('今天还没聊', 'Nothing yet today')"></span>
          </div>
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("待审", "To review")}</span>
            <span class="stat-num" style="color: var(--ct)" x-text="pendingCount"></span>
            <button type="button" @click="go('review')" class="link self-start">${t("去审核 →", "Start review →")}</button>
          </div>
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("昨晚整理", "Last night")}</span>
            <span class="flex items-center gap-2 text-[22px] font-semibold leading-[42px]" :style="'color: ' + homeRunColor()">
              <span x-show="home.run && home.run.status === 'ok' && !home.run.stale">${I.checkBig}</span>
              <span class="truncate" x-text="home.run ? dreamStatusLabel(home.run.status, home.run.stale) : L('还没跑过', 'Not yet')"></span>
            </span>
            <span class="stat-sub" x-text="homeRunSub()"></span>
          </div>
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("记忆库", "Memories")}</span>
            <span class="stat-num"><span x-text="capacityUsed()"></span><span class="text-sm font-medium muted" x-text="' / ' + capacityTotal()"></span></span>
            <span class="bar mt-2" aria-hidden="true"><div :style="'width:' + capacityPercent() + '%'"></div></span>
          </div>
        </div>

        <section x-show="pendingCount || importPendingCount || homeRunBroken()" class="flex flex-col gap-3">
          <h2 class="h2">${t("需要你处理", "Needs you")}</h2>
          <div class="panel divide">
            <div x-show="pendingCount" class="row">
              <span class="avatar">${I.inbox}</span>
              <div class="min-w-0 flex-1">
                <div class="font-semibold" x-text="L(pendingCount + ' 条新记忆等你确认', pendingCount + ' new memories to confirm')"></div>
                <div class="text-[13px] muted">${t("整理时拿不准的，确认后才会长期记住。", "Found during the nightly run. They’re kept long-term only after you confirm.")}</div>
              </div>
              <button type="button" @click="reviewTab = 'daily'; go('review')" class="btn btn-primary btn-sm">${t("开始审核", "Start review")}</button>
            </div>
            <div x-show="importPendingCount" class="row">
              <span class="avatar">${I.upload}</span>
              <div class="min-w-0 flex-1">
                <div class="font-semibold" x-text="L('导入的 ' + importPendingCount + ' 条还没看', importPendingCount + ' imported memories not checked yet')"></div>
                <div class="text-[13px] muted">${t("从别处导进来的，要你自己点。", "Brought in from elsewhere. These wait for you.")}</div>
              </div>
              <button type="button" @click="go('review'); openImportReview()" class="btn btn-sm">${t("查看", "View")}</button>
            </div>
            <div x-show="homeRunBroken()" class="row">
              <span class="avatar" style="background: var(--warnbg); color: var(--warn)">${I.alert}</span>
              <div class="min-w-0 flex-1">
                <div class="font-semibold">${t("最近一晚的整理没完成", "The last nightly run didn’t finish")}</div>
                <div class="text-[13px] muted" x-text="home.run ? dreamRunNote(home.run) : ''"></div>
              </div>
              <button type="button" @click="go('dream')" class="btn btn-sm">${t("去看看", "Take a look")}</button>
            </div>
          </div>
        </section>

        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <section class="panel">
            <div class="panel-head pb-3">
              <div class="flex items-baseline gap-2">
                <h2 class="h2">${t("今天的对话", "Today’s chats")}</h2>
                <span class="text-[13px] muted" x-text="L(todayMessages.length + ' 条', todayMessages.length + ' messages')"></span>
              </div>
              <div class="seg" role="group" :aria-label="L('按说话人筛选', 'Filter by speaker')">
                <button type="button" @click="homeRole = 'all'" :class="homeRole === 'all' ? 'is-active' : ''" x-text="L('全部', 'All')"></button>
                <button type="button" @click="homeRole = 'user'" :class="homeRole === 'user' ? 'is-active' : ''" x-text="L('你', 'You')"></button>
                <button type="button" @click="homeRole = 'assistant'" :class="homeRole === 'assistant' ? 'is-active' : ''" x-text="L('助手', 'Assistant')"></button>
              </div>
            </div>
            <div class="divide border-t" style="border-color: var(--div)">
              <template x-if="homeMessages().length === 0">
                <div class="empty">${t("今天还没有聊天记录。", "No chats yet today.")}</div>
              </template>
              <template x-for="message in homeMessages()" :key="message.id">
                <article class="flex items-start gap-3 px-[18px] py-3.5" x-data="{ more: false }" :title="message.source || ''">
                  <span class="avatar" :class="message.role === 'user' ? 'avatar-user' : ''" aria-hidden="true" x-text="roleName(message.role).slice(0, 1)"></span>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-2 text-xs muted"><span class="font-semibold" style="color: var(--t2)" x-text="roleName(message.role)"></span><span x-text="clock(message.created_at)"></span></div>
                    <p class="mt-1 whitespace-pre-wrap text-sm leading-7" :class="more ? '' : 'line-clamp-6'" x-text="message.content"></p>
                    <button type="button" x-show="(message.content || '').length > 320" @click="more = !more" class="link-btn mt-1" x-text="more ? L('收起', 'Show less') : L('展开', 'Show more')"></button>
                  </div>
                  <button type="button" @click="deleteRaw(message)" class="icon-btn mt-0.5" :aria-label="L('删掉这句', 'Delete this line')" :title="L('删掉这句', 'Delete this line')">${I.trash}</button>
                  <button type="button" @click="togglePin(message)" class="heart" :class="isPinned(message) ? 'is-on' : ''" :aria-pressed="isPinned(message) ? 'true' : 'false'" :aria-label="isPinned(message) ? L('取消珍贵', 'Remove from keepsakes') : L('收藏为珍贵', 'Save as a keepsake')" :title="isPinned(message) ? L('取消珍贵', 'Remove from keepsakes') : L('收藏为珍贵', 'Save as a keepsake')">
                    <span x-show="isPinned(message)">${HEART_FILLED}</span><span x-show="!isPinned(message)">${I.heart}</span>
                  </button>
                </article>
              </template>
            </div>
            <div x-show="homeFilteredCount() > 8" class="px-[18px] py-3" style="border-top: 1px solid var(--div)">
              <button type="button" @click="homeAll = !homeAll" class="link" x-text="homeAll ? L('收起', 'Show fewer') : L('查看全部 ' + homeFilteredCount() + ' 条 →', 'See all ' + homeFilteredCount() + ' →')"></button>
            </div>
          </section>

          <div class="flex flex-col gap-5">
            <section class="panel">
              <div class="panel-head">
                <h2 class="h2">${t("昨晚记住的", "Remembered last night")}</h2>
                <span class="text-[13px] muted" x-text="homeHarvestCreated().length ? L(homeHarvestCreated().length + ' 条', String(homeHarvestCreated().length)) : ''"></span>
              </div>
              <div class="flex flex-col gap-3 px-[18px] py-4">
                <template x-if="homeHarvestCreated().length === 0">
                  <p class="text-[13px] muted">${t("昨晚没有新记住的。", "Nothing new from last night.")}</p>
                </template>
                <template x-for="item in homeHarvestCreated().slice(0, 5)" :key="item.id">
                  <div class="flex items-start gap-2.5">
                    <span class="chip" :class="typeChipClass(item.type)" x-text="typeLabel(item.type)"></span>
                    <span class="min-w-0 flex-1 text-sm leading-6" x-text="item.content"></span>
                  </div>
                </template>
              </div>
              <div class="px-[18px] pb-4"><button type="button" @click="go('memory')" class="link">${t("在记忆库查看 →", "Open in Memories →")}</button></div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h2 class="h2">${t("最近的日记", "Latest journal")}</h2>
                <span class="text-[13px] muted" x-text="home.diary ? dayLabel(home.diary.date) : ''"></span>
              </div>
              <div class="px-[18px] py-4">
                <template x-if="!home.diary"><p class="text-[13px] muted">${t("还没有日记。", "No journal entries yet.")}</p></template>
                <template x-if="home.diary">
                  <div>
                    <div class="mb-1 font-semibold" x-text="home.diary.title"></div>
                    <p class="line-clamp-5 text-sm leading-7" style="color: var(--t2)" x-text="home.diary.summary"></p>
                  </div>
                </template>
              </div>
              <div x-show="home.diary" class="px-[18px] pb-4"><button type="button" @click="diaryMode = 'daily'; go('diary'); if (home.diary) openDiary('daily:' + home.diary.date)" class="link">${t("读完整篇 →", "Read the full entry →")}</button></div>
            </section>
          </div>
        </div>
      </section>

      <!-- ===== 待审 ===== -->
      <section x-show="savedApiKey.trim() && page === 'review'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("待审", "Review")}</h1>
            <p class="sub">${t("确认后才会写进长期记忆。", "Only what you confirm becomes a long-term memory.")}</p>
          </div>
          <button type="button" @click="reviewHelp = !reviewHelp" class="link-btn" :aria-expanded="reviewHelp ? 'true' : 'false'">${I.info}${t("这些是从哪来的？", "Where do these come from?")}</button>
        </header>
        <div x-show="reviewHelp" class="panel note">
          ${t("<b>日常</b>：每晚整理聊天时拿不准的，等你点头。<b>导入的</b>：从「导入导出」搬进来的，只等你自己点，不走自动审核。<b>本周自动处理</b>：自动审核或助手（通过 MCP 的 memory_review）自己定下的，觉得不对可以撤回。",
            "<b>Daily</b>: things the nightly run wasn’t sure about. <b>Imported</b>: brought in from Import &amp; export; only you decide these. <b>Auto-handled</b>: decided by auto-review or by the assistant itself (via MCP memory_review). Undo any you disagree with.")}
        </div>

        <div class="tabs" role="tablist" :aria-label="L('候选来源', 'Where candidates come from')">
          <button type="button" role="tab" @click="reviewTab = 'daily'" class="tab" :class="reviewTab === 'daily' ? 'is-active' : ''" :aria-selected="reviewTab === 'daily' ? 'true' : 'false'">${t("日常", "Daily")}<span class="count" x-text="candidates.length"></span></button>
          <button type="button" role="tab" @click="openImportReview()" class="tab" :class="reviewTab === 'import' ? 'is-active' : ''" :aria-selected="reviewTab === 'import' ? 'true' : 'false'">${t("导入的", "Imported")}<span class="count" x-show="importPendingCount" x-text="importPendingCount"></span></button>
          <button type="button" role="tab" @click="reviewTab = 'auto'; loadJudgeDecisions()" class="tab" :class="reviewTab === 'auto' ? 'is-active' : ''" :aria-selected="reviewTab === 'auto' ? 'true' : 'false'">${t("本周自动处理", "Auto-handled this week")}<span class="count" x-show="judgeDecisions.length" x-text="judgeDecisions.length"></span></button>
        </div>

        <div x-show="reviewTab === 'daily'" class="flex flex-col gap-4">
          <div class="banner" :class="autoReview === 'clef' ? 'banner-ok' : ''">
            <span x-show="autoReview === 'clef'">${I.check}</span><span x-show="autoReview !== 'clef'">${I.info}</span>
            <span class="min-w-0 flex-1" x-text="autoReview === 'clef' ? L('自动审核已开启：今晚整理后会自动处理剩下的，不必一条条点。', 'Auto-review is on. Whatever’s left gets handled tonight, so there’s no need to go one by one.') : L('自动审核关着，这些等你确认；也可以让助手用 MCP 的 memory_review 自己审。', 'Auto-review is off, so these wait for you. Your assistant can also review them through MCP memory_review.')"></span>
            <button type="button" @click="go('settings')" class="link">${t("改设置", "Change")}</button>
          </div>

          <div x-show="candidates.length" class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-2">
              <label class="check mr-1"><input type="checkbox" :checked="reviewAllSelected()" @change="reviewSelectAll($event.target.checked)"><span x-text="L('全选', 'Select all')"></span></label>
              <button type="button" @click="reviewBulk('approve')" :disabled="!reviewSelectedCount() || reviewBulkBusy" class="btn btn-sm" x-text="L('记住所选', 'Remember selected') + (reviewSelectedCount() ? ' ' + reviewSelectedCount() : '')"></button>
              <button type="button" @click="reviewBulk('discard')" :disabled="!reviewSelectedCount() || reviewBulkBusy" class="btn btn-sm" x-text="L('丢弃所选', 'Discard selected')"></button>
              <span x-show="reviewBulkBusy" class="text-xs muted" x-text="reviewBulkLabel"></span>
            </div>
            <label class="flex items-center gap-2 text-[13px] muted">${t("类型", "Type")}
              <select x-model="reviewType" class="field field-sm">
                <option value="all" x-text="L('全部', 'All')"></option>
                <template x-for="type in reviewTypes()" :key="type"><option :value="type" x-text="typeLabel(type)"></option></template>
              </select>
            </label>
          </div>

          <template x-if="candidates.length === 0">
            <div class="panel empty">${t("没有待审的，都处理好了。", "Nothing to review. You’re all caught up.")}</div>
          </template>
          <div class="flex flex-col gap-3">
            <template x-for="candidate in reviewList()" :key="candidate.id">
              ${CANDIDATE_CARD}
            </template>
          </div>
        </div>

        <div x-show="reviewTab === 'import'" class="flex flex-col gap-4">
          <div class="banner">${I.info}<span class="min-w-0 flex-1">${t("这些不走夜里的自动审核，也不给助手审，等你自己点：记住了才进长期记忆。clef 的分只是参考。", "These skip nightly auto-review and the assistant; only you decide. Remembered ones become long-term memories. clef’s scores are only a hint.")}</span></div>
          <div class="panel panel-pad flex flex-col gap-3">
            <div class="flex flex-wrap gap-2">
              <select x-model="importReview.importId" @change="loadImportCandidates(true)" class="field min-w-0 flex-1" :aria-label="L('哪一次导入', 'Which import')">
                <option value="" x-text="L('全部导入', 'All imports')"></option>
                <template x-for="batch in importReview.batches" :key="batch.id">
                  <option :value="batch.id" x-text="importBatchLabel(batch)"></option>
                </template>
              </select>
              <button type="button" @click="loadImportCandidates(true)" class="btn btn-icon" :aria-label="L('刷新', 'Refresh')">${I.refresh}</button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" @click="importReview.filter = 'all'; loadImportCandidates(true)" class="pill" :class="importReview.filter === 'all' ? 'is-active' : ''">${t("全部", "All")} <span class="count" x-text="importReview.counts.pending"></span></button>
              <button type="button" @click="importReview.filter = 'clef_yes'; loadImportCandidates(true)" class="pill" :class="importReview.filter === 'clef_yes' ? 'is-active' : ''">${t("clef 觉得该记", "clef says keep")} <span class="count" x-text="importReview.counts.clef_yes"></span></button>
              <button type="button" @click="importReview.filter = 'clef_no'; loadImportCandidates(true)" class="pill" :class="importReview.filter === 'clef_no' ? 'is-active' : ''">${t("clef 觉得不用", "clef says skip")} <span class="count" x-text="importReview.counts.clef_no"></span></button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button type="button" @click="bulkImportCandidates('approve', 'clef_yes')" :disabled="importReview.bulk || !importReview.counts.clef_yes" class="btn btn-primary btn-sm">${I.check}<span x-text="L('记住 clef 觉得该记的 ' + importReview.counts.clef_yes + ' 条', 'Remember all ' + importReview.counts.clef_yes + ' clef would keep')"></span></button>
              <button type="button" @click="bulkImportCandidates('discard', 'clef_no')" :disabled="importReview.bulk || !importReview.counts.clef_no" class="btn btn-sm" x-text="L('丢弃 clef 觉得不用的 ' + importReview.counts.clef_no + ' 条', 'Discard all ' + importReview.counts.clef_no + ' clef would skip')"></button>
            </div>
            <p x-show="importReview.bulk" class="text-xs muted" x-text="importReview.bulk ? importReview.bulk.label + ' ' + importReview.bulk.done + ' / ' + importReview.bulk.total + (importReview.bulk.failed ? L('，失败 ', ', failed ') + importReview.bulk.failed : '') : ''"></p>
          </div>

          <template x-if="importReview.items.length === 0">
            <div class="panel empty" x-text="importReview.loading ? L('加载中…', 'Loading…') : L('这里没有待审的导入候选。', 'No imported candidates waiting.')"></div>
          </template>
          <div class="flex flex-col gap-3">
            <template x-for="candidate in importReview.items" :key="candidate.id">
              ${CANDIDATE_CARD}
            </template>
          </div>
          <button type="button" x-show="importReview.more" @click="loadImportCandidates(false)" class="btn self-center" x-text="L('再看 50 条', 'Show 50 more')"></button>
        </div>

        <div x-show="reviewTab === 'auto'" class="flex flex-col gap-3">
          <p class="text-[13px] muted">${t("近 7 天自动审核和助手自己定下的。觉得不对就撤回：记住的收回，放下的补记。", "What auto-review and your assistant decided in the last 7 days. Undo anything you disagree with.")}</p>
          <template x-if="judgeDecisions.length === 0">
            <div class="panel empty">${t("这 7 天没有自动决定。", "No automatic decisions in the last 7 days.")}</div>
          </template>
          <div x-show="judgeDecisions.length" class="panel divide">
            <template x-for="item in judgeDecisions" :key="item.id">
              <div class="flex flex-wrap items-start gap-3 px-[18px] py-3.5">
                <div class="min-w-0 flex-1">
                  <div class="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span class="chip" :class="item.undone ? 'chip-dim' : (item.status === 'approved' ? 'chip-ok' : 'chip-dim')" x-text="judgeDecisionLabel(item)"></span>
                    <span class="chip" :class="typeChipClass(item.type)" x-text="typeLabel(item.type)"></span>
                    <span class="muted" x-text="dreamCandidateSourceLabel(item.source)"></span>
                    <span class="muted" x-text="fmt(item.updated_at)"></span>
                  </div>
                  <p class="whitespace-pre-wrap text-sm leading-7" x-text="item.content"></p>
                  <p x-show="item.reason" class="mt-1 text-[13px] muted" x-text="item.reason"></p>
                </div>
                <button type="button" x-show="item.undoable" @click="undoJudgeDecision(item)" class="btn btn-sm">${I.undo}<span x-text="judgeUndoLabel(item)"></span></button>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- ===== 日记 ===== -->
      <section x-show="savedApiKey.trim() && page === 'diary'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("日记", "Journal")}</h1>
            <p class="sub">${t("每晚整理完写一篇。是印象，细节以记忆库为准。", "One entry after each nightly run. An impression; Memories has the details.")}</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="seg" role="group" :aria-label="L('日记类型', 'Entry type')">
              <button type="button" @click="diaryMode = 'daily'; diaryPick = ''; diaryReading = false" :class="diaryMode === 'daily' ? 'is-active' : ''" :aria-pressed="diaryMode === 'daily' ? 'true' : 'false'" x-text="L('每天', 'Daily')"></button>
              <button type="button" @click="diaryMode = 'weekly'; diaryPick = ''; diaryReading = false" :class="diaryMode === 'weekly' ? 'is-active' : ''" :aria-pressed="diaryMode === 'weekly' ? 'true' : 'false'" x-text="L('每周', 'Weekly')"></button>
            </div>
            <button type="button" @click="loadDiary()" class="btn btn-icon hidden md:inline-flex" :aria-label="L('刷新', 'Refresh')">${I.refresh}</button>
          </div>
        </header>

        <div class="journal" :class="diaryReading ? 'is-reading' : ''">
          <div class="journal-list flex flex-col gap-3">
            <button type="button" x-show="diaryMode === 'daily' && diaryWeeklies.length" @click="diaryMode = 'weekly'; openDiary('weekly:' + diaryWeeklies[0].week)" class="panel dream-stat grid gap-1 px-4 py-3.5 text-left">
              <span class="text-xs muted" x-text="diaryWeeklies.length ? L('最近一周 · ', 'Latest week · ') + diaryWeeklies[0].start_date + ' – ' + diaryWeeklies[0].end_date : ''"></span>
              <span class="font-semibold" x-text="diaryWeeklies.length ? diaryWeeklies[0].title : ''"></span>
              <span class="link">${t("读周记 →", "Read the weekly →")}</span>
            </button>
            <nav class="panel divide overflow-hidden" :aria-label="L('日记列表', 'Entries')">
              <template x-if="diaryListItems().length === 0">
                <div class="empty" x-text="diaryMode === 'daily' ? L('还没有日记。', 'No journal entries yet.') : L('还没有周记。', 'No weekly summaries yet.')"></div>
              </template>
              <template x-for="item in diaryListItems()" :key="item.key">
                <button type="button" @click="openDiary(item.key)" class="entry-btn" :class="diaryCurrentKey() === item.key ? 'is-active' : ''" :aria-current="diaryCurrentKey() === item.key ? 'true' : null">
                  <span class="text-xs muted" x-text="item.when"></span>
                  <span class="truncate font-semibold" x-text="item.title"></span>
                  <span class="truncate text-[13px] muted" x-text="item.excerpt"></span>
                </button>
              </template>
            </nav>
          </div>

          <article class="panel reading">
            <button type="button" @click="diaryReading = false" class="link-btn journal-back mb-4" x-text="L('← 日记列表', '← All entries')"></button>
            <template x-if="!diaryCurrent()">
              <p class="muted">${t("选一篇来读。", "Pick an entry to read.")}</p>
            </template>
            <template x-for="entry in (diaryCurrent() ? [diaryCurrent()] : [])" :key="diaryCurrentKey()">
              <div>
                <div class="mb-5" style="border-bottom: 1px solid var(--div); padding-bottom: 16px">
                  <div class="text-[13px] muted" x-text="entry.week ? entry.week + ' · ' + entry.start_date + ' – ' + entry.end_date : longDayLabel(entry.date)"></div>
                  <h2 class="mt-1 text-[22px] font-semibold leading-snug" x-text="entry.title"></h2>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <span x-show="entry.week" class="chip chip-violet" x-text="L(entry.source_days + ' 天汇入', 'From ' + entry.source_days + ' days')"></span>
                    <span x-show="!entry.week && entry.source_message_ids && entry.source_message_ids.length" class="chip" x-text="L('基于 ' + (entry.source_message_ids || []).length + ' 条原文', 'From ' + (entry.source_message_ids || []).length + ' messages')"></span>
                    <span x-show="!entry.week && entry.sources_kept != null" class="chip" :class="entry.sources_kept ? 'chip-ok' : 'chip-dim'" x-text="entry.sources_kept ? L('原文还在，可以回看', 'Originals still kept') : L('原文已过保留期，只剩这篇', 'Originals expired; only this entry remains')"></span>
                  </div>
                </div>
                <template x-for="(para, index) in paragraphs(entry.summary)" :key="index"><p x-text="para"></p></template>
                <div x-show="!entry.week && entry.sources_kept !== 0" class="mt-6 flex flex-wrap items-center gap-3" style="border-top: 1px solid var(--div); padding-top: 16px">
                  <button type="button" x-show="entry.sources_kept !== 0" @click="rewriteDiary(entry)" :disabled="diaryRewriting !== ''" class="btn btn-sm" x-text="diaryRewriting === entry.date ? L('重写中，请保持页面打开…', 'Rewriting — keep this page open…') : L('用原文重写这篇', 'Rewrite from the originals')"></button>
                  <span x-show="entry.sources_kept !== 0" class="text-xs muted">${t("会覆盖现在的内容。", "Replaces the current text.")}</span>
                </div>
              </div>
            </template>
          </article>
        </div>
      </section>

      <!-- ===== 记忆库：重要 + 珍贵 / 黑话 / 小本本 / 世界知识 ===== -->
      <section x-show="savedApiKey.trim() && page === 'memory'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("记忆库", "Memories")}</h1>
            <p class="sub">${t("助手会在对话里想起这些。", "What your assistant can recall in conversation.")}</p>
          </div>
          <div x-show="moreView === 'important'" class="flex flex-wrap gap-2">
            <label class="search w-[260px] max-w-full">${I.search}<span class="sr-only" x-text="L('搜索记忆', 'Search memories')"></span><input type="search" x-model="memoryQuery" :placeholder="L('搜索记忆', 'Search memories')"></label>
            <button type="button" @click="openMemoryCreate()" class="btn btn-primary">${I.plus}${t("新建", "New")}</button>
          </div>
        </header>

        <div class="tabs" role="tablist" :aria-label="L('记忆分类', 'Memory sections')">
          <button type="button" role="tab" @click="openMemoryTab('important')" class="tab" :class="moreView === 'important' ? 'is-active' : ''" :aria-selected="moreView === 'important' ? 'true' : 'false'">${t("重要", "Core")}<span class="count" x-text="typeCount('all')"></span></button>
          <template x-for="item in moreNav" :key="item.id">
            <button type="button" role="tab" @click="openMemoryTab(item.id)" class="tab" :class="moreView === item.id ? 'is-active' : ''" :aria-selected="moreView === item.id ? 'true' : 'false'"><span x-text="L(item.label, item.labelEn)"></span><span class="count" x-text="memoryTabCount(item.id)"></span></button>
          </template>
        </div>

        <div x-show="moreView === 'important'" class="flex flex-col gap-4">
          <div class="flex flex-wrap gap-2" role="group" :aria-label="L('按类型筛选', 'Filter by type')">
            <template x-for="type in memoryTypes" :key="type">
              <button type="button" @click="memoryType = type; loadMemories()" class="pill" :class="memoryType === type ? 'is-active' : ''" :aria-pressed="memoryType === type ? 'true' : 'false'"><span x-text="memoryTypeLabel(type)"></span> <span class="count" x-show="type !== 'all'" x-text="typeCount(type)"></span></button>
            </template>
          </div>

          <div x-show="memoryCreateOpen" class="panel panel-pad grid gap-3">
            <div class="flex items-center justify-between gap-3">
              <h2 class="h2">${t("新建一条记忆", "New memory")}</h2>
              <button type="button" @click="memoryCreateOpen = false" class="btn btn-icon btn-sm btn-icon-sm" :aria-label="L('关闭', 'Close')">${I.x}</button>
            </div>
            <label class="block"><span class="label">${t("内容", "Content")}</span>
              <textarea x-model="memoryDraft.content" class="field min-h-24" :placeholder="L('一句稳定、以后用得上的事', 'One lasting fact worth recalling later')"></textarea>
            </label>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="block"><span class="label">${t("类型", "Type")}</span>
                <select x-model="memoryDraft.type" class="field">
                  <template x-for="type in canonicalMemoryTypes" :key="type"><option :value="type" x-text="typeLabel(type)"></option></template>
                </select>
              </label>
              <label class="block"><span class="label">${t("重要性", "Importance")} <span x-text="memoryDraft.importance.toFixed(2)"></span></span>
                <input type="range" min="0" max="1" step="0.05" x-model.number="memoryDraft.importance" class="w-full">
              </label>
            </div>
            <details>
              <summary class="text-[13px] muted">${t("技术信息", "Details")}</summary>
              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <label class="block"><span class="label">${t("fact_key（留空按内容自动生成）", "fact_key (blank: made from the content)")}</span>
                  <input x-model="memoryDraft.fact_key" class="field mono" placeholder="preference:answer-style">
                </label>
                <label class="block"><span class="label">${t("把握", "Confidence")} <span x-text="memoryDraft.confidence.toFixed(2)"></span></span>
                  <input type="range" min="0" max="1" step="0.05" x-model.number="memoryDraft.confidence" class="w-full">
                </label>
              </div>
            </details>
            <div class="flex justify-end gap-2">
              <button type="button" @click="memoryCreateOpen = false" class="btn" x-text="L('取消', 'Cancel')"></button>
              <button type="button" @click="createMemory()" :disabled="saving" class="btn btn-primary" x-text="L('保存', 'Save')"></button>
            </div>
          </div>

          <section class="panel overflow-hidden" :aria-label="L('记忆列表', 'Memory list')">
            <div class="hidden flex-wrap items-center gap-4 px-[18px] py-2.5 text-xs md:flex" style="background: var(--soft); color: var(--t3)">
              <span class="flex-[1_1_320px]">${t("内容", "Memory")}</span>
              <span class="mem-col">${t("类型", "Type")}</span>
              <span class="mem-col">${t("重要性", "Importance")}</span>
              <span class="mem-col">${t("更新", "Updated")}</span>
            </div>
            <div class="divide">
              <template x-if="filteredMemories().length === 0">
                <div class="empty" x-text="memoryQuery.trim() ? L('没有找到相关的记忆。', 'No memories match.') : L('这一类还没有记忆。', 'Nothing in this category yet.')"></div>
              </template>
              <template x-for="memory in filteredMemories()" :key="memory.id">
                <div :style="memory.open ? 'background: var(--soft)' : ''">
                  <button type="button" @click="memory.open = !memory.open" class="mem-head" :aria-expanded="memory.open ? 'true' : 'false'">
                    <span class="mem-text" :class="memory.open ? '' : 'line-clamp-2'" x-text="memory.content"></span>
                    <span class="mem-col"><span class="chip" :class="typeChipClass(memory.type)" x-text="typeLabel(memory.type)"></span></span>
                    <span class="mem-col" x-text="importanceLabel(memory.importance)"></span>
                    <span class="mem-col" x-text="shortDate(memory.updated_at || memory.created_at)"></span>
                  </button>
                  <div x-show="memory.open" class="mem-detail">
                    <template x-if="memory.editing">
                      <textarea x-model="memory.draft.content" class="field min-h-32" :aria-label="L('内容', 'Content')"></textarea>
                    </template>
                    <div class="facts">
                      <div><span class="k">${t("重要性", "Importance")}</span><span x-text="importanceLabel(memory.importance)"></span></div>
                      <div><span class="k">${t("把握", "Confidence")}</span><span x-text="pct(memory.confidence)"></span></div>
                      <div x-show="memory.supersedes_id"><span class="k">${t("取代了", "Replaced")}</span><span class="mono text-xs" x-text="memory.supersedes_id"></span></div>
                      <div x-show="memory.superseded_by_id"><span class="k">${t("被它取代", "Replaced by")}</span><span class="mono text-xs" x-text="memory.superseded_by_id"></span></div>
                      <div><span class="k">${t("历史", "History")}</span><button type="button" @click="toggleMemoryRevisions(memory)" class="link text-left" x-text="memory.revOpen ? L('收起旧版', 'Hide versions') : L('看旧版', 'See versions')"></button></div>
                    </div>
                    <div x-show="memory.revOpen" class="flex flex-col gap-2 rounded-[10px] p-3" style="background: var(--soft)">
                      <p class="text-xs muted">${t("原地改写之前的样子都在这里（最多 20 版）。恢复也是一次改写，现在这版会先存进来。", "Earlier versions from in-place edits (up to 20). Restoring is also an edit; the current version is saved first.")}</p>
                      <p x-show="!memory.revisions" class="text-xs muted" x-text="L('加载中…', 'Loading…')"></p>
                      <p x-show="memory.revisions && memory.revisions.length === 0" class="text-xs muted" x-text="L('没改写过。', 'Never edited.')"></p>
                      <template x-for="rev in (memory.revisions || [])" :key="rev.id">
                        <div class="pt-2 text-[13px] leading-6" style="border-top: 1px solid var(--div)">
                          <div class="flex flex-wrap items-center gap-2 text-xs muted">
                            <span x-text="L('写于 ', 'Written ') + fmt(rev.written_at || rev.created_at)"></span>
                            <span x-text="revisionReasonLabel(rev)"></span>
                            <button type="button" @click="restoreMemoryRevision(memory, rev)" class="btn btn-sm ml-auto" x-text="L('恢复这版', 'Restore this')"></button>
                          </div>
                          <p class="whitespace-pre-wrap" x-text="rev.content"></p>
                        </div>
                      </template>
                    </div>
                    <details>
                      <summary class="text-[13px] muted">${t("技术信息", "Details")}</summary>
                      <div class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                        <span class="muted">key</span><span class="mono break-all" x-text="memory.fact_key || '—'"></span>
                        <span class="muted">id</span><span class="mono break-all" x-text="memory.id"></span>
                        <span class="muted" x-show="(memory.tags || []).length">tags</span><span x-show="(memory.tags || []).length" x-text="(memory.tags || []).join(', ')"></span>
                      </div>
                    </details>
                    <div x-show="memory.mergeOpen" class="flex flex-wrap gap-2">
                      <input x-model="memory.target_id" class="field min-w-0 flex-1" :placeholder="L('并进哪一条：填它的 id', 'Merge into: its id')">
                      <button type="button" @click="mergeDuplicate(memory)" class="btn btn-sm" x-text="L('合并', 'Merge')"></button>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" @click="toggleMemoryEdit(memory)" class="btn btn-sm" x-text="memory.editing ? L('取消', 'Cancel') : L('编辑', 'Edit')"></button>
                      <button type="button" x-show="memory.editing" @click="saveMemory(memory)" class="btn btn-primary btn-sm" x-text="L('保存', 'Save')"></button>
                      <button type="button" @click="memory.mergeOpen = !memory.mergeOpen" class="btn btn-sm" x-text="L('和别的合并', 'Merge with another')"></button>
                      <button type="button" @click="deleteMemory(memory)" class="btn btn-sm btn-danger ml-auto" x-text="L('移除', 'Remove')"></button>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            <div x-show="memories.length" class="px-[18px] py-3 text-xs muted" style="border-top: 1px solid var(--div)" x-text="memoryFooter()"></div>
          </section>
        </div>

        <div x-show="moreView === 'precious'" class="flex flex-col gap-3">
          <p class="text-[13px] muted">${t("在首页点 ♥ 收下的原话，原样保留，不会被整理改写。", "Exact lines you saved with ♥ on Home. Kept word for word; the nightly run never rewrites them.")}</p>
          <template x-if="precious.length === 0"><div class="panel empty">${t("还没有珍贵。", "No keepsakes yet.")}</div></template>
          <div x-show="precious.length" class="panel divide">
            <template x-for="item in precious" :key="item.id">
              <div class="flex items-start gap-3 px-[18px] py-3.5">
                <div class="min-w-0 flex-1">
                  <div class="mb-1 text-xs muted" x-text="fmt(item.created_at)"></div>
                  <p class="whitespace-pre-wrap text-sm leading-7" x-text="item.content"></p>
                </div>
                <button type="button" @click="unpinPrecious(item)" class="heart is-on" :aria-label="L('取消珍贵', 'Remove from keepsakes')" :title="L('取消珍贵', 'Remove from keepsakes')">${HEART_FILLED}</button>
              </div>
            </template>
          </div>
        </div>

        <div x-show="moreView === 'glossary'" class="flex flex-col gap-3">
          <p class="text-[13px] muted">${t("昵称和只有你们懂的梗。聊天里出现时，助手会照这里理解。", "Nicknames and in-jokes. When they come up, your assistant reads them this way.")}</p>
          <div class="panel panel-pad grid gap-3">
            <div class="grid gap-3 md:grid-cols-[200px_1fr]">
              <input x-model="glossaryDraft.term" class="field" :placeholder="L('词，比如 小土豆', 'Word, e.g. spud')" :aria-label="L('词', 'Word')">
              <input x-model="glossaryDraft.definition" class="field" :placeholder="L('意思', 'What it means')" :aria-label="L('意思', 'Meaning')">
            </div>
            <div class="flex flex-wrap gap-3">
              <input x-model="glossaryDraft.aliasesText" class="field min-w-0 flex-1" :placeholder="L('别的叫法，用逗号隔开（可不填）', 'Other spellings, comma-separated (optional)')" :aria-label="L('别的叫法', 'Other spellings')">
              <button type="button" @click="saveGlossary()" :disabled="!glossaryDraft.term.trim()" class="btn btn-primary" x-text="L('保存', 'Save')"></button>
            </div>
          </div>
          <template x-if="glossary.length === 0"><div class="panel empty">${t("还没有黑话。", "No words yet.")}</div></template>
          <div x-show="glossary.length" class="panel divide">
            <template x-for="item in glossary" :key="item.id">
              <div class="flex items-start gap-3 px-[18px] py-3.5">
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-baseline gap-2"><span class="font-semibold" x-text="item.term"></span><span class="text-xs muted" x-text="jsonList(item.aliases).join(' / ')"></span></div>
                  <p class="mt-1 text-sm leading-7" style="color: var(--t2)" x-text="item.definition"></p>
                </div>
                <button type="button" @click="deleteGlossary(item)" class="icon-btn" :aria-label="L('删除', 'Delete')" :title="L('删除', 'Delete')">${I.trash}</button>
              </div>
            </template>
          </div>
        </div>

        <div x-show="moreView === 'notebook'" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <p class="min-w-0 flex-1 text-[13px] muted">${t("助手按页名读写的笔记，比如备考进度。不会被自动想起，夜里不改写，也不过期。每个空间最多 50 页，每页 2 万字。", "Notes your assistant reads and writes by page name, like study progress. Never recalled on their own, never rewritten at night, never expire. Up to 50 pages per space, 20,000 characters each.")}</p>
            <div class="flex gap-2">
              <button type="button" @click="newNotebookPage()" class="btn btn-primary btn-sm">${I.plus}${t("新建一页", "New page")}</button>
              <button type="button" @click="clearNotebook()" :disabled="notebookPages.length === 0" class="btn btn-sm btn-danger" x-text="L('全部清空', 'Clear all')"></button>
            </div>
          </div>
          <template x-if="notebookDraft">
            <div id="notebook-editor" class="panel panel-pad grid scroll-mt-6 gap-3">
              <input x-model="notebookDraft.name" maxlength="60" class="field" :placeholder="L('页名，比如 经济师进度', 'Page name, e.g. exam-progress')" :aria-label="L('页名', 'Page name')">
              <textarea x-model="notebookDraft.content" class="field min-h-64" :placeholder="L('这一页记什么', 'What goes on this page')" :aria-label="L('内容', 'Content')"></textarea>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs muted" x-text="notebookDraftLabel()"></span>
                <button type="button" @click="saveNotebookPage()" :disabled="saving" class="btn btn-primary btn-sm ml-auto" x-text="L('保存', 'Save')"></button>
                <button type="button" x-show="notebookDraft.id" @click="deleteNotebookPage()" class="btn btn-sm btn-danger" x-text="L('删除这页', 'Delete page')"></button>
                <button type="button" @click="notebookDraft = null" class="btn btn-sm" x-text="L('收起', 'Close')"></button>
              </div>
            </div>
          </template>
          <template x-if="notebookLoaded && notebookPages.length === 0 && !notebookDraft"><div class="panel empty">${t("小本本还是空的。", "The notebook is empty.")}</div></template>
          <div x-show="notebookPages.length" class="panel divide overflow-hidden">
            <template x-for="item in notebookPages" :key="item.id">
              <button type="button" @click="openNotebookPage(item)" class="entry-btn" :class="notebookDraft && notebookDraft.id === item.id ? 'is-active' : ''">
                <span class="flex items-center gap-3">
                  <span class="muted">${I.file}</span>
                  <span class="min-w-0 flex-1 truncate font-semibold" x-text="item.name"></span>
                  <span class="flex-none text-xs muted" x-text="fmt(item.updated_at) + ' · ' + L(item.size + ' 字', item.size + ' chars')"></span>
                </span>
              </button>
            </template>
          </div>
        </div>

        <div x-show="moreView === 'world'" class="flex flex-col gap-3">
          <p class="text-[13px] muted">${t("和你本人无关的常识、资料，平时不进对话，问到时才查。", "General knowledge and reference material, not about you. Only looked up when asked.")}</p>
          <div class="panel panel-pad grid gap-3">
            <div class="flex flex-wrap gap-2">
              <label class="search min-w-0 flex-1">${I.search}<input x-model="worldQuery" @keydown.enter.prevent="searchWorld()" type="search" :placeholder="L('搜索世界知识', 'Search world facts')" :aria-label="L('搜索世界知识', 'Search world facts')"></label>
              <button type="button" @click="searchWorld()" class="btn btn-primary" x-text="L('搜索', 'Search')"></button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs muted">
              <span x-text="L('已选 ', 'Selected ') + selectedWorldCount() + ' / ' + worldItems.length"></span>
              <button type="button" @click="selectAllWorldItems()" class="btn btn-sm" x-text="L('全选当前', 'Select all shown')"></button>
              <button type="button" @click="clearWorldSelection()" class="btn btn-sm" x-text="L('清空选择', 'Clear selection')"></button>
              <button type="button" @click="deleteSelectedWorldItems()" :disabled="selectedWorldCount() === 0 || saving" class="btn btn-sm btn-danger" x-text="L('删除选中', 'Delete selected')"></button>
            </div>
          </div>
          <template x-if="worldItems.length === 0"><div class="panel empty">${t("这里还没有条目。", "Nothing here yet.")}</div></template>
          <div x-show="worldItems.length" class="panel divide">
            <template x-for="item in worldItems" :key="worldItemKey(item)">
              <div class="flex items-start gap-3 px-[18px] py-3.5">
                <input type="checkbox" class="mt-1" :checked="isWorldSelected(item)" @change="toggleWorldItem(item)" :aria-label="L('选择这条', 'Select this one')">
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex flex-wrap gap-2 text-xs muted"><span x-text="item.type || 'longtail'"></span><span x-text="item.source || ''"></span></div>
                  <p class="whitespace-pre-wrap text-sm leading-7" x-text="item.content"></p>
                </div>
                <button type="button" @click="deleteWorldMemory(item)" class="icon-btn" :aria-label="L('删除', 'Delete')" :title="L('删除', 'Delete')">${I.trash}</button>
              </div>
            </template>
          </div>
        </div>
      </section>

      <!-- ===== 夜间整理 ===== -->
      <section x-show="savedApiKey.trim() && page === 'dream'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("夜间整理", "Nightly")}</h1>
            <p class="sub">${t("每晚把当天的对话整理成记忆和日记，平时不用管。", "Every night, the day’s chats become memories and a journal entry. Usually nothing to do here.")}</p>
          </div>
          <button type="button" @click="refreshDream()" class="btn btn-icon hidden md:inline-flex" :aria-label="L('刷新', 'Refresh')" :title="L('刷新', 'Refresh')">${I.refresh}</button>
        </header>

        <div class="stats">
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("最近一次", "Last run")}</span>
            <span class="flex items-center gap-2 text-[22px] font-semibold leading-[42px]" :style="'color: ' + runColor(dreamLatestRun())">
              <span x-show="dreamLatestRun() && dreamLatestRun().status === 'ok' && !dreamLatestRun().stale">${I.checkBig}</span>
              <span class="truncate" x-text="dreamLatestLabel()"></span>
            </span>
            <span class="stat-sub truncate" x-text="dreamLatestSub()"></span>
          </div>
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("近 7 晚", "Last 7 nights")}</span>
            <span class="stat-num"><span x-text="dreamOkCount()"></span><span class="text-sm font-medium muted" x-text="' / ' + dreamFinishedCount() + L(' 成功', ' succeeded')"></span></span>
            <button type="button" x-show="dreamFirstFailed()" @click="prepareRerun(dreamFirstFailed())" class="link self-start" x-text="dreamFirstFailed() ? L(dayLabel(dreamFirstFailed().date_label) + ' 失败了，去重跑 →', dayLabel(dreamFirstFailed().date_label) + ' failed. Re-run →') : ''"></button>
          </div>
          <div class="panel dream-stat stat">
            <span class="stat-label">${t("近 7 天整理了", "Processed this week")}</span>
            <span class="stat-num"><span x-text="dreamProcessedTotal()"></span><span class="text-sm font-medium muted" x-text="L(' 条消息', ' messages')"></span></span>
            <span class="stat-sub" x-text="dreamRuns.length ? L('平均每晚 ', 'About ') + Math.round(dreamProcessedTotal() / Math.max(dreamRuns.length, 1)) + L(' 条', ' a night') : ''"></span>
          </div>
        </div>

        <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <div class="flex flex-col gap-5">
            <section class="panel">
              <div class="panel-head">
                <h2 class="h2">${t("每天的对话量", "Chats per day")}</h2>
                <span class="text-xs muted" x-text="dreamStatus && dreamStatus.time_zone ? L('按 ', 'Days follow ') + dreamStatus.time_zone + L(' 分天', '') : ''"></span>
              </div>
              <div class="flex flex-col gap-2.5 px-[18px] py-4">
                <template x-if="dreamDayBars().length === 0"><p class="text-[13px] muted">${t("还没有消息记录。", "No messages yet.")}</p></template>
                <template x-for="day in dreamDayBars()" :key="day.date">
                  <div class="day-bar">
                    <span class="w-[72px] flex-none muted" x-text="dayLabel(day.date, true)"></span>
                    <span class="raw-bar-track" aria-hidden="true"><span class="raw-bar-fill block" :class="day.done ? 'is-done' : ''" :style="'width:' + day.widthPct + '%'"></span></span>
                    <span class="w-10 flex-none text-right tabular-nums" :style="day.pending ? 'color: var(--ct)' : ''" x-text="day.raw"></span>
                    <span class="chip hidden flex-none sm:inline-flex" :class="day.done ? 'chip-ok' : (day.pending ? 'chip-warn' : 'chip-dim')" x-text="day.stateLabel"></span>
                  </div>
                </template>
              </div>
            </section>

            <section id="dream-run" class="panel panel-pad flex flex-col gap-4">
              <div>
                <h2 class="h2">${t("手动整理一晚", "Run a night by hand")}</h2>
                <p class="mt-1 text-[13px] muted">${t("补跑某一晚，或者先看看会整理出什么。", "Catch up a missed night, or preview what it would produce.")}</p>
              </div>
              <div class="flex flex-wrap items-end gap-3">
                <label class="block"><span class="label">${t("哪一晚", "Night of")}</span><input type="date" x-model="dreamDate" class="field w-auto"></label>
                <label class="check"><input type="checkbox" x-model="dreamDryRun"><span>${t("只预览，不写入", "Preview only, don’t save")}</span></label>
                <label class="check"><input type="checkbox" x-model="dreamForce"><span>${t("已经整理过的也重来", "Redo if already processed")}</span></label>
                <button type="button" @click="triggerDream()" :disabled="dreamTriggering || (!dreamDryRun && dreamActiveRun)" class="btn btn-primary ml-auto">${I.moon}<span x-text="dreamTriggering ? (dreamDryRun ? L('预览中，请保持页面打开…', 'Previewing — keep this page open…') : L('提交中…', 'Submitting…')) : (dreamDryRun ? L('预览', 'Preview') : L('开始', 'Start'))"></span></button>
              </div>
              <p class="text-xs muted">${t("预览时请保持页面打开，结果不写入。关掉预览才是真跑，提交后可以关页。", "Keep this page open while a preview runs; nothing is saved. Untick preview to run for real; once it’s queued you can close the page.")}</p>

              <p x-show="dreamStatusError" class="banner banner-warn" x-text="dreamStatusError"></p>
              <div x-show="dreamActiveRun" class="banner" :class="dreamActiveRun && dreamActiveRun.stale ? 'banner-warn' : ''">
                <div class="min-w-0 flex-1">
                  <div x-text="dreamActiveRun && (L('任务 ', 'Run ') + dreamActiveRun.id + ' · ' + dreamStatusLabel(dreamActiveRun.status, dreamActiveRun.stale))"></div>
                  <p class="mt-1 text-xs" x-show="dreamActiveRun && dreamActiveRun.stale">${t("任务可能已经中断，完成状态还没确认。不会自动重跑，勾了「已经整理过的也重来」也盖不过它，请先核查（比如看 Worker 日志）。", "This run may have stopped, and whether it finished isn’t confirmed. It won’t re-run on its own, and “Redo” can’t override it. Check first (for example in the Worker logs).")}</p>
                </div>
                <button type="button" x-show="dreamActiveRun && dreamActiveRun.stale" @click="resolveDreamRun()" :disabled="dreamResolving" class="btn btn-sm btn-warn"><span x-text="dreamResolving ? L('标记中…', 'Marking…') : L('核查后标记为已中断', 'Checked — mark as stopped')"></span></button>
              </div>

              <div x-show="dreamRunResult" class="flex flex-col gap-3">
                <template x-if="dreamRunResult && dreamRunResult.run_id">
                  <div class="banner" x-text="L('任务 ', 'Run ') + dreamRunResult.run_id + ' · ' + dreamStatusLabel(dreamRunResult.status, dreamRunResult.stale)"></div>
                </template>
                <template x-if="dreamRunResult && dreamRunResult.result && !dreamRunResult.result.ran">
                  <div class="banner" x-text="L('这一晚没有整理：', 'Nothing was run for this night: ') + dreamReasonLabel(dreamRunResult.result.reason)"></div>
                </template>
                <template x-if="dreamRunResult && !dreamRunResult.dry_run && dreamRunResult.result && dreamRunResult.result.ran">
                  <div class="banner banner-ok"><span class="font-semibold">${t("这一晚整理完了。", "This night is done.")}</span> <span x-text="dreamRunStatsLine()"></span></div>
                </template>
                <template x-if="dreamRunResult && dreamRunResult.dry_run && dreamRunResult.result && dreamRunResult.result.ran">
                  <div class="flex flex-col gap-3 rounded-[12px] p-4" style="background: var(--soft)">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-semibold" x-text="L('预览 · ', 'Preview · ') + dayLabel(dreamDate || dreamAnchorDate())"></span>
                      <span class="chip chip-ok" x-text="L('新增 ', '') + dreamProposalList('memories_to_add').length + L('', ' new')"></span>
                      <span class="chip chip-warn" x-text="L('更新 ', '') + dreamProposalList('memories_to_update').length + L('', ' updated')"></span>
                      <span class="chip chip-err" x-text="L('移除 ', '') + dreamProposalList('memories_to_delete').length + L('', ' removed')"></span>
                    </div>
                    <div x-show="dreamProposal() && (dreamProposal().title || dreamProposal().summary)">
                      <div class="font-semibold" x-text="dreamProposal() && (dreamProposal().title || '')"></div>
                      <p class="mt-1 whitespace-pre-wrap text-[13px] leading-6" style="color: var(--t2)" x-text="dreamProposal() && (dreamProposal().summary || '')"></p>
                    </div>
                    <template x-if="dreamExtracted().length === 0"><p class="text-[13px] muted">${t("这一晚没有找到要记的。", "Nothing worth remembering from this night.")}</p></template>
                    <template x-for="(mem, idx) in dreamExtracted()" :key="idx">
                      <div class="flex items-start gap-2.5">
                        <span class="chip" :class="typeChipClass(mem.type)" x-text="typeLabel(mem.type)"></span>
                        <span class="min-w-0 flex-1 text-sm leading-6" x-text="mem.content"></span>
                      </div>
                    </template>
                    <details>
                      <summary class="text-xs muted">${t("技术细节", "Technical details")}</summary>
                      <div class="mt-2 flex flex-col gap-2">
                        <template x-if="dreamRoutingGroups().length === 0"><p class="text-xs muted">${t("没有路由项。", "No routing items.")}</p></template>
                        <template x-for="group in dreamRoutingGroups()" :key="group.key">
                          <div>
                            <div class="mb-1 flex items-center gap-2 text-xs"><span class="chip chip-violet" x-text="group.label"></span><span class="muted" x-text="group.items.length"></span></div>
                            <template x-for="(item, i) in group.items" :key="i">
                              <div class="flex items-start gap-2 text-xs leading-6"><span class="chip chip-dim" x-text="dreamRoutingKindLabel(item.kind)"></span><span class="min-w-0 flex-1" x-text="item.content || item.target_id || item.fact_key || '—'"></span></div>
                            </template>
                          </div>
                        </template>
                      </div>
                    </details>
                  </div>
                </template>
              </div>
            </section>
          </div>

          <section class="panel panel-pad">
            <h2 class="h2 mb-4">${t("最近 7 晚", "Last 7 nights")}</h2>
            <template x-if="dreamRuns.length === 0"><p class="text-[13px] muted">${t("近 7 天还没有整理记录。", "No runs in the last 7 days.")}</p></template>
            <div class="dream-rail flex flex-col gap-4">
              <template x-for="run in dreamRuns" :key="run.id">
                <div class="dream-rail-item" :class="dreamRailClass(run.stale ? 'stale' : run.status)">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-semibold" x-text="dayLabel(run.date_label, true)"></span>
                    <span class="chip" :class="dreamStatusChipClass(run.status)">
                      <span x-show="run.status === 'running' && !run.stale" class="breathe inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
                      <span x-text="dreamStatusLabel(run.status, run.stale)"></span>
                    </span>
                    <span class="text-xs muted" x-text="dreamTriggerLabel(run.trigger) + ' · ' + dreamDuration(run)"></span>
                  </div>
                  <div class="mt-0.5 text-xs muted" x-text="(run.model || L('模型未知', 'Unknown model')) + ' · ' + L((run.processed_messages == null ? '—' : run.processed_messages) + ' 条消息', (run.processed_messages == null ? '—' : run.processed_messages) + ' messages')"></div>
                  <template x-if="dreamRunNote(run)">
                    <div class="mt-1.5">
                      <p class="text-xs leading-5" style="color: var(--t2)" :class="isDreamExpanded(run.id) ? '' : 'line-clamp-2'" x-text="dreamRunNote(run)"></p>
                      <button type="button" x-show="dreamRunNote(run).length > 80" @click="toggleDreamExpand(run.id)" class="link-btn" x-text="isDreamExpanded(run.id) ? L('收起', 'Show less') : L('展开', 'Show more')"></button>
                    </div>
                  </template>
                  <button type="button" x-show="run.status === 'error' && !run.stale" @click="prepareRerun(run)" class="btn btn-sm mt-2" x-text="L('重跑这一晚', 'Re-run this night')"></button>
                </div>
              </template>
            </div>
          </section>
        </div>

        <section class="panel">
          <div class="panel-head pb-1">
            <div>
              <h2 class="h2">${t("某一晚的收成", "What a night produced")}</h2>
              <p class="mt-1 text-[13px] muted">${t("那晚新记住了什么，哪些淡出了。", "What was remembered that night, and what faded.")}</p>
            </div>
            <label class="flex items-center gap-2 text-[13px] muted"><span>${t("日期", "Date")}</span><input type="date" x-model="dreamHarvestDate" @change="loadDreamHarvest()" class="field field-sm"></label>
          </div>
          <div x-show="dreamHarvestLoading" class="px-[18px] py-4 text-[13px] muted" x-text="L('加载中…', 'Loading…')"></div>
          <div x-show="!dreamHarvest && !dreamHarvestLoading" class="px-[18px] py-4 text-[13px] muted">${t("选一个日期看看。", "Pick a date.")}</div>
          <div x-show="dreamHarvest" class="grid gap-3 p-[18px] md:grid-cols-3">
            <div class="rounded-[12px] p-3.5" style="background: var(--soft)">
              <button type="button" @click="harvestOpen.new = !harvestOpen.new" class="flex w-full items-center gap-2 text-left" :aria-expanded="harvestOpen.new ? 'true' : 'false'">
                <span class="harvest-dot" aria-hidden="true"></span><span class="font-semibold">${t("新记住", "Newly remembered")}</span>
                <span class="text-xs muted" x-text="dreamHarvestCreated().length"></span>
                <span class="chev ml-auto" :class="harvestOpen.new ? 'is-open' : ''">${I.chevron}</span>
              </button>
              <div x-show="harvestOpen.new" class="mt-3 flex flex-col gap-2.5">
                <template x-if="dreamHarvestCreated().length === 0"><p class="text-xs muted">${t("这一晚没有新记住的。", "Nothing new that night.")}</p></template>
                <template x-for="item in dreamHarvestCreated()" :key="item.id">
                  <div class="flex items-start gap-2"><span class="chip" :class="typeChipClass(item.type)" x-text="typeLabel(item.type)"></span><span class="min-w-0 flex-1 text-[13px] leading-6" x-text="item.content"></span></div>
                </template>
              </div>
            </div>
            <div class="rounded-[12px] p-3.5" style="background: var(--soft)">
              <button type="button" @click="harvestOpen.dim = !harvestOpen.dim" class="flex w-full items-center gap-2 text-left" :aria-expanded="harvestOpen.dim ? 'true' : 'false'">
                <span class="dot" aria-hidden="true"></span><span class="font-semibold">${t("淡出", "Faded")}</span>
                <span class="text-xs muted" x-text="dreamHarvestDormant().length"></span>
                <span class="chev ml-auto" :class="harvestOpen.dim ? 'is-open' : ''">${I.chevron}</span>
              </button>
              <div x-show="harvestOpen.dim" class="mt-3 flex flex-col gap-2.5">
                <template x-if="dreamHarvestDormant().length === 0"><p class="text-xs muted">${t("这一晚没有淡出的。", "Nothing faded that night.")}</p></template>
                <template x-for="item in dreamHarvestDormant()" :key="item.id">
                  <div class="text-[13px] leading-6">
                    <div class="flex flex-wrap items-center gap-2 text-xs"><span class="chip chip-dim" x-text="dreamDormantLabel(item.status)"></span><span class="chip" :class="typeChipClass(item.type)" x-text="typeLabel(item.type)"></span></div>
                    <p class="mt-1 muted" x-text="item.content"></p>
                    <p x-show="item.superseded_by" class="text-[11px] muted"><span x-text="L('接替它的：', 'Replaced by: ')"></span><span class="mono" x-text="item.superseded_by"></span></p>
                  </div>
                </template>
              </div>
            </div>
            <div class="rounded-[12px] p-3.5" style="background: var(--soft)">
              <button type="button" @click="harvestOpen.judged = !harvestOpen.judged" class="flex w-full items-center gap-2 text-left" :aria-expanded="harvestOpen.judged ? 'true' : 'false'">
                <span class="dot" style="background: var(--vline)" aria-hidden="true"></span><span class="font-semibold">${t("审核结果", "Review decisions")}</span>
                <span class="text-xs muted" x-text="dreamHarvestCandidates().length"></span>
                <span class="chev ml-auto" :class="harvestOpen.judged ? 'is-open' : ''">${I.chevron}</span>
              </button>
              <div x-show="harvestOpen.judged" class="mt-3 flex flex-col gap-2.5">
                <template x-if="dreamHarvestCandidates().length === 0"><p class="text-xs muted">${t("这一晚没有审核。", "No review decisions that night.")}</p></template>
                <template x-for="item in dreamHarvestCandidates()" :key="item.id">
                  <div class="text-[13px] leading-6">
                    <div class="flex flex-wrap items-center gap-2 text-xs"><span class="chip" :class="item.status === 'approved' ? 'chip-ok' : 'chip-dim'" x-text="dreamCandidateStatusLabel(item.status)"></span><span class="muted" x-text="dreamCandidateSourceLabel(item.source)"></span></div>
                    <p class="mt-1" x-text="item.content"></p>
                    <p x-show="item.decision_note" class="text-[11px] muted" x-text="item.decision_note"></p>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </section>
      </section>

      <!-- ===== 导入导出 ===== -->
      <section x-show="savedApiKey.trim() && page === 'transfer'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("导入导出", "Import &amp; export")}</h1>
            <p class="sub">${t("把记忆搬进来，或者备份出去。", "Bring memories in, or back them up.")}</p>
          </div>
          <span class="chip"><span x-text="L('记忆空间：', 'Memory space: ')"></span><span class="font-semibold" x-text="namespace"></span></span>
        </header>

        <div class="grid gap-3 md:grid-cols-3" role="radiogroup" :aria-label="L('要做什么', 'What to do')">
          <button type="button" role="radio" @click="transferMode = 'chat'" class="mode-card" :class="transferMode === 'chat' ? 'is-active' : ''" :aria-checked="transferMode === 'chat' ? 'true' : 'false'">
            <span class="ico">${I.chat}</span>
            <span><span class="block font-semibold">${t("导入聊天记录", "Import chat history")}</span><span class="mt-1 block text-[13px] muted">${t("ChatGPT、Claude、酒馆的导出文件，自动找出值得记的。", "Exports from ChatGPT, Claude or SillyTavern. Finds what’s worth remembering.")}</span></span>
          </button>
          <button type="button" role="radio" @click="transferMode = 'entries'" class="mode-card" :class="transferMode === 'entries' ? 'is-active' : ''" :aria-checked="transferMode === 'entries' ? 'true' : 'false'">
            <span class="ico">${I.list}</span>
            <span><span class="block font-semibold">${t("导入整理好的条目", "Import a list")}</span><span class="mt-1 block text-[13px] muted">${t("一行一条的清单，也能从别的 AI 搬过来。", "One memory per line. Works for moving over from another AI.")}</span></span>
          </button>
          <button type="button" role="radio" @click="transferMode = 'export'" class="mode-card" :class="transferMode === 'export' ? 'is-active' : ''" :aria-checked="transferMode === 'export' ? 'true' : 'false'">
            <span class="ico">${I.download}</span>
            <span><span class="block font-semibold">${t("导出备份", "Export a backup")}</span><span class="mt-1 block text-[13px] muted">${t("Markdown 能直接改，JSONL 最完整。", "Markdown you can edit, or JSONL with every field.")}</span></span>
          </button>
        </div>

        <section x-show="transferMode === 'chat'" class="panel panel-pad flex flex-col gap-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="h2">${t("导入聊天记录", "Import chat history")}</h2>
            <ol class="steps" :aria-label="L('进度', 'Progress')">
              <li :class="chatStep() > 1 ? 'is-done' : 'is-now'"><span class="n" x-text="chatStep() > 1 ? '✓' : '1'"></span><span x-text="L('选文件', 'Pick a file')"></span></li>
              <li class="sep" aria-hidden="true"></li>
              <li :class="chatStep() > 2 ? 'is-done' : chatStep() === 2 ? 'is-now' : ''"><span class="n" x-text="chatStep() > 2 ? '✓' : '2'"></span><span x-text="L('整理中', 'Reading')"></span></li>
              <li class="sep" aria-hidden="true"></li>
              <li :class="chatStep() === 3 ? 'is-now' : ''"><span class="n">3</span><span x-text="L('去待审确认', 'Confirm in Review')"></span></li>
            </ol>
          </div>
          <template x-if="!transfer.chat">
            <div class="flex flex-col items-start gap-3">
              <p class="text-[13px] muted">${t("认得 ChatGPT、Claude 导出的 conversations.json，酒馆的 .jsonl，还有「名字：内容」一句一行的文本。文件在浏览器里拆开，按天切段交给整理用的模型读。", "Reads ChatGPT and Claude conversations.json exports, SillyTavern .jsonl, and plain “Name: text” lines. The file is split in your browser and read day by day by the nightly-run model.")}</p>
              <label class="btn btn-primary cursor-pointer">${I.upload}<span x-text="transfer.chatLoading ? L('在读文件…', 'Reading file…') : L('选聊天记录文件', 'Choose a chat file')"></span>
                <input type="file" accept=".json,.jsonl,.txt,.md,.markdown" class="hidden" @change="loadChatFile($event)">
              </label>
            </div>
          </template>
          <template x-if="transfer.chat">
            <div class="flex flex-col gap-4">
              <div class="flex flex-wrap items-center gap-3 rounded-[12px] p-3.5" style="background: var(--soft)">
                <span class="avatar">${I.file}</span>
                <div class="min-w-0 flex-1">
                  <div class="truncate font-semibold" x-text="transfer.chat.name"></div>
                  <div class="text-[13px] muted" x-text="chatSummaryLabel()"></div>
                </div>
                <label class="btn btn-sm cursor-pointer" :class="transfer.chatRun && transfer.chatRun.running ? 'pointer-events-none opacity-50' : ''"><span x-text="L('换一个文件', 'Choose another file')"></span>
                  <input type="file" accept=".json,.jsonl,.txt,.md,.markdown" class="hidden" @change="loadChatFile($event)">
                </label>
              </div>
              <template x-for="warning in transfer.chat.warnings" :key="warning"><p class="banner banner-warn" x-text="warning"></p></template>
              <div x-show="transfer.chat.needsRoles" class="flex flex-col gap-2">
                <p class="text-[13px]" style="color: var(--t2)">${t("文件里按名字分人。勾上哪些名字是你，其余算助手：", "The file names its speakers. Tick the names that are you; the rest count as the assistant:")}</p>
                <div class="flex flex-wrap gap-2">
                  <template x-for="speaker in transfer.chat.speakers" :key="speaker.name">
                    <label class="pill inline-flex cursor-pointer items-center gap-2" :class="speaker.isUser ? 'is-active' : ''">
                      <input type="checkbox" :checked="speaker.isUser" @change="speaker.isUser = $event.target.checked; rechunkChat()">
                      <span x-text="speaker.name"></span><span class="count" x-text="speaker.count"></span>
                    </label>
                  </template>
                </div>
              </div>
              <label x-show="transfer.info && transfer.info.clef.available" class="check items-start">
                <input type="checkbox" x-model="transfer.chatClef" class="mt-0.5">
                <span>${t("让 clef 顺手给每条打个分，待审页能按分筛。只是参考，会多用一点 Workers AI。", "Let clef score each one so you can filter in Review. Only a hint; uses a little more Workers AI.")}</span>
              </label>
              <template x-if="transfer.chatRun">
                <div class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span x-text="L('已处理 ', '') + transfer.chatRun.done + ' / ' + transfer.chatRun.total + L(' 段 · 找到 ', ' parts read · ') + transfer.chatRun.candidates + L(' 条候选', ' candidates found')"></span>
                    <span class="font-semibold" x-text="chatRunPercent() + '%'"></span>
                  </div>
                  <div class="bar" role="progressbar" :aria-valuenow="chatRunPercent()" aria-valuemin="0" aria-valuemax="100" :aria-label="L('导入进度', 'Import progress')"><div :style="'width:' + chatRunPercent() + '%'"></div></div>
                  <p class="text-xs muted" x-text="chatRunLabel()"></p>
                  <p x-show="transfer.chatRun.lastError" class="text-xs" style="color: var(--warn)" x-text="L('出错：', 'Error: ') + transfer.chatRun.lastError"></p>
                </div>
              </template>
              <div class="flex flex-wrap gap-2">
                <button type="button" x-show="!transfer.chatRun || (!transfer.chatRun.running && transfer.chatRun.done < transfer.chatRun.total)" @click="runChatImport()" :disabled="!transfer.chat.chunks" class="btn btn-primary">${I.play}<span x-text="transfer.chatRun && transfer.chatRun.done ? L('接着做', 'Continue') : L('开始', 'Start')"></span></button>
                <button type="button" x-show="transfer.chatRun && transfer.chatRun.running" @click="transfer.chatRun.stop = true" class="btn">${I.pause}<span x-text="transfer.chatRun && transfer.chatRun.stop ? L('这段做完就停', 'Stopping after this part') : L('暂停', 'Pause')"></span></button>
                <button type="button" x-show="transfer.chatRun && transfer.chatRun.candidates" @click="go('review'); openImportReview(transfer.chatRun.importId)" class="btn" x-text="transfer.chatRun ? L('去待审确认 ' + transfer.chatRun.candidates + ' 条', 'Confirm ' + transfer.chatRun.candidates + ' in Review') : ''"></button>
              </div>
              <div class="flex flex-col gap-1 text-xs muted">
                <span>${t("页面开着才会跑。关了也没事，下次选同一个文件、同样的勾选，做完的段会跳过，接着做。", "It only runs while this page is open. Closing is fine: pick the same file with the same ticks next time and it picks up where it left off.")}</span>
                <span>${t("找出来的先进待审，你点了才算数。原话只留被引用的那几句，不会被 7 天清理吃掉。", "Everything found goes to Review first and counts only once you confirm. Only the quoted lines are kept, outside the 7-day cleanup.")}</span>
              </div>
            </div>
          </template>
        </section>

        <section x-show="transferMode === 'entries'" class="panel panel-pad flex flex-col gap-4">
          <div>
            <h2 class="h2">${t("导入整理好的条目", "Import a list")}</h2>
            <p class="mt-1 text-[13px] muted">${t("一行一条，比如 <code>- 2025-12-15 [偏好] 不吃香菜 #饮食</code>。日期、类型、标签都可以省；Aelios 导出的 md / jsonl 能原样导回，普通列表和一段段文字也认。", "One per line, like <code>- 2025-12-15 [preference] No cilantro #food</code>. Date, type and tags are optional; Aelios .md / .jsonl exports import as-is, and plain lists or paragraphs work too.")}</p>
          </div>
          <details class="rounded-[12px] p-3.5" style="background: var(--soft)">
            <summary class="text-[13px]" style="color: var(--t2)">${t("从别的 AI 搬？让它按这个格式把记得的事列出来", "Moving from another AI? Ask it to list what it remembers in this format")}</summary>
            <pre class="out mt-3" style="background: transparent; padding: 0" x-text="transfer.info ? transfer.info.prompt : L('加载中…', 'Loading…')"></pre>
            <button type="button" @click="copyImportPrompt()" class="btn btn-sm mt-3" x-text="L('复制提示词', 'Copy prompt')"></button>
          </details>
          <label class="block"><span class="label">${t("条目内容", "List contents")}</span>
            <textarea x-model="transfer.entriesText" @input="transfer.preview = null; transfer.entriesName = ''" rows="6" class="field" :placeholder="L('把清单粘贴进来，或者选一个文件', 'Paste the list here, or choose a file')"></textarea>
          </label>
          <div class="flex flex-wrap gap-2">
            <label class="btn cursor-pointer">${I.upload}<span x-text="L('选文件', 'Choose file')"></span>
              <input type="file" accept=".md,.markdown,.txt,.json,.jsonl" class="hidden" @change="loadEntriesFile($event)">
            </label>
            <button type="button" @click="previewEntries()" :disabled="!transfer.entriesText.trim() || transfer.entriesBusy" class="btn" x-text="L('先看看认出了什么', 'Preview what it found')"></button>
          </div>
          <template x-if="transfer.preview">
            <div class="flex flex-col gap-3">
              <p class="text-sm" x-text="entriesPreviewLabel()"></p>
              <template x-for="warning in transfer.preview.warnings" :key="warning"><p class="banner banner-warn" x-text="warning"></p></template>
              <div class="max-h-72 overflow-auto rounded-[12px] p-3" style="background: var(--soft)">
                <template x-for="(entry, index) in transfer.preview.entries.slice(0, 50)" :key="index">
                  <div class="flex items-start gap-2 py-1 text-[13px] leading-6">
                    <span class="chip" :class="entry.kind === 'precious' ? 'chip-coral' : typeChipClass(entry.type || 'fact')" x-text="entry.kind === 'precious' ? L('珍贵', 'Keepsake') : typeLabel(entry.type || 'fact')"></span>
                    <span class="min-w-0 flex-1"><span class="muted" x-text="entry.date ? entry.date + ' ' : ''"></span><span x-text="entry.content"></span> <span class="muted" x-text="(entry.tags || []).map(function(tag) { return '#' + tag; }).join(' ')"></span></span>
                  </div>
                </template>
                <p x-show="transfer.preview.entries.length > 50" class="text-xs muted" x-text="L('……还有 ' + (transfer.preview.entries.length - 50) + ' 条', '…and ' + (transfer.preview.entries.length - 50) + ' more')"></p>
              </div>
              <fieldset class="flex flex-col gap-2 text-sm">
                <legend class="label">${t("导进来以后", "After importing")}</legend>
                <label class="flex items-start gap-2"><input type="radio" value="direct" x-model="transfer.entriesMode" class="mt-1"><span>${t("直接写进记忆库。和已有的一字不差就跳过，很像的转去待审。", "Save straight to Memories. Exact duplicates are skipped; close matches go to Review.")}</span></label>
                <label class="flex items-start gap-2"><input type="radio" value="review" x-model="transfer.entriesMode" class="mt-1"><span>${t("全部先进待审，一条条过。", "Send everything to Review first, one by one.")}</span></label>
                <span class="text-xs muted">${t("标成珍贵的两种都直接收进珍贵。", "Items marked as keepsakes go straight to Keepsakes either way.")}</span>
              </fieldset>
              <div><button type="button" @click="runEntriesImport()" :disabled="transfer.entriesBusy || !transfer.preview.total" class="btn btn-primary">${I.upload}<span x-text="L('导入 ' + transfer.preview.total + ' 条', 'Import ' + transfer.preview.total)"></span></button></div>
            </div>
          </template>
          <p x-show="transfer.entriesRun" class="banner" x-text="entriesRunLabel()"></p>
        </section>

        <section x-show="transferMode === 'export'" class="panel">
          <div class="px-[18px] pt-4">
            <h2 class="h2">${t("导出备份", "Export a backup")}</h2>
            <p class="mt-1 text-[13px] muted" x-text="L('导出「' + namespace + '」空间里在用的记忆和珍贵。', 'Exports the active memories and keepsakes in the “' + namespace + '” space.')"></p>
          </div>
          <div class="divide mt-3" style="border-top: 1px solid var(--div)">
            <div class="row">
              <div class="min-w-0 flex-1"><div class="font-semibold">Markdown</div><div class="text-[13px] muted">${t("能直接打开改，改完从这里原样导回来（带 fact_key 的按 key 改写，旧版留着）。", "Open and edit it, then import it back here as-is (items with a fact_key update in place; old versions are kept).")}</div></div>
              <button type="button" @click="exportMemories('md')" :disabled="transfer.exporting" class="btn btn-primary btn-sm">${I.download}<span x-text="L('导出 .md', 'Export .md')"></span></button>
            </div>
            <div class="row">
              <div class="min-w-0 flex-1"><div class="font-semibold">JSONL</div><div class="text-[13px] muted">${t("字段最全，适合整份备份。", "Every field included. Best for full backups.")}</div></div>
              <button type="button" @click="exportMemories('jsonl')" :disabled="transfer.exporting" class="btn btn-sm">${I.download}<span x-text="L('导出 .jsonl', 'Export .jsonl')"></span></button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h2 class="h2">${t("导入记录", "Past imports")}</h2>
            <button type="button" @click="loadImportBatches()" class="btn btn-icon btn-sm btn-icon-sm" :aria-label="L('刷新', 'Refresh')">${I.refresh}</button>
          </div>
          <div class="divide mt-3" style="border-top: 1px solid var(--div)">
            <template x-if="transfer.batches.length === 0"><div class="empty">${t("这个空间还没导入过。", "Nothing imported into this space yet.")}</div></template>
            <template x-for="batch in transfer.batches" :key="batch.id">
              <div class="row items-start">
                <span class="w-16 flex-none pt-0.5 text-xs muted" x-text="shortDate(batch.created_at || batch.updated_at)"></span>
                <div class="min-w-0 flex-1">
                  <div class="font-semibold" x-text="importBatchLabel(batch)"></div>
                  <div class="mt-0.5 text-[13px] muted" x-text="importBatchDetail(batch)"></div>
                </div>
                <span class="chip flex-none" :class="batchDone(batch) ? 'chip-ok' : 'chip-warn'" x-text="batchStatusLabel(batch)"></span>
              </div>
            </template>
          </div>
        </section>
      </section>

      <!-- ===== 设置 ===== -->
      <section x-show="savedApiKey.trim() && page === 'settings'" class="page">
        <header class="page-head">
          <div>
            <h1 class="h1">${t("设置", "Settings")}</h1>
            <p class="sub">${t("大多数保持默认就好，改完自动保存。", "The defaults suit most people. Changes save automatically.")}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <label class="search w-[300px] max-w-full">${I.search}<span class="sr-only" x-text="L('搜索设置', 'Search settings')"></span><input x-model="gwQuery" type="search" :placeholder="L('搜索设置，中文名或变量名都行', 'Search settings by name or variable')"></label>
            <button type="button" @click="gwRefresh()" :disabled="gwBusy" class="btn btn-icon" :aria-label="L('重新读取线上设置', 'Reload settings')" :title="L('重新读取线上设置', 'Reload settings')">${I.refresh}</button>
          </div>
        </header>
        <p x-show="gwError" class="banner banner-warn" x-text="gwError"></p>

        <div class="grid gap-6 lg:grid-cols-[180px_minmax(0,1fr)] lg:items-start">
          <nav class="subnav sticky top-6 hidden lg:block" :aria-label="L('设置分区', 'Settings sections')">
            <button type="button" @click="scrollToId('s-common')" x-text="L('常用', 'Essentials')"></button>
            <button type="button" @click="scrollToId('s-assistants')" x-text="L('助手', 'Assistants')"></button>
            <button type="button" @click="scrollToId('s-upstream')" x-text="L('模型与上游', 'Models & upstream')"></button>
            <button type="button" @click="scrollToId('s-all')" x-text="L('全部设置', 'All settings')"></button>
            <button type="button" @click="scrollToId('s-connect')" x-text="L('连接与密钥', 'Connection & keys')"></button>
            <button type="button" @click="scrollToId('s-debug')" x-text="L('排查工具', 'Troubleshooting')"></button>
          </nav>

          <div class="flex min-w-0 flex-col gap-6">
            <section id="s-common" x-show="!gwQuery.trim()" class="panel px-[18px] pb-2 pt-4">
              <h2 class="h2 mb-1">${t("常用", "Essentials")}</h2>
              <p x-show="gwBusy && !gwGroups.length" class="py-3 text-[13px] muted" x-text="L('读取中…', 'Loading…')"></p>
              <div>
                <template x-for="item in gwCommon()" :key="item.name">${SETTING_ROW}</template>
              </div>
            </section>

            <section id="s-assistants" x-show="!gwQuery.trim()" class="panel">
              <div class="panel-head">
                <div>
                  <h2 class="h2">${t("助手", "Assistants")}</h2>
                  <p class="mt-1 text-[13px] muted">${t("每个助手一条接入路径，决定哪些模型带记忆、记忆存在哪。", "Each assistant has its own path, decides which models get memory, and where memories are kept.")}</p>
                </div>
                <button type="button" @click="gwAdd()" class="btn btn-sm">${I.plus}${t("添加助手", "Add assistant")}</button>
              </div>
              <div class="divide mt-3" style="border-top: 1px solid var(--div)">
                <p x-show="!gwIdentities.length && !gwBusy" class="empty">${t("还没有助手，点「添加助手」。", "No assistants yet. Add one.")}</p>
                <template x-for="(idn, i) in gwIdentities" :key="i">
                  <div>
                    <div class="row items-start">
                      <span class="avatar" aria-hidden="true" x-text="gwIdentityTitle(idn).slice(0, 1).toUpperCase()"></span>
                      <div class="min-w-0 flex-1">
                        <div class="font-semibold" x-text="gwIdentityTitle(idn)"></div>
                        <div class="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px] muted">
                          <span><span x-text="L('接入路径 ', 'Path ')"></span><span class="mono" style="color: var(--t2)" x-text="(idn.slug || '').trim() ? '/' + idn.slug.trim() : L('还没起名字', 'not named yet')"></span></span>
                          <span><span x-text="L('带记忆的模型 ', 'Models with memory ')"></span><span class="mono" style="color: var(--t2)" x-text="(idn.modelsText || '').trim() || L('还没填', 'none yet')"></span></span>
                          <span><span x-text="L('记忆空间 ', 'Memory space ')"></span><span class="mono" style="color: var(--t2)" x-text="(idn.namespace || '').trim() || (idn.slug || '').trim() || '—'"></span></span>
                        </div>
                      </div>
                      <button type="button" @click="idn._open = !idn._open" class="btn btn-sm" :aria-expanded="idn._open ? 'true' : 'false'" x-text="idn._open ? L('收起', 'Done') : L('编辑', 'Edit')"></button>
                    </div>
                    <div x-show="gwSpaceHint(idn)" class="banner mx-[18px] mb-3">
                      <span class="min-w-0 flex-1" x-text="gwSpaceHint(idn) && gwSpaceHint(idn).text"></span>
                      <button type="button" @click="gwUseSpace(idn)" class="btn btn-sm" x-text="gwSpaceHint(idn) && (L('改用 ', 'Use ') + gwSpaceHint(idn).space)"></button>
                    </div>
                    <div x-show="idn._open" class="grid gap-3 px-[18px] pb-[18px]">
                      <label class="block"><span class="label">${t("名字（接入地址里的路径）", "Name (the path in its address)")}</span>
                        <input x-model="idn.slug" class="field" :placeholder="L('如 coder', 'e.g. coder')">
                      </label>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <label class="block"><span class="label">${t("用户叫什么", "What the user is called")}</span>
                          <input x-model="idn.userName" class="field" :placeholder="L('用户叫什么,如 小南', 'e.g. Sam')">
                        </label>
                        <label class="block"><span class="label">${t("助手叫什么", "What the assistant is called")}</span>
                          <input x-model="idn.assistantName" class="field" :placeholder="L('助手叫什么,如 小北', 'e.g. Robin')">
                        </label>
                      </div>
                      <p class="-mt-1 text-xs muted">${t("夜间整理、日记、审核写记忆时只用这两个名字，不写「用户 / 助手」。助手名留空用路径名。", "The nightly run, journal and review use these names instead of “user” and “assistant”. A blank assistant name uses the path.")}</p>
                      <label class="block"><span class="label">${t("带记忆的模型（逗号分隔，支持 * 通配）", "Models with memory (comma-separated, * wildcards)")}</span>
                        <input x-model="idn.modelsText" class="field mono" placeholder="anthropic/claude-opus-5, *fable*">
                      </label>
                      <label class="block"><span class="label">${t("记忆存在哪个空间", "Which space holds its memories")}</span>
                        <input x-model="idn.namespace" class="field" :placeholder="L('留空就用名字', 'Blank uses the name')">
                      </label>
                      <p class="-mt-1 text-xs muted">${t("MCP 和 Claude Code 钩子没指定时都用 default。想和它们共用一份记忆，就填 default。", "MCP and the Claude Code hook use default unless told otherwise. Enter default to share one set of memories with them.")}</p>
                      <div>
                        <span class="label">${t("能用哪些钥匙接入", "Keys that can use it")}</span>
                        <div class="flex flex-wrap gap-x-4 gap-y-2">
                          <template x-for="k in gwKeyOptions" :key="k.id">
                            <label class="check"><input type="checkbox" :value="k.id" x-model="idn.keys"><span x-text="L(k.label, k.labelEn)"></span><span class="mono text-[11px] muted" x-text="k.id"></span></label>
                          </template>
                        </div>
                      </div>
                      <details>
                        <summary class="text-[13px] muted">${t("召回空间、思考块、字数上限、写代码过滤", "Recall spaces, thinking blocks, size limit, coding filter")}</summary>
                        <div class="mt-3 grid gap-3">
                          <label class="block"><span class="label">${t("召回空间", "Recall spaces")}</span>
                            <input x-model="idn.readNamespacesText" class="field" :placeholder="L('逗号分隔；留空只读写入空间；[] 不召回', 'Comma-separated; blank = its own space; [] = none')">
                          </label>
                          <p class="-mt-1 text-xs muted">${t("最多 8 个，共用注入预算。共享时填同一空间；迁移时写新空间、召回保留旧空间。", "Up to 8, sharing one budget. To share, use the same space; to migrate, write to the new one and keep recalling the old.")}</p>
                          <label class="block"><span class="label">${t("Claude 思考块", "Claude thinking blocks")}</span>
                            <select x-model="idn.anthropicThinking" class="field">
                              <option value="auto" x-text="L('自动（默认）：原生 Anthropic 线路丢弃失配思考，其余透传', 'Auto (default): drop mismatched thinking on native Anthropic, pass through elsewhere')"></option>
                              <option value="passthrough" x-text="L('原样透传（原生 Anthropic 线路的工具续轮会 400）', 'Pass through (tool follow-ups on native Anthropic return 400)')"></option>
                              <option value="drop_block" x-text="L('总是丢弃失配思考（需 beta，Vertex 勿用）', 'Always drop mismatched thinking (needs beta; not for Vertex)')"></option>
                            </select>
                          </label>
                          <label class="block"><span class="label">${t("单次记忆字数上限", "Memory characters per turn")}</span>
                            <input x-model="idn.maxMemoryChars" type="number" min="256" max="24000" class="field" :placeholder="L('留空默认 6000', 'Blank: 6000')">
                          </label>
                          <div>
                            <label class="check"><input type="checkbox" x-model="idn.codingFilter"><span>${t("写代码时只记说的话（默认开）", "When coding, keep only what was said (on by default)")}</span></label>
                            <p class="text-xs muted">${t("Claude Code、Codex、Cline 这类写代码的工具发来的请求，代码块记成 [code]，读文件、跑命令、改文件的步骤不记。关掉就全记。", "For requests from coding tools such as Claude Code, Codex and Cline, code blocks are saved as [code], and steps that read, run or edit code are not saved. Turn off to save everything.")}</p>
                          </div>
                        </div>
                      </details>
                      <div class="flex justify-end"><button type="button" @click="gwIdentities.splice(i, 1)" class="btn btn-sm btn-danger" x-text="L('移除这个助手', 'Remove this assistant')"></button></div>
                    </div>
                  </div>
                </template>
              </div>
            </section>

            <section id="s-upstream" x-show="!gwQuery.trim()" class="panel">
              <div class="panel-head"><h2 class="h2">${t("模型与上游", "Models & upstream")}</h2></div>
              <div class="divide mt-3" style="border-top: 1px solid var(--div)">
                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold">${t("上游地址", "Upstream")}</span><span class="chip" :class="gwAddress.trim() ? 'chip-ok' : 'chip-warn'" x-text="gwAddress.trim() ? L('已设置', 'Set') : L('未设置', 'Not set')"></span></div>
                      <div class="mt-0.5 truncate text-[13px] muted" x-text="gwAddress.trim() || L('Cloudflare AI Gateway 或兼容 OpenAI 的地址。供应商钥匙在 Cloudflare 里保管，不经过这里。', 'Cloudflare AI Gateway or any OpenAI-compatible address. Provider keys stay in Cloudflare.')"></div>
                    </div>
                    <button type="button" @click="gwToggle('上游')" class="btn btn-sm" x-text="gwIsOpen('上游') ? L('收起', 'Done') : L('编辑', 'Edit')"></button>
                  </div>
                  <div x-show="gwIsOpen('上游')" class="grid gap-2 px-[18px] pb-[18px]">
                    <input x-model="gwAddress" :aria-label="L('上游地址', 'Upstream')" class="field" :placeholder="L('CF 账号 ID（32 位），或完整地址，如 new-api 的 https://…/v1', 'Cloudflare account ID (32 chars), or a full address such as https://…/v1')">
                    <p class="text-xs leading-5 muted">${t("chat 走 compat，全 provider；messages / responses 走各 provider 原生端点，模型名带 provider/ 前缀。BYOK 钥匙在 AI Gateway 仪表盘；CF 令牌去 Worker Secrets 加 CLOUDFLARE_API_TOKEN。Gateway ID 在「全部设置 → 模型与线路」里，默认 default。", "Chat uses the compat endpoint for every provider; messages / responses use each provider’s native endpoint, with a provider/ prefix on the model name. BYOK keys live in the AI Gateway dashboard; add CLOUDFLARE_API_TOKEN under Worker secrets. The gateway ID is under All settings → Models &amp; routing (default: default).")} <a href="https://dash.cloudflare.com/" target="_blank" rel="noopener">${t("打开 Cloudflare ↗", "Open Cloudflare ↗")}</a></p>
                  </div>
                </div>

                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold">${t("ChatGPT 套餐", "ChatGPT plan")}</span><span class="chip" :class="chatgptChipClass()" x-text="chatgptChipText()"></span></div>
                      <div class="mt-0.5 text-[13px] muted">${t("模型名写 <code>chatgpt/…</code>，用量算在你的套餐里。只连你自己的账号。", "Use model names like <code>chatgpt/…</code>; usage counts toward your plan. Connect only your own account.")}</div>
                    </div>
                    <button type="button" @click="gwToggle('chatgpt'); if (gwIsOpen('chatgpt') && !chatgpt.loaded) chatgptLoad()" class="btn btn-sm" x-text="gwIsOpen('chatgpt') ? L('收起', 'Done') : L('管理', 'Manage')"></button>
                  </div>
                  <div x-show="gwIsOpen('chatgpt')" class="flex flex-col gap-3 px-[18px] pb-[18px]">
                    <p x-show="chatgpt.error" class="banner banner-warn" x-text="chatgpt.error"></p>
                    <div x-show="chatgpt.status && chatgpt.status.status === 'connected'" class="note rounded-[10px]" style="background: var(--soft)">
                      <p class="text-sm" style="color: var(--t1)">Using ChatGPT plan<span class="muted" x-text="chatgpt.status && chatgpt.status.email ? ' · ' + chatgpt.status.email : ''"></span></p>
                      <p class="mt-1 text-xs muted">${t("想让它带上记忆，把 <code>chatgpt/*</code> 加进助手的「带记忆的模型」。", "To give it memory, add <code>chatgpt/*</code> to an assistant’s models with memory.")} <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener">Manage usage</a></p>
                    </div>
                    <p x-show="chatgpt.status && chatgpt.status.status === 'plan_disabled'" class="banner">${t("已登录 ChatGPT，但没授权 Aelios 用套餐额度，所以不会发任何请求。点「重新授权」，在同意页里允许使用套餐。", "Signed in, but Aelios isn’t allowed to use your plan, so nothing is sent. Choose Re-authorize and allow plan use on the consent page.")}</p>
                    <div x-show="chatgpt.status && chatgpt.status.status === 'needs_login'" class="banner">
                      <span>${t("ChatGPT 的登录失效了（可能在 ChatGPT 设置里断开过，或很久没用）。重新登录一次就行。", "The ChatGPT sign-in expired (disconnected in ChatGPT settings, or unused for a long time). Sign in again.")}</span>
                      <span x-show="chatgpt.status && chatgpt.status.last_error" class="block text-xs muted" x-text="chatgpt.status && chatgpt.status.last_error"></span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                      <button type="button" @click="chatgptLogin({})" :disabled="chatgpt.busy" x-show="!chatgpt.status || ['disconnected','needs_login'].includes(chatgpt.status.status)" class="btn" style="background: #000; color: #fff; border-color: #000">Continue with ChatGPT</button>
                      <button type="button" @click="chatgptLogin({ reconsent: true })" :disabled="chatgpt.busy" x-show="chatgpt.status && chatgpt.status.status === 'plan_disabled'" class="btn btn-primary" x-text="L('重新授权', 'Re-authorize')"></button>
                      <button type="button" @click="chatgptTest()" :disabled="chatgpt.busy" x-show="chatgpt.status && chatgpt.status.status === 'connected'" class="btn btn-sm" x-text="chatgpt.testing ? L('测试中…', 'Testing…') : L('测试', 'Test')"></button>
                      <button type="button" @click="chatgptLogin({ account: 'new' })" :disabled="chatgpt.busy" x-show="chatgpt.status && chatgpt.status.registered" class="btn btn-sm" :title="L('换账号，或者保存的登记被拒绝时重新登记一次', 'Switch accounts, or register again if the saved registration is refused')" x-text="L('换一个 ChatGPT 账号', 'Use another ChatGPT account')"></button>
                      <button type="button" @click="chatgptLogout()" :disabled="chatgpt.busy" x-show="chatgpt.status && ['connected','plan_disabled','needs_login'].includes(chatgpt.status.status)" class="btn btn-sm btn-danger" x-text="L('退出登录', 'Sign out')"></button>
                    </div>
                    <div x-show="chatgpt.authorizeUrl" class="flex flex-col gap-2 rounded-[12px] p-3.5" style="background: var(--soft)">
                      <p class="text-[13px] leading-6">${t("① 在新打开的页面里登录 ChatGPT 并同意。没弹出来的话", "① Sign in to ChatGPT in the new tab and approve. If it didn’t open,")} <a :href="chatgpt.authorizeUrl" target="_blank" rel="noopener">${t("点这里打开", "open it here")}</a>.</p>
                      <p class="text-[13px] leading-6">${t("② 同意之后浏览器会跳到一个打不开的页面（<code>127.0.0.1</code>，提示无法连接），<b>这是正常的，别关</b>。把地址栏里那一整条地址复制下来，贴在下面。", "② After approving, the browser lands on a page that fails to load (<code>127.0.0.1</code>). <b>That’s expected — don’t close it.</b> Copy the whole address from the address bar and paste it below.")}</p>
                      <textarea x-model="chatgpt.pasted" rows="3" :aria-label="L('粘贴浏览器地址栏里的完整地址', 'Paste the full address from the address bar')" placeholder="http://127.0.0.1:1455/auth/callback?code=…&amp;state=…" class="field mono text-xs"></textarea>
                      <p class="text-xs muted">${t("如果电脑上开着 Codex CLI 之类也在用 1455 端口的程序，它会抢走这个回跳，先关掉再登。链接 10 分钟内有效。", "If something else on your computer uses port 1455 (such as Codex CLI), it will catch this redirect; close it first. The link works for 10 minutes.")}</p>
                      <div class="flex gap-2">
                        <button type="button" @click="chatgptFinish()" :disabled="chatgpt.busy" class="btn btn-primary btn-sm" x-text="L('完成登录', 'Finish sign-in')"></button>
                        <button type="button" @click="chatgpt.authorizeUrl = ''; chatgpt.pasted = ''; chatgpt.error = ''" class="btn btn-sm" x-text="L('取消', 'Cancel')"></button>
                      </div>
                    </div>
                    <div x-show="chatgpt.test" class="rounded-[12px] p-3.5" style="background: var(--soft)">
                      <template x-if="chatgpt.test && chatgpt.test.ok">
                        <div>
                          <p class="text-[13px]"><span x-text="L('通了：', 'Works: ')"></span><span class="mono" x-text="'chatgpt/' + chatgpt.test.model"></span> · <span x-text="chatgpt.test.latency_ms + ' ms'"></span> · “<span x-text="chatgpt.test.reply"></span>”</p>
                          <p class="mt-2 text-xs muted" x-text="L('这个账号能用的模型：', 'Models this account can use:')"></p>
                          <ul class="mt-1"><template x-for="m in (chatgpt.test.models || [])" :key="m.slug"><li class="mono text-[11px] muted" x-text="'chatgpt/' + m.slug + (m.name && m.name !== m.slug ? '（' + m.name + '）' : '')"></li></template></ul>
                        </div>
                      </template>
                      <template x-if="chatgpt.test && !chatgpt.test.ok">
                        <div>
                          <p class="text-[13px]" style="color: var(--err)" x-text="L('没通（', 'Failed (') + chatgpt.test.step + (chatgpt.test.status ? ' · ' + chatgpt.test.status : '') + L('）：', '): ') + chatgpt.test.error"></p>
                          <p x-show="chatgpt.test.status === 403" class="mt-1 text-xs muted">${t("403 也可能是地区限制：Worker 从哪个 Cloudflare 机房出去，OpenAI 就按那里的地区判断。", "A 403 can also be a region block: OpenAI judges by the Cloudflare location your Worker runs from.")}</p>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>

                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold">${t("模型清单", "Model list")}</span><span class="chip" :class="modelList.items.length ? 'chip-ok' : ''" x-text="!modelList.loaded ? L('读取中', 'Loading') : modelList.items.length ? L('显示 ' + modelList.items.length + ' 个', modelList.items.length + ' shown') : L('显示全部', 'Showing all')"></span></div>
                      <div class="mt-0.5 text-[13px] muted">${t("客户端的模型下拉只显示这里选的，清单外的照样能用。留空显示上游目录里的全部。", "Your app’s model picker shows only these. Others still work. Leave empty to show the whole catalog.")}</div>
                    </div>
                    <button type="button" @click="gwToggle('models')" class="btn btn-sm" x-text="gwIsOpen('models') ? L('收起', 'Done') : L('编辑', 'Edit')"></button>
                  </div>
                  <div x-show="gwIsOpen('models')" class="flex flex-col gap-3 px-[18px] pb-[18px]">
                    <p x-show="modelList.error" class="banner banner-warn" x-text="modelList.error"></p>
                    <ul x-show="modelList.items.length" class="divide rounded-[12px]" style="background: var(--soft)">
                      <template x-for="(id, index) in modelList.items" :key="id">
                        <li class="px-3 py-1.5">
                          <div class="flex items-center gap-1">
                            <span class="mono min-w-0 flex-1 break-all text-xs" x-text="id"></span>
                            <button type="button" @click="modelListCheck(id)" :disabled="modelListState(id) === 'testing'" :aria-label="L('测试连通性 ', 'Test ') + id" :title="modelListCheckTitle(id)" class="icon-btn">
                              <span x-show="modelListState(id) === 'ok'" class="dot dot-ok"></span>
                              <span x-show="modelListState(id) === 'testing'" class="animate-spin">${ICON_SPIN}</span>
                              <span x-show="modelListState(id) === 'fail'" style="color: var(--err)">${ICON_LINK}</span>
                              <span x-show="!modelListState(id)">${ICON_LINK}</span>
                            </button>
                            <button type="button" @click="modelListRemove(id)" :disabled="modelList.busy" :aria-label="L('移除 ', 'Remove ') + id" :title="L('移除', 'Remove')" class="icon-btn">${I.minus}</button>
                          </div>
                          <p x-show="modelListState(id) === 'fail'" class="mt-1 break-words text-[11px]" style="color: var(--err)" x-text="modelList.checks[id] && modelList.checks[id].error"></p>
                        </li>
                      </template>
                    </ul>
                    <div class="flex gap-2">
                      <input x-model="modelList.typed" @keydown.enter.prevent="modelListAddTyped()" :aria-label="L('手填模型名', 'Type a model name')" :placeholder="L('手填模型名，如 openrouter/openai/gpt-6.1-sol:floor', 'Type a name, e.g. openrouter/openai/gpt-6.1-sol:floor')" class="field mono min-w-0 flex-1 text-xs">
                      <button type="button" @click="modelListAddTyped()" :disabled="modelList.busy || !modelList.typed.trim()" class="btn btn-primary" x-text="L('添加', 'Add')"></button>
                    </div>
                    <p class="text-xs muted">${t("自定义 Provider、动态路由、带后缀的写法（如 :floor）目录里都没有，这里手填。一次贴好几个也行，用逗号、空格隔开。", "Custom providers, dynamic routes and suffixes (like :floor) aren’t in the catalog; type them here. Paste several at once, separated by commas or spaces.")}</p>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" @click="modelListTogglePicker()" :disabled="modelList.catalogLoading" class="btn btn-sm" x-text="modelList.catalogLoading ? L('读取中…', 'Loading…') : modelList.pickerOpen ? L('收起目录', 'Hide catalog') : L('从上游目录里选', 'Pick from the catalog')"></button>
                      <button type="button" x-show="modelList.items.length" @click="modelListClear()" :disabled="modelList.busy" class="btn btn-sm" x-text="L('清空，改回显示全部', 'Clear and show all')"></button>
                    </div>
                    <div x-show="modelList.pickerOpen && !modelList.catalogLoading" class="flex flex-col gap-2 rounded-[12px] p-3" style="background: var(--soft)">
                      <p x-show="modelList.catalogReason" class="text-xs muted" x-text="L('上游目录没读到（' + modelList.catalogReason + '）。先检查上游地址和 CF 令牌，或者直接手填。', 'Couldn’t read the catalog (' + modelList.catalogReason + '). Check the upstream and Cloudflare token, or type names in.')"></p>
                      <input x-model="modelList.query" @input="modelListSearch()" :aria-label="L('搜索模型', 'Search models')" :placeholder="L('搜索，如 claude、gpt-5、openrouter', 'Search, e.g. claude, gpt-5, openrouter')" class="field">
                      <p class="text-[11px] muted" x-text="L(modelList.total + ' 个可选', modelList.total + ' available') + (modelList.total > modelList.shown.length ? L('，只列前 ' + modelList.shown.length + ' 个，输入关键词缩小范围', '; showing the first ' + modelList.shown.length + ', type to narrow') : '')"></p>
                      <ul class="max-h-72 overflow-y-auto">
                        <template x-for="(id, index) in modelList.shown" :key="id">
                          <li class="flex items-center justify-between gap-2 py-1" :style="index ? 'border-top: 1px solid var(--div)' : ''">
                            <span class="mono min-w-0 break-all text-[11px]" x-text="id"></span>
                            <button type="button" @click="modelListAdd([id])" :disabled="modelList.busy" :aria-label="L('添加 ', 'Add ') + id" :title="L('添加', 'Add')" class="icon-btn" style="color: var(--ct)">${I.plus}</button>
                          </li>
                        </template>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div x-show="gwDirty()" x-transition.opacity.duration.150ms class="savebar" role="status">
              <span class="text-sm">${t("助手和上游改了，还没保存", "Assistant or upstream changes aren’t saved yet")}</span>
              <div class="flex gap-2">
                <button type="button" @click="gwDiscard()" :disabled="gwBusy" class="btn btn-sm" x-text="L('放弃', 'Discard')"></button>
                <button type="button" @click="gwSave()" :disabled="gwBusy" class="btn btn-primary btn-sm" x-text="L('保存', 'Save')"></button>
              </div>
            </div>

            <section id="s-all" x-show="gwGroups.length" class="panel">
              <div class="panel-head">
                <h2 class="h2">${t("全部设置", "All settings")}</h2>
                <span class="text-xs muted" x-text="gwChangedCount() ? L('改过 ' + gwChangedCount() + ' 项，其余用默认', gwChangedCount() + ' changed; the rest use defaults') : L('全部是默认值', 'All defaults')"></span>
              </div>
              <div class="divide mt-3" style="border-top: 1px solid var(--div)">
                <template x-for="s in gwSections()" :key="s.group">
                  <div>
                    <button type="button" @click="gwToggle(s.group)" class="group-btn" :aria-expanded="gwGroupOpen(s.group) ? 'true' : 'false'">
                      <span class="min-w-0 flex-1 font-semibold" x-text="gLabel(s)"></span>
                      <span x-show="s.changed" class="chip chip-violet" x-text="L('改过 ' + s.changed + ' 项', s.changed + ' changed')"></span>
                      <span class="text-xs muted" x-text="L(s.items.length + ' 项', s.items.length + (s.items.length === 1 ? ' item' : ' items'))"></span>
                      <span class="chev" :class="gwGroupOpen(s.group) ? 'is-open' : ''">${I.chevron}</span>
                    </button>
                    <div x-show="gwGroupOpen(s.group)" class="px-[18px] pb-2">
                      <template x-for="item in s.items" :key="item.name">${SETTING_ROW}</template>
                    </div>
                  </div>
                </template>
                <p x-show="gwQuery.trim() && !gwSections().length" class="empty">${t("没有找到相关设置。", "No matching settings.")}</p>
              </div>
            </section>

            <section id="s-connect" x-show="!gwQuery.trim()" class="panel">
              <div class="panel-head"><h2 class="h2">${t("连接与密钥", "Connection & keys")}</h2></div>
              <div class="divide mt-3" style="border-top: 1px solid var(--div)">
                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="font-semibold">${t("这台设备的登录", "Sign-in on this device")}</div>
                      <div class="mt-0.5 truncate text-[13px] muted" x-text="tokenSaved() ? L('Token 已保存在本机浏览器里 · ', 'Your token is saved in this browser · ') + baseHost() : L('Token 改了还没保存', 'Token changed but not saved')"></div>
                    </div>
                    <button type="button" @click="tokenEditing = !tokenEditing" class="btn btn-sm" x-text="tokenEditing ? L('收起', 'Done') : L('更换', 'Change')"></button>
                    <button type="button" @click="signOut()" class="btn btn-sm btn-danger" x-text="L('退出', 'Sign out')"></button>
                  </div>
                  <div x-show="tokenEditing" class="grid gap-3 px-[18px] pb-[18px]">
                    <label class="block"><span class="label">${t("Worker 地址", "Worker address")}</span><input x-model="workerUrl" @change="savePrefs()" class="field" placeholder="https://…workers.dev"></label>
                    <label class="block"><span class="label">Token</span>
                      <span class="flex gap-2"><input x-model="apiKey" @keydown.enter.prevent="saveToken()" type="password" autocomplete="current-password" class="field min-w-0 flex-1"><button type="button" @click="saveToken()" class="btn btn-primary" x-text="L('保存', 'Save')"></button></span>
                    </label>
                  </div>
                </div>
                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="flex flex-wrap items-center gap-2"><span class="font-semibold">${t("Worker 密钥", "Worker secrets")}</span><span class="chip" x-text="L(gwSecrets.filter(function(s) { return s.present; }).length + ' / ' + gwSecrets.length + ' 已设', gwSecrets.filter(function(s) { return s.present; }).length + ' of ' + gwSecrets.length + ' set')"></span></div>
                      <div class="mt-0.5 text-[13px] muted">${t("只在 Cloudflare 的 Worker 设置里改，这里只看状态。", "Changed only in Cloudflare’s Worker settings. This shows their status.")}</div>
                    </div>
                    <button type="button" @click="gwToggle('密钥')" class="btn btn-sm" x-text="gwIsOpen('密钥') ? L('收起', 'Done') : L('查看', 'View')"></button>
                  </div>
                  <div x-show="gwIsOpen('密钥')" class="grid gap-1.5 px-[18px] pb-[18px]">
                    <template x-for="s in gwSecrets" :key="s.name || s.label">
                      <p class="flex items-center gap-2 text-[13px]" :style="s.present ? '' : 'color: var(--t3)'"><span class="dot" :class="s.present ? 'dot-ok' : ''"></span><span x-text="L(s.label, s.labelEn || s.label)"></span><span x-show="s.name" class="mono text-[11px] muted" x-text="s.name"></span></p>
                    </template>
                  </div>
                </div>
              </div>
            </section>

            <section id="s-debug" x-show="!gwQuery.trim()" class="panel">
              <div class="panel-head"><h2 class="h2">${t("排查工具", "Troubleshooting")}</h2></div>
              <div class="divide mt-3" style="border-top: 1px solid var(--div)">
                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="font-semibold">${t("为什么想起了这件事", "Why was this recalled?")}</div>
                      <div class="mt-0.5 text-[13px] muted">${t("所选助手最近 20 次召回的打分，调召回时看。", "Scores from the selected assistant’s last 20 recalls, for tuning.")}</div>
                    </div>
                    <button type="button" @click="gwToggle('召回'); if (gwIsOpen('召回')) loadRecallHistory()" class="btn btn-sm" x-text="gwIsOpen('召回') ? L('收起', 'Close') : L('打开', 'Open')"></button>
                  </div>
                  <div x-show="gwIsOpen('召回')" class="flex flex-col gap-3 px-[18px] pb-[18px]">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-xs muted" x-text="selectedIdentity ? L('记录按助手区分，不随单个召回空间合并。', 'Records are per assistant, not merged across recall spaces.') : L('先在左上「正在查看」里选一位助手。', 'Pick an assistant under “Viewing” first.')"></p>
                      <button type="button" @click="loadRecallHistory()" :disabled="recallHistoryLoading || !selectedIdentity" class="btn btn-sm" x-text="L('刷新记录', 'Refresh')"></button>
                    </div>
                    <div aria-live="polite">
                      <p x-show="recallHistoryLoading" class="text-xs muted" x-text="L('读取中…', 'Loading…')"></p>
                      <p x-show="recallHistoryError" class="text-xs" style="color: var(--err)" x-text="recallHistoryError"></p>
                      <p x-show="selectedIdentity && !recallHistoryLoading && !recallHistoryError && !recallHistory.length" class="text-xs muted" x-text="L('还没有召回记录。', 'No recalls yet.')"></p>
                    </div>
                    <template x-for="record in recallHistory" :key="record.id">
                      <details class="rounded-[12px] p-3" style="background: var(--soft)">
                        <summary class="text-sm" x-text="record.query || L('本轮召回', 'This turn’s recall')"></summary>
                        <p class="mt-2 text-xs muted" x-text="fmt(record.created_at) + ' · ' + recallStatusLabel(record.selection && record.selection.status) + ' · ' + L('带上 ' + (record.injected || 0) + ' 条', (record.injected || 0) + ' brought in')"></p>
                        <p class="mt-1 text-xs muted" x-text="recallReasonLabel(record.selection && record.selection.reason)"></p>
                        <p class="mt-1 text-xs muted" x-show="record.selection && record.selection.threshold != null" x-text="record.selection ? L('分数下限 ', 'Score floor ') + record.selection.threshold + (record.selection.elapsed_ms != null ? L(' · 重排与筛选 ', ' · rerank and filter ') + record.selection.elapsed_ms + ' ms' : '') + L(' · 分数不是正确率', ' · scores are not accuracy') : ''"></p>
                        <template x-for="(decision, i) in (record.decisions || [])" :key="i">
                          <div class="mt-2 pt-2" style="border-top: 1px solid var(--div)">
                            <p class="text-xs" :style="decision.injected ? 'color: var(--ct)' : 'color: var(--t3)'" x-text="(decision.injected ? L('已选 · ', 'Chosen · ') : L('未选 · ', 'Skipped · ')) + recallReasonLabel(decision.reason)"></p>
                            <p class="mt-1 text-xs muted" x-show="decision.score != null" x-text="decision.score != null ? L('相关分数 ', 'Relevance ') + Number(decision.score).toFixed(3) : ''"></p>
                            <p class="mt-1 whitespace-pre-wrap text-sm" x-text="decision.excerpt || ''"></p>
                            <p class="mono mt-1 break-all text-[11px] muted" x-text="(decision.namespace || '') + ' / ' + (decision.id || decision.kind || '')"></p>
                          </div>
                        </template>
                      </details>
                    </template>
                  </div>
                </div>
                <div>
                  <div class="row">
                    <div class="min-w-0 flex-1">
                      <div class="font-semibold">${t("维护", "Maintenance")}</div>
                      <div class="mt-0.5 text-[13px] muted">${t("检查和补齐向量，或者立刻把这个空间整理一遍。", "Check and fill in missing vectors, or run the nightly process for this space now.")}</div>
                    </div>
                    <button type="button" @click="gwToggle('维护')" class="btn btn-sm" x-text="gwIsOpen('维护') ? L('收起', 'Close') : L('打开', 'Open')"></button>
                  </div>
                  <div x-show="gwIsOpen('维护')" class="flex flex-col gap-3 px-[18px] pb-[18px]">
                    <p class="text-xs muted" x-text="L('当前空间：', 'Current space: ') + namespace"></p>
                    <div class="flex flex-wrap gap-2">
                      <button type="button" @click="runHealth()" class="btn btn-sm" x-text="L('检查向量库', 'Check vectors')"></button>
                      <button type="button" @click="runReindex(true)" class="btn btn-sm" x-text="L('重建索引（只预览）', 'Reindex (preview)')"></button>
                      <button type="button" @click="runBackfill(true)" class="btn btn-sm" x-text="L('查缺向量', 'Find missing vectors')"></button>
                      <button type="button" @click="runBackfill(false)" class="btn btn-sm" x-text="L('补缺向量', 'Fill missing vectors')"></button>
                      <button type="button" @click="runDream()" class="btn btn-primary btn-sm" x-text="L('立刻强制整理', 'Force a nightly run now')"></button>
                    </div>
                    <pre class="out" x-text="debugOutput || L('还没运行维护操作。', 'No maintenance run yet.')"></pre>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  </main>

  <div x-show="toast" x-transition.opacity.duration.150ms class="toast" role="status" x-text="toast"></div>

  <!-- 在页面外层：放在卡片里的话，毛玻璃会把 fixed 困在卡片里、被后面的卡片盖住。 -->
  <div x-show="chatgpt.welcomeOpen" class="modal grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="You're using your ChatGPT plan">
    <div class="modal-scrim"></div>
    <div class="panel relative w-full max-w-sm p-5" style="background: var(--solid)">
      <h3 class="h2">You’re using your ChatGPT plan</h3>
      <p class="mt-2 text-[13px] leading-6 muted">${t("符合条件的请求会用你的 ChatGPT 套餐额度，计入套餐的用量限制。可以在 ChatGPT 设置的 Usage 里管理，或给 Aelios 设每周上限。", "Eligible requests use your ChatGPT plan and count toward its limits. Manage this under Usage in ChatGPT settings, or set a weekly cap for Aelios.")} <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noopener">Manage usage</a></p>
      <button type="button" @click="chatgptWelcomed()" class="btn btn-primary mt-4 w-full">Got it</button>
    </div>
  </div>

  <div x-show="spaceOpen" x-transition.opacity.duration.150ms @keydown.escape.window="spaceOpen = false" class="modal">
    <div class="modal-scrim" @click="spaceOpen = false"></div>
    <section role="dialog" aria-modal="true" :aria-label="L('切换查看的记忆空间', 'Switch the memory space you are viewing')" class="sheet">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h2 class="h2">${t("正在查看谁的记忆", "Whose memories you’re viewing")}</h2>
        <button type="button" @click="spaceOpen = false" class="btn btn-icon btn-sm btn-icon-sm" :aria-label="L('关闭', 'Close')">${I.x}</button>
      </div>
      <div class="grid gap-3">
        <label class="block"><span class="label">${t("助手", "Assistant")}</span>
          <select x-model="selectedIdentity" @change="selectIdentity($event.target.value)" class="field">
            <option value="" x-text="L('自选空间（高级）', 'Pick a space (advanced)')"></option>
            <template x-for="idn in memoryIdentities" :key="idn.slug"><option :value="idn.slug" x-text="idn.slug"></option></template>
          </select>
        </label>
        <label class="block"><span class="label">${t("记忆空间", "Memory space")}</span>
          <select x-model="namespace" @change="pickSpace($event.target.value)" class="field">
            <template x-for="space in pickerSpaces()" :key="space.name"><option :value="space.name" x-text="space.label"></option></template>
          </select>
        </label>
      </div>
      <div x-show="emptySpaceHint()" class="banner banner-warn mt-3">
        <span class="min-w-0 flex-1" x-text="emptySpaceHint() && emptySpaceHint().text"></span>
        <button type="button" @click="pickSpace(emptySpaceHint().space)" class="btn btn-sm" x-text="emptySpaceHint() && (L('看 ', 'View ') + emptySpaceHint().space)"></button>
      </div>
      <p class="mt-3 text-[13px] leading-6" style="color: var(--t2)" x-text="spaceDescription()"></p>
      <p class="text-xs leading-6 muted">${t("这里只换查看的记忆；聊天时用哪位助手，由接入地址和钥匙决定。", "This only changes what you’re viewing; which assistant a chat uses depends on its address and key.")}</p>
      <div x-show="selectedIdentity" class="mt-4 grid gap-3 rounded-[12px] p-3.5" style="background: var(--soft)">
        <div>
          <p class="text-sm font-semibold">${t("说话人名字", "Speaker names")}</p>
          <p class="mt-0.5 text-xs muted">${t("夜间整理、日记、审核写记忆时只用这两个名字，不写「用户 / 助手」。", "The nightly run, journal and review use these names instead of “user” and “assistant”.")}</p>
        </div>
        <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label class="block"><span class="label">${t("用户叫什么", "User’s name")}</span><input x-model="speakerUserName" class="field" :placeholder="L('如 小南', 'e.g. Sam')"></label>
          <label class="block"><span class="label">${t("助手叫什么", "Assistant’s name")}</span><input x-model="speakerAssistantName" class="field" :placeholder="L('如 小北；留空用路径名', 'e.g. Robin; blank uses the path')"></label>
          <button type="button" @click="saveSpeakers()" :disabled="speakerBusy" class="btn btn-primary" x-text="L('保存名字', 'Save names')"></button>
        </div>
      </div>
      <p x-show="identityLoadError" x-text="identityLoadError" class="banner banner-warn mt-3"></p>
      <details class="mt-3" :open="!selectedIdentity">
        <summary class="text-xs muted">${t("高级：手动填空间名", "Advanced: type a space name")}</summary>
        <label class="mt-2 block"><span class="label">${t("空间名", "Space name")}</span>
          <input :value="namespace" @change="selectCustomSpace($event.target.value)" class="field" placeholder="default">
        </label>
      </details>
    </section>
  </div>

</div>

<script>
${CHAT_PARSE_SCRIPT}
</script>
<script>
function memoryAdmin() {
  // 设置一项项排队存，连点两个开关也不会互相盖掉。放在外面，不进 Alpine 的响应式。
  let settingsQueue = Promise.resolve();
  // 导入聊天记录时读出来的整份消息和切好的段，可能上万条，放在外面不进响应式，页面上只显示数。
  let chatParsed = null;
  let chatChunks = [];
  return {
    // 记忆库里「重要」后面的几栏。
    moreNav: [
      { id: 'precious', label: '珍贵', labelEn: 'Keepsakes' },
      { id: 'glossary', label: '黑话', labelEn: 'Our words' },
      { id: 'notebook', label: '小本本', labelEn: 'Notebook' },
      { id: 'world', label: '世界知识', labelEn: 'World facts' }
    ],
    canonicalMemoryTypes: ['fact', 'event', 'preference', 'relationship', 'boundary', 'habit', 'decision', 'note'],
    limits: { fact: 120, event: 80, preference: 80, relationship: 80, boundary: 80, habit: 80, decision: 80, note: 120 },
    gwKeyOptions: [
      { id: 'CHATBOX_API_KEY', label: '主钥匙', labelEn: 'Main key' },
      { id: 'IM_API_KEY', label: '第二把', labelEn: 'Second key' },
      { id: 'DEBUG_API_KEY', label: '维护', labelEn: 'Maintenance' },
      { id: 'GUIDE_DOG_API_KEY', label: '导盲犬', labelEn: 'Guide dog' }
    ],
    // 没选过语言就看浏览器：中文浏览器用中文，其余用英文。跟 head 里那段一样。
    lang: (function() {
      const saved = localStorage.getItem('aelios.admin.lang');
      if (saved === 'zh' || saved === 'en') return saved;
      const browser = typeof navigator !== 'undefined' && navigator.language ? navigator.language : '';
      return browser && !/^zh/i.test(browser) ? 'en' : 'zh';
    })(),
    navOpen: false,
    connected: null,
    gwAddress: '',
    gwIdentities: [],
    gwSpaces: [],
    gwGroups: [],
    gwSecrets: [],
    gwBusy: false,
    gwError: '',
    gwQuery: '',
    gwOpen: {},
    gwSnapshot: '',
    hintsOpen: {},
    tokenEditing: false,
    recallHistory: [],
    recallHistoryLoading: false,
    recallHistoryError: '',
    recallHistoryRevision: 0,
    memoryIdentities: [],
    selectedIdentity: localStorage.getItem('aelios.admin.identity') || '',
    identityPreferenceReady: localStorage.getItem('aelios.admin.identity') !== null,
    identityLoadError: '',
    speakerUserName: '',
    speakerAssistantName: '',
    speakerBusy: false,
    spaceRevision: 0,
    page: 'today',
    moreView: 'important',
    workerUrl: localStorage.getItem('aelios.admin.workerUrl') || location.origin,
    apiKey: localStorage.getItem('aelios.admin.apiKey') || '',
    savedApiKey: localStorage.getItem('aelios.admin.apiKey') || '',
    namespace: localStorage.getItem('aelios.admin.namespace') || 'default',
    theme: localStorage.getItem('aelios.admin.colorMode') === 'dark' ? 'dark' : 'light',
    boot: {},
    stats: {},

    todayMessages: [],
    homeRole: 'all',
    homeAll: false,
    home: { diary: null, run: null, harvest: null },
    candidates: [],
    judgeDecisions: [],
    reviewHelp: false,
    reviewType: 'all',
    reviewSelected: {},
    reviewBulkBusy: false,
    reviewBulkLabel: '',
    spaceOpen: false,
    autoReview: null,
    memories: [],
    memoryQuery: '',
    precious: [],
    glossary: [],
    notebookPages: [],
    notebookDraft: null,
    notebookLoaded: false,

    diaryDailies: [],
    diaryRewriting: '',
    diaryWeeklies: [],
    diaryExpanded: {},
    diaryMode: 'daily',
    diaryPick: '',
    diaryReading: false,

    worldItems: [],
    worldSelection: {},
    worldQuery: '',
    memoryType: 'all',
    memoryCreateOpen: false,
    memoryDraft: { type: 'fact', content: '', fact_key: '', importance: 0.7, confidence: 0.85 },
    glossaryDraft: { term: '', definition: '', aliasesText: '' },
    debugOutput: '',
    toast: '',
    saving: false,

    dreamStatus: null,
    dreamRuns: [],
    dreamActiveRun: null,
    dreamPollTimer: null,
    dreamStatusError: '',
    dreamResolving: false,
    dreamLoading: false,
    dreamTriggering: false,
    dreamDate: '',
    dreamForce: false,
    dreamDryRun: true,
    dreamRunResult: null,
    dreamHarvestDate: '',
    dreamHarvest: null,
    dreamHarvestLoading: false,
    dreamExpanded: {},
    harvestOpen: { new: true, dim: true, judged: false },

    reviewTab: 'daily',
    importReview: { batches: [], importId: '', filter: 'all', items: [], counts: { pending: 0, clef_yes: 0, clef_no: 0 }, offset: 0, more: false, loading: false, bulk: null },
    transferMode: 'chat',
    transfer: { info: null, exporting: false, entriesText: '', entriesName: '', preview: null, entriesMode: 'direct', entriesBusy: false, entriesRun: null, chat: null, chatLoading: false, chatClef: true, chatRun: null, batches: [] },

    // ===== 中英两套文字 =====
    L(zh, en) {
      return this.lang === 'en' ? en : zh;
    },
    locale() {
      return this.lang === 'en' ? 'en-US' : 'zh-CN';
    },
    setLang(lang) {
      this.lang = lang === 'en' ? 'en' : 'zh';
      localStorage.setItem('aelios.admin.lang', this.lang);
      this.applyLang();
    },
    applyLang() {
      const root = document.documentElement;
      root.dataset.lang = this.lang;
      root.lang = this.lang === 'en' ? 'en' : 'zh-CN';
    },
    // 设置项的名字和说明：英文界面用 labelEn / hintEn，没有就退回中文。
    sLabel(item) {
      return this.lang === 'en' && item.labelEn ? item.labelEn : item.label;
    },
    sHint(item) {
      return this.lang === 'en' && item.hintEn ? item.hintEn : (item.hint || '');
    },
    gLabel(section) {
      return this.lang === 'en' && section.groupEn ? section.groupEn : section.group;
    },
    toggleHint(name) {
      const next = Object.assign({}, this.hintsOpen);
      if (next[name]) delete next[name];
      else next[name] = true;
      this.hintsOpen = next;
    },
    hintOpen(name) {
      return Boolean(this.hintsOpen[name]);
    },
    typeLabel(type) {
      const zh = { fact: '事实', event: '事件', preference: '偏好', relationship: '关系', boundary: '边界', habit: '习惯', decision: '决定', note: '备注', world_fact: '世界知识' };
      const en = { fact: 'Fact', event: 'Event', preference: 'Preference', relationship: 'Relationship', boundary: 'Boundary', habit: 'Habit', decision: 'Decision', note: 'Note', world_fact: 'World fact' };
      return (this.lang === 'en' ? en : zh)[type] || type || '—';
    },
    typeChipClass(type) {
      return this.canonicalMemoryTypes.indexOf(type) >= 0 ? 't-' + type : 'chip-dim';
    },
    importanceLabel(value) {
      const n = Number(value);
      if (value == null || !Number.isFinite(n)) return '—';
      if (n >= 0.75) return this.L('高', 'High');
      if (n >= 0.45) return this.L('中', 'Medium');
      return this.L('低', 'Low');
    },
    parseDay(label) {
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(label || '');
      return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
    },
    // 2026-10-26 → 10月26日 周一 / Mon, Oct 26；short 不带星期。
    dayLabel(label, short) {
      const date = this.parseDay(label);
      if (!date) return label || '';
      if (this.lang === 'en') return date.toLocaleDateString('en-US', short ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
      const head = (date.getMonth() + 1) + '月' + date.getDate() + '日';
      return short ? head : head + ' ' + ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    },
    longDayLabel(label) {
      const date = this.parseDay(label);
      if (!date) return label || '';
      return date.toLocaleDateString(this.locale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    },
    todayLabel() {
      return new Date().toLocaleDateString(this.locale(), { month: 'long', day: 'numeric', weekday: 'long' });
    },
    shortDate(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return this.lang === 'en'
        ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : (date.getMonth() + 1) + '月' + date.getDate() + '日';
    },
    clock(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
    },
    paragraphs(text) {
      return String(text || '').split(/\n+/).map(function(part) { return part.trim(); }).filter(Boolean);
    },
    excerpt(text) {
      const flat = String(text || '').replace(/\s+/g, ' ').trim();
      return flat.length > 40 ? flat.slice(0, 40) + '…' : flat;
    },
    roleName(role) {
      const idn = this.currentIdentity();
      if (role === 'user') return (idn && (idn.userName || '').trim()) || this.L('你', 'You');
      if (role === 'assistant') return (idn && (idn.assistantName || '').trim()) || this.L('助手', 'Assistant');
      return role || '—';
    },
    baseHost() {
      try { return new URL(this.base()).host; } catch (error) { return this.base(); }
    },

    // 模型清单：只决定 /v1/models 显示什么，不限制能调用什么。改一下存一下，跟设置项一样走同一条队列。
    modelList: { items: [], loaded: false, busy: false, error: '', typed: '', catalog: [], catalogLoaded: false, catalogLoading: false, catalogReason: '', query: '', pickerOpen: false, shown: [], total: 0, checks: {} },
    providersSummary() {
      var list = this.modelList;
      return 'ChatGPT ' + this.chatgptChipText() + ' · ' + this.L('模型清单 ', 'Model list ') + (!list.loaded ? this.L('读取中', 'loading') : list.items.length ? this.L('显示 ' + list.items.length + ' 个', list.items.length + ' shown') : this.L('显示全部', 'showing all'));
    },
    // 连通性：对清单里的一个模型发一条很短的真请求，走和聊天客户端同一条线路。通了变小绿点，没通显示上游的原话。
    modelListState(id) { return (this.modelList.checks[id] || {}).state || ''; },
    modelListCheckTitle(id) {
      var check = this.modelList.checks[id] || {};
      if (check.state === 'ok') return this.L('通了 · ' + check.ms + ' 毫秒，再点一下重新测', 'Works · ' + check.ms + ' ms. Click to test again');
      if (check.state === 'testing') return this.L('测试中…', 'Testing…');
      if (check.state === 'fail') return this.L('没通，点一下重试', 'Failed. Click to retry');
      return this.L('测试连通性（会发一条很短的请求）', 'Test it (sends one tiny request)');
    },
    async modelListCheck(id) {
      if (this.modelListState(id) === 'testing') return;
      this.modelList.checks[id] = { state: 'testing' };
      try {
        var result = await this.request('/api/gateway/models/test', { method: 'POST', body: JSON.stringify({ model: id }) });
        this.modelList.checks[id] = result.ok
          ? { state: 'ok', ms: result.latency_ms }
          : { state: 'fail', error: (result.status ? result.status + ' · ' : '') + (result.error || this.L('没通', 'failed')) };
      } catch (error) {
        this.modelList.checks[id] = { state: 'fail', error: error.message };
      }
    },
    modelListSearch() {
      var list = this.modelList;
      var query = list.query.trim().toLowerCase();
      var taken = list.items;
      var hits = list.catalog.filter(function(id) { return taken.indexOf(id) < 0 && (!query || id.toLowerCase().indexOf(query) >= 0); });
      list.total = hits.length;
      list.shown = hits.slice(0, 60);
    },
    async modelListTogglePicker() {
      var list = this.modelList;
      list.pickerOpen = !list.pickerOpen;
      if (!list.pickerOpen || list.catalogLoaded) return;
      list.catalogLoading = true;
      list.error = '';
      try {
        var data = await this.request('/api/gateway/models');
        list.catalog = (data.chatgpt || []).concat(data.models || []);
        list.catalogReason = data.reason || '';
        list.catalogLoaded = true;
      } catch (error) {
        list.error = this.L('目录读取失败：', 'Couldn’t read the catalog: ') + error.message;
      }
      list.catalogLoading = false;
      this.modelListSearch();
    },
    async modelListAddTyped() {
      var names = this.modelList.typed.split(/[\s,，;；]+/).filter(Boolean);
      if (!names.length) return;
      await this.modelListAdd(names);
      if (!this.modelList.error) this.modelList.typed = '';
    },
    modelListAdd(names) {
      var next = this.modelList.items.slice();
      names.forEach(function(name) { if (next.indexOf(name) < 0) next.push(name); });
      return this.modelListSave(next);
    },
    modelListRemove(id) {
      return this.modelListSave(this.modelList.items.filter(function(item) { return item !== id; }));
    },
    modelListClear() {
      if (!window.confirm(this.L('清空清单？客户端会改回显示上游目录里的全部模型。清单外的模型本来就能调用，不受影响。', 'Clear the list? Your app will show the whole upstream catalog again. Models off the list could always be called, so nothing else changes.'))) return;
      return this.modelListSave([]);
    },
    modelListSave(next) {
      var list = this.modelList;
      var self = this;
      if (JSON.stringify(next) === JSON.stringify(list.items)) return Promise.resolve();
      list.busy = true;
      list.error = '';
      var task = async function() {
        try {
          var result = await self.request('/api/gateway/config', { method: 'PATCH', body: JSON.stringify({ modelList: next }) });
          list.items = result.modelList || [];
          Object.keys(list.checks).forEach(function(name) { if (list.items.indexOf(name) < 0) delete list.checks[name]; });
          self.notify(list.items.length ? self.L('清单存好了，现在显示 ' + list.items.length + ' 个模型', 'List saved. ' + list.items.length + ' models shown') : self.L('清单已清空，改回显示全部', 'List cleared. Showing all models'));
        } catch (error) {
          list.error = self.L('没存上：', 'Not saved: ') + error.message;
        }
        list.busy = false;
        self.modelListSearch();
      };
      var run = settingsQueue.then(task, task);
      settingsQueue = run.catch(function() {});
      return run;
    },
    chatgpt: { status: null, loaded: false, busy: false, testing: false, error: '', authorizeUrl: '', pasted: '', test: null, welcomeOpen: false },
    chatgptChipText() {
      var status = this.chatgpt.status;
      if (!status) return this.chatgpt.error ? this.L('读取失败', 'Couldn’t load') : this.chatgpt.loaded ? '—' : this.L('未读取', 'Not loaded');
      var zh = { connected: '已连接', plan_disabled: '套餐未开通', needs_login: '需重新登录', disconnected: '未连接' };
      var en = { connected: 'Signed in', plan_disabled: 'Plan not allowed', needs_login: 'Sign in again', disconnected: 'Not connected' };
      return (this.lang === 'en' ? en : zh)[status.status] || status.status;
    },
    chatgptChipClass() {
      var status = this.chatgpt.status && this.chatgpt.status.status;
      return status === 'connected' ? 'chip-ok' : status === 'plan_disabled' ? 'chip-warn' : status === 'needs_login' ? 'chip-err' : '';
    },
    async chatgptLoad() {
      if (!this.savedApiKey.trim()) return;
      try {
        this.chatgpt.status = await this.request('/api/gateway/chatgpt/status');
        this.chatgpt.error = '';
        if (this.chatgpt.status.welcome) this.chatgpt.welcomeOpen = true;
      } catch (error) {
        this.chatgpt.error = error.message;
      }
      this.chatgpt.loaded = true;
    },
    // options: {} 首次或同一个账号；{ reconsent: true } 重新授权套餐；{ account: 'new' } 换账号。
    async chatgptLogin(options) {
      this.chatgpt.busy = true;
      this.chatgpt.error = '';
      try {
        var started = await this.request('/api/gateway/chatgpt/login', { method: 'POST', body: JSON.stringify(options || {}) });
        this.chatgpt.authorizeUrl = started.authorize_url;
        this.chatgpt.pasted = '';
        window.open(started.authorize_url, '_blank', 'noopener');
      } catch (error) {
        this.chatgpt.error = error.message;
      }
      this.chatgpt.busy = false;
    },
    async chatgptFinish() {
      var pasted = this.chatgpt.pasted.trim();
      if (!pasted) {
        this.chatgpt.error = this.L('先把浏览器地址栏里的完整地址粘贴进来', 'Paste the full address from your browser’s address bar first');
        return;
      }
      this.chatgpt.busy = true;
      this.chatgpt.error = '';
      try {
        await this.request('/api/gateway/chatgpt/callback', { method: 'POST', body: JSON.stringify({ url: pasted }) });
        this.chatgpt.authorizeUrl = '';
        this.chatgpt.pasted = '';
        this.chatgpt.test = null;
        this.notify(this.L('ChatGPT 已连接', 'ChatGPT connected'));
        await this.chatgptLoad();
      } catch (error) {
        this.chatgpt.error = error.message;
      }
      this.chatgpt.busy = false;
    },
    async chatgptTest() {
      this.chatgpt.busy = true;
      this.chatgpt.testing = true;
      this.chatgpt.error = '';
      try {
        this.chatgpt.test = await this.request('/api/gateway/chatgpt/test', { method: 'POST', body: '{}' });
      } catch (error) {
        this.chatgpt.error = error.message;
      }
      this.chatgpt.testing = false;
      this.chatgpt.busy = false;
      await this.chatgptLoad();
    },
    async chatgptLogout() {
      if (!window.confirm(this.L('退出 ChatGPT 登录？会去 ChatGPT 那边撤销授权，chatgpt/ 开头的模型会停用。', 'Sign out of ChatGPT? This revokes access on ChatGPT’s side, and chatgpt/ models stop working.'))) return;
      this.chatgpt.busy = true;
      this.chatgpt.error = '';
      try {
        var result = await this.request('/api/gateway/chatgpt/logout', { method: 'POST', body: '{}' });
        this.chatgpt.test = null;
        this.chatgpt.authorizeUrl = '';
        this.notify(result.revoked === false ? this.L('已退出；ChatGPT 那边的撤销没确认，可以去 ChatGPT 设置里断开', 'Signed out, but ChatGPT didn’t confirm the revoke. You can disconnect it in ChatGPT settings') : this.L('已退出 ChatGPT', 'Signed out of ChatGPT'));
        await this.chatgptLoad();
      } catch (error) {
        this.chatgpt.error = error.message;
      }
      this.chatgpt.busy = false;
    },
    async chatgptWelcomed() {
      this.chatgpt.welcomeOpen = false;
      try { await this.request('/api/gateway/chatgpt/welcome', { method: 'POST', body: '{}' }); } catch (error) { /* 下次打开再弹一次，不碍事 */ }
    },
    async init() {
      this.applyLang();
      this.applyTheme();
      this.icons();
      await this.loadMemoryIdentities();
      await this.reloadAll();
    },
    currentIdentity() {
      return this.memoryIdentities.find(idn => idn.slug === this.selectedIdentity);
    },
    flagValue(raw) {
      const text = String(raw || '').trim().toLowerCase();
      if (['on', 'true', '1', 'yes'].includes(text)) return true;
      if (['off', 'false', '0', 'no'].includes(text)) return false;
      return null;
    },
    // 什么都不存时这个开关是开是关：先看部署值，没有就看代码默认。
    switchBaseline(item) {
      const deployed = this.flagValue(item.deployed);
      return deployed === null ? item.defaultOn === true : deployed;
    },
    settingOn(item) {
      const own = this.flagValue(item.value);
      return own === null ? this.switchBaseline(item) : own;
    },
    // 拨回默认就清掉覆盖，跟默认不一样才存 true/false，点了就存。
    toggleSetting(item) {
      const next = !this.settingOn(item);
      return this.saveSetting(item, next === this.switchBaseline(item) ? '' : String(next));
    },
    saveSetting(item, raw) {
      const value = String(raw == null ? '' : raw).trim();
      const before = item.saved || '';
      item.value = value;
      if (value === before) return Promise.resolve();
      item.busy = true;
      const self = this;
      const task = async function() {
        const name = self.sLabel(item);
        try {
          const body = { settings: {} };
          body.settings[item.name] = value;
          const result = await self.request('/api/gateway/config', { method: 'PATCH', body: JSON.stringify(body) });
          const stored = result && result.settings && result.settings[item.name] || '';
          item.value = stored;
          item.saved = stored;
          if (item.kind === 'switch') self.notify(self.settingOn(item) ? self.L('已打开「' + name + '」', 'Turned on “' + name + '”') : self.L('已关闭「' + name + '」', 'Turned off “' + name + '”'));
          else self.notify(stored ? self.L('已保存「' + name + '」', 'Saved “' + name + '”') : self.L('「' + name + '」已恢复默认', '“' + name + '” reset to default'));
        } catch (error) {
          item.value = before;
          self.notify(self.L('「' + name + '」没存上：', '“' + name + '” wasn’t saved: ') + error.message);
        }
        item.busy = false;
      };
      const run = settingsQueue.then(task, task);
      settingsQueue = run.catch(function() {});
      return run;
    },
    gwItems() {
      return this.gwGroups.reduce(function(all, g) { return all.concat(g.items); }, []);
    },
    gwCommon() {
      const items = this.gwItems().filter(function(item) { return item.common; });
      return items.filter(function(item) { return item.kind === 'switch'; })
        .concat(items.filter(function(item) { return item.kind !== 'switch'; }));
    },
    // 没在搜时「常用」那几项不在分组里重复；搜的时候所有项都参与（中英文名、说明、变量名都能搜），命中的组自动展开。
    gwSections() {
      const q = this.gwQuery.trim().toLowerCase();
      return this.gwGroups.map(function(g) {
        const items = g.items.filter(function(item) {
          if (!q) return !item.common;
          return [item.label, item.hint, item.labelEn, item.hintEn, item.name, g.group, g.groupEn].some(function(text) { return String(text || '').toLowerCase().includes(q); });
        });
        return { group: g.group, groupEn: g.groupEn || '', items: items, changed: items.filter(function(item) { return item.saved; }).length };
      }).filter(function(section) { return section.items.length; });
    },
    gwChangedCount() {
      return this.gwItems().filter(function(item) { return item.saved; }).length;
    },
    gwToggle(key) { this.gwOpen[key] = !this.gwOpen[key]; },
    gwIsOpen(key) { return !!this.gwOpen[key]; },
    gwGroupOpen(group) { return !!this.gwQuery.trim() || !!this.gwOpen[group]; },
    gwIdentityTitle(idn) {
      return (idn.assistantName || '').trim() || (idn.slug || '').trim() || this.L('新助手', 'New assistant');
    },
    // 这个助手的写入空间还没有记忆，而别的空间（没被其他助手占着的）有，就提醒一句，点一下改过去。
    gwSpaceHint(idn) {
      const write = (idn.namespace || '').trim() || (idn.slug || '').trim();
      if (!write || !this.gwSpaces.length) return null;
      if (this.gwSpaces.some(function(space) { return space.namespace === write && space.memories > 0; })) return null;
      const others = this.gwIdentities.filter(function(other) { return other !== idn; }).map(function(other) {
        return (other.namespace || '').trim() || (other.slug || '').trim();
      });
      const free = this.gwSpaces.find(function(space) {
        return space.memories > 0 && space.namespace !== write && !others.includes(space.namespace);
      });
      if (!free) return null;
      return { space: free.namespace, text: this.L('「' + write + '」里还没有记忆，' + free.namespace + ' 里有 ' + free.memories + ' 条。', 'Nothing in “' + write + '” yet; ' + free.namespace + ' has ' + free.memories + ' memories.') };
    },
    gwUseSpace(idn) {
      const hint = this.gwSpaceHint(idn);
      if (hint) idn.namespace = hint.space;
    },
    gwIdentitySummary(idn) {
      const slug = (idn.slug || '').trim();
      const models = (idn.modelsText || '').split(/[,，\n]/).map(function(m) { return m.trim(); }).filter(Boolean);
      return [
        slug ? '/' + slug : this.L('还没起名字', 'not named yet'),
        models.length ? models.join(this.L('、', ', ')) : this.L('还没填主模型', 'no models yet'),
        this.L('写入 ', 'writes to ') + ((idn.namespace || '').trim() || slug || '—')
      ].join(' · ');
    },
    viewingLabel() {
      const idn = this.currentIdentity();
      const name = idn ? ((idn.assistantName || '').trim() || idn.slug) : this.L('自选空间', 'Custom space');
      return name + ' · ' + (this.namespace || 'default');
    },
    identitySpaces() {
      const idn = this.currentIdentity();
      if (!idn) return [];
      const write = idn.namespace || idn.slug;
      const reads = idn.readNamespaces === undefined ? [write] : idn.readNamespaces;
      return [...new Set([write, ...reads])].map(name => ({ name: name,
        label: name + (name === write ? this.L(' · 写入空间', ' · write space') : this.L(' · 召回空间', ' · recall space')) }));
    },
    // 没选助手时列出 default、所有有记忆的空间和正在看的这个，没配助手也能点回装着记忆的空间。
    pickerSpaces() {
      if (this.currentIdentity()) return this.identitySpaces();
      const counts = this.gwSpaces;
      const names = [...new Set(['default', ...counts.map(space => space.namespace), this.namespace || 'default'])];
      return names.map(name => {
        const found = counts.find(space => space.namespace === name);
        const note = found ? this.L(' · ' + found.memories + ' 条', ' · ' + found.memories + ' memories') : counts.length ? this.L(' · 没有记忆', ' · empty') : '';
        return { name: name, label: name + note };
      });
    },
    pickSpace(name) {
      const idn = this.currentIdentity();
      if (idn && this.identitySpaces().some(space => space.name === name)) return this.switchSpace(name);
      return this.selectCustomSpace(name);
    },
    // 自选空间时正在看的空间没有记忆、别的空间有，就提醒一句（多半是浏览器还记着一个旧空间名）。
    // 助手自己的空间是空的不在这里提醒：设置页的 gwSpaceHint 管那种情况，这里点过去会摘掉助手。
    emptySpaceHint() {
      if (this.currentIdentity()) return null;
      const current = this.namespace || 'default';
      if (this.gwSpaces.some(space => space.namespace === current && space.memories > 0)) return null;
      const best = this.gwSpaces.find(space => space.memories > 0);
      if (!best) return null;
      return { space: best.namespace, text: this.L('「' + current + '」里还没有记忆，' + best.namespace + ' 里有 ' + best.memories + ' 条。', 'Nothing in “' + current + '” yet; ' + best.namespace + ' has ' + best.memories + ' memories.') };
    },
    async loadSpaces() {
      // 各空间的记忆条数只用来提醒和列空间，读不到不影响别的。
      try { this.gwSpaces = (await this.request('/api/gateway/spaces')).spaces || []; } catch { this.gwSpaces = []; }
    },
    spaceDescription() {
      const idn = this.currentIdentity();
      if (!idn) return this.L('当前查看：', 'Viewing: ') + this.namespace;
      const write = idn.namespace || idn.slug;
      const reads = idn.readNamespaces === undefined ? [write] : idn.readNamespaces;
      const owners = this.memoryIdentities.filter(other =>
        (other.namespace || other.slug) === this.namespace ||
        (other.readNamespaces || []).includes(this.namespace)).map(other => other.slug);
      const shared = owners.filter(name => name !== idn.slug).join(this.L('、', ', '));
      return this.L('写入：', 'Writes to: ') + write + this.L('；召回：', '; recalls from: ') + (reads.length ? reads.join(this.L('、', ', ')) : this.L('已关闭', 'off')) +
        (owners.length > 1 ? this.L('。当前空间也被这些助手使用：', '. This space is also used by: ') + shared : '');
    },
    async loadMemoryIdentities() {
      if (!this.apiKey.trim()) return;
      const revision = this.spaceRevision;
      try {
        const config = await this.request('/api/gateway/config');
        if (revision !== this.spaceRevision) return;
        this.memoryIdentities = config.identities || [];
        this.identityLoadError = '';
        const saved = localStorage.getItem('aelios.admin.identity');
        let idn = this.currentIdentity();
        // Keep an explicitly chosen custom space, including an old unconfigured library.
        if (!idn && saved === null) {
          idn = this.memoryIdentities.find(item => (item.namespace || item.slug) === this.namespace);
          if (!idn && (this.namespace === 'default' || !this.namespace)) idn = this.memoryIdentities[0];
        }
        this.selectedIdentity = idn ? idn.slug : '';
        this.identityPreferenceReady = true;
        if (idn && !this.identitySpaces().some(space => space.name === this.namespace)) {
          this.namespace = idn.namespace || idn.slug;
          this.spaceRevision += 1;
          this.clearSpaceData();
        }
        this.savePrefs();
        this.syncSpeakerDraft();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.identityLoadError = this.L('助手列表读取失败，可在高级选项里填写空间名：', 'Couldn’t load assistants. You can type a space name under Advanced: ') + error.message;
      }
    },
    selectIdentity(slug) {
      this.identityPreferenceReady = true;
      this.selectedIdentity = slug;
      this.syncSpeakerDraft();
      const idn = this.currentIdentity();
      return this.switchSpace(idn ? (idn.namespace || idn.slug) : this.namespace);
    },
    syncSpeakerDraft() {
      const idn = this.currentIdentity();
      this.speakerUserName = idn && idn.userName || '';
      this.speakerAssistantName = idn && idn.assistantName || '';
    },
    async saveSpeakers() {
      const slug = this.selectedIdentity;
      if (!slug || this.speakerBusy) return;
      this.speakerBusy = true;
      try {
        const config = await this.request('/api/gateway/config');
        const identities = config.identities || [];
        const idn = identities.find(item => item.slug === slug);
        if (!idn) throw new Error(this.L('找不到这位助手', 'Assistant not found'));
        const userName = (this.speakerUserName || '').trim();
        const assistantName = (this.speakerAssistantName || '').trim();
        if (userName) idn.userName = userName; else delete idn.userName;
        if (assistantName) idn.assistantName = assistantName; else delete idn.assistantName;
        // 只改助手这一块，设置项不跟着回写。
        await this.request('/api/gateway/config', { method: 'PATCH', body: JSON.stringify({ identities: identities }) });
        const card = this.gwIdentities.find(item => item.slug === slug);
        const wasClean = !this.gwDirty();
        if (card) { card.userName = userName; card.assistantName = assistantName; }
        if (wasClean && this.gwSnapshot) this.gwMark();
        await this.loadMemoryIdentities();
        this.notify(this.L('说话人名字保存好了', 'Speaker names saved'));
      } catch (error) { this.notify(this.L('说话人名字保存失败：', 'Couldn’t save speaker names: ') + error.message); }
      this.speakerBusy = false;
    },
    selectCustomSpace(name) {
      this.identityPreferenceReady = true;
      this.selectedIdentity = '';
      return this.switchSpace(name);
    },
    async switchSpace(name) {
      this.namespace = name.trim() || 'default';
      this.spaceRevision += 1;
      this.clearSpaceData();
      await this.reloadAll();
    },
    clearSpaceData() {
      this.recallHistoryRevision += 1;
      this.recallHistory = []; this.recallHistoryError = ''; this.recallHistoryLoading = false;
      this.boot = {}; this.stats = {};
      this.todayMessages = []; this.candidates = []; this.judgeDecisions = []; this.memories = [];
      this.home = { diary: null, run: null, harvest: null }; this.homeAll = false;
      this.reviewSelected = {};
      this.precious = []; this.glossary = [];
      this.notebookPages = []; this.notebookDraft = null; this.notebookLoaded = false;
      this.diaryDailies = []; this.diaryWeeklies = []; this.diaryExpanded = {}; this.diaryRewriting = ''; this.diaryPick = ''; this.diaryReading = false;
      this.worldItems = []; this.worldSelection = {}; this.worldQuery = '';
      this.importReview = { batches: [], importId: '', filter: 'all', items: [], counts: { pending: 0, clef_yes: 0, clef_no: 0 }, offset: 0, more: false, loading: false, bulk: null };
      // 正在跑的聊天导入带着自己的空间，换空间不打断它；别的导入状态跟着空间清掉。
      this.transfer.info = null; this.transfer.preview = null; this.transfer.entriesRun = null; this.transfer.batches = [];
      if (this.transfer.chatRun && !this.transfer.chatRun.running) this.transfer.chatRun = null;
      this.memoryCreateOpen = false;
      this.memoryDraft = { type: 'fact', content: '', fact_key: '', importance: 0.7, confidence: 0.85 };
      this.glossaryDraft = { term: '', definition: '', aliasesText: '' };
      this.stopDreamPolling();
      this.dreamStatus = null; this.dreamRuns = []; this.dreamActiveRun = null; this.dreamHarvest = null;
      this.dreamExpanded = {}; this.dreamRunResult = null;
      this.dreamDate = ''; this.dreamHarvestDate = '';
      this.dreamLoading = false; this.dreamHarvestLoading = false;
      this.dreamTriggering = false; this.dreamResolving = false; this.dreamStatusError = '';
      this.debugOutput = '';
    },
    // 图标都直接写在页面里了；留着这个钩子，旧代码里到处在调。
    icons() {
      this.$nextTick(function() {
        if (window.lucide) window.lucide.createIcons();
      });
    },
    savePrefs() {
      localStorage.setItem('aelios.admin.workerUrl', this.workerUrl || location.origin);
      localStorage.setItem('aelios.admin.namespace', this.namespace || 'default');
      if (this.identityPreferenceReady) localStorage.setItem('aelios.admin.identity', this.selectedIdentity || '');
      localStorage.setItem('aelios.admin.colorMode', this.theme || 'light');
    },
    tokenSaved() {
      return (this.apiKey || '') === (this.savedApiKey || '');
    },
    async saveToken() {
      this.spaceRevision += 1;
      this.clearSpaceData();
      this.memoryIdentities = [];
      this.savePrefs();
      localStorage.setItem('aelios.admin.apiKey', this.apiKey || '');
      this.savedApiKey = this.apiKey || '';
      this.connected = null;
      this.tokenEditing = false;
      this.notify(this.apiKey && this.apiKey.trim() ? this.L('Token 已保存', 'Token saved') : this.L('Token 已清空', 'Token cleared'));
      this.gwGroups = []; this.gwSecrets = []; this.gwIdentities = []; this.gwSnapshot = ''; this.gwError = '';
      await this.loadMemoryIdentities();
      await this.switchSpace(this.namespace);
      if (this.page === 'settings' && this.savedApiKey.trim()) await this.gwLoad();
    },
    clearToken() {
      this.apiKey = '';
      this.saveToken();
    },
    signOut() {
      if (!window.confirm(this.L('退出后，这台设备要重新填 Token 才能用。继续吗？', 'Sign out? You’ll need to enter the token again on this device.'))) return;
      this.clearToken();
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme === 'dark' ? 'dark' : 'light';
      this.icons();
    },
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      this.savePrefs();
      this.applyTheme();
    },
    base() {
      return (this.workerUrl || location.origin).replace(/\/+$/, '');
    },
    withNamespace(path) {
      const sep = path.indexOf('?') === -1 ? '?' : '&';
      return path + sep + 'namespace=' + encodeURIComponent(this.namespace || 'default');
    },
    async request(path, options) {
      if (!this.apiKey.trim()) throw new Error(this.L('请先填写 token', 'Enter your token first'));
      const opts = options || {};
      const headers = Object.assign({
        Authorization: 'Bearer ' + this.apiKey
      }, opts.body ? { 'content-type': 'application/json' } : {}, opts.headers || {});
      const response = await fetch(this.base() + path, Object.assign({}, opts, { headers: headers }));
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = { raw: text }; }
      if (!response.ok) {
        const message = payload && payload.error ? (payload.error.message || payload.error) : response.status + ' ' + response.statusText;
        throw new Error(message);
      }
      return payload || {};
    },
    notify(message) {
      this.toast = message;
      const self = this;
      window.setTimeout(function() {
        if (self.toast === message) self.toast = '';
      }, 2400);
    },
    recallStatusLabel(status) {
      const zh = { reranked: '原文重排＋规则', lexical: '词面兜底', empty: '没有候选', error: '本轮未带上' };
      const en = { reranked: 'Reranked + rules', lexical: 'Lexical fallback', empty: 'No candidates', error: 'Nothing brought in' };
      return (this.lang === 'en' ? en : zh)[status] || this.L('旧版召回', 'Legacy recall');
    },
    recallReasonLabel(reason) {
      const zh = { no_safe_window: '没有能完整保留局部上下文的短片段', rerank_selected: '原文片段相关，已通过规则筛选', lexical_fallback_selected: '重排不可用，改用词面命中', below_rerank_threshold: '相关分数不足，不凑数', duplicate_source: '同一来源本次只占一个位置', duplicate_fact: '同一事实已选更高分版本', impression_not_evidence: '日记印象不当作事实证据', latest_requires_evidence: '要排最近一次，相关分做不到，本轮不带上', reranker_timeout: '原文重排超时，已回落词面', reranker_missing_binding: '缺少 Worker AI 绑定，已回落词面', reranker_disabled: '重排已关闭，已回落词面', reranker_unsupported_model: '请配置 Workers AI 重排模型', reranker_invalid_response: '重排分数无效，已回落词面', reranker_failed: '原文重排失败，已回落词面', duplicate_content: '同一内容只保留一份', already_visible: '聊天历史里已经有了', item_budget: '已选出更合适的记忆', candidate_budget: '超过本次候选数量', empty_content: '没有可用正文' };
      const en = { no_safe_window: 'No short passage keeps its local context intact', rerank_selected: 'Relevant passage; passed the rules', lexical_fallback_selected: 'Rerank unavailable; used a word match', below_rerank_threshold: 'Score too low; not padded in', duplicate_source: 'One slot per source this turn', duplicate_fact: 'A higher-scoring version of this fact was chosen', impression_not_evidence: 'Journal impressions aren’t used as evidence', latest_requires_evidence: 'Can’t rank “most recent” by relevance; skipped this turn', reranker_timeout: 'Rerank timed out; fell back to word match', reranker_missing_binding: 'Missing Workers AI binding; fell back to word match', reranker_disabled: 'Rerank is off; fell back to word match', reranker_unsupported_model: 'Set a Workers AI rerank model', reranker_invalid_response: 'Invalid rerank scores; fell back to word match', reranker_failed: 'Rerank failed; fell back to word match', duplicate_content: 'Same content kept once', already_visible: 'Already in the chat history', item_budget: 'Better memories were chosen', candidate_budget: 'Over this turn’s candidate limit', empty_content: 'No usable text' };
      const labels = this.lang === 'en' ? en : zh;
      if (labels[reason]) return labels[reason];
      return reason || '';
    },
    async loadRecallHistory() {
      const revision = ++this.recallHistoryRevision;
      const spaceRevision = this.spaceRevision;
      const identity = this.selectedIdentity;
      const base = this.base(), key = this.apiKey;
      this.recallHistory = []; this.recallHistoryError = ''; this.recallHistoryLoading = false;
      if (!identity || !this.apiKey.trim()) return;
      this.recallHistoryLoading = true;
      const current = () => revision === this.recallHistoryRevision && spaceRevision === this.spaceRevision &&
        identity === this.selectedIdentity && base === this.base() && key === this.apiKey;
      try {
        const data = await this.request('/api/gateway/recalls?identity=' + encodeURIComponent(identity));
        if (current()) this.recallHistory = data.items || [];
      } catch (error) {
        if (current()) this.recallHistoryError = this.L('召回记录读取失败：', 'Couldn’t load recalls: ') + error.message;
      } finally {
        if (current()) this.recallHistoryLoading = false;
      }
    },
    async gwLoad(manual) {
      if (this.gwBusy) return;
      this.gwBusy = true;
      this.gwError = '';
      try {
        const config = await this.request('/api/gateway/config');
        this.gwAddress = config.upstream && config.upstream.address || '';
        this.modelList.items = config.modelList || [];
        this.modelList.loaded = true;
        this.modelListSearch();
        await this.loadMemoryIdentities();
        this.gwIdentities = (config.identities || []).map(function(idn) {
          return {
            slug: idn.slug || '',
            userName: idn.userName || '',
            assistantName: idn.assistantName || '',
            modelsText: (idn.models || []).join(', '),
            namespace: idn.namespace || '',
            readNamespacesText: idn.readNamespaces ? (idn.readNamespaces.length ? idn.readNamespaces.join(', ') : '[]') : '',
            keys: idn.keys && idn.keys.length ? idn.keys.slice() : ['CHATBOX_API_KEY'],
            anthropicThinking: idn.anthropicThinking || 'auto',
            maxMemoryChars: idn.maxMemoryChars || '',
            codingFilter: idn.codingFilter !== false,
            _open: false
          };
        });
        await this.loadSpaces();
        const envData = await this.request('/api/gateway/env');
        (envData.groups || []).forEach(function(g) {
          g.items.forEach(function(item) { item.value = item.value || ''; item.saved = item.value; item.busy = false; });
        });
        this.gwGroups = envData.groups || [];
        this.gwSecrets = envData.secrets || [];
        this.gwMark();
        if (manual) this.notify(this.L('设置重新读好了', 'Settings reloaded'));
      } catch (error) {
        this.gwError = this.L('设置读取失败：', 'Couldn’t load settings: ') + error.message;
      }
      this.gwBusy = false;
      this.icons();
    },
    gwRefresh() {
      if (this.gwDirty() && !window.confirm(this.L('助手和上游的改动还没保存，重新读取会丢掉，继续吗？', 'Your assistant and upstream changes aren’t saved. Reloading discards them. Continue?'))) return;
      this.gwSnapshot = '';
      return this.gwLoad(true);
    },
    gwAdd() {
      // 第一个助手默认跟 MCP、Claude Code 钩子用同一个 default 空间，不然先用过 MCP 的人记忆会分成两份。
      const namespace = this.gwIdentities.length ? '' : 'default';
      this.gwIdentities.push({ slug: '', userName: '', assistantName: '', modelsText: '', namespace: namespace, readNamespacesText: '', keys: ['CHATBOX_API_KEY'], anthropicThinking: 'auto', maxMemoryChars: '', codingFilter: true, _open: true });
    },
    // 助手和上游要一起改好再存，所以跟线上比一比，有没存的就在底部浮出保存条。
    gwMark() { this.gwSnapshot = JSON.stringify(this.gwPayload()); },
    gwDirty() { return !!this.gwSnapshot && JSON.stringify(this.gwPayload()) !== this.gwSnapshot; },
    gwDiscard() {
      this.gwSnapshot = '';
      return this.gwLoad();
    },
    gwPayload() {
      const identities = this.gwIdentities.map(function(idn) {
        const out = {
          slug: (idn.slug || '').trim(),
          keys: idn.keys,
          models: (idn.modelsText || '').split(/[,，\n]/).map(function(s) { return s.trim(); }).filter(Boolean)
        };
        if ((idn.userName || '').trim()) out.userName = idn.userName.trim();
        if ((idn.assistantName || '').trim()) out.assistantName = idn.assistantName.trim();
        if ((idn.namespace || '').trim()) out.namespace = idn.namespace.trim();
        const reads = (idn.readNamespacesText || '').trim();
        if (reads) out.readNamespaces = reads === '[]' ? [] : reads.split(/[,，\n]/).map(function(s) { return s.trim(); }).filter(Boolean);
        if (idn.anthropicThinking && idn.anthropicThinking !== 'auto') out.anthropicThinking = idn.anthropicThinking;
        const budget = parseInt(idn.maxMemoryChars, 10);
        if (budget) out.maxMemoryChars = budget;
        if (!idn.codingFilter) out.codingFilter = false;
        return out;
      });
      return { identities: identities, upstream: this.gwAddress.trim() ? { address: this.gwAddress.trim() } : null };
    },
    // 只存助手和上游，设置项各自已经存过了，这里不带，免得拿旧值盖掉。
    async gwSave() {
      if (this.gwBusy) return;
      this.gwBusy = true;
      const self = this;
      const payload = this.gwPayload();
      const task = async function() {
        try {
          await self.request('/api/gateway/config', { method: 'PATCH', body: JSON.stringify(payload) });
          self.gwSnapshot = JSON.stringify(payload);
          self.gwIdentities.forEach(function(idn) { idn._open = false; });
          await self.loadMemoryIdentities();
          await self.switchSpace(self.namespace);
          self.notify(self.L('助手和上游保存好了', 'Assistants and upstream saved'));
        } catch (error) { self.notify(self.L('没存上：', 'Not saved: ') + error.message); }
      };
      const run = settingsQueue.then(task, task);
      settingsQueue = run.catch(function() {});
      await run;
      this.gwBusy = false;
    },
    scrollToId(id) {
      if (typeof document.getElementById !== 'function') return;
      const target = document.getElementById(id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    // 等页面画好再滚过去（刚出现的编辑框之类）。
    revealSoon(id) {
      if (typeof this.$nextTick === 'function') this.$nextTick(function() { this.scrollToId(id); }.bind(this));
    },
    // 回到顶上：宽屏是整页在滚，手机上是 .main 自己在滚。
    scrollTop() {
      if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
      const main = typeof document.querySelector === 'function' ? document.querySelector('.main') : null;
      if (main) main.scrollTop = 0;
    },
    // 窄屏点开一篇就换成全文，带「← 日记列表」；宽屏左右两栏，正文在右边直接换。
    openDiary(key) {
      this.diaryPick = key;
      this.diaryReading = true;
      if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches) this.scrollTop();
    },
    async reloadAll() {
      this.savePrefs();
      var tasks = [this.loadBoot(), this.loadCandidates(), this.loadMemories(), this.loadSpaces()];
      if (this.page === 'today') tasks.push(this.loadHome());
      if (this.page === 'review') tasks.push(this.loadJudgeDecisions());
      if (this.page === 'settings') tasks.push(this.loadRecallHistory(), this.chatgptLoad());
      if (this.page === 'diary') tasks.push(this.loadDiary());
      if (this.page === 'memory' && this.moreView === 'world') tasks.push(this.loadWorldFacts());
      if (this.page === 'memory' && this.moreView === 'notebook') tasks.push(this.loadNotebook());
      if (this.page === 'transfer') tasks.push(this.loadTransferInfo(), this.loadImportBatches());
      if (this.page === 'review' && this.reviewTab === 'import') tasks.push(this.loadImportBatches(), this.loadImportCandidates(true));
      if (this.page === 'dream') {
        tasks.push(this.loadDreamStatus());
        tasks.push(this.loadDreamHarvest());
      }
      await Promise.all(tasks);
      this.icons();
    },
    todayRange() {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      return { start: start.toISOString(), end: end.toISOString() };
    },
    async loadBoot() {
      const revision = this.spaceRevision;
      try {
        const range = this.todayRange();
        const data = await this.request(this.withNamespace('/v1/memory_boot?start=' + encodeURIComponent(range.start) + '&end=' + encodeURIComponent(range.end)));
        if (revision !== this.spaceRevision) return;
        this.connected = true;
        this.boot = data.data || {};
        this.stats = this.boot.stats || {};

        this.todayMessages = this.boot.today_messages || [];
        this.precious = this.boot.precious || [];
        this.glossary = this.boot.glossary || [];
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.connected = false;
        this.notify(error.message);
      }
    },
    // 首页右栏和「昨晚整理」那张卡：最新一篇日记、最近一次整理和那一晚记住的。读不到就空着，不弹错。
    async loadHome() {
      const revision = this.spaceRevision;
      if (!this.apiKey.trim()) return;
      try {
        const results = await Promise.all([
          this.request(this.withNamespace('/admin/diary?limit=1')),
          this.request(this.withNamespace('/v1/dream/status'))
        ]);
        if (revision !== this.spaceRevision) return;
        const dailies = (results[0].data && results[0].data.dailies) || [];
        const status = results[1].data || {};
        const runs = status.dream_runs || [];
        const run = runs.find(function(item) { return item.status !== 'queued' && item.status !== 'running'; }) || runs[0] || null;
        this.home.diary = dailies[0] || null;
        this.home.run = run;
        const date = (run && run.date_label) || status.anchor_date_label || this.yesterdayLabel();
        const harvest = await this.request(this.withNamespace('/admin/dream/harvest?date=' + encodeURIComponent(date)));
        if (revision !== this.spaceRevision) return;
        this.home.harvest = harvest.data || null;
      } catch (error) { /* 首页这几块是锦上添花，读不到就空着 */ }
    },
    homeMessages() {
      const list = this.homeAll ? this.homeFiltered() : this.homeFiltered().slice(0, 8);
      return list;
    },
    homeFiltered() {
      const role = this.homeRole;
      return this.todayMessages.filter(function(message) { return role === 'all' || message.role === role; });
    },
    homeFilteredCount() {
      return this.homeFiltered().length;
    },
    lastMessageTime() {
      let latest = '';
      this.todayMessages.forEach(function(message) { if ((message.created_at || '') > latest) latest = message.created_at; });
      return this.clock(latest);
    },
    homeHarvestCreated() {
      return (this.home.harvest && this.home.harvest.created) || [];
    },
    runColor(run) {
      if (!run) return 'var(--t3)';
      if (run.stale || run.status === 'queued' || run.status === 'running') return 'var(--warn)';
      return { ok: 'var(--ok)', error: 'var(--err)' }[run.status] || 'var(--t3)';
    },
    homeRunColor() {
      return this.runColor(this.home.run);
    },
    homeRunSub() {
      const run = this.home.run;
      if (!run) return this.L('近 7 天没有记录', 'No runs in the last 7 days');
      const created = this.homeHarvestCreated().length;
      return this.dayLabel(run.date_label, true) + ' · ' + this.clock(run.finished_at || run.started_at) + (created ? this.L(' · 新记住 ' + created + ' 条', ' · ' + created + ' new memories') : '');
    },
    homeRunBroken() {
      const run = this.home.run;
      return Boolean(run && (run.status === 'error' || run.stale));
    },
    isPinned(message) {
      const list = this.jsonList;
      return this.precious.some(function(item) {
        return item.content === message.content || list(item.context_message_ids).indexOf(message.id) >= 0;
      });
    },
    togglePin(message) {
      const list = this.jsonList;
      const found = this.precious.find(function(item) {
        return item.content === message.content || list(item.context_message_ids).indexOf(message.id) >= 0;
      });
      return found ? this.unpinPrecious(found) : this.pinMessage(message);
    },
    async loadCandidates() {
      const revision = this.spaceRevision;
      try {
        // 日常这一栏只要整理出来的；导入的在「导入的」那一栏单独翻页。
        const data = await this.request(this.withNamespace('/v1/candidates?status=pending&limit=100&scope=daily'));
        if (revision !== this.spaceRevision) return;
        this.candidates = (data.data || []).map(this.prepareCandidate);
        const ids = {};
        this.candidates.forEach(function(item) { ids[item.id] = true; });
        const kept = {};
        Object.keys(this.reviewSelected).forEach(function(id) { if (ids[id]) kept[id] = true; });
        this.reviewSelected = kept;
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
    },
    candidateIsUpdate(candidate) {
      return candidate.source === 'dream_update' || Boolean(candidate.existing_content);
    },
    candidateKindLabel(candidate) {
      if (candidate.source === 'dream_delete') return this.L('建议移除', 'Suggested removal');
      if (this.candidateIsUpdate(candidate)) return this.L('更新已有', 'Updates existing');
      if (candidate.import_id) return candidate.source === 'import_chat' ? this.L('来自聊天记录', 'From chat history') : this.L('来自清单', 'From a list');
      return this.L('新记忆', 'New');
    },
    candidateKindClass(candidate) {
      if (candidate.source === 'dream_delete') return 'chip-err';
      if (this.candidateIsUpdate(candidate)) return 'chip-warn';
      return 'chip-violet';
    },
    candidateApproveLabel(candidate) {
      if (candidate.source === 'dream_delete') return this.L('移除', 'Remove');
      if (this.candidateIsUpdate(candidate)) return this.L('改成新的', 'Use new');
      return this.L('记住', 'Remember');
    },
    candidateDiscardLabel(candidate) {
      if (candidate.source === 'dream_delete') return this.L('保留', 'Keep');
      if (this.candidateIsUpdate(candidate)) return this.L('保持原样', 'Keep old');
      return this.L('丢弃', 'Discard');
    },
    reviewTypes() {
      const seen = {};
      this.candidates.forEach(function(item) { seen[item.type] = true; });
      const order = this.canonicalMemoryTypes.filter(function(type) { return seen[type]; });
      return order.concat(Object.keys(seen).filter(function(type) { return order.indexOf(type) < 0; }));
    },
    reviewList() {
      const type = this.reviewType;
      return this.candidates.filter(function(item) { return type === 'all' || item.type === type; });
    },
    reviewToggle(id) {
      const next = Object.assign({}, this.reviewSelected);
      if (next[id]) delete next[id];
      else next[id] = true;
      this.reviewSelected = next;
    },
    reviewSelectedItems() {
      const selected = this.reviewSelected;
      return this.reviewList().filter(function(item) { return selected[item.id]; });
    },
    reviewSelectedCount() {
      return this.reviewSelectedItems().length;
    },
    reviewAllSelected() {
      const list = this.reviewList();
      const selected = this.reviewSelected;
      return list.length > 0 && list.every(function(item) { return selected[item.id]; });
    },
    reviewSelectAll(on) {
      const next = {};
      if (on) this.reviewList().forEach(function(item) { next[item.id] = true; });
      this.reviewSelected = next;
    },
    // 勾选的几条一条条走跟单个按钮一样的接口，失败的留在队列里。
    async reviewBulk(action) {
      const items = this.reviewSelectedItems();
      if (!items.length || this.reviewBulkBusy) return;
      const verb = action === 'approve' ? this.L('记住', 'Remember') : this.L('丢弃', 'Discard');
      if (!window.confirm(this.L(verb + '所选的 ' + items.length + ' 条？', verb + ' the ' + items.length + ' selected?'))) return;
      const ns = this.namespace;
      const revision = this.spaceRevision;
      this.reviewBulkBusy = true;
      let done = 0;
      let failed = 0;
      for (const candidate of items) {
        try {
          const body = action === 'approve' ? this.candidatePayload(candidate) : { namespace: ns };
          await this.request(this.nsPath('/v1/candidates/' + encodeURIComponent(candidate.id) + '/' + action, ns), { method: 'POST', body: JSON.stringify(body) });
        } catch (error) {
          failed += 1;
        }
        done += 1;
        this.reviewBulkLabel = done + ' / ' + items.length;
      }
      this.reviewBulkBusy = false;
      this.reviewBulkLabel = '';
      this.reviewSelected = {};
      this.notify(this.L(verb + '了 ' + (items.length - failed) + ' 条', verb + 'ed ' + (items.length - failed)) + (failed ? this.L('，' + failed + ' 条没成功', '; ' + failed + ' failed') : ''));
      if (revision === this.spaceRevision) await Promise.all([this.loadCandidates(), this.loadMemories(), this.loadBoot()]);
    },
    async loadJudgeDecisions() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/candidates/decisions?days=7'));
        if (revision !== this.spaceRevision) return;
        this.judgeDecisions = data.data || [];
        this.autoReview = data.auto_review || null;
        this.icons();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
    },
    judgeDecisionLabel(item) {
      const archive = item.source === 'dream_delete';
      if (item.undone) {
        if (archive) return item.status === 'approved' ? this.L('撤回后归档', 'Undone, archived') : this.L('撤回后放回', 'Undone, restored');
        return item.status === 'approved' ? this.L('撤回后补记', 'Undone, remembered') : this.L('撤回后收回', 'Undone, dropped');
      }
      const verdict = archive
        ? (item.status === 'approved' ? this.L('归档了', 'archived') : this.L('留着', 'kept'))
        : (item.status === 'approved' ? this.L('记住了', 'remembered') : this.L('放下了', 'let go'));
      return (item.judged_by || this.L('代审', 'auto')) + ' · ' + verdict;
    },
    judgeUndoLabel(item) {
      if (item.source === 'dream_delete') return item.status === 'approved' ? this.L('撤回，放回来', 'Undo: restore it') : this.L('撤回，归档它', 'Undo: archive it');
      return item.status === 'approved' ? this.L('撤回，不记了', 'Undo: forget it') : this.L('撤回，记下来', 'Undo: remember it');
    },
    async undoJudgeDecision(item) {
      try {
        await this.request(this.withNamespace('/v1/candidates/' + encodeURIComponent(item.id) + '/undo'), {
          method: 'POST',
          body: JSON.stringify({})
        });
        await Promise.all([this.loadJudgeDecisions(), this.loadMemories(), this.loadBoot()]);
        this.notify(this.L('已撤回', 'Undone'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async loadMemories() {
      const revision = this.spaceRevision;
      try {
        const typeParam = this.memoryType && this.memoryType !== 'all' ? '&type=' + encodeURIComponent(this.memoryType) : '';
        const path = '/v1/memory?status=active&limit=100' + typeParam;
        const data = await this.request(this.withNamespace(path));
        if (revision !== this.spaceRevision) return;
        this.memories = (data.data || []).map(function(item) {
          item.open = false;
          item.editing = false;
          item.mergeOpen = false;
          item.target_id = '';
          item.draft = { content: item.content };
          item.revOpen = false;
          item.revisions = null;
          return item;
        });
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
    },
    filteredMemories() {
      const q = this.memoryQuery.trim().toLowerCase();
      if (!q) return this.memories;
      return this.memories.filter(function(item) {
        return [item.content, item.fact_key, (item.tags || []).join(' ')].some(function(text) { return String(text || '').toLowerCase().includes(q); });
      });
    },
    memoryFooter() {
      const total = Number(this.typeCount(this.memoryType)) || 0;
      const shown = this.memories.length;
      if (total > shown) return this.L('显示最近更新的 ' + shown + ' 条，共 ' + total + ' 条', 'Showing the ' + shown + ' most recent of ' + total);
      return this.L('共 ' + shown + ' 条', shown + ' in total');
    },
    openMemoryTab(id) {
      this.moreView = id;
      this.loadMoreView();
    },
    memoryTabCount(id) {
      if (id === 'precious') return this.precious.length || '';
      if (id === 'glossary') return this.glossary.length || '';
      if (id === 'notebook') return this.notebookLoaded ? this.notebookPages.length : '';
      if (id === 'world') return this.worldItems.length || '';
      return '';
    },
    loadMoreView() {
      if (this.moreView === 'world') {
        this.loadWorldFacts();
      } else if (this.moreView === 'notebook') {
        this.loadNotebook();
      } else if (this.moreView === 'important') {
        this.loadMemories();
      } else {
        this.icons();
      }
    },
    async loadWorldFacts() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/memory?status=active&limit=80&type=world_fact'));
        if (revision !== this.spaceRevision) return;
        this.worldItems = data.data || [];
        this.pruneWorldSelection();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.worldItems = [];
        this.pruneWorldSelection();
        this.notify(error.message);
      }
      this.icons();
    },

    // 报错、乱码、突然拒答这种不想留的原话：删了夜里整理、写日记和召回都不会再读到它。收进珍贵的那份不动。
    async deleteRaw(message) {
      if (!window.confirm(this.L('删掉这句？删了不能恢复。', 'Delete this line? This cannot be undone.'))) return;
      try {
        await this.request(this.withNamespace('/v1/raw/' + encodeURIComponent(message.id)), { method: 'DELETE' });
        this.todayMessages = this.todayMessages.filter(function(item) { return item.id !== message.id; });
        if (this.stats.today_raw_count) this.stats.today_raw_count -= 1;
        this.notify(this.L('删掉了', 'Deleted'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async pinMessage(message) {
      try {
        await this.request(this.withNamespace('/v1/precious'), {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, content: message.content, context_message_ids: [message.id], source: 'human' })
        });
        await this.loadBoot();
        this.notify(this.L('已收进珍贵', 'Saved as a keepsake'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    toggleCandidateEdit(candidate) {
      candidate.editing = !candidate.editing;
      candidate.draft = { content: candidate.content, type: candidate.type, fact_key: candidate.fact_key || '' };
      this.icons();
    },
    candidatePayload(candidate) {
      const draft = candidate.editing ? candidate.draft : candidate;
      return {
        namespace: this.namespace,
        content: draft.content || candidate.content,
        type: draft.type || candidate.type,
        fact_key: draft.fact_key || candidate.fact_key || null,
        confidence: candidate.confidence,
        importance: candidate.importance,
        tags: candidate.tags || [],
        source_message_ids: candidate.source_message_ids || []
      };
    },
    async approveCandidate(candidate) {
      try {
        await this.request(this.withNamespace('/v1/candidates/' + encodeURIComponent(candidate.id) + '/approve'), {
          method: 'POST',
          body: JSON.stringify(this.candidatePayload(candidate))
        });
        if (candidate.import_id) {
          this.dropImportCandidate(candidate);
          await Promise.all([this.loadMemories(), this.loadBoot()]);
        } else {
          await Promise.all([this.loadCandidates(), this.loadMemories(), this.loadBoot()]);
        }
        this.notify(candidate.source === 'dream_delete' ? this.L('已移除', 'Removed') : this.L('记住了', 'Remembered'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async discardCandidate(candidate) {
      try {
        await this.request(this.withNamespace('/v1/candidates/' + encodeURIComponent(candidate.id) + '/discard'), {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace })
        });
        if (candidate.import_id) {
          this.dropImportCandidate(candidate);
          await this.loadBoot();
        } else {
          await Promise.all([this.loadCandidates(), this.loadBoot()]);
        }
        this.notify(candidate.source === 'dream_delete' ? this.L('留着了', 'Kept') : this.L('已丢弃', 'Discarded'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async mergeCandidate(candidate) {
      if (!candidate.target_id) {
        this.notify(this.L('先填要并进去的那条记忆的 id', 'Enter the id of the memory to merge into'));
        return;
      }
      try {
        const payload = this.candidatePayload(candidate);
        payload.target_id = candidate.target_id;
        await this.request(this.withNamespace('/v1/candidates/' + encodeURIComponent(candidate.id) + '/merge'), {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        await Promise.all([this.loadCandidates(), this.loadMemories(), this.loadBoot()]);
        this.notify(this.L('已合并', 'Merged'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    toggleMemoryEdit(memory) {
      memory.editing = !memory.editing;
      memory.draft = { content: memory.content };
      this.icons();
    },
    openMemoryCreate() {
      const fallback = this.memoryType && this.memoryType !== 'all' ? this.memoryType : 'fact';
      this.memoryDraft = { type: fallback, content: '', fact_key: '', importance: 0.7, confidence: 0.85 };
      this.memoryCreateOpen = true;
      this.icons();
    },
    async ensureFactKey(type, content) {
      const trimmed = (content || '').trim();
      if (!trimmed) return null;
      try {
        const data = new TextEncoder().encode(type + ':' + trimmed);
        const buf = await crypto.subtle.digest('SHA-1', data);
        const hex = Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        return 'manual:' + type + ':' + hex.slice(0, 10);
      } catch (error) {
        return 'manual:' + type + ':' + Date.now().toString(36);
      }
    },
    async createMemory() {
      const content = (this.memoryDraft.content || '').trim();
      if (!content) { this.notify(this.L('内容不能为空', 'Content can’t be empty')); return; }
      const type = (this.memoryDraft.type || 'fact').trim() || 'fact';
      let factKey = (this.memoryDraft.fact_key || '').trim();
      if (!factKey) factKey = await this.ensureFactKey(type, content);
      this.saving = true;
      try {
        await this.request(this.withNamespace('/v1/memories'), {
          method: 'POST',
          body: JSON.stringify({
            namespace: this.namespace,
            type: type,
            content: content,
            fact_key: factKey,
            importance: Number(this.memoryDraft.importance),
            confidence: Number(this.memoryDraft.confidence),
            source: 'manual'
          })
        });
        this.memoryCreateOpen = false;
        this.memoryType = type;
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        this.notify(this.L('新记忆存好了', 'Memory saved'));
      } catch (error) {
        this.notify(error.message);
      }
      this.saving = false;
    },
    async saveMemory(memory) {
      try {
        await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.id)), {
          method: 'PATCH',
          body: JSON.stringify({
            namespace: this.namespace,
            type: memory.type,
            content: memory.draft.content,
            confidence: memory.confidence,
            importance: memory.importance,
            tags: memory.tags || []
          })
        });
        await this.loadMemories();
        this.notify(this.L('记忆已保存', 'Memory saved'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async deleteMemory(memory) {
      if (!window.confirm(this.L('确认移除这条记忆？', 'Remove this memory?'))) return;
      try {
        await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.id)), { method: 'DELETE' });
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        if (this.page === 'memory' && this.moreView === 'world') await this.loadWorldFacts();
        this.notify(this.L('已移除', 'Removed'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async deleteWorldMemory(item) {
      if (!window.confirm(this.L('确认删除这条世界知识？', 'Delete this world fact?'))) return;
      try {
        await this.deleteWorldItem(item);
        delete this.worldSelection[this.worldItemKey(item)];
        this.worldSelection = Object.assign({}, this.worldSelection);
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        if (this.moreView === 'world') await this.loadWorldFacts();
        this.notify(this.L('已删除', 'Deleted'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    worldItemKey(item) {
      return (item.type === 'longtail' ? 'longtail' : 'memory') + ':' + item.id;
    },
    isWorldSelected(item) {
      return Boolean(this.worldSelection[this.worldItemKey(item)]);
    },
    selectedWorldItems() {
      return this.worldItems.filter(function(item) { return this.isWorldSelected(item); }, this);
    },
    selectedWorldCount() {
      return this.selectedWorldItems().length;
    },
    toggleWorldItem(item) {
      const key = this.worldItemKey(item);
      const next = Object.assign({}, this.worldSelection);
      if (next[key]) delete next[key];
      else next[key] = true;
      this.worldSelection = next;
    },
    selectAllWorldItems() {
      const next = Object.assign({}, this.worldSelection);
      for (const item of this.worldItems) next[this.worldItemKey(item)] = true;
      this.worldSelection = next;
      this.icons();
    },
    clearWorldSelection() {
      this.worldSelection = {};
      this.icons();
    },
    pruneWorldSelection() {
      const visible = new Set(this.worldItems.map(function(item) { return this.worldItemKey(item); }, this));
      const next = {};
      for (const key of Object.keys(this.worldSelection)) {
        if (visible.has(key)) next[key] = true;
      }
      this.worldSelection = next;
    },
    async deleteWorldItem(item) {
      if (item.type === 'longtail') {
        await this.request(this.withNamespace('/v1/longtail/' + encodeURIComponent(item.id)), { method: 'DELETE' });
        return;
      }
      await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(item.id)), { method: 'DELETE' });
    },
    async deleteSelectedWorldItems() {
      const items = this.selectedWorldItems();
      if (items.length === 0) return;
      if (!window.confirm(this.L('确认删除选中的 ' + items.length + ' 条世界知识？', 'Delete the ' + items.length + ' selected world facts?'))) return;
      this.saving = true;
      let failed = 0;
      try {
        for (let index = 0; index < items.length; index += 5) {
          const batch = items.slice(index, index + 5);
          const results = await Promise.allSettled(batch.map(function(item) { return this.deleteWorldItem(item); }, this));
          failed += results.filter(function(result) { return result.status === 'rejected'; }).length;
        }
        this.clearWorldSelection();
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        if (this.moreView === 'world') await this.loadWorldFacts();
        this.notify(failed ? this.L('部分删除失败：' + failed + ' 条', failed + ' couldn’t be deleted') : this.L('已删除 ' + items.length + ' 条', 'Deleted ' + items.length));
      } catch (error) {
        this.notify(error.message);
      }
      this.saving = false;
    },
    async mergeDuplicate(memory) {
      if (!memory.target_id) {
        this.notify(this.L('先填要并进去的那条记忆的 id', 'Enter the id of the memory to merge into'));
        return;
      }
      try {
        const target = await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.target_id)));
        const combined = (target.data.content || '') + '\n' + memory.content;
        await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.target_id)), {
          method: 'PATCH',
          body: JSON.stringify({ namespace: this.namespace, content: combined, type: target.data.type, tags: target.data.tags || [] })
        });
        await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.id)), { method: 'DELETE' });
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        this.notify(this.L('已合并成一条', 'Merged into one'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async unpinPrecious(item) {
      try {
        await this.request(this.withNamespace('/v1/precious/' + encodeURIComponent(item.id)), { method: 'DELETE' });
        await this.loadBoot();
        this.notify(this.L('已取消珍贵', 'Removed from keepsakes'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    splitText(value) {
      return String(value || '').split(/[,，\s]+/).map(function(item) { return item.trim(); }).filter(Boolean);
    },
    async saveGlossary() {
      try {
        await this.request(this.withNamespace('/v1/glossary'), {
          method: 'POST',
          body: JSON.stringify({
            namespace: this.namespace,
            term: this.glossaryDraft.term,
            aliases: this.splitText(this.glossaryDraft.aliasesText),
            definition: this.glossaryDraft.definition
          })
        });
        this.glossaryDraft = { term: '', definition: '', aliasesText: '' };
        await this.loadBoot();
        this.notify(this.L('黑话已保存', 'Word saved'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async deleteGlossary(item) {
      if (!window.confirm(this.L('删除「' + item.term + '」？', 'Delete “' + item.term + '”?'))) return;
      try {
        await this.request(this.withNamespace('/v1/glossary/' + encodeURIComponent(item.id)), { method: 'DELETE' });
        await this.loadBoot();
        this.notify(this.L('黑话已删除', 'Word deleted'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async loadNotebook() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/notebook'));
        if (revision !== this.spaceRevision) return;
        this.notebookPages = data.data || [];
        this.notebookLoaded = true;
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
      this.icons();
    },
    newNotebookPage() {
      this.notebookDraft = { id: '', name: '', content: '', updated_at: '' };
      this.revealSoon('notebook-editor');
      this.icons();
    },
    async openNotebookPage(item) {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/notebook/' + encodeURIComponent(item.id)));
        if (revision !== this.spaceRevision) return;
        const page = data.data || {};
        this.notebookDraft = { id: page.id, name: page.name, content: page.content, updated_at: page.updated_at };
        this.revealSoon('notebook-editor');
      } catch (error) {
        this.notify(error.message);
      }
      this.icons();
    },
    notebookDraftLabel() {
      const draft = this.notebookDraft;
      if (!draft) return '';
      const length = Array.from(draft.content || '').length;
      const size = this.L(length + ' / 20000 字', length + ' / 20,000 chars');
      return draft.updated_at ? size + this.L(' · 改于 ', ' · edited ') + this.fmt(draft.updated_at) : size + this.L(' · 新的一页', ' · new page');
    },
    async saveNotebookPage() {
      const draft = this.notebookDraft;
      if (!draft) return;
      // 和服务端一样：去头尾空白，中间连续空白并成一个空格。
      const name = String(draft.name || '').replace(/\s+/g, ' ').trim();
      if (!name || !String(draft.content || '').trim()) {
        this.notify(this.L('页名和内容都要填', 'A page needs a name and some content'));
        return;
      }
      if (!draft.id && this.notebookPages.some(function(item) { return item.name === name; })) {
        if (!window.confirm(this.L('已经有一页叫「' + name + '」，确认用这次写的整页替换它？', 'A page called “' + name + '” already exists. Replace it with this one?'))) return;
      }
      this.saving = true;
      try {
        const body = JSON.stringify({ namespace: this.namespace, name: name, content: draft.content });
        const data = draft.id
          ? await this.request(this.withNamespace('/v1/notebook/' + encodeURIComponent(draft.id)), { method: 'PATCH', body: body })
          : await this.request(this.withNamespace('/v1/notebook'), { method: 'POST', body: body });
        const page = data.data || {};
        this.notebookDraft = { id: page.id, name: page.name, content: page.content, updated_at: page.updated_at };
        await this.loadNotebook();
        this.notify(this.L('这一页已保存', 'Page saved'));
      } catch (error) {
        this.notify(error.message);
      }
      this.saving = false;
    },
    async deleteNotebookPage() {
      const draft = this.notebookDraft;
      if (!draft || !draft.id) return;
      if (!window.confirm(this.L('确认删除「' + draft.name + '」这一页？', 'Delete the page “' + draft.name + '”?'))) return;
      try {
        await this.request(this.withNamespace('/v1/notebook/' + encodeURIComponent(draft.id)), { method: 'DELETE' });
        this.notebookDraft = null;
        await this.loadNotebook();
        this.notify(this.L('这一页已删除', 'Page deleted'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async clearNotebook() {
      if (this.notebookPages.length === 0) return;
      if (!window.confirm(this.L('确认清空小本本？「' + this.namespace + '」里的 ' + this.notebookPages.length + ' 页会全部删掉，找不回来。', 'Clear the notebook? All ' + this.notebookPages.length + ' pages in “' + this.namespace + '” will be deleted for good.'))) return;
      try {
        const data = await this.request(this.withNamespace('/v1/notebook?confirm=all'), { method: 'DELETE' });
        this.notebookDraft = null;
        await this.loadNotebook();
        const deleted = (data.data && data.data.deleted) || 0;
        this.notify(this.L('小本本已清空，删了 ' + deleted + ' 页', 'Notebook cleared: ' + deleted + ' pages deleted'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    async searchWorld() {
      const revision = this.spaceRevision;
      if (!this.worldQuery.trim()) {
        await this.loadWorldFacts();
        return;
      }
      try {
        const data = await this.request(this.withNamespace('/v1/memory/search'), {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, query: this.worldQuery, top_k: 30, filter: false })
        });
        if (revision !== this.spaceRevision) return;
        this.worldItems = data.data || [];
        this.pruneWorldSelection();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
      this.icons();
    },
    async runHealth() {
      try {
        const data = await this.request('/v1/debug/vector_health');
        this.debugOutput = JSON.stringify(data, null, 2);
      } catch (error) {
        this.debugOutput = error.message;
      }
    },
    async runReindex(dryRun) {
      try {
        const data = await this.request('/v1/debug/vector_reindex', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, limit: 50, dry_run: dryRun })
        });
        this.debugOutput = JSON.stringify(data, null, 2);
      } catch (error) {
        this.debugOutput = error.message;
      }
    },
    async runBackfill(dryRun) {
      try {
        const data = await this.request('/v1/vector-backfill', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, limit: 50, dry_run: dryRun })
        });
        this.debugOutput = JSON.stringify(data, null, 2);
      } catch (error) {
        this.debugOutput = error.message;
      }
    },
    async runDream() {
      if (!window.confirm(this.L('立刻把「' + this.namespace + '」整理一遍？已经整理过的晚上也会重来。', 'Run the nightly process for “' + this.namespace + '” now? Nights already processed will be redone.'))) return;
      try {
        const data = await this.request('/v1/memories/dream', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, force: true, max_runs: 3 })
        });
        this.debugOutput = JSON.stringify(data, null, 2);
        await this.reloadAll();
      } catch (error) {
        this.debugOutput = error.message;
      }
    },
    go(id) {
      this.stopDreamPolling();
      this.navOpen = false;
      // 星图是独立的 Three.js 页面，跳过去，不嵌在这里
      if (id === 'starmap') {
        window.location.href = '/admin/starmap';
        return;
      }
      this.page = id;
      if (id === 'today') this.loadHome();
      if (id === 'settings') { this.loadRecallHistory(); this.chatgptLoad(); if (!this.gwGroups.length && this.savedApiKey.trim()) this.gwLoad(); }
      if (id === 'review') { this.loadCandidates(); this.loadJudgeDecisions(); }
      if (id === 'memory') this.loadMoreView();
      if (id === 'diary') { this.diaryReading = false; this.loadDiary(); }
      if (id === 'transfer') { this.loadTransferInfo(); this.loadImportBatches(); }
      if (id === 'dream') {
        this.loadDreamStatus();
        this.loadDreamHarvest();
      }
      this.scrollTop();
      this.icons();
    },
    async loadDiary() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/admin/diary?limit=30'));
        if (revision !== this.spaceRevision) return;
        const payload = data.data || {};
        this.diaryDailies = payload.dailies || [];
        this.diaryWeeklies = payload.weeklies || [];
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
      this.icons();
    },
    diaryListItems() {
      const self = this;
      if (this.diaryMode === 'weekly') {
        return this.diaryWeeklies.map(function(entry) {
          return { key: 'weekly:' + entry.week, when: entry.week + ' · ' + entry.start_date + ' – ' + entry.end_date, title: entry.title, excerpt: self.excerpt(entry.summary) };
        });
      }
      return this.diaryDailies.map(function(entry) {
        return { key: 'daily:' + entry.date, when: self.dayLabel(entry.date), title: entry.title, excerpt: self.excerpt(entry.summary) };
      });
    },
    diaryCurrentKey() {
      const items = this.diaryListItems();
      const pick = this.diaryPick;
      if (items.some(function(item) { return item.key === pick; })) return pick;
      return items.length ? items[0].key : '';
    },
    diaryCurrent() {
      const key = this.diaryCurrentKey();
      if (!key) return null;
      const cut = key.indexOf(':');
      const kind = key.slice(0, cut);
      const id = key.slice(cut + 1);
      if (kind === 'weekly') return this.diaryWeeklies.find(function(entry) { return entry.week === id; }) || null;
      return this.diaryDailies.find(function(entry) { return entry.date === id; }) || null;
    },
    diaryReasonLabel(reason, error) {
      const zh = {
        disabled: '日记写手没有开启',
        no_messages: '这一天没有可用的聊天原文',
        week_already_rolled_up: '这一周已经汇总成周记，不再重写',
        ungrounded_sources: '模型给的原文来源对不上，没有写入',
        model_error: '模型出错',
        model_invalid_json: '模型返回格式不合要求'
      };
      const en = {
        disabled: 'The journal writer is off',
        no_messages: 'No chat transcript for that day',
        week_already_rolled_up: 'That week is already in a weekly summary, so it can’t be rewritten',
        ungrounded_sources: 'The model’s sources didn’t match the transcript; nothing written',
        model_error: 'Model error',
        model_invalid_json: 'The model returned an invalid format'
      };
      return (this.lang === 'en' ? en : zh)[reason] || error || reason || this.L('原因未知', 'Unknown reason');
    },
    async rewriteDiary(entry) {
      if (this.diaryRewriting) return;
      if (!window.confirm(this.L('用 ' + entry.date + ' 的聊天原文重写这篇日记，现在的内容会被覆盖。继续？', 'Rewrite this entry from the ' + entry.date + ' transcript? The current text will be replaced.'))) return;
      const revision = this.spaceRevision;
      this.diaryRewriting = entry.date;
      try {
        const data = await this.request('/admin/diary-rewrite', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, date: entry.date })
        });
        if (revision !== this.spaceRevision) return;
        const stats = (data.data && data.data.stats) || {};
        if (stats.ran) {
          this.notify(this.L('日记已重写：', 'Entry rewritten: ') + entry.date);
          await this.loadDiary();
        } else {
          this.notify(this.L('没有重写：', 'Not rewritten: ') + this.diaryReasonLabel(stats.reason, stats.error));
        }
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      } finally {
        if (revision === this.spaceRevision) this.diaryRewriting = '';
      }
    },
    isDiaryExpanded(key) {
      return Boolean(this.diaryExpanded[key]);
    },
    toggleDiaryExpand(key) {
      const next = Object.assign({}, this.diaryExpanded);
      if (next[key]) delete next[key];
      else next[key] = true;
      this.diaryExpanded = next;
    },
    yesterdayLabel() {
      const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pad = function(n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },
    dreamAnchorDate() {
      return (this.dreamStatus && this.dreamStatus.anchor_date_label) || this.yesterdayLabel();
    },
    stopDreamPolling() {
      if (this.dreamPollTimer != null) window.clearTimeout(this.dreamPollTimer);
      this.dreamPollTimer = null;
    },
    scheduleDreamPolling() {
      this.stopDreamPolling();
      if (this.page !== 'dream' || !this.dreamActiveRun || this.dreamActiveRun.stale) return;
      const revision = this.spaceRevision;
      this.dreamPollTimer = window.setTimeout(() => {
        this.dreamPollTimer = null;
        if (revision === this.spaceRevision && this.page === 'dream') this.loadDreamStatus();
      }, 5000);
    },
    async loadDreamStatus() {
      const revision = this.spaceRevision;
      this.stopDreamPolling();
      this.dreamLoading = true;
      this.dreamStatusError = '';
      try {
        const data = await this.request(this.withNamespace('/v1/dream/status'));
        if (revision !== this.spaceRevision) return;
        const payload = data.data || {};
        this.dreamStatus = payload;
        this.dreamRuns = payload.dream_runs || [];
        this.dreamActiveRun = payload.active_run || this.dreamRuns.find(function(run) {
          return run.status === 'queued' || run.status === 'running';
        }) || null;
        const tracked = this.dreamRunResult && this.dreamRunResult.run_id;
        const run = tracked && (this.dreamRuns.find(function(item) { return item.id === tracked; })
          || (this.dreamActiveRun && this.dreamActiveRun.id === tracked ? this.dreamActiveRun : null));
        if (run) {
          const previousStatus = this.dreamRunResult.status;
          this.dreamRunResult.status = run.status;
          this.dreamRunResult.stale = run.stale;
          if ((previousStatus === 'queued' || previousStatus === 'running') && run.status !== 'queued' && run.status !== 'running') {
            this.loadDreamHarvest();
          }
        }
        this.scheduleDreamPolling();
        if (!this.dreamDate) this.dreamDate = this.dreamAnchorDate();
        if (!this.dreamHarvestDate) this.dreamHarvestDate = this.dreamAnchorDate();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.dreamStatusError = this.L('状态读取失败，任务是否完成尚未确认。请刷新核查，不要直接重跑。', 'Couldn’t read the status, so whether the run finished is unconfirmed. Refresh to check; don’t just run it again.');
        this.notify(error.message);
      }
      this.dreamLoading = false;
      this.icons();
    },
    async loadDreamHarvest() {
      const revision = this.spaceRevision;
      if (!this.dreamHarvestDate) this.dreamHarvestDate = this.dreamAnchorDate();
      this.dreamHarvestLoading = true;
      try {
        const data = await this.request(this.withNamespace('/admin/dream/harvest?date=' + encodeURIComponent(this.dreamHarvestDate)));
        if (revision !== this.spaceRevision) return;
        this.dreamHarvest = data.data || null;
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.dreamHarvest = null;
        this.notify(error.message);
      }
      this.dreamHarvestLoading = false;
      this.icons();
    },
    refreshDream() {
      this.loadDreamStatus();
      this.loadDreamHarvest();
    },
    // 失败的那一晚：把日期填进「手动整理一晚」，切成真跑，滚过去等你点「开始」。
    prepareRerun(run) {
      if (!run) return;
      if (this.page !== 'dream') this.go('dream');
      this.dreamDate = run.date_label;
      this.dreamDryRun = false;
      this.dreamForce = false;
      this.revealSoon('dream-run');
    },
    async resolveDreamRun() {
      const run = this.dreamActiveRun;
      if (this.dreamResolving || !run || !run.stale) return;
      if (!window.confirm(this.L('确认任务 ' + run.id + ' 已经不在执行？标记后可以重新发起，但它可能已经写入了部分记忆，建议先查 Worker 日志。', 'Confirm run ' + run.id + ' is no longer running? You can start again afterwards, but it may have saved some memories already; check the Worker logs first.'))) return;
      const revision = this.spaceRevision;
      this.dreamResolving = true;
      try {
        await this.request('/v1/dream/resolve', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, run_id: run.id })
        });
        if (revision !== this.spaceRevision) return;
        this.notify(this.L('已标记为已中断：', 'Marked as stopped: ') + run.id);
        await this.loadDreamStatus();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
        await this.loadDreamStatus();
      } finally {
        if (revision === this.spaceRevision) this.dreamResolving = false;
      }
    },
    async triggerDream() {
      if (this.dreamTriggering || (!this.dreamDryRun && this.dreamActiveRun)) return;
      const revision = this.spaceRevision;
      const dryRun = this.dreamDryRun;
      const date = this.dreamDate || this.dreamAnchorDate();
      if (this.dreamForce && !this.dreamDryRun) {
        if (!window.confirm(this.L('会把 ' + date + ' 这一晚重新整理一遍，已经整理过的也会重来。继续吗？', 'This redoes the night of ' + date + ', even if it was already processed. Continue?'))) return;
      }
      this.dreamTriggering = true;
      this.dreamRunResult = null;
      try {
        const data = await this.request('/v1/dream/run', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, date: date, force: this.dreamForce, dry_run: dryRun, background: true })
        });
        if (revision !== this.spaceRevision) return;
        this.dreamRunResult = data.data || null;
        if (!dryRun) {
          this.dreamHarvestDate = date;
          if (this.dreamRunResult && this.dreamRunResult.run_id) {
            this.notify(this.L('已排队，任务 ', 'Queued: run ') + this.dreamRunResult.run_id);
          }
          await this.loadDreamStatus();
        }
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
        if (!dryRun) await this.loadDreamStatus();
      }
      this.dreamTriggering = false;
      this.icons();
    },
    dreamLatestRun() {
      return this.dreamRuns.length ? this.dreamRuns[0] : null;
    },
    dreamLatestLabel() {
      const run = this.dreamLatestRun();
      return run ? this.dreamStatusLabel(run.status, run.stale) : this.L('还没有记录', 'No runs yet');
    },
    dreamLatestSub() {
      const run = this.dreamLatestRun();
      return run ? this.dayLabel(run.date_label, true) + ' · ' + this.clock(run.started_at) + ' · ' + this.dreamDuration(run) : '';
    },
    dreamOkCount() {
      return this.dreamRuns.filter(function(run) { return run.status === 'ok'; }).length;
    },
    dreamFinishedCount() {
      return this.dreamRuns.filter(function(run) { return run.status === 'ok' || run.status === 'error'; }).length;
    },
    dreamFirstFailed() {
      return this.dreamRuns.find(function(run) { return run.status === 'error' && !run.stale; }) || null;
    },
    dreamSuccessRate() {
      const total = this.dreamFinishedCount();
      if (!total) return '—';
      return Math.round((this.dreamOkCount() / total) * 100) + '%';
    },
    dreamProcessedTotal() {
      return this.dreamRuns.reduce(function(sum, run) { return sum + (Number(run.processed_messages) || 0); }, 0);
    },
    dreamAnchorLabel() {
      const payload = this.dreamStatus || {};
      if (!payload.anchor_date_label) return '';
      return this.L('锚点 ', 'Anchor ') + payload.anchor_date_label + (payload.time_zone ? ' · ' + payload.time_zone : '');
    },
    dreamDayBars() {
      const payload = this.dreamStatus || {};
      const counts = payload.raw_message_counts || [];
      const cursors = {};
      (payload.cursors || []).forEach(function(item) { cursors[item.date_label] = item.cursor; });
      const max = counts.reduce(function(m, item) { return Math.max(m, Number(item.raw_messages) || 0); }, 0);
      const self = this;
      return counts.map(function(item) {
        const cursor = cursors[item.date_label];
        const done = typeof cursor === 'string' && cursor.indexOf('done:') === 0;
        const raw = Number(item.raw_messages) || 0;
        return {
          date: item.date_label,
          raw: raw,
          done: done,
          pending: raw > 0 && !done,
          widthPct: max > 0 && raw > 0 ? Math.max(Math.round((raw / max) * 100), 4) : 0,
          stateLabel: done ? self.L('已整理', 'Done') : (cursor ? self.L('整理到一半', 'Partly done') : (raw > 0 ? self.L('待整理', 'Pending') : self.L('没有消息', 'No chats')))
        };
      });
    },
    dreamStatusLabel(status, stale) {
      if (stale && (status === 'queued' || status === 'running')) return this.L('可能中断 / 状态未确认', 'May have stopped / unconfirmed');
      const zh = { ok: '完成', error: '失败', skipped: '跳过', queued: '排队中', running: '进行中' };
      const en = { ok: 'Done', error: 'Failed', skipped: 'Skipped', queued: 'Queued', running: 'Running' };
      return (this.lang === 'en' ? en : zh)[status] || status || this.L('未知', 'Unknown');
    },
    dreamStatusChipClass(status) {
      return { ok: 'chip-ok', error: 'chip-err', skipped: 'chip-dim', queued: 'chip-warn', running: 'chip-warn' }[status] || 'chip-dim';
    },
    dreamRailClass(status) {
      return { ok: 'rail-ok', error: 'rail-err', skipped: 'rail-dim', running: 'rail-run', queued: 'rail-run', stale: 'rail-run' }[status] || 'rail-dim';
    },
    dreamTriggerLabel(trigger) {
      const zh = { cron: '自动', manual: '手动' };
      const en = { cron: 'Scheduled', manual: 'Manual' };
      return (this.lang === 'en' ? en : zh)[trigger] || trigger || '—';
    },
    dreamDuration(run) {
      if (run.stale) return this.L('状态未确认', 'Unconfirmed');
      if (!run.finished_at) return run.status === 'running' ? this.L('进行中', 'Running') : (run.status === 'queued' ? this.L('等待中', 'Waiting') : '—');
      const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
      if (!Number.isFinite(ms) || ms < 0) return '—';
      const sec = Math.round(ms / 1000);
      if (sec < 60) return sec + 's';
      return Math.floor(sec / 60) + 'm' + String(sec % 60).padStart(2, '0') + 's';
    },
    dreamReasonLabel(reason) {
      const zh = {
        already_done: '这一晚已经整理过了',
        no_messages: '没有新消息',
        dry_run: '只是预览',
        dream_disabled: '夜间整理没开',
        model_error: '模型出错',
        model_timeout: '模型请求超时',
        model_invalid_json: '模型返回格式不合要求',
        extract_model_error: '抽取模型出错',
        extract_model_timeout: '抽取模型请求超时',
        extract_invalid_json: '抽取结果格式不合要求',
        run_failed: '整理异常退出，请先核查是否部分落库',
        enqueue_failed: '任务未确认入队',
        marked_interrupted: '已核查并标记为中断',
        execution_failed: '后台任务异常退出',
        v2_disabled: 'v2 未启用'
      };
      const en = {
        already_done: 'This night was already processed',
        no_messages: 'No new messages',
        dry_run: 'Preview only',
        dream_disabled: 'The nightly run is off',
        model_error: 'Model error',
        model_timeout: 'Model request timed out',
        model_invalid_json: 'The model returned an invalid format',
        extract_model_error: 'Extraction model error',
        extract_model_timeout: 'Extraction model timed out',
        extract_invalid_json: 'Extraction returned an invalid format',
        run_failed: 'The run stopped unexpectedly; check whether some memories were saved first',
        enqueue_failed: 'Couldn’t confirm the run was queued',
        marked_interrupted: 'Checked and marked as stopped',
        execution_failed: 'The background job stopped unexpectedly',
        v2_disabled: 'v2 is not enabled'
      };
      return (this.lang === 'en' ? en : zh)[reason] || reason || this.L('原因未知', 'Unknown reason');
    },
    dreamRunNote(run) {
      const parts = [];
      if (run.stale) parts.push(this.L('超过 20 分钟未确认完成，可能中断；不会自动重跑', 'Not confirmed done after 20 minutes; it may have stopped and won’t re-run on its own'));
      if (run.reason) parts.push(this.dreamReasonLabel(run.reason));
      if (run.error) {
        let text = run.error;
        try {
          const parsed = JSON.parse(run.error);
          if (Array.isArray(parsed)) {
            text = this.L(parsed.length + ' 条落库出错：', parsed.length + ' failed to save: ') + parsed.map(function(item) {
              return (item.target_id || '?') + '（' + (item.reason || '?') + '）';
            }).join(this.L('；', '; '));
          }
        } catch (error) {}
        parts.push(text);
      }
      return parts.join(' · ');
    },
    isDreamExpanded(id) {
      return Boolean(this.dreamExpanded[id]);
    },
    toggleDreamExpand(id) {
      const next = Object.assign({}, this.dreamExpanded);
      if (next[id]) delete next[id];
      else next[id] = true;
      this.dreamExpanded = next;
    },
    dreamProposal() {
      return this.dreamRunResult && this.dreamRunResult.proposal ? this.dreamRunResult.proposal : null;
    },
    dreamProposalList(key) {
      const proposal = this.dreamProposal();
      return proposal && Array.isArray(proposal[key]) ? proposal[key] : [];
    },
    dreamExtracted() {
      return this.dreamRunResult && Array.isArray(this.dreamRunResult.extracted_memories) ? this.dreamRunResult.extracted_memories : [];
    },
    dreamRoutingGroups() {
      const plan = this.dreamRunResult && this.dreamRunResult.routing_plan;
      const items = plan && Array.isArray(plan.items) ? plan.items : [];
      const groups = {};
      const order = [];
      const self = this;
      items.forEach(function(item) {
        const dest = item.destination || 'candidate';
        if (!groups[dest]) {
          groups[dest] = { key: dest, label: dest === 'world_fact_direct' ? self.L('直达世界知识', 'Straight to world facts') : self.L('进待审', 'To Review'), items: [] };
          order.push(dest);
        }
        groups[dest].items.push(item);
      });
      return order.map(function(key) { return groups[key]; });
    },
    dreamRoutingKindLabel(kind) {
      const zh = { extract: '抽取', add: '新增', update: '更新', delete: '归档' };
      const en = { extract: 'Extract', add: 'Add', update: 'Update', delete: 'Archive' };
      return (this.lang === 'en' ? en : zh)[kind] || kind || '—';
    },
    dreamRunStatsLine() {
      const stats = this.dreamRunResult && this.dreamRunResult.result && this.dreamRunResult.result.stats;
      if (!stats) return '';
      return this.L('处理消息 ', 'Messages ') + (stats.processedMessages || 0)
        + this.L(' · 新增 ', ' · added ') + (stats.addedMemories || 0)
        + this.L(' · 更新 ', ' · updated ') + (stats.updatedMemories || 0)
        + this.L(' · 归档 ', ' · archived ') + (stats.deletedMemories || 0)
        + this.L(' · 进待审 ', ' · to Review ') + (stats.queuedCandidates || 0);
    },
    dreamHarvestCreated() {
      return (this.dreamHarvest && this.dreamHarvest.created) || [];
    },
    dreamHarvestDormant() {
      return (this.dreamHarvest && this.dreamHarvest.dormant) || [];
    },
    dreamHarvestCandidates() {
      return (this.dreamHarvest && this.dreamHarvest.candidates) || [];
    },
    dreamDormantLabel(status) {
      if (status === 'superseded') return this.L('被新的接替', 'Replaced');
      if (status === 'archived') return this.L('归档', 'Archived');
      return status || '—';
    },
    dreamCandidateStatusLabel(status) {
      if (status === 'approved') return this.L('记住了', 'Remembered');
      if (status === 'discarded') return this.L('没记', 'Skipped');
      return status || '—';
    },
    dreamCandidateSourceLabel(source) {
      const zh = { dream_add: '新增提案', dream_update: '更新提案', dream_delete: '移除提案', extract: '抽取', zone_full: '区满' };
      const en = { dream_add: 'Proposed add', dream_update: 'Proposed update', dream_delete: 'Proposed removal', extract: 'Extracted', zone_full: 'Zone full' };
      return (this.lang === 'en' ? en : zh)[source] || source || '—';
    },
    pct(value) {
      return Math.round(Number(value || 0) * 100) + '%';
    },
    fmt(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString(this.locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    },
    jsonList(value) {
      if (Array.isArray(value)) return value;
      try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    },
    get memoryTypes() {
      // 固定分类：全部 + 8 个 canonical 类型。类型在写入层已被 clampMemoryType
      // 收敛，面板不再派生自由类型 tab。全部 用于排查历史脏数据。
      return ['all'].concat(this.canonicalMemoryTypes);
    },
    memoryTypeLabel(type) {
      return type === 'all' ? this.L('全部', 'All') : this.typeLabel(type);
    },
    typeCount(type) {
      const rows = this.stats.memory_type_counts || [];
      if (type === 'all') {
        return rows.reduce(function(sum, row) { return sum + Number(row.count || 0); }, 0);
      }
      const hit = rows.find(function(row) { return row.type === type; });
      return hit ? hit.count : 0;
    },
    typeLimit(type) {
      if (type === 'all') {
        return Object.keys(this.limits).reduce(function(sum, key) { return sum + this.limits[key]; }.bind(this), 0);
      }
      return this.limits[type] || 100;
    },
    capacityUsed() {
      return this.typeCount('all');
    },
    capacityTotal() {
      return this.typeLimit('all');
    },
    capacityPercent() {
      const total = this.capacityTotal();
      return total ? Math.min(100, Math.round(this.capacityUsed() / total * 100)) : 0;
    },
    capacityLabel() {
      return this.capacityUsed() + '/' + this.capacityTotal();
    },
    // ===== 导入导出 =====
    nsPath(path, ns) {
      const sep = path.indexOf('?') === -1 ? '?' : '&';
      return path + sep + 'namespace=' + encodeURIComponent(ns || 'default');
    },
    async sha256(text) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
    },
    fmtTokens(value) {
      const n = Number(value || 0);
      if (this.lang === 'en') {
        if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k';
        return String(n);
      }
      if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + ' 万';
      return String(n);
    },
    quoteTime(value) {
      // 只知道哪天的原话就是 YYYY-MM-DD；有时间的换成本地时间显示。
      if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const pad = function(n) { return String(n).padStart(2, '0'); };
      return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
    },
    importTypeLabel(type) {
      return this.typeLabel(type || 'fact');
    },
    get importPendingCount() {
      return (this.stats && this.stats.pending_import_candidates) || 0;
    },
    async loadTransferInfo() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/import/info'));
        if (revision !== this.spaceRevision) return;
        this.transfer.info = data.data || null;
      } catch (error) {
        if (revision === this.spaceRevision) this.notify(error.message);
      }
    },
    async loadImportBatches() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/import/batches?limit=50'));
        if (revision !== this.spaceRevision) return;
        this.transfer.batches = data.data || [];
        this.importReview.batches = this.transfer.batches;
      } catch (error) {
        if (revision === this.spaceRevision) this.notify(error.message);
      }
    },
    importBatchLabel(batch) {
      const kind = batch.kind === 'chat' ? this.L('聊天记录', 'Chat history') : this.L('条目', 'List');
      const range = batch.first_date ? this.L('（', ' (') + batch.first_date + (batch.last_date && batch.last_date !== batch.first_date ? this.L(' 到 ', ' to ') + batch.last_date : '') + this.L('）', ')') : '';
      return kind + ' · ' + (batch.name || this.L('没起名', 'untitled')) + range;
    },
    importBatchDetail(batch) {
      const review = this.L('待审 ' + (batch.pending || 0) + '，记住 ' + (batch.approved || 0) + '，丢弃 ' + (batch.discarded || 0), (batch.pending || 0) + ' waiting, ' + (batch.approved || 0) + ' remembered, ' + (batch.discarded || 0) + ' discarded');
      if (batch.kind !== 'chat') return this.L((batch.total_messages || 0) + ' 条，' + (batch.candidates || 0) + ' 条进了待审（' + review + '）', (batch.total_messages || 0) + ' items, ' + (batch.candidates || 0) + ' sent to Review (' + review + ')');
      return this.L('做了 ' + (batch.done_chunks || 0) + ' / ' + (batch.total_chunks || 0) + ' 段，' + (batch.candidates || 0) + ' 条候选（' + review + '），模型 ' + (batch.model_calls || 0) + ' 次，', (batch.done_chunks || 0) + ' / ' + (batch.total_chunks || 0) + ' parts, ' + (batch.candidates || 0) + ' candidates (' + review + '), ' + (batch.model_calls || 0) + ' model calls, ')
        + this.fmtTokens(batch.tokens_in) + this.L(' 进 / ', ' in / ') + this.fmtTokens(batch.tokens_out) + this.L(' 出 token', ' out tokens') + (batch.clef_calls ? ', clef ' + batch.clef_calls : '');
    },
    batchDone(batch) {
      return batch.kind !== 'chat' || (Number(batch.total_chunks) > 0 && Number(batch.done_chunks) >= Number(batch.total_chunks));
    },
    batchStatusLabel(batch) {
      if (this.batchDone(batch)) return this.L('完成', 'Done');
      const total = Number(batch.total_chunks) || 0;
      const percent = total ? Math.round((Number(batch.done_chunks) || 0) / total * 100) : 0;
      const running = this.transfer.chatRun && this.transfer.chatRun.running && this.transfer.chatRun.importId === batch.id;
      return (running ? this.L('进行中 ', 'In progress ') : this.L('没做完 ', 'Unfinished ')) + percent + '%';
    },
    chatStep() {
      const chat = this.transfer.chat;
      const run = this.transfer.chatRun;
      if (!chat) return 1;
      if (run && !run.running && run.total && run.done >= run.total) return 3;
      return 2;
    },
    prepareCandidate(item) {
      item.editing = false;
      item.mergeOpen = false;
      item.moreOpen = false;
      item.target_id = '';
      item.draft = { content: item.content, type: item.type, fact_key: item.fact_key || '' };
      item.sourcesOpen = false;
      item.sources = null;
      return item;
    },
    openImportReview(importId) {
      this.reviewTab = 'import';
      if (typeof importId === 'string') this.importReview.importId = importId;
      this.loadImportBatches();
      this.loadImportCandidates(true);
    },
    importCandidatesPath(extra) {
      const state = this.importReview;
      let path = '/v1/import/candidates' + extra + (extra.indexOf('?') === -1 ? '?' : '&') + 'filter=' + encodeURIComponent(state.filter);
      if (state.importId) path += '&import_id=' + encodeURIComponent(state.importId);
      return this.withNamespace(path);
    },
    async loadImportCandidates(reset) {
      const revision = this.spaceRevision;
      const state = this.importReview;
      if (reset) state.offset = 0;
      state.loading = true;
      try {
        const data = await this.request(this.importCandidatesPath('?limit=50&offset=' + state.offset));
        if (revision !== this.spaceRevision) return;
        const items = (data.data || []).map(this.prepareCandidate);
        state.items = reset ? items : state.items.concat(items);
        state.counts = data.counts || { pending: 0, clef_yes: 0, clef_no: 0 };
        state.offset += items.length;
        state.more = items.length === 50;
      } catch (error) {
        if (revision === this.spaceRevision) this.notify(error.message);
      }
      state.loading = false;
      this.icons();
    },
    async refreshImportCounts() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.importCandidatesPath('?limit=1'));
        if (revision !== this.spaceRevision) return;
        this.importReview.counts = data.counts || this.importReview.counts;
      } catch (error) { /* 数字下次刷新再对 */ }
    },
    dropImportCandidate(candidate) {
      const state = this.importReview;
      const before = state.items.length;
      state.items = state.items.filter(function(item) { return item.id !== candidate.id; });
      if (state.items.length < before) state.offset = Math.max(state.offset - 1, 0);
      this.refreshImportCounts();
    },
    clefLooksYes(candidate) {
      return Number(candidate.clef_grounded) >= 0.5 && Number(candidate.clef_worth) >= 0.5;
    },
    clefOpinionLabel(candidate) {
      return this.L('clef：有依据 ', 'clef: grounded ') + this.pct(candidate.clef_grounded) + ' · ' + (candidate.target_memory_id ? this.L('该替换 ', 'should replace ') : this.L('值得记 ', 'worth keeping ')) + this.pct(candidate.clef_worth);
    },
    async toggleCandidateSources(candidate) {
      candidate.sourcesOpen = !candidate.sourcesOpen;
      if (!candidate.sourcesOpen || candidate.sources) return;
      try {
        const data = await this.request(this.withNamespace('/v1/candidates/' + encodeURIComponent(candidate.id) + '/sources'));
        candidate.sources = (data.data && data.data.messages) || [];
      } catch (error) {
        candidate.sources = [];
        this.notify(error.message);
      }
    },
    async bulkImportCandidates(action, filter) {
      const state = this.importReview;
      const total = filter === 'clef_yes' ? state.counts.clef_yes : state.counts.clef_no;
      const label = action === 'approve' ? this.L('记住', 'Remember') : this.L('丢弃', 'Discard');
      const warning = action === 'approve' ? this.L('记住的直接进长期记忆。', 'They go straight into long-term memory.') : this.L('丢弃的不会进记忆。', 'Discarded ones won’t be remembered.');
      if (!total || !window.confirm(this.L(label + ' ' + total + ' 条？', label + ' ' + total + '? ') + warning)) return;
      const ns = this.namespace;
      const self = this;
      try {
        let path = '/v1/import/candidates/ids?filter=' + filter;
        if (state.importId) path += '&import_id=' + encodeURIComponent(state.importId);
        const data = await this.request(this.nsPath(path, ns));
        const ids = data.data || [];
        state.bulk = { label: this.L('在' + label, action === 'approve' ? 'Remembering' : 'Discarding'), done: 0, total: ids.length, failed: 0 };
        let cursor = 0;
        const worker = async function() {
          while (cursor < ids.length) {
            const id = ids[cursor++];
            try {
              await self.request(self.nsPath('/v1/candidates/' + encodeURIComponent(id) + '/' + action, ns), {
                method: 'POST',
                body: JSON.stringify({ namespace: ns })
              });
            } catch (error) {
              state.bulk.failed += 1;
            }
            state.bulk.done += 1;
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        const failed = state.bulk.failed;
        state.bulk = null;
        this.notify(this.L(label + '了 ' + (ids.length - failed) + ' 条', label + 'ed ' + (ids.length - failed)) + (failed ? this.L('，' + failed + ' 条没成功', '; ' + failed + ' failed') : ''));
      } catch (error) {
        state.bulk = null;
        this.notify(error.message);
      }
      if (ns !== this.namespace) return;
      await Promise.all([this.loadImportCandidates(true), this.loadImportBatches(), this.loadBoot(), this.loadMemories()]);
    },
    async exportMemories(format) {
      this.transfer.exporting = true;
      try {
        if (!this.apiKey.trim()) throw new Error(this.L('请先填写 token', 'Enter your token first'));
        const response = await fetch(this.base() + this.withNamespace('/v1/memories/export?format=' + format), {
          headers: { Authorization: 'Bearer ' + this.apiKey }
        });
        if (!response.ok) {
          const text = await response.text();
          let message = response.status + ' ' + response.statusText;
          try { message = JSON.parse(text).error.message || message; } catch (error) { /* 不是 JSON 就用状态码 */ }
          throw new Error(message);
        }
        const blob = await response.blob();
        const disposition = response.headers.get('content-disposition') || '';
        const match = /filename="?([^";]+)"?/.exec(disposition);
        const name = match ? match[1] : 'aelios-' + this.namespace + '.' + format;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function() { URL.revokeObjectURL(url); }, 2000);
        const count = response.headers.get('x-aelios-memories');
        const precious = response.headers.get('x-aelios-precious') || 0;
        this.notify(count ? this.L('导出了 ' + count + ' 条记忆、' + precious + ' 条珍贵', 'Exported ' + count + ' memories and ' + precious + ' keepsakes') : this.L('导出好了', 'Exported'));
      } catch (error) {
        this.notify(this.L('导出失败：', 'Export failed: ') + error.message);
      }
      this.transfer.exporting = false;
    },
    async copyImportPrompt() {
      if (!this.transfer.info) return;
      try {
        await navigator.clipboard.writeText(this.transfer.info.prompt);
        this.notify(this.L('提示词复制好了', 'Prompt copied'));
      } catch (error) {
        this.notify(this.L('复制不了，手动选中复制吧', 'Couldn’t copy. Select and copy it by hand'));
      }
    },
    async loadEntriesFile(event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      try {
        this.transfer.entriesText = await file.text();
        this.transfer.entriesName = file.name;
        this.transfer.preview = null;
        await this.previewEntries();
      } catch (error) {
        this.notify(this.L('读不了这个文件：', 'Can’t read this file: ') + error.message);
      }
    },
    async previewEntries() {
      const text = this.transfer.entriesText;
      if (!text.trim()) return;
      this.transfer.entriesBusy = true;
      try {
        const data = await this.request(this.withNamespace('/v1/import/entries/preview'), {
          method: 'POST',
          body: JSON.stringify({ text: text })
        });
        this.transfer.preview = data.data || null;
        if (!this.transfer.info) await this.loadTransferInfo();
      } catch (error) {
        this.notify(error.message);
      }
      this.transfer.entriesBusy = false;
      this.icons();
    },
    entriesPreviewLabel() {
      const preview = this.transfer.preview;
      if (!preview) return '';
      const formats = { 'aelios-jsonl': this.L('Aelios 导出的 jsonl', 'Aelios jsonl export'), jsonl: 'jsonl', json: 'json', markdown: this.L('md / 文本', 'md / text') };
      const self = this;
      const types = Object.keys(preview.by_type || {}).map(function(key) {
        return (key === 'precious' ? self.L('珍贵', 'keepsakes') : key === 'unknown' ? self.L('没写类型', 'no type') : self.typeLabel(key)) + ' ' + preview.by_type[key];
      }).join(this.L('、', ', '));
      if (this.lang === 'en') {
        return 'Found ' + preview.total + ' (' + (formats[preview.format] || preview.format) + ')' + (types ? ': ' + types : '')
          + (preview.dated ? '. ' + preview.dated + ' have dates' : '. None have dates')
          + (preview.with_fact_key ? ', ' + preview.with_fact_key + ' have a fact_key' : '')
          + (preview.skipped ? ', ' + preview.skipped + ' lines skipped' : '') + '.';
      }
      return '认出 ' + preview.total + ' 条（' + (formats[preview.format] || preview.format) + '）' + (types ? '：' + types : '')
        + (preview.dated ? '。' + preview.dated + ' 条带日期' : '。都没带日期')
        + (preview.with_fact_key ? '，' + preview.with_fact_key + ' 条带 fact_key' : '')
        + (preview.skipped ? '，跳过 ' + preview.skipped + ' 行' : '') + '。';
    },
    async runEntriesImport() {
      const preview = this.transfer.preview;
      if (!preview || !preview.entries.length) return;
      if (!this.transfer.info) await this.loadTransferInfo();
      const per = (this.transfer.info && this.transfer.info.entries.per_request) || 25;
      const ns = this.namespace;
      const mode = this.transfer.entriesMode;
      const entries = preview.entries;
      const fingerprint = (await this.sha256(this.transfer.entriesText)).slice(0, 40);
      this.transfer.entriesRun = { running: true, total: entries.length, done: 0, failed: 0, importId: '', lastError: '', counts: { created: 0, updated: 0, unchanged: 0, duplicate: 0, queued: 0, precious: 0, failed: 0 } };
      // 改要经过 Alpine 包过的那一份，页面才会跟着变。
      const run = this.transfer.entriesRun;
      this.transfer.entriesBusy = true;
      for (let index = 0; index < entries.length; index += per) {
        const slice = entries.slice(index, index + per);
        try {
          const data = await this.request(this.nsPath('/v1/import/entries', ns), {
            method: 'POST',
            body: JSON.stringify({ namespace: ns, fingerprint: fingerprint, name: this.transfer.entriesName || this.L('粘贴的文字', 'Pasted text'), mode: mode, start_index: index, total: entries.length, entries: slice })
          });
          const result = data.data || {};
          run.importId = result.import_id || run.importId;
          Object.keys(run.counts).forEach(function(key) { run.counts[key] += (result.counts && result.counts[key]) || 0; });
        } catch (error) {
          run.counts.failed += slice.length;
          run.lastError = error.message;
        }
        run.done = Math.min(index + per, entries.length);
      }
      run.running = false;
      this.transfer.entriesBusy = false;
      if (ns === this.namespace) await Promise.all([this.loadImportBatches(), this.loadBoot(), this.loadMemories()]);
      this.notify(run.counts.failed ? this.L('导完了，有 ' + run.counts.failed + ' 条没成功', 'Done; ' + run.counts.failed + ' failed') : this.L('导完了', 'Import done'));
    },
    entriesRunLabel() {
      const run = this.transfer.entriesRun;
      if (!run) return '';
      const c = run.counts;
      const parts = [];
      if (c.created) parts.push(this.L('新建 ' + c.created, c.created + ' new'));
      if (c.updated) parts.push(this.L('改写 ' + c.updated + '（旧版留着）', c.updated + ' updated (old versions kept)'));
      if (c.unchanged) parts.push(this.L('没变 ' + c.unchanged, c.unchanged + ' unchanged'));
      if (c.duplicate) parts.push(this.L('库里已有、跳过 ' + c.duplicate, c.duplicate + ' already there, skipped'));
      if (c.queued) parts.push(this.L('进待审 ' + c.queued, c.queued + ' sent to Review'));
      if (c.precious) parts.push(this.L('珍贵 ' + c.precious, c.precious + ' keepsakes'));
      if (c.failed) parts.push(this.L('失败 ' + c.failed, c.failed + ' failed') + (run.lastError ? ' (' + run.lastError + ')' : ''));
      return (run.running ? this.L('在导入 ', 'Importing ') : this.L('导完了 ', 'Imported ')) + run.done + ' / ' + run.total + (parts.length ? this.L('：', ': ') + parts.join(this.L('，', ', ')) : '');
    },
    async loadChatFile(event) {
      const file = event.target.files && event.target.files[0];
      event.target.value = '';
      if (!file) return;
      if (this.transfer.chatRun && this.transfer.chatRun.running) {
        this.notify(this.L('先暂停现在这份', 'Pause the current import first'));
        return;
      }
      if (!window.AeliosChat) {
        this.notify(this.L('页面没加载完整，刷新一下再试', 'The page didn’t fully load. Refresh and try again'));
        return;
      }
      this.transfer.chatLoading = true;
      this.transfer.chat = null;
      this.transfer.chatRun = null;
      chatParsed = null;
      chatChunks = [];
      try {
        if (!this.transfer.info) await this.loadTransferInfo();
        const text = await file.text();
        const parsed = window.AeliosChat.parseChatExport(text, file.name);
        if (!parsed.messages.length) throw new Error(this.L('没认出消息。', 'No messages found. ') + (parsed.warnings[0] || ''));
        chatParsed = parsed;
        const me = this.transfer.info && this.transfer.info.speakers ? this.transfer.info.speakers.user : '';
        const needsRoles = parsed.speakers.some(function(speaker) { return speaker.role === null; });
        this.transfer.chat = {
          name: file.name,
          hash: await this.sha256(text),
          format: parsed.format,
          conversations: parsed.conversations,
          messageCount: parsed.messages.length,
          skipped: parsed.skipped,
          warnings: parsed.warnings,
          needsRoles: needsRoles,
          speakers: parsed.speakers.map(function(speaker) {
            return { name: speaker.name, count: speaker.count, role: speaker.role, isUser: speaker.role === 'user' || (speaker.role === null && !!me && speaker.name === me) };
          }),
          chunks: 0, chars: 0, firstDate: '', lastDate: '', estimateIn: 0, estimateOut: 0, rolesKey: ''
        };
        this.rechunkChat();
      } catch (error) {
        this.notify(this.L('读不了这个文件：', 'Can’t read this file: ') + error.message);
      }
      this.transfer.chatLoading = false;
      this.icons();
    },
    chatTimeZone() {
      if (this.transfer.info && this.transfer.info.time_zone) return this.transfer.info.time_zone;
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (error) { return 'UTC'; }
    },
    rechunkChat() {
      const chat = this.transfer.chat;
      if (!chat || !chatParsed) return;
      const users = chat.speakers.filter(function(speaker) { return speaker.isUser; }).map(function(speaker) { return speaker.name; });
      const messages = chat.needsRoles ? window.AeliosChat.chatApplyRoles(chatParsed.messages, users) : chatParsed.messages;
      const limits = (this.transfer.info && this.transfer.info.chunk) || { default_messages: 60, default_chars: 30000 };
      chatChunks = window.AeliosChat.chatChunkByDay(messages, { timeZone: this.chatTimeZone(), maxMessages: limits.default_messages, maxChars: limits.default_chars });
      const days = chatChunks.map(function(chunk) { return chunk.day; }).filter(Boolean).sort();
      chat.chunks = chatChunks.length;
      chat.chars = chatChunks.reduce(function(sum, chunk) { return sum + chunk.chars; }, 0);
      chat.firstDate = days[0] || '';
      chat.lastDate = days[days.length - 1] || '';
      chat.estimateIn = Math.ceil(chat.chars * 1.1) + chat.chunks * 2500;
      chat.estimateOut = chat.chunks * 300;
      chat.rolesKey = users.slice().sort().join('|');
      if (this.transfer.chatRun && !this.transfer.chatRun.running) this.transfer.chatRun = null;
    },
    chatSummaryLabel() {
      const chat = this.transfer.chat;
      if (!chat) return '';
      const formats = { chatgpt: this.L('ChatGPT 导出', 'ChatGPT export'), claude: this.L('Claude 导出', 'Claude export'), sillytavern: this.L('酒馆聊天', 'SillyTavern chat'), json: 'JSON', jsonl: 'JSONL', text: this.L('文本', 'Text') };
      const model = this.transfer.info ? this.transfer.info.model : '';
      const kind = formats[chat.format] || chat.format;
      if (this.lang === 'en') {
        return kind + ' · ' + (chat.conversations > 1 ? chat.conversations + ' conversations · ' : '') + chat.messageCount + ' messages'
          + (chat.firstDate ? ' · ' + chat.firstDate + (chat.lastDate !== chat.firstDate ? ' to ' + chat.lastDate : '') : ' · no dates found')
          + '. ' + chat.chunks + ' parts, ' + chat.chars + ' characters. The model will read about ' + this.fmtTokens(chat.estimateIn) + ' tokens and write about ' + this.fmtTokens(chat.estimateOut)
          + (model ? ' (' + model + ')' : '') + '.';
      }
      return kind + '，' + (chat.conversations > 1 ? chat.conversations + ' 段对话，' : '') + chat.messageCount + ' 条消息'
        + (chat.firstDate ? '，' + chat.firstDate + (chat.lastDate !== chat.firstDate ? ' 到 ' + chat.lastDate : '') : '，没认出日期')
        + '。切成 ' + chat.chunks + ' 段，共 ' + chat.chars + ' 字。估计模型要读约 ' + this.fmtTokens(chat.estimateIn) + ' token、写约 ' + this.fmtTokens(chat.estimateOut) + ' token'
        + (model ? '（' + model + '）' : '') + '。';
    },
    async runChatImport() {
      const chat = this.transfer.chat;
      if (!chat || !chatChunks.length) return;
      if (chat.needsRoles && !chat.speakers.some(function(speaker) { return speaker.isUser; })) {
        this.notify(this.L('先勾上哪个名字是你', 'Tick which name is you first'));
        return;
      }
      if (!this.transfer.info) await this.loadTransferInfo();
      const ns = this.namespace;
      const limits = (this.transfer.info && this.transfer.info.chunk) || { default_messages: 60, default_chars: 30000 };
      const fingerprint = (await this.sha256([chat.hash, chat.rolesKey, limits.default_messages, limits.default_chars, this.chatTimeZone()].join('|'))).slice(0, 40);
      this.transfer.chatRun = { running: true, stop: false, namespace: ns, importId: '', total: chatChunks.length, done: 0, candidates: 0, merged: 0, duplicates: 0, modelCalls: 0, tokensIn: 0, tokensOut: 0, estimated: false, clefCalls: 0, errors: 0, lastError: '', current: '' };
      const run = this.transfer.chatRun;
      const self = this;
      const applyBatch = function(batch) {
        if (!batch) return;
        run.done = batch.done_chunks || 0;
        run.candidates = batch.candidates || 0;
        run.modelCalls = batch.model_calls || 0;
        run.tokensIn = batch.tokens_in || 0;
        run.tokensOut = batch.tokens_out || 0;
        run.clefCalls = batch.clef_calls || 0;
      };
      try {
        const start = await this.request(this.nsPath('/v1/import/batches', ns), {
          method: 'POST',
          body: JSON.stringify({ namespace: ns, fingerprint: fingerprint, name: chat.name, total_chunks: chatChunks.length, total_messages: chat.messageCount, total_chars: chat.chars, first_date: chat.firstDate || null, last_date: chat.lastDate || null })
        });
        const batch = start.data.batch;
        run.importId = batch.id;
        applyBatch(batch);
        const done = new Set(start.data.done_keys || []);
        const chunks = chatChunks;
        let streak = 0;
        for (const chunk of chunks) {
          if (run.stop) break;
          if (done.has(chunk.key)) continue;
          run.current = chunk.key;
          try {
            const data = await this.request(this.nsPath('/v1/import/chat/chunk', ns), {
              method: 'POST',
              body: JSON.stringify({ namespace: ns, import_id: batch.id, chunk: { key: chunk.key, day: chunk.day, messages: chunk.messages }, clef: !!this.transfer.chatClef })
            });
            const result = data.data.result;
            if (result.status === 'error') {
              run.errors += 1;
              run.lastError = chunk.key + ': ' + (result.error || self.L('出错了', 'error'));
              streak += 1;
            } else {
              streak = 0;
              done.add(chunk.key);
            }
            run.merged += result.merged || 0;
            run.duplicates += result.duplicates || 0;
            run.estimated = run.estimated || !!result.tokens_estimated;
            applyBatch(data.data.batch);
          } catch (error) {
            run.errors += 1;
            run.lastError = chunk.key + ': ' + error.message;
            streak += 1;
          }
          if (streak >= 3) {
            run.lastError += this.L('（连着 3 段出错，先停下了）', ' (3 parts in a row failed, so it stopped)');
            break;
          }
        }
      } catch (error) {
        run.lastError = error.message;
      }
      run.running = false;
      run.stop = false;
      run.current = '';
      if (ns === this.namespace) await Promise.all([this.loadImportBatches(), this.loadBoot()]);
      this.icons();
    },
    chatRunPercent() {
      const run = this.transfer.chatRun;
      return run && run.total ? Math.round(run.done / run.total * 100) : 0;
    },
    chatRunLabel() {
      const run = this.transfer.chatRun;
      if (!run) return '';
      if (this.lang === 'en') {
        const headEn = run.running ? 'Reading ' + (run.current || '…') + '. ' : (run.done >= run.total ? 'Done. ' : 'Stopped here. ');
        return headEn + run.done + ' / ' + run.total + ' parts read, ' + run.candidates + ' candidates sent to Review'
          + (run.merged ? ' (' + run.merged + ' more mentions merged into existing candidates)' : '')
          + (run.duplicates ? ', ' + run.duplicates + ' exact duplicates skipped' : '')
          + '. ' + run.modelCalls + ' model calls, ' + this.fmtTokens(run.tokensIn) + ' in / ' + this.fmtTokens(run.tokensOut) + ' out tokens'
          + (run.estimated ? ' (some parts estimated from length)' : '')
          + (run.clefCalls ? ', clef ' + run.clefCalls : '')
          + (run.errors ? ', ' + run.errors + ' parts failed' : '') + '.';
      }
      const head = run.running ? '在做 ' + (run.current || '…') + '。' : (run.done >= run.total ? '做完了。' : '停在这里了。');
      return head + '已做 ' + run.done + ' / ' + run.total + ' 段，' + run.candidates + ' 条候选进了待审'
        + (run.merged ? '（另有 ' + run.merged + ' 次说到同一件事，并进了已有候选）' : '')
        + (run.duplicates ? '，' + run.duplicates + ' 条跟库里一字不差、跳过' : '')
        + '。模型 ' + run.modelCalls + ' 次，' + this.fmtTokens(run.tokensIn) + ' 进 / ' + this.fmtTokens(run.tokensOut) + ' 出 token'
        + (run.estimated ? '（有的段模型没回用量，按字数估的）' : '')
        + (run.clefCalls ? '，clef ' + run.clefCalls + ' 次' : '')
        + (run.errors ? '，出错 ' + run.errors + ' 段' : '') + '。';
    },
    async toggleMemoryRevisions(memory) {
      memory.revOpen = !memory.revOpen;
      if (!memory.revOpen) return;
      memory.revisions = null;
      try {
        const data = await this.request(this.withNamespace('/v1/memories/' + encodeURIComponent(memory.id) + '/revisions'));
        memory.revisions = data.data || [];
      } catch (error) {
        memory.revisions = [];
        this.notify(error.message);
      }
    },
    revisionReasonLabel(rev) {
      const zh = { fact_key_upsert: '同一个 key 再写一遍时被改', edit: '手动改的', candidate_merge: '审核合并时被改' };
      const en = { fact_key_upsert: 'Changed when the same key was written again', edit: 'Edited by hand', candidate_merge: 'Changed by a merge in Review' };
      const reason = (this.lang === 'en' ? en : zh)[rev.reason] || rev.reason || '';
      return reason + (rev.replaced_by ? this.L('（改它的：', ' (by ') + rev.replaced_by + this.L('）', ')') : '');
    },
    async restoreMemoryRevision(memory, rev) {
      if (!window.confirm(this.L('把这条记忆恢复成这一版？现在这版会存进旧版里。', 'Restore this version? The current one will be saved as an older version.'))) return;
      try {
        await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.id)), {
          method: 'PATCH',
          body: JSON.stringify({
            namespace: this.namespace,
            type: rev.type || memory.type,
            content: rev.content,
            confidence: memory.confidence,
            importance: memory.importance,
            tags: (rev.tags && rev.tags.length) ? rev.tags : (memory.tags || []),
            source: 'restore'
          })
        });
        await this.loadMemories();
        this.notify(this.L('恢复好了', 'Restored'));
      } catch (error) {
        this.notify(error.message);
      }
    },
    get pendingCount() {
      if (this.stats && typeof this.stats.pending_candidates === 'number') return this.stats.pending_candidates;
      return this.candidates.length;
    }
  };
}
</script>
</body>
</html>`;
