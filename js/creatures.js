/* ============================================================
   creatures.js —— 生物系统
   ① 松鼠（爬树、跳跃、甩尾巴）
   ② 小鸟（树上栖息 + 振翅 + 飞离/落回）
   ③ 兔子（在空地上跳跃觅食）
   ④ 小鹿（远处林间漫步）
   ⑤ 蝴蝶（绕花飞舞，翅膀扇动）
   ⑥ 蜜蜂（在花丛间做布朗式盘旋）
   使用 InstancedMesh 处理蝴蝶/蜜蜂的批量渲染
   ============================================================ */

/* ---------- 通用：低多边形身体部件构建 ---------- */
FC.Creatures = function (scene, vegetation, terrain, cabin, quality) {
  const three = FC.THREE;
  this.scene = scene;
  this.veg = vegetation;
  this.terrain = terrain;
  this.cabin = cabin;
  this.quality = quality || 'mid';
  this.group = new three.Group();
  this.group.name = 'creatures';
  scene.add(this.group);
  this.time = 0;
  this.animals = [];        // 有离散动作逻辑的动物

  this.buildSquirrels();
  this.buildBirds();
  this.buildRabbits();
  this.buildDeer();
  this.buildButterflies();
  this.buildBees();
  if (this.quality !== 'low') this.buildAnts();
};

/* ============================================================
   几何小工具
   ============================================================ */
function mkBody(sx, sy, sz, hex) {
  const g = new FC.THREE.SphereGeometry(1, 7, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * sx, p.getY(i) * sy, p.getZ(i) * sz);
  }
  g.computeVertexNormals();
  FC.tintGeo(g, hex);
  return g;
}
function mkBox(sx, sy, sz, hex) {
  const g = new FC.THREE.BoxGeometry(sx, sy, sz);
  FC.tintGeo(g, hex);
  return g;
}
function mkCone(r, h, seg, hex) {
  const g = new FC.THREE.ConeGeometry(r, h, seg);
  FC.tintGeo(g, hex);
  return g;
}

/* ============================================================
   ① 松鼠
   ============================================================ */
FC.Creatures.prototype.buildSquirrels = function () {
  const three = FC.THREE;
  /* ⚠️ 松鼠必须"看得见"。原来是从全部树里隔位乱取，结果宿主常常落在
     离小屋二三十米、十七八米高的树冠内部 —— 等于没画。
     改为：只在"默认机位正前方、6~19m、且在画面内"的树里挑，
     阔叶木（团块树冠）加权优先，并封顶最大爬升高度，让松鼠待在低处可见枝条上。 */
  const camX = 8.6, camZ = 15.4;
  const tgtX = 0, tgtZ = 0.9;                       // 默认看向小屋
  const dl = Math.hypot(tgtX - camX, tgtZ - camZ);
  const dx = (tgtX - camX) / dl, dz = (tgtZ - camZ) / dl;
  const hosts = this.veg.trees
    .filter(t => t.kind === 'broad' || t.kind === 'conifer')
    .map(t => {
      const vx = t.x - camX, vz = t.z - camZ;
      const d = Math.hypot(vx, vz);
      const front = (vx * dx + vz * dz) / Math.max(d, 1e-3);   // 视线方向投影
      return { t, d, front };
    })
    // ⚠️ front 阈值按"真实水平半视角"定：fov=46°、16:9 → 水平半角约 37°（cos≈0.80）。
    //    取 0.72（≈44°）容纳小屋两侧的"框景树"，它们本就是斜向入画的。
    .filter(o => o.front > 0.72 && o.d > 5 && o.d < 24)
    .sort((a, b) => b.front - a.front)
    .map(o => o.t);
  // 兜底：万一过滤后为空，退回全部树
  const pool = hosts.length ? hosts : this.veg.trees;
  if (!pool.length) return;
  const N = Math.min(this.quality === 'low' ? 2 : 4, this.veg.trees.length);

  for (let i = 0; i < N; i++) {
    // 前 pool.length 只优先落在"画面里"的树上；其余自由放养（林间点缀）
    const host = i < pool.length ? pool[i]
                                 : this.veg.trees[(i * 7 + 3) % this.veg.trees.length];
    const grp = new three.Group();
    grp.position.set(host.x, host.y, host.z);
    grp.userData.host = host;

    const parts = [];
    const FUR = ['#b5652c', '#a8562a', '#c47a3c'][i % 3];
    const FUR2 = '#d99a5c';
    // 身体
    parts.push(FC.place(mkBody(0.12, 0.14, 0.20, FUR), 0, 0, 0, 1));
    // 头
    parts.push(FC.place(mkBody(0.10, 0.10, 0.105, FUR), 0, 0.13, 0.14, 1));
    // 吻部
    parts.push(FC.place(mkBody(0.05, 0.045, 0.06, FUR2), 0, 0.10, 0.23, 1));
    // 鼻头
    parts.push(FC.place(mkBody(0.018, 0.015, 0.018, '#2a1c14'), 0, 0.102, 0.285, 1));
    // 耳朵
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkCone(0.035, 0.075, 4, FUR), s * 0.062, 0.215, 0.10, 1, 0, 0));
    });
    // 眼睛
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBody(0.019, 0.019, 0.012, '#1a1210'), s * 0.048, 0.155, 0.228, 1));
    });
    // 四肢
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBox(0.045, 0.075, 0.045, FUR), s * 0.075, -0.10, 0.09, 1));
      parts.push(FC.place(mkBox(0.05, 0.09, 0.05, FUR), s * 0.08, -0.10, -0.08, 1));
    });
    // 尾巴（单独一个 pivot，便于摆动）
    const tailGeo = mkBody(0.085, 0.20, 0.055, FUR2);
    tailGeo.translate(0, 0.16, 0);
    const tail = new three.Group();
    tail.add(new three.Mesh(tailGeo, FC.matVertex({ rough: .95 })));
    tail.position.set(0, -0.02, -0.18);
    tail.rotation.x = -0.45;

    const body = new three.Mesh(FC.mergeGeos(parts), FC.matVertex({ rough: .95 }));
    body.castShadow = true;
    grp.add(body);
    tail.children[0].castShadow = true;
    grp.add(tail);

    // 起始位置：贴在树干外侧的枝条上（偏低处，保证在画面里可见）
    const a0 = Math.random() * 6.28;
    const h0 = host.h * (0.28 + Math.random() * 0.26);
    const rad0 = 0.62;                       // 站到树冠外缘，而不是埋进叶子里
    grp.position.set(host.x + Math.cos(a0) * rad0, host.y + h0, host.z + Math.sin(a0) * rad0);

    this.group.add(grp);
    this.animals.push({
      type: 'squirrel', obj: grp, tail,
      ang: a0, angSpeed: (Math.random() < .5 ? -1 : 1) * FC.rand(0.24, 0.46),
      climbY: h0, climbSpeed: FC.rand(0.10, 0.26) * (Math.random() < .5 ? -1 : 1),
      minH: host.h * 0.14, maxH: host.h * 0.46,   // 封顶：别爬到看不见的树顶
      radius: rad0,          // 固定在树冠外缘，松鼠始终露在叶外
      hopPhase: Math.random() * 6.28,
      host
    });
  }
};

/* ============================================================
   ② 小鸟（栖息在树上，起飞 → 巡游 → 落回）
   ============================================================ */
FC.Creatures.prototype.buildBirds = function () {
  const three = FC.THREE;
  const N = this.quality === 'low' ? 2 : (this.quality === 'mid' ? 5 : 8);
  const hosts = this.veg.trees;
  if (!hosts.length) return;
  const camX = 8.6, camZ = 15.4;        // 默认机位（与 buildSquirrels 一致）
  const SPECIES = [
    { body: '#3d6ea8', belly: '#e8d9b8', wing: '#2f5a8c', beak: '#e8a83c' },
    { body: '#a8443c', belly: '#e8c8a8', wing: '#8a3630', beak: '#d8a038' },
    { body: '#3f6b45', belly: '#daddb8', wing: '#33573a', beak: '#c89a3c' },
    { body: '#c8923c', belly: '#f0e0b8', wing: '#a87828', beak: '#8a6a2c' }
  ];
  const rng = FC.rng(7171);

  for (let i = 0; i < N; i++) {
    const sp = SPECIES[i % SPECIES.length];
    const grp = new three.Group();
    const parts = [];
    // 身体
    parts.push(FC.place(mkBody(0.075, 0.085, 0.13, sp.body), 0, 0, 0, 1));
    // 腹部
    parts.push(FC.place(mkBody(0.062, 0.055, 0.09, sp.belly), 0, -0.035, 0.01, 1));
    // 头
    parts.push(FC.place(mkBody(0.062, 0.062, 0.062, sp.body), 0, 0.085, 0.10, 1));
    // 喙
    parts.push(FC.place(mkCone(0.024, 0.06, 4, sp.beak), 0, 0.082, 0.175, 1, 0, 0.7));
    // 眼
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBody(0.014, 0.014, 0.010, '#141010'), s * 0.045, 0.098, 0.135, 1));
    });
    // 尾羽
    const tg = mkCone(0.045, 0.16, 4, sp.wing);
    tg.rotateZ(Math.PI / 2);
    parts.push(FC.place(tg, 0, -0.005, -0.19, 1));
    // 爪
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBox(0.018, 0.055, 0.018, sp.beak), s * 0.033, -0.10, 0.01, 1));
    });
    const body = new three.Mesh(FC.mergeGeos(parts), FC.matVertex({ rough: .9 }));
    body.castShadow = true;
    grp.add(body);

    // 双翼（各自 pivot，用于振翅）
    const wings = [];
    [-1, 1].forEach(s => {
      const wg = mkBody(0.115, 0.017, 0.085, sp.wing);
      wg.translate(s * 0.10, 0, -0.01);
      const pivot = new three.Group();
      pivot.add(new three.Mesh(wg, FC.matVertex({ rough: .9 })));
      pivot.children[0].castShadow = true;
      grp.add(pivot);
      wings.push({ pivot, side: s });
    });

    // 栖息点：同样只在"机位正前方"的树里挑，落到树冠外缘低枝（否则藏在叶子里看不见）
    const V = this.veg;
    const pool = this._frontTrees || (this._frontTrees = (() => {
      const cX = 8.6, cZ = 15.4, tX = 0, tZ = 0.9;
      const l = Math.hypot(tX - cX, tZ - cZ), fx = (tX - cX) / l, fz = (tZ - cZ) / l;
      const list = V.trees.map(t => {
        const vx = t.x - cX, vz = t.z - cZ, d = Math.hypot(vx, vz);
        return { t, d, front: (vx * fx + vz * fz) / Math.max(d, 1e-3) };
      }).filter(o => o.front > 0.62 && o.d > 7 && o.d < 24).sort((a, b) => b.front - a.front).map(o => o.t);
      return list.length ? list : V.trees;
    })());
    const host = pool[(i * 3 + 1) % pool.length];
    const a = rng() * 6.28;
    const r = 0.78 + rng() * 0.5;
    const restY = host.y + host.h * (0.30 + rng() * 0.22);
    const restPos = new three.Vector3(host.x + Math.cos(a) * r, restY, host.z + Math.sin(a) * r);
    grp.position.copy(restPos);

    this.group.add(grp);
    this.animals.push({
      type: 'bird', obj: grp, wings,
      state: 'rest',
      restPos,
      stateT: FC.rand(2.5, 11),
      target: new three.Vector3(),
      center: new three.Vector3(restPos.x, restPos.y, restPos.z),
      flySpeed: FC.rand(3.4, 5.2),
      phase: rng() * 6.28,
      bobAmp: FC.rand(0.03, 0.08),
      yaw: 0
    });
  }
};

/* ============================================================
   ③ 兔子
   ============================================================ */
FC.Creatures.prototype.buildRabbits = function () {
  const three = FC.THREE;
  const N = this.quality === 'low' ? 1 : 3;
  const CREAM = ['#c8b49a', '#b8a58c', '#d8c8ae'];
  const rng = FC.rng(6262);
  for (let i = 0; i < N; i++) {
    const col = CREAM[i % CREAM.length];
    const grp = new three.Group();
    const parts = [];
    // 身体
    parts.push(FC.place(mkBody(0.13, 0.125, 0.19, col), 0, 0, 0, 1));
    // 臀
    parts.push(FC.place(mkBody(0.115, 0.11, 0.10, col), 0, 0.0, -0.14, 1));
    // 头
    parts.push(FC.place(mkBody(0.092, 0.088, 0.10, col), 0, 0.10, 0.15, 1));
    // 鼻
    parts.push(FC.place(mkBody(0.022, 0.018, 0.02, '#e8a8a0'), 0, 0.078, 0.245, 1));
    // 眼
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBody(0.022, 0.024, 0.014, '#1a1414'), s * 0.062, 0.115, 0.208, 1));
    });
    // 长耳（两个 pivot）
    const ears = [];
    [-1, 1].forEach(s => {
      const eg = mkBody(0.032, 0.135, 0.022, col);
      eg.translate(0, 0.13, 0);
      const pivot = new three.Group();
      pivot.add(new three.Mesh(eg, FC.matVertex({ rough: .95 })));
      pivot.position.set(s * 0.05, 0.155, 0.10);
      pivot.rotation.z = -s * 0.22;
      pivot.children[0].castShadow = true;
      grp.add(pivot);
      ears.push({ pivot, side: s });
    });
    // 腿
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBody(0.042, 0.055, 0.075, col), s * 0.085, -0.095, -0.06, 1));
    });
    // 尾巴
    parts.push(FC.place(mkBody(0.048, 0.048, 0.048, '#f0e8dc'), 0, 0.04, -0.22, 1));

    const body = new three.Mesh(FC.mergeGeos(parts), FC.matVertex({ rough: .96 }));
    body.castShadow = true;
    grp.add(body);

    // 起始位置：空地上
    const a = rng() * 6.28, r = 6 + rng() * 8;
    const x = Math.cos(a) * r, z = 8 + Math.sin(a) * r * 0.6;
    grp.position.set(x, FC.terrainHeight(x, z), z);

    this.group.add(grp);
    this.animals.push({
      type: 'rabbit', obj: grp, ears,
      state: 'idle', stateT: rng() * 4,
      target: new three.Vector3(),
      hopPhase: 0, speed: FC.rand(1.1, 1.9),
      yaw: rng() * 6.28
    });
  }
};

/* ============================================================
   ④ 小鹿（远景）
   ============================================================ */
FC.Creatures.prototype.buildDeer = function () {
  const three = FC.THREE;
  if (this.quality === 'low') return;
  const N = 2;
  const rng = FC.rng(5353);
  for (let i = 0; i < N; i++) {
    const col = i === 0 ? '#a87548' : '#96703f';
    const grp = new three.Group();
    const parts = [];
    // 躯干
    parts.push(FC.place(mkBody(0.26, 0.30, 0.62, col), 0, 0.85, 0, 1));
    // 胸
    parts.push(FC.place(mkBody(0.24, 0.28, 0.28, col), 0, 0.88, 0.36, 1));
    // 颈
    parts.push(FC.place(mkBody(0.12, 0.30, 0.13, col), 0, 1.20, 0.52, 1));
    // 头
    parts.push(FC.place(mkBody(0.11, 0.115, 0.20, col), 0, 1.44, 0.62, 1));
    // 吻
    parts.push(FC.place(mkBody(0.065, 0.06, 0.09, '#8a6038'), 0, 1.40, 0.79, 1));
    // 耳
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBody(0.035, 0.075, 0.022, col), s * 0.09, 1.53, 0.55, 1, 0, s * 0.4));
    });
    // 眼
    [-1, 1].forEach(s => {
      parts.push(FC.place(mkBody(0.024, 0.026, 0.014, '#1a1410'), s * 0.082, 1.46, 0.72, 1));
    });
    // 鹿角（分支）
    [-1, 1].forEach(s => {
      const base = new three.CylinderGeometry(0.018, 0.028, 0.34, 4);
      base.translate(0, 0.17, 0);
      const g1 = base.clone();
      FC.place(g1, s * 0.075, 1.56, 0.55, 1, 0, -s * 0.28);
      FC.tintGeo(g1, '#9a8458'); parts.push(g1);
      const br = new three.CylinderGeometry(0.012, 0.016, 0.20, 4);
      br.translate(0, 0.10, 0);
      const g2 = br.clone();
      FC.place(g2, s * 0.14, 1.80, 0.55, 1, 0, -s * 0.9);
      FC.tintGeo(g2, '#9a8458'); parts.push(g2);
      const g3 = br.clone();
      FC.place(g3, s * 0.10, 1.86, 0.62, 1, 0, -s * 0.2);
      FC.tintGeo(g3, '#9a8458'); parts.push(g3);
    });
    // 腿
    [[-0.17, 0.42], [0.17, 0.42], [-0.17, -0.40], [0.17, -0.40]].forEach(c => {
      parts.push(FC.place(mkBox(0.085, 0.72, 0.085, col), c[0], 0.36, c[1], 1));
      parts.push(FC.place(mkBody(0.06, 0.045, 0.075, '#3a2a1c'), c[0], 0.045, c[1] + 0.02, 1));
    });
    // 尾
    parts.push(FC.place(mkBody(0.055, 0.075, 0.045, '#e8dcc0'), 0, 1.02, -0.62, 1));

    const body = new three.Mesh(FC.mergeGeos(parts), FC.matVertex({ rough: .96 }));
    body.castShadow = true;
    grp.add(body);

    const a = rng() * 6.28, r = 26 + rng() * 14;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    grp.position.set(x, FC.terrainHeight(x, z), z);
    grp.scale.setScalar(0.86 + rng() * 0.2);

    this.group.add(grp);
    this.animals.push({
      type: 'deer', obj: grp,
      state: 'graze', stateT: rng() * 6,
      center: new three.Vector3(x, 0, z),
      ang: Math.atan2(z, x), rad: r,
      yaw: rng() * 6.28, speed: FC.rand(0.45, 0.8),
      headBob: rng() * 6.28
    });
  }
};

/* ============================================================
   ⑤ 蝴蝶（InstancedMesh：身体 + 双翼）
   ============================================================ */
FC.Creatures.prototype.buildButterflies = function () {
  const three = FC.THREE;
  const N = this.quality === 'low' ? 8 : (this.quality === 'mid' ? 20 : 34);
  this.bfCount = N;

  /* 贴图 + 面片做翅膀。⚠️ 面片必须摊平成水平面（rotateX），
     否则"振翅"旋转轴是错的，翅膀会像立着的画片左右摇晃 */
  const wingTex = FC.makeButterflyTexture();
  const mkWing = (dir) => {
    const g = new three.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);          // 摊平到 XZ 平面
    g.translate(dir * 0.5, 0, 0);     // 根部在枢轴，向 ±X 伸展
    return g;
  };

  this.bfWingMat = new three.MeshBasicMaterial({
    map: wingTex, transparent: true, alphaTest: 0.06,
    side: three.DoubleSide, depthWrite: false
  });

  this.bfWings = [];
  [-1, 1].forEach(dir => {
    const im = new three.InstancedMesh(mkWing(dir), this.bfWingMat, N);
    im.instanceMatrix.setUsage(three.DynamicDrawUsage);
    im.frustumCulled = false;
    im.instanceColor = new three.InstancedBufferAttribute(new Float32Array(N * 3), 3);
    this.bfWings.push({ im, side: dir });
    this.group.add(im);
  });

  /* 身体（小圆柱），让蝴蝶不显得只是两片飘浮的花瓣 */
  const bg = new three.CylinderGeometry(0.022, 0.030, 0.20, 5);
  bg.rotateX(Math.PI / 2);
  const bm = new three.MeshStandardMaterial({ color: new three.Color('#2e2620'), roughness: .7, flatShading: true });
  this.bfBodies = new three.InstancedMesh(bg, bm, N);
  this.bfBodies.instanceMatrix.setUsage(three.DynamicDrawUsage);
  this.bfBodies.frustumCulled = false;
  this.group.add(this.bfBodies);

  this.bfData = [];
  const COLS = [FC.PAL.butterfly1, FC.PAL.butterfly2, FC.PAL.butterfly3,
                '#f0e0a0', '#e07a3c', '#9a6ad0'];
  const tmpC = new three.Color();
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.28;
    const r = Math.sqrt(Math.random());
    const cx = FC.CLEARING.cx + Math.cos(a) * r * FC.CLEARING.rx * 0.92;
    const cz = FC.CLEARING.cz + Math.sin(a) * r * FC.CLEARING.rz * 0.92;
    this.bfData.push({
      cx, cz,
      baseY: FC.terrainHeight(cx, cz),
      ang: a, rad: 0.6 + Math.random() * 1.8,
      angSpeed: (Math.random() < .5 ? -1 : 1) * FC.rand(0.7, 1.8),
      vertAmp: FC.rand(0.25, 0.85),
      vertSpeed: FC.rand(1.4, 3.0),
      vertPhase: Math.random() * 6.28,
      flap: FC.rand(9, 16),
      flapPhase: Math.random() * 6.28,
      size: FC.rand(0.15, 0.30),
      driftX: FC.rand(-0.5, 0.5),
      driftZ: FC.rand(-0.5, 0.5),
      retarget: FC.rand(2, 6)
    });
    tmpC.set(COLS[i % COLS.length]);
    this.bfWings.forEach(w => w.im.instanceColor.setXYZ(i, tmpC.r, tmpC.g, tmpC.b));
  }
  this.bfWings.forEach(w => { w.im.instanceColor.needsUpdate = true; });

  /* 预分配临时对象，避免每帧 GC */
  this._tM = new three.Matrix4();
  this._tQ = new three.Quaternion();
  this._tP = new three.Vector3();
  this._tS = new three.Vector3();
  this._tR = new three.Matrix4();
  this._tE = new three.Euler();
  this._tPos = new three.Vector3();
  this._tDir = new three.Vector3();
  this._tM2 = new three.Matrix4();
};

/* 蝴蝶翅膀贴图：用 canvas 画一个对称的翅膀轮廓 */
FC.makeButterflyTexture = function () {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  // 前后翅合并成一个"心形/扇形"轮廓，靠根部在左边缘中点
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  // 前翅（上半）
  ctx.moveTo(2, S * 0.5);
  ctx.bezierCurveTo(S * 0.12, S * 0.06, S * 0.74, S * 0.02, S * 0.96, S * 0.30);
  ctx.bezierCurveTo(S * 0.98, S * 0.44, S * 0.70, S * 0.50, S * 0.48, S * 0.50);
  // 后翅（下半）
  ctx.bezierCurveTo(S * 0.70, S * 0.52, S * 0.92, S * 0.60, S * 0.78, S * 0.82);
  ctx.bezierCurveTo(S * 0.66, S * 0.98, S * 0.20, S * 0.90, 2, S * 0.5);
  ctx.closePath();
  ctx.fill();
  // 翅脉 + 边缘暗色
  ctx.globalCompositeOperation = 'source-atop';
  const grd = ctx.createLinearGradient(0, 0, S, 0);
  grd.addColorStop(0, 'rgba(30,22,16,0.9)');
  grd.addColorStop(0.22, 'rgba(60,44,30,0.35)');
  grd.addColorStop(0.75, 'rgba(255,255,255,0.0)');
  grd.addColorStop(1, 'rgba(20,16,12,0.55)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, S, S);
  // 斑纹
  ctx.fillStyle = 'rgba(24,18,14,0.62)';
  [[0.42, 0.22, 0.055], [0.66, 0.26, 0.042], [0.52, 0.70, 0.05], [0.70, 0.68, 0.036]].forEach(p => {
    ctx.beginPath();
    ctx.ellipse(S * p[0], S * p[1], S * p[2], S * p[2] * 1.25, 0.4, 0, 6.28);
    ctx.fill();
  });
  ctx.globalCompositeOperation = 'source-over';
  // 外轮廓线
  ctx.strokeStyle = 'rgba(20,14,10,0.85)';
  ctx.lineWidth = 3;
  ctx.stroke();

  const tex = new FC.THREE.CanvasTexture(cv);
  return tex;
};

/* ============================================================
   ⑥ 蜜蜂
   ============================================================ */
FC.Creatures.prototype.buildBees = function () {
  const three = FC.THREE;
  const N = this.quality === 'low' ? 5 : (this.quality === 'mid' ? 11 : 18);
  const geo = new three.SphereGeometry(1, 6, 4);
  // 拉成椭圆
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 0.075, p.getY(i) * 0.062, p.getZ(i) * 0.10);
  geo.computeVertexNormals();

  const mat = new three.MeshStandardMaterial({
    color: new three.Color(FC.PAL.bee), roughness: .5, metalness: .1, flatShading: true
  });
  this.beeIM = new three.InstancedMesh(geo, mat, N);
  this.beeIM.instanceMatrix.setUsage(three.DynamicDrawUsage);
  this.beeIM.frustumCulled = false;
  this.group.add(this.beeIM);

  // 翅膀（同样摊平到水平面，绕 Z 轴抖动即为扇翅）
  const wg = new three.PlaneGeometry(0.09, 0.05);
  wg.rotateX(-Math.PI / 2);
  wg.translate(0.045, 0, 0);
  const wmat = new three.MeshBasicMaterial({
    color: new three.Color('#e8f0f4'), transparent: true, opacity: .42,
    side: three.DoubleSide, depthWrite: false
  });
  this.beeWings = [];
  [-1, 1].forEach(dir => {
    const g = wg.clone();
    g.translate(dir > 0 ? 0 : -0.09, 0, 0);
    const im = new three.InstancedMesh(g, wmat, N);
    im.instanceMatrix.setUsage(three.DynamicDrawUsage);
    im.frustumCulled = false;
    this.beeWings.push({ im, side: dir });
    this.group.add(im);
  });

  this.beeData = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 0.9;
    this.beeData.push({
      cx: FC.CLEARING.cx + Math.cos(a) * r * FC.CLEARING.rx,
      cz: FC.CLEARING.cz + Math.sin(a) * r * FC.CLEARING.rz,
      target: new THREE.Vector3(),
      pos: new THREE.Vector3(),
      retarget: Math.random() * 1.5,
      flap: FC.rand(48, 72), flapPhase: Math.random() * 6.28,
      speed: FC.rand(1.5, 3.2),
      hoverPhase: Math.random() * 6.28,
      size: FC.rand(0.85, 1.25)
    });
  }
  // 初始化位置
  this.beeData.forEach(b => {
    b.pos.set(b.cx, FC.terrainHeight(b.cx, b.cz) + 0.5, b.cz);
    b.target.copy(b.pos);
  });
};

/* ============================================================
   ⑦ 蚂蚁（沿小径爬行，细节点缀）
   ============================================================ */
FC.Creatures.prototype.buildAnts = function () {
  const three = FC.THREE;
  const N = 14;
  const geo = new three.SphereGeometry(1, 5, 4);
  const mat = new three.MeshStandardMaterial({ color: new three.Color('#2a211a'), roughness: .7, flatShading: true });
  this.antIM = new three.InstancedMesh(geo, mat, N);
  this.antIM.instanceMatrix.setUsage(three.DynamicDrawUsage);
  this.antIM.frustumCulled = false;
  this.group.add(this.antIM);
  this.antData = [];
  for (let i = 0; i < N; i++) {
    this.antData.push({ t: Math.random(), speed: FC.rand(0.02, 0.05), offset: FC.rand(-0.5, 0.5), dir: Math.random() < .5 ? 1 : -1 });
  }
};

/* ============================================================
   每帧更新
   ============================================================ */
FC.Creatures.prototype.update = function (dt, camera, env) {
  const three = FC.THREE;
  this.time += dt;
  const T = this.time;
  const night = env.cur.firefly;      // 0~1，夜晚程度

  /* ---------- 通用 ---------- */
  this.animals.forEach(A => {
    switch (A.type) {
      case 'squirrel': this.updSquirrel(A, dt, T); break;
      case 'bird':     this.updBird(A, dt, T); break;
      case 'rabbit':   this.updRabbit(A, dt, T); break;
      case 'deer':     this.updDeer(A, dt, T); break;
    }
  });

  /* ---------- 蝴蝶：天黑就回巢（隐藏） ---------- */
  const bfVis = FC.clamp(1 - night * 1.35, 0, 1) * env.cur.dust;
  this.bfWings.forEach(w => { w.im.visible = bfVis > 0.05; });
  if (bfVis > 0.05) this.updButterflies(dt, T, bfVis);

  /* ---------- 蜜蜂：雨天下班 ---------- */
  const beeVis = FC.clamp(1 - env.cur.rain * 2.0, 0, 1) * FC.clamp(1 - night * 1.2, 0, 1);
  this.beeIM.visible = beeVis > 0.05;
  this.beeWings.forEach(w => { w.im.visible = beeVis > 0.05; });
  if (beeVis > 0.05) this.updBees(dt, T, beeVis);

  /* ---------- 蚂蚁：雨天下班 ---------- */
  if (this.antIM) {
    const av = FC.clamp(1 - env.cur.rain * 2.5, 0, 1) * FC.clamp(1 - night * 1.3, 0, 1);
    this.antIM.visible = av > 0.3;
    if (this.antIM.visible) this.updAnts(dt, T);
  }
};

/* ---------- 松鼠 ---------- */
FC.Creatures.prototype.updSquirrel = function (A, dt, T) {
  const three = FC.THREE;
  const o = A.obj;
  // 绕树干螺旋爬行
  A.ang += A.angSpeed * dt;
  A.climbY += A.climbSpeed * dt;
  if (A.climbY < A.minH) { A.climbY = A.minH; A.climbSpeed *= -1; }
  if (A.climbY > A.maxH) { A.climbY = A.maxH; A.climbSpeed *= -1; }
  const h = A.host;
  o.position.set(
    h.x + Math.cos(A.ang) * A.radius,
    h.y + A.climbY,
    h.z + Math.sin(A.ang) * A.radius
  );
  // 朝向切向
  const tang = A.ang + Math.PI / 2 * Math.sign(A.angSpeed);
  o.rotation.y = -tang;
  o.rotation.x = A.climbSpeed < 0 ? 0.22 : -0.16;
  // 尾巴摆动
  A.tail.rotation.x = -0.45 + Math.sin(T * 3.4 + A.hopPhase) * 0.30;
  A.tail.rotation.z = Math.sin(T * 2.6 + A.hopPhase) * 0.24;
  // 跳跃式起伏
  o.position.y += Math.abs(Math.sin(T * 2.2 + A.hopPhase)) * 0.05;
};

/* ---------- 小鸟 ---------- */
FC.Creatures.prototype.updBird = function (A, dt, T) {
  const three = FC.THREE;
  const o = A.obj;
  A.stateT -= dt;

  if (A.state === 'rest') {
    // 站立：轻微呼吸 + 偶尔歪头
    o.position.y = A.restPos.y + Math.sin(T * 1.4 + A.phase) * 0.012;
    o.rotation.y = A.yaw + Math.sin(T * 0.4 + A.phase) * 0.2;
    o.rotation.z = 0;
    const idle = Math.sin(T * 1.8 + A.phase) * 0.10;
    A.wings.forEach(w => { w.pivot.rotation.z = w.side * (0.10 + idle * 0.3); });
    if (A.stateT <= 0) {
      A.state = 'fly';
      A.stateT = FC.rand(4, 9);
      // 选一个目标点：林间随机
      const a = Math.random() * 6.28, r = 8 + Math.random() * 26;
      A.target.set(Math.cos(a) * r, FC.terrainHeight(Math.cos(a) * r, Math.sin(a) * r) + 3 + Math.random() * 6, Math.sin(a) * r);
    }
  } else if (A.state === 'fly') {
    // 向目标飞行 + 正弦起伏
    const dir = new three.Vector3().subVectors(A.target, o.position);
    const dist = dir.length();
    if (dist < 0.6 || A.stateT <= 0) {
      A.state = 'return';
      A.stateT = FC.rand(3, 7);
    } else {
      dir.normalize();
      const sp = A.flySpeed;
      o.position.addScaledVector(dir, sp * dt);
      o.position.y += Math.sin(T * 3.2 + A.phase) * A.bobAmp * dt * 6;
      // 朝向
      const desiredYaw = Math.atan2(dir.x, dir.z);
      o.rotation.y = desiredYaw;
      // 飞行时前倾 + 大幅振翅
      o.rotation.x = -0.28;
      o.rotation.z = -dir.x * 0.3;
      const wobble = Math.sin(T * 26 + A.phase) * 0.5;
      A.wings.forEach(w => { w.pivot.rotation.z = w.side * (0.55 + wobble * 0.6); });
    }
  } else {
    // 飞回栖息点
    const dir = new three.Vector3().subVectors(A.restPos, o.position);
    const dist = dir.length();
    if (dist < 0.4) {
      A.state = 'rest';
      A.stateT = FC.rand(4, 13);
      o.position.copy(A.restPos);
      o.rotation.x = 0;
    } else {
      dir.normalize();
      o.position.addScaledVector(dir, A.flySpeed * 1.15 * dt);
      o.rotation.y = Math.atan2(dir.x, dir.z);
      o.rotation.x = -0.24;
      const wobble = Math.sin(T * 30 + A.phase) * 0.5;
      A.wings.forEach(w => { w.pivot.rotation.z = w.side * (0.6 + wobble * 0.6); });
    }
  }
};

/* ---------- 兔子 ---------- */
FC.Creatures.prototype.updRabbit = function (A, dt, T) {
  const three = FC.THREE;
  const o = A.obj;
  A.stateT -= dt;

  if (A.state === 'idle') {
    // 站立张望，耳朵轻转
    o.rotation.z = 0;
    A.ears.forEach(e => {
      e.pivot.rotation.z = -e.side * 0.22 + Math.sin(T * 2.2 + e.side) * 0.12;
      e.pivot.rotation.x = Math.sin(T * 1.3 + e.side * 2) * 0.14;
    });
    if (A.stateT <= 0) {
      A.state = 'hop';
      A.stateT = FC.rand(1.6, 4.0);
      // 选个近距离目标
      const a = Math.random() * 6.28, r = 2.5 + Math.random() * 5;
      const tx = o.position.x + Math.cos(a) * r, tz = o.position.z + Math.sin(a) * r;
      // 别跑到小屋/池塘里
      if (FC.blocked(tx, tz) || this.terrain.distToPath(tx, tz) < 0.7) {
        A.target.set(o.position.x, 0, o.position.z);
      } else {
        A.target.set(tx, FC.terrainHeight(tx, tz), tz);
      }
      A.yaw = Math.atan2(A.target.x - o.position.x, A.target.z - o.position.z);
    }
  } else {
    // 跳跃移动：抛物线轨迹
    const dir = new three.Vector3().subVectors(A.target, o.position);
    dir.y = 0;
    const dist = dir.length();
    const hopFreq = 3.2;
    A.hopPhase += dt * hopFreq;
    const hopY = Math.abs(Math.sin(A.hopPhase * Math.PI)) * 0.14;
    if (dist < 0.35 || A.stateT <= 0) {
      A.state = 'idle';
      A.stateT = FC.rand(1.6, 5.0);
      o.position.y = FC.terrainHeight(o.position.x, o.position.z);
    } else {
      dir.normalize();
      const sp = A.speed * (0.5 + Math.abs(Math.sin(A.hopPhase * Math.PI)) * 1.1);
      o.position.addScaledVector(dir, sp * dt);
      o.position.y = FC.terrainHeight(o.position.x, o.position.z) + hopY;
      // 朝向平滑
      const dy = ((A.yaw - o.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      o.rotation.y += dy * Math.min(1, dt * 7);
      // 跳跃时身体前倾
      o.rotation.x = -Math.sin(A.hopPhase * Math.PI) * 0.22;
    }
    A.ears.forEach(e => {
      e.pivot.rotation.z = -e.side * 0.22 + Math.sin(T * 6 + e.side) * 0.18;
      e.pivot.rotation.x = -Math.sin(A.hopPhase * Math.PI) * 0.28;
    });
  }
};

/* ---------- 小鹿 ---------- */
FC.Creatures.prototype.updDeer = function (A, dt, T) {
  const three = FC.THREE;
  const o = A.obj;
  A.stateT -= dt;
  if (A.state === 'graze') {
    // 低头吃草
    o.rotation.x = 0;
    o.position.y = FC.terrainHeight(o.position.x, o.position.z);
    if (A.stateT <= 0) {
      A.state = 'walk';
      A.stateT = FC.rand(4, 10);
    }
  } else {
    // 沿圆环漫步
    A.ang += A.speed * dt * 0.06;
    const nx = Math.cos(A.ang) * A.rad, nz = Math.sin(A.ang) * A.rad;
    const ny = FC.terrainHeight(nx, nz);
    o.position.set(nx, ny, nz);
    const yaw = Math.atan2(Math.cos(A.ang), Math.sin(A.ang)) + Math.PI / 2;
    o.rotation.y = yaw;
    o.rotation.x = 0;
    // 走路起伏
    o.position.y += Math.abs(Math.sin(T * 2.4)) * 0.05;
    if (A.stateT <= 0) {
      A.state = 'graze';
      A.stateT = FC.rand(3, 9);
    }
  }
};

/* ---------- 蝴蝶 ---------- */
FC.Creatures.prototype.updButterflies = function (dt, T, vis) {
  const three = FC.THREE;
  const M = this._tM, Q = this._tQ, P = this._tP, S = this._tS, R = this._tR;

  for (let i = 0; i < this.bfData.length; i++) {
    const d = this.bfData[i];
    // 重新选中心点（漫游）
    d.retarget -= dt;
    if (d.retarget <= 0) {
      d.retarget = FC.rand(3, 7);
      d.cx += d.driftX * FC.rand(1.5, 4);
      d.cz += d.driftZ * FC.rand(1.5, 4);
      // 限制在花园区内
      const dcx = (d.cx - FC.CLEARING.cx) / FC.CLEARING.rx;
      const dcz = (d.cz - FC.CLEARING.cz) / FC.CLEARING.rz;
      const dd = Math.hypot(dcx, dcz) || 1;
      if (dd > 1.0) {
        d.cx = FC.CLEARING.cx + dcx / dd * FC.CLEARING.rx * 0.9;
        d.cz = FC.CLEARING.cz + dcz / dd * FC.CLEARING.rz * 0.9;
      }
      d.baseY = FC.terrainHeight(d.cx, d.cz);
      d.rad = 0.5 + Math.random() * 1.9;
    }
    d.ang += d.angSpeed * dt;

    const px = d.cx + Math.cos(d.ang) * d.rad;
    const pz = d.cz + Math.sin(d.ang) * d.rad;
    const py = d.baseY + 0.55 + d.vertAmp * (0.5 + 0.5 * Math.sin(T * d.vertSpeed + d.vertPhase))
             + Math.sin(T * 1.1 + d.vertPhase * 2) * 0.10;

    P.set(px, py, pz);
    // 朝向运动方向
    const tangX = -Math.sin(d.ang) * Math.sign(d.angSpeed);
    const tangZ = Math.cos(d.ang) * Math.sign(d.angSpeed);
    const yaw = Math.atan2(tangX, tangZ);
    Q.setFromEuler(this._tE.set(0, yaw, 0));
    S.setScalar(d.size * 2.1);
    M.compose(P, Q, S);

    /* 振翅：翅膀已在 XZ 平面、根部在枢轴，
       所以绕 Z 轴旋转就是"上下扇动"（左右翼方向相反 → 对称） */
    const flap = Math.sin(T * d.flap + d.flapPhase);
    const ang = flap * 0.95;                    // 扇动幅度
    this.bfWings.forEach(w => {
      R.makeRotationZ(w.side * ang);
      this._tM2.multiplyMatrices(M, R);
      w.im.setMatrixAt(i, this._tM2);
    });

    // 身体
    this.bfBodies.setMatrixAt(i, M);
  }
  this.bfWings.forEach(w => {
    w.im.instanceMatrix.needsUpdate = true;
    w.im.material.opacity = vis;
  });
  this.bfBodies.instanceMatrix.needsUpdate = true;
  this.bfBodies.material.opacity = vis;
  this.bfBodies.material.transparent = vis < 0.99;
};

/* ---------- 蜜蜂 ---------- */
FC.Creatures.prototype.updBees = function (dt, T, vis) {
  const three = FC.THREE;
  const M = this._tM, Q = this._tQ, S = this._tS, R = this._tR;
  const dir = this._tDir;

  for (let i = 0; i < this.beeData.length; i++) {
    const b = this.beeData[i];
    b.retarget -= dt;
    if (b.retarget <= 0) {
      b.retarget = FC.rand(0.5, 2.2);
      // 在花丛附近随机选花点
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 0.95;
      const tx = FC.CLEARING.cx + Math.cos(a) * r * FC.CLEARING.rx;
      const tz = FC.CLEARING.cz + Math.sin(a) * r * FC.CLEARING.rz;
      b.target.set(tx, FC.terrainHeight(tx, tz) + 0.30 + Math.random() * 0.55, tz);
    }
    dir.subVectors(b.target, b.pos);
    const dist = dir.length();
    if (dist > 0.05) {
      dir.normalize();
      // 布朗式抖动
      dir.x += (Math.random() - .5) * 0.9;
      dir.y += (Math.random() - .5) * 0.7;
      dir.z += (Math.random() - .5) * 0.9;
      dir.normalize();
      const sp = b.speed * (dist < 0.5 ? 0.35 : 1);
      b.pos.addScaledVector(dir, sp * dt);
    }
    // 悬停微抖
    const hover = Math.sin(T * 14 + b.hoverPhase) * 0.012;
    this._tPos.set(b.pos.x, b.pos.y + hover, b.pos.z);

    // 朝向：对准目标
    const yaw = dist > 0.1 ? Math.atan2(dir.x, dir.z) : 0;
    const pitch = dist > 0.1 ? -Math.asin(FC.clamp(dir.y, -1, 1)) * 0.5 : 0;
    Q.setFromEuler(this._tE.set(pitch, yaw, 0, 'YXZ'));
    S.setScalar(b.size);
    M.compose(this._tPos, Q, S);
    this.beeIM.setMatrixAt(i, M);

    /* 翅膀：高频振动。蜜蜂翅膀几何同样摊平（rotateX）后再挂，
       所以绕 Z 轴抖动即为扇翅 */
    const flap = Math.abs(Math.sin(T * b.flap + b.flapPhase)) * 1.25 + 0.18;
    this.beeWings.forEach(w => {
      R.makeRotationZ(w.side * flap);
      this._tM2.multiplyMatrices(M, R);
      w.im.setMatrixAt(i, this._tM2);
    });
  }
  this.beeIM.instanceMatrix.needsUpdate = true;
  this.beeWings.forEach(w => {
    w.im.instanceMatrix.needsUpdate = true;
    w.im.material.opacity = 0.5 * vis;
  });
};

/* ---------- 蚂蚁：沿小径爬行 ---------- */
FC.Creatures.prototype.updAnts = function (dt, T) {
  const three = FC.THREE;
  const M = new three.Matrix4();
  const Q = new three.Quaternion();
  const S = new three.Vector3();
  const pts = this.terrain.pathPts;
  const total = pts.length - 1;

  for (let i = 0; i < this.antData.length; i++) {
    const a = this.antData[i];
    a.t += dt * a.speed * a.dir;
    // 循环
    if (a.t > 1) a.t = 0;
    if (a.t < 0) a.t = 1;
    const fi = a.t * total;
    const i0 = Math.min(total - 1, Math.floor(fi));
    const f = fi - i0;
    const p0 = pts[i0], p1 = pts[i0 + 1];
    const x = p0.x + (p1.x - p0.x) * f + a.offset * Math.cos(fi * 0.9);
    const z = p0.y + (p1.y - p0.y) * f + a.offset * Math.sin(fi * 0.9);
    const y = FC.terrainHeight(x, z) + 0.022;
    const yaw = Math.atan2(p1.x - p0.x, p1.y - p0.y) + (a.dir < 0 ? Math.PI : 0);
    Q.setFromEuler(new three.Euler(0, yaw, 0));
    S.set(0.5, 0.36, 0.9);
    M.compose(new three.Vector3(x, y, z), Q, S);
    this.antIM.setMatrixAt(i, M);
  }
  this.antIM.instanceMatrix.needsUpdate = true;
};

/* ---------- 小动物受主光影响：阴影开关 ---------- */
FC.Creatures.prototype.setQuality = function (q) {
  const shadow = q !== 'low';
  this.animals.forEach(A => {
    if (A.obj) A.obj.traverse(o => { if (o.isMesh) o.castShadow = shadow; });
  });
};
