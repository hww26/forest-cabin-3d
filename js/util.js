/* ============================================================
   util.js —— 公共工具层
   低多边形调色板 / 确定性随机 / 几何构建器 / 材质缓存
   ============================================================ */
const FC = {};               // 全局命名空间
FC.THREE = THREE;            // three 全局引用（r137 非模块版）

/* ============================================================
   ⚠️ 关键修正：颜色空间
   ------------------------------------------------------------
   r137 的 Color 内部只做 /255，没有 sRGB→线性 转换
   （该版本还没有 ColorManagement，默认 legacy 行为）。
   而渲染器输出设定为 sRGBEncoding + ACES 色调映射，
   于是所有十六进制色都会被当作"线性值"直接吃进去 →
   整体过曝、发白、饱和度尽失。

   修法：patch Color 的 setHex / setStyle，
   让 `new THREE.Color('#8a5a34')` 和 `new THREE.Color(0x8a5a34)`
   自动转成线性空间。这样全项目所有色值一次性正确。
   ============================================================ */
(function patchColorSpace() {
  const C = THREE.Color;
  const origSetHex = C.prototype.setHex;
  const origSetStyle = C.prototype.setStyle;
  C.prototype.setHex = function (hex) {
    origSetHex.call(this, hex);
    return this.convertSRGBToLinear();
  };
  C.prototype.setStyle = function (style) {
    origSetStyle.call(this, style);
    return this.convertSRGBToLinear();
  };
})();

/* ---------- 调色板（取自参考图：暖橙木屋 + 层叠绿林 + 金黄花海） ---------- */
FC.PAL = {
  sky:        { day:'#9dc6e0', fog:'#c3cfc4', rain:'#8e9aa3', night:'#0d1524' },
  fog:        { day:'#c8d6cc', fog:'#d6dbd3', rain:'#939fa8', night:'#131c2c' },
  ground:     { day:'#53703d', fog:'#62765a', rain:'#47583c', night:'#1e2a1c' },
  grassDark:  '#33502a',
  grassMid:   '#4c6a37',
  grassLite:  '#69893f',
  pine1:      '#2f5334',
  pine2:      '#3b6540',
  pine3:      '#48764a',
  leaf1:      '#3f6a37',
  leaf2:      '#517f40',
  leaf3:      '#63944b',
  leafGold:   '#c8a03c',
  trunk:      '#4a3529',
  trunkLite:  '#5d4231',
  wood:       '#8a5a34',
  woodDark:   '#5c3a22',
  woodLite:   '#a8703f',
  roof:       '#4e3324',
  roofLite:   '#6a452e',
  brick:      '#9a7a63',
  stone:      '#8d8878',
  roseRed:    '#c8364f',
  rosePink:   '#e88aa0',
  roseDeep:   '#8e1f37',
  roseLeaf:   '#3e6b30',
  dasiyYellow:'#f0c93f',
  dasiyWhite: '#f4efdf',
  butterfly1: '#f2b33d',
  butterfly2: '#4f8fd0',
  butterfly3: '#e0709c',
  bee:        '#f0c02a',
  beeDark:    '#332a12',
  lampWarm:   '#ffc270',
  lampCore:   '#ffe1a8',
  glass:      '#a8d4e6',
  fabric:     '#b8564a',
  fabric2:    '#7a4a6b',
  paper:      '#e8dfc8'
};

/* ---------- 确定性随机（mulberry32）----------
   让每次刷新场景布局一致，方便反复调试同一构图 */
FC.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/* ---------- 通用数学 ---------- */
FC.rand  = (a, b) => a + Math.random() * (b - a);
FC.randI = (a, b) => Math.floor(FC.rand(a, b + 1));
FC.pick  = arr => arr[Math.floor(Math.random() * arr.length)];
FC.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* 帧率无关的指数平滑 */
FC.damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
FC.lerp = (a, b, t) => a + (b - a) * t;

/* 颜色混合（十六进制字符串）—— 在线性空间插值，结果转回 sRGB 十六进制 */
FC.mixHex = function (h1, h2, t) {
  const c1 = new FC.THREE.Color(h1).convertLinearToSRGB();
  const c2 = new FC.THREE.Color(h2).convertLinearToSRGB();
  return '#' + c1.lerp(c2, t).getHexString();
};

/* 设置一个颜色属性的 sRGB 值（自动转线性） */
FC.setSRGB = function (color, hex) {
  return color.setStyle(hex);
};

/* ---------- 材质缓存：同色同参共用一个材质，显著减少 draw call 状态切换 ---------- */
FC._matCache = new Map();
FC.mat = function (hex, opts) {
  opts = opts || {};
  const flat   = opts.flat !== false;              // 默认平面着色（低多边形关键）
  const rough  = opts.rough === undefined ? 0.92 : opts.rough;
  const metal  = opts.metal === undefined ? 0.0  : opts.metal;
  const emissive = opts.emissive || null;
  const op = opts.opacity === undefined ? 1 : opts.opacity;
  const side = opts.side || null;
  const key = [hex, flat, rough, metal, emissive || '-', op, side || 'f'].join('|');
  if (FC._matCache.has(key)) return FC._matCache.get(key);

  const p = { color: new FC.THREE.Color(hex), flatShading: flat, roughness: rough, metalness: metal };
  if (opts.map) p.map = opts.map;
  if (emissive) { p.emissive = new FC.THREE.Color(emissive); p.emissiveIntensity = opts.ei === undefined ? 1 : opts.ei; }
  if (op < 1) { p.transparent = true; p.opacity = op; }
  if (side !== null) p.side = side;
  if (opts.depthWrite === false) p.depthWrite = false;

  const m = new FC.THREE.MeshStandardMaterial(p);
  FC._matCache.set(key, m);
  return m;
};
FC.matBasic = function (hex, opacity, opts) {
  opts = opts || {};
  const key = 'B|' + hex + '|' + (opacity === undefined ? 1 : opacity) + '|' + (opts.side || 'f');
  if (FC._matCache.has(key)) return FC._matCache.get(key);
  const p = { color: new FC.THREE.Color(hex) };
  if (opacity !== undefined && opacity < 1) { p.transparent = true; p.opacity = opacity; }
  if (opts.side) p.side = opts.side;
  if (opts.depthWrite === false) p.depthWrite = false;
  const m = new FC.THREE.MeshBasicMaterial(p);
  FC._matCache.set(key, m);
  return m;
};
/* 每帧/切换天气时统一更新色板（改颜色不能污染缓存 → 直接改已建材质实例） */
FC.retintAll = function (fn) { FC._matCache.forEach(m => { if (m.color) fn(m); }); };

/* ---------- 合并几何工具：把一堆小物件合成单个 BufferGeometry ----------
   用于草丛 / 花海 / 碎石，把上千个 mesh 压成几个，性能提升非常明显 */
FC.mergeGeos = function (geos) {
  const three = FC.THREE;
  let vCount = 0, iCount = 0;
  geos.forEach(g => { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; });
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const col = new Float32Array(vCount * 3);
  const idx = (vCount > 65535) ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  const c = new three.Color();
  geos.forEach(g => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    const hasCol = !!g.attributes.color;
    if (hasCol) col.set(g.attributes.color.array, vo * 3);
    else { c.set(g.userData.hex || '#ffffff'); for (let i = 0; i < n; i++) { col[(vo + i) * 3] = c.r; col[(vo + i) * 3 + 1] = c.g; col[(vo + i) * 3 + 2] = c.b; } }
    if (g.index) { const src = g.index.array; for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo; io += src.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  });
  const out = new three.BufferGeometry();
  out.setAttribute('position', new three.BufferAttribute(pos, 3));
  out.setAttribute('normal',   new three.BufferAttribute(nor, 3));
  out.setAttribute('color',    new three.BufferAttribute(col, 3));
  out.setIndex(new three.BufferAttribute(idx, 1));
  return out;
};
/* 给几何体挂上颜色标记，供合并时写入顶点色 */
FC.tintGeo = function (geo, hex) { geo.userData.hex = hex; return geo; };

/* 顶点色材质（合并后统一用一个材质） */
FC.matVertex = function (opts) {
  opts = opts || {};
  const key = 'V|' + (opts.rough === undefined ? .95 : opts.rough) + '|' + (opts.flat !== false) + '|' + (opts.side || 'f') + '|' + (opts.emissive||'-');
  if (FC._matCache.has(key)) return FC._matCache.get(key);
  const p = { vertexColors: true, flatShading: opts.flat !== false, roughness: opts.rough === undefined ? .95 : opts.rough, metalness: 0 };
  if (opts.side) p.side = opts.side;
  if (opts.emissive) { p.emissive = new FC.THREE.Color(opts.emissive); p.emissiveIntensity = 1; }
  const m = new FC.THREE.MeshStandardMaterial(p);
  FC._matCache.set(key, m);
  return m;
};

/* ---------- 低多边形树冠：把球体顶点做随机扰动，得到不规则"团块" ---------- */
FC.blob = function (radius, detail, jitter, hex, TS) {
  const three = FC.THREE;
  const g = new three.IcosahedronGeometry(radius, detail || 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (Math.random() - 0.5) * (jitter === undefined ? 0.34 : jitter);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  if (hex) FC.tintGeo(g, hex);
  return g;
};

/* ---------- 锥形（针叶树冠），带轻微扰动 ---------- */
FC.cone = function (r, h, seg, jitter, hex) {
  const three = FC.THREE;
  const g = new three.ConeGeometry(r, h, seg || 7, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (Math.random() - 0.5) * (jitter === undefined ? .18 : jitter);
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
  }
  g.computeVertexNormals();
  if (hex) FC.tintGeo(g, hex);
  return g;
};

/* ---------- 平面挖矩形洞 ----------
   把一块墙板拆成若干小片，挖掉指定矩形区域。
   holes: [{x0,x1,y0,y1}]，坐标以平面左下角为原点、尺寸为 w×h。
   用于给墙开窗户/门洞 —— 否则窗户会被墙板埋住，白天进屋也是黑盒。 */
FC.planeMinusRects = function (w, h, holes, hex) {
  const three = FC.THREE;
  const xs = [0, w], ys = [0, h];
  holes.forEach(o => { xs.push(o.x0, o.x1); ys.push(o.y0, o.y1); });
  const ux = [...new Set(xs)].sort((a, b) => a - b);
  const uy = [...new Set(ys)].sort((a, b) => a - b);
  const geos = [];
  for (let i = 0; i < ux.length - 1; i++) {
    for (let j = 0; j < uy.length - 1; j++) {
      const cx = (ux[i] + ux[i + 1]) / 2, cy = (uy[j] + uy[j + 1]) / 2;
      if (holes.some(o => cx > o.x0 && cx < o.x1 && cy > o.y0 && cy < o.y1)) continue;
      const g = new three.PlaneGeometry(ux[i + 1] - ux[i], uy[j + 1] - uy[j]);
      g.translate((ux[i] + ux[i + 1]) / 2 - w / 2, (uy[j] + uy[j + 1]) / 2 - h / 2, 0);
      if (hex) FC.tintGeo(g, hex);
      geos.push(g);
    }
  }
  return geos.length ? FC.mergeGeos(geos) : null;
};

/* ---------- 沿一维路线铺料，遇到"洞"断开 ----------
   返回若干 [from, to] 区间。holes: [{a,b}]（沿该轴的位置区间） */
FC.splitSpans = function (from, to, holes) {
  const spans = [];
  let cur = from;
  holes.slice().sort((p, q) => p.a - q.a).forEach(hd => {
    if (hd.a > cur) spans.push([cur, Math.min(hd.a, to)]);
    cur = Math.max(cur, hd.b);
  });
  if (cur < to) spans.push([cur, to]);
  return spans.filter(s => s[1] - s[0] > 1e-4);
};

/* ---------- 便于摆放的变换封装 ---------- */
FC.place = function (geo, x, y, z, s, ry, rx) {
  const three = FC.THREE;
  const m = new three.Matrix4();
  const q = new three.Quaternion();
  const e = new three.Euler(rx || 0, ry || 0, 0);
  q.setFromEuler(e);
  m.compose(new three.Vector3(x, y, z), q, new three.Vector3(s === undefined ? 1 : s, s === undefined ? 1 : s, s === undefined ? 1 : s));
  geo.applyMatrix4(m);
  return geo;
};
FC.placeNonUniform = function (geo, x, y, z, sx, sy, sz, ry) {
  const three = FC.THREE;
  const m = new three.Matrix4();
  const q = new three.Quaternion();
  q.setFromEuler(new three.Euler(0, ry || 0, 0));
  m.compose(new three.Vector3(x, y, z), q, new three.Vector3(sx, sy, sz));
  geo.applyMatrix4(m);
  return geo;
};

/* ---------- 提示气泡 ---------- */
FC.toast = function (msg, ms) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(FC._toastT);
  FC._toastT = setTimeout(() => el.classList.remove('show'), ms || 1900);
};
