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
<!-- 移动端外壳是 h-dvh 弹性列：内容区内部滚动、tab 栏走正常文档流钉底，
     不再用 fixed bottom-0 对齐布局视口（地址栏未收起时会把栏顶出屏幕，#34）。
     md 起还原为整页 body 滚动，桌面行为不变。 -->
<div x-data="memoryAdmin()" x-init="init()" x-cloak class="app-shell flex h-dvh flex-col md:block md:h-auto md:min-h-dvh">
  <div class="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 overflow-y-auto md:min-h-dvh md:flex-none md:overflow-visible md:px-4 md:py-4">
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
        <p class="mt-3 text-xs text-zinc-400">当前空间：<span x-text="namespace"></span></p>
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

      <section class="mb-5 rounded-2xl border border-zinc-800 bg-zinc-900 p-4" aria-label="选择助手的记忆">
        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-xs text-zinc-400">查看谁的记忆
            <select x-model="selectedIdentity" @change="selectIdentity($event.target.value)" class="mt-2 h-11 w-full rounded-xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100">
              <option value="">自选空间（高级）</option>
              <template x-for="idn in memoryIdentities" :key="idn.slug"><option :value="idn.slug" x-text="idn.slug"></option></template>
            </select>
          </label>
          <label class="text-xs text-zinc-400" x-show="selectedIdentity">查看哪个空间
            <select x-model="namespace" @change="switchSpace($event.target.value)" class="mt-2 h-11 w-full rounded-xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100">
              <template x-for="space in identitySpaces()" :key="space.name"><option :value="space.name" x-text="space.label"></option></template>
            </select>
          </label>
        </div>
        <p class="mt-2 text-xs leading-6 text-zinc-400" x-text="spaceDescription()"></p>
        <p class="text-xs leading-6 text-zinc-500">这里切换查看的记忆；客户端使用哪位助手由接入地址和钥匙决定。</p>
        <div x-show="selectedIdentity" class="mt-3 rounded-xl border border-zinc-800 bg-[#0a0a0b] p-3">
          <p class="text-xs text-zinc-400">说话人名字</p>
          <p class="mt-1 text-[11px] leading-5 text-zinc-500">Dream、日记、周月卷、审核写记忆时只用这两个名字，不许写用户/助手。</p>
          <div class="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label class="text-xs text-zinc-400">用户叫什么
              <input x-model="speakerUserName" class="mt-1 h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="如 小南">
            </label>
            <label class="text-xs text-zinc-400">助手叫什么
              <input x-model="speakerAssistantName" class="mt-1 h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="如 小北；留空用路径名">
            </label>
            <button type="button" @click="saveSpeakers()" :disabled="speakerBusy" class="tap h-11 rounded-2xl bg-coral px-4 text-sm font-semibold text-zinc-950 transition duration-150 ease-in-out active:bg-coral/80 disabled:opacity-60">保存名字</button>
          </div>
        </div>
        <p x-show="identityLoadError" x-text="identityLoadError" class="mt-2 text-xs text-coral"></p>
        <details class="mt-2" :open="!selectedIdentity">
          <summary class="cursor-pointer text-xs text-zinc-500">高级：手动指定空间</summary>
          <label class="mt-2 block text-xs text-zinc-400">空间名
            <input :value="namespace" @change="selectCustomSpace($event.target.value)" class="mt-2 h-11 w-full rounded-xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100" placeholder="default">
          </label>
        </details>
      </section>

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
            <div class="grid gap-3 md:grid-cols-[1fr_auto_auto_auto_auto_auto]">
              <div class="self-center text-sm text-zinc-400">当前空间：<span x-text="namespace"></span></div>
              <button type="button" @click="runHealth()" class="tap rounded-2xl border border-zinc-800 px-4 text-sm hover:border-coral">vector_health</button>
              <button type="button" @click="runReindex(true)" class="tap rounded-2xl border border-zinc-800 px-4 text-sm hover:border-coral">reindex dry</button>
              <button type="button" @click="runBackfill(true)" class="tap rounded-2xl border border-zinc-800 px-4 text-sm hover:border-coral">查缺向量</button>
              <button type="button" @click="runBackfill(false)" class="tap rounded-2xl border border-zinc-800 px-4 text-sm hover:border-coral">补缺向量</button>
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
            <p class="mt-1 text-sm text-zinc-400">每日叙事日记与已卷起的周记。日记是印象，具体事实请回溯正本。</p>
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
              <p class="mt-1 text-xs text-zinc-500" x-show="entry.source_message_ids && entry.source_message_ids.length" x-text="(entry.source_message_ids || []).length + ' 条原文可溯源'"></p>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-7 text-zinc-300" :class="isDiaryExpanded('daily:' + entry.date) ? '' : 'line-clamp-4'" x-text="entry.summary"></p>
              <button type="button" @click="toggleDiaryExpand('daily:' + entry.date)" class="tap mt-2 text-xs text-coral transition duration-150 ease-in-out hover:underline" x-text="isDiaryExpanded('daily:' + entry.date) ? '收起' : '展开全文'"></button>
            </article>
          </template>
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

      <section x-show="page === 'settings'" class="space-y-4">
        <h1 class="text-2xl font-semibold">设置</h1>
        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold">为什么想起这件事</h2>
            <button type="button" @click="loadRecallHistory()" :disabled="recallHistoryLoading || !selectedIdentity" class="tap rounded-2xl border border-zinc-800 px-3 text-xs disabled:opacity-40">刷新记录</button>
          </div>
          <p class="mt-2 text-xs text-zinc-400">查看顶部所选助手最近 20 次召回，记录按助手区分，不随单个召回空间合并。</p>
          <p x-show="!selectedIdentity" class="mt-2 text-xs text-zinc-400">请先在顶部选择一位助手。</p>
          <div aria-live="polite">
            <p x-show="recallHistoryLoading" class="mt-2 text-xs text-zinc-400">读取中…</p>
            <p x-show="recallHistoryError" class="mt-2 text-xs text-coral" x-text="recallHistoryError"></p>
            <p x-show="selectedIdentity && !recallHistoryLoading && !recallHistoryError && !recallHistory.length" class="mt-2 text-xs text-zinc-500">还没有召回记录。</p>
          </div>
          <template x-for="record in recallHistory" :key="record.id">
            <details class="mt-3 rounded-xl border border-zinc-800 p-3">
              <summary class="cursor-pointer text-sm" x-text="record.query || '本轮召回'"></summary>
              <p class="mt-2 text-xs text-zinc-400" x-text="fmt(record.created_at) + ' · ' + recallStatusLabel(record.selection && record.selection.status) + ' · 注入 ' + (record.injected || 0) + ' 条'"></p>
              <p class="mt-1 text-xs text-zinc-400" x-text="recallReasonLabel(record.selection && record.selection.reason)"></p>
              <p class="mt-1 text-xs text-zinc-400" x-show="record.selection && record.selection.threshold != null" x-text="record.selection ? '分数下限 ' + record.selection.threshold + (record.selection.elapsed_ms != null ? ' · 重排与筛选 ' + record.selection.elapsed_ms + ' ms' : '') + ' · 分数不是正确率' : ''"></p>
              <template x-for="(decision, i) in (record.decisions || [])" :key="i">
                <div class="mt-2 border-t border-zinc-800 pt-2">
                  <p class="text-xs" :class="decision.injected ? 'text-coral' : 'text-zinc-400'" x-text="(decision.injected ? '已选 · ' : '未选 · ') + recallReasonLabel(decision.reason)"></p>
                  <p class="mt-1 text-xs text-zinc-400" x-show="decision.score != null" x-text="decision.score != null ? '相关分数 ' + Number(decision.score).toFixed(3) : ''"></p>
                  <p class="mt-1 whitespace-pre-wrap text-sm" x-text="decision.excerpt || ''"></p>
                  <p class="mt-1 break-all text-[11px] text-zinc-500" x-text="(decision.namespace || '') + ' / ' + (decision.id || decision.kind || '')"></p>
                </div>
              </template>
            </details>
          </template>
        </article>
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
          <p class="mt-4 text-xs text-zinc-400">查看空间请使用页面顶部的助手选择器。</p>
        </article>
        <article class="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-sm">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-sm font-semibold text-zinc-100">记忆网关</h2>
            <div class="flex gap-2">
              <button type="button" @click="gwLoad()" class="tap rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 py-1.5 text-xs text-zinc-100 transition duration-150 ease-in-out hover:border-coral">读取</button>
              <button type="button" @click="gwSave()" class="tap rounded-2xl bg-coral px-3 py-1.5 text-xs font-semibold text-zinc-950 transition duration-150 ease-in-out active:bg-coral/80">保存</button>
            </div>
          </div>
          <label class="mt-3 block text-xs text-zinc-400">上游地址</label>
          <input x-model="gwAddress" class="mt-2 h-11 w-full rounded-2xl border border-zinc-800 bg-[#0a0a0b] px-3 text-sm text-zinc-100 outline-none transition duration-150 ease-in-out focus:border-coral" placeholder="CF 账号 ID(32 位),或完整地址,如 new-api 的 https://…/v1">
          <p class="mt-1 text-[11px] leading-5 text-zinc-500">chat 走 compat,全 provider;messages / responses 走各 provider 原生端点,模型名带 provider/ 前缀;模型列表走 compat 目录。BYOK 钥匙在 AI Gateway 仪表盘;CF 令牌去 Worker Secrets 加 CLOUDFLARE_API_TOKEN。Gateway ID 在下方环境设置里,默认 default。</p>
          <div class="mt-4 flex items-center justify-between">
            <label class="text-xs text-zinc-400">助手</label>
            <button type="button" @click="gwAdd()" class="tap rounded-2xl border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition duration-150 ease-in-out hover:border-coral hover:text-zinc-100">+ 添加助手</button>
          </div>
          <p class="mt-1 text-[11px] text-zinc-500">名字即地址路径段;主模型支持 * 通配,只有主模型有记忆、进 Dream。用户名和助手名给 Dream、日记、周月卷、审核写记忆用,只许写名字,不许写用户/助手。顶部选择助手后也能填。</p>
          <template x-for="(idn, i) in gwIdentities" :key="i">
            <div class="mt-2 space-y-2 rounded-2xl border border-zinc-800 bg-[#0a0a0b] p-3">
              <div class="flex items-center gap-2">
                <input x-model="idn.slug" class="h-10 min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="名字,如 coder">
                <button type="button" @click="gwIdentities.splice(i, 1)" class="tap shrink-0 rounded-xl border border-zinc-800 px-3 py-2 text-xs text-zinc-500 transition hover:border-coral hover:text-zinc-100">移除</button>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <input x-model="idn.userName" class="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="用户叫什么,如 小南">
                <input x-model="idn.assistantName" class="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="助手叫什么,如 小北">
              </div>
              <p class="text-[11px] text-zinc-500">Dream、日记、周月卷、审核写记忆只用这两个名字。助手名留空则用路径名。顶部选择助手后也能填。</p>
              <input x-model="idn.modelsText" class="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="主模型,逗号分隔,如 anthropic/claude-opus-5, *fable*">
              <input x-model="idn.namespace" class="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="写入空间,留空与名字同名">
              <input x-model="idn.readNamespacesText" class="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="召回空间,逗号分隔;留空只读写入空间;[] 不召回">
              <p class="text-[11px] text-zinc-500">最多 8 个召回空间，共用注入预算。共享时填同一空间；迁移时写新空间、召回保留旧空间。</p>
              <div class="flex flex-wrap gap-x-4 gap-y-2 pt-1">
                <template x-for="k in gwKeyOptions" :key="k.id">
                  <label class="flex items-center gap-1.5 text-xs text-zinc-400"><input type="checkbox" :value="k.id" x-model="idn.keys" class="h-4 w-4 accent-[#f4a07c]"><span x-text="k.label"></span></label>
                </template>
              </div>
              <details class="pt-1">
                <summary class="cursor-pointer text-xs text-zinc-500">高级</summary>
                <label class="mt-2 block text-xs text-zinc-400">Claude 思考块</label>
                <select x-model="idn.anthropicThinking" class="mt-1 h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral">
                  <option value="passthrough">原样透传(思考开着时跳过注入)</option>
                  <option value="drop_block">临时记忆 + 上游丢弃失配思考(需 beta)</option>
                </select>
                <label class="mt-2 block text-xs text-zinc-400">单次记忆字数上限</label>
                <input x-model="idn.maxMemoryChars" type="number" min="256" max="24000" class="mt-1 h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral" placeholder="留空默认 6000">
              </details>
            </div>
          </template>
          <div x-show="!gwIdentities.length" class="mt-2 text-xs text-zinc-500">还没有助手。点「读取」拉取线上配置,或直接添加。</div>
          <template x-if="gwGroups.length">
            <div class="mt-4">
              <label class="text-xs text-zinc-400">环境设置</label>
              <p class="mt-1 text-[11px] text-zinc-500">留空用默认值,占位灰字是当前生效值;保存后最长 10 秒全网生效。</p>
              <template x-for="g in gwGroups" :key="g.group">
                <fieldset class="mt-2 rounded-2xl border border-zinc-800 p-3">
                  <legend class="px-1 text-xs text-zinc-500" x-text="g.group"></legend>
                  <template x-for="item in g.items" :key="item.name">
                    <div class="mt-2">
                      <label class="block text-xs text-zinc-400" x-text="item.label"></label>
                      <input x-model="item.value" :placeholder="item.deployed || '未设置,用代码默认值'" :title="item.name" class="mt-1 h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-coral">
                      <p x-show="item.hint" class="mt-1 text-[11px] leading-5 text-zinc-500" x-text="item.hint || ''"></p>
                    </div>
                  </template>
                </fieldset>
              </template>
            </div>
          </template>
          <template x-if="gwSecrets.length">
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              <template x-for="s in gwSecrets" :key="s.label">
                <span x-text="(s.present ? '✓ ' : '— ') + s.label"></span>
              </template>
            </div>
          </template>
        </article>
      </section>
    </main>
  </div>

  <nav class="z-40 shrink-0 border-t border-zinc-800 bg-[#0a0a0b]/95 px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
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
function memoryAdmin() {
  return {
    nav: [
      { id: 'today', label: '今日', icon: 'sun' },
      { id: 'diary', label: '日记', icon: 'book-open' },
      { id: 'dream', label: '梦境', icon: 'moon-star' },
      { id: 'review', label: '审核队列', icon: 'inbox' },
      { id: 'memory', label: '重要记忆', icon: 'database' },
      { id: 'starmap', label: '星图', icon: 'sparkles' },
      { id: 'more', label: '更多', icon: 'layers' },
      { id: 'settings', label: '设置', icon: 'settings' }
    ],
    moreNav: [
      { id: 'precious', label: '珍贵' },
      { id: 'glossary', label: '黑话' },
      { id: 'world', label: '世界知识' },
      { id: 'maintenance', label: '维护' }
    ],
    canonicalMemoryTypes: ['fact', 'event', 'preference', 'relationship', 'boundary', 'habit', 'decision', 'note'],
    limits: { fact: 120, event: 80, preference: 80, relationship: 80, boundary: 80, habit: 80, decision: 80, note: 120 },
    gwKeyOptions: [
      { id: 'CHATBOX_API_KEY', label: '主钥匙' },
      { id: 'IM_API_KEY', label: '第二把' },
      { id: 'DEBUG_API_KEY', label: '维护' },
      { id: 'GUIDE_DOG_API_KEY', label: '导盲犬' }
    ],
    gwAddress: '',
    gwIdentities: [],
    gwGroups: [],
    gwSecrets: [],
    gwBusy: false,
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

    async init() {
      this.applyTheme();
      this.icons();
      await this.loadMemoryIdentities();
      await this.reloadAll();
    },
    currentIdentity() {
      return this.memoryIdentities.find(idn => idn.slug === this.selectedIdentity);
    },
    identitySpaces() {
      const idn = this.currentIdentity();
      if (!idn) return [];
      const write = idn.namespace || idn.slug;
      const reads = idn.readNamespaces === undefined ? [write] : idn.readNamespaces;
      return [...new Set([write, ...reads])].map(name => ({ name: name,
        label: name + (name === write ? ' · 写入空间' : ' · 召回空间') }));
    },
    spaceDescription() {
      const idn = this.currentIdentity();
      if (!idn) return '当前查看：' + this.namespace;
      const write = idn.namespace || idn.slug;
      const reads = idn.readNamespaces === undefined ? [write] : idn.readNamespaces;
      const owners = this.memoryIdentities.filter(other =>
        (other.namespace || other.slug) === this.namespace ||
        (other.readNamespaces || []).includes(this.namespace)).map(other => other.slug);
      return '写入：' + write + '；召回：' + (reads.length ? reads.join('、') : '已关闭') +
        (owners.length > 1 ? '。当前空间也被这些助手使用：' + owners.filter(name => name !== idn.slug).join('、') : '');
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
        this.identityLoadError = '助手列表读取失败，可在高级选项中填写空间名：' + error.message;
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
        if (!idn) throw new Error('找不到这位助手');
        const userName = (this.speakerUserName || '').trim();
        const assistantName = (this.speakerAssistantName || '').trim();
        if (userName) idn.userName = userName; else delete idn.userName;
        if (assistantName) idn.assistantName = assistantName; else delete idn.assistantName;
        await this.request('/api/gateway/config', { method: 'PUT', body: JSON.stringify(config) });
        const card = this.gwIdentities.find(item => item.slug === slug);
        if (card) { card.userName = userName; card.assistantName = assistantName; }
        await this.loadMemoryIdentities();
        this.notify('说话人名字保存好了');
      } catch (error) { this.notify('说话人名字保存失败:' + error.message); }
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
      this.todayMessages = []; this.candidates = []; this.memories = [];
      this.precious = []; this.glossary = [];
      this.diaryDailies = []; this.diaryWeeklies = []; this.diaryExpanded = {};
      this.worldItems = []; this.worldSelection = {}; this.worldQuery = '';
      this.memoryCreateOpen = false;
      this.memoryDraft = { type: 'fact', content: '', fact_key: '', importance: 0.7, confidence: 0.85 };
      this.glossaryDraft = { term: '', definition: '', aliasesText: '' };
      this.dreamStatus = null; this.dreamRuns = []; this.dreamHarvest = null;
      this.dreamExpanded = {}; this.dreamRunResult = null;
      this.dreamDate = ''; this.dreamHarvestDate = '';
      this.dreamLoading = false; this.dreamHarvestLoading = false;
      this.debugOutput = '尚未运行维护操作';
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
      this.notify(this.apiKey && this.apiKey.trim() ? 'Token 已保存' : 'Token 已清空');
      await this.loadMemoryIdentities();
      await this.switchSpace(this.namespace);
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
      return { reranked: '原文重排＋规则', lexical: '词面兜底', empty: '没有候选', error: '本轮未注入' }[status] || '旧版召回';
    },
    recallReasonLabel(reason) {
      const labels = { no_safe_window: '没有能完整保留局部上下文的短片段', rerank_selected: '原文片段相关，已通过规则筛选', lexical_fallback_selected: '重排不可用，改用词面命中', below_rerank_threshold: '相关分数不足，不凑数', duplicate_source: '同一来源本次只占一个位置', duplicate_fact: '同一事实已选更高分版本', impression_not_evidence: '日记印象不当作事实证据', latest_requires_evidence: '要排最近一次，相关分做不到，本轮不注入', reranker_timeout: '原文重排超时，已回落词面', reranker_missing_binding: '缺少 Worker AI 绑定，已回落词面', reranker_disabled: '重排已关闭，已回落词面', reranker_unsupported_model: '请配置 Workers AI 重排模型', reranker_invalid_response: '重排分数无效，已回落词面', reranker_failed: '原文重排失败，已回落词面', duplicate_content: '同一内容只保留一份', already_visible: '聊天历史里已经有了', item_budget: '已选出更合适的记忆', candidate_budget: '超过本次候选数量', empty_content: '没有可用正文' };
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
        if (current()) this.recallHistoryError = '召回记录读取失败：' + error.message;
      } finally {
        if (current()) this.recallHistoryLoading = false;
      }
    },
    async gwLoad() {
      if (this.gwBusy) return;
      this.gwBusy = true;
      try {
        const config = await this.request('/api/gateway/config');
        this.gwAddress = config.upstream && config.upstream.address || '';
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
            anthropicThinking: idn.anthropicThinking || 'passthrough',
            maxMemoryChars: idn.maxMemoryChars || ''
          };
        });
        const envData = await this.request('/api/gateway/env');
        this.gwGroups = envData.groups || [];
        this.gwSecrets = envData.secrets || [];
        this.notify('网关配置读好了');
      } catch (error) { this.notify('网关读取失败:' + error.message); }
      this.gwBusy = false;
    },
    gwAdd() {
      this.gwIdentities.push({ slug: '', userName: '', assistantName: '', modelsText: '', namespace: '', readNamespacesText: '', keys: ['CHATBOX_API_KEY'], anthropicThinking: 'passthrough', maxMemoryChars: '' });
    },
    async gwSave() {
      if (this.gwBusy) return;
      this.gwBusy = true;
      try {
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
          if (idn.anthropicThinking && idn.anthropicThinking !== 'passthrough') out.anthropicThinking = idn.anthropicThinking;
          const budget = parseInt(idn.maxMemoryChars, 10);
          if (budget) out.maxMemoryChars = budget;
          return out;
        });
        const config = { version: 3, identities: identities };
        if (this.gwAddress.trim()) config.upstream = { address: this.gwAddress.trim() };
        if (this.gwGroups.length) {
          const settings = {};
          this.gwGroups.forEach(function(g) {
            g.items.forEach(function(item) { if ((item.value || '').trim()) settings[item.name] = item.value.trim(); });
          });
          config.settings = settings;
        }
        const result = await this.request('/api/gateway/config', { method: 'PUT', body: JSON.stringify(config) });
        await this.loadMemoryIdentities();
        await this.switchSpace(this.namespace);
        this.notify('保存好了,' + (result.identities || 0) + ' 个助手,环境设置最长 10 秒全网生效');
      } catch (error) { this.notify('网关保存失败:' + error.message); }
      this.gwBusy = false;
    },
    async reloadAll() {
      this.savePrefs();
      var tasks = [this.loadBoot(), this.loadCandidates(), this.loadMemories()];
      if (this.page === 'settings') tasks.push(this.loadRecallHistory());
      if (this.page === 'diary') tasks.push(this.loadDiary());
      if (this.page === 'more' && this.moreView === 'world') tasks.push(this.loadWorldFacts());
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
        this.boot = data.data || {};
        this.stats = this.boot.stats || {};

        this.todayMessages = this.boot.today_messages || [];
        this.precious = this.boot.precious || [];
        this.glossary = this.boot.glossary || [];
      } catch (error) {
        if (revision !== this.spaceRevision) return;
        this.notify(error.message);
      }
    },
    async loadCandidates() {
      const revision = this.spaceRevision;
      try {
        const data = await this.request(this.withNamespace('/v1/candidates?status=pending&limit=100'));
        if (revision !== this.spaceRevision) return;
        this.candidates = (data.data || []).map(function(item) {
          item.editing = false;
          item.mergeOpen = false;
          item.target_id = '';
          item.draft = { content: item.content, type: item.type, fact_key: item.fact_key || '' };
          return item;
        });
      } catch (error) {
        if (revision !== this.spaceRevision) return;
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
          item.editing = false;
          item.mergeOpen = false;
          item.target_id = '';
          item.draft = { content: item.content };
          return item;
        });
      } catch (error) {
        if (revision !== this.spaceRevision) return;
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
      // 星图 v2 为独立 Three.js 页，从面板跳转而非内嵌 section
      if (id === 'starmap') {
        window.location.href = '/admin/starmap';
        return;
      }
      this.page = id;
      if (id === 'settings') { this.loadRecallHistory(); if (!this.gwGroups.length) this.gwLoad(); }
      if (id === 'review') this.loadCandidates();
      if (id === 'memory') this.loadMemories();
      if (id === 'diary') this.loadDiary();
      if (id === 'more') this.loadMoreView();
      if (id === 'dream') {
        this.loadDreamStatus();
        this.loadDreamHarvest();
      }
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
      const revision = this.spaceRevision;
      this.dreamLoading = true;
      try {
        const data = await this.request(this.withNamespace('/v1/dream/status'));
        if (revision !== this.spaceRevision) return;
        const payload = data.data || {};
        this.dreamStatus = payload;
        this.dreamRuns = payload.dream_runs || [];
        if (!this.dreamDate) this.dreamDate = this.dreamAnchorDate();
        if (!this.dreamHarvestDate) this.dreamHarvestDate = this.dreamAnchorDate();
      } catch (error) {
        if (revision !== this.spaceRevision) return;
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
