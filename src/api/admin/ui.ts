export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Aelios Memory</title>
<script>
tailwind = {
  config: {
    theme: {
      extend: {
        fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'] },
        colors: { coral: '#F4A07C' }
      }
    }
  }
};
</script>
<script src="https://cdn.tailwindcss.com"></script>
<script defer src="https://unpkg.com/alpinejs@3.x.x/dist/cdn.min.js"></script>
<script src="https://unpkg.com/lucide@latest"></script>
<script>
document.documentElement.dataset.theme = localStorage.getItem('aelios.admin.colorMode') || 'light';
</script>
<style>
  /* ===== 星空色板：dark 深空 / light 晨昏，全站颜色由这组变量驱动 ===== */
  :root {
    color-scheme: dark;
    --bg-deep: #070a16;
    --bg-deep-95: rgba(7, 10, 22, .94);
    --bg-deep-70: rgba(7, 10, 22, .7);
    --panel-bg: rgba(21, 27, 54, .55);
    --panel-bg-strong: rgba(23, 29, 58, .88);
    --panel-border: rgba(148, 163, 255, .16);
    --panel-glow: 0 1px 0 rgba(180, 190, 255, .07) inset, 0 10px 30px rgba(2, 5, 18, .5);
    --hover-bg: rgba(39, 47, 86, .62);
    --text-1: #eef0ff;
    --text-2: #c9cdea;
    --text-3: #9aa0c8;
    --text-4: #6d7299;
    --on-accent: #251304;
    --coral: #F4A07C;
    --violet: #8b7cf6;
    --cyan: #67e8f9;
    --ok: #6ee7b7;
    --err: #f87171;
    --warn: #fbbf24;
    --aurora: linear-gradient(135deg, #8b7cf6, #67e8f9);
    --nebula-1: rgba(124, 93, 250, .13);
    --nebula-2: rgba(56, 189, 248, .09);
    --star-1: rgba(255, 255, 255, .85);
    --star-2: rgba(190, 205, 255, .7);
    --star-3: rgba(244, 160, 124, .55);
    --stars-opacity: .9;
    --scrollbar-thumb: #2c3355;
    --scrollbar-track: #0a0e1f;
  }
  :root[data-theme="light"] {
    color-scheme: light;
    --bg-deep: #eceef8;
    --bg-deep-95: rgba(236, 238, 248, .94);
    --bg-deep-70: rgba(236, 238, 248, .72);
    --panel-bg: rgba(255, 255, 255, .6);
    --panel-bg-strong: rgba(252, 252, 255, .9);
    --panel-border: rgba(109, 92, 210, .18);
    --panel-glow: 0 1px 0 rgba(255, 255, 255, .7) inset, 0 10px 26px rgba(88, 76, 160, .12);
    --hover-bg: rgba(233, 230, 250, .85);
    --text-1: #232437;
    --text-2: #3c3e5c;
    --text-3: #60638a;
    --text-4: #888cb2;
    --on-accent: #2a1608;
    --nebula-1: rgba(244, 160, 124, .22);
    --nebula-2: rgba(139, 124, 246, .16);
    --star-1: rgba(124, 108, 220, .5);
    --star-2: rgba(244, 160, 124, .5);
    --star-3: rgba(103, 180, 249, .45);
    --stars-opacity: .5;
    --scrollbar-thumb: #c5c8e2;
    --scrollbar-track: #eceef8;
  }

  [x-cloak] { display: none !important; }
  html, body { min-height: 100%; background: var(--bg-deep); }
  body { margin: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
  * { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track); }
  button, input, textarea, select { font: inherit; }
  :focus-visible { outline: 2px solid var(--coral); outline-offset: 2px; }
  h1, h2, button, .text-keep { word-break: keep-all; }
  .tap { min-height: 44px; min-width: 44px; }

  /* ===== 全局星 field：纯 CSS 星点 + 两片星云，只动 opacity ===== */
  .starfield { position: fixed; inset: 0; z-index: 0; pointer-events: none; background: var(--bg-deep); }
  .star-nebula {
    position: absolute; inset: 0;
    background:
      radial-gradient(58% 42% at 76% 10%, var(--nebula-1), transparent 72%),
      radial-gradient(52% 42% at 10% 82%, var(--nebula-2), transparent 72%);
  }
  .star-layer { position: absolute; inset: 0; background-repeat: repeat; opacity: var(--stars-opacity); }
  .star-layer-a {
    background-image:
      radial-gradient(1px 1px at 24px 36px, var(--star-1), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 128px 96px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1.5px 1.5px at 212px 180px, var(--star-1), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 320px 64px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 392px 240px, var(--star-3), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 72px 300px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1.5px 1.5px at 268px 356px, var(--star-1), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 428px 400px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 168px 424px, var(--star-1), rgba(255, 255, 255, 0));
    background-size: 460px 460px;
    animation: star-twinkle-a 9s ease-in-out infinite alternate;
  }
  .star-layer-b {
    background-image:
      radial-gradient(1px 1px at 96px 148px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1.5px 1.5px at 336px 44px, var(--star-1), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 512px 208px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 184px 392px, var(--star-3), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 568px 460px, var(--star-1), rgba(255, 255, 255, 0)),
      radial-gradient(1.5px 1.5px at 48px 520px, var(--star-2), rgba(255, 255, 255, 0)),
      radial-gradient(1px 1px at 432px 584px, var(--star-1), rgba(255, 255, 255, 0));
    background-size: 620px 620px;
    animation: star-twinkle-b 13s ease-in-out infinite alternate;
  }
  @keyframes star-twinkle-a { from { opacity: calc(var(--stars-opacity) * .35); } to { opacity: var(--stars-opacity); } }
  @keyframes star-twinkle-b { from { opacity: var(--stars-opacity); } to { opacity: calc(var(--stars-opacity) * .3); } }
  .app-shell { position: relative; z-index: 1; }

  /* ===== 既有 Tailwind 类 → 星空变量映射（玻璃拟态 + 深空底） ===== */
  body, .bg-\[\#0a0a0b\] { background-color: var(--bg-deep) !important; }
  .bg-\[\#0a0a0b\]\/95 { background-color: var(--bg-deep-95) !important; }
  .bg-\[\#0a0a0b\]\/70 { background-color: var(--bg-deep-70) !important; }
  .bg-zinc-900 {
    background-color: var(--panel-bg) !important;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow: var(--panel-glow) !important;
  }
  .bg-zinc-900\/90, .bg-zinc-900\/95 {
    background-color: var(--panel-bg-strong) !important;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .hover\:bg-zinc-900:hover {
    background-color: var(--hover-bg) !important;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }
  .active\:bg-zinc-800:active { background-color: var(--hover-bg) !important; }
  .border-zinc-800, .border-zinc-700 { border-color: var(--panel-border) !important; }
  .ring-zinc-800 { --tw-ring-color: var(--panel-border) !important; }
  .text-zinc-100 { color: var(--text-1) !important; }
  .hover\:text-zinc-100:hover { color: var(--text-1) !important; }
  .text-zinc-200, .text-zinc-300 { color: var(--text-2) !important; }
  .text-zinc-400 { color: var(--text-3) !important; }
  .text-zinc-500 { color: var(--text-4) !important; }
  .text-zinc-950 { color: var(--on-accent) !important; }
  input, textarea, pre { color: var(--text-1); }

  /* coral 动作色兜底：head 里的 tailwind config 会被 CDN 自身对象覆盖，
     自定义色板不保证生成，面板用变量自己定义，两套主题同源。 */
  .bg-coral { background-color: var(--coral) !important; }
  .text-coral { color: var(--coral) !important; }
  .hover\:border-coral:hover, .focus\:border-coral:focus { border-color: var(--coral) !important; }
  .active\:bg-coral\/80:active { background-color: rgba(244, 160, 124, .8) !important; }

  .choice-tab {
    border-color: var(--panel-border);
    background-color: var(--panel-bg);
    color: var(--text-3);
  }
  .choice-tab.is-active {
    border-color: rgba(139, 124, 246, .55);
    background-image: linear-gradient(135deg, rgba(139, 124, 246, .22), rgba(103, 232, 249, .14));
    color: var(--text-1);
    font-weight: 650;
  }

  /* ===== 极光系小件：徽标 / 选中态 / 图表条 ===== */
  .aurora-text { background: var(--aurora); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    border-radius: 999px; border: 1px solid var(--panel-border);
    padding: 2px 8px; font-size: 11px; line-height: 1.6; color: var(--text-3);
  }
  .chip-ok { color: var(--ok); border-color: rgba(110, 231, 183, .35); }
  .chip-err { color: var(--err); border-color: rgba(248, 113, 113, .35); }
  .chip-warn { color: var(--warn); border-color: rgba(251, 191, 36, .35); }
  .chip-dim { color: var(--text-4); }
  .chip-aurora { border-color: rgba(139, 124, 246, .45); color: var(--violet); }

  /* ===== 梦境观测台 ===== */
  .dream-stat { position: relative; }
  .dream-stat::before {
    content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px;
    border-radius: 2px; background: var(--aurora); opacity: .75;
  }
  .dream-rail { position: relative; }
  .dream-rail::before {
    content: ""; position: absolute; left: 7px; top: 12px; bottom: 12px; width: 1px;
    background: linear-gradient(to bottom, rgba(139, 124, 246, .55), rgba(103, 232, 249, .12));
  }
  .dream-rail-item { position: relative; padding-left: 26px; }
  .dream-rail-item::before {
    content: ""; position: absolute; left: 3px; top: 24px; width: 9px; height: 9px;
    border-radius: 999px; background: var(--rail-dot, var(--text-4));
    box-shadow: 0 0 10px 1px var(--rail-glow, transparent);
  }
  .dot-ok { --rail-dot: var(--ok); --rail-glow: rgba(110, 231, 183, .4); }
  .dot-err { --rail-dot: var(--err); --rail-glow: rgba(248, 113, 113, .4); }
  .dot-dim { --rail-dot: var(--text-4); }
  .dot-run { --rail-dot: var(--warn); --rail-glow: rgba(251, 191, 36, .4); }
  .breathe { animation: dream-breathe 2.2s ease-in-out infinite; }
  @keyframes dream-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
  .raw-bar-track { height: 6px; border-radius: 999px; background: var(--bg-deep); overflow: hidden; }
  .raw-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--violet), var(--cyan)); opacity: .8; }
  .raw-bar-fill.is-done { background: var(--text-4); opacity: .45; }
  .harvest-dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; }
  .harvest-dot-new { background: var(--coral); box-shadow: 0 0 10px 2px rgba(244, 160, 124, .55); }

  .starmap-shell { min-height: min(70dvh, 720px); }
  .starmap-canvas { touch-action: none; display: block; width: 100%; height: 100%; }
  .starmap-legend-btn.is-off { opacity: .35; text-decoration: line-through; }
  .starmap-caption { color: rgba(140, 140, 150, .55); transition: color .3s ease; }
  .starmap-caption:hover { color: rgba(244, 160, 124, .9); }
  :root[data-theme="light"] .starmap-caption { color: rgba(100, 100, 110, .5); }
  :root[data-theme="light"] .starmap-caption:hover { color: rgba(217, 119, 87, .9); }
  .starmap-drawer {
    max-height: min(48dvh, 360px);
  }

  /* 星空是氛围：reduced-motion 时全部静止 */
  @media (prefers-reduced-motion: reduce) {
    .star-layer-a, .star-layer-b, .breathe { animation: none !important; }
    *, *::before, *::after {
      transition-duration: .01ms !important;
      animation-duration: .01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
</style>
</head>
<body class="bg-[#0a0a0b] text-zinc-100 antialiased">
<div class="starfield" aria-hidden="true">
  <div class="star-nebula"></div>
  <div class="star-layer star-layer-a"></div>
  <div class="star-layer star-layer-b"></div>
</div>
<div x-data="memoryAdmin()" x-init="init()" x-cloak class="app-shell min-h-dvh pb-24 md:pb-0">
  <div class="mx-auto flex min-h-dvh w-full max-w-[1440px] md:px-4 md:py-4">
    <aside class="hidden w-64 shrink-0 flex-col gap-4 border-r border-zinc-800 px-3 py-3 md:flex">
      <div class="flex items-center gap-3 px-2 py-2">
        <div class="grid h-9 w-9 place-items-center rounded-2xl bg-coral text-sm font-semibold text-zinc-950">A</div>
        <div>
          <div class="text-sm font-semibold">Aelios</div>
          <div class="text-xs text-zinc-400">Memory Console</div>
        </div>
      </div>

      <nav class="grid gap-1">
        <template x-for="item in nav" :key="item.id">
          <button type="button" @click="go(item.id)" class="tap flex items-center gap-3 rounded-2xl px-3 text-left text-sm transition duration-150 ease-in-out" :class="page === item.id ? 'bg-zinc-900 text-zinc-100 ring-1 ring-zinc-800' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'">
            <i :data-lucide="item.icon" class="h-4 w-4"></i>
            <span class="flex-1" x-text="item.label"></span>
            <span x-show="item.id === 'review' && pendingCount" class="rounded-full bg-coral px-2 py-0.5 text-xs font-semibold text-zinc-950" x-text="pendingCount"></span>
          </button>
        </template>
      </nav>

      <button type="button" @click="toggleTheme()" class="tap flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-400 transition duration-150 ease-in-out hover:border-coral hover:text-zinc-100">
        <i :data-lucide="theme === 'light' ? 'moon' : 'sun'" class="h-4 w-4"></i>
        <span x-text="theme === 'light' ? '切到夜间' : '切到白天'"></span>
      </button>

      <div class="mt-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
        <label class="text-xs text-zinc-400">Worker</label>
        <input x-model="workerUrl" @change="savePrefs()" class="mt-2 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral" placeholder="Worker URL">
        <label class="mt-3 block text-xs text-zinc-400">Token</label>
        <div class="mt-2 flex gap-2">
          <input x-model="apiKey" @keydown.enter.prevent="saveToken()" type="password" class="h-11 min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral" placeholder="Bearer token">
          <button type="button" @click="saveToken()" class="tap grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-coral text-zinc-950 transition duration-150 ease-in-out active:bg-coral/80" aria-label="保存 token" title="保存 token">
            <i data-lucide="save" class="h-4 w-4"></i>
          </button>
          <button type="button" @click="clearToken()" class="tap grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-zinc-800 bg-[#0a0a0b] text-zinc-400 transition duration-150 ease-in-out hover:border-coral hover:text-zinc-100" aria-label="清除 token" title="清除 token">
            <i data-lucide="trash-2" class="h-4 w-4"></i>
          </button>
        </div>
        <div class="mt-1 text-[11px]" :class="tokenSaved() ? 'text-zinc-500' : 'text-coral'" x-text="tokenSaved() ? 'Token 已保存到本机' : 'Token 尚未保存'"></div>
        <label class="mt-3 block text-xs text-zinc-400">Namespace</label>
        <input x-model="namespace" @change="reloadAll()" class="mt-2 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral" placeholder="default">
      </div>
    </aside>

    <main class="min-w-0 flex-1 px-4 py-4 md:px-6">
      <header class="mb-5 flex items-start justify-between gap-3 md:hidden">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-2xl bg-coral text-sm font-semibold text-zinc-950">A</div>
          <div>
            <div class="text-base font-semibold">Aelios</div>
            <div class="text-xs text-zinc-400" x-text="subtitle()"></div>
          </div>
        </div>
        <button type="button" @click="reloadAll()" class="tap rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-zinc-100 transition duration-150 ease-in-out active:bg-zinc-800" aria-label="刷新">
          <i data-lucide="refresh-cw" class="h-4 w-4"></i>
        </button>
      </header>

      <div x-show="toast" x-transition.opacity.duration.150ms class="fixed left-4 right-4 top-4 z-50 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-sm md:left-auto md:right-6 md:w-96" x-text="toast"></div>

      <section x-show="page === 'today'" class="space-y-4">
        <div class="hidden items-center justify-between gap-4 md:flex">
        <div class="min-w-0 flex-1">
          <h1 class="text-2xl font-semibold tracking-normal">今日</h1>
            <p class="mt-1 text-sm text-zinc-400">摘要、原始聊天流和即时珍贵标记。</p>
          </div>
          <button type="button" @click="reloadAll()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">
            <i data-lucide="refresh-cw" class="h-4 w-4"></i><span>刷新</span>
          </button>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
            <div class="text-xs text-zinc-400">今日 raw</div>
            <div class="mt-1 text-xl font-semibold" x-text="stats.today_raw_count || 0"></div>
          </div>
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
            <div class="text-xs text-zinc-400">待审核</div>
            <div class="mt-1 text-xl font-semibold text-coral" x-text="pendingCount"></div>
          </div>
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
            <div class="text-xs text-zinc-400">容量</div>
            <div class="mt-1 text-xl font-semibold" x-text="capacityLabel()"></div>
          </div>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">今天的 raw 聊天流</h2>
            <span class="text-xs text-zinc-400" x-text="todayMessages.length + ' 条显示'"></span>
          </div>
          <template x-if="todayMessages.length === 0">
            <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">今天还没有 raw 聊天记录。</div>
          </template>
          <template x-for="message in todayMessages" :key="message.id">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="mb-2 flex items-center gap-2 text-xs text-zinc-400">
                <span class="rounded-full border border-zinc-800 px-2 py-0.5" x-text="message.role"></span>
                <span x-text="fmt(message.created_at)"></span>
                <span class="min-w-0 truncate" x-text="message.source || 'source unknown'"></span>
                <button type="button" @click="pinMessage(message)" class="tap ml-auto grid place-items-center rounded-2xl border border-zinc-800 text-coral transition duration-150 ease-in-out hover:border-coral" aria-label="加入珍贵">
                  <i data-lucide="heart" class="h-4 w-4"></i>
                </button>
              </div>
              <p class="whitespace-pre-wrap text-sm leading-7 text-zinc-100" x-text="message.content"></p>
            </article>
          </template>
        </div>
      </section>

      <section x-show="page === 'review'" class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold">审核队列</h1>
            <p class="mt-1 text-sm text-zinc-400">低置信候选先过手，再进入长期记忆。</p>
          </div>
          <span class="rounded-full bg-coral px-3 py-1 text-sm font-semibold text-zinc-950" x-text="pendingCount"></span>
        </div>

        <template x-if="candidates.length === 0">
            <div class="text-keep w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-sm text-zinc-400">没有待审核候选。</div>
        </template>
        <template x-for="candidate in candidates" :key="candidate.id">
          <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <div class="mb-3 flex flex-wrap items-center gap-2">
              <template x-if="candidate.source === 'dream_delete'">
                <span class="rounded-full bg-red-500/90 px-2.5 py-1 text-xs font-semibold text-zinc-950">删除提案</span>
              </template>
              <template x-if="candidate.source === 'dream_update'">
                <span class="rounded-full bg-amber-400/90 px-2.5 py-1 text-xs font-semibold text-zinc-950">更新提案</span>
              </template>
              <span class="rounded-full bg-coral px-2.5 py-1 text-xs font-semibold text-zinc-950" x-text="candidate.type"></span>
              <span class="rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400" x-text="'confidence ' + pct(candidate.confidence)"></span>
              <span class="min-w-0 truncate text-xs text-zinc-400" x-text="candidate.fact_key || 'no fact_key'"></span>
            </div>
            <template x-if="candidate.source === 'dream_delete'">
              <p class="mb-2 text-xs text-red-300/80">
                通过＝归档这条目标记忆 <span class="font-mono" x-text="candidate.target_memory_id"></span>（原因：<span x-text="candidate.decision_note || '整理'"></span>）。下面内容是被删对象的预览，不是新增。
              </p>
            </template>
            <template x-if="!candidate.editing">
              <p class="whitespace-pre-wrap text-sm leading-7 text-zinc-100" x-text="candidate.content"></p>
            </template>
            <template x-if="candidate.editing">
              <div class="space-y-3">
                <textarea x-model="candidate.draft.content" class="min-h-32 w-full resize-y rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-sm outline-none focus:border-coral"></textarea>
                <div class="grid gap-3 sm:grid-cols-2">
                  <input x-model="candidate.draft.type" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="type">
                  <input x-model="candidate.draft.fact_key" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="fact_key">
                </div>
              </div>
            </template>
            <div class="mt-4 grid grid-cols-2 gap-3 md:flex md:flex-wrap">
              <button type="button" @click="approveCandidate(candidate)" class="tap inline-flex items-center justify-center gap-2 rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950 transition duration-150 ease-in-out">
                <i data-lucide="check" class="h-4 w-4"></i><span>通过</span>
              </button>
              <button type="button" @click="discardCandidate(candidate)" class="tap inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-800 px-4 text-sm text-zinc-100 transition duration-150 ease-in-out hover:border-coral">
                <i data-lucide="x" class="h-4 w-4"></i><span>丢弃</span>
              </button>
              <button type="button" @click="toggleCandidateEdit(candidate)" class="tap col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-800 px-4 text-sm text-zinc-100 transition duration-150 ease-in-out hover:border-coral md:col-span-1">
                <i data-lucide="pencil" class="h-4 w-4"></i><span x-text="candidate.editing ? '取消编辑' : '编辑后通过'"></span>
              </button>
              <button type="button" @click="candidate.mergeOpen = !candidate.mergeOpen; icons()" class="tap col-span-2 inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-800 px-4 text-sm text-zinc-100 transition duration-150 ease-in-out hover:border-coral md:col-span-1">
                <i data-lucide="git-merge" class="h-4 w-4"></i><span>合并到已有记忆</span>
              </button>
            </div>
            <div x-show="candidate.mergeOpen" class="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <input x-model="candidate.target_id" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="目标 memory id">
              <button type="button" @click="mergeCandidate(candidate)" class="tap rounded-2xl border border-zinc-800 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">确认合并</button>
            </div>
          </article>
        </template>
      </section>

      <section x-show="page === 'memory'" class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold">重要记忆</h1>
            <p class="mt-1 text-sm text-zinc-400">L4 稳定事实、偏好、边界和决策。</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" @click="openMemoryCreate()" class="tap inline-flex items-center gap-2 rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950 transition duration-150 ease-in-out">
              <i data-lucide="plus" class="h-4 w-4"></i><span>新增</span>
            </button>
            <button type="button" @click="loadMemories()" class="tap rounded-2xl border border-zinc-800 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">刷新</button>
          </div>
        </div>

        <div class="flex gap-2 overflow-x-auto pb-1">
          <template x-for="type in memoryTypes" :key="type">
            <button type="button" @click="memoryType = type; loadMemories()" class="choice-tab tap shrink-0 rounded-2xl border px-4 text-sm transition duration-150 ease-in-out hover:border-coral" :class="memoryType === type ? 'is-active' : ''">
              <span x-text="memoryTypeLabel(type)"></span>
              <span class="ml-1 text-xs" x-text="typeCount(type) + '/' + typeLimit(type)"></span>
            </button>
          </template>
        </div>

        <article x-show="memoryCreateOpen" class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-3">
            <div class="text-sm font-semibold">手工新增记忆</div>
            <button type="button" @click="memoryCreateOpen = false" class="tap rounded-2xl border border-zinc-800 px-3 text-xs text-zinc-400 transition duration-150 ease-in-out hover:border-coral">关闭</button>
          </div>
          <div class="grid gap-3">
            <div class="grid gap-2 md:grid-cols-[1fr_1fr]">
              <label class="block">
                <span class="text-xs text-zinc-400">类型</span>
                <select x-model="memoryDraft.type" class="mt-1 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral">
                  <template x-for="type in memoryTypes" :key="type">
                    <option x-show="type !== 'all'" :value="type" x-text="type"></option>
                  </template>
                </select>
              </label>
              <label class="block">
                <span class="text-xs text-zinc-400">fact_key（留空自动按内容生成）</span>
                <input x-model="memoryDraft.fact_key" class="mt-1 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="如 preference:answer-style">
              </label>
            </div>
            <label class="block">
              <span class="text-xs text-zinc-400">内容</span>
              <textarea x-model="memoryDraft.content" class="mt-1 min-h-28 w-full resize-y rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-sm leading-7 text-zinc-100 outline-none focus:border-coral" placeholder="一句稳定、可复用的事实"></textarea>
            </label>
            <div class="grid gap-3 md:grid-cols-2">
              <label class="block">
                <span class="text-xs text-zinc-400">重要性 <span x-text="memoryDraft.importance.toFixed(2)"></span></span>
                <input type="range" min="0" max="1" step="0.05" x-model.number="memoryDraft.importance" class="mt-2 w-full">
              </label>
              <label class="block">
                <span class="text-xs text-zinc-400">置信度 <span x-text="memoryDraft.confidence.toFixed(2)"></span></span>
                <input type="range" min="0" max="1" step="0.05" x-model.number="memoryDraft.confidence" class="mt-2 w-full">
              </label>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" @click="memoryCreateOpen = false" class="tap rounded-2xl border border-zinc-800 px-4 text-sm text-zinc-400 transition duration-150 ease-in-out hover:border-coral">取消</button>
              <button type="button" @click="createMemory()" :disabled="saving" class="tap inline-flex items-center gap-2 rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950 disabled:opacity-50">
                <i data-lucide="save" class="h-4 w-4"></i><span>保存</span>
              </button>
            </div>
          </div>
        </article>

        <template x-if="memories.length === 0">
          <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">这个类型下还没有记忆。</div>
        </template>
        <div class="grid gap-3 lg:grid-cols-2">
          <template x-for="memory in memories" :key="memory.id">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span class="rounded-full bg-coral px-2.5 py-1 font-semibold text-zinc-950" x-text="memory.type"></span>
                <span x-text="memory.id"></span>
                <span x-text="pct(memory.confidence)"></span>
              </div>
              <template x-if="!memory.editing">
                <p class="whitespace-pre-wrap text-sm leading-7 text-zinc-100" x-text="memory.content"></p>
              </template>
              <template x-if="memory.editing">
                <textarea x-model="memory.draft.content" class="min-h-36 w-full resize-y rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-sm outline-none focus:border-coral"></textarea>
              </template>
              <div x-show="memory.supersedes_id || memory.superseded_by_id" class="mt-3 rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-xs leading-6 text-zinc-400">
                <div x-show="memory.supersedes_id">取代了 <span class="text-zinc-100" x-text="memory.supersedes_id"></span></div>
                <div x-show="memory.superseded_by_id">被取代为 <span class="text-zinc-100" x-text="memory.superseded_by_id"></span></div>
              </div>
              <div class="mt-4 flex flex-wrap gap-2">
                <button type="button" @click="toggleMemoryEdit(memory)" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 text-sm transition duration-150 ease-in-out hover:border-coral">
                  <i data-lucide="pencil" class="h-4 w-4"></i><span x-text="memory.editing ? '取消' : '编辑'"></span>
                </button>
                <button type="button" x-show="memory.editing" @click="saveMemory(memory)" class="tap inline-flex items-center gap-2 rounded-2xl bg-coral px-3 text-sm font-semibold text-zinc-950">
                  <i data-lucide="save" class="h-4 w-4"></i><span>保存</span>
                </button>
                <button type="button" @click="memory.mergeOpen = !memory.mergeOpen; icons()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 text-sm transition duration-150 ease-in-out hover:border-coral">
                  <i data-lucide="git-merge" class="h-4 w-4"></i><span>合并重复</span>
                </button>
                <button type="button" @click="deleteMemory(memory)" class="tap ml-auto inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 text-sm text-zinc-400 transition duration-150 ease-in-out hover:border-coral hover:text-zinc-100">
                  <i data-lucide="trash-2" class="h-4 w-4"></i><span>删除</span>
                </button>
              </div>
              <div x-show="memory.mergeOpen" class="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
                <input x-model="memory.target_id" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="目标 memory id">
                <button type="button" @click="mergeDuplicate(memory)" class="tap rounded-2xl border border-zinc-800 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">合并</button>
              </div>
            </article>
          </template>
        </div>
      </section>

      <section x-show="page === 'more'" class="space-y-4">
        <div>
          <h1 class="text-2xl font-semibold">更多</h1>
          <p class="mt-1 text-sm text-zinc-400">珍贵、黑话、世界知识和维护入口。</p>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:flex">
          <template x-for="item in moreNav" :key="item.id">
            <button type="button" @click="moreView = item.id; loadMoreView()" class="choice-tab tap rounded-2xl border px-4 text-sm transition duration-150 ease-in-out hover:border-coral" :class="moreView === item.id ? 'is-active' : ''">
              <span x-text="item.label"></span>
            </button>
          </template>
        </div>

        <div x-show="moreView === 'precious'" class="space-y-3">
          <template x-for="item in precious" :key="item.id">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="mb-2 flex items-center gap-2 text-xs text-zinc-400"><i data-lucide="heart" class="h-4 w-4 text-coral"></i><span x-text="fmt(item.created_at)"></span><span x-text="item.source"></span></div>
              <p class="whitespace-pre-wrap text-sm leading-7" x-text="item.content"></p>
              <button type="button" @click="unpinPrecious(item)" class="tap mt-3 rounded-2xl border border-zinc-800 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">取消珍贵</button>
            </article>
          </template>
        </div>

        <div x-show="moreView === 'glossary'" class="space-y-3">
          <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <div class="grid gap-3 md:grid-cols-[180px_1fr_auto]">
              <input x-model="glossaryDraft.term" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="term">
              <input x-model="glossaryDraft.definition" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="definition">
              <button type="button" @click="saveGlossary()" class="tap rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950">保存</button>
            </div>
            <input x-model="glossaryDraft.aliasesText" class="mt-3 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="aliases，用逗号分隔">
          </article>
          <template x-for="item in glossary" :key="item.id">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="font-semibold" x-text="item.term"></div>
                  <div class="mt-1 text-xs text-zinc-400" x-text="jsonList(item.aliases).join(' / ')"></div>
                </div>
                <button type="button" @click="deleteGlossary(item)" class="tap rounded-2xl border border-zinc-800 px-3 text-sm text-zinc-400 hover:border-coral">删除</button>
              </div>
              <p class="mt-3 text-sm leading-7" x-text="item.definition"></p>
            </article>
          </template>
        </div>

        <div x-show="moreView === 'world'" class="space-y-3">
          <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <div class="grid gap-3 md:grid-cols-[1fr_auto]">
              <input x-model="worldQuery" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="搜索兜底大库">
              <button type="button" @click="searchWorld()" class="tap rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950">搜索</button>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span x-text="'已选 ' + selectedWorldCount() + ' / ' + worldItems.length"></span>
              <button type="button" @click="selectAllWorldItems()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 py-1 text-zinc-400 hover:border-coral hover:text-zinc-100">
                <i data-lucide="check-square" class="h-3.5 w-3.5"></i><span>全选当前</span>
              </button>
              <button type="button" @click="clearWorldSelection()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 py-1 text-zinc-400 hover:border-coral hover:text-zinc-100">
                <i data-lucide="square" class="h-3.5 w-3.5"></i><span>清空</span>
              </button>
              <button type="button" @click="deleteSelectedWorldItems()" :disabled="selectedWorldCount() === 0 || saving" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 py-1 text-zinc-400 hover:border-coral hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40">
                <i data-lucide="trash-2" class="h-3.5 w-3.5"></i><span>删除选中</span>
              </button>
            </div>
          </article>
          <template x-for="item in worldItems" :key="worldItemKey(item)">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <input type="checkbox" class="h-4 w-4 shrink-0 accent-[#ff7a66]" :checked="isWorldSelected(item)" @change="toggleWorldItem(item)" aria-label="选择条目">
                <span x-text="item.type || 'longtail'"></span><span x-text="item.status || item.source || ''"></span><span x-text="item.source || ''"></span>
                <button type="button" @click="deleteWorldMemory(item)" class="tap ml-auto rounded-2xl border border-zinc-800 px-3 py-1 text-xs text-zinc-400 hover:border-coral">删除</button>
              </div>
              <p class="whitespace-pre-wrap text-sm leading-7" x-text="item.content"></p>
            </article>
          </template>
        </div>

        <div x-show="moreView === 'maintenance'" class="space-y-3">
          <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
            <div class="grid gap-3 md:grid-cols-[1fr_auto_auto_auto]">
              <input x-model="namespace" @change="reloadAll()" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="namespace">
              <button type="button" @click="runHealth()" class="tap rounded-2xl border border-zinc-800 px-4 text-sm hover:border-coral">vector_health</button>
              <button type="button" @click="runReindex(true)" class="tap rounded-2xl border border-zinc-800 px-4 text-sm hover:border-coral">reindex dry</button>
              <button type="button" @click="runDream()" class="tap rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950">dream force</button>
            </div>
          </article>
          <pre class="overflow-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-xs leading-6 text-zinc-300" x-text="debugOutput"></pre>
        </div>
      </section>

      <section x-show="page === 'diary'" class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold">日记</h1>
            <p class="mt-1 text-sm text-zinc-400">每日叙事日记与已卷起的周记。</p>
          </div>
          <button type="button" @click="loadDiary()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">
            <i data-lucide="refresh-cw" class="h-4 w-4"></i><span>刷新</span>
          </button>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">周记</h2>
            <span class="text-xs text-zinc-400" x-text="diaryWeeklies.length + ' 条'"></span>
          </div>
          <template x-if="diaryWeeklies.length === 0">
            <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">还没有周记。</div>
          </template>
          <template x-for="entry in diaryWeeklies" :key="entry.week">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span class="rounded-full border border-zinc-800 px-2 py-0.5 font-medium text-zinc-200" x-text="entry.week"></span>
                <span x-text="entry.start_date + ' ~ ' + entry.end_date"></span>
                <span x-text="entry.source_days + ' 天汇入'"></span>
              </div>
              <h3 class="text-base font-semibold text-zinc-100" x-text="entry.title"></h3>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-7 text-zinc-300" :class="isDiaryExpanded('weekly:' + entry.week) ? '' : 'line-clamp-4'" x-text="entry.summary"></p>
              <button type="button" @click="toggleDiaryExpand('weekly:' + entry.week)" class="tap mt-2 text-xs text-coral transition duration-150 ease-in-out hover:underline" x-text="isDiaryExpanded('weekly:' + entry.week) ? '收起' : '展开全文'"></button>
            </article>
          </template>
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">日记</h2>
            <span class="text-xs text-zinc-400" x-text="diaryDailies.length + ' 条'"></span>
          </div>
          <template x-if="diaryDailies.length === 0">
            <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">还没有日记。</div>
          </template>
          <template x-for="entry in diaryDailies" :key="entry.date">
            <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
              <div class="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span class="rounded-full border border-zinc-800 px-2 py-0.5 font-medium text-zinc-200" x-text="entry.date"></span>
                <span x-text="fmt(entry.updated_at)"></span>
              </div>
              <h3 class="text-base font-semibold text-zinc-100" x-text="entry.title"></h3>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-7 text-zinc-300" :class="isDiaryExpanded('daily:' + entry.date) ? '' : 'line-clamp-4'" x-text="entry.summary"></p>
              <button type="button" @click="toggleDiaryExpand('daily:' + entry.date)" class="tap mt-2 text-xs text-coral transition duration-150 ease-in-out hover:underline" x-text="isDiaryExpanded('daily:' + entry.date) ? '收起' : '展开全文'"></button>
            </article>
          </template>
        </div>
      </section>

      <section x-show="page === 'starmap'" class="space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold tracking-normal">星图</h1>
            <p class="mt-1 text-sm text-zinc-400">记忆关系力导向图 · 拖拽平移 · 滚轮缩放 · 点星看边</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400" x-text="starmapCountLabel()"></span>
            <button type="button" @click="loadStarmap()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-sm transition duration-150 ease-in-out hover:border-coral">
              <i data-lucide="refresh-cw" class="h-4 w-4"></i><span>刷新</span>
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <template x-for="item in starmapLegendItems" :key="item.id">
            <button type="button" @click="toggleStarmapLegend(item.id)" class="starmap-legend-btn tap inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 transition duration-150 ease-in-out hover:border-coral" :class="starmapLegend[item.id] ? '' : 'is-off'">
              <span class="inline-block h-2 w-2 rounded-full" :style="'background:' + item.color"></span>
              <span x-text="item.label"></span>
            </button>
          </template>
          <div class="ml-auto flex min-w-[12rem] flex-1 items-center gap-2 md:max-w-xs">
            <input x-model="starmapSearch" @keydown.enter.prevent="searchStarmap()" class="h-10 w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral" placeholder="搜索标签…">
            <button type="button" @click="searchStarmap()" class="tap grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-coral" aria-label="搜索星图">
              <i data-lucide="search" class="h-4 w-4"></i>
            </button>
          </div>
        </div>

        <div class="relative starmap-shell overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-sm">
          <div class="absolute inset-0">
            <canvas x-ref="starmapCanvas" class="starmap-canvas h-full w-full"></canvas>
          </div>

          <div x-show="starmapLoading" class="absolute inset-0 z-10 grid place-items-center bg-[#0a0a0b]/70 text-sm text-zinc-300">加载星图…</div>
          <div x-show="!starmapLoading && starmapNodes.length === 0" class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
            <div class="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 text-center text-sm text-zinc-400 shadow-sm">
              还没有星星。先在记忆页沉淀一些 active 记忆，或等今晚做梦抽出关系后再来。
            </div>
          </div>
          <div x-show="!starmapLoading && starmapNodes.length > 0 && starmapEdges.length === 0" class="pointer-events-none absolute bottom-3 left-3 right-3 z-10 md:right-auto">
            <div class="rounded-2xl border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs text-zinc-400 shadow-sm">星星还没牵手——今晚做梦之后再来看</div>
          </div>
          <div x-show="!starmapLoading && starmapNodes.length > 0" class="starmap-caption absolute bottom-2 right-3 z-10 select-none text-[11px] tracking-wide">每颗星都是我记得你的一次。</div>

          <aside x-show="starmapSelected" x-transition.opacity.duration.150ms class="starmap-drawer absolute inset-x-0 bottom-0 z-20 overflow-y-auto border-t border-zinc-800 bg-zinc-900/95 p-4 backdrop-blur md:inset-x-auto md:bottom-3 md:right-3 md:top-3 md:w-80 md:rounded-2xl md:border md:shadow-sm">
            <div class="mb-2 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs text-zinc-400">详情</div>
                <h2 class="mt-1 text-sm font-semibold leading-6 text-zinc-100" x-text="starmapSelected && starmapSelected.label"></h2>
              </div>
              <button type="button" @click="clearStarmapSelect()" class="tap grid h-9 w-9 place-items-center rounded-2xl border border-zinc-800 text-zinc-400 hover:border-coral hover:text-zinc-100" aria-label="关闭详情">
                <i data-lucide="x" class="h-4 w-4"></i>
              </button>
            </div>
            <div class="grid grid-cols-2 gap-2 text-xs text-zinc-400">
              <div class="rounded-xl border border-zinc-800 bg-[#0a0a0b] px-2 py-1.5"><span class="text-zinc-500">type</span><div class="mt-0.5 text-zinc-200" x-text="starmapSelected && starmapSelected.type"></div></div>
              <div class="rounded-xl border border-zinc-800 bg-[#0a0a0b] px-2 py-1.5"><span class="text-zinc-500">importance</span><div class="mt-0.5 text-zinc-200" x-text="starmapSelected && pct(starmapSelected.importance)"></div></div>
              <div class="rounded-xl border border-zinc-800 bg-[#0a0a0b] px-2 py-1.5"><span class="text-zinc-500">status</span><div class="mt-0.5 text-zinc-200" x-text="(starmapSelected && starmapSelected.version_status) || 'current'"></div></div>
              <div class="rounded-xl border border-zinc-800 bg-[#0a0a0b] px-2 py-1.5"><span class="text-zinc-500">created</span><div class="mt-0.5 text-zinc-200" x-text="starmapSelected && fmt(starmapSelected.created_at)"></div></div>
            </div>
            <div class="mt-3">
              <div class="mb-1.5 text-xs text-zinc-500">相邻边</div>
              <template x-if="!starmapNeighbors.length">
                <div class="rounded-xl border border-zinc-800 bg-[#0a0a0b] px-3 py-2 text-xs text-zinc-500">这颗星还没有连线。</div>
              </template>
              <div class="space-y-1.5">
                <template x-for="edge in starmapNeighbors" :key="edge.key">
                  <button type="button" @click="focusStarmapNeighbor(edge.otherId)" class="tap flex w-full items-start gap-2 rounded-xl border border-zinc-800 bg-[#0a0a0b] px-3 py-2 text-left text-xs transition duration-150 ease-in-out hover:border-coral">
                    <span class="shrink-0 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300" x-text="edge.rel_type"></span>
                    <span class="min-w-0 flex-1 text-zinc-200" x-text="edge.otherLabel"></span>
                  </button>
                </template>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section x-show="page === 'dream'" class="space-y-4">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold">梦境观测台</h1>
            <p class="mt-1 text-sm text-zinc-400">每晚大脑发生了什么：运行、收成与手动做梦。</p>
          </div>
          <button type="button" @click="refreshDream()" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 text-sm transition duration-150 ease-in-out hover:border-coral">
            <i data-lucide="refresh-cw" class="h-4 w-4"></i><span>刷新</span>
          </button>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div class="dream-stat rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
            <div class="text-xs text-zinc-400">最近一次</div>
            <div class="mt-1 truncate text-lg font-semibold" x-text="dreamLatestLabel()"></div>
            <div class="truncate text-[11px] text-zinc-500" x-text="dreamLatestSub()"></div>
          </div>
          <div class="dream-stat rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
            <div class="text-xs text-zinc-400">近 7 天成功率</div>
            <div class="mt-1 text-xl font-semibold aurora-text" x-text="dreamSuccessRate()"></div>
          </div>
          <div class="dream-stat rounded-2xl border border-zinc-800 bg-zinc-900 p-3 shadow-sm">
            <div class="text-xs text-zinc-400">近 7 天处理消息</div>
            <div class="mt-1 text-xl font-semibold" x-text="dreamProcessedTotal()"></div>
          </div>
        </div>

        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold">每日待消化消息</h2>
            <span class="text-xs text-zinc-400" x-text="dreamAnchorLabel()"></span>
          </div>
          <template x-if="dreamDayBars().length === 0">
            <div class="text-sm text-zinc-400">还没有消息记录。</div>
          </template>
          <div class="space-y-2.5">
            <template x-for="day in dreamDayBars()" :key="day.date">
              <div class="flex items-center gap-3">
                <span class="w-14 shrink-0 text-xs text-zinc-400" x-text="day.date.slice(5)"></span>
                <div class="raw-bar-track min-w-0 flex-1">
                  <div class="raw-bar-fill" :class="day.done ? 'is-done' : ''" :style="'width:' + day.widthPct + '%'"></div>
                </div>
                <span class="w-9 shrink-0 text-right text-xs" :class="day.pending ? 'text-coral' : 'text-zinc-400'" x-text="day.raw"></span>
                <span class="chip hidden shrink-0 sm:inline-flex" :class="day.done ? '' : (day.pending ? 'chip-warn' : 'chip-dim')" x-text="day.stateLabel"></span>
              </div>
            </template>
          </div>
        </article>

        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <h2 class="text-base font-semibold">现在做梦</h2>
          <p class="mt-1 text-xs text-zinc-400">预演只看不落库；关掉预演才是真跑。force 会重做已经梦过的夜晚。</p>
          <div class="mt-3 grid gap-3 md:grid-cols-[170px_1fr_1fr_auto]">
            <input type="date" x-model="dreamDate" class="h-11 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral">
            <label class="tap flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 text-sm text-zinc-300">
              <input type="checkbox" x-model="dreamDryRun" class="h-4 w-4 shrink-0 accent-[#ff7a66]"><span>预演 dry_run</span>
            </label>
            <label class="tap flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 text-sm text-zinc-300">
              <input type="checkbox" x-model="dreamForce" class="h-4 w-4 shrink-0 accent-[#ff7a66]"><span>force 重跑</span>
            </label>
            <button type="button" @click="triggerDream()" :disabled="dreamTriggering" class="tap inline-flex items-center justify-center gap-2 rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950 transition duration-150 ease-in-out disabled:opacity-50">
              <i data-lucide="moon-star" class="h-4 w-4"></i><span x-text="dreamTriggering ? '做梦中…' : '现在做梦'"></span>
            </button>
          </div>

          <div x-show="dreamRunResult" class="mt-4 space-y-3">
            <template x-if="dreamRunResult && dreamRunResult.result && !dreamRunResult.result.ran">
              <div class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-sm text-zinc-300" x-text="'这一夜没有做梦：' + dreamReasonLabel(dreamRunResult.result.reason)"></div>
            </template>

            <template x-if="dreamRunResult && !dreamRunResult.dry_run && dreamRunResult.result && dreamRunResult.result.ran">
              <div class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-xs leading-6 text-zinc-300">
                <span class="font-semibold text-zinc-100">这一夜梦完了。</span>
                <span x-text="dreamRunStatsLine()"></span>
              </div>
            </template>

            <template x-if="dreamRunResult && dreamRunResult.dry_run && dreamRunResult.result && dreamRunResult.result.ran">
              <div class="space-y-3">
                <div x-show="dreamProposal()" class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
                  <div class="mb-1 text-xs font-semibold text-zinc-300">当夜提案</div>
                  <div class="text-sm font-semibold text-zinc-100" x-text="dreamProposal() && (dreamProposal().title || '(无标题)')"></div>
                  <p class="mt-1 whitespace-pre-wrap text-xs leading-6 text-zinc-400" x-text="dreamProposal() && (dreamProposal().summary || '')"></p>
                  <div class="mt-2 flex flex-wrap gap-2">
                    <span class="chip chip-ok" x-text="'新增 ' + dreamProposalList('memories_to_add').length"></span>
                    <span class="chip chip-warn" x-text="'更新 ' + dreamProposalList('memories_to_update').length"></span>
                    <span class="chip chip-err" x-text="'归档 ' + dreamProposalList('memories_to_delete').length"></span>
                  </div>
                </div>

                <div>
                  <div class="mb-2 text-xs font-semibold text-zinc-300">抽取的记忆 <span class="text-zinc-500" x-text="'(' + dreamExtracted().length + ')'"></span></div>
                  <template x-if="dreamExtracted().length === 0">
                    <div class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-xs text-zinc-500">这一夜没有抽取到记忆。</div>
                  </template>
                  <div class="grid gap-2 lg:grid-cols-2">
                    <template x-for="(mem, idx) in dreamExtracted()" :key="idx">
                      <div class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
                        <div class="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span class="rounded-full bg-coral px-2 py-0.5 font-semibold text-zinc-950" x-text="mem.type"></span>
                          <span class="text-zinc-400" x-text="'重要性 ' + pct(mem.importance)"></span>
                          <span class="min-w-0 truncate text-zinc-500" x-text="mem.fact_key || ''"></span>
                        </div>
                        <p class="whitespace-pre-wrap text-xs leading-6 text-zinc-200" x-text="mem.content"></p>
                      </div>
                    </template>
                  </div>
                </div>

                <div>
                  <div class="mb-2 text-xs font-semibold text-zinc-300">路由计划</div>
                  <template x-if="dreamRoutingGroups().length === 0">
                    <div class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3 text-xs text-zinc-500">没有路由项。</div>
                  </template>
                  <div class="space-y-2">
                    <template x-for="group in dreamRoutingGroups()" :key="group.key">
                      <div class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
                        <div class="mb-1.5 flex items-center gap-2 text-xs">
                          <span class="chip chip-aurora" x-text="group.label"></span>
                          <span class="text-zinc-500" x-text="group.items.length + ' 条'"></span>
                        </div>
                        <div class="space-y-1.5">
                          <template x-for="(item, i) in group.items" :key="i">
                            <div class="flex items-start gap-2 text-xs leading-6">
                              <span class="chip chip-dim shrink-0" x-text="dreamRoutingKindLabel(item.kind)"></span>
                              <span class="min-w-0 flex-1 text-zinc-300" x-text="item.content || item.target_id || item.fact_key || '(无内容)'"></span>
                            </div>
                          </template>
                        </div>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </article>

        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">运行时间线</h2>
            <span class="text-xs text-zinc-400" x-text="dreamRuns.length + ' 次'"></span>
          </div>
          <template x-if="dreamRuns.length === 0">
            <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-400">近 7 天还没有做梦记录。</div>
          </template>
          <div class="dream-rail space-y-3">
            <template x-for="run in dreamRuns" :key="run.id">
              <article class="dream-rail-item" :class="dreamRailClass(run.status)">
                <div class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
                  <div class="mb-2 flex flex-wrap items-center gap-2">
                    <span class="text-sm font-semibold text-zinc-100" x-text="run.date_label"></span>
                    <span class="chip" :class="dreamStatusChipClass(run.status)">
                      <span x-show="run.status === 'running'" class="breathe inline-block h-1.5 w-1.5 rounded-full bg-current"></span>
                      <span x-text="dreamStatusLabel(run.status)"></span>
                    </span>
                    <span class="chip chip-dim" x-text="dreamTriggerLabel(run.trigger)"></span>
                    <span class="ml-auto text-xs text-zinc-400" x-text="dreamDuration(run)"></span>
                  </div>
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                    <span class="min-w-0 truncate" x-text="run.model || '模型未知'"></span>
                    <span x-text="'消息 ' + (run.processed_messages == null ? '—' : run.processed_messages)"></span>
                    <span x-text="fmt(run.started_at)"></span>
                  </div>
                  <template x-if="dreamRunNote(run)">
                    <div class="mt-2">
                      <p class="text-xs leading-6 text-zinc-400" :class="isDreamExpanded(run.id) ? '' : 'line-clamp-2'" x-text="dreamRunNote(run)"></p>
                      <button type="button" x-show="dreamRunNote(run).length > 80" @click="toggleDreamExpand(run.id)" class="tap text-xs text-coral transition duration-150 ease-in-out hover:underline" x-text="isDreamExpanded(run.id) ? '收起' : '展开全文'"></button>
                    </div>
                  </template>
                </div>
              </article>
            </template>
          </div>
        </div>

        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-base font-semibold">当夜收成</h2>
              <p class="mt-1 text-xs text-zinc-400">某个夜晚，记忆来了又暗下去的完整清单。</p>
            </div>
            <div class="flex items-center gap-2">
              <input type="date" x-model="dreamHarvestDate" @change="loadDreamHarvest()" class="h-10 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral">
              <button type="button" @click="loadDreamHarvest()" :disabled="dreamHarvestLoading" class="tap inline-flex items-center gap-2 rounded-2xl border border-zinc-800 px-3 text-sm transition duration-150 ease-in-out hover:border-coral disabled:opacity-50">
                <i data-lucide="refresh-cw" class="h-4 w-4"></i><span x-text="dreamHarvestLoading ? '加载中…' : '查看'"></span>
              </button>
            </div>
          </div>

          <div x-show="dreamHarvest" class="mt-4 grid gap-3 md:grid-cols-3">
            <section class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
              <button type="button" @click="harvestOpen.new = !harvestOpen.new" class="tap flex w-full items-center gap-2 text-left">
                <span class="harvest-dot harvest-dot-new"></span>
                <span class="text-sm font-semibold text-zinc-100">新生</span>
                <span class="text-xs text-zinc-500" x-text="dreamHarvestCreated().length + ' 条'"></span>
                <span class="ml-auto text-xs text-zinc-500" x-text="harvestOpen.new ? '▾' : '▸'"></span>
              </button>
              <div x-show="harvestOpen.new" class="mt-3 space-y-2">
                <template x-if="dreamHarvestCreated().length === 0">
                  <div class="text-xs text-zinc-500">这一夜没有新的记忆落下。</div>
                </template>
                <template x-for="item in dreamHarvestCreated()" :key="item.id">
                  <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span class="rounded-full bg-coral px-2 py-0.5 font-semibold text-zinc-950" x-text="item.type"></span>
                      <span class="text-zinc-400" x-text="pct(item.importance)"></span>
                      <span x-show="item.status !== 'active'" class="chip chip-dim" x-text="item.status"></span>
                    </div>
                    <p class="whitespace-pre-wrap text-xs leading-6 text-zinc-200" x-text="item.content"></p>
                  </div>
                </template>
              </div>
            </section>

            <section class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
              <button type="button" @click="harvestOpen.dim = !harvestOpen.dim" class="tap flex w-full items-center gap-2 text-left">
                <i data-lucide="star" class="h-3.5 w-3.5 text-zinc-500"></i>
                <span class="text-sm font-semibold text-zinc-100">沉眠</span>
                <span class="text-xs text-zinc-500" x-text="dreamHarvestDormant().length + ' 条'"></span>
                <span class="ml-auto text-xs text-zinc-500" x-text="harvestOpen.dim ? '▾' : '▸'"></span>
              </button>
              <div x-show="harvestOpen.dim" class="mt-3 space-y-2">
                <template x-if="dreamHarvestDormant().length === 0">
                  <div class="text-xs text-zinc-500">这一夜没有记忆暗下去。</div>
                </template>
                <template x-for="item in dreamHarvestDormant()" :key="item.id">
                  <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3 opacity-80">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span class="chip chip-dim" x-text="dreamDormantLabel(item.status)"></span>
                      <span class="text-zinc-500" x-text="item.type"></span>
                      <span class="text-zinc-500" x-text="fmt(item.updated_at)"></span>
                    </div>
                    <p class="whitespace-pre-wrap text-xs leading-6 text-zinc-400" x-text="item.content"></p>
                    <p x-show="item.superseded_by" class="mt-1 text-[11px] text-zinc-500">接替者 <span class="font-mono" x-text="item.superseded_by"></span></p>
                  </div>
                </template>
              </div>
            </section>

            <section class="rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
              <button type="button" @click="harvestOpen.judged = !harvestOpen.judged" class="tap flex w-full items-center gap-2 text-left">
                <span class="chip chip-aurora">判</span>
                <span class="text-sm font-semibold text-zinc-100">判决</span>
                <span class="text-xs text-zinc-500" x-text="dreamHarvestCandidates().length + ' 条'"></span>
                <span class="ml-auto text-xs text-zinc-500" x-text="harvestOpen.judged ? '▾' : '▸'"></span>
              </button>
              <div x-show="harvestOpen.judged" class="mt-3 space-y-2">
                <template x-if="dreamHarvestCandidates().length === 0">
                  <div class="text-xs text-zinc-500">这一夜没有判决。</div>
                </template>
                <template x-for="item in dreamHarvestCandidates()" :key="item.id">
                  <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                    <div class="mb-1 flex flex-wrap items-center gap-2 text-xs">
                      <span class="chip" :class="item.status === 'approved' ? 'chip-ok' : 'chip-dim'" x-text="dreamCandidateStatusLabel(item.status)"></span>
                      <span class="chip chip-dim" x-text="dreamCandidateSourceLabel(item.source)"></span>
                      <span class="text-zinc-500" x-text="item.type"></span>
                    </div>
                    <p class="whitespace-pre-wrap text-xs leading-6 text-zinc-200" x-text="item.content"></p>
                    <p x-show="item.decision_note" class="mt-1 text-[11px] leading-5 text-zinc-500" x-text="item.decision_note"></p>
                  </div>
                </template>
              </div>
            </section>
          </div>
          <div x-show="!dreamHarvest && !dreamHarvestLoading" class="mt-4 text-xs text-zinc-500">选一个夜晚，看看那晚大脑里发生了什么。</div>
        </article>
      </section>

      <section x-show="page === 'settings'" class="space-y-4 md:hidden">
        <h1 class="text-2xl font-semibold">设置</h1>
        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <button type="button" @click="toggleTheme()" class="tap mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-4 text-sm text-zinc-100 transition duration-150 ease-in-out hover:border-coral">
            <i :data-lucide="theme === 'light' ? 'moon' : 'sun'" class="h-4 w-4"></i>
            <span x-text="theme === 'light' ? '切到夜间模式' : '切到白天模式'"></span>
          </button>
          <label class="text-xs text-zinc-400">Worker</label>
          <input x-model="workerUrl" @change="savePrefs()" class="mt-2 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="Worker URL">
          <label class="mt-4 block text-xs text-zinc-400">Token</label>
          <div class="mt-2 flex gap-2">
            <input x-model="apiKey" @keydown.enter.prevent="saveToken()" type="password" class="h-11 min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="Bearer token">
            <button type="button" @click="saveToken()" class="tap grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-coral text-zinc-950 active:bg-coral/80" aria-label="保存 token" title="保存 token">
              <i data-lucide="save" class="h-4 w-4"></i>
            </button>
            <button type="button" @click="clearToken()" class="tap grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-zinc-800 bg-[#0a0a0b] text-zinc-400 hover:border-coral hover:text-zinc-100" aria-label="清除 token" title="清除 token">
              <i data-lucide="trash-2" class="h-4 w-4"></i>
            </button>
          </div>
          <div class="mt-1 text-[11px]" :class="tokenSaved() ? 'text-zinc-500' : 'text-coral'" x-text="tokenSaved() ? 'Token 已保存到本机' : 'Token 尚未保存'"></div>
          <label class="mt-4 block text-xs text-zinc-400">Namespace</label>
          <input x-model="namespace" @change="reloadAll()" class="mt-2 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm outline-none focus:border-coral" placeholder="default">
        </article>
      </section>
    </main>
  </div>

  <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-[#0a0a0b]/95 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
    <div class="grid grid-cols-8 gap-0.5">
      <button type="button" @click="go('today')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'today' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="sun" class="h-5 w-5"></i><span>今日</span></button>
      <button type="button" @click="go('diary')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'diary' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="book-open" class="h-5 w-5"></i><span>日记</span></button>
      <button type="button" @click="go('dream')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'dream' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="moon-star" class="h-5 w-5"></i><span>梦境</span></button>
      <button type="button" @click="go('review')" class="tap relative grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'review' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="inbox" class="h-5 w-5"></i><span>审核</span><span x-show="pendingCount" class="absolute right-1 top-1 rounded-full bg-coral px-1.5 text-[10px] font-semibold text-zinc-950" x-text="pendingCount"></span></button>
      <button type="button" @click="go('memory')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'memory' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="database" class="h-5 w-5"></i><span>记忆</span></button>
      <button type="button" @click="go('starmap')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'starmap' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="sparkles" class="h-5 w-5"></i><span>星图</span></button>
      <button type="button" @click="go('more')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'more' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="more-horizontal" class="h-5 w-5"></i><span>更多</span></button>
      <button type="button" @click="go('settings')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'settings' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="settings" class="h-5 w-5"></i><span>设置</span></button>
    </div>
  </nav>
</div>

<script>
// Starmap force-directed engine lives outside Alpine so simulation state is not deeply reactive.
var starmapEngine = (function() {
  var TYPE_HUE = {
    fact: 210, event: 32, preference: 300, relationship: 350,
    boundary: 15, habit: 160, decision: 45, note: 190
  };
  var REL_STYLE = {
    supports: { color: [220, 225, 235], dash: null, width: 1.1 },
    contradicts: { color: [239, 68, 68], dash: [5, 4], width: 1.2 },
    cause_effect: { color: [245, 158, 11], dash: null, width: 1.15 },
    derived_from: { color: [167, 139, 250], dash: null, width: 1.05 },
    same_thread: { color: [125, 180, 220], dash: null, width: 0.9 },
    supersedes: { color: [140, 140, 150], dash: null, width: 1.0, arrow: true }
  };
  var CORAL = [244, 160, 124];
  var ENERGY_STOP = 0.012;
  var s = {
    canvas: null,
    ctx: null,
    nodes: [],
    edges: [],
    nodeById: {},
    adj: {},
    w: 0,
    h: 0,
    dpr: 1,
    camX: 0,
    camY: 0,
    scale: 1,
    running: false,
    raf: 0,
    energy: 1,
    hoverId: null,
    selectedId: null,
    dragNode: null,
    pan: null,
    pulseId: null,
    pulseT: 0,
    hiddenRel: {},
    theme: 'dark',
    onSelect: null,
    ro: null,
    pointers: {},
    pinch: null,
    dust: [],
    fitDone: false,
    lastDraw: 0
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; }
  function typeColor(type, light) {
    var hue = TYPE_HUE[type] != null ? TYPE_HUE[type] : 200;
    var sat = light ? 0.55 : 0.45;
    var lit = light ? 0.42 : 0.72;
    var c = (1 - Math.abs(2 * lit - 1)) * sat;
    var x = c * (1 - Math.abs((hue / 60) % 2 - 1));
    var m = lit - c / 2;
    var r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; }
    else if (hue < 120) { r = x; g = c; }
    else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; }
    else if (hue < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  function nodeRadius(importance) {
    // map importance 0.3→0.9 to radius 2→7
    var imp = Number(importance);
    if (!Number.isFinite(imp)) imp = 0.5;
    var t = clamp((imp - 0.3) / 0.6, 0, 1);
    return 2 + t * 5;
  }
  function screenToWorld(sx, sy) {
    return {
      x: (sx - s.w / 2) / s.scale - s.camX,
      y: (sy - s.h / 2) / s.scale - s.camY
    };
  }
  function rebuildAdj() {
    s.adj = {};
    for (var i = 0; i < s.nodes.length; i++) s.adj[s.nodes[i].id] = [];
    for (var j = 0; j < s.edges.length; j++) {
      var e = s.edges[j];
      if (s.hiddenRel[e.rel_type]) continue;
      if (!s.nodeById[e.src] || !s.nodeById[e.dst]) continue;
      s.adj[e.src].push(e.dst);
      s.adj[e.dst].push(e.src);
    }
  }
  function initPositions() {
    var n = s.nodes.length;
    var R = Math.max(80, Math.sqrt(Math.max(n, 1)) * 28);
    for (var i = 0; i < n; i++) {
      var node = s.nodes[i];
      var ang = (i / Math.max(n, 1)) * Math.PI * 2 + (i % 7) * 0.17;
      var rad = R * (0.35 + 0.65 * ((i * 0.6180339887) % 1));
      node.x = Math.cos(ang) * rad;
      node.y = Math.sin(ang) * rad;
      node.vx = 0;
      node.vy = 0;
      node.r = nodeRadius(node.importance);
      node.fx = null;
      node.fy = null;
      // twinkle: per-star phase/speed so the sky breathes out of sync
      node.twPhase = ((i * 2654435761) % 628) / 100;
      node.twSpeed = 0.5 + ((i * 40503) % 100) / 100;
    }
    // backdrop dust: deterministic faint mini-stars behind the graph, parallax layer
    s.dust = [];
    var seed = 48271;
    var rnd = function() { seed = (seed * 69621) % 2147483647; return seed / 2147483647; };
    var dustCount = 140;
    var DR = R * 2.6 + 300;
    for (var d = 0; d < dustCount; d++) {
      s.dust.push({
        x: (rnd() * 2 - 1) * DR,
        y: (rnd() * 2 - 1) * DR,
        r: 0.4 + rnd() * 0.9,
        a: 0.08 + rnd() * 0.22,
        phase: rnd() * Math.PI * 2
      });
    }
    s.camX = 0;
    s.camY = 0;
    s.scale = 1;
    s.energy = 1;
    s.fitDone = false;
  }
  function fitView() {
    var n = s.nodes.length;
    if (!n || !s.w || !s.h) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (var i = 0; i < n; i++) {
      var node = s.nodes[i];
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    var bw = Math.max(maxX - minX, 40);
    var bh = Math.max(maxY - minY, 40);
    s.scale = clamp(Math.min((s.w - 120) / bw, (s.h - 120) / bh), 0.35, 2.2);
    s.camX = -(minX + maxX) / 2;
    s.camY = -(minY + maxY) / 2;
  }
  function stepPhysics() {
    var nodes = s.nodes;
    var n = nodes.length;
    if (n === 0) { s.energy = 0; return; }
    var repulse = 2800;
    var springK = 0.045;
    var rest = 72;
    var centerG = 0.008;
    var damp = 0.86;
    var i, j, a, b, dx, dy, dist2, dist, f, fx, fy;
    for (i = 0; i < n; i++) {
      a = nodes[i];
      a.fx = a.fx == null ? 0 : a.fx;
      a.fy = a.fy == null ? 0 : a.fy;
      // center gravity
      a.fx += -a.x * centerG;
      a.fy += -a.y * centerG;
    }
    // repulsion O(n^2) — fine for ≤800
    for (i = 0; i < n; i++) {
      a = nodes[i];
      for (j = i + 1; j < n; j++) {
        b = nodes[j];
        dx = a.x - b.x;
        dy = a.y - b.y;
        dist2 = dx * dx + dy * dy + 0.01;
        dist = Math.sqrt(dist2);
        f = repulse / dist2;
        fx = (dx / dist) * f;
        fy = (dy / dist) * f;
        a.fx += fx;
        a.fy += fy;
        b.fx -= fx;
        b.fy -= fy;
      }
    }
    // edge springs
    for (i = 0; i < s.edges.length; i++) {
      var e = s.edges[i];
      if (s.hiddenRel[e.rel_type]) continue;
      a = s.nodeById[e.src];
      b = s.nodeById[e.dst];
      if (!a || !b) continue;
      dx = b.x - a.x;
      dy = b.y - a.y;
      dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      var force = (dist - rest) * springK * (0.5 + 0.5 * (Number(e.weight) || 1));
      fx = (dx / dist) * force;
      fy = (dy / dist) * force;
      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }
    var energy = 0;
    for (i = 0; i < n; i++) {
      a = nodes[i];
      if (a.dragFixed) {
        a.vx = 0;
        a.vy = 0;
        a.fx = 0;
        a.fy = 0;
        continue;
      }
      a.vx = (a.vx + a.fx) * damp;
      a.vy = (a.vy + a.fy) * damp;
      a.x += a.vx;
      a.y += a.vy;
      energy += a.vx * a.vx + a.vy * a.vy;
      a.fx = 0;
      a.fy = 0;
    }
    s.energy = energy / Math.max(n, 1);
  }
  function hitTest(wx, wy) {
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < s.nodes.length; i++) {
      var node = s.nodes[i];
      var dx = node.x - wx;
      var dy = node.y - wy;
      // pad ~10 CSS px in screen space so zoom does not shrink the hit target
      var hitR = node.r + 10 / s.scale;
      var d2 = dx * dx + dy * dy;
      if (d2 <= hitR * hitR && d2 < bestD) {
        bestD = d2;
        best = node;
      }
    }
    return best;
  }
  function neighborSet(id) {
    var set = {};
    if (!id) return set;
    set[id] = true;
    var list = s.adj[id] || [];
    for (var i = 0; i < list.length; i++) set[list[i]] = true;
    return set;
  }
  function draw() {
    var ctx = s.ctx;
    if (!ctx || !s.canvas) return;
    var light = s.theme === 'light';
    var bg = light ? '#eceef8' : '#070a16';
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s.w, s.h);

    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // backdrop dust: slower camera (parallax) so the sky has depth
    if (s.dust.length && !light) {
      ctx.save();
      ctx.translate(s.w / 2, s.h / 2);
      ctx.scale(s.scale, s.scale);
      ctx.translate(s.camX * 0.35, s.camY * 0.35);
      for (var di = 0; di < s.dust.length; di++) {
        var mote = s.dust[di];
        var da = mote.a * (0.7 + 0.3 * Math.sin(now * 0.0004 + mote.phase));
        ctx.beginPath();
        ctx.fillStyle = 'rgba(200,210,230,' + da + ')';
        ctx.arc(mote.x, mote.y, mote.r / s.scale, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(s.w / 2, s.h / 2);
    ctx.scale(s.scale, s.scale);
    ctx.translate(s.camX, s.camY);

    var focus = s.hoverId || s.selectedId;
    var neigh = neighborSet(focus);
    var dim = focus ? 0.12 : 1;

    // edges
    for (var i = 0; i < s.edges.length; i++) {
      var e = s.edges[i];
      if (s.hiddenRel[e.rel_type]) continue;
      var a = s.nodeById[e.src];
      var b = s.nodeById[e.dst];
      if (!a || !b) continue;
      var style = REL_STYLE[e.rel_type] || REL_STYLE.supports;
      // one-hop: edge highlighted when either end is the hover/selected focus node
      var edgeLit = !focus || a.id === focus || b.id === focus;
      var alpha = (edgeLit ? 0.55 : dim * 0.35) * clamp(Number(e.weight) || 1, 0.15, 1);
      if (light) alpha = Math.min(1, alpha + 0.15);
      ctx.beginPath();
      ctx.strokeStyle = rgba(style.color, alpha);
      ctx.lineWidth = (style.width || 1) / s.scale;
      if (style.dash) ctx.setLineDash(style.dash.map(function(v) { return v / s.scale; }));
      else ctx.setLineDash([]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (style.arrow) {
        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / dist;
        var uy = dy / dist;
        var tipX = b.x - ux * (b.r + 2);
        var tipY = b.y - uy * (b.r + 2);
        var ah = 6 / s.scale;
        ctx.beginPath();
        ctx.fillStyle = rgba(style.color, alpha);
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * ah - uy * ah * 0.5, tipY - uy * ah + ux * ah * 0.5);
        ctx.lineTo(tipX - ux * ah + uy * ah * 0.5, tipY - uy * ah - ux * ah * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // nodes
    var margin = 40 / s.scale;
    var viewL = -s.camX - s.w / (2 * s.scale) - margin;
    var viewR = -s.camX + s.w / (2 * s.scale) + margin;
    var viewT = -s.camY - s.h / (2 * s.scale) - margin;
    var viewB = -s.camY + s.h / (2 * s.scale) + margin;

    for (var n = 0; n < s.nodes.length; n++) {
      var node = s.nodes[n];
      var lit = !focus || neigh[node.id];
      var alphaN = lit ? 1 : 0.18;
      var col = node.pinned ? CORAL : typeColor(node.type, light);
      var r = node.r;
      if (s.pulseId === node.id) {
        var pulse = 0.5 + 0.5 * Math.sin(s.pulseT * 0.25);
        r = r * (1.15 + pulse * 0.55);
      }
      if (s.selectedId === node.id) r *= 1.15;

      var inView = node.x + r >= viewL && node.x - r <= viewR && node.y + r >= viewT && node.y - r <= viewB;
      if (!inView) continue;

      // twinkle: each star breathes on its own rhythm
      var tw = 0.82 + 0.18 * Math.sin(now * 0.001 * node.twSpeed + node.twPhase);

      // glow only when on-screen and reasonably large on screen
      var screenR = r * s.scale;
      if (screenR >= 2.5 && alphaN > 0.2) {
        var glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3.2);
        glow.addColorStop(0, rgba(col, 0.55 * alphaN * tw));
        glow.addColorStop(0.45, rgba(col, 0.18 * alphaN * tw));
        glow.addColorStop(1, rgba(col, 0));
        ctx.beginPath();
        ctx.fillStyle = glow;
        ctx.arc(node.x, node.y, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.fillStyle = rgba(col, (light ? 0.92 : 0.95) * alphaN * (0.9 + 0.1 * tw));
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (light) {
        ctx.strokeStyle = rgba([30, 30, 35], 0.55 * alphaN);
        ctx.lineWidth = 1 / s.scale;
        ctx.stroke();
      }

      if (node.pinned) {
        ctx.strokeStyle = rgba(CORAL, 0.85 * alphaN);
        ctx.lineWidth = 1.2 / s.scale;
        var spike = r * 2.4;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - spike);
        ctx.lineTo(node.x, node.y + spike);
        ctx.moveTo(node.x - spike, node.y);
        ctx.lineTo(node.x + spike, node.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
  function frame() {
    s.raf = 0;
    if (!s.canvas || !s.canvas.isConnected) return;
    // section hidden (page switched away): stop burning frames; go('starmap') re-wakes us
    if (s.canvas.offsetParent === null) return;
    if (s.running) {
      stepPhysics();
      if (s.energy < ENERGY_STOP && !s.dragNode) {
        s.running = false;
        // first settle: frame the whole sky once
        if (!s.fitDone) { s.fitDone = true; fitView(); }
      }
    }
    if (s.pulseId) {
      s.pulseT += 1;
      if (s.pulseT > 90) { s.pulseId = null; s.pulseT = 0; }
      else s.running = true;
    }
    var active = s.running || s.pulseId || s.dragNode || s.pan;
    var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // idle: keep twinkling at ~8fps instead of freezing the sky
    if (active || now - s.lastDraw >= 120) {
      draw();
      s.lastDraw = now;
    }
    if (active || s.nodes.length) {
      s.raf = requestAnimationFrame(frame);
    }
  }
  function wake() {
    s.running = true;
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  }
  function resize() {
    if (!s.canvas) return;
    var rect = s.canvas.getBoundingClientRect();
    s.w = Math.max(rect.width, 1);
    s.h = Math.max(rect.height, 1);
    s.dpr = Math.min(window.devicePixelRatio || 1, 2);
    s.canvas.width = Math.floor(s.w * s.dpr);
    s.canvas.height = Math.floor(s.h * s.dpr);
    draw();
  }
  function canvasPoint(evt) {
    var rect = s.canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }
  function onPointerDown(evt) {
    if (!s.canvas) return;
    s.canvas.setPointerCapture(evt.pointerId);
    s.pointers[evt.pointerId] = { x: evt.clientX, y: evt.clientY };
    var ids = Object.keys(s.pointers);
    if (ids.length === 2) {
      var p0 = s.pointers[ids[0]];
      var p1 = s.pointers[ids[1]];
      var dx = p1.x - p0.x;
      var dy = p1.y - p0.y;
      s.pinch = {
        dist: Math.sqrt(dx * dx + dy * dy) || 1,
        scale: s.scale,
        midX: (p0.x + p1.x) / 2,
        midY: (p0.y + p1.y) / 2
      };
      s.dragNode = null;
      s.pan = null;
      return;
    }
    var pt = canvasPoint(evt);
    var world = screenToWorld(pt.x, pt.y);
    var hit = hitTest(world.x, world.y);
    if (hit) {
      s.dragNode = hit;
      hit.dragFixed = true;
      s.hoverId = hit.id;
    } else {
      s.pan = { x: pt.x, y: pt.y, camX: s.camX, camY: s.camY };
    }
    wake();
  }
  function onPointerMove(evt) {
    if (!s.canvas) return;
    if (s.pointers[evt.pointerId]) {
      s.pointers[evt.pointerId] = { x: evt.clientX, y: evt.clientY };
    }
    var ids = Object.keys(s.pointers);
    if (s.pinch && ids.length >= 2) {
      var p0 = s.pointers[ids[0]];
      var p1 = s.pointers[ids[1]];
      var dx = p1.x - p0.x;
      var dy = p1.y - p0.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      s.scale = clamp(s.pinch.scale * (dist / s.pinch.dist), 0.25, 4);
      wake();
      return;
    }
    var pt = canvasPoint(evt);
    if (s.dragNode) {
      var world = screenToWorld(pt.x, pt.y);
      s.dragNode.x = world.x;
      s.dragNode.y = world.y;
      s.dragNode.vx = 0;
      s.dragNode.vy = 0;
      wake();
      return;
    }
    if (s.pan) {
      s.camX = s.pan.camX + (pt.x - s.pan.x) / s.scale;
      s.camY = s.pan.camY + (pt.y - s.pan.y) / s.scale;
      wake();
      return;
    }
    // hover
    var w = screenToWorld(pt.x, pt.y);
    var hit = hitTest(w.x, w.y);
    var next = hit ? hit.id : null;
    if (next !== s.hoverId) {
      s.hoverId = next;
      draw();
    }
  }
  function onPointerUp(evt) {
    if (!s.canvas) return;
    try { s.canvas.releasePointerCapture(evt.pointerId); } catch (err) {}
    delete s.pointers[evt.pointerId];
    var ids = Object.keys(s.pointers);
    if (ids.length < 2) s.pinch = null;
    if (s.dragNode) {
      var node = s.dragNode;
      var wasClick = true;
      node.dragFixed = false;
      s.dragNode = null;
      if (wasClick && typeof s.onSelect === 'function') {
        s.selectedId = node.id;
        s.onSelect(node);
      }
      wake();
    }
    s.pan = null;
    if (!ids.length) draw();
  }
  function onWheel(evt) {
    evt.preventDefault();
    var pt = canvasPoint(evt);
    var before = screenToWorld(pt.x, pt.y);
    var factor = evt.deltaY > 0 ? 0.9 : 1.1;
    s.scale = clamp(s.scale * factor, 0.25, 4);
    var after = screenToWorld(pt.x, pt.y);
    s.camX += after.x - before.x;
    s.camY += after.y - before.y;
    wake();
  }
  function bind() {
    if (!s.canvas) return;
    s.canvas.addEventListener('pointerdown', onPointerDown);
    s.canvas.addEventListener('pointermove', onPointerMove);
    s.canvas.addEventListener('pointerup', onPointerUp);
    s.canvas.addEventListener('pointercancel', onPointerUp);
    s.canvas.addEventListener('pointerleave', function() {
      if (!s.dragNode && !s.pan) {
        s.hoverId = null;
        draw();
      }
    });
    s.canvas.addEventListener('wheel', onWheel, { passive: false });
  }
  function unbind() {
    if (!s.canvas) return;
    s.canvas.removeEventListener('pointerdown', onPointerDown);
    s.canvas.removeEventListener('pointermove', onPointerMove);
    s.canvas.removeEventListener('pointerup', onPointerUp);
    s.canvas.removeEventListener('pointercancel', onPointerUp);
    s.canvas.removeEventListener('wheel', onWheel);
  }

  return {
    mount: function(canvas, opts) {
      opts = opts || {};
      if (s.canvas && s.canvas !== canvas) this.destroy();
      s.canvas = canvas;
      s.ctx = canvas.getContext('2d');
      s.onSelect = opts.onSelect || null;
      s.theme = opts.theme || 'dark';
      bind();
      if (typeof ResizeObserver !== 'undefined') {
        s.ro = new ResizeObserver(function() { resize(); });
        s.ro.observe(canvas.parentElement || canvas);
      }
      resize();
      wake();
    },
    destroy: function() {
      unbind();
      if (s.ro) { try { s.ro.disconnect(); } catch (err) {} s.ro = null; }
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.canvas = null;
      s.ctx = null;
      s.nodes = [];
      s.edges = [];
      s.nodeById = {};
      s.running = false;
    },
    setData: function(nodes, edges) {
      s.nodes = (nodes || []).map(function(n) {
        return {
          id: n.id,
          label: n.label || '',
          type: n.type || 'note',
          importance: n.importance,
          pinned: Boolean(n.pinned),
          version_status: n.version_status || null,
          created_at: n.created_at || '',
          x: 0, y: 0, vx: 0, vy: 0, r: 3, dragFixed: false
        };
      });
      s.nodeById = {};
      for (var i = 0; i < s.nodes.length; i++) s.nodeById[s.nodes[i].id] = s.nodes[i];
      s.edges = (edges || []).filter(function(e) {
        return s.nodeById[e.src] && s.nodeById[e.dst];
      }).map(function(e) {
        return { src: e.src, dst: e.dst, rel_type: e.rel_type, weight: e.weight };
      });
      rebuildAdj();
      initPositions();
      s.selectedId = null;
      s.hoverId = null;
      wake();
    },
    setTheme: function(theme) {
      s.theme = theme === 'light' ? 'light' : 'dark';
      draw();
    },
    setHiddenRel: function(hiddenMap) {
      s.hiddenRel = hiddenMap || {};
      rebuildAdj();
      wake();
    },
    focusNode: function(id) {
      var node = s.nodeById[id];
      if (!node) return null;
      s.selectedId = id;
      s.pulseId = id;
      s.pulseT = 0;
      s.camX = -node.x;
      s.camY = -node.y;
      s.scale = Math.max(s.scale, 1.2);
      wake();
      return node;
    },
    search: function(query) {
      var q = String(query || '').trim().toLowerCase();
      if (!q) return null;
      for (var i = 0; i < s.nodes.length; i++) {
        var node = s.nodes[i];
        if ((node.label || '').toLowerCase().indexOf(q) !== -1) {
          return this.focusNode(node.id);
        }
      }
      return null;
    },
    clearSelect: function() {
      s.selectedId = null;
      draw();
    },
    resize: resize,
    wake: wake,
    redraw: draw
  };
})();

function memoryAdmin() {
  return {
    nav: [
      { id: 'today', label: '今日', icon: 'sun' },
      { id: 'diary', label: '日记', icon: 'book-open' },
      { id: 'dream', label: '梦境', icon: 'moon-star' },
      { id: 'review', label: '审核队列', icon: 'inbox' },
      { id: 'memory', label: '重要记忆', icon: 'database' },
      { id: 'starmap', label: '星图', icon: 'sparkles' },
      { id: 'more', label: '更多', icon: 'layers' }
    ],
    moreNav: [
      { id: 'precious', label: '珍贵' },
      { id: 'glossary', label: '黑话' },
      { id: 'world', label: '世界知识' },
      { id: 'maintenance', label: '维护' }
    ],
    canonicalMemoryTypes: ['fact', 'event', 'preference', 'relationship', 'boundary', 'habit', 'decision', 'note'],
    limits: { fact: 120, event: 80, preference: 80, relationship: 80, boundary: 80, habit: 80, decision: 80, note: 120 },
    page: 'today',
    moreView: 'precious',
    workerUrl: localStorage.getItem('aelios.admin.workerUrl') || location.origin,
    apiKey: localStorage.getItem('aelios.admin.apiKey') || '',
    savedApiKey: localStorage.getItem('aelios.admin.apiKey') || '',
    namespace: localStorage.getItem('aelios.admin.namespace') || 'default',
    theme: localStorage.getItem('aelios.admin.colorMode') || 'light',
    boot: {},
    stats: {},

    todayMessages: [],
    candidates: [],
    memories: [],
    precious: [],
    glossary: [],

    diaryDailies: [],
    diaryWeeklies: [],
    diaryExpanded: {},

    worldItems: [],
    worldSelection: {},
    worldQuery: '',
    memoryType: 'all',
    memoryCreateOpen: false,
    memoryDraft: { type: 'fact', content: '', fact_key: '', importance: 0.7, confidence: 0.85 },
    glossaryDraft: { term: '', definition: '', aliasesText: '' },
    debugOutput: '尚未运行维护操作',
    toast: '',
    saving: false,

    starmapLoading: false,
    starmapNodes: [],
    starmapEdges: [],
    starmapMeta: { total_nodes: 0, total_edges: 0, truncated: false },
    starmapSelected: null,
    starmapNeighbors: [],
    starmapSearch: '',
    starmapLegend: {
      supports: true,
      contradicts: true,
      cause_effect: true,
      derived_from: true,
      same_thread: true,
      supersedes: true
    },
    starmapLegendItems: [
      { id: 'supports', label: 'supports', color: 'rgb(220,225,235)' },
      { id: 'contradicts', label: 'contradicts', color: 'rgb(239,68,68)' },
      { id: 'cause_effect', label: 'cause_effect', color: 'rgb(245,158,11)' },
      { id: 'derived_from', label: 'derived_from', color: 'rgb(167,139,250)' },
      { id: 'same_thread', label: 'same_thread', color: 'rgb(125,180,220)' },
      { id: 'supersedes', label: 'supersedes', color: 'rgb(140,140,150)' }
    ],

    dreamStatus: null,
    dreamRuns: [],
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
    harvestOpen: { new: true, dim: true, judged: true },

    init() {
      this.applyTheme();
      this.icons();
      this.reloadAll();
    },
    icons() {
      this.$nextTick(function() {
        if (window.lucide) window.lucide.createIcons();
      });
    },
    subtitle() {
      const found = this.nav.find(function(item) { return item.id === this.page; }, this);
      return found ? found.label : '设置';
    },
    savePrefs() {
      localStorage.setItem('aelios.admin.workerUrl', this.workerUrl || location.origin);
      localStorage.setItem('aelios.admin.namespace', this.namespace || 'default');
      localStorage.setItem('aelios.admin.colorMode', this.theme || 'light');
    },
    tokenSaved() {
      return (this.apiKey || '') === (this.savedApiKey || '');
    },
    saveToken() {
      this.savePrefs();
      localStorage.setItem('aelios.admin.apiKey', this.apiKey || '');
      this.savedApiKey = this.apiKey || '';
      this.notify(this.apiKey && this.apiKey.trim() ? 'Token 已保存' : 'Token 已清空');
    },
    clearToken() {
      this.apiKey = '';
      this.saveToken();
    },
    applyTheme() {
      document.documentElement.dataset.theme = this.theme || 'light';
      this.icons();
    },
    toggleTheme() {
      this.theme = this.theme === 'light' ? 'dark' : 'light';
      this.savePrefs();
      this.applyTheme();
      if (this.page === 'starmap' && window.starmapEngine) {
        window.starmapEngine.setTheme(this.theme);
      }
    },
    base() {
      return (this.workerUrl || location.origin).replace(/\/+$/, '');
    },
    withNamespace(path) {
      const sep = path.indexOf('?') === -1 ? '?' : '&';
      return path + sep + 'namespace=' + encodeURIComponent(this.namespace || 'default');
    },
    async request(path, options) {
      if (!this.apiKey.trim()) throw new Error('请先填写 token');
      const opts = options || {};
      const headers = Object.assign({
        Authorization: 'Bearer ' + this.apiKey
      }, opts.body ? { 'content-type': 'application/json' } : {}, opts.headers || {});
      const response = await fetch(this.base() + path, Object.assign({}, opts, { headers: headers }));
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (error) { payload = { raw: text }; }
      if (!response.ok) {
        const message = payload && payload.error && payload.error.message ? payload.error.message : response.status + ' ' + response.statusText;
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
    async reloadAll() {
      this.savePrefs();
      var tasks = [this.loadBoot(), this.loadCandidates(), this.loadMemories()];
      if (this.page === 'starmap') tasks.push(this.loadStarmap());
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
      try {
        const range = this.todayRange();
        const data = await this.request(this.withNamespace('/v1/memory_boot?start=' + encodeURIComponent(range.start) + '&end=' + encodeURIComponent(range.end)));
        this.boot = data.data || {};
        this.stats = this.boot.stats || {};

        this.todayMessages = this.boot.today_messages || [];
        this.precious = this.boot.precious || [];
        this.glossary = this.boot.glossary || [];
        if (this.moreView === 'world') {
          this.worldItems = [];
          this.pruneWorldSelection();
        }
      } catch (error) {
        this.notify(error.message);
      }
    },
    async loadCandidates() {
      try {
        const data = await this.request(this.withNamespace('/v1/candidates?status=pending&limit=100'));
        this.candidates = (data.data || []).map(function(item) {
          item.editing = false;
          item.mergeOpen = false;
          item.target_id = '';
          item.draft = { content: item.content, type: item.type, fact_key: item.fact_key || '' };
          return item;
        });
      } catch (error) {
        this.notify(error.message);
      }
    },
    async loadMemories() {
      try {
        const typeParam = this.memoryType && this.memoryType !== 'all' ? '&type=' + encodeURIComponent(this.memoryType) : '';
        const path = '/v1/memory?status=active&limit=100' + typeParam;
        const data = await this.request(this.withNamespace(path));
        this.memories = (data.data || []).map(function(item) {
          item.editing = false;
          item.mergeOpen = false;
          item.target_id = '';
          item.draft = { content: item.content };
          return item;
        });
      } catch (error) {
        this.notify(error.message);
      }
    },
    loadMoreView() {
      if (this.moreView === 'world') {
        this.loadWorldFacts();
      } else {
        this.icons();
      }
    },
    async loadWorldFacts() {
      try {
        const data = await this.request(this.withNamespace('/v1/memory?status=active&limit=80&type=world_fact'));
        this.worldItems = data.data || [];
        this.pruneWorldSelection();
      } catch (error) {
        this.worldItems = [];
        this.pruneWorldSelection();
        this.notify(error.message);
      }
      this.icons();
    },

    async pinMessage(message) {
      try {
        await this.request(this.withNamespace('/v1/precious'), {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, content: message.content, context_message_ids: [message.id], source: 'human' })
        });
        await this.loadBoot();
        this.notify('已加入珍贵');
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
        await Promise.all([this.loadCandidates(), this.loadMemories(), this.loadBoot()]);
        this.notify('已通过');
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
        await Promise.all([this.loadCandidates(), this.loadBoot()]);
        this.notify('已丢弃');
      } catch (error) {
        this.notify(error.message);
      }
    },
    async mergeCandidate(candidate) {
      if (!candidate.target_id) {
        this.notify('需要目标 memory id');
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
        this.notify('已合并');
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
      if (!content) { this.notify('内容不能为空'); return; }
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
        this.notify('已新增记忆');
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
        this.notify('记忆已保存');
      } catch (error) {
        this.notify(error.message);
      }
    },
    async deleteMemory(memory) {
      if (!window.confirm('确认删除这条记忆？')) return;
      try {
        await this.request(this.withNamespace('/v1/memory/' + encodeURIComponent(memory.id)), { method: 'DELETE' });
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        if (this.page === 'more' && this.moreView === 'world') await this.loadWorldFacts();
        this.notify('已删除');
      } catch (error) {
        this.notify(error.message);
      }
    },
    async deleteWorldMemory(item) {
      if (!window.confirm('确认删除这条兜底大库条目？')) return;
      try {
        await this.deleteWorldItem(item);
        delete this.worldSelection[this.worldItemKey(item)];
        this.worldSelection = Object.assign({}, this.worldSelection);
        await Promise.all([this.loadMemories(), this.loadBoot()]);
        if (this.moreView === 'world') await this.loadWorldFacts();
        this.notify('兜底条目已删除');
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
      if (!window.confirm('确认删除选中的 ' + items.length + ' 条兜底大库条目？')) return;
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
        this.notify(failed ? ('部分删除失败：' + failed + ' 条') : ('已删除 ' + items.length + ' 条'));
      } catch (error) {
        this.notify(error.message);
      }
      this.saving = false;
    },
    async mergeDuplicate(memory) {
      if (!memory.target_id) {
        this.notify('需要目标 memory id');
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
        this.notify('重复项已合并');
      } catch (error) {
        this.notify(error.message);
      }
    },
    async unpinPrecious(item) {
      try {
        await this.request(this.withNamespace('/v1/precious/' + encodeURIComponent(item.id)), { method: 'DELETE' });
        await this.loadBoot();
        this.notify('已取消珍贵');
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
        this.notify('黑话已保存');
      } catch (error) {
        this.notify(error.message);
      }
    },
    async deleteGlossary(item) {
      try {
        await this.request(this.withNamespace('/v1/glossary/' + encodeURIComponent(item.id)), { method: 'DELETE' });
        await this.loadBoot();
        this.notify('黑话已删除');
      } catch (error) {
        this.notify(error.message);
      }
    },
    async searchWorld() {
      if (!this.worldQuery.trim()) {
        await this.loadWorldFacts();
        return;
      }
      try {
        const data = await this.request(this.withNamespace('/v1/memory/search'), {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, query: this.worldQuery, top_k: 30, filter: false })
        });
        this.worldItems = data.data || [];
        this.pruneWorldSelection();
      } catch (error) {
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
    async runDream() {
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
      this.page = id;
      if (id === 'review') this.loadCandidates();
      if (id === 'memory') this.loadMemories();
      if (id === 'diary') this.loadDiary();
      if (id === 'starmap') this.loadStarmap();
      if (id === 'more') this.loadMoreView();
      if (id === 'dream') {
        this.loadDreamStatus();
        this.loadDreamHarvest();
      }
      this.icons();
    },
    async loadDiary() {
      try {
        const data = await this.request(this.withNamespace('/admin/diary?limit=30'));
        const payload = data.data || {};
        this.diaryDailies = payload.dailies || [];
        this.diaryWeeklies = payload.weeklies || [];
      } catch (error) {
        this.notify(error.message);
      }
      this.icons();
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
    async loadDreamStatus() {
      this.dreamLoading = true;
      try {
        const data = await this.request(this.withNamespace('/v1/dream/status'));
        const payload = data.data || {};
        this.dreamStatus = payload;
        this.dreamRuns = payload.dream_runs || [];
        if (!this.dreamDate) this.dreamDate = this.dreamAnchorDate();
        if (!this.dreamHarvestDate) this.dreamHarvestDate = this.dreamAnchorDate();
      } catch (error) {
        this.notify(error.message);
      }
      this.dreamLoading = false;
      this.icons();
    },
    async loadDreamHarvest() {
      if (!this.dreamHarvestDate) this.dreamHarvestDate = this.dreamAnchorDate();
      this.dreamHarvestLoading = true;
      try {
        const data = await this.request(this.withNamespace('/admin/dream/harvest?date=' + encodeURIComponent(this.dreamHarvestDate)));
        this.dreamHarvest = data.data || null;
      } catch (error) {
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
    async triggerDream() {
      if (this.dreamTriggering) return;
      const date = this.dreamDate || this.dreamAnchorDate();
      if (this.dreamForce && !this.dreamDryRun) {
        if (!window.confirm('force + 真跑会重做 ' + date + ' 这一夜的梦境，已经梦过的也会重跑。确认继续？')) return;
      }
      this.dreamTriggering = true;
      this.dreamRunResult = null;
      try {
        const data = await this.request('/v1/dream/run', {
          method: 'POST',
          body: JSON.stringify({ namespace: this.namespace, date: date, force: this.dreamForce, dry_run: this.dreamDryRun })
        });
        this.dreamRunResult = data.data || null;
        if (!this.dreamDryRun) {
          this.dreamHarvestDate = date;
          await Promise.all([this.loadDreamStatus(), this.loadDreamHarvest()]);
          this.notify('这一夜梦完了');
        }
      } catch (error) {
        this.notify(error.message);
      }
      this.dreamTriggering = false;
      this.icons();
    },
    dreamLatestRun() {
      return this.dreamRuns.length ? this.dreamRuns[0] : null;
    },
    dreamLatestLabel() {
      const run = this.dreamLatestRun();
      return run ? this.dreamStatusLabel(run.status) : '还没有记录';
    },
    dreamLatestSub() {
      const run = this.dreamLatestRun();
      return run ? run.date_label + ' · ' + this.fmt(run.started_at) : '';
    },
    dreamSuccessRate() {
      let ok = 0;
      let err = 0;
      this.dreamRuns.forEach(function(run) {
        if (run.status === 'ok') ok += 1;
        else if (run.status === 'error') err += 1;
      });
      const total = ok + err;
      if (!total) return '—';
      return Math.round((ok / total) * 100) + '%';
    },
    dreamProcessedTotal() {
      return this.dreamRuns.reduce(function(sum, run) { return sum + (Number(run.processed_messages) || 0); }, 0);
    },
    dreamAnchorLabel() {
      const payload = this.dreamStatus || {};
      if (!payload.anchor_date_label) return '';
      return '锚点 ' + payload.anchor_date_label + (payload.time_zone ? ' · ' + payload.time_zone : '');
    },
    dreamDayBars() {
      const payload = this.dreamStatus || {};
      const counts = payload.raw_message_counts || [];
      const cursors = {};
      (payload.cursors || []).forEach(function(item) { cursors[item.date_label] = item.cursor; });
      const max = counts.reduce(function(m, item) { return Math.max(m, Number(item.raw_messages) || 0); }, 0);
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
          stateLabel: done ? '已梦完' : (cursor ? '梦到一半' : '未开始')
        };
      });
    },
    dreamStatusLabel(status) {
      return { ok: '完成', error: '出错', skipped: '跳过', running: '进行中' }[status] || status || '未知';
    },
    dreamStatusChipClass(status) {
      return { ok: 'chip-ok', error: 'chip-err', skipped: 'chip-dim', running: 'chip-warn' }[status] || 'chip-dim';
    },
    dreamRailClass(status) {
      return { ok: 'dot-ok', error: 'dot-err', skipped: 'dot-dim', running: 'dot-run' }[status] || 'dot-dim';
    },
    dreamTriggerLabel(trigger) {
      return { cron: '定时', manual: '手动' }[trigger] || trigger || '—';
    },
    dreamDuration(run) {
      if (!run.finished_at) return run.status === 'running' ? '进行中' : '—';
      const ms = new Date(run.finished_at).getTime() - new Date(run.started_at).getTime();
      if (!Number.isFinite(ms) || ms < 0) return '—';
      const sec = Math.round(ms / 1000);
      if (sec < 60) return sec + 's';
      return Math.floor(sec / 60) + 'm' + String(sec % 60).padStart(2, '0') + 's';
    },
    dreamReasonLabel(reason) {
      const map = {
        already_done: '这一夜已经梦过',
        no_messages: '没有新消息',
        dry_run: '只是预演',
        dream_disabled: '梦境未启用',
        model_error: '模型出错',
        model_invalid_json: '模型返回无法解析',
        extract_model_error: '抽取模型出错',
        v2_disabled: 'v2 未启用'
      };
      return map[reason] || reason || '原因未知';
    },
    dreamRunNote(run) {
      const parts = [];
      if (run.reason) parts.push(this.dreamReasonLabel(run.reason));
      if (run.error) {
        let text = run.error;
        try {
          const parsed = JSON.parse(run.error);
          if (Array.isArray(parsed)) {
            text = parsed.length + ' 条落库出错：' + parsed.map(function(item) {
              return (item.target_id || '?') + '（' + (item.reason || '?') + '）';
            }).join('；');
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
      items.forEach(function(item) {
        const dest = item.destination || 'candidate';
        if (!groups[dest]) {
          groups[dest] = { key: dest, label: dest === 'world_fact_direct' ? '直达世界事实' : '候选队列', items: [] };
          order.push(dest);
        }
        groups[dest].items.push(item);
      });
      return order.map(function(key) { return groups[key]; });
    },
    dreamRoutingKindLabel(kind) {
      return { extract: '抽取', add: '新增', update: '更新', delete: '归档' }[kind] || kind || '—';
    },
    dreamRunStatsLine() {
      const stats = this.dreamRunResult && this.dreamRunResult.result && this.dreamRunResult.result.stats;
      if (!stats) return '';
      return '处理消息 ' + (stats.processedMessages || 0)
        + ' · 新增 ' + (stats.addedMemories || 0)
        + ' · 更新 ' + (stats.updatedMemories || 0)
        + ' · 归档 ' + (stats.deletedMemories || 0)
        + ' · 入候选 ' + (stats.queuedCandidates || 0);
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
      return status === 'superseded' ? '被接替' : (status === 'archived' ? '归档' : status || '—');
    },
    dreamCandidateStatusLabel(status) {
      return status === 'approved' ? '采纳' : (status === 'discarded' ? '未采' : status || '—');
    },
    dreamCandidateSourceLabel(source) {
      return { dream_add: '新增提案', dream_update: '更新提案', dream_delete: '归档提案', extract: '抽取', zone_full: '区满' }[source] || source || '—';
    },
    starmapCountLabel() {
      var nodes = this.starmapNodes.length;
      var edges = this.starmapEdges.length;
      var meta = this.starmapMeta || {};
      var extra = meta.truncated ? ' · 已截断' : '';
      return nodes + ' 星 · ' + edges + ' 边' + extra;
    },
    starmapHiddenMap() {
      var hidden = {};
      var legend = this.starmapLegend || {};
      var keys = Object.keys(legend);
      for (var i = 0; i < keys.length; i++) {
        if (!legend[keys[i]]) hidden[keys[i]] = true;
      }
      return hidden;
    },
    applyStarmapSelect(node) {
      if (!node) {
        this.starmapSelected = null;
        this.starmapNeighbors = [];
        return;
      }
      var full = null;
      for (var i = 0; i < this.starmapNodes.length; i++) {
        if (this.starmapNodes[i].id === node.id) { full = this.starmapNodes[i]; break; }
      }
      this.starmapSelected = full || {
        id: node.id,
        label: node.label,
        type: node.type,
        importance: node.importance,
        pinned: node.pinned,
        version_status: node.version_status,
        created_at: node.created_at
      };
      var byId = {};
      for (var n = 0; n < this.starmapNodes.length; n++) byId[this.starmapNodes[n].id] = this.starmapNodes[n];
      var neighbors = [];
      for (var e = 0; e < this.starmapEdges.length; e++) {
        var edge = this.starmapEdges[e];
        if (this.starmapLegend && this.starmapLegend[edge.rel_type] === false) continue;
        var otherId = null;
        if (edge.src === node.id) otherId = edge.dst;
        else if (edge.dst === node.id) otherId = edge.src;
        if (!otherId) continue;
        var other = byId[otherId];
        neighbors.push({
          key: edge.src + '>' + edge.dst + ':' + edge.rel_type,
          rel_type: edge.rel_type,
          otherId: otherId,
          otherLabel: other ? other.label : otherId
        });
      }
      this.starmapNeighbors = neighbors;
      this.icons();
    },
    clearStarmapSelect() {
      this.starmapSelected = null;
      this.starmapNeighbors = [];
      if (window.starmapEngine) window.starmapEngine.clearSelect();
    },
    focusStarmapNeighbor(id) {
      if (!window.starmapEngine) return;
      var node = window.starmapEngine.focusNode(id);
      if (node) this.applyStarmapSelect(node);
    },
    toggleStarmapLegend(relType) {
      var next = Object.assign({}, this.starmapLegend);
      next[relType] = !next[relType];
      this.starmapLegend = next;
      if (window.starmapEngine) window.starmapEngine.setHiddenRel(this.starmapHiddenMap());
      if (this.starmapSelected) this.applyStarmapSelect(this.starmapSelected);
    },
    searchStarmap() {
      if (!window.starmapEngine) return;
      var node = window.starmapEngine.search(this.starmapSearch);
      if (node) this.applyStarmapSelect(node);
      else if ((this.starmapSearch || '').trim()) this.notify('没有匹配的星星');
    },
    mountStarmapCanvas() {
      var canvas = this.$refs.starmapCanvas;
      if (!canvas || !window.starmapEngine) return;
      var self = this;
      window.starmapEngine.mount(canvas, {
        theme: this.theme,
        onSelect: function(node) { self.applyStarmapSelect(node); }
      });
      window.starmapEngine.setHiddenRel(this.starmapHiddenMap());
      window.starmapEngine.setData(this.starmapNodes, this.starmapEdges);
      window.starmapEngine.setTheme(this.theme);
      window.starmapEngine.resize();
    },
    async loadStarmap() {
      this.starmapLoading = true;
      this.clearStarmapSelect();
      try {
        var data = await this.request(this.withNamespace('/api/relations/graph?limit=400'));
        this.starmapNodes = data.nodes || [];
        this.starmapEdges = data.edges || [];
        this.starmapMeta = data.meta || { total_nodes: 0, total_edges: 0, truncated: false };
        var self = this;
        await this.$nextTick();
        // second tick: section x-show layout settles before measuring canvas
        await this.$nextTick();
        self.mountStarmapCanvas();
      } catch (error) {
        this.starmapNodes = [];
        this.starmapEdges = [];
        this.starmapMeta = { total_nodes: 0, total_edges: 0, truncated: false };
        this.notify(error.message);
      }
      this.starmapLoading = false;
      this.icons();
    },
    pct(value) {
      return Math.round(Number(value || 0) * 100) + '%';
    },
    fmt(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
      return type === 'all' ? '全部' : type;
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
    capacityLabel() {
      const rows = this.stats.memory_type_counts || [];
      const total = rows.reduce(function(sum, row) { return sum + Number(row.count || 0); }, 0);
      const cap = Object.keys(this.limits).reduce(function(sum, key) { return sum + this.limits[key]; }.bind(this), 0);
      return total + '/' + cap;
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
