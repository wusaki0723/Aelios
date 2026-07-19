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
    --bg: #050816;
    --panel: rgba(14, 18, 40, .82);
    --panel-border: rgba(148, 163, 255, .18);
    --text: #e8ecff;
    --muted: #8b93b8;
    --coral: #F4A07C;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; height: 100%; overflow: hidden;
    background: var(--bg); color: var(--text);
    font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  #c { position: fixed; inset: 0; display: block; width: 100%; height: 100%; touch-action: none; }
  .toolbar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 20;
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    padding: 10px 12px; padding-top: max(10px, env(safe-area-inset-top));
    background: linear-gradient(to bottom, rgba(5,8,22,.92), rgba(5,8,22,.55) 70%, transparent);
    pointer-events: none;
  }
  .toolbar > * { pointer-events: auto; }
  .brand {
    display: flex; align-items: center; gap: 8px; min-width: 0;
    text-decoration: none; color: var(--text);
  }
  .brand-mark {
    width: 28px; height: 28px; border-radius: 10px;
    background: var(--coral); color: #251304;
    display: grid; place-items: center; font-weight: 700; font-size: 13px; flex-shrink: 0;
  }
  .brand-title { font-size: 14px; font-weight: 600; white-space: nowrap; }
  .brand-sub { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    height: 32px; padding: 0 10px; border-radius: 999px;
    border: 1px solid var(--panel-border); background: var(--panel);
    color: var(--muted); font-size: 12px; backdrop-filter: blur(10px);
  }
  .count { color: var(--text); font-variant-numeric: tabular-nums; }
  .btn {
    height: 32px; min-width: 32px; padding: 0 10px; border-radius: 999px;
    border: 1px solid var(--panel-border); background: var(--panel);
    color: var(--text); font-size: 12px; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    backdrop-filter: blur(10px); transition: border-color .15s, opacity .15s;
  }
  .btn:hover { border-color: var(--coral); }
  .btn.is-off { opacity: .38; text-decoration: line-through; }
  .btn .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .search-wrap {
    display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 160px; max-width: 280px;
  }
  .search-wrap input {
    flex: 1; min-width: 0; height: 32px; border-radius: 999px;
    border: 1px solid var(--panel-border); background: var(--panel);
    color: var(--text); padding: 0 12px; font-size: 12px; outline: none;
    backdrop-filter: blur(10px);
  }
  .search-wrap input:focus { border-color: var(--coral); }
  .legend-row {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center; width: 100%;
  }
  .legend-label {
    font-size: 10px; color: var(--muted); letter-spacing: .04em; margin-right: 2px;
  }
  .toolbar-collapse-btn { display: none; margin-left: auto; }
  .toolbar-body { display: contents; }
  @media (max-width: 720px) {
    .toolbar-collapse-btn { display: inline-flex; }
    .toolbar.is-collapsed .toolbar-body { display: none; }
    .toolbar:not(.is-collapsed) .toolbar-body {
      display: flex; flex-wrap: wrap; gap: 6px; width: 100%;
    }
    .search-wrap { max-width: none; flex: 1 1 100%; }
  }
  #tooltip {
    position: fixed; z-index: 30; pointer-events: none;
    padding: 6px 10px; border-radius: 10px;
    background: rgba(12, 16, 36, .92); border: 1px solid var(--panel-border);
    color: var(--text); font-size: 12px; max-width: 240px;
    transform: translate(-50%, -120%);
    opacity: 0; transition: opacity .12s;
    box-shadow: 0 8px 24px rgba(0,0,0,.35);
  }
  #tooltip.show { opacity: 1; }
  .drawer {
    position: fixed; z-index: 25;
    background: rgba(12, 16, 36, .94);
    border: 1px solid var(--panel-border);
    backdrop-filter: blur(16px);
    color: var(--text);
    display: none; flex-direction: column;
    box-shadow: 0 16px 40px rgba(0,0,0,.45);
  }
  .drawer.open { display: flex; }
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
    }
  }
  .drawer-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
    padding: 14px 14px 8px;
  }
  .drawer-head h2 {
    margin: 4px 0 0; font-size: 14px; line-height: 1.45; font-weight: 600;
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
    border: 1px solid var(--panel-border); background: rgba(10,14,32,.72);
    color: var(--muted); font-size: 14px; backdrop-filter: blur(8px);
    max-width: min(90vw, 360px);
  }
  .auth-banner { pointer-events: auto; }
  .auth-banner a { color: var(--coral); }
  .skip-hint {
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    z-index: 18; font-size: 11px; color: var(--muted);
    background: rgba(10,14,32,.55); border: 1px solid var(--panel-border);
    padding: 6px 12px; border-radius: 999px; pointer-events: none;
    opacity: 0; transition: opacity .3s;
  }
  .skip-hint.show { opacity: 1; }
  .caption {
    position: fixed; right: 14px; bottom: 14px; z-index: 12;
    font-size: 11px; color: rgba(140,150,180,.45); pointer-events: none;
  }
  @media (max-width: 767px) {
    .caption { bottom: auto; top: auto; display: none; }
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
<div class="toolbar is-collapsed" id="toolbar">
  <a class="brand" href="/admin" title="返回控制台">
    <div class="brand-mark">A</div>
    <div>
      <div class="brand-title">两江交汇</div>
      <div class="brand-sub">记忆星图</div>
    </div>
  </a>
  <span class="chip"><span class="count" id="countLabel">—</span></span>
  <button type="button" class="btn toolbar-collapse-btn" id="toolbarToggle" aria-label="展开工具">工具</button>
  <div class="toolbar-body" id="toolbarBody">
    <div class="search-wrap">
      <input id="searchInput" type="search" placeholder="搜索标签…" autocomplete="off">
      <button type="button" class="btn" id="searchBtn" aria-label="搜索">搜</button>
    </div>
    <button type="button" class="btn" id="refreshBtn" aria-label="刷新">刷新</button>
    <button type="button" class="btn" id="edgesToggle" title="全局边显隐">边: 关</button>
    <div class="legend-row" id="typeLegend"></div>
    <div class="legend-row" id="relLegend"></div>
  </div>
</div>
<div id="tooltip"></div>
<aside class="drawer" id="drawer" aria-live="polite">
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
  fact: new THREE.Color(0x4a9de0),
  preference: new THREE.Color(0x5ed0c8),
  habit: new THREE.Color(0x8aa4bc),
  note: new THREE.Color(0xe4eaf5)
};
var YANG_COLORS = {
  relationship: new THREE.Color(0xf08080),
  event: new THREE.Color(0xf0b84a),
  boundary: new THREE.Color(0xe04868),
  decision: new THREE.Color(0xe8a040)
};
var PINNED_COLOR = new THREE.Color(0xfff4e0);
var REL_COLORS = {
  supports: new THREE.Color(0xdce1eb),
  contradicts: new THREE.Color(0xef4444),
  cause_effect: new THREE.Color(0xf59e0b),
  derived_from: new THREE.Color(0xa78bfa),
  same_thread: new THREE.Color(0x7db4dc),
  supersedes: new THREE.Color(0x8c8c96)
};
var TYPE_LEGEND = [
  { id: 'fact', label: 'fact', color: '#4a9de0' },
  { id: 'preference', label: 'preference', color: '#5ed0c8' },
  { id: 'habit', label: 'habit', color: '#8aa4bc' },
  { id: 'note', label: 'note', color: '#e4eaf5' },
  { id: 'relationship', label: 'relationship', color: '#f08080' },
  { id: 'event', label: 'event', color: '#f0b84a' },
  { id: 'boundary', label: 'boundary', color: '#e04868' },
  { id: 'decision', label: 'decision', color: '#e8a040' }
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
function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function starSize(importance, pinned) {
  var imp = Number(importance);
  if (!Number.isFinite(imp)) imp = 0.5;
  imp = clamp(imp, 0, 1);
  var base = 0.55;
  var k = 1.35;
  var r = base + Math.pow(imp, 1.4) * k;
  if (pinned) r *= 1.45;
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
var toolbar = document.getElementById('toolbar');
var typeLegendEl = document.getElementById('typeLegend');
var relLegendEl = document.getElementById('relLegend');

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
var pointer = new THREE.Vector2(-10, -10);
var raycaster = new THREE.Raycaster();
raycaster.params.Points = { threshold: 0.9 };

// ── three ────────────────────────────────────────────────────
var renderer = new THREE.WebGLRenderer({
  canvas: canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x050816, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
var clock = new THREE.Clock();

var scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x050816, 0.011);

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

function makeRiverRibbon(curve, width, colorHex, opacity) {
  var segs = 120;
  var pts = curve.getSpacedPoints(segs);
  var positions = [];
  var colors = [];
  var col = new THREE.Color(colorHex);
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
    var fade = 0.4 + 0.6 * (1 - t * 0.2);
    var a = p.clone().addScaledVector(side, w);
    var b = p.clone().addScaledVector(side, -w);
    a.y -= 0.4;
    b.y -= 0.4;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    // RGB only; overall opacity via material (Three vertexColors is 3-comp)
    colors.push(col.r * fade, col.g * fade, col.b * fade, col.r * fade, col.g * fade, col.b * fade);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  var idx = [];
  for (var s = 0; s < pts.length - 1; s++) {
    var i0 = s * 2, i1 = s * 2 + 1, i2 = (s + 1) * 2, i3 = (s + 1) * 2 + 1;
    idx.push(i0, i1, i2, i1, i3, i2);
  }
  geo.setIndex(idx);
  var mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Mesh(geo, mat);
}

var riverGroup = new THREE.Group();
riverGroup.add(makeRiverRibbon(curves.han, 1.15, 0x4a9de0, 0.15));
riverGroup.add(makeRiverRibbon(curves.yang, 2.05, 0xf0b060, 0.17));
riverGroup.add(makeRiverRibbon(curves.down, 2.7, 0x9098b8, 0.08));
scene.add(riverGroup);

var cityLight = new THREE.PointLight(0xffd090, 1.5, 42, 2);
cityLight.position.set(0, 4.5, 0);
scene.add(cityLight);
scene.add(new THREE.AmbientLight(0x334466, 0.55));

// far dust
(function makeDust() {
  var n = 900;
  var pos = new Float32Array(n * 3);
  var col = new Float32Array(n * 3);
  var rnd = mulberry32(0xD057);
  for (var i = 0; i < n; i++) {
    var r = 30 + rnd() * 120;
    var th = rnd() * Math.PI * 2;
    var ph = (rnd() - 0.5) * Math.PI * 0.7;
    pos[i * 3] = r * Math.cos(ph) * Math.cos(th);
    pos[i * 3 + 1] = 8 + r * Math.sin(ph) * 0.45;
    pos[i * 3 + 2] = r * Math.cos(ph) * Math.sin(th) - 10;
    var c = 0.55 + rnd() * 0.45;
    col[i * 3] = c * 0.75;
    col[i * 3 + 1] = c * 0.82;
    col[i * 3 + 2] = c;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  var mat = new THREE.PointsMaterial({
    size: 0.35, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.55, depthWrite: false
  });
  scene.add(new THREE.Points(geo, mat));
})();

// star shader
var starVertexShader = [
  'attribute float aSize;',
  'attribute float aPhase;',
  'attribute float aAlpha;',
  'attribute vec3 aColor;',
  'uniform float uTime;',
  'uniform float uPixelRatio;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  vColor = aColor;',
  '  float breathe = 0.82 + 0.18 * sin(uTime * 1.7 + aPhase);',
  '  vAlpha = aAlpha * breathe;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = aSize * uPixelRatio * (180.0 / -mv.z);',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');
var starFragmentShader = [
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main() {',
  '  vec2 uv = gl_PointCoord - vec2(0.5);',
  '  float d = length(uv);',
  '  if (d > 0.5) discard;',
  '  float core = smoothstep(0.5, 0.08, d);',
  '  float glow = exp(-d * 5.2) * 0.85;',
  '  float a = (core * 0.95 + glow * 0.55) * vAlpha;',
  '  gl_FragColor = vec4(vColor, a);',
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

// particle flow
var particleSystems = [];
var CURVE_SAMPLES = 256;
var UP0 = new THREE.Vector3(0, 1, 0);

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

// lerp into caller-provided vectors — no allocation, no getUtoTmapping search
function sampleBaked(baked, t, outPos, outTan) {
  var f = clamp(t, 0, 1) * (CURVE_SAMPLES - 1);
  var i0 = Math.floor(f);
  var i1 = Math.min(i0 + 1, CURVE_SAMPLES - 1);
  var fr = f - i0;
  var a = i0 * 3, b = i1 * 3;
  outPos.set(
    baked.pos[a] + (baked.pos[b] - baked.pos[a]) * fr,
    baked.pos[a + 1] + (baked.pos[b + 1] - baked.pos[a + 1]) * fr,
    baked.pos[a + 2] + (baked.pos[b + 2] - baked.pos[a + 2]) * fr
  );
  outTan.set(
    baked.tan[a] + (baked.tan[b] - baked.tan[a]) * fr,
    baked.tan[a + 1] + (baked.tan[b + 1] - baked.tan[a + 1]) * fr,
    baked.tan[a + 2] + (baked.tan[b + 2] - baked.tan[a + 2]) * fr
  );
  if (outTan.lengthSq() < 1e-8) outTan.set(0, 0, 1); else outTan.normalize();
}

function makeFlowParticles(curve, count, colorA, colorB, speed) {
  count = Math.min(count, MAX_PARTICLES);
  var baked = bakeCurve(curve);
  var pos = new Float32Array(count * 3);
  var col = new Float32Array(count * 3);
  var metaArr = new Float32Array(count * 3); // t, speed, radius
  var rnd = mulberry32(hashStr('flow-' + colorA.getHexString() + '-' + count));
  var cA = colorA.clone();
  var cB = colorB.clone();
  var p = new THREE.Vector3();
  var tangent = new THREE.Vector3();
  var side = new THREE.Vector3();
  var up = new THREE.Vector3();
  var cc = new THREE.Color();
  for (var i = 0; i < count; i++) {
    var t = rnd();
    var rad = 0.3 + rnd() * 1.8;
    var ang = rnd() * Math.PI * 2;
    sampleBaked(baked, t, p, tangent);
    side.crossVectors(tangent, UP0);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0); else side.normalize();
    up.crossVectors(side, tangent).normalize();
    p.addScaledVector(side, Math.cos(ang) * rad);
    p.addScaledVector(up, Math.sin(ang) * rad * 0.4);
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    cc.copy(cA).lerp(cB, rnd());
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b;
    metaArr[i * 3] = t;
    metaArr[i * 3 + 1] = speed * (0.55 + rnd() * 0.9);
    metaArr[i * 3 + 2] = rad;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  var mat = new THREE.PointsMaterial({
    size: 0.22, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.35, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  var pts = new THREE.Points(geo, mat);
  scene.add(pts);
  particleSystems.push({
    points: pts, baked: baked, meta: metaArr, count: count
  });
}

makeFlowParticles(curves.han, 420, new THREE.Color(0x4a9de0), new THREE.Color(0xc8e8f8), 0.035);
makeFlowParticles(curves.yang, 620, new THREE.Color(0xf0b060), new THREE.Color(0xffd0a0), 0.03);
makeFlowParticles(curves.down, 700, new THREE.Color(0xa0b0d0), new THREE.Color(0xf0c080), 0.028);
// total particles ~1740 < 3000

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
  starById = {};
  indexToNode = [];
  var n = laid.length;
  if (!n) return;

  var positions = new Float32Array(n * 3);
  var colors = new Float32Array(n * 3);
  var sizes = new Float32Array(n);
  var phases = new Float32Array(n);
  var alphas = new Float32Array(n);

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
    node._index = i;
    node._baseColor = col;
    node._baseSize = sizes[i];
    node._baseAlpha = alphas[i];
  }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  starsPoints = new THREE.Points(geo, starMaterial);
  starsGroup.add(starsPoints);
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
  var colors = starsPoints.geometry.getAttribute('aColor');
  var sizes = starsPoints.geometry.getAttribute('aSize');
  var alphas = starsPoints.geometry.getAttribute('aAlpha');
  var now = performance.now();
  for (var j = 0; j < nodes.length; j++) {
    var node = nodes[j];
    var idx = node._index;
    if (idx == null) continue;
    var typeOn = node._special || typeVisible[node.type] !== false;
    if (!typeOn) {
      alphas.setX(idx, 0);
      continue;
    }
    var lit = !focus || neigh[node.id] || node._special;
    var dim = focus ? (lit ? 1 : 0.12) : 1;
    var col = node._baseColor.clone();
    if (focus && lit && node.id === focus) {
      col.lerp(new THREE.Color(0xffffff), 0.25);
    }
    colors.setXYZ(idx, col.r, col.g, col.b);
    var sizeMul = 1;
    if (hoverId === node.id || selectedId === node.id) sizeMul = 1.1;
    if (pulseId === node.id && now < pulseUntil) {
      var p = (pulseUntil - now) / 900;
      sizeMul *= 1 + 0.55 * Math.sin((1 - p) * Math.PI * 4) * p;
    }
    sizes.setX(idx, node._baseSize * sizeMul);
    alphas.setX(idx, dim);
  }
  colors.needsUpdate = true;
  sizes.needsUpdate = true;
  alphas.needsUpdate = true;
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
function markActivity() {
  idleT0 = performance.now();
  camTween = null;
  if (autoOrbit) {
    autoOrbit = false;
    controls.enableDamping = true;
  }
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
  var t = (now - introT0) / 3000;
  if (t >= 1) {
    skipIntro();
    return;
  }
  t = easeInOut(clamp(t, 0, 1));
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
    countLabel.textContent = '加载失败';
    errorBanner.textContent = (err && err.message) ? err.message : '加载失败';
    errorBanner.hidden = false;
  }
  loadingBanner.hidden = true;
}

function updateCount() {
  var real = 0;
  for (var i = 0; i < nodes.length; i++) if (!nodes[i]._easter) real++;
  var edgeN = edges.length;
  var extra = meta.truncated ? ' · 截断' : '';
  countLabel.textContent = real + ' 星 · ' + edgeN + ' 边' + extra;
}

// ── particles tick ───────────────────────────────────────────
var _pp = new THREE.Vector3();
var _tt = new THREE.Vector3();
var _side = new THREE.Vector3();
var _up = new THREE.Vector3();
function tickParticles(dt) {
  for (var s = 0; s < particleSystems.length; s++) {
    var sys = particleSystems[s];
    var pos = sys.points.geometry.getAttribute('position');
    for (var i = 0; i < sys.count; i++) {
      var t = sys.meta[i * 3] + sys.meta[i * 3 + 1] * dt;
      if (t > 1) t -= 1;
      sys.meta[i * 3] = t;
      sampleBaked(sys.baked, t, _pp, _tt);
      _side.crossVectors(_tt, UP0);
      if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0);
      else _side.normalize();
      _up.crossVectors(_side, _tt).normalize();
      var rad = sys.meta[i * 3 + 2];
      var ang = t * 12 + i * 0.4;
      _pp.addScaledVector(_side, Math.cos(ang) * rad);
      _pp.addScaledVector(_up, Math.sin(ang) * rad * 0.35);
      pos.setXYZ(i, _pp.x, _pp.y, _pp.z);
    }
    pos.needsUpdate = true;
  }
}

// ── render loop ──────────────────────────────────────────────
function resize() {
  var w = window.innerWidth;
  var h = window.innerHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  starMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
}

function frame(now) {
  raf = 0;
  if (!pageVisible) return;
  var dt = Math.min(clock.getDelta(), 0.05);
  updateIntro(now);
  if (camTween) {
    var tt = clamp((now - camTween.t0) / camTween.dur, 0, 1);
    var te = easeInOut(tt);
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
  tickParticles(dt);
  starMaterial.uniforms.uTime.value = now * 0.001;
  updatePulse(now);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(frame);
}

function ensureLoop() {
  if (!pageVisible) return;
  if (!raf) raf = requestAnimationFrame(frame);
}

// ── UI wiring ────────────────────────────────────────────────
function buildLegends() {
  typeLegendEl.innerHTML = '<span class="legend-label">类型</span>';
  TYPE_LEGEND.forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
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
  relLegendEl.innerHTML = '<span class="legend-label">边</span>';
  REL_LEGEND.forEach(function (item) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
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

document.getElementById('toolbarToggle').addEventListener('click', function () {
  toolbar.classList.toggle('is-collapsed');
  this.textContent = toolbar.classList.contains('is-collapsed') ? '工具' : '收起';
});
document.getElementById('refreshBtn').addEventListener('click', function () {
  markActivity();
  closeDrawer();
  loadGraph();
});
document.getElementById('edgesToggle').addEventListener('click', function () {
  showAllEdges = !showAllEdges;
  this.textContent = showAllEdges ? '边: 开' : '边: 关';
  applyFocusVisual();
  rebuildEdges();
});
document.getElementById('searchBtn').addEventListener('click', function () {
  var q = document.getElementById('searchInput').value;
  var hit = searchStars(q);
  if (hit) flyTo(hit.id, true);
});
document.getElementById('searchInput').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    var hit = searchStars(this.value);
    if (hit) flyTo(hit.id, true);
  }
});
document.getElementById('drawerClose').addEventListener('click', function () {
  closeDrawer();
});

var pointerDown = null;
canvas.addEventListener('pointerdown', function (ev) {
  markActivity();
  pointerDown = { x: ev.clientX, y: ev.clientY, t: performance.now() };
});
canvas.addEventListener('pointermove', function (ev) {
  markActivity();
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
