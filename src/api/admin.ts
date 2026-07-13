const ADMIN_HTML = String.raw`<!doctype html>
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
  :root { color-scheme: dark; }
  :root[data-theme="light"] { color-scheme: light; }
  [x-cloak] { display: none !important; }
  html, body { min-height: 100%; background: #0a0a0b; }
  body { margin: 0; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
  * { scrollbar-width: thin; scrollbar-color: #3f3f46 #18181b; }
  button, input, textarea, select { font: inherit; }
  :focus-visible { outline: 2px solid #F4A07C; outline-offset: 2px; }
  h1, h2, button, .text-keep { word-break: keep-all; }
  .tap { min-height: 44px; min-width: 44px; }
  .choice-tab {
    border-color: #27272a;
    background-color: #18181b;
    color: #a1a1aa;
  }
  .choice-tab.is-active {
    border-color: #F4A07C;
    background-color: rgba(244, 160, 124, .16);
    color: #f4f4f5;
    font-weight: 650;
  }
  :root[data-theme="light"] body,
  :root[data-theme="light"] .bg-\[\#0a0a0b\] { background-color: #f6f7f8 !important; }
  :root[data-theme="light"] .bg-\[\#0a0a0b\]\/95 { background-color: rgb(246 247 248 / .95) !important; }
  :root[data-theme="light"] .bg-zinc-900 { background-color: #ffffff !important; }
  :root[data-theme="light"] .active\:bg-zinc-800:active,
  :root[data-theme="light"] .hover\:bg-zinc-900:hover { background-color: #f0f1f3 !important; }
  :root[data-theme="light"] .text-zinc-100 { color: #18181b !important; }
  :root[data-theme="light"] .hover\:text-zinc-100:hover { color: #18181b !important; }
  :root[data-theme="light"] .text-zinc-300 { color: #3f3f46 !important; }
  :root[data-theme="light"] .text-zinc-400 { color: #71717a !important; }
  :root[data-theme="light"] .text-zinc-950 { color: #18181b !important; }
  :root[data-theme="light"] .border-zinc-800 { border-color: #e4e4e7 !important; }
  :root[data-theme="light"] .ring-zinc-800 { --tw-ring-color: #e4e4e7 !important; }
  :root[data-theme="light"] input,
  :root[data-theme="light"] textarea,
  :root[data-theme="light"] pre { color: #18181b; }
  :root[data-theme="light"] * { scrollbar-color: #d4d4d8 #f6f7f8; }
  :root[data-theme="light"] .choice-tab {
    border-color: #e4e4e7;
    background-color: #ffffff;
    color: #71717a;
  }
  :root[data-theme="light"] .choice-tab.is-active {
    border-color: #F4A07C;
    background-color: rgba(244, 160, 124, .24);
    color: #18181b;
  }
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
</style>
</head>
<body class="bg-[#0a0a0b] text-zinc-100 antialiased">
<div x-data="memoryAdmin()" x-init="init()" x-cloak class="min-h-dvh pb-24 md:pb-0">
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
    <div class="grid grid-cols-6 gap-0.5">
      <button type="button" @click="go('today')" class="tap grid place-items-center rounded-2xl text-[10px] transition duration-150 ease-in-out" :class="page === 'today' ? 'bg-zinc-900 text-coral' : 'text-zinc-400'"><i data-lucide="sun" class="h-5 w-5"></i><span>今日</span></button>
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
    var bg = light ? '#f6f7f8' : '#0a0a0b';
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
      if (id === 'starmap') this.loadStarmap();
      if (id === 'more') this.loadMoreView();
      this.icons();
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

export function handleAdmin(): Response {
  return new Response(ADMIN_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
