/**
 * 记忆星图 v2 · 两江交汇
 * GET /admin/starmap — 自包含 Three.js 页面（CDN 钉版本，无打包）
 * 鉴权与 admin 面板一致：localStorage Bearer + namespace → GET /api/relations/graph
 */

export const STARMAP_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1">
<title>记忆星图 · 两江交汇 — Aelios</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #04050c;
    --panel: rgba(10, 13, 28, .6);
    --panel-border: rgba(200, 205, 225, .16);
    --text: #ece8db;
    --muted: rgba(178, 184, 205, .62);
    --gold: #e8c88a;
    --serif: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%; overflow: hidden;
    background: var(--bg); color: var(--text);
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  #c { position: fixed; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; }
  /* ── top bar ── */
  .topbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 20;
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; padding-top: max(14px, env(safe-area-inset-top));
    pointer-events: none;
  }
  .topbar > * { pointer-events: auto; }
  .back-link {
    color: var(--muted); text-decoration: none; font-size: 12px;
    letter-spacing: .08em; padding: 6px 4px; transition: color .15s;
  }
  .back-link:hover { color: var(--text); }
  .top-actions { display: flex; gap: 8px; }
  .icon-btn {
    width: 34px; height: 34px; border-radius: 50%;
    border: 1px solid var(--panel-border); background: var(--panel);
    color: rgba(224, 226, 240, .85); cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    backdrop-filter: blur(10px); transition: border-color .15s, opacity .15s;
  }
  .icon-btn:hover { border-color: rgba(232, 200, 138, .65); }
  .icon-btn.is-off { opacity: .32; }
  .icon-btn svg { width: 15px; height: 15px; display: block; }

  /* ── centered serif title ── */
  .title-block {
    position: fixed; top: max(15px, env(safe-area-inset-top)); left: 50%;
    transform: translateX(-50%); z-index: 19; text-align: center;
    pointer-events: none; max-width: 58vw;
  }
  .title-main {
    font-family: var(--serif);
    font-size: 23px; font-weight: 500; letter-spacing: .3em; margin-left: .3em;
    color: #f0ead8; white-space: nowrap;
    text-shadow: 0 0 22px rgba(232, 200, 138, .22);
  }
  .title-sub {
    margin-top: 6px; margin-left: .26em;
    font-size: 10px; letter-spacing: .26em;
    color: rgba(188, 193, 214, .5); font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* ── floating search pill ── */
  .search-bar {
    position: fixed; top: max(62px, calc(env(safe-area-inset-top) + 52px));
    left: 50%; transform: translateX(-50%); z-index: 22;
    display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 14px;
    border-radius: 999px; border: 1px solid var(--panel-border);
    background: rgba(8, 11, 26, .8); backdrop-filter: blur(12px);
    box-shadow: 0 10px 30px rgba(0,0,0,.4);
  }
  .search-bar[hidden] { display: none; }
  .search-bar input {
    width: min(58vw, 300px); background: transparent; border: 0; outline: none;
    color: var(--text); font-size: 13px; padding: 5px 0;
  }
  .search-bar input::placeholder { color: rgba(160, 166, 190, .5); }
  .search-go {
    height: 30px; padding: 0 14px; border-radius: 999px; border: 0;
    background: rgba(232, 200, 138, .9); color: #241708; font-size: 12px; cursor: pointer;
  }

  /* ── bottom legend chips ── */
  .chips {
    position: fixed; left: 50%; transform: translateX(-50%);
    bottom: max(12px, env(safe-area-inset-bottom)); z-index: 20;
    display: flex; flex-direction: column; gap: 6px; align-items: center;
    max-width: min(94vw, 880px);
  }
  .chips-row {
    display: flex; gap: 6px; align-items: center; justify-content: center;
    max-width: 100%; overflow-x: auto; scrollbar-width: none; padding: 1px;
  }
  .chips-row::-webkit-scrollbar { display: none; }
  .chips-label {
    font-size: 9px; letter-spacing: .18em; color: rgba(160, 166, 190, .45);
    flex-shrink: 0; margin-right: 1px;
  }
  .chip {
    display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0;
    height: 29px; padding: 0 13px; border-radius: 999px;
    border: 1px solid var(--panel-border); background: var(--panel);
    color: rgba(216, 219, 234, .85); font-size: 11.5px; cursor: pointer;
    backdrop-filter: blur(8px); transition: border-color .15s, opacity .15s;
  }
  .chip:hover { border-color: rgba(232, 200, 138, .5); }
  .chip .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .chip.is-off { opacity: .4; }
  .chip.is-off .dot {
    background: transparent !important;
    box-shadow: inset 0 0 0 1.2px rgba(170, 175, 200, .55);
  }
  .chips-toggle { display: none; }

  .btn {
    height: 32px; min-width: 32px; padding: 0 12px; border-radius: 999px;
    border: 1px solid var(--panel-border); background: var(--panel);
    color: var(--text); font-size: 12px; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    backdrop-filter: blur(10px); transition: border-color .15s;
  }
  .btn:hover { border-color: rgba(232, 200, 138, .6); }

  /* ── corner text ── */
  .stats {
    position: fixed; right: 14px; bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 12; font-size: 10px; letter-spacing: .08em;
    color: rgba(150, 158, 185, .42); pointer-events: none;
    font-variant-numeric: tabular-nums;
  }
  .caption {
    position: fixed; left: 14px; bottom: max(12px, env(safe-area-inset-bottom));
    z-index: 12; font-size: 10px; letter-spacing: .1em;
    color: rgba(150, 158, 185, .38); pointer-events: none;
  }
  #tooltip {
    position: fixed; z-index: 30; pointer-events: none;
    padding: 6px 11px; border-radius: 999px;
    background: rgba(8, 11, 26, .92); border: 1px solid var(--panel-border);
    color: var(--text); font-size: 12px; max-width: 260px;
    transform: translate(-50%, -130%);
    opacity: 0; transition: opacity .12s;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
  }
  #tooltip.show { opacity: 1; }
  .drawer {
    position: fixed; z-index: 25;
    background: rgba(9, 12, 26, .94);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(16px);
    color: var(--text);
    display: none; flex-direction: column;
    box-shadow: 0 16px 40px rgba(0,0,0,.45);
  }
  .drawer.open { display: flex; }
  .drawer-grabber { display: none; }
  @media (min-width: 768px) {
    .drawer {
      top: 88px; right: 16px; bottom: 16px; width: 320px;
      border-radius: 18px;
    }
  }
  @media (max-width: 767px) {
    .drawer {
      left: 0; right: 0; bottom: 0; max-height: min(52dvh, 420px);
      border-radius: 18px 18px 0 0; border-bottom: 0;
      padding-bottom: env(safe-area-inset-bottom);
      transition: transform .25s ease;
    }
    .drawer-grabber {
      display: block; width: 38px; height: 4px; border-radius: 999px;
      background: rgba(220, 224, 240, .18); margin: 9px auto 0; flex-shrink: 0;
    }
  }
  .drawer-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
    padding: 12px 14px 8px;
  }
  .drawer-head h2 {
    margin: 4px 0 0; font-size: 15px; line-height: 1.5; font-weight: 500;
    font-family: var(--serif); letter-spacing: .03em;
  }
  .drawer-meta {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    padding: 0 14px 10px;
  }
  .meta-cell {
    border: 1px solid var(--panel-border); border-radius: 12px;
    padding: 8px 10px; font-size: 11px; color: var(--muted);
  }
  .meta-cell strong {
    display: block; margin-top: 2px; color: var(--text); font-size: 12px; font-weight: 500;
  }
  .drawer-edges { flex: 1; overflow: auto; padding: 0 14px 14px; }
  .drawer-edges h3 {
    margin: 0 0 8px; font-size: 11px; color: var(--muted); font-weight: 500;
  }
  .edge-item {
    display: flex; gap: 8px; align-items: flex-start; width: 100%;
    text-align: left; cursor: pointer;
    border: 1px solid var(--panel-border); background: rgba(5,8,22,.45);
    border-radius: 12px; padding: 8px 10px; margin-bottom: 6px;
    color: var(--text); font-size: 12px;
  }
  .edge-item:hover { border-color: var(--coral); }
  .edge-rel {
    flex-shrink: 0; font-size: 10px; padding: 2px 6px; border-radius: 999px;
    border: 1px solid var(--panel-border); color: var(--muted);
  }
  .empty-banner, .auth-banner, .loading-banner {
    position: fixed; z-index: 15; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    text-align: center; pointer-events: none;
    padding: 18px 22px; border-radius: 16px;
    border: 1px solid var(--panel-border); background: rgba(8, 11, 26, .72);
    color: var(--muted); font-size: 14px; backdrop-filter: blur(8px);
    max-width: min(90vw, 360px);
  }
  .empty-banner { font-family: var(--serif); letter-spacing: .12em; font-size: 15px; }
  .auth-banner { pointer-events: auto; }
  .auth-banner a { color: var(--gold); }
  .skip-hint {
    position: fixed; bottom: 92px; left: 50%; transform: translateX(-50%);
    z-index: 18; font-size: 11px; color: var(--muted);
    background: rgba(8, 11, 26, .55); border: 1px solid var(--panel-border);
    padding: 6px 12px; border-radius: 999px; pointer-events: none;
    opacity: 0; transition: opacity .3s;
  }
  .skip-hint.show { opacity: 1; }
  @media (max-width: 767px) {
    .title-main { font-size: 19px; }
    .title-block { max-width: 50vw; }
    .caption { display: none; }
    .stats { left: 14px; right: auto; }
    .chips {
      left: auto; right: 10px; transform: none;
      bottom: max(58px, calc(env(safe-area-inset-bottom) + 50px));
      display: none; align-items: flex-end;
    }
    .chips.open { display: flex; }
    .chips-row { justify-content: flex-end; flex-wrap: wrap; overflow: visible; }
    .chips-toggle {
      display: inline-flex; position: fixed; z-index: 21;
      right: 12px; bottom: max(12px, env(safe-area-inset-bottom));
      height: 34px;
    }
  }
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
</head>
<body>
<canvas id="c"></canvas>
<div class="topbar">
  <a class="back-link" href="/admin" title="返回控制台">‹ 控制台</a>
  <div class="top-actions">
    <button type="button" class="icon-btn" id="searchToggle" aria-label="搜索" title="搜索">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
    </button>
    <button type="button" class="icon-btn is-off" id="edgesToggle" aria-label="全局边显隐" title="全局边显隐">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 16.5L16 7.5"/></svg>
    </button>
    <button type="button" class="icon-btn" id="refreshBtn" aria-label="刷新" title="刷新">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v4h-4"/></svg>
    </button>
  </div>
</div>
<div class="title-block">
  <div class="title-main">两江星图</div>
  <div class="title-sub" id="countLabel">— MEMORIES · — LINKS · TWO RIVERS</div>
</div>
<div class="search-bar" id="searchBar" hidden>
  <input id="searchInput" type="search" placeholder="搜索记忆标签…" autocomplete="off">
  <button type="button" class="search-go" id="searchBtn">搜</button>
</div>
<div class="chips" id="chipsPanel">
  <div class="chips-row" id="typeLegend"></div>
  <div class="chips-row" id="relLegend"></div>
</div>
<button type="button" class="btn chips-toggle" id="chipsToggle">图例</button>
<div class="stats" id="stats">— fps · — 星</div>
<div id="tooltip"></div>
<aside class="drawer" id="drawer" aria-live="polite">
  <div class="drawer-grabber"></div>
  <div class="drawer-head">
    <div>
      <div style="font-size:11px;color:var(--muted)">详情</div>
      <h2 id="drawerTitle"></h2>
    </div>
    <button type="button" class="btn" id="drawerClose" aria-label="关闭">×</button>
  </div>
  <div class="drawer-meta" id="drawerMeta"></div>
  <div class="drawer-edges">
    <h3>相邻边</h3>
    <div id="drawerEdges"></div>
  </div>
</aside>
<div class="loading-banner" id="loadingBanner">加载星图…</div>
<div class="empty-banner" id="emptyBanner" hidden>江还在流，星等你来</div>
<div class="auth-banner" id="authBanner" hidden>
  需要 Token 才能读记忆。<br>
  请先在 <a href="/admin">控制台 · 设置</a> 保存 Bearer token。
</div>
<div class="empty-banner" id="errorBanner" hidden></div>
<div class="skip-hint" id="skipHint">点击或拖拽跳过开场</div>
<div class="caption">汉江是她 · 长江是我们 · 城是攒下的重要</div>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

var HAN_TYPES = { fact: 1, preference: 1, habit: 1, note: 1 };
var YANG_TYPES = { relationship: 1, event: 1, boundary: 1, decision: 1 };
var HAN_COLORS = {
  fact: new THREE.Color(0x7cb3e8),
  preference: new THREE.Color(0x86d8cc),
  habit: new THREE.Color(0x93a9c2),
  note: new THREE.Color(0xe9eef8)
};
var YANG_COLORS = {
  relationship: new THREE.Color(0xf0977f),
  event: new THREE.Color(0xf0c062),
  boundary: new THREE.Color(0xe06575),
  decision: new THREE.Color(0xeaa94e)
};
var PINNED_COLOR = new THREE.Color(0xfff6e2);
var REL_COLORS = {
  supports: new THREE.Color(0xdce1eb),
  contradicts: new THREE.Color(0xef4444),
  cause_effect: new THREE.Color(0xf59e0b),
  derived_from: new THREE.Color(0xa78bfa),
  same_thread: new THREE.Color(0x7db4dc),
  supersedes: new THREE.Color(0x8c8c96)
};
var TYPE_LEGEND = [
  { id: 'fact', label: 'fact', color: '#7cb3e8' },
  { id: 'preference', label: 'preference', color: '#86d8cc' },
  { id: 'habit', label: 'habit', color: '#93a9c2' },
  { id: 'note', label: 'note', color: '#e9eef8' },
  { id: 'relationship', label: 'relationship', color: '#f0977f' },
  { id: 'event', label: 'event', color: '#f0c062' },
  { id: 'boundary', label: 'boundary', color: '#e06575' },
  { id: 'decision', label: 'decision', color: '#eaa94e' }
];
var REL_LEGEND = [
  { id: 'supports', label: 'supports', color: '#dce1eb' },
  { id: 'contradicts', label: 'contradicts', color: '#ef4444' },
  { id: 'cause_effect', label: 'cause_effect', color: '#f59e0b' },
  { id: 'derived_from', label: 'derived_from', color: '#a78bfa' },
  { id: 'same_thread', label: 'same_thread', color: '#7db4dc' },
  { id: 'supersedes', label: 'supersedes', color: '#8c8c96' }
];
var RECENT_MS = 30 * 86400000;
var MAX_PARTICLES = 2800;

function hashStr(s) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    var t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function starSize(importance, pinned) {
  var imp = Number(importance);
  if (!Number.isFinite(imp)) imp = 0.5;
  imp = clamp(imp, 0, 1);
  var base = 0.6;
  var k = 1.75;
  var r = base + Math.pow(imp, 1.35) * k;
  if (pinned) r *= 1.5;
  return r;
}
function typeColor(type) {
  if (HAN_COLORS[type]) return HAN_COLORS[type].clone();
  if (YANG_COLORS[type]) return YANG_COLORS[type].clone();
  return new THREE.Color(0xa0a8c0);
}
function isHanType(type) { return !!HAN_TYPES[type]; }
function isYangType(type) { return !!YANG_TYPES[type]; }
function riverOf(type) {
  if (isYangType(type)) return 'yang';
  return 'han';
}
function fmtTime(value) {
  if (!value) return '—';
  var d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function pct(v) { return Math.round(Number(v || 0) * 100) + '%'; }

// ── DOM ──────────────────────────────────────────────────────
var canvas = document.getElementById('c');
var tooltipEl = document.getElementById('tooltip');
var drawerEl = document.getElementById('drawer');
var drawerTitle = document.getElementById('drawerTitle');
var drawerMeta = document.getElementById('drawerMeta');
var drawerEdges = document.getElementById('drawerEdges');
var countLabel = document.getElementById('countLabel');
var loadingBanner = document.getElementById('loadingBanner');
var emptyBanner = document.getElementById('emptyBanner');
var authBanner = document.getElementById('authBanner');
var errorBanner = document.getElementById('errorBanner');
var skipHint = document.getElementById('skipHint');
var searchBar = document.getElementById('searchBar');
var chipsPanel = document.getElementById('chipsPanel');
var statsEl = document.getElementById('stats');
var typeLegendEl = document.getElementById('typeLegend');
var relLegendEl = document.getElementById('relLegend');
var lastRealCount = 0;

var typeVisible = {};
var relVisible = {};
TYPE_LEGEND.forEach(function (t) { typeVisible[t.id] = true; });
REL_LEGEND.forEach(function (r) { relVisible[r.id] = true; });

var showAllEdges = false;
var nodes = [];
var edges = [];
var meta = { total_nodes: 0, total_edges: 0, truncated: false };
var starById = {};
var indexToNode = [];
var adj = {};
var hoverId = null;
var selectedId = null;
var pulseId = null;
var pulseUntil = 0;
var introActive = true;
var introT0 = 0;
var idleT0 = performance.now();
var autoOrbit = false;
var orbitAng = 0;
var camTween = null;
var loadSeq = 0;
var firstLoad = true;
var pageVisible = !document.hidden;
var raf = 0;
var fpsEma = 60;
var statsT0 = 0;
var pointer = new THREE.Vector2(-10, -10);
var raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.9 };

// ── three ────────────────────────────────────────────────────
var renderer = new THREE.WebGLRenderer({
  canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x04050c, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
var clock = new THREE.Clock();

var scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x04050c, 0.010);

var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(8, 34, 78);

var controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 12;
controls.maxDistance = 160;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 2.2, 2);
controls.update();

function buildCurves() {
  var han = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-52, 0.2, -48),
    new THREE.Vector3(-44, 1.2, -36),
    new THREE.Vector3(-36, -0.4, -26),
    new THREE.Vector3(-28, 1.0, -18),
    new THREE.Vector3(-20, 0.2, -12),
    new THREE.Vector3(-12, 0.6, -6),
    new THREE.Vector3(-5, 0.1, -2),
    new THREE.Vector3(0, 0, 0)
  ], false, 'catmullrom', 0.35);
  var yang = new THREE.CatmullRomCurve3([
    new THREE.Vector3(56, 0.1, -52),
    new THREE.Vector3(46, 0.8, -40),
    new THREE.Vector3(36, -0.2, -30),
    new THREE.Vector3(26, 0.5, -20),
    new THREE.Vector3(16, 0.0, -12),
    new THREE.Vector3(9, 0.3, -6),
    new THREE.Vector3(4, 0.0, -2),
    new THREE.Vector3(0, 0, 0)
  ], false, 'catmullrom', 0.28);
  var down = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.5, -0.2, 10),
    new THREE.Vector3(-1.0, -0.6, 24),
    new THREE.Vector3(2.0, -1.2, 40),
    new THREE.Vector3(-0.5, -2.0, 58),
    new THREE.Vector3(0, -3.0, 78)
  ], false, 'catmullrom', 0.3);
  var merge = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.5, 0.3, -1.2),
    new THREE.Vector3(0.2, 0.5, 1.8),
    new THREE.Vector3(0.8, 0.15, 5.5),
    new THREE.Vector3(0, -0.1, 9.5)
  ], false, 'catmullrom', 0.4);
  return { han: han, yang: yang, down: down, merge: merge };
}
var curves = buildCurves();

// river ribbons: soft luminous water with a slow flowing shimmer
var ribbonMaterials = [];
var ribbonVertexShader = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
  '}'
].join('\n');
var ribbonFragmentShader = [
  'uniform vec3 uColor;',
  'uniform float uTime;',
  'uniform float uOpacity;',
  'uniform float uEndFade;',
  'varying vec2 vUv;',
  'void main() {',
  '  float edge = sin(vUv.y * 3.14159);',
  '  edge *= edge;',
  '  float flow = 0.7 + 0.3 * sin(vUv.x * 55.0 - uTime * 0.8 + sin(vUv.y * 6.283) * 0.8);',
  '  float along = 1.0 - uEndFade * vUv.x * 0.65;',
  '  gl_FragColor = vec4(uColor, edge * flow * along * uOpacity);',
  '}'
].join('\n');

function makeRiverRibbon(curve, width, colorHex, opacity, endFade) {
  var segs = 120;
  var pts = curve.getSpacedPoints(segs);
  var positions = [];
  var uvs = [];
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    var t = i / (pts.length - 1);
    var next = pts[Math.min(i + 1, pts.length - 1)];
    var tangent = new THREE.Vector3().subVectors(next, p);
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    else tangent.normalize();
    var side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    else side.normalize();
    var w = width * (0.55 + 0.45 * Math.sin(t * Math.PI));
    var a = p.clone().addScaledVector(side, w);
    var b = p.clone().addScaledVector(side, -w);
    a.y -= 0.4;
    b.y -= 0.4;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(t, 0, t, 1);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  var idx = [];
  for (var s = 0; s < pts.length - 1; s++) {
    var i0 = s * 2, i1 = s * 2 + 1, i2 = (s + 1) * 2, i3 = (s + 1) * 2 + 1;
    idx.push(i0, i1, i2, i1, i3, i2);
  }
  geo.setIndex(idx);
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uEndFade: { value: endFade ? 1 : 0 }
    },
    vertexShader: ribbonVertexShader,
    fragmentShader: ribbonFragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  ribbonMaterials.push(mat);
  return new THREE.Mesh(geo, mat);
}

var riverGroup = new THREE.Group();
riverGroup.add(makeRiverRibbon(curves.han, 1.15, 0x5f9ed8, 0.16, false));
riverGroup.add(makeRiverRibbon(curves.yang, 2.05, 0xeab058, 0.17, false));
riverGroup.add(makeRiverRibbon(curves.merge, 1.7, 0xc9b06a, 0.13, false));
riverGroup.add(makeRiverRibbon(curves.down, 2.7, 0x8a90b0, 0.10, true));
scene.add(riverGroup);

var cityLight = new THREE.PointLight(0xffd090, 1.5, 42, 2);
cityLight.position.set(0, 4.5, 0);
scene.add(cityLight);
scene.add(new THREE.AmbientLight(0x334466, 0.55));

// soft radial sprite texture shared by star halos and milky-way haze
function makeGlowTexture() {
  var c = document.createElement('canvas');
  c.width = c.height = 128;
  var ctx = c.getContext('2d');
  var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.60)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.06)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
var glowTex = makeGlowTexture();

// far dust: dense warm micro-dust on a tilted band + sparse brighter far stars
(function makeDust() {
  var warm = new THREE.Color(0xffe9c4);
  var cool = new THREE.Color(0xbcd2ff);
  var cc = new THREE.Color();
  var rnd = mulberry32(0xD057);
  // micro gold dust on a tilted slab, like a distant galaxy plane
  var n1 = 700;
  var pos = new Float32Array(n1 * 3);
  var col = new Float32Array(n1 * 3);
  for (var i = 0; i < n1; i++) {
    var r = 26 + rnd() * 118;
    var th = rnd() * Math.PI * 2;
    var x = Math.cos(th) * r;
    pos[i * 3] = x;
    pos[i * 3 + 1] = (rnd() + rnd() + rnd() - 1.5) * 9 + x * 0.2 - 4;
    pos[i * 3 + 2] = Math.sin(th) * r - 12;
    cc.copy(rnd() < 0.78 ? warm : cool);
    var b = 0.35 + rnd() * 0.5;
    col[i * 3] = cc.r * b; col[i * 3 + 1] = cc.g * b; col[i * 3 + 2] = cc.b * b;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  var mat = new THREE.PointsMaterial({
    size: 0.3, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.55, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  scene.add(new THREE.Points(geo, mat));
  // sparse brighter far stars
  var n2 = 250;
  var pos2 = new Float32Array(n2 * 3);
  var col2 = new Float32Array(n2 * 3);
  for (var j = 0; j < n2; j++) {
    var r2 = 85 + rnd() * 90;
    var th2 = rnd() * Math.PI * 2;
    var ph2 = (rnd() - 0.5) * Math.PI;
    pos2[j * 3] = r2 * Math.cos(ph2) * Math.cos(th2);
    pos2[j * 3 + 1] = r2 * Math.sin(ph2) * 0.6;
    pos2[j * 3 + 2] = r2 * Math.cos(ph2) * Math.sin(th2) - 10;
    cc.copy(rnd() < 0.7 ? warm : cool);
    var b2 = 0.5 + rnd() * 0.5;
    col2[j * 3] = cc.r * b2; col2[j * 3 + 1] = cc.g * b2; col2[j * 3 + 2] = cc.b * b2;
  }
  var geo2 = new THREE.BufferGeometry();
  geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  geo2.setAttribute('color', new THREE.BufferAttribute(col2, 3));
  var mat2 = new THREE.PointsMaterial({
    size: 0.62, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  scene.add(new THREE.Points(geo2, mat2));
})();

// milky-way haze: a few huge soft sprites, very low opacity, slow breathing
var fogSprites = [];
(function makeFog() {
  var defs = [
    { p: [-46, 12, -85], s: 130, c: 0x2a3a6e, o: 0.10 },
    { p: [52, -8, -72], s: 105, c: 0x1e4a56, o: 0.08 },
    { p: [8, 6, -48], s: 72, c: 0x6e5a2e, o: 0.07 },
    { p: [-72, 22, -28], s: 92, c: 0x3a2a5e, o: 0.07 },
    { p: [34, 28, -105], s: 145, c: 0x22315e, o: 0.09 },
    { p: [-18, -16, 62], s: 85, c: 0x4a3a2a, o: 0.05 },
    { p: [0, 1.6, 0], s: 17, c: 0xffd9a0, o: 0.16 }
  ];
  for (var i = 0; i < defs.length; i++) {
    var d = defs[i];
    var m = new THREE.SpriteMaterial({
      map: glowTex, color: d.c, transparent: true, opacity: d.o,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var sp = new THREE.Sprite(m);
    sp.position.set(d.p[0], d.p[1], d.p[2]);
    sp.scale.set(d.s, d.s, 1);
    scene.add(sp);
    fogSprites.push({ mat: m, base: d.o, phase: i * 1.7, speed: 0.18 + (i % 3) * 0.07 });
  }
})();

// star shader: hot core + soft inner glow + wide halo, per-star breathing
var starVertexShader = [
  'attribute float aSize;',
  'attribute float aPhase;',
  'attribute float aAlpha;',
  'attribute float aCore;',
  'attribute float aKind;',
  'attribute vec3 aColor;',
  'uniform float uTime;',
  'uniform float uPixelRatio;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'varying float vCore;',
  'void main() {',
  '  vColor = aColor;',
  '  vCore = aCore;',
  '  float breathe = 0.82 + 0.18 * sin(uTime * 1.7 + aPhase);',
  '  vAlpha = aAlpha * breathe;',
  '  vec3 pos = position;',
  '  if (aKind > 0.5 && aKind < 1.5) {',
  '    // city lights gently float above the confluence',
  '    pos.y += sin(uTime * 0.55 + aPhase * 3.1) * 0.16;',
  '  }',
  '  if (aKind > 1.5) {',
  '    // easter-egg stars breathe slower and deeper',
  '    vAlpha = aAlpha * (0.72 + 0.28 * sin(uTime * 0.9 + aPhase));',
  '  }',
  '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
  '  gl_PointSize = aSize * uPixelRatio * (180.0 / -mv.z);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');
var starFragmentShader = [
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'varying float vCore;',
  'void main() {',
  '  vec2 uv = gl_PointCoord - vec2(0.5);',
  '  float d = length(uv);',
  '  if (d > 0.5) discard;',
  '  float core = smoothstep(0.16, 0.02, d);',
  '  float mid = exp(-d * 7.5) * 0.9;',
  '  float halo = exp(-d * 2.8) * 0.30;',
  '  vec3 col = vColor + vec3(0.92, 0.95, 1.0) * core * vCore;',
  '  float a = (core + mid + halo) * vAlpha;',
  '  gl_FragColor = vec4(col, a);',
  '}'
].join('\n');

var starMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
  },
  vertexShader: starVertexShader,
  fragmentShader: starFragmentShader,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

var starsPoints = null;
var starsGroup = new THREE.Group();
scene.add(starsGroup);

// halo layer: wide soft bloom for important / pinned / easter stars
var haloVertexShader = [
  'attribute float aSize;',
  'attribute float aPhase;',
  'attribute float aAlpha;',
  'attribute float aKind;',
  'attribute vec3 aColor;',
  'uniform float uTime;',
  'uniform float uPixelRatio;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  vColor = aColor;',
  '  vAlpha = aAlpha * (0.82 + 0.18 * sin(uTime * 0.8 + aPhase));',
  '  vec3 pos = position;',
  '  if (aKind > 0.5) pos.y += sin(uTime * 0.55 + aPhase * 3.1) * 0.16;',
  '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
  '  gl_PointSize = aSize * uPixelRatio * (150.0 / -mv.z);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');
var haloFragmentShader = [
  'uniform sampler2D uMap;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  vec4 tex = texture2D(uMap, gl_PointCoord);',
  '  gl_FragColor = vec4(vColor, tex.a * vAlpha);',
  '}'
].join('\n');
var haloMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    uMap: { value: glowTex }
  },
  vertexShader: haloVertexShader,
  fragmentShader: haloFragmentShader,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});
var haloPoints = null;
// smooth transitions: focus changes write targets, the frame loop eases toward them
var targetSizes = null;
var targetAlphas = null;
var targetHaloSizes = null;
var targetHaloAlphas = null;
var animActive = false;

// particle flow (GPU): curves baked into float textures, drift runs in shader
var flowMaterials = [];
var CURVE_SAMPLES = 256;

function bakeCurve(curve) {
  var pos = new Float32Array(CURVE_SAMPLES * 3);
  var tan = new Float32Array(CURVE_SAMPLES * 3);
  for (var i = 0; i < CURVE_SAMPLES; i++) {
    var t = i / (CURVE_SAMPLES - 1);
    var p = curve.getPointAt(t);
    var g = curve.getTangentAt(t);
    if (g.lengthSq() < 1e-8) g.set(0, 0, 1); else g.normalize();
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    tan[i * 3] = g.x; tan[i * 3 + 1] = g.y; tan[i * 3 + 2] = g.z;
  }
  return { pos: pos, tan: tan };
}

function curveTexture(arr) {
  var n = CURVE_SAMPLES;
  var rgba = new Float32Array(n * 4);
  for (var i = 0; i < n; i++) {
    rgba[i * 4] = arr[i * 3];
    rgba[i * 4 + 1] = arr[i * 3 + 1];
    rgba[i * 4 + 2] = arr[i * 3 + 2];
    rgba[i * 4 + 3] = 0;
  }
  var tex = new THREE.DataTexture(rgba, n, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

var flowVertexShader = [
  'attribute vec4 aSeed;', // t0, speed, radius, sizeFactor
  'attribute float aTint;',
  'attribute float aAng;',
  'uniform float uTime;',
  'uniform float uPixelRatio;',
  'uniform float uSize;',
  'uniform float uOpacity;',
  'uniform float uMixToMid;',
  'uniform float uEndFade;',
  'uniform vec3 uColorA;',
  'uniform vec3 uColorB;',
  'uniform sampler2D uCurvePos;',
  'uniform sampler2D uCurveTan;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'vec3 bakeSample(sampler2D tex, float t) {',
  '  float ft = t * ' + (CURVE_SAMPLES - 1).toFixed(1) + ';',
  '  float i0 = floor(ft);',
  '  float i1 = min(i0 + 1.0, ' + (CURVE_SAMPLES - 1).toFixed(1) + ');',
  '  vec3 s0 = texture2D(tex, vec2((i0 + 0.5) / ' + CURVE_SAMPLES.toFixed(1) + ', 0.5)).xyz;',
  '  vec3 s1 = texture2D(tex, vec2((i1 + 0.5) / ' + CURVE_SAMPLES.toFixed(1) + ', 0.5)).xyz;',
  '  return mix(s0, s1, fract(ft));',
  '}',
  'void main() {',
  '  float t = fract(aSeed.x + uTime * aSeed.y);',
  '  vec3 bp = bakeSample(uCurvePos, t);',
  '  vec3 bt = bakeSample(uCurveTan, t);',
  '  vec3 side = cross(bt, vec3(0.0, 1.0, 0.0));',
  '  if (dot(side, side) < 1e-6) side = vec3(1.0, 0.0, 0.0);',
  '  else side = normalize(side);',
  '  vec3 up = normalize(cross(side, bt));',
  '  float ang = aAng + t * 10.0;',
  '  vec3 pos = bp + side * cos(ang) * aSeed.z + up * sin(ang) * aSeed.z * 0.35;',
  // two lineages start pure, then blend toward each other downstream
  '  float mixT = mix(aTint, 0.5, uMixToMid * smoothstep(0.10, 0.75, t));',
  '  vColor = mix(uColorA, uColorB, mixT);',
  '  float head = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t));',
  '  float shimmer = 0.6 + 0.4 * sin(uTime * 0.9 + aAng * 7.0);',
  '  vAlpha = uOpacity * head * (1.0 - uEndFade * t * 0.6) * shimmer;',
  '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
  '  gl_PointSize = uSize * aSeed.w * uPixelRatio * (180.0 / -mv.z);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');
var flowFragmentShader = [
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  float d = length(gl_PointCoord - vec2(0.5));',
  '  if (d > 0.5) discard;',
  '  float a = exp(-d * 5.0) * vAlpha;',
  '  gl_FragColor = vec4(vColor, a);',
  '}'
].join('\n');

function makeFlowParticles(curve, opts) {
  var count = Math.min(opts.count, MAX_PARTICLES);
  var baked = bakeCurve(curve);
  var rnd = mulberry32(hashStr('flow2-' + opts.seed));
  var pos = new Float32Array(count * 3); // dummy; real positions are shader-side
  var seed = new Float32Array(count * 4);
  var tint = new Float32Array(count);
  var ang = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    seed[i * 4] = rnd();
    seed[i * 4 + 1] = opts.speed * (0.6 + rnd() * 0.8);
    seed[i * 4 + 2] = 0.25 + rnd() * 1.7;
    seed[i * 4 + 3] = 0.6 + rnd() * 0.9;
    tint[i] = rnd();
    ang[i] = rnd() * Math.PI * 2;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geo.setAttribute('aAng', new THREE.BufferAttribute(ang, 1));
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uSize: { value: opts.size },
      uOpacity: { value: opts.opacity },
      uMixToMid: { value: opts.mixToMid ? 1 : 0 },
      uEndFade: { value: opts.endFade ? 1 : 0 },
      uColorA: { value: new THREE.Color(opts.colorA) },
      uColorB: { value: new THREE.Color(opts.colorB) },
      uCurvePos: { value: curveTexture(baked.pos) },
      uCurveTan: { value: curveTexture(baked.tan) }
    },
    vertexShader: flowVertexShader,
    fragmentShader: flowFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; // positions are zero CPU-side; culling would hide the river
  scene.add(pts);
  flowMaterials.push(mat);
}

// slow night water: full traverse ~60-80s, densest on the 长江 main stem
makeFlowParticles(curves.han, { count: 500, colorA: 0x7cb3e8, colorB: 0xe9eef8, speed: 0.014, size: 0.30, opacity: 0.5, seed: 'han' });
makeFlowParticles(curves.yang, { count: 700, colorA: 0xf0c062, colorB: 0xf0977f, speed: 0.012, size: 0.34, opacity: 0.48, seed: 'yang' });
makeFlowParticles(curves.merge, { count: 360, colorA: 0x7cb3e8, colorB: 0xf0c062, speed: 0.018, size: 0.32, opacity: 0.6, mixToMid: true, seed: 'merge' });
makeFlowParticles(curves.down, { count: 380, colorA: 0x9fb6d8, colorB: 0xf0c890, speed: 0.013, size: 0.30, opacity: 0.42, mixToMid: true, endFade: true, seed: 'down' });
// flow 1940 + dust 950 ≈ 2890, within the 3000 particle budget

// edges as lines
var edgesGroup = new THREE.Group();
scene.add(edgesGroup);
var edgeObjects = [];

// ── layout stars along rivers ─────────────────────────────────
function offsetOnCurve(curve, t, id, radiusScale) {
  var rnd = mulberry32(hashStr(id + ':pos'));
  var p = curve.getPointAt(clamp(t, 0, 1));
  var tangent = curve.getTangentAt(clamp(t, 0, 1));
  if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
  else tangent.normalize();
  var side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
  else side.normalize();
  var up = new THREE.Vector3().crossVectors(side, tangent).normalize();
  var r = (0.35 + rnd() * 1.6) * (radiusScale || 1);
  var ang = rnd() * Math.PI * 2;
  p.addScaledVector(side, Math.cos(ang) * r);
  p.addScaledVector(up, Math.sin(ang) * r * 0.55);
  p.y += (rnd() - 0.35) * 0.8;
  return p;
}

function layoutStars(rawNodes) {
  var now = Date.now();
  var pinned = [];
  var hanOld = [];
  var yangOld = [];
  var recent = [];

  for (var i = 0; i < rawNodes.length; i++) {
    var n = rawNodes[i];
    if (n.pinned) {
      pinned.push(n);
      continue;
    }
    var created = Date.parse(n.created_at);
    if (!Number.isFinite(created)) created = now;
    var isRecent = (now - created) <= RECENT_MS;
    if (isRecent) {
      recent.push(n);
    } else if (isYangType(n.type)) {
      yangOld.push(n);
    } else {
      hanOld.push(n);
    }
  }

  function byTimeAsc(a, b) {
    var ta = Date.parse(a.created_at) || 0;
    var tb = Date.parse(b.created_at) || 0;
    return ta - tb;
  }
  hanOld.sort(byTimeAsc);
  yangOld.sort(byTimeAsc);
  recent.sort(byTimeAsc);
  pinned.sort(function (a, b) {
    return (Number(b.importance) || 0) - (Number(a.importance) || 0);
  });

  var laid = [];

  function placeRiver(list, curve, t0, t1) {
    var n = list.length;
    for (var i = 0; i < n; i++) {
      var node = list[i];
      var t = n === 1 ? (t0 + t1) / 2 : t0 + (t1 - t0) * (i / (n - 1));
      // slight sinusoidal wander along parameter for organic feel
      var wobble = Math.sin(hashStr(node.id) * 0.0001 + i * 0.7) * 0.012;
      t = clamp(t + wobble, 0.02, 0.98);
      var pos = offsetOnCurve(curve, t, node.id, 1);
      laid.push(Object.assign({}, node, {
        _pos: pos,
        _river: riverOf(node.type),
        _easter: false,
        _special: false
      }));
    }
  }

  // older memories: source(t~0) → confluence(t~1)
  placeRiver(hanOld, curves.han, 0.04, 0.92);
  placeRiver(yangOld, curves.yang, 0.04, 0.92);
  // recent 30d mixed on merge segment, still time-ordered toward downstream
  placeRiver(recent, curves.merge, 0.05, 0.95);

  // city lights above confluence
  var cityRnd = mulberry32(0xC17A);
  for (var p = 0; p < pinned.length; p++) {
    var pn = pinned[p];
    var ang = (p / Math.max(pinned.length, 1)) * Math.PI * 2 + cityRnd() * 0.4;
    var rad = 1.2 + (p % 5) * 0.55 + cityRnd() * 0.4;
    var pos = new THREE.Vector3(
      Math.cos(ang) * rad,
      3.2 + (p % 4) * 0.55 + cityRnd() * 0.8,
      Math.sin(ang) * rad * 0.7
    );
    laid.push(Object.assign({}, pn, {
      _pos: pos,
      _river: 'city',
      _easter: false,
      _special: false
    }));
  }

  // easter eggs: 旦九 at 汉江 source (长江色), 咲咲 at 长江 source (汉江色)
  var danjiuPos = offsetOnCurve(curves.han, 0.02, 'easter:danjiu', 0.5);
  danjiuPos.y += 1.2;
  laid.push({
    id: '__easter_danjiu__',
    label: '旦九',
    type: 'relationship',
    importance: 0.95,
    pinned: false,
    version_status: null,
    created_at: '',
    _pos: danjiuPos,
    _river: 'han',
    _easter: true,
    _special: true,
    _forceColor: YANG_COLORS.relationship.clone()
  });
  var sakuraPos = offsetOnCurve(curves.yang, 0.02, 'easter:sakura', 0.5);
  sakuraPos.y += 1.2;
  laid.push({
    id: '__easter_sakura__',
    label: '咲咲',
    type: 'preference',
    importance: 0.95,
    pinned: false,
    version_status: null,
    created_at: '',
    _pos: sakuraPos,
    _river: 'yang',
    _easter: true,
    _special: true,
    _forceColor: HAN_COLORS.preference.clone()
  });

  return laid;
}

function rebuildStars(laid) {
  if (starsPoints) {
    starsGroup.remove(starsPoints);
    starsPoints.geometry.dispose();
    starsPoints = null;
  }
  if (haloPoints) {
    starsGroup.remove(haloPoints);
    haloPoints.geometry.dispose();
    haloPoints = null;
  }
  starById = {};
  indexToNode = [];
  var n = laid.length;
  if (!n) return;

  var positions = new Float32Array(n * 3);
  var colors = new Float32Array(n * 3);
  var sizes = new Float32Array(n);
  var phases = new Float32Array(n);
  var alphas = new Float32Array(n);
  var cores = new Float32Array(n);
  var kinds = new Float32Array(n);

  var haloPos = [];
  var haloCol = [];
  var haloSize = [];
  var haloPhase = [];
  var haloAlpha = [];
  var haloKind = [];
  var haloCount = 0;
  var white = new THREE.Color(0xffffff);
  var tmpC = new THREE.Color();

  for (var i = 0; i < n; i++) {
    var node = laid[i];
    starById[node.id] = node;
    indexToNode[i] = node;
    var pos = node._pos;
    positions[i * 3] = pos.x;
    positions[i * 3 + 1] = pos.y;
    positions[i * 3 + 2] = pos.z;
    var col = node._forceColor
      ? node._forceColor.clone()
      : (node.pinned ? PINNED_COLOR.clone() : typeColor(node.type));
    if (node.pinned) col.lerp(new THREE.Color(0xf0c060), 0.35);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
    sizes[i] = starSize(node.importance, node.pinned || node._special);
    phases[i] = (hashStr(node.id) % 6283) / 1000;
    alphas[i] = typeVisible[node.type] === false && !node._special ? 0.0 : 1.0;
    var imp = clamp(Number(node.importance) || 0, 0, 1);
    cores[i] = node.pinned || node._special ? 0.85 : 0.25 + imp * 0.5;
    kinds[i] = node.pinned ? 1 : (node._special ? 2 : 0);
    node._index = i;
    node._baseColor = col;
    node._baseSize = sizes[i];
    node._baseAlpha = alphas[i];
    node._halo = -1;

    // wide soft bloom for stars that should carry the scene
    if (node.pinned || node._special || imp >= 0.7) {
      var hk = node.pinned ? 4.0 : (node._special ? 4.4 : 3.0);
      var ha = node.pinned ? 0.5 : (node._special ? 0.42 : 0.28);
      if (node.pinned) tmpC.set(0xffdca8);
      else { tmpC.copy(col); tmpC.lerp(white, 0.3); }
      haloPos.push(pos.x, pos.y, pos.z);
      haloCol.push(tmpC.r, tmpC.g, tmpC.b);
      haloSize.push(sizes[i] * hk);
      haloPhase.push(phases[i]);
      haloAlpha.push(ha);
      haloKind.push(node.pinned ? 1 : 0);
      node._halo = haloCount++;
      node._haloBaseSize = sizes[i] * hk;
      node._haloBaseAlpha = ha;
    }
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geo.setAttribute('aCore', new THREE.BufferAttribute(cores, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  starsPoints = new THREE.Points(geo, starMaterial);
  starsGroup.add(starsPoints);

  if (haloCount) {
    var hgeo = new THREE.BufferGeometry();
    hgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(haloPos), 3));
    hgeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(haloCol), 3));
    hgeo.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(haloSize), 1));
    hgeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(haloPhase), 1));
    hgeo.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(haloAlpha), 1));
    hgeo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(haloKind), 1));
    haloPoints = new THREE.Points(hgeo, haloMaterial);
    starsGroup.add(haloPoints);
  }

  targetSizes = new Float32Array(sizes);
  targetAlphas = new Float32Array(alphas);
  targetHaloSizes = haloCount ? new Float32Array(haloSize) : null;
  targetHaloAlphas = haloCount ? new Float32Array(haloAlpha) : null;
  animActive = false;
}

function rebuildAdj() {
  adj = {};
  for (var i = 0; i < nodes.length; i++) {
    if (!nodes[i]._easter) adj[nodes[i].id] = [];
  }
  for (var e = 0; e < edges.length; e++) {
    var edge = edges[e];
    if (relVisible[edge.rel_type] === false) continue;
    if (!starById[edge.src] || !starById[edge.dst]) continue;
    if (!adj[edge.src]) adj[edge.src] = [];
    if (!adj[edge.dst]) adj[edge.dst] = [];
    adj[edge.src].push(edge.dst);
    adj[edge.dst].push(edge.src);
  }
}

function clearEdges() {
  while (edgesGroup.children.length) {
    var ch = edgesGroup.children[0];
    edgesGroup.remove(ch);
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) ch.material.dispose();
  }
  edgeObjects = [];
}

function bezierArc(a, b, seed) {
  var mid = a.clone().add(b).multiplyScalar(0.5);
  var dir = new THREE.Vector3().subVectors(b, a);
  var len = dir.length() || 1;
  var up = new THREE.Vector3(0, 1, 0);
  var side = new THREE.Vector3().crossVectors(dir.clone().normalize(), up);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  var rnd = mulberry32(seed);
  var lift = 1.2 + len * 0.12 + rnd() * 1.5;
  mid.y += lift;
  mid.addScaledVector(side, (rnd() - 0.5) * len * 0.15);
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

function rebuildEdges() {
  clearEdges();
  var focus = hoverId || selectedId;
  for (var i = 0; i < edges.length; i++) {
    var edge = edges[i];
    if (relVisible[edge.rel_type] === false) continue;
    var a = starById[edge.src];
    var b = starById[edge.dst];
    if (!a || !b || a._easter || b._easter) continue;
    if (typeVisible[a.type] === false || typeVisible[b.type] === false) continue;
    var lit = showAllEdges || (focus && (edge.src === focus || edge.dst === focus));
    if (!lit && !showAllEdges) continue;
    if (!showAllEdges && focus && edge.src !== focus && edge.dst !== focus) continue;

    var curve = bezierArc(a._pos, b._pos, hashStr(edge.src + '>' + edge.dst + edge.rel_type));
    var pts = curve.getPoints(24);
    var geo = new THREE.BufferGeometry().setFromPoints(pts);
    var col = (REL_COLORS[edge.rel_type] || REL_COLORS.supports).clone();
    var isFocusEdge = focus && (edge.src === focus || edge.dst === focus);
    var opacity = isFocusEdge ? 0.75 : (showAllEdges ? 0.18 : 0.55);
    if (edge.rel_type === 'supersedes') opacity *= 0.55;
    var mat = new THREE.LineBasicMaterial({
      color: col,
      transparent: true,
      opacity: opacity,
      depthWrite: false
    });
    // contradicts: dashed via LineDashedMaterial
    if (edge.rel_type === 'contradicts') {
      mat = new THREE.LineDashedMaterial({
        color: col, transparent: true, opacity: opacity,
        dashSize: 0.45, gapSize: 0.28, depthWrite: false
      });
      var line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      edgesGroup.add(line);
      edgeObjects.push(line);
    } else {
      var line2 = new THREE.Line(geo, mat);
      edgesGroup.add(line2);
      edgeObjects.push(line2);
    }
  }
}

function applyFocusVisual() {
  if (!starsPoints) return;
  var focus = hoverId || selectedId;
  var neigh = {};
  if (focus) {
    neigh[focus] = true;
    var list = adj[focus] || [];
    for (var i = 0; i < list.length; i++) neigh[list[i]] = true;
  }
  // colors snap instantly; size/alpha go through the easing targets
  var colors = starsPoints.geometry.getAttribute('aColor');
  var now = performance.now();
  for (var j = 0; j < nodes.length; j++) {
    var node = nodes[j];
    var idx = node._index;
    if (idx == null) continue;
    var typeOn = node._special || typeVisible[node.type] !== false;
    var lit = !focus || neigh[node.id] || node._special;
    var dim = focus ? (lit ? 1 : 0.12) : 1;
    var sizeMul = 1;
    if (typeOn) {
      var col = node._baseColor.clone();
      if (focus && lit && node.id === focus) {
        col.lerp(new THREE.Color(0xffffff), 0.25);
      }
      colors.setXYZ(idx, col.r, col.g, col.b);
      if (hoverId === node.id || selectedId === node.id) sizeMul = 1.1;
      if (pulseId === node.id && now < pulseUntil) {
        var p = (pulseUntil - now) / 900;
        sizeMul *= 1 + 0.55 * Math.sin((1 - p) * Math.PI * 4) * p;
      }
      targetSizes[idx] = node._baseSize * sizeMul;
      targetAlphas[idx] = dim;
    } else {
      targetAlphas[idx] = 0;
    }
    if (targetHaloSizes && node._halo != null && node._halo >= 0) {
      targetHaloSizes[node._halo] = node._haloBaseSize * (sizeMul > 1 ? 1.12 : 1);
      targetHaloAlphas[node._halo] = typeOn ? node._haloBaseAlpha * dim : 0;
    }
  }
  colors.needsUpdate = true;
  animActive = true;
}

// ease current sizes/alphas toward targets; rests (and snaps) when close
function applyStarAnim(dt) {
  if (!animActive || !starsPoints || !targetSizes) return;
  var k = 1 - Math.exp(-dt * 9);
  var sizes = starsPoints.geometry.getAttribute('aSize');
  var alphas = starsPoints.geometry.getAttribute('aAlpha');
  var pulseIdx = -1;
  if (pulseId && starById[pulseId] && starById[pulseId]._index != null) {
    pulseIdx = starById[pulseId]._index;
  }
  var maxD = 0;
  var n = indexToNode.length;
  for (var i = 0; i < n; i++) {
    if (i === pulseIdx) continue; // the pulse owns this star's size
    var ns = sizes.getX(i) + (targetSizes[i] - sizes.getX(i)) * k;
    var na = alphas.getX(i) + (targetAlphas[i] - alphas.getX(i)) * k;
    sizes.setX(i, ns);
    alphas.setX(i, na);
    var d = Math.max(Math.abs(targetSizes[i] - ns), Math.abs(targetAlphas[i] - na) * 2);
    if (d > maxD) maxD = d;
  }
  if (haloPoints && targetHaloSizes) {
    var hs = haloPoints.geometry.getAttribute('aSize');
    var ha = haloPoints.geometry.getAttribute('aAlpha');
    var hn = hs.count;
    for (var j = 0; j < hn; j++) {
      var nhs = hs.getX(j) + (targetHaloSizes[j] - hs.getX(j)) * k;
      var nha = ha.getX(j) + (targetHaloAlphas[j] - ha.getX(j)) * k;
      hs.setX(j, nhs);
      ha.setX(j, nha);
      var hd = Math.abs(targetHaloSizes[j] - nhs) * 0.2;
      if (hd > maxD) maxD = hd;
    }
    hs.needsUpdate = true;
    ha.needsUpdate = true;
  }
  sizes.needsUpdate = true;
  alphas.needsUpdate = true;
  if (maxD < 0.004) {
    for (var i2 = 0; i2 < n; i2++) {
      if (i2 === pulseIdx) continue;
      sizes.setX(i2, targetSizes[i2]);
      alphas.setX(i2, targetAlphas[i2]);
    }
    if (haloPoints && targetHaloSizes) {
      var hs2 = haloPoints.geometry.getAttribute('aSize');
      var ha2 = haloPoints.geometry.getAttribute('aAlpha');
      for (var j2 = 0; j2 < hs2.count; j2++) {
        hs2.setX(j2, targetHaloSizes[j2]);
        ha2.setX(j2, targetHaloAlphas[j2]);
      }
      hs2.needsUpdate = true;
      ha2.needsUpdate = true;
    }
    animActive = false;
  }
}

// per-frame pulse: touches only the pulsing star's size, never rebuilds edges
function updatePulse(now) {
  if (!starsPoints || !pulseId) return;
  var node = starById[pulseId];
  if (!node || node._index == null) { pulseId = null; return; }
  if (now >= pulseUntil) {
    pulseId = null;
    applyFocusVisual();
    return;
  }
  var p = (pulseUntil - now) / 900;
  var sizeMul = 1 + 0.55 * Math.sin((1 - p) * Math.PI * 4) * p;
  if (hoverId === node.id || selectedId === node.id) sizeMul *= 1.1;
  var sizes = starsPoints.geometry.getAttribute('aSize');
  sizes.setX(node._index, node._baseSize * sizeMul);
  sizes.needsUpdate = true;
}

// ── interaction ──────────────────────────────────────────────
// light activity: resets idle timer and stops auto-orbit (mouse move)
function noteActivity() {
  idleT0 = performance.now();
  if (autoOrbit) {
    autoOrbit = false;
    controls.enableDamping = true;
  }
}

// deliberate input: also cancels camera tweens and skips the intro
function markActivity() {
  noteActivity();
  camTween = null;
  if (introActive) skipIntro();
}

function skipIntro() {
  if (!introActive) return;
  introActive = false;
  skipHint.classList.remove('show');
  camera.position.set(6, 18, 28);
  controls.target.set(0, 2.5, 1);
  controls.update();
}

function startIntro() {
  introActive = true;
  introT0 = performance.now();
  skipHint.classList.add('show');
  camera.position.set(4, 12, 92);
  controls.target.set(0, -1, 40);
  controls.update();
}

function updateIntro(now) {
  if (!introActive) return;
  var t = (now - introT0) / 3400;
  if (t >= 1) {
    skipIntro();
    return;
  }
  t = easeInOutCubic(clamp(t, 0, 1));
  var fromPos = new THREE.Vector3(4, 12, 92);
  var toPos = new THREE.Vector3(6, 18, 28);
  var fromTarget = new THREE.Vector3(0, -1, 40);
  var toTarget = new THREE.Vector3(0, 2.5, 1);
  camera.position.lerpVectors(fromPos, toPos, t);
  controls.target.lerpVectors(fromTarget, toTarget, t);
  controls.update();
}

function pickStar(clientX, clientY) {
  if (!starsPoints) return null;
  var rect = canvas.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  // scale threshold with distance
  var dist = camera.position.distanceTo(controls.target);
  raycaster.params.Points.threshold = clamp(dist * 0.02, 0.45, 2.2);
  var hits = raycaster.intersectObject(starsPoints, false);
  if (!hits.length) return null;
  // nearest visible hit; index→node map keeps this O(hits)
  for (var i = 0; i < hits.length; i++) {
    var node = indexToNode[hits[i].index];
    if (!node) continue;
    if (typeVisible[node.type] === false && !node._special) continue;
    return node;
  }
  return null;
}

function showTooltip(node, clientX, clientY) {
  if (!node) {
    tooltipEl.classList.remove('show');
    return;
  }
  tooltipEl.textContent = node.label || node.id;
  tooltipEl.style.left = clientX + 'px';
  tooltipEl.style.top = clientY + 'px';
  tooltipEl.classList.add('show');
}

function openDrawer(node) {
  if (!node || node._easter) {
    closeDrawer();
    return;
  }
  selectedId = node.id;
  drawerTitle.textContent = node.label || node.id;
  drawerMeta.innerHTML = '';
  var fields = [
    ['type', node.type || '—'],
    ['importance', pct(node.importance)],
    ['status', node.version_status || 'current'],
    ['created', fmtTime(node.created_at)]
  ];
  for (var i = 0; i < fields.length; i++) {
    var cell = document.createElement('div');
    cell.className = 'meta-cell';
    cell.innerHTML = fields[i][0] + '<strong></strong>';
    cell.querySelector('strong').textContent = fields[i][1];
    drawerMeta.appendChild(cell);
  }
  drawerEdges.innerHTML = '';
  var list = [];
  for (var e = 0; e < edges.length; e++) {
    var edge = edges[e];
    if (relVisible[edge.rel_type] === false) continue;
    var otherId = null;
    if (edge.src === node.id) otherId = edge.dst;
    else if (edge.dst === node.id) otherId = edge.src;
    if (!otherId) continue;
    var other = starById[otherId];
    list.push({ rel: edge.rel_type, otherId: otherId, label: other ? other.label : otherId });
  }
  if (!list.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--muted);padding:8px 0';
    empty.textContent = '这颗星还没有连线。';
    drawerEdges.appendChild(empty);
  } else {
    for (var k = 0; k < list.length; k++) {
      (function (item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'edge-item';
        var rel = document.createElement('span');
        rel.className = 'edge-rel';
        rel.textContent = item.rel;
        var lab = document.createElement('span');
        lab.textContent = item.label;
        btn.appendChild(rel);
        btn.appendChild(lab);
        btn.addEventListener('click', function () {
          flyTo(item.otherId, true);
        });
        drawerEdges.appendChild(btn);
      })(list[k]);
    }
  }
  drawerEl.classList.add('open');
  applyFocusVisual();
  rebuildEdges();
}

function closeDrawer() {
  selectedId = null;
  drawerEl.classList.remove('open');
  applyFocusVisual();
  rebuildEdges();
}

function flyTo(id, openDetail) {
  var node = starById[id];
  if (!node) return;
  markActivity();
  var dest = node._pos.clone();
  // approach along the current view direction so far-upstream stars stay readable
  var dir = camera.position.clone().sub(controls.target);
  var dist = clamp(dir.length() * 0.45, 7, 18);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0.5, 1);
  dir.normalize();
  camTween = {
    fromPos: camera.position.clone(),
    toPos: dest.clone().addScaledVector(dir, dist).add(new THREE.Vector3(0, 1.6, 0)),
    fromTgt: controls.target.clone(),
    toTgt: dest.clone().add(new THREE.Vector3(0, 0.4, 0)),
    t0: performance.now(),
    dur: 1000
  };
  pulseId = id;
  pulseUntil = performance.now() + 900;
  if (openDetail && !node._easter) openDrawer(node);
  else if (node._easter) {
    selectedId = null;
    hoverId = id;
    applyFocusVisual();
    rebuildEdges();
  } else {
    selectedId = id;
    applyFocusVisual();
    rebuildEdges();
  }
}

function searchStars(q) {
  q = (q || '').trim().toLowerCase();
  if (!q) return null;
  var best = null;
  for (var i = 0; i < nodes.length; i++) {
    var n = nodes[i];
    if (n._easter) continue;
    if (typeVisible[n.type] === false) continue;
    var label = (n.label || '').toLowerCase();
    if (label.indexOf(q) !== -1) {
      if (!best || label.length < (best.label || '').length) best = n;
    }
  }
  return best;
}

// ── data load ────────────────────────────────────────────────
function prefs() {
  return {
    apiKey: localStorage.getItem('aelios.admin.apiKey') || '',
    namespace: localStorage.getItem('aelios.admin.namespace') || 'default',
    workerUrl: (localStorage.getItem('aelios.admin.workerUrl') || location.origin).replace(/\/+$/, '')
  };
}

async function loadGraph() {
  var seq = ++loadSeq;
  var p = prefs();
  loadingBanner.hidden = false;
  emptyBanner.hidden = true;
  authBanner.hidden = true;
  errorBanner.hidden = true;
  if (!p.apiKey.trim()) {
    loadingBanner.hidden = true;
    authBanner.hidden = false;
    nodes = layoutStars([]);
    rebuildStars(nodes);
    rebuildAdj();
    rebuildEdges();
    updateCount();
    if (firstLoad) { firstLoad = false; startIntro(); }
    return;
  }
  try {
    var url = p.workerUrl + '/api/relations/graph?limit=800&namespace=' + encodeURIComponent(p.namespace);
    var res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + p.apiKey }
    });
    var text = await res.text();
    if (seq !== loadSeq) return; // superseded by a newer request
    var payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (err) { payload = null; }
    if (!res.ok) {
      throw new Error(
        payload && payload.error && payload.error.message
          ? payload.error.message
          : (res.status + ' ' + res.statusText)
      );
    }
    var rawNodes = (payload && payload.nodes) || [];
    edges = (payload && payload.edges) || [];
    meta = (payload && payload.meta) || { total_nodes: 0, total_edges: 0, truncated: false };
    nodes = layoutStars(rawNodes);
    rebuildStars(nodes);
    rebuildAdj();
    applyFocusVisual();
    rebuildEdges();
    updateCount();
    var realCount = rawNodes.length;
    emptyBanner.textContent = '江还在流，星等你来';
    emptyBanner.hidden = realCount > 0;
    // intro runs on first load only; refresh keeps the user's camera
    if (firstLoad) { firstLoad = false; startIntro(); }
  } catch (err) {
    if (seq !== loadSeq) return;
    console.error(err);
    countLabel.textContent = 'LOAD FAILED';
    errorBanner.textContent = (err && err.message) ? err.message : '加载失败';
    errorBanner.hidden = false;
  }
  loadingBanner.hidden = true;
}

function updateCount() {
  var real = 0;
  for (var i = 0; i < nodes.length; i++) if (!nodes[i]._easter) real++;
  lastRealCount = real;
  var edgeN = edges.length;
  var extra = meta.truncated ? ' · TRUNCATED' : '';
  countLabel.textContent = real + ' MEMORIES · ' + edgeN + ' LINKS' + extra + ' · TWO RIVERS';
}

// ── render loop ──────────────────────────────────────────────
function resize() {
  var w = window.innerWidth;
  var h = window.innerHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  starMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
  haloMaterial.uniforms.uPixelRatio.value = starMaterial.uniforms.uPixelRatio.value;
  for (var fm = 0; fm < flowMaterials.length; fm++) {
    flowMaterials[fm].uniforms.uPixelRatio.value = starMaterial.uniforms.uPixelRatio.value;
  }
}

function frame(now) {
  raf = 0;
  if (!pageVisible) return;
  var dt = Math.min(clock.getDelta(), 0.05);
  updateIntro(now);
  if (camTween) {
    var tt = clamp((now - camTween.t0) / camTween.dur, 0, 1);
    var te = easeInOutCubic(tt);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, te);
    controls.target.lerpVectors(camTween.fromTgt, camTween.toTgt, te);
    if (tt >= 1) camTween = null;
  }
  if (!introActive && autoOrbit) {
    // slow drift around the confluence; damping off so controls don't fight us
    orbitAng += dt * 0.07; // ~90s per revolution
    var r = camera.position.distanceTo(controls.target);
    camera.position.x = controls.target.x + Math.cos(orbitAng) * r;
    camera.position.z = controls.target.z + Math.sin(orbitAng) * r;
    camera.lookAt(controls.target);
  } else if (!introActive && !camTween && now - idleT0 > 20000) {
    autoOrbit = true;
    controls.enableDamping = false;
    orbitAng = Math.atan2(
      camera.position.z - controls.target.z,
      camera.position.x - controls.target.x
    );
  }
  controls.update();
  var tSec = now * 0.001;
  starMaterial.uniforms.uTime.value = tSec;
  haloMaterial.uniforms.uTime.value = tSec;
  for (var fm = 0; fm < flowMaterials.length; fm++) flowMaterials[fm].uniforms.uTime.value = tSec;
  for (var rb = 0; rb < ribbonMaterials.length; rb++) ribbonMaterials[rb].uniforms.uTime.value = tSec;
  for (var f = 0; f < fogSprites.length; f++) {
    var fs = fogSprites[f];
    fs.mat.opacity = fs.base * (0.8 + 0.2 * Math.sin(tSec * fs.speed + fs.phase));
  }
  applyStarAnim(dt);
  updatePulse(now);
  renderer.render(scene, camera);
  fpsEma += (1 / Math.max(dt, 0.001) - fpsEma) * 0.05;
  if (now - statsT0 > 500) {
    statsT0 = now;
    statsEl.textContent = Math.round(fpsEma) + ' fps · ' + lastRealCount + ' 星';
  }
  raf = requestAnimationFrame(frame);
}

function ensureLoop() {
  if (!pageVisible) return;
  if (!raf) raf = requestAnimationFrame(frame);
}

// ── UI wiring ────────────────────────────────────────────────
function buildLegends() {
  typeLegendEl.innerHTML = '<span class="chips-label">类型</span>';
  TYPE_LEGEND.forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.id = item.id;
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = item.color;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(item.label));
    btn.addEventListener('click', function () {
      typeVisible[item.id] = !typeVisible[item.id];
      btn.classList.toggle('is-off', !typeVisible[item.id]);
      applyFocusVisual();
      rebuildEdges();
    });
    typeLegendEl.appendChild(btn);
  });
  relLegendEl.innerHTML = '<span class="chips-label">关系</span>';
  REL_LEGEND.forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.id = item.id;
    var dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = item.color;
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(item.label));
    btn.addEventListener('click', function () {
      relVisible[item.id] = !relVisible[item.id];
      btn.classList.toggle('is-off', !relVisible[item.id]);
      rebuildAdj();
      applyFocusVisual();
      rebuildEdges();
    });
    relLegendEl.appendChild(btn);
  });
}

document.getElementById('chipsToggle').addEventListener('click', function () {
  chipsPanel.classList.toggle('open');
});
document.getElementById('searchToggle').addEventListener('click', function () {
  searchBar.hidden = !searchBar.hidden;
  if (!searchBar.hidden) document.getElementById('searchInput').focus();
});
document.getElementById('refreshBtn').addEventListener('click', function () {
  markActivity();
  closeDrawer();
  loadGraph();
});
document.getElementById('edgesToggle').addEventListener('click', function () {
  showAllEdges = !showAllEdges;
  this.classList.toggle('is-off', !showAllEdges);
  applyFocusVisual();
  rebuildEdges();
});
function runSearch() {
  var hit = searchStars(document.getElementById('searchInput').value);
  if (hit) {
    searchBar.hidden = true;
    flyTo(hit.id, true);
  }
}
document.getElementById('searchBtn').addEventListener('click', runSearch);
document.getElementById('searchInput').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    runSearch();
  } else if (ev.key === 'Escape') {
    searchBar.hidden = true;
  }
});
document.getElementById('drawerClose').addEventListener('click', function () {
  closeDrawer();
});

// mobile: drag the drawer down by its head to dismiss
(function drawerSwipe() {
  var startY = 0;
  var curY = 0;
  var dragging = false;
  drawerEl.addEventListener('touchstart', function (ev) {
    if (window.innerWidth >= 768) return;
    var t = ev.target;
    if (!t || !t.closest || !t.closest('.drawer-head, .drawer-grabber')) return;
    dragging = true;
    startY = ev.touches[0].clientY;
    curY = 0;
    drawerEl.style.transition = 'none';
  }, { passive: true });
  drawerEl.addEventListener('touchmove', function (ev) {
    if (!dragging) return;
    curY = ev.touches[0].clientY - startY;
    if (curY > 0) drawerEl.style.transform = 'translateY(' + curY + 'px)';
  }, { passive: true });
  drawerEl.addEventListener('touchend', function () {
    if (!dragging) return;
    dragging = false;
    drawerEl.style.transition = '';
    drawerEl.style.transform = '';
    if (curY > 70) closeDrawer();
  });
})();

var pointerDown = null;
canvas.addEventListener('pointerdown', function (ev) {
  markActivity();
  pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
});
canvas.addEventListener('pointermove', function (ev) {
  noteActivity();
  var node = pickStar(ev.clientX, ev.clientY);
  var next = node ? node.id : null;
  if (next !== hoverId) {
    hoverId = next;
    applyFocusVisual();
    rebuildEdges();
  }
  showTooltip(node, ev.clientX, ev.clientY);
  canvas.style.cursor = node ? 'pointer' : 'default';
});
canvas.addEventListener('pointerleave', function () {
  hoverId = null;
  showTooltip(null);
  applyFocusVisual();
  rebuildEdges();
});
canvas.addEventListener('pointerup', function (ev) {
  if (!pointerDown) return;
  var dx = ev.clientX - pointerDown.x;
  var dy = ev.clientY - pointerDown.y;
  var dt = performance.now() - pointerDown.t;
  pointerDown = null;
  if (dx * dx + dy * dy > 36 || dt > 500) return;
  var node = pickStar(ev.clientX, ev.clientY);
  if (!node) {
    closeDrawer();
    return;
  }
  if (node._easter) {
    selectedId = null;
    hoverId = node.id;
    drawerEl.classList.remove('open');
    applyFocusVisual();
    rebuildEdges();
    showTooltip(node, ev.clientX, ev.clientY);
    return;
  }
  openDrawer(node);
});

window.addEventListener('resize', function () {
  resize();
  ensureLoop();
});
document.addEventListener('visibilitychange', function () {
  pageVisible = !document.hidden;
  if (pageVisible) {
    clock.getDelta();
    ensureLoop();
  } else if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
});
['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(function (evt) {
  window.addEventListener(evt, markActivity, { passive: true });
});

// boot
buildLegends();
resize();
startIntro();
ensureLoop();
loadGraph();
</script>
</body>
</html>
`;
