/* ============================================================
   vegetation.js —— 植被系统
   ① 森林：针叶乔木 + 阔叶乔木 + 白桦（环绕小屋，形成画框）
   ② 空地：玫瑰花海 + 低矮杂草（小屋正前方）
   ③ 藤蔓：爬在小屋墙上的蔷薇
   ④ 风吹效果：通过注入顶点着色器实现
   ============================================================ */

/* ---------- 全局风参数（所有植被共享） ---------- */
FC.windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new FC.THREE.Vector2(0.55, 0.2) }
};

/* ---------- 给材质注入风动 ----------
   amp：摆幅（世界单位）   freq：频率
   y0/y1：从哪个高度开始受力、到哪个高度达到满幅
   ⚠️ 只在专用材质上调用，避免污染共用缓存材质 */
FC.applyWind = function (mat, amp, freq, y0, y1) {
  const key = 'wind_' + amp + '_' + freq + '_' + y0 + '_' + y1;
  mat.onBeforeCompile = function (shader) {
    shader.uniforms.uTime = FC.windUniforms.uTime;
    shader.uniforms.uWind = FC.windUniforms.uWind;
    shader.vertexShader =
      'uniform float uTime;\nuniform vec2 uWind;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      [
        '#include <begin_vertex>',
        // ⚠️ 合并几何后 modelMatrix 都是原点 → 必须用"顶点自身位置"做相位种子，
        // 否则所有树会整齐同步摆动（很假）
        'float wph = position.x * 0.41 + position.z * 0.33 + position.y * 0.07;',
        'float sway = sin(uTime * ' + freq.toFixed(2) + ' + wph)',
        '           + sin(uTime * ' + (freq * 1.73).toFixed(2) + ' + wph * 1.9) * 0.45;',
        'float hFac = clamp((position.y - ' + y0.toFixed(2) + ') / ' + Math.max(0.01, y1 - y0).toFixed(2) + ', 0.0, 1.0);',
        'hFac = hFac * hFac;',
        'transformed.x += uWind.x * sway * ' + amp.toFixed(3) + ' * hFac;',
        'transformed.z += uWind.y * sway * ' + amp.toFixed(3) + ' * hFac;'
      ].join('\n')
    );
  };
  mat.customProgramCacheKey = function () { return key; };
  return mat;
};
/* 每帧由 main 调用推进风时间 */
FC.updateWind = function (dt, env) {
  FC.windUniforms.uTime.value += dt;
  const w = FC.windUniforms.uWind.value;
  w.x = FC.damp(w.x, env.cur.windX, 1.6, dt);
  w.y = FC.damp(w.y, env.cur.windZ, 1.6, dt);
  // 阵风脉动
  const g = 1 + 0.32 * Math.sin(FC.windUniforms.uTime.value * 0.44);
  FC._gust = g;
};

/* ---------- 空地范围（小屋正前方的玫瑰花园区） ---------- */
FC.CLEARING = { cx: 0, cz: 10.8, rx: 15.6, rz: 9.6 };
FC.inClearing = function (x, z, shrink) {
  const s = shrink === undefined ? 1 : shrink;
  const dx = (x - FC.CLEARING.cx) / (FC.CLEARING.rx * s);
  const dz = (z - FC.CLEARING.cz) / (FC.CLEARING.rz * s);
  return dx * dx + dz * dz < 1;
};

/* ============================================================ */
FC.Vegetation = function (scene, terrain, quality) {
  const three = FC.THREE;
  this.scene = scene;
  this.terrain = terrain;
  this.quality = quality || 'mid';
  this.group = new three.Group();
  this.group.name = 'vegetation';
  scene.add(this.group);
  this.trees = [];            // {x,z,h} 供小动物站上去
  this.time = 0;

  this.buildTrees();
  this.buildRosery();
  this.buildWeeds();
  this.buildVines();
  this.buildFallenLeaves();
};

/* ============================================================
   ① 森林
   ============================================================ */
FC.Vegetation.prototype.buildTrees = function () {
  const three = FC.THREE;
  const q = this.quality;
  const counts = { conifer: q === 'low' ? 46 : (q === 'mid' ? 96 : 150),
                   broad:   q === 'low' ? 22 : (q === 'mid' ? 46 : 74),
                   birch:   q === 'low' ? 8  : (q === 'mid' ? 16 : 26) };
  const trunks = [];
  const canopies = [];
  const rng = FC.rng(1123);

  /* --- 模板（克隆远快于重建几何） --- */
  const trunkTmpl = new three.CylinderGeometry(0.34, 0.5, 1, 6, 1);
  trunkTmpl.translate(0, 0.5, 0);        // 底部对齐原点

  const coniferTmpl = FC.cone(1, 1, 7, 0.12);
  coniferTmpl.translate(0, 0.5, 0);
  const blobTmpl = FC.blob(1, 1, 0.36);

  const put = (arr, tmpl, x, y, z, sx, sy, sz, ry, hex) => {
    const g = tmpl.clone();
    const m = new three.Matrix4();
    m.compose(
      new three.Vector3(x, y, z),
      new three.Quaternion().setFromEuler(new three.Euler(0, ry, 0)),
      new three.Vector3(sx, sy, sz)
    );
    g.applyMatrix4(m);
    FC.tintGeo(g, hex);
    arr.push(g);
    return g;
  };

  const mkTree = (kind, x, z) => {
    const y = FC.terrainHeight(x, z);
    const ry = rng() * 6.28;
    if (kind === 'conifer') {
      /* 针叶乔木：参考图里是"尖耸细高的冷杉"——
         层数多、半径小、整体瘦高，这是森林气质的核心 */
      const h = 9.5 + rng() * 14;
      const tr = 0.15 + h * 0.019;
      const R = h * (0.128 + rng() * 0.032);          // 底部冠幅半径
      put(trunks, trunkTmpl, x, y, z, tr, h * 0.52, tr, ry,
          rng() < .5 ? FC.PAL.trunk : FC.PAL.trunkLite);
      const layers = 6 + (rng() * 4 | 0);
      const cBase = [FC.PAL.pine1, FC.PAL.pine2, FC.PAL.pine3];
      for (let i = 0; i < layers; i++) {
        const t = i / (layers - 1);                   // 0 → 1
        const r = R * (1 - t * 0.84);
        const lh = (h * 0.98) / layers * 1.58;
        const cy = h * 0.10 + t * (h * 0.86);
        put(canopies, coniferTmpl, x, y + cy, z, r, lh, r, ry + i * 0.62,
            cBase[(i + (rng() * 2 | 0)) % 3]);
      }
      this.trees.push({ x, z, y, h, kind });
    } else if (kind === 'broad') {
      /* 阔叶乔木：球形树冠团块，部分带金黄秋色 */
      const h = 7 + rng() * 10.5;
      const tr = 0.22 + h * 0.032;
      put(trunks, trunkTmpl, x, y, z, tr, h * 0.6, tr, ry, FC.PAL.trunk);
      // 主枝
      for (let i = 0; i < 3; i++) {
        const a = ry + i * 2.09 + rng() * .6;
        const b = new three.CylinderGeometry(tr * .2, tr * .62, h * .34, 5);
        b.translate(0, h * .17, 0);
        const g = b.clone();
        const mm = new three.Matrix4().compose(
          new three.Vector3(x, y + h * 0.52, z),
          new three.Quaternion().setFromEuler(new three.Euler(0.55 * Math.cos(a), 0, -0.55 * Math.sin(a))),
          new three.Vector3(1, 1, 1));
        g.applyMatrix4(mm);
        FC.tintGeo(g, FC.PAL.trunkLite);
        trunks.push(g);
      }
      const gold = rng() < 0.16;
      const greens = gold ? [FC.PAL.leafGold, '#d8b44e', '#b8912f']
                          : [FC.PAL.leaf1, FC.PAL.leaf2, FC.PAL.leaf3];
      const blobs = 3 + (rng() * 3 | 0);
      const cr = h * 0.30;
      for (let i = 0; i < blobs; i++) {
        const a = rng() * 6.28, rr = rng() * h * 0.20;
        const bx = x + Math.cos(a) * rr, bz = z + Math.sin(a) * rr;
        const by = y + h * (0.58 + rng() * 0.26);
        const s = cr * (0.72 + rng() * 0.56);
        put(canopies, blobTmpl, bx, by, bz, s, s * (0.82 + rng() * .3), s, rng() * 6.28,
            greens[(rng() * greens.length) | 0]);
      }
      this.trees.push({ x, z, y, h, kind });
    } else {
      /* 白桦：浅色树干 */
      const h = 7 + rng() * 8;
      const tr = 0.15 + h * 0.020;
      put(trunks, trunkTmpl, x, y, z, tr, h * 0.72, tr, ry, '#d8d2c4');
      const blobs = 3 + (rng() * 2 | 0);
      for (let i = 0; i < blobs; i++) {
        const a = rng() * 6.28, rr = rng() * h * 0.14;
        const s = h * 0.20 * (0.75 + rng() * .5);
        put(canopies, blobTmpl,
            x + Math.cos(a) * rr, y + h * (0.70 + rng() * .22), z + Math.sin(a) * rr,
            s, s * .9, s, rng() * 6.28,
            rng() < .4 ? '#7ba552' : '#8fb85e');
      }
      this.trees.push({ x, z, y, h, kind });
    }
  };

  /* --- 布局：环形森林，避开小屋 / 空地 / 小径 --- */
  const canPlace = (x, z) => {
    if (FC.blocked(x, z)) return false;
    if (FC.inClearing(x, z, 1.12)) return false;                  // 空地不种大树
    if (this.terrain.distToPath(x, z) < 2.0) return false;        // 让开小路
    // 小屋左右两侧留出"画框"位置：紧邻但不成排
    if (Math.abs(x) < 9 && z > 1.6 && z < 24) return false;
    return true;
  };
  const tryPlace = (kind, rMin, rMax, rPow) => {
    let guard = 0;
    while (guard++ < 60) {
      const a = rng() * 6.28;
      const r = rMin + Math.pow(rng(), rPow || .6) * (rMax - rMin);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (!canPlace(x, z)) continue;
      // 最小间距，避免扎堆
      let ok = true;
      for (let i = this.trees.length - 1; i >= 0 && i > this.trees.length - 26; i--) {
        const t = this.trees[i];
        if ((t.x - x) ** 2 + (t.z - z) ** 2 < 9.5) { ok = false; break; }
      }
      if (!ok) continue;
      mkTree(kind, x, z);
      return true;
    }
    return false;
  };

  /* 近景一圈（形成画框的密林） */
  for (let i = 0; i < counts.conifer * 0.42; i++) tryPlace('conifer', 13, 34, .75);
  for (let i = 0; i < counts.broad * 0.55; i++)   tryPlace('broad', 13, 32, .75);
  /* 中远景 */
  for (let i = 0; i < counts.conifer * 0.58; i++) tryPlace('conifer', 30, 92, .8);
  for (let i = 0; i < counts.broad * 0.45; i++)   tryPlace('broad', 28, 82, .8);
  for (let i = 0; i < counts.birch; i++)          tryPlace('birch', 22, 70, .85);

  /* 近景框景大树：参考图里小屋左右两侧各有一根粗树干紧贴画面边缘，
     这是整个构图"被森林抱住"的关键，所以这几棵要突破常规放置限制 */
  const FRAME_TREES = [
    [-8.4, 4.6, 'broad'], [8.8, 4.2, 'broad'],
    [-12.2, 10.6, 'conifer'], [12.6, 10.0, 'conifer'],
    [-6.2, 16.4, 'broad'], [6.6, 16.0, 'broad']
  ];
  FRAME_TREES.forEach(ft => {
    mkTree(ft[2], ft[0], ft[1]);
  });

  /* --- 合并输出 --- */
  this.trunkMesh = new three.Mesh(FC.mergeGeos(trunks), FC.matVertex({ rough: .95 }));
  this.trunkMesh.castShadow = true; this.trunkMesh.receiveShadow = true;
  this.group.add(this.trunkMesh);

  this.canopyMat = new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: .93, metalness: 0
  });
  FC.applyWind(this.canopyMat, 0.16, 0.85, 1.2, 13.0);
  this.canopyMesh = new three.Mesh(FC.mergeGeos(canopies), this.canopyMat);
  this.canopyMesh.castShadow = true; this.canopyMesh.receiveShadow = true;
  this.canopyMesh.name = 'canopy';
  this.group.add(this.canopyMesh);
};

/* ============================================================
   ② 玫瑰花海 + 低矮杂草
   ============================================================ */
FC.Vegetation.prototype.buildRosery = function () {
  const three = FC.THREE;
  const q = this.quality;
  const BUSH = q === 'low' ? 240 : (q === 'mid' ? 560 : 860);
  const rng = FC.rng(8899);

  const bushGeos = [];
  const flowerGeos = [];
  const coreGeos  = [];
  const stemGeos  = [];

  const leafOrig = new three.IcosahedronGeometry(1, 0);
  const petalOrig = new three.IcosahedronGeometry(1, 0);
  const coreOrig = new three.SphereGeometry(1, 6, 4);
  const stemOrig = new three.CylinderGeometry(0.022, 0.03, 1, 4);
  stemOrig.translate(0, 0.5, 0);

  const put = (arr, tmpl, x, y, z, sx, sy, sz, ry, hex) => {
    const g = tmpl.clone();
    const m = new three.Matrix4().compose(
      new three.Vector3(x, y, z),
      new three.Quaternion().setFromEuler(new three.Euler(0, ry, 0)),
      new three.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    FC.tintGeo(g, hex);
    arr.push(g);
  };

  const pickRose = (r) => {
    const tot = ROSE_W.reduce((a, b) => a + b, 0);
    let v = r() * tot;
    for (let i = 0; i < ROSE.length; i++) { v -= ROSE_W[i]; if (v <= 0) return ROSE[i]; }
    return ROSE[0];
  };
  const LEAF = [FC.PAL.roseLeaf, '#4a7a36', '#356028', '#567f37'];
  /* 玫瑰配色：以饱和的深红/玫红为主
     ⚠️ 原先偏浅（coral/pink 权重高），再叠加强光与天空半球光把顶面花瓣打亮，
     阳光下整片花海会"退色"成粉白。这里把基色整体压深、砍掉最浅的两档，
     只留一档亮粉做点缀，才能在晴天仍读作"浓艳的玫瑰海"。 */
  const ROSE = ['#b81f3d', '#a81c38', '#c8264a', '#8e1f37',
                '#d1324f', '#9c2440', '#e04a63', '#e88aa0'];
  const ROSE_W = [3, 3, 2, 3, 2, 2, 1, 1];      // 权重：饱和深色占绝大多数
  const ROSE_CORE = ['#6d1028', '#7d1730', '#8e1f37', '#c8364f'];

  let placed = 0, guard = 0;
  while (placed < BUSH && guard < BUSH * 26) {
    guard++;
    // 椭圆内均匀取点
    const a = rng() * 6.28;
    const r = Math.sqrt(rng());
    const x = FC.CLEARING.cx + Math.cos(a) * r * FC.CLEARING.rx;
    const z = FC.CLEARING.cz + Math.sin(a) * r * FC.CLEARING.rz;
    if (FC.blocked(x, z)) continue;
    if (this.terrain.distToPath(x, z) < 1.15) continue;      // 小径上不长花
    if (z < 3.5) continue;                                    // 台阶前留出通路
    // 距中心越近越密（视觉焦点）
    const dc = Math.hypot(x / FC.CLEARING.rx, (z - FC.CLEARING.cz) / FC.CLEARING.rz);
    if (dc > 0.45 && rng() < dc * 0.42) continue;

    const y = FC.terrainHeight(x, z);
    const s = 0.68 + rng() * 0.62;               // 株高比例

    /* 花丛叶子：3~5 个团块 */
    const nb = 5 + (rng() * 4 | 0);
    for (let i = 0; i < nb; i++) {
      const ang = rng() * 6.28, rr = rng() * 0.30 * s;
      const lx = x + Math.cos(ang) * rr, lz = z + Math.sin(ang) * rr;
      const sc = (0.145 + rng() * 0.115) * s;
      put(bushGeos, leafOrig, lx, y + sc * 0.50, lz,
          sc, sc * 0.62, sc, rng() * 6.28, LEAF[(rng() * LEAF.length) | 0]);
    }
    /* 玫瑰花朵 */
    const nf = 3 + (rng() * 5 | 0);
    const tone = pickRose(rng);
    for (let i = 0; i < nf; i++) {
      const ang = rng() * 6.28, rr = rng() * 0.34 * s;
      const fx = x + Math.cos(ang) * rr, fz = z + Math.sin(ang) * rr;
      const fh = (0.30 + rng() * 0.26) * s;      // 花高
      const fs = (0.115 + rng() * 0.080) * s;    // 花半径（放大，参考图的花头很饱满）
      put(stemGeos, stemOrig, fx, y + 0.02, fz, 1, fh, 1, 0, '#3f6b30');
      // 花瓣：两三层小面片堆成球状花头（平面着色 → 低模玫瑰感）
      const pt = (rng() < 0.22) ? ROSE[(rng() * ROSE.length) | 0] : tone;
      put(flowerGeos, petalOrig, fx, y + fh, fz, fs * 1.10, fs * 0.88, fs * 1.10, rng() * 6.28, pt);
      put(flowerGeos, petalOrig, fx, y + fh + fs * 0.46, fz, fs * 0.84, fs * 0.64, fs * 0.84, rng() * 6.28, pt);
      // 花芯：更深一色，形成"开口"感
      put(coreGeos, coreOrig, fx, y + fh + fs * 0.66, fz, fs * 0.40, fs * 0.30, fs * 0.40, 0,
          ROSE_CORE[(rng() * ROSE_CORE.length) | 0]);
    }
    /* 花蕾 */
    if (rng() < 0.45) {
      const ang = rng() * 6.28, rr = (0.2 + rng() * 0.4) * s;
      const bud = (0.062 + rng() * 0.038) * s;
      put(flowerGeos, petalOrig, x + Math.cos(ang) * rr, y + (0.3 + rng() * .2) * s,
          z + Math.sin(ang) * rr, bud, bud * 1.5, bud, rng() * 6.28, tone);
    }
    placed++;
  }

  /* 花丛（叶）—— 受风，摆幅小 */
  this.roseLeafMat = new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: .92, metalness: 0
  });
  FC.applyWind(this.roseLeafMat, 0.075, 1.05, 0.05, 0.62);
  this.roseLeaves = new three.Mesh(FC.mergeGeos(bushGeos), this.roseLeafMat);
  this.roseLeaves.castShadow = true; this.roseLeaves.receiveShadow = true;
  this.group.add(this.roseLeaves);

  /* 花瓣 —— 轻微受风（更柔软） */
  this.petalMat = new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: .78, metalness: 0
  });
  FC.applyWind(this.petalMat, 0.10, 1.35, 0.2, 0.85);
  this.petals = new three.Mesh(FC.mergeGeos(flowerGeos), this.petalMat);
  this.petals.castShadow = true;
  this.group.add(this.petals);

  /* 花芯 + 花茎 */
  this.roseCoreMesh = new three.Mesh(FC.mergeGeos(coreGeos.concat(stemGeos)), FC.matVertex({ rough: .86 }));
  this.roseCoreMesh.castShadow = true;
  this.group.add(this.roseCoreMesh);

  /* 花丛自发光：夜晚 / 阴天时让花色在暗环境里仍可辨认（微弱） */
  this.petalMat.emissive = new three.Color('#2a0d14');
  this.petalMat.emissiveIntensity = 0.0;
};

/* ============================================================
   ③ 低矮杂草 + 小黄花（点缀在玫瑰之间）
   ============================================================ */
FC.Vegetation.prototype.buildWeeds = function () {
  const three = FC.THREE;
  const q = this.quality;
  const N = q === 'low' ? 520 : (q === 'mid' ? 1250 : 2000);
  const rng = FC.rng(4321);

  const geos = [];
  const tus = new three.ConeGeometry(1, 1, 3);
  tus.translate(0, 0.5, 0);
  const bloom = new three.IcosahedronGeometry(1, 0);

  const put = (arr, tmpl, x, y, z, sx, sy, sz, ry, hex) => {
    const g = tmpl.clone();
    const m = new three.Matrix4().compose(
      new three.Vector3(x, y, z),
      new three.Quaternion().setFromEuler(new three.Euler(0, ry, 0)),
      new three.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    FC.tintGeo(g, hex);
    arr.push(g);
  };

  const DRY = ['#7f8a4c', '#8f9450', '#6d7c42'];
  const WEED = ['#4a7233', '#5b8740', '#6d9b48', '#3f6629'];
  const FLOWER = [FC.PAL.dasiyYellow, '#f5d75c', '#e8c94a', '#f2e6a8'];

  let placed = 0, guard = 0;
  while (placed < N && guard < N * 24) {
    guard++;
    let x, z;
    const pick2 = rng();
    if (pick2 < 0.72) {
      // 落在玫瑰花园区内
      const a = rng() * 6.28, r = Math.sqrt(rng());
      x = FC.CLEARING.cx + Math.cos(a) * r * FC.CLEARING.rx * 1.06;
      z = FC.CLEARING.cz + Math.sin(a) * r * FC.CLEARING.rz * 1.06;
    } else {
      // 撒在附近林地里
      const a = rng() * 6.28, r = 6 + Math.pow(rng(), .62) * 26;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    if (FC.blocked(x, z)) continue;
    if (this.terrain.distToPath(x, z) < 0.9) continue;
    if (z < 3.3) continue;
    const y = FC.terrainHeight(x, z);
    const s = 0.5 + rng() * 0.75;
    const dry = rng() < 0.22;
    const tone = dry ? DRY[(rng() * 3) | 0] : WEED[(rng() * WEED.length) | 0];

    /* 一丛 3 片窄叶 */
    for (let i = 0; i < 3; i++) {
      const ba = rng() * 6.28;
      const hh = (0.22 + rng() * 0.34) * s;
      const ww = (0.035 + rng() * 0.028) * s;
      const g = tus.clone();
      const m = new three.Matrix4().compose(
        new three.Vector3(x + Math.cos(ba) * 0.06 * s, y, z + Math.sin(ba) * 0.06 * s),
        new three.Quaternion().setFromEuler(new three.Euler(
          Math.sin(ba) * 0.30, ba, Math.cos(ba) * -0.30)),
        new three.Vector3(ww, hh, ww));
      g.applyMatrix4(m);
      FC.tintGeo(g, tone);
      geos.push(g);
    }
    /* 偶尔开一朵小花（参考图里那片金黄花海） */
    if (rng() < (dry ? 0.06 : 0.17)) {
      const fh = (0.24 + rng() * 0.3) * s;
      const fs = (0.048 + rng() * 0.034) * s;
      put(geos, bloom, x, y + fh, z, fs * 2.4, fs * 0.72, fs * 2.4, rng() * 6.28,
          FLOWER[(rng() * FLOWER.length) | 0]);
    }
    placed++;
  }

  this.weedMat = new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: .95, metalness: 0, side: three.DoubleSide
  });
  FC.applyWind(this.weedMat, 0.085, 1.25, 0.04, 0.5);
  this.weeds = new three.Mesh(FC.mergeGeos(geos), this.weedMat);
  this.weeds.castShadow = true; this.weeds.receiveShadow = true;
  this.weeds.name = 'weeds';
  this.group.add(this.weeds);
};

/* ============================================================
   ④ 爬在小屋墙上的蔷薇（藤蔓）
   ============================================================ */
FC.Vegetation.prototype.buildVines = function () {
  const three = FC.THREE;
  const rng = FC.rng(6677);
  const geos = [];
  const blooms = [];
  const leafOrig = new three.IcosahedronGeometry(1, 0);

  /* 小屋尺寸必须与 cabin.js 保持一致（W=3.90, D=2.95, 墙高 2.86） */
  const W = 3.86, D = 2.92, H = 2.80;

  /* ⚠️ 原来的写法是 x += sin(...)*0.19，累加后藤蔓会横向漂移好几米、
     横跨整面墙。正确做法是围绕基点"振荡"，所以这里保留 baseX。 */
  const runs = [
    { baseX: -W + 0.35, z: D + 0.05, dir: 1 },     // 前墙左侧
    { baseX:  W - 0.35, z: D + 0.05, dir: -1 },    // 前墙右侧
    { baseX:  W + 0.05, z: 1.05,    dir: 1, axis: 'x' }   // 右侧墙（沿 Z 蔓延）
  ];

  runs.forEach(run => {
    let x = run.baseX, y = -0.10, z = run.z;
    const steps = 30;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      y += H / steps * 0.95;
      // 振荡而不是累加 —— 幅度控制在 ±0.3 内，紧贴墙面
      const sway = Math.sin(t * 4.6 + run.dir * 1.7) * 0.30;
      if (run.axis === 'x') {
        z = run.z + t * (H * 0.62) + Math.sin(t * 3.4) * 0.22;
        x = run.baseX - t * 0.16;
      } else {
        x = run.baseX + sway * run.dir;
        z = run.z + Math.cos(t * 3.1) * 0.05;
      }

      // 主茎
      const seg = new three.CylinderGeometry(0.020, 0.026, 0.17, 4);
      seg.translate(0, 0.085, 0);
      const m = new three.Matrix4().compose(
        new three.Vector3(x, y, z),
        new three.Quaternion().setFromEuler(new three.Euler(0, rng() * 6.28, (rng() - .5) * .5)),
        new three.Vector3(1, 1, 1));
      seg.applyMatrix4(m);
      FC.tintGeo(seg, '#4b5c33');
      geos.push(seg);

      // 叶片
      const nl = 1 + (rng() * 2 | 0);
      for (let k = 0; k < nl; k++) {
        const a = rng() * 6.28;
        const s = 0.055 + rng() * 0.05;
        const g = leafOrig.clone();
        const mm = new three.Matrix4().compose(
          new three.Vector3(x + Math.cos(a) * 0.11, y + (rng() - .5) * .14, z + Math.sin(a) * 0.09 + 0.04),
          new three.Quaternion().setFromEuler(new three.Euler(rng() * 1.5, a, rng() * 1.5)),
          new three.Vector3(s, s * 0.72, s));
        g.applyMatrix4(mm);
        FC.tintGeo(g, rng() < .5 ? '#3f6b30' : '#4d7d39');
        geos.push(g);
      }
      // 花朵
      if (rng() < 0.32) {
        const s = 0.062 + rng() * 0.042;
        const g = leafOrig.clone();
        const mm = new three.Matrix4().compose(
          new three.Vector3(x + (rng() - .5) * 0.22, y + (rng() - .5) * .12, z + 0.07 + rng() * .05),
          new three.Quaternion().setFromEuler(new three.Euler(rng() * 6.28, rng() * 6.28, 0)),
          new three.Vector3(s, s * 0.85, s));
        g.applyMatrix4(mm);
        FC.tintGeo(g, [FC.PAL.roseRed, FC.PAL.rosePink, '#e8b0be', FC.PAL.roseDeep][(rng() * 4) | 0]);
        blooms.push(g);
      }
    }
  });

  /* 门框上方的花拱（尺度同步到新门宽 1.24、墙高 2.86） */
  const archW = 0.95, archY = 2.62, archZ = D + 0.16;
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const a = Math.PI * t;
    const ax = -archW * Math.cos(a), ay = archY + Math.sin(a) * 0.62, az = archZ;
    const s = 0.055 + rng() * 0.05;
    const g = leafOrig.clone();
    const mm = new three.Matrix4().compose(
      new three.Vector3(ax, ay, az),
      new three.Quaternion().setFromEuler(new three.Euler(rng() * 6.28, rng() * 6.28, 0)),
      new three.Vector3(s, s, s));
    g.applyMatrix4(mm);
    FC.tintGeo(g, '#436e31');
    geos.push(g);
    if (i % 3 === 0) {
      const b = leafOrig.clone();
      const s2 = 0.07 + rng() * 0.035;
      const m2 = new three.Matrix4().compose(
        new three.Vector3(ax, ay + 0.02, az + 0.05),
        new three.Quaternion().setFromEuler(new three.Euler(rng() * 6.28, rng() * 6.28, 0)),
        new three.Vector3(s2, s2 * .86, s2));
      b.applyMatrix4(m2);
      FC.tintGeo(b, [FC.PAL.roseRed, FC.PAL.rosePink, '#f2d7dd'][(rng() * 3) | 0]);
      blooms.push(b);
    }
  }

  this.vineMat = new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: .9, metalness: 0
  });
  FC.applyWind(this.vineMat, 0.045, 1.6, 0.4, 2.6);
  this.vines = new three.Mesh(FC.mergeGeos(geos), this.vineMat);
  this.vines.castShadow = true;
  this.group.add(this.vines);

  this.vineBloom = new three.Mesh(FC.mergeGeos(blooms), FC.matVertex({ rough: .78 }));
  this.vineBloom.castShadow = true;
  this.group.add(this.vineBloom);
};

/* ============================================================
   ⑤ 散落的落叶（在小径与空地上）
   ============================================================ */
FC.Vegetation.prototype.buildFallenLeaves = function () {
  const three = FC.THREE;
  const rng = FC.rng(1212);
  const N = this.quality === 'low' ? 90 : 260;
  const geos = [];
  const tmpl = new three.CircleGeometry(1, 3);
  tmpl.rotateX(-Math.PI / 2);
  const COL = ['#8a6a34', '#a07b3a', '#6f5a30', '#c8a03c', '#8f4a3a'];
  let placed = 0, guard = 0;
  while (placed < N && guard < N * 20) {
    guard++;
    const a = rng() * 6.28, r = 3 + Math.pow(rng(), .6) * 30;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (FC.blocked(x, z)) continue;
    const y = FC.terrainHeight(x, z) + 0.035;
    const s = 0.09 + rng() * 0.13;
    const g = tmpl.clone();
    const m = new three.Matrix4().compose(
      new three.Vector3(x, y, z),
      new three.Quaternion().setFromEuler(new three.Euler((rng() - .5) * .35, rng() * 6.28, (rng() - .5) * .35)),
      new three.Vector3(s * (1 + rng() * .5), 1, s));
    g.applyMatrix4(m);
    FC.tintGeo(g, COL[(rng() * COL.length) | 0]);
    geos.push(g);
    placed++;
  }
  const mesh = new three.Mesh(FC.mergeGeos(geos), new three.MeshStandardMaterial({
    vertexColors: true, roughness: .95, metalness: 0, side: three.DoubleSide
  }));
  mesh.receiveShadow = true;
  this.group.add(mesh);
};

/* ---------- 每帧：夜晚 / 阴天时给花瓣一点自发光，保证花色不糊成一团 ---------- */
FC.Vegetation.prototype.update = function (dt, env) {
  this.time += dt;
  if (!this.petalMat) return;
  const need = FC.clamp(1.0 - (env.cur.sunIntensity / 2.2), 0, 1);
  this.petalMat.emissiveIntensity = FC.damp(this.petalMat.emissiveIntensity, need * 0.30, 2.0, dt);
  // 草丛在雨天更暗（湿度感）
  if (this.weedMat) {
    const wet = env.cur.rain;
    this.weedMat.roughness = 0.95 - wet * 0.22;
    this.roseLeafMat.roughness = 0.92 - wet * 0.20;
  }
};
