/* ============================================================
   terrain.js —— 地形 / 草甸 / 小径 / 池塘 / 碎石 / 蘑菇
   低多边形风格：地面用较大面片 + 平面着色，靠顶点色做色块变化
   ============================================================ */

FC.smoothstep = function (a, b, x) {
  const t = FC.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------- 地形高度场 ----------
   小屋与空地（半径 17 内）保持水平，向外逐渐起伏成丘陵
   右侧后方挖一个池塘凹陷
   东侧挖一条南北走向的蜿蜒河流（z 从 -70 到 +70） */
FC.POND = { x: 17, z: -20, r: 5.6, depth: 2.7 };
/* 河道：小屋东侧，只走 z ∈ [6, 72]（北段穿林），避开池塘(z=-20) */
FC.RIVER = {
  z0: 6, z1: 72,          // 河道起止
  waterY: -0.85,          // 全局水面高度（比小屋地坪低）
  depth: 2.2,             // 河床再往下挖的深度
  halfW: 3.4,             // 河道半宽（水面处）
  bankW: 2.6,             // 岸坡过渡带宽度
  riverX: function (z) {  // 蜿蜒中心线
    return 26 + Math.sin(z * 0.05) * 5.5 + Math.sin(z * 0.13 + 1.7) * 2.4;
  },
  // 桥的位置（离空地近，转头可见）
  bridgeZ: 14
};
FC.riverDist = function (x, z) {   // 点到河道中心线的横向距离（河道外返回大值）
  if (z < FC.RIVER.z0 || z > FC.RIVER.z1) return 1e9;
  return Math.abs(x - FC.RIVER.riverX(z));
};
FC.terrainHeight = function (x, z) {
  const r = Math.hypot(x, z);
  const flat = FC.smoothstep(17, 42, r);
  let h = Math.sin(x * 0.077) * 1.7 + Math.cos(z * 0.064) * 1.9 + Math.sin((x * 0.6 + z * 0.8) * 0.043) * 1.4;
  h += Math.sin(x * 0.21 + z * 0.13) * 0.5;
  h *= flat;
  // 池塘
  const px = x - FC.POND.x, pz = z - FC.POND.z;
  const pd2 = px * px + pz * pz;
  h -= FC.POND.depth * Math.exp(-pd2 / (2 * 4.6 * 4.6));
  // 河道剖面：水线以内钳位出河床；水线到岸顶平滑混回自然地形（不产生峭壁）
  const rd = FC.riverDist(x, z);
  const W = FC.RIVER.halfW, B = FC.RIVER.bankW;
  if (rd < W + B) {
    if (rd <= W) {
      // 河床：中心最深，到水线处抬到水面下 0.14
      const t = FC.smoothstep(0, W, rd);
      const bed = FC.RIVER.waterY - FC.RIVER.depth * (1 - t) - 0.14;
      if (h > bed) h = bed;
    } else {
      // 岸坡：从"水下岸台"平滑混回自然地形
      const sB = FC.smoothstep(W, W + B, rd);
      const lo = Math.min(h, FC.RIVER.waterY - 0.14);
      const hb = lo + (h - lo) * sB;
      // 湿岸浅滩：在水线上方托一条窄平台，保证水面条带边缘总埋进岸里
      const fs = FC.smoothstep(W + 0.2, W + 0.7, rd) * (1 - FC.smoothstep(W + 1.3, W + B, rd));
      const floor = FC.RIVER.waterY + 0.62 * fs - 0.30 * (1 - fs);
      h = Math.max(hb, floor);
    }
  }
  return h;
};

/* 地面采点辅助：是否属于"建筑禁区" */
FC.blocked = function (x, z) {
  if (Math.abs(x) < 6.6 && Math.abs(z) < 6.6) return true;              // 小屋及屋檐
  const pd = Math.hypot(x - FC.POND.x, z - FC.POND.z);
  if (pd < 7.6) return true;                                            // 池塘
  if (FC.riverDist(x, z) < FC.RIVER.halfW + FC.RIVER.bankW + 0.8) return true;  // 河道及岸坡
  return false;
};

/* ============================================================ */
FC.Terrain = function (scene, quality) {
  const three = FC.THREE;
  this.group = new three.Group();
  this.group.name = 'terrain';
  scene.add(this.group);
  this.quality = quality || 'mid';
  this.time = 0;

  /* ---------------- 小径中心线（小屋门口 → 林间） ---------------- */
  this.pathPts = [];
  const raw = [
    [0.0, 3.4], [0.25, 6.2], [0.9, 9.4], [1.9, 12.6],
    [3.4, 15.6], [5.6, 18.2], [8.4, 20.2], [11.8, 21.6]
  ];
  raw.forEach(p => this.pathPts.push(new three.Vector2(p[0], p[1])));

  /* ---------------- 地面 ---------------- */
  this.buildGround();
  /* ---------------- 小径 ---------------- */
  this.buildPath();
  /* ---------------- 草丛 ---------------- */
  this.buildGrass();
  /* ---------------- 岩石 ---------------- */
  this.buildRocks();
  /* ---------------- 池塘 ---------------- */
  this.buildPond();
  /* ---------------- 河流 ---------------- */
  this.buildRiver();
  /* ---------------- 拱桥 ---------------- */
  this.buildBridge();
  /* ---------------- 水草 ---------------- */
  this.buildRiverWeeds();
  /* ---------------- 蘑菇 / 蕨类 ---------------- */
  this.buildDetails();
};

/* ---------- 点到路径中心线的距离 ---------- */
FC.Terrain.prototype.distToPath = function (x, z) {
  let best = 1e9;
  const pts = this.pathPts;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vz = b.y - a.y;
    const wx = x - a.x, wz = z - a.y;
    const len2 = vx * vx + vz * vz;
    let t = len2 > 0 ? (wx * vx + wz * vz) / len2 : 0;
    t = FC.clamp(t, 0, 1);
    const d = Math.hypot(x - (a.x + vx * t), z - (a.y + vz * t));
    if (d < best) best = d;
  }
  return best;
};

/* ============================================================ */
FC.Terrain.prototype.buildGround = function () {
  const three = FC.THREE;
  const SIZE = 260, SEG = this.quality === 'low' ? 64 : 104;
  const geo = new three.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new three.Color();
  const dark = new three.Color(FC.PAL.grassDark);
  const mid  = new three.Color(FC.PAL.grassMid);
  const lite = new three.Color(FC.PAL.grassLite);
  const dirt = new three.Color('#6b5537');
  const sand = new three.Color('#7d7357');
  const rng = FC.rng(31337);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = FC.terrainHeight(x, z);
    pos.setY(i, h);

    // 高度 + 噪声决定基色
    const n1 = Math.sin(x * 0.31 + z * 0.17) * 0.5 + 0.5;
    const n2 = Math.sin(x * 0.09 - z * 0.13 + 1.7) * 0.5 + 0.5;
    const hiT = FC.clamp((h + 3.4) / 7.2, 0, 1);
    c.copy(dark).lerp(mid, FC.clamp(hiT * 1.15 + n2 * 0.34, 0, 1));
    c.lerp(lite, FC.clamp((n1 - 0.52) * 1.1, 0, 0.62));
    // 山顶偏黄绿，洼地偏深
    if (h > 1.6) c.lerp(new three.Color('#8ea35c'), FC.clamp((h - 1.6) / 3.4, 0, .5));

    // 小径：把靠近中心线的顶点染成土色
    const dp = this.distToPath(x, z);
    if (dp < 2.3) {
      const w = 1 - FC.smoothstep(0.9, 2.3, dp);
      c.lerp(dirt, w * 0.94);
      c.offsetHSL(0, 0, (rng() - .5) * 0.03);
    }
    // 池塘边缘染成湿沙色
    const pd = Math.hypot(x - FC.POND.x, z - FC.POND.z);
    if (pd < 8.4) {
      const w = 1 - FC.smoothstep(4.2, 8.4, pd);
      c.lerp(sand, w * 0.72);
    } else if (FC.riverDist(x, z) < FC.RIVER.halfW + FC.RIVER.bankW + 1.6) {
      // 河岸湿沙：越靠水边越湿越深
      const rd = FC.riverDist(x, z);
      const w = 1 - FC.smoothstep(FC.RIVER.halfW - 0.4, FC.RIVER.halfW + FC.RIVER.bankW + 1.6, rd);
      c.lerp(sand, w * 0.78);
      if (rd < FC.RIVER.halfW * 0.8) c.lerp(new three.Color('#4e4636'), 0.55);  // 水下河床深色
    } else {
      // 随机草色斑块，打破单一（幅度加大 → 避免整片地面变成一块均匀亮绿）
      c.offsetHSL(0, (rng() - .5) * 0.11, (rng() - .5) * 0.075);
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new three.BufferAttribute(col, 3));
  geo.computeVertexNormals();

  this.groundMat = new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.97, metalness: 0
  });
  this.ground = new three.Mesh(geo, this.groundMat);
  this.ground.receiveShadow = true;
  this.ground.name = 'ground';
  this.group.add(this.ground);

  /* 地面以外的"远景幕布"：更远的丘陵剪影，增强纵深（低模平面着色） */
  this.buildHills();
};

/* ---------- 远景丘陵（环绕一圈的低多边形山脊） ---------- */
FC.Terrain.prototype.buildHills = function () {
  const three = FC.THREE;
  const geos = [];
  const rng = FC.rng(6060);
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rng() * 0.1;
    const rad = 96 + rng() * 62;
    const hgt = 11 + rng() * 26;
    const wid = 22 + rng() * 34;
    const g = FC.cone(wid * 0.5, hgt, 5 + (rng() * 3 | 0), 0.24,
      rng() < 0.4 ? '#3d5f42' : (rng() < 0.6 ? '#4a6d48' : '#56784e'));
    FC.place(g, Math.cos(a) * rad, hgt * 0.5 - 3.5, Math.sin(a) * rad, 1, rng() * 6.28);
    geos.push(g);
  }
  const merged = FC.mergeGeos(geos);
  this.hills = new three.Mesh(merged, FC.matVertex({ rough: 1, emissive: '#0a1210', ei: 0.06 }));
  this.hills.receiveShadow = false;
  this.hills.castShadow = false;
  this.group.add(this.hills);
};

/* ============================================================ */
/* 小径：沿中心线的带状网格 + 顶点色（土色渐变） */
FC.Terrain.prototype.buildPath = function () {
  const three = FC.THREE;
  const pts = this.pathPts;
  // 细分平滑
  const curve = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const steps = 7;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t * (3 - 2 * t);
      curve.push(new three.Vector2(
        a.x + (b.x - a.x) * t2 + Math.sin((i * 7 + s) * 1.7) * 0.12,
        a.y + (b.y - a.y) * t2
      ));
    }
  }
  curve.push(pts[pts.length - 1].clone());

  const verts = [], cols = [], idx = [];
  const cDark = new three.Color('#6a5334');
  const cLite = new three.Color('#8d7449');
  const c = new three.Color();
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i];
    const prev = curve[Math.max(0, i - 1)];
    const next = curve[Math.min(curve.length - 1, i + 1)];
    let dx = next.x - prev.x, dz = next.y - prev.y;
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;                                   // 法向
    const t = i / (curve.length - 1);
    const w = (1.34 - t * 0.42) * (0.86 + Math.sin(i * 1.3) * 0.14);
    for (let k = -1; k <= 1; k += 2) {
      const x = p.x + nx * w * k, z = p.y + nz * w * k;
      verts.push(x, FC.terrainHeight(x, z) + 0.055, z);
      const edge = Math.abs(k) === 1 ? 1 : 0;
      c.copy(cLite).lerp(cDark, edge * 0.55 + (i % 3) * 0.08);
      cols.push(c.r, c.g, c.b);
    }
    if (i > 0) {
      const b0 = (i - 1) * 2, b1 = i * 2;
      idx.push(b0, b1, b0 + 1, b1, b1 + 1, b0 + 1);
    }
  }
  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new three.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  this.path = new three.Mesh(geo, new three.MeshStandardMaterial({
    vertexColors: true, flatShading: false, roughness: .98, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  }));
  this.path.receiveShadow = true;
  this.group.add(this.path);

  /* 踏脚石：沿路径零星放石板 */
  const stones = [];
  const rng = FC.rng(7788);
  for (let i = 4; i < curve.length - 2; i += 3) {
    if (rng() < 0.34) continue;
    const p = curve[i];
    const off = (rng() - .5) * 0.85;
    const r = 0.34 + rng() * 0.28;
    const g = new three.SphereGeometry(r, 5, 3);
    const pp = g.attributes.position;
    for (let k = 0; k < pp.count; k++) {
      const s = 1 + (rng() - .5) * .45;
      pp.setXYZ(k, pp.getX(k) * s, pp.getY(k) * 0.34 * s, pp.getZ(k) * s);
    }
    g.computeVertexNormals();
    FC.place(g, p.x + off, FC.terrainHeight(p.x, p.y) + 0.06, p.y + (rng() - .5) * .5, 1, rng() * 6.28);
    FC.tintGeo(g, rng() < .5 ? '#8b8375' : '#9a917f');
    stones.push(g);
  }
  if (stones.length) {
    const m = new three.Mesh(FC.mergeGeos(stones), FC.matVertex({ rough: .96 }));
    m.receiveShadow = true; m.castShadow = true;
    this.group.add(m);
  }
};

/* ============================================================ */
/* 草丛：手工写顶点缓冲，把所有草叶塞进一个 mesh */
FC.Terrain.prototype.buildGrass = function () {
  const three = FC.THREE;
  const N = this.quality === 'low' ? 1500 : (this.quality === 'mid' ? 3400 : 6200);
  const BLADES = 5;
  const VPT = BLADES * 4;                 // 每丛 4 顶点/叶
  const verts = new Float32Array(N * VPT * 3);
  const cols  = new Float32Array(N * VPT * 3);
  const idx   = new Uint32Array(N * BLADES * 6);
  const rng = FC.rng(20260);

  const cBase = new three.Color();
  const cTip  = new three.Color();
  const G1 = new three.Color('#3a5a2c'), G2 = new three.Color('#668a41'), G3 = new three.Color('#8aa552');
  const W1 = new three.Color('#5d7040'), W2 = new three.Color('#7d8b4c');   // 杂枯草

  let vo = 0, io = 0, placed = 0, guard = 0;
  while (placed < N && guard < N * 30) {
    guard++;
    const a = rng() * Math.PI * 2;
    const r = 2.6 + Math.pow(rng(), 0.72) * 48;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    if (this.distToPath(x, z) < 0.95) continue;
    // 远处稀疏，近处密
    if (r > 26 && rng() > 0.72 - (r - 26) / 120) continue;

    const y = FC.terrainHeight(x, z);
    const scale = 0.72 + rng() * 0.85;
    // 少量偏黄枯草，增加色彩层次
    const dry = rng() < 0.18;
    const tone = rng();
    cBase.copy(dry ? W1 : (tone < .4 ? G1 : (tone < .8 ? G2 : G3)));
    cTip.copy(cBase).offsetHSL(0.014, -0.04, dry ? 0.2 : 0.16);

    for (let b = 0; b < BLADES; b++) {
      const ba = (b / BLADES) * Math.PI * 2 + rng() * 1.1;
      const br = rng() * 0.17 * scale;
      const bx = x + Math.cos(ba) * br, bz = z + Math.sin(ba) * br;
      const hh = (0.30 + rng() * 0.36) * scale;
      const w0 = (0.038 + rng() * 0.03) * scale;
      const w1 = w0 * 0.16;
      // 弯曲方向
      const lean = (rng() - .5) * 0.42;
      const dx = Math.cos(ba + 1.57) * lean, dz = Math.sin(ba + 1.57) * lean;
      const tx = bx + dx * hh * 0.6, tz = bz + dz * hh * 0.6;
      const px = -Math.sin(ba), pz = Math.cos(ba);   // 叶面法向的横向

      // 0 左下 1 右下 2 右上 3 左上
      const put = (X, Y, Z, c) => {
        verts[vo * 3] = X; verts[vo * 3 + 1] = Y; verts[vo * 3 + 2] = Z;
        cols[vo * 3] = c.r; cols[vo * 3 + 1] = c.g; cols[vo * 3 + 2] = c.b;
        vo++;
      };
      put(bx - px * w0, y, bz - pz * w0, cBase);
      put(bx + px * w0, y, bz + pz * w0, cBase);
      put(tx + px * w1, y + hh, tz + pz * w1, cTip);
      put(tx - px * w1, y + hh, tz - pz * w1, cTip);
      const o = vo - 4;
      idx[io++] = o; idx[io++] = o + 1; idx[io++] = o + 2;
      idx[io++] = o; idx[io++] = o + 2; idx[io++] = o + 3;
    }
    placed++;
  }

  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.BufferAttribute(verts.subarray(0, vo * 3), 3));
  geo.setAttribute('color',    new three.BufferAttribute(cols.subarray(0, vo * 3), 3));
  geo.setIndex(new three.BufferAttribute(idx.subarray(0, io), 1));
  geo.computeVertexNormals();

  this.grassMat = new three.MeshStandardMaterial({
    vertexColors: true, roughness: .95, metalness: 0,
    side: three.DoubleSide
  });
  this.grass = new three.Mesh(geo, this.grassMat);
  this.grass.castShadow = false;      // 草不投影，省性能
  this.grass.receiveShadow = true;
  this.grass.name = 'grass';
  this.group.add(this.grass);

  // 记录原始位置用于风动
  this.grassGeo = geo;
};

/* ============================================================ */
/* 岩石 */
FC.Terrain.prototype.buildRocks = function () {
  const three = FC.THREE;
  const geos = [];
  const rng = FC.rng(5150);
  const count = this.quality === 'low' ? 22 : 48;
  for (let i = 0; i < count; i++) {
    const a = rng() * Math.PI * 2;
    const r = 7 + Math.pow(rng(), .7) * 42;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    if (this.distToPath(x, z) < 1.3) continue;
    const s = 0.4 + rng() * 1.55;
    const g = new three.IcosahedronGeometry(s, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      p.setXYZ(k, p.getX(k) * (1 + (rng() - .5) * .5),
                  p.getY(k) * (0.52 + rng() * .5),
                  p.getZ(k) * (1 + (rng() - .5) * .5));
    }
    g.computeVertexNormals();
    FC.place(g, x, FC.terrainHeight(x, z) + s * 0.24, z, 1, rng() * 6.28);
    FC.tintGeo(g, rng() < .45 ? '#7f7a6e' : (rng() < .6 ? '#8e897c' : '#6d6a60'));
    geos.push(g);
  }
  if (!geos.length) return;
  const m = new three.Mesh(FC.mergeGeos(geos), FC.matVertex({ rough: .98 }));
  m.castShadow = true; m.receiveShadow = true;
  this.group.add(m);
  // 岩石上覆的青苔
  const moss = [];
  const rng2 = FC.rng(5151);
  for (let i = 0; i < (this.quality === 'low' ? 8 : 20); i++) {
    const a = rng2() * Math.PI * 2;
    const r = 8 + rng2() * 34;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    const g = FC.blob(0.32 + rng2() * 0.42, 0, .5, '#4f7434');
    FC.place(g, x, FC.terrainHeight(x, z) + 0.05, z, 1, rng2() * 6.28);
    moss.push(g);
  }
  if (moss.length) {
    const mm = new three.Mesh(FC.mergeGeos(moss), FC.matVertex({ rough: .96 }));
    mm.receiveShadow = true; this.group.add(mm);
  }
};

/* ============================================================ */
/* 池塘：低多边形水面 + 着色器涟漪（颜色跟随天气） */
FC.Terrain.prototype.buildPond = function () {
  const three = FC.THREE;
  const P = FC.POND;
  const geo = new three.CircleGeometry(P.r + 0.5, 22, 1);
  geo.rotateX(-Math.PI / 2);
  // 边界不规则化
  const pos = geo.attributes.position;
  const rng = FC.rng(9911);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z);
    if (d > 0.1) {
      const k = 1 + (rng() - .5) * 0.22;
      pos.setX(i, x * k); pos.setZ(i, z * k);
    }
  }
  geo.computeVertexNormals();

  this.waterMat = new three.ShaderMaterial({
    uniforms: {
      uTime:     { value: 0 },
      uDeep:     { value: new three.Color('#1d3b3a') },
      uShallow:  { value: new three.Color('#3d6b62') },
      uSky:      { value: new three.Color('#9dc6e0') },
      uRipple:   { value: 1 },
      uRain:     { value: 0 }
    },
    vertexShader: `
      uniform float uTime, uRipple;
      varying vec3 vPos;
      varying vec3 vN;
      void main(){
        vec3 p = position;
        p.y += sin(p.x * 1.5 + uTime * 1.15) * 0.035 * uRipple
             + sin(p.z * 1.9 - uTime * 0.86) * 0.030 * uRipple;
        vPos = p;
        // 解析法线
        float e = 0.35;
        vec3 tx = vec3(1.0, 0.0, 0.0);
        vec3 tz = vec3(0.0, 0.0, 1.0);
        float dx = (sin((p.x+e)*1.5 + uTime*1.15) - sin((p.x-e)*1.5 + uTime*1.15)) * 0.5 / e * 0.035 * uRipple;
        float dz = (sin((p.z+e)*1.9 - uTime*0.86) - sin((p.z-e)*1.9 - uTime*0.86)) * 0.5 / e * 0.030 * uRipple;
        vN = normalize(vec3(-dx, 1.0, -dz));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uDeep, uShallow, uSky;
      uniform float uTime, uRain;
      varying vec3 vPos;
      varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float fres = pow(1.0 - clamp(n.y, 0.0, 1.0), 2.2);
        // 以浅水/深水色打底，按法线变化混入天光（假高光）
        vec3 col = mix(uDeep, uShallow, clamp(n.y * 0.5 + 0.42, 0.0, 1.0));
        col = mix(col, uSky, clamp(fres * 1.15, 0.0, 0.72));
        // 雨点涟漪环
        float rip = sin(vPos.x * 5.2 + uTime * 3.0) * sin(vPos.z * 5.6 - uTime * 2.4);
        col += vec3(0.09) * max(0.0, rip) * uRain;
        gl_FragColor = vec4(col, 0.9);
      }`,
    transparent: true,
    side: three.DoubleSide
  });
  this.water = new three.Mesh(geo, this.waterMat);
  this.water.position.set(P.x, -P.depth * 0.56, P.z);
  this.water.scale.set(1, 1, 0.86);
  this.water.renderOrder = 1;
  this.group.add(this.water);
};

/* ============================================================ */
/* 河流：沿蜿蜒中心线铺一条低模水面（顶点起伏模拟流动） */
FC.Terrain.prototype.buildRiver = function () {
  const three = FC.THREE;
  const R = FC.RIVER;
  // 河面：沿中心线每 2m 一个横截面，横向 7 个采样点，覆盖 z ∈ [z0, z1]
  const verts = [], idx = [];
  const Z0 = R.z0, Z1 = R.z1, STEP = 2.2, COLS = 7;
  let row = 0;
  for (let z = Z0; z <= Z1; z += STEP, row++) {
    const cx = R.riverX(z);
    for (let k = 0; k < COLS; k++) {
      const t = k / (COLS - 1);                      // 0~1 横向
      const x = cx + (t - 0.5) * 2 * (R.halfW + 0.7); // 稍微盖过岸线
      // 河面横向边缘略微翘起，插入岸里避免露缝
      const edge = Math.abs(t - 0.5) * 2;            // 0 中心 → 1 边缘
      const y = R.waterY + edge * edge * 0.55;
      verts.push(x, y, z + (row % 2) * 0.4);         // 行间错位，破整齐感
    }
  }
  const cols = Math.round((Z1 - Z0) / STEP);
  for (let r = 0; r < cols; r++) {
    for (let k = 0; k < COLS - 1; k++) {
      const a = r * COLS + k, b = a + COLS;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // 水流方向 = 沿 z 轴（河道南北走向）
  this.riverMat = new three.ShaderMaterial({
    uniforms: {
      uTime:   { value: 0 },
      uDeep:   { value: new three.Color('#1e4f48') },
      uLite:   { value: new three.Color('#63a08a') },
      uSky:    { value: new three.Color('#9dc6e0') },
      uFlow:   { value: 1 },       // 流速视觉倍率
      uRain:   { value: 0 }
    },
    vertexShader: `
      uniform float uTime, uFlow;
      varying vec3 vPos;
      varying vec3 vN;
      void main(){
        vec3 p = position;
        // 流动：沿 -z 方向推进的两列波 + 横向小涟漪
        float flow = p.z * 0.55 + uTime * 2.3 * uFlow;
        p.y += sin(flow * 2.1 + p.x * 1.3) * 0.045
             + sin(flow * 3.7 - p.x * 2.2) * 0.028
             + sin(p.x * 3.1 + uTime * 1.4) * 0.018;
        vPos = p;
        float e = 0.3;
        float f = p.z * 0.55 + uTime * 2.3 * uFlow;
        float dx = (sin(f*2.1+(p.x+e)*1.3)-sin(f*2.1+(p.x-e)*1.3)) * 0.045 * 0.5 / e;
        float dy = (sin((p.z+e)*0.55*2.1+uTime*2.3*uFlow)-sin((p.z-e)*0.55*2.1+uTime*2.3*uFlow)) * 0.045 * 0.275 / e;
        vN = normalize(vec3(-dx, 1.0, -dy));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uDeep, uLite, uSky;
      uniform float uTime, uRain;
      varying vec3 vPos;
      varying vec3 vN;
      void main(){
        vec3 n = normalize(vN);
        float fres = pow(1.0 - clamp(n.y, 0.0, 1.0), 2.0);
        // 河心深、近岸浅
        float bank = smoothstep(0.2, 1.0, abs(fract(vPos.z * 0.0)));
        vec3 col = mix(uDeep, uLite, clamp(n.y * 0.35 + 0.34, 0.0, 1.0));
        col = mix(col, uSky, clamp(fres * 1.25, 0.0, 0.75));
        // 流动高光条（模拟阳光在水面拉出的亮带）
        float sparkle = sin(vPos.z * 2.2 - uTime * 3.4 + sin(vPos.x * 1.7 + uTime) * 1.4);
        col += vec3(0.10, 0.11, 0.09) * max(0.0, sparkle) * (0.5 + fres);
        // 雨点打在河面的细碎环纹
        float rip = sin(vPos.x * 7.3 + uTime * 5.1) * sin(vPos.z * 8.1 - uTime * 4.6);
        col += vec3(0.10) * max(0.0, rip) * uRain * 1.4;
        // 透明度：越靠近俯视中心越透，斜看反光更实（露出水下的鱼）
        float see = clamp(n.y * 1.1 - 0.25, 0.0, 1.0);
        float a = mix(0.94, 0.62, see);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    side: three.DoubleSide
  });
  this.river = new three.Mesh(geo, this.riverMat);
  this.river.renderOrder = 1;
  this.river.receiveShadow = false;
  this.group.add(this.river);

  // 岸边一排卵石（顺河走，隔几个随机丢）
  const stones = [];
  const rng = FC.rng(4711);
  for (let z = Z0 + 1.5; z < Z1 - 1.5; z += 1.1) {
    if (rng() < 0.55) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const off = R.halfW + R.bankW * (0.15 + rng() * 0.75);
    const x = R.riverX(z) + side * off;
    if (FC.blocked(x, z)) continue;
    const s = 0.14 + rng() * 0.30;
    const g = new three.IcosahedronGeometry(s, 0);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      p.setXYZ(k, p.getX(k) * (1 + (rng() - .5) * .4), p.getY(k) * 0.55, p.getZ(k) * (1 + (rng() - .5) * .4));
    }
    g.computeVertexNormals();
    FC.place(g, x, FC.terrainHeight(x, z) + s * 0.18, z, 1, rng() * 6.28);
    FC.tintGeo(g, rng() < .5 ? '#8d8678' : '#77705f');
    stones.push(g);
  }
  if (stones.length) {
    const m = new three.Mesh(FC.mergeGeos(stones), FC.matVertex({ rough: .97 }));
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }
};

/* ============================================================ */
/* 拱桥：跨在河上（z = bridgeZ）
   结构：半圆石拱圈（切向砌块）+ 拱肩挡墙 + 两端落岸的桥面 + 石栏杆
   关键：桥面高度沿 x 用"两端贴岸 + 中央抛物线起拱"剖面，保证端头真的落在岸坡上 */
FC.Terrain.prototype.buildBridge = function () {
  const three = FC.THREE;
  const R = FC.RIVER;
  const zB = R.bridgeZ;
  const cx0 = R.riverX(zB);

  // 桥全长：稍多于（水面半宽 + 岸坡带宽），端头正好压在两岸岸顶
  const span = (R.halfW + R.bankW + 0.9) * 2;
  const deckW = 2.3;                                   // 桥面宽
  const xL = cx0 - span / 2, xR = cx0 + span / 2;
  const yL = FC.terrainHeight(xL, zB);                 // 西端（空地一侧）岸面高
  const yR = FC.terrainHeight(xR, zB);                 // 东端（丘陵一侧）岸面高
  const rise = 1.1;                                    // 中央拱起量
  // 桥面顶面标高：两端贴岸，中央抛物线起拱（u∈[0,1] 沿桥长）
  const deckTop = u => yL + (yR - yL) * u + rise * 4 * u * (1 - u);

  // 拱圈：半圆，起拱线略高于水面
  const rA = R.halfW;                                  // 拱圈中线半径
  const yC = R.waterY + 0.07;                          // 起拱线标高
  const ringT = 0.5;                                   // 拱圈厚度
  const rOut = rA + ringT / 2, rIn = rA - ringT / 2;

  const geos = [];
  const STONE = ['#9a9284', '#8b8375', '#a29a8a'];
  const LITE  = '#b0a898';

  /* —— 拱圈：沿半圆砌一圈切向石块 —— */
  const arcSeg = 15;
  for (let i = 0; i < arcSeg; i++) {
    const a0 = Math.PI * (i / arcSeg), a1 = Math.PI * ((i + 1) / arcSeg);
    const am = (a0 + a1) / 2;
    const arcLen = (a1 - a0) * rA * 1.06;
    const block = new three.BoxGeometry(arcLen, ringT, deckW * 0.92);
    FC.tintGeo(block, STONE[i % STONE.length]);
    // 先绕 Z 转 (am + π/2)，把盒子的长边（局部 x）摆到圆的切线方向
    const m4 = new three.Matrix4().makeRotationZ(am + Math.PI / 2);
    m4.setPosition(cx0 + Math.cos(am) * rA, yC + Math.sin(am) * rA, zB);
    block.applyMatrix4(m4);
    geos.push(block);
  }
  /* 拱脚墩石：两端起拱处压两块大方石 */
  [-1, 1].forEach(s => {
    const bx = cx0 + s * rA;
    const b = new three.BoxGeometry(1.1, 1.3, deckW * 0.96);
    FC.tintGeo(b, STONE[1]);
    FC.place(b, bx, yC - 0.25, zB, 1, 0);
    geos.push(b);
  });

  /* —— 拱肩挡墙 + 桥面：逐段生成，墙填充拱圈/地面与桥面底之间的空隙 —— */
  const deckSegs = 11;
  const slabT = 0.24;
  for (let i = 0; i < deckSegs; i++) {
    const u0 = i / deckSegs, u1 = (i + 1) / deckSegs;
    const um = (u0 + u1) / 2;
    const x0 = cx0 - span / 2 + span * u0, x1 = cx0 - span / 2 + span * u1;
    const xm = (x0 + x1) / 2;
    const top = deckTop(um);
    const deckBot = top - slabT;

    /* 挡墙：底边取"拱圈外弧顶"或"自然地坪"，两者取上包络 */
    const dx = Math.abs(xm - cx0);
    let bottom;
    if (dx <= rOut) {
      bottom = yC + Math.sqrt(Math.max(0.01, rOut * rOut - dx * dx));
    } else {
      bottom = Math.min(FC.terrainHeight(xm, zB), deckBot - 0.05);
    }
    if (deckBot - bottom > 0.06) {
      const wall = new three.BoxGeometry((x1 - x0) * 1.01, deckBot - bottom, deckW * 0.95);
      FC.tintGeo(wall, STONE[(i + 2) % 3]);
      FC.place(wall, xm, (deckBot + bottom) / 2, zB, 1, 0);
      geos.push(wall);
    }

    /* 桥面板 */
    const slab = new three.BoxGeometry((x1 - x0) * 1.04, slabT, deckW);
    FC.tintGeo(slab, STONE[(i + 1) % 3]);
    FC.place(slab, xm, top - slabT / 2, zB, 1, 0);
    geos.push(slab);

    /* 桥面边缘压顶石（浅色窄条，增加石桥质感） */
    for (let side = -1; side <= 1; side += 2) {
      const cop = new three.BoxGeometry((x1 - x0) * 1.02, 0.09, 0.20);
      FC.tintGeo(cop, LITE);
      FC.place(cop, xm, top + 0.04, zB + side * (deckW / 2 - 0.10), 1, 0);
      geos.push(cop);
    }
  }

  /* —— 栏杆：桥面两侧矮柱 + 扶手（贴合桥面曲线） —— */
  for (let side = -1; side <= 1; side += 2) {
    const posts = 8;
    const zR = zB + side * (deckW / 2 - 0.12);
    for (let i = 0; i <= posts; i++) {
      const u = i / posts;
      const x = cx0 - span / 2 + span * u;
      const top = deckTop(u);
      const post = new three.CylinderGeometry(0.075, 0.09, 0.52, 6);
      FC.tintGeo(post, '#8b8375');
      FC.place(post, x, top + 0.28, zR, 1, 0);
      geos.push(post);
      if (i % 2 === 0) {
        const ball = new three.SphereGeometry(0.105, 6, 4);
        FC.tintGeo(ball, '#a89f8d');
        FC.place(ball, x, top + 0.58, zR, 1, 0);
        geos.push(ball);
      }
    }
    // 扶手：分 5 段折线贴桥面坡度
    for (let i = 0; i < 5; i++) {
      const u0 = i / 5, u1 = (i + 1) / 5;
      const x0 = cx0 - span / 2 + span * u0, x1 = cx0 - span / 2 + span * u1;
      const xm = (x0 + x1) / 2;
      const ym = (deckTop(u0) + deckTop(u1)) / 2 + 0.52;
      const segLen = Math.hypot(x1 - x0, deckTop(u1) - deckTop(u0)) * 1.02;
      const slope = Math.atan2(deckTop(u1) - deckTop(u0), x1 - x0);
      const rail = new three.BoxGeometry(segLen, 0.07, 0.10);
      FC.tintGeo(rail, '#9a9284');
      // 先绕 Z 倾斜，再平移到目标位置
      const mr = new three.Matrix4().makeRotationZ(slope);
      mr.setPosition(xm, ym, zR);
      rail.applyMatrix4(mr);
      geos.push(rail);
    }
  }

  /* —— 两端引桥护坡石（压住桥台与岸坡交界） —— */
  [-1, 1].forEach(s => {
    const x = cx0 + s * (span / 2 + 0.3);
    const y = FC.terrainHeight(x, zB);
    for (let k = 0; k < 4; k++) {
      const st = new three.IcosahedronGeometry(0.26 + (k % 2) * 0.14, 0);
      FC.tintGeo(st, STONE[k % 3]);
      FC.place(st, x + s * k * 0.32, y + 0.08, zB + (k - 1.5) * 0.5, 1, k * 1.3);
      geos.push(st);
    }
  });

  const m = new three.Mesh(FC.mergeGeos(geos), FC.matVertex({ rough: .94 }));
  m.castShadow = true; m.receiveShadow = true;
  this.group.add(m);
  this.bridge = m;

  // 供生物/音频使用的取水点与桥面信息
  this.bridgeInfo = { x: cx0, z: zB, span, deckY: deckTop(0.5), deckW, yL, yR };
};

/* ============================================================ */
/* 水草：河道两岸水线内外，长条叶随"水流+风"摆动（复用全局风 uniform） */
FC.Terrain.prototype.buildRiverWeeds = function () {
  const three = FC.THREE;
  const R = FC.RIVER;
  const N = this.quality === 'low' ? 60 : 150;
  const verts = [], cols = [], idx = [];
  const rng = FC.rng(8264);
  const c1 = new three.Color('#2f5d3a'), c2 = new three.Color('#4a7d4a'), c3 = new three.Color('#5f9455');
  let vo = 0;
  let placed = 0, guard = 0;
  while (placed < N && guard < N * 20) {
    guard++;
    const z = R.z0 + 1.2 + rng() * (R.z1 - R.z0 - 2.4);
    const side = rng() < 0.5 ? -1 : 1;
    // 水线内外：off ∈ [-0.5(水下) ~ +1.2(湿岸)]
    const offF = -0.35 + rng() * 1.45;
    const x = R.riverX(z) + side * (R.halfW + offF);
    const y = FC.terrainHeight(x, z);
    // 水下的要贴河床，岸上的贴地面 —— terrainHeight 已保证
    if (y > R.waterY + 0.75) continue;            // 太高处的不要（限制了只在岸边一条带）
    const scale = 0.8 + rng() * 1.0;
    const clumps = 2 + (rng() * 2 | 0);
    for (let b = 0; b < clumps; b++) {
      const ba = rng() * 6.28;
      const bx = x + Math.cos(ba) * 0.14, bz = z + Math.sin(ba) * 0.14;
      const hh = (0.35 + rng() * 0.5) * scale;
      const w0 = 0.035 * scale;
      const lean = (rng() - .5) * 0.5;
      const dx = Math.cos(ba + 1.57) * lean, dz = Math.sin(ba + 1.57) * lean;
      const tx = bx + dx * hh, tz = bz + dz * hh;
      const px = -Math.sin(ba), pz = Math.cos(ba);
      const c = rng() < .4 ? c1 : (rng() < .7 ? c2 : c3);
      const cTip = c.clone().offsetHSL(0.01, 0, 0.12);
      const put = (X, Y, Z, C) => {
        verts.push(X, Y, Z);
        cols.push(C.r, C.g, C.b);
        vo++;
      };
      put(bx - px * w0, y, bz - pz * w0, c);
      put(bx + px * w0, y, bz + pz * w0, c);
      put(tx + px * w0 * 0.2, y + hh, tz + pz * w0 * 0.2, cTip);
      put(tx - px * w0 * 0.2, y + hh, tz - pz * w0 * 0.2, cTip);
      const o = vo - 4;
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    placed++;
  }
  const geo = new three.BufferGeometry();
  geo.setAttribute('position', new three.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new three.Float32BufferAttribute(cols, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  // 水草的摆动：与草甸同一套全局风 uniform，但相位用顶点 xz —— 顶点风注入方式一致即可
  this.weedMat = new three.MeshStandardMaterial({
    vertexColors: true, roughness: .9, metalness: 0, side: three.DoubleSide
  });
  FC.applyWind(this.weedMat, 0.5, 1.7, -0.6, 0.5);   // 幅度中等，水边柔摆
  const m = new three.Mesh(geo, this.weedMat);
  m.receiveShadow = true;
  this.group.add(m);
};

/* ============================================================ */
/* 蘑菇 / 蕨类 / 倒木：靠近小屋与路径的细节 */
FC.Terrain.prototype.buildDetails = function () {
  const three = FC.THREE;
  const rng = FC.rng(3701);

  /* --- 蘑菇 --- */
  const shrooms = [];
  const CAP = ['#c94a3c', '#d9694a', '#e0cdb4', '#8d5a3c'];
  for (let i = 0; i < (this.quality === 'low' ? 14 : 34); i++) {
    const a = rng() * 6.28, r = 4 + rng() * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    if (this.distToPath(x, z) < 1.0) continue;
    const y = FC.terrainHeight(x, z);
    const s = 0.6 + rng() * 0.9;
    const stem = new three.CylinderGeometry(0.055 * s, 0.075 * s, 0.26 * s, 6);
    FC.place(stem, x, y + 0.13 * s, z, 1, rng() * 6.28);
    FC.tintGeo(stem, '#e8dcc4');
    shrooms.push(stem);
    const cap = new three.SphereGeometry(0.16 * s, 7, 4, 0, 6.28, 0, Math.PI * 0.54);
    FC.place(cap, x, y + 0.27 * s, z, 1, rng() * 6.28);
    FC.tintGeo(cap, CAP[(rng() * CAP.length) | 0]);
    shrooms.push(cap);
  }
  if (shrooms.length) {
    const m = new three.Mesh(FC.mergeGeos(shrooms), FC.matVertex({ rough: .88 }));
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }

  /* --- 蕨类 / 大叶杂草（比草更高更有形） --- */
  const ferns = [];
  const rng3 = FC.rng(3702);
  for (let i = 0; i < (this.quality === 'low' ? 26 : 62); i++) {
    const a = rng3() * 6.28, r = 4.5 + Math.pow(rng3(), .7) * 36;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    if (this.distToPath(x, z) < 1.15) continue;
    const y = FC.terrainHeight(x, z);
    const s = 0.7 + rng3() * 0.9;
    for (let b = 0; b < 5; b++) {
      const ba = (b / 5) * 6.28 + rng3() * 0.6;
      const leaf = new three.ConeGeometry(0.13 * s, 0.85 * s, 3);
      const g = leaf.clone();
      FC.place(g, x + Math.cos(ba) * 0.1, y + 0.36 * s, z + Math.sin(ba) * 0.1, 1, 0, 0);
      // 向外张开
      const m4 = new three.Matrix4().makeRotationAxis(new three.Vector3(Math.cos(ba), 0, Math.sin(ba)).cross(new three.Vector3(0, 1, 0)).normalize(), 0.62);
      g.applyMatrix4(m4);
      g.translate(Math.cos(ba) * 0.18 * s, 0, Math.sin(ba) * 0.18 * s);
      FC.tintGeo(g, rng3() < .5 ? '#3f6b30' : '#4d7a38');
      ferns.push(g);
    }
  }
  if (ferns.length) {
    const m = new three.Mesh(FC.mergeGeos(ferns), FC.matVertex({ rough: .95 }));
    m.castShadow = true;
    this.group.add(m);
  }

  /* --- 倒木 --- */
  const logs = [];
  const rng4 = FC.rng(3703);
  for (let i = 0; i < 5; i++) {
    const a = 0.4 + rng4() * 5.6, r = 15 + rng4() * 24;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    // 别把倒木丢进玫瑰花海和主路上（会显得像泥堆）
    if (FC.inClearing(x, z, 1.05)) continue;
    if (this.distToPath(x, z) < 2.6) continue;
    const len = 2.8 + rng4() * 2.6, rad = 0.22 + rng4() * 0.16;
    const g = new three.CylinderGeometry(rad * 0.86, rad, len, 8);
    g.rotateZ(Math.PI / 2);
    const ry = rng4() * 3.14;
    const m4 = new three.Matrix4().makeRotationY(ry);
    g.applyMatrix4(m4);
    g.translate(x, FC.terrainHeight(x, z) + rad * 0.85, z);
    FC.tintGeo(g, '#6b5238');
    logs.push(g);
    // 苔藓
    for (let k = 0; k < 4; k++) {
      const t = (rng4() - .5) * len * 0.8;
      const mg = FC.blob(rad * (0.5 + rng4() * .5), 0, .5, '#51793a');
      FC.place(mg, x + Math.cos(ry) * t, FC.terrainHeight(x, z) + rad * 1.35, z - Math.sin(ry) * t, 1, rng4() * 6.28);
      logs.push(mg);
    }
  }
  if (logs.length) {
    const m = new three.Mesh(FC.mergeGeos(logs), FC.matVertex({ rough: .97 }));
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
  }
};

/* ============================================================ */
FC.Terrain.prototype.update = function (dt, env) {
  this.time += dt;
  if (this.waterMat) {
    const u = this.waterMat.uniforms;
    u.uTime.value = this.time;
    u.uRain.value = env.cur.rain;
    u.uSky.value.copy(env.cur.skyMid);
    u.uShallow.value.set('#3d6b62').lerp(new FC.THREE.Color(env.cur.fogColor), 0.18);
    u.uDeep.value.set(env.cur.ambIntensity > 0.55 ? '#1d3b3a' : '#131f28');
  }
  if (this.riverMat) {
    const u = this.riverMat.uniforms;
    u.uTime.value = this.time;
    u.uRain.value = env.cur.rain;
    u.uSky.value.copy(env.cur.skyMid);
    // 天色：白天清亮绿松石，入夜压暗
    const night = FC.clamp(1 - env.cur.ambIntensity / 0.55, 0, 1);
    u.uDeep.value.set('#1e4f48').lerp(new FC.THREE.Color('#0d1e20'), night * 0.85);
    u.uLite.value.set('#63a08a').lerp(new FC.THREE.Color('#1a3032'), night * 0.8);
  }
};
