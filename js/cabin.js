/* ============================================================
   cabin.js —— 林间小屋
   外部：木墙 / 人字屋顶 / 烟囱 / 门廊 / 石阶 / 发光窗户 / 提灯
   内部：地板 / 墙 / 桌子 + 书籍 + 台灯 / 床 / 壁炉 / 书架 /
         地毯 / 吊灯 / 挂画 / 厨具 / 木箱
   ============================================================ */
FC.Cabin = function (scene, quality) {
  const three = FC.THREE;
  this.scene = scene;
  this.quality = quality || 'mid';
  this.group = new three.Group();
  this.group.name = 'cabin';
  scene.add(this.group);

  /* 尺寸常量（外部其它模块会引用）
     参考图里的小屋是"横向舒展、厚实低矮"的木屋：
     纵深比宽度更小、墙高不高、屋顶厚重 → 有蹲坐感 */
  this.W = 3.90;      // 半宽（X 方向）
  this.D = 2.95;      // 半深（Z 方向）
  this.HW = 2.86;     // 墙高（比原来矮，更敦实）
  this.RH = 2.30;     // 屋脊相对墙顶的额外高度（屋顶更高耸）
  this.DOOR_W = 1.24; // 双扇门
  this.DOOR_H = 2.05;

  /* 室内灯状态 */
  this.lampOn = false;
  this.lampLevel = 0;          // 平滑后的亮度
  this.fireOn = true;

  this.lights = [];
  this.buildExterior();
  this.buildInterior();
  this.buildLights();
  this.buildDoor();
};

/* ============================================================
   外部
   ============================================================ */
FC.Cabin.prototype.buildExterior = function () {
  const three = FC.THREE;
  const W = this.W, D = this.D, H = this.HW;
  const g = this.group;

  /* ---------- 石砌地基 ---------- */
  const baseGeos = [];
  const rng = FC.rng(1010);
  for (let y = 0; y < 3; y++) {
    for (let x = -W - 0.28; x < W + 0.28; x += 0.52) {
      for (let z = -D - 0.28; z < D + 0.28; z += 0.52) {
        const edge = (Math.abs(x) > W - 0.1 || Math.abs(z) > D - 0.1);
        if (!edge && y < 2) continue;      // 内部掏空，省三角形
        const s = 0.24 + rng() * 0.09;
        const gg = new three.BoxGeometry(0.5, 0.3, 0.5);
        FC.placeNonUniform(gg, x + (rng() - .5) * .06, -0.72 + y * 0.30, z + (rng() - .5) * .06,
                           1, 1, 1, rng() * 0.7);
        // 轻微鼓包
        const p = gg.attributes.position;
        for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (1 + (rng() - .5) * .07), p.getY(k), p.getZ(k) * (1 + (rng() - .5) * .07));
        gg.computeVertexNormals();
        FC.tintGeo(gg, rng() < .34 ? '#8b8577' : (rng() < .6 ? '#7a7568' : '#98907f'));
        baseGeos.push(gg);
      }
    }
  }
  const baseMesh = new three.Mesh(FC.mergeGeos(baseGeos), FC.matVertex({ rough: .98 }));
  baseMesh.receiveShadow = true; baseMesh.castShadow = true;
  g.add(baseMesh);

  /* ---------- 木墙：横向木板条（逐层堆叠，低模圆木感） ----------
     关键：每层木板遇到门窗位置要断开，否则窗户和门会被埋住 */
  const wallGeos = [];
  const ROWS = 11;
  const LOG_H = (H - 0.10) / (ROWS - 1);      // 精确铺到墙顶，不留缝
  const LOG_D = 0.32;
  const rows = ROWS;
  const W2 = W + 0.06;                       // 墙面外沿半宽
  // 前墙：门居中，左右各一窗
  const doorHole = { a: -this.DOOR_W / 2, b: this.DOOR_W / 2 };
  const winF = { w: 0.92, h: 0.86, y0: 1.34 };       // 窗洞下沿
  const winL = { a: -W2 * 0.62 - 0.46, b: -W2 * 0.62 + 0.46 };
  const winR = { a:  W2 * 0.62 - 0.46, b:  W2 * 0.62 + 0.46 };
  // 后墙：两窗
  const winB1 = { a: -W2 * 0.58 - 0.42, b: -W2 * 0.58 + 0.42 };
  const winB2 = { a:  W2 * 0.58 - 0.42, b:  W2 * 0.58 + 0.42 };
  // 侧墙：一窗
  const winS = { w: 1.00, h: 0.80, y0: 1.42 };
  const sideHoleA = { a: -1.02, b: 0.02 };
  const sideHoleB = { a: -1.06, b: -0.06 };
  const winTop = 2.24;

  const addLog = (x, y, z, len, ry, hex) => {
    const gg = new three.CylinderGeometry(LOG_D * 0.5, LOG_D * 0.5, len, 6, 1);
    gg.rotateZ(Math.PI / 2);
    FC.placeNonUniform(gg, x, y, z, 1, 1, 1, ry);
    FC.tintGeo(gg, hex);
    wallGeos.push(gg);
  };

  const woodTones = [FC.PAL.wood, FC.PAL.woodLite, '#7d5330', '#93613a', '#6f4a2c'];

  for (let r = 0; r < rows; r++) {
    const y = 0.10 + r * LOG_H;
    const tone = woodTones[r % woodTones.length];
    const t2 = woodTones[(r + 2) % woodTones.length];
    const toneAt = () => (rng() < .5 ? tone : t2);

    // —— 前墙（z = +D）：门两侧 + 窗上下都得断开
    const fHoles = [doorHole];
    if (y + LOG_D * 0.5 > winF.y0 && y - LOG_D * 0.5 < winTop) fHoles.push(winL, winR);
    FC.splitSpans(-W2, W2, fHoles).forEach(sp => {
      addLog((sp[0] + sp[1]) / 2, y, D, sp[1] - sp[0], 0, toneAt());
    });

    // —— 后墙（z = -D）
    const bHoles = [];
    if (y + LOG_D * 0.5 > 1.52 && y - LOG_D * 0.5 < 2.28) bHoles.push(winB1, winB2);
    FC.splitSpans(-W2, W2, bHoles).forEach(sp => {
      addLog((sp[0] + sp[1]) / 2, y, -D, sp[1] - sp[0], 0, toneAt());
    });

    // —— 左墙（x = -W）与右墙（x = +W）
    [-1, 1].forEach(s => {
      const hole = s < 0 ? sideHoleA : sideHoleB;
      const sHoles = [];
      if (y + LOG_D * 0.5 > winS.y0 && y - LOG_D * 0.5 < winS.y0 + winS.h) sHoles.push(hole);
      FC.splitSpans(-D - 0.16, D + 0.16, sHoles).forEach(sp => {
        addLog(s * W, y, (sp[0] + sp[1]) / 2, sp[1] - sp[0], Math.PI / 2, toneAt());
      });
    });
  }

  /* 山墙（三角形填充）：用几层递减的横木近似 */
  for (let r = 0; r < 8; r++) {
    const t = r / 8;
    const y = H + 0.10 + t * (this.RH - 0.26);
    const halfW = W * (1 - t) * 0.99;
    if (halfW < 0.16) break;
    [-1, 1].forEach(s => {
      const gg = new three.CylinderGeometry(LOG_D * 0.44, LOG_D * 0.44, halfW * 2, 6, 1);
      gg.rotateZ(Math.PI / 2);
      FC.placeNonUniform(gg, 0, y, s * D * 0.985, 1, 1, 1, 0);
      FC.tintGeo(gg, woodTones[(r + 1) % woodTones.length]);
      wallGeos.push(gg);
    });
  }
  /* 门框立柱 + 门楣（把门洞包出边框感） */
  [-1, 1].forEach(s => {
    const post = new three.BoxGeometry(0.20, this.DOOR_H + 0.26, 0.34);
    FC.placeNonUniform(post, s * (this.DOOR_W / 2 + 0.10), (this.DOOR_H + 0.26) / 2, D + 0.02, 1, 1, 1, 0);
    FC.tintGeo(post, '#5a3a20');
    wallGeos.push(post);
  });
  const lintel = new three.BoxGeometry(this.DOOR_W + 0.44, 0.20, 0.36);
  FC.placeNonUniform(lintel, 0, this.DOOR_H + 0.16, D + 0.02, 1, 1, 1, 0);
  FC.tintGeo(lintel, '#5a3a20');
  wallGeos.push(lintel);

  /* 四角立柱 */
  [[-W, -D], [W, -D], [-W, D], [W, D]].forEach(c => {
    const gg = new three.BoxGeometry(0.36, H + 0.2, 0.36);
    FC.placeNonUniform(gg, c[0], (H + 0.2) / 2, c[1], 1, 1, 1, 0);
    FC.tintGeo(gg, '#54381f');
    wallGeos.push(gg);
  });
  const wallMesh = new three.Mesh(FC.mergeGeos(wallGeos), FC.matVertex({ rough: .93 }));
  wallMesh.castShadow = true; wallMesh.receiveShadow = true;
  g.add(wallMesh);

  /* ---------- 屋顶：两坡人字 + 厚重挑檐 ----------
     参考图里屋顶是一大块厚重的"帽子"，出檐深、颜色偏冷灰绿，
     和暖木色墙体形成对比，这是整个小屋的辨识特征 */
  const roofGeos = [];
  const OVER = 0.95;                  // 出檐加大 → 更敦实
  const RW = W + OVER, RD = D + OVER;
  const slope = Math.atan2(this.RH, RW);
  const panelLen = Math.hypot(RW, this.RH) + 0.14;
  const ROOF_T = 0.28;                // 屋顶厚度
  [-1, 1].forEach(s => {
    const gg = new three.BoxGeometry(panelLen, ROOF_T, RD * 2, 6, 1, 4);
    // 表面轻微起伏，模拟木瓦
    const p = gg.attributes.position;
    for (let k = 0; k < p.count; k++) {
      p.setY(k, p.getY(k) + (rng() - .5) * 0.05);
    }
    gg.computeVertexNormals();
    const q = new three.Quaternion().setFromEuler(new three.Euler(0, 0, -s * slope));
    const mid = new three.Vector3(s * RW * 0.5, H + this.RH * 0.5 - 0.02, 0);
    const m = new three.Matrix4().compose(mid, q, new three.Vector3(1, 1, 1));
    gg.applyMatrix4(m);
    FC.tintGeo(gg, s < 0 ? '#6b4a2e' : '#7a5636');
    roofGeos.push(gg);

    // 屋面上的瓦楞条（顺坡方向）
    for (let i = 0; i < 6; i++) {
      const t = 0.10 + i * 0.165;
      const strip = new three.BoxGeometry(0.075, 0.06, RD * 2 - 0.06);
      const lm = new three.Matrix4().compose(
        new three.Vector3(s * RW * (1 - t * 0.94), H + this.RH * t * 0.95 + 0.15, 0),
        q, new three.Vector3(1, 1, 1));
      strip.applyMatrix4(lm);
      FC.tintGeo(strip, '#5a3d24');
      roofGeos.push(strip);
    }
    // 檐口封板（让出檐有厚度感）
    const fascia = new three.BoxGeometry(0.16, 0.34, RD * 2);
    const fm = new three.Matrix4().compose(
      new three.Vector3(s * (RW + 0.04), H - 0.10, 0),
      new three.Quaternion(), new three.Vector3(1, 1, 1));
    fascia.applyMatrix4(fm);
    FC.tintGeo(fascia, '#5a3d24');
    roofGeos.push(fascia);
    // 侧面封板
    [-1, 1].forEach(zs => {
      const sf = new three.BoxGeometry(panelLen * 0.98, 0.30, 0.14);
      const sm = new three.Matrix4().compose(
        new three.Vector3(s * RW * 0.5, H + this.RH * 0.46, zs * RD),
        q, new three.Vector3(1, 1, 1));
      sf.applyMatrix4(sm);
      FC.tintGeo(sf, '#5a3d24');
      roofGeos.push(sf);
    });
  });
  /* 屋脊 */
  const ridge = new three.BoxGeometry(0.46, 0.26, RD * 2 + 0.20);
  FC.placeNonUniform(ridge, 0, H + this.RH + 0.04, 0, 1, 1, 1, 0);
  FC.tintGeo(ridge, '#553a22');
  roofGeos.push(ridge);
  /* 山墙护板 + 檐下斜撑（参考图里山墙有一圈竖向木条收边） */
  [-1, 1].forEach(s => {
    [-1, 1].forEach(xs => {
      const br = new three.BoxGeometry(0.12, 0.12, 1.55);
      br.rotateX(Math.PI / 4 * 0.72);
      br.translate(xs * W * 0.44, H + this.RH * 0.40, s * (D + 0.20));
      FC.tintGeo(br, '#4e3320');
      roofGeos.push(br);
    });
    // 山墙竖向护板
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const hw = W * (1 - t) * 0.92;
      if (hw < 0.2) continue;
      const pl = new three.BoxGeometry(hw * 2, 0.16, 0.10);
      pl.translate(0, H + 0.22 + t * (this.RH - 0.52), s * (D + 0.15));
      FC.tintGeo(pl, '#7a5636');
      roofGeos.push(pl);
    }
  });
  const roofMesh = new three.Mesh(FC.mergeGeos(roofGeos), FC.matVertex({ rough: .95 }));
  roofMesh.castShadow = true; roofMesh.receiveShadow = true;
  g.add(roofMesh);

  /* ---------- 山墙圆窗（参考图正面山墙上那个圆窗，夜里会亮） ---------- */
  const gwR = 0.33, gwY = H + this.RH * 0.30, gwZ = D + 0.17;
  const gwGroup = new three.Group();
  gwGroup.position.set(0, gwY, gwZ);
  // 窗框（圆环）
  const gwRing = new three.Mesh(
    new three.TorusGeometry(gwR, 0.048, 6, 16),
    FC.matVertex({ rough: .9 })
  );
  FC.tintGeo(gwRing.geometry, '#5c3d23');
  gwGroup.add(gwRing);
  // 十字窗棂
  const gwBarG = [];
  const gb1 = new three.BoxGeometry(gwR * 2, 0.05, 0.05);
  const gb2 = new three.BoxGeometry(0.05, gwR * 2, 0.05);
  FC.tintGeo(gb1, '#5c3d23'); FC.tintGeo(gb2, '#5c3d23');
  gwBarG.push(gb1, gb2);
  const gwBars = new three.Mesh(FC.mergeGeos(gwBarG), FC.matVertex({ rough: .9 }));
  gwGroup.add(gwBars);
  // 玻璃（夜里发光）
  this.gableGlass = new three.MeshStandardMaterial({
    color: new three.Color('#8fb0c4'), emissive: new three.Color('#ffc270'),
    emissiveIntensity: 0, roughness: .16, metalness: .04,
    transparent: true, opacity: .55, side: three.DoubleSide
  });
  const gwPane = new three.Mesh(new three.CircleGeometry(gwR * 0.96, 18), this.gableGlass);
  gwPane.position.z = -0.015;
  gwGroup.add(gwPane);
  g.add(gwGroup);

  /* ---------- 烟囱 ----------
     ⚠️ 烟囱必须只从屋面以上开始。原来从 y=H*0.35 起砌，
     室内就会多出一根顶着天花板的巨柱，非常碍眼。
     位置也对齐壁炉，让"壁炉→烟道→烟囱"在一条线上。 */
  const chimGeos = [];
  const CX = -W + 0.35, CZ = -1.05;        // 与室内壁炉同轴
  const CHIM_BASE = H + 0.22;              // 从屋面附近起
  const CHIM_ROWS = 9, CHIM_STEP = 0.30;
  for (let i = 0; i < CHIM_ROWS; i++) {
    const gg = new three.BoxGeometry(0.70, CHIM_STEP, 0.60);
    const p = gg.attributes.position;
    for (let k = 0; k < p.count; k++) p.setXYZ(k, p.getX(k) * (1 + (rng() - .5) * .06), p.getY(k), p.getZ(k) * (1 + (rng() - .5) * .06));
    gg.computeVertexNormals();
    gg.translate(CX + (rng() - .5) * .05, CHIM_BASE + i * CHIM_STEP, CZ + (rng() - .5) * .05);
    FC.tintGeo(gg, rng() < .3 ? '#8e8474' : (rng() < .5 ? '#a09486' : '#7d7466'));
    chimGeos.push(gg);
  }
  const CHIM_TOP = CHIM_BASE + CHIM_ROWS * CHIM_STEP;
  // 烟囱帽
  const cap = new three.BoxGeometry(0.90, 0.12, 0.80);
  cap.translate(CX, CHIM_TOP + 0.05, CZ);
  FC.tintGeo(cap, '#6d6255'); chimGeos.push(cap);
  const cap2 = new three.BoxGeometry(0.58, 0.26, 0.48);
  cap2.translate(CX, CHIM_TOP + 0.22, CZ);
  FC.tintGeo(cap2, '#5a5044'); chimGeos.push(cap2);
  this.chimTop = new THREE.Vector3(CX, CHIM_TOP + 0.30, CZ);
  const chimMesh = new three.Mesh(FC.mergeGeos(chimGeos), FC.matVertex({ rough: .97 }));
  chimMesh.castShadow = true; chimMesh.receiveShadow = true;
  g.add(chimMesh);

  /* ---------- 门廊 + 立柱 + 石阶 ---------- */
  const porchGeos = [];
  // 门廊顶
  const pRoof = new three.BoxGeometry(3.5, 0.13, 1.5);
  pRoof.rotateX(-0.24);
  pRoof.translate(0, H - 0.06, D + 0.62);
  FC.tintGeo(pRoof, FC.PAL.roof); porchGeos.push(pRoof);
  // 立柱
  [-1.55, 1.55].forEach(x => {
    const c = new three.CylinderGeometry(0.10, 0.12, H - 0.1, 6);
    c.translate(x, (H - 0.1) / 2, D + 1.22);
    FC.tintGeo(c, '#6e4a2b'); porchGeos.push(c);
    // 柱头托木（横向，抵住门廊顶）
    const br = new three.BoxGeometry(0.12, 0.12, 0.52);
    br.translate(x * 0.93, H - 0.16, D + 1.02);
    FC.tintGeo(br, '#5c3d23'); porchGeos.push(br);
  });
  // 门廊地板
  const pf = new three.BoxGeometry(3.4, 0.12, 1.36);
  pf.translate(0, -0.02, D + 0.6);
  FC.tintGeo(pf, '#7a5330'); porchGeos.push(pf);
  const porchMesh = new three.Mesh(FC.mergeGeos(porchGeos), FC.matVertex({ rough: .94 }));
  porchMesh.castShadow = true; porchMesh.receiveShadow = true;
  g.add(porchMesh);

  /* 台阶（三级石板） */
  const stepGeos = [];
  for (let i = 0; i < 3; i++) {
    const s = new three.BoxGeometry(1.9 - i * 0.12, 0.20, 0.42);
    s.translate(0, -0.10 - i * 0.20, D + 1.32 + i * 0.42);
    FC.tintGeo(s, i % 2 ? '#8f8878' : '#9d9585');
    stepGeos.push(s);
    // 石板缝隙随机小块
    for (let k = 0; k < 2; k++) {
      const c = new three.BoxGeometry(0.3, 0.14, 0.3);
      c.translate((rng() - .5) * 1.6, -0.06 - i * 0.20, D + 1.32 + i * 0.42 + (rng() - .5) * .3);
      FC.tintGeo(c, '#877f70'); stepGeos.push(c);
    }
  }
  const stepMesh = new three.Mesh(FC.mergeGeos(stepGeos), FC.matVertex({ rough: .98 }));
  stepMesh.castShadow = true; stepMesh.receiveShadow = true;
  g.add(stepMesh);

  /* ---------- 窗户（对齐墙洞：发光玻璃 + 十字窗棂 + 双扇） ----------
     窗口位置必须和上面挖的洞一致，否则窗框会浮在木板里 */
  this.windows = [];
  const winDefs = [
    { x: -W2 * 0.62, y: 1.77, z: D - 0.06, w: 0.92, h: 0.86, ry: 0,        face: 'z+' },
    { x:  W2 * 0.62, y: 1.77, z: D - 0.06, w: 0.92, h: 0.86, ry: 0,        face: 'z+' },
    { x: -W2 * 0.58, y: 1.90, z: -D + 0.06, w: 0.84, h: 0.76, ry: Math.PI,  face: 'z-' },
    { x:  W2 * 0.58, y: 1.90, z: -D + 0.06, w: 0.84, h: 0.76, ry: Math.PI,  face: 'z-' },
    { x: -W + 0.10, y: 1.82, z: -0.50, w: 1.02, h: 0.80, ry: Math.PI / 2, face: 'x-' },
    { x:  W - 0.10, y: 1.82, z: -0.56, w: 0.98, h: 0.80, ry: -Math.PI / 2, face: 'x+' }
  ];
  winDefs.forEach((wd, idx) => {
    const wg = new three.Group();
    wg.position.set(wd.x, wd.y, wd.z);
    wg.rotation.y = wd.ry;

    // 窗框（外框 + 中挺 + 十字棂）
    const frameG = [];
    const fT = 0.10;
    const mkF = (w, h, x, y, z) => { const b = new three.BoxGeometry(w, h, 0.11); b.translate(x, y, z); FC.tintGeo(b, '#5c3d23'); frameG.push(b); };
    mkF(wd.w + fT * 2, fT, 0,  wd.h / 2 + fT / 2, 0.02);
    mkF(wd.w + fT * 2, fT, 0, -wd.h / 2 - fT / 2, 0.02);
    mkF(fT, wd.h + fT * 2, -wd.w / 2 - fT / 2, 0, 0.02);
    mkF(fT, wd.h + fT * 2,  wd.w / 2 + fT / 2, 0, 0.02);
    mkF(0.055, wd.h, 0, 0, 0.05);                       // 中挺
    mkF(wd.w, 0.045, 0, 0.06, 0.05);                    // 横棂
    mkF(wd.w, 0.045, 0, -0.14, 0.05);
    const fm = new three.Mesh(FC.mergeGeos(frameG), FC.matVertex({ rough: .88 }));
    fm.castShadow = true; wg.add(fm);

    // 玻璃：白天半透（能看见屋内/屋外），夜里发光
    const glassMat = new three.MeshStandardMaterial({
      color: new three.Color('#8fb0c4'), emissive: new three.Color('#ffc270'),
      emissiveIntensity: 0, roughness: .14, metalness: .04,
      transparent: true, opacity: .40, side: three.DoubleSide
    });
    const glass = new three.Mesh(new three.PlaneGeometry(wd.w, wd.h), glassMat);
    glass.position.z = 0.0;
    wg.add(glass);

    // 窗光晕（贴在窗外，夜里溢光）
    const halo = new three.Mesh(
      new three.PlaneGeometry(wd.w * 2.1, wd.h * 2.1),
      new three.MeshBasicMaterial({
        map: FC.makeGlowTexture(), color: new three.Color('#ffbe66'),
        transparent: true, opacity: 0, blending: three.AdditiveBlending,
        depthWrite: false, side: three.DoubleSide
      })
    );
    halo.position.z = 0.09;
    wg.add(halo);

    // 窗帘（室内那侧，两片）
    const curtG = [];
    [-1, 1].forEach(s => {
      const c = new three.BoxGeometry(wd.w * 0.32, wd.h * 1.02, 0.035);
      c.translate(s * wd.w * 0.34, 0, -0.14);
      FC.tintGeo(c, s < 0 ? '#a8443c' : '#9a3c36');
      curtG.push(c);
    });
    const curt = new three.Mesh(FC.mergeGeos(curtG), FC.matVertex({ rough: .98 }));
    wg.add(curt);

    // 窗台花箱（仅正面两窗）
    if (idx < 2) {
      const boxG = [];
      const bx = new three.BoxGeometry(wd.w + 0.20, 0.22, 0.32);
      bx.translate(0, -wd.h / 2 - 0.24, -0.14); FC.tintGeo(bx, '#6b4527'); boxG.push(bx);
      for (let i = 0; i < 8; i++) {
        const f = FC.blob(0.095 + rng() * 0.065, 0, .5, rng() < .4 ? FC.PAL.rosePink : '#4d7d39');
        FC.place(f, -wd.w / 2 + (i / 7) * wd.w, -wd.h / 2 - 0.10, -0.15, 1, rng() * 6.28);
        boxG.push(f);
      }
      const bm = new three.Mesh(FC.mergeGeos(boxG), FC.matVertex({ rough: .9 }));
      bm.castShadow = true; wg.add(bm);
    }

    this.windows.push({ group: wg, glassMat, halo, face: wd.face });
    g.add(wg);
  });

  /* ---------- 门口提灯 ---------- */
  const lanternG = new three.Group();
  lanternG.position.set(1.62, 2.62, D + 0.30);
  const lFrame = [];
  const lp = new three.CylinderGeometry(0.02, 0.02, 0.34, 5);
  lp.translate(0, 0.30, 0); FC.tintGeo(lp, '#2e2620'); lFrame.push(lp);
  const lc = new three.CylinderGeometry(0.13, 0.16, 0.26, 6);
  lc.translate(0, 0.02, 0); FC.tintGeo(lc, '#3a322b'); lFrame.push(lc);
  const lt = new three.CylinderGeometry(0.10, 0.22, 0.10, 6);
  lt.translate(0, 0.20, 0); FC.tintGeo(lt, '#2e2620'); lFrame.push(lt);
  const lm = new three.Mesh(FC.mergeGeos(lFrame), FC.matVertex({ rough: .8 }));
  lm.castShadow = true; lanternG.add(lm);

  this.lanternGlass = new three.Mesh(
    new three.CylinderGeometry(0.098, 0.12, 0.22, 6, 1, true),
    new three.MeshStandardMaterial({
      color: '#ffcf88', emissive: new THREE.Color('#ffb347'), emissiveIntensity: 0,
      roughness: .3, metalness: 0, transparent: true, opacity: .88, side: three.DoubleSide
    })
  );
  this.lanternGlass.position.y = 0.02;
  lanternG.add(this.lanternGlass);

  this.lanternGlow = new three.Sprite(new three.SpriteMaterial({
    map: FC.makeGlowTexture(), color: new THREE.Color('#ffc070'),
    transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false
  }));
  this.lanternGlow.scale.set(1.9, 1.9, 1);
  lanternG.add(this.lanternGlow);
  g.add(lanternG);
  this.lantern = lanternG;

  /* ---------- 屋檐吊灯 ×4：夜 / 雨 / 雾自动点亮 ----------
     门廊顶前缘两盏 + 左右主屋檐（檐口封板下）各一盏。
     亮度由 update() 按"天色暗度"驱动，白天熄灭、坏天气亮起。 */
  this.eaveLamps = [];
  const mkEaveLamp = (x, yTop, z, withLight) => {
    const lg = new three.Group();
    lg.position.set(x, yTop, z);
    // 吊杆 + 伞形灯帽
    const rod = new three.CylinderGeometry(0.018, 0.018, 0.16, 5);
    rod.translate(0, -0.08, 0);
    FC.tintGeo(rod, '#2e2620');
    const ecap = new three.CylinderGeometry(0.045, 0.15, 0.12, 6);
    ecap.translate(0, -0.20, 0);
    FC.tintGeo(ecap, '#33302a');
    const lm2 = new three.Mesh(FC.mergeGeos([rod, ecap]), FC.matVertex({ rough: .8 }));
    lm2.castShadow = true;
    lg.add(lm2);
    // 灯泡（夜里自发光）
    const glassMat = new three.MeshStandardMaterial({
      color: '#ffd9a0', emissive: new three.Color('#ffb95e'), emissiveIntensity: 0,
      roughness: .35, metalness: 0
    });
    const bulb = new three.Mesh(new three.SphereGeometry(0.075, 8, 6), glassMat);
    bulb.position.y = -0.30;
    lg.add(bulb);
    // 光晕
    const glow = new three.Sprite(new three.SpriteMaterial({
      map: FC.makeGlowTexture(), color: new three.Color('#ffc070'),
      transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false
    }));
    glow.scale.set(1.15, 1.15, 1);
    glow.position.y = -0.30;
    lg.add(glow);
    // 点光（低画质不加，省性能）
    let light = null;
    if (withLight) {
      light = new three.PointLight(new three.Color('#ffb870'), 0, 4.6, 2.0);
      light.position.y = -0.34;
      light.castShadow = false;
      lg.add(light);
    }
    g.add(lg);
    this.eaveLamps.push({ glassMat, glow, light });
  };
  // 门廊顶前缘两盏（顶板底面 ≈ H-0.20，灯泡垂到 ≈ H-0.58，高于门楣、不挡路）
  mkEaveLamp(-1.30, H - 0.18, D + 0.98, this.quality !== 'low');
  mkEaveLamp( 1.30, H - 0.18, D + 0.98, this.quality !== 'low');
  // 左右主屋檐各一盏（檐口封板底 ≈ H-0.27）
  mkEaveLamp(-(RW + 0.02), H - 0.28, 0.60, this.quality !== 'low');
  mkEaveLamp(  RW + 0.02,  H - 0.28, 0.60, this.quality !== 'low');

  /* 门口地垫 */
  const mat = new three.BoxGeometry(0.9, 0.05, 0.5);
  mat.translate(0, -0.04, D + 1.42);
  const mm = new three.Mesh(mat, FC.mat('#7a5a3c', { rough: 1 }));
  mm.receiveShadow = true;
  g.add(mm);

  /* 门口两盆花 */
  [-1.95, 1.95].forEach(x => {
    const pot = new three.CylinderGeometry(0.20, 0.15, 0.30, 6);
    pot.translate(x, 0.13, D + 0.95);
    const pm = new three.Mesh(pot, FC.mat('#9a5a3c', { rough: .95 }));
    pm.castShadow = true; g.add(pm);
    const bushG = [];
    for (let i = 0; i < 7; i++) {
      const f = FC.blob(0.11 + rng() * 0.08, 0, .5, rng() < .5 ? FC.PAL.roseRed : '#4a7a36');
      FC.place(f, x + (rng() - .5) * .3, 0.36 + rng() * .22, D + 0.95 + (rng() - .5) * .3, 1, rng() * 6.28);
      bushG.push(f);
    }
    const bm = new three.Mesh(FC.mergeGeos(bushG), FC.matVertex({ rough: .9 }));
    bm.castShadow = true; g.add(bm);
  });

  /* 柴堆 */
  const woodG = [];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 5 - r; i++) {
      const lg = new three.CylinderGeometry(0.09, 0.10, 1.05, 6);
      lg.rotateZ(Math.PI / 2);
      lg.translate(-W - 1.15 + (rng() - .5) * .08, 0.11 + r * 0.19, -1.4 + (i + r * 0.5) * 0.22);
      FC.tintGeo(lg, rng() < .5 ? '#6b4a2c' : '#7d5836');
      woodG.push(lg);
    }
  }
  const wm = new three.Mesh(FC.mergeGeos(woodG), FC.matVertex({ rough: .96 }));
  wm.castShadow = true; wm.receiveShadow = true; g.add(wm);
};

/* ============================================================
   内部
   ============================================================ */
FC.Cabin.prototype.buildInterior = function () {
  const three = FC.THREE;
  const W = this.W - 0.15, D = this.D - 0.15, H = this.HW - 0.1;
  this.inW = W; this.inD = D; this.inH = H;
  const g = new three.Group();
  g.name = 'interior';
  this.group.add(g);
  this.interior = g;
  const rng = FC.rng(3030);
  const V = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); };

  /* ---------- 室内四壁 ----------
     两面都要看得到（从室内看内壁、从室外透过窗洞看进来），所以用 DoubleSide。
     ⚠️ 关键：内壁必须和外墙的窗洞对齐开洞，否则窗洞会被内壁糊死，
     白天进屋就是个大黑盒，自然光完全进不来。 */
  const wallMat = FC.mat('#bd8f5e', { rough: .95, side: three.DoubleSide });
  const wallW = W * 2, wallD = D * 2;
  const mkWallWithHoles = (w, h, x, y, z, ry, holes) => {
    const geo = FC.planeMinusRects(w, h, holes);
    if (!geo) return null;
    const p = new three.Mesh(geo, wallMat);
    p.position.set(x, y, z);
    p.rotation.y = ry || 0;
    p.receiveShadow = true;
    g.add(p);
    return p;
  };
  // 窗洞在世界坐标里的位置（必须与 buildExterior 的 winDefs 一致）
  const W2i = this.W + 0.06;
  const fWinX = W2i * 0.62, fWinW = 0.92, fWinY0 = 1.34, fWinY1 = 2.24;
  const bWinX = W2i * 0.58, bWinW = 0.84, bWinY0 = 1.52, bWinY1 = 2.28;
  const sWinZ = -0.50, sWinZ2 = -0.56, sWinW = 1.02, sWinW2 = 0.98, sWinY0 = 1.42, sWinY1 = 2.22;

  // —— 后墙（z = -D，rotation.y = 0，局部 x 与世界 x 同向）
  mkWallWithHoles(wallW, H, 0, H / 2, -D, 0, [
    { x0: wallW / 2 - bWinX - bWinW / 2, x1: wallW / 2 - bWinX + bWinW / 2, y0: bWinY0, y1: bWinY1 },
    { x0: wallW / 2 + bWinX - bWinW / 2, x1: wallW / 2 + bWinX + bWinW / 2, y0: bWinY0, y1: bWinY1 }
  ]);
  // —— 左墙（x = -W，rotation.y = +π/2，局部 x = -世界 z → 需镜像）
  //    外墙左窗在世界 z=-0.50 处，映射到内壁局部 x = +0.50
  mkWallWithHoles(wallD, H, -W, H / 2, 0, Math.PI / 2, [
    { x0: wallD / 2 - sWinZ - sWinW / 2, x1: wallD / 2 - sWinZ + sWinW / 2, y0: sWinY0, y1: sWinY1 }
  ]);
  // —— 右墙（x = +W，rotation.y = -π/2，局部 x = 世界 z）
  mkWallWithHoles(wallD, H, W, H / 2, 0, -Math.PI / 2, [
    { x0: wallD / 2 + sWinZ2 - sWinW2 / 2, x1: wallD / 2 + sWinZ2 + sWinW2 / 2, y0: sWinY0, y1: sWinY1 }
  ]);
  // —— 前墙（z = +D，rotation.y = π，局部 x = -世界 x）：门 + 左右窗
  mkWallWithHoles(wallW, H, 0, H / 2, D, Math.PI, [
    { x0: wallW / 2 - this.DOOR_W / 2, x1: wallW / 2 + this.DOOR_W / 2, y0: 0, y1: this.DOOR_H },
    { x0: wallW / 2 + fWinX - fWinW / 2, x1: wallW / 2 + fWinX + fWinW / 2, y0: fWinY0, y1: fWinY1 },
    { x0: wallW / 2 - fWinX - fWinW / 2, x1: wallW / 2 - fWinX + fWinW / 2, y0: fWinY0, y1: fWinY1 }
  ]);
  // 天花板（朝下）
  const ceil = new three.Mesh(new three.PlaneGeometry(wallW, wallD), wallMat);
  ceil.position.set(0, H, 0);
  ceil.rotation.x = Math.PI / 2;
  ceil.receiveShadow = true;
  g.add(ceil);

  /* 踢脚线（沿四壁一圈，视觉上把墙和地板咬合） */
  const skirtG = [];
  const gapH = this.DOOR_W / 2;   // 前墙踢脚线在门洞处断开半宽
  const mkSkirt = (w, x, z, ry) => {
    const b = new three.BoxGeometry(w, 0.12, 0.05);
    b.translate(0, 0, 0);
    if (ry) b.rotateY(ry);
    b.translate(x, 0.06, z);
    FC.tintGeo(b, '#6b4527');
    skirtG.push(b);
  };
  mkSkirt(W * 2, 0, -D + 0.03, 0);
  mkSkirt(D * 2, -W + 0.03, 0, Math.PI / 2);
  mkSkirt(D * 2,  W - 0.03, 0, Math.PI / 2);
  mkSkirt(W - gapH, -(gapH + (W - gapH) / 2), D - 0.03, 0);
  mkSkirt(W - gapH,  (gapH + (W - gapH) / 2), D - 0.03, 0);
  V(new three.Mesh(FC.mergeGeos(skirtG), FC.matVertex({ rough: .9 })));

  /* ---------- 地板：木板条 ---------- */
  const floorG = [];
  const FN = 17;
  for (let i = 0; i < FN; i++) {
    const w = (W * 2 + 0.6) / FN;
    const p = new three.BoxGeometry(w - 0.015, 0.06, D * 2 + 0.6);
    p.translate(-W - 0.3 + w * (i + 0.5), 0.03, 0);
    FC.tintGeo(p, i % 3 === 0 ? '#8a5f36' : (i % 3 === 1 ? '#7d5630' : '#946a3e'));
    floorG.push(p);
  }
  V(new three.Mesh(FC.mergeGeos(floorG), FC.matVertex({ rough: .88 })));

  /* ============================================================
     室内平面（内空 x∈[-3.75,3.75]，z∈[-2.80,2.80]，高 2.76）
     ------------------------------------------------------------
        z=-2.80 ┌─────────────────────────────┐  z=-2.80
                │ 梯子+阁楼口   挂衣架        │
                │                             │
                │ [壁炉]     [地毯]   [床]    │  ← 左墙 / 右墙
                │            [桌][椅] [柜]    │
                │ 木箱                        │
        z=+2.80 └──────[ 门 ]────────[书架]───┘  z=+2.80
              x=-3.75                    x=+3.75
     ============================================================ */

  /* 地毯 */
  const rugG = [];
  const rc = new three.CircleGeometry(1.55, 12);
  rc.rotateX(-Math.PI / 2);
  rc.scale(1, 1, 1.25);
  FC.tintGeo(rc, '#a8443c');
  rugG.push(rc);
  const rc2 = new three.CircleGeometry(1.22, 12);
  rc2.rotateX(-Math.PI / 2); rc2.scale(1, 1, 1.25);
  rc2.translate(0, 0.004, 0);
  FC.tintGeo(rc2, '#8e3830');
  rugG.push(rc2);
  for (let i = 0; i < 26; i++) {
    const a = rng() * 6.28, r = 0.5 + rng() * 0.95;
    const d = new three.CircleGeometry(0.09 + rng() * 0.06, 4);
    d.rotateX(-Math.PI / 2);
    d.translate(Math.cos(a) * r, 0.008, Math.sin(a) * r * 1.25);
    FC.tintGeo(d, ['#d8b878', '#c09a5c', '#7a2f28'][(rng() * 3) | 0]);
    rugG.push(d);
  }
  const rug = new three.Mesh(FC.mergeGeos(rugG), FC.matVertex({ rough: .98, flat: false }));
  rug.position.set(-0.25, 0.06, 0.55);
  rug.receiveShadow = true;
  g.add(rug);

  /* ---------- 桌子 ---------- */
  const tableG = [];
  const TT_Y = 0.76, TT_W = 1.28, TT_D = 0.72;
  const top = new three.BoxGeometry(TT_W, 0.075, TT_D);
  top.translate(0, TT_Y, 0);
  FC.tintGeo(top, '#9a6636'); tableG.push(top);
  // 桌沿
  const skirt = new three.BoxGeometry(TT_W, 0.10, TT_D);
  skirt.translate(0, TT_Y - 0.09, 0);
  FC.tintGeo(skirt, '#7d5330'); tableG.push(skirt);
  // 四腿
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(c => {
    const l = new three.BoxGeometry(0.085, TT_Y, 0.085);
    l.translate(c[0] * (TT_W / 2 - 0.09), TT_Y / 2 - 0.03, c[1] * (TT_D / 2 - 0.09));
    FC.tintGeo(l, '#6b4527'); tableG.push(l);
  });
  // 横撑
  const strut = new three.BoxGeometry(TT_W - 0.2, 0.06, 0.06);
  strut.translate(0, 0.22, -TT_D / 2 + 0.09); FC.tintGeo(strut, '#6b4527'); tableG.push(strut);
  const strut2 = strut.clone(); strut2.translate(0, 0, TT_D - 0.18); FC.tintGeo(strut2, '#6b4527'); tableG.push(strut2);

  const table = new three.Mesh(FC.mergeGeos(tableG), FC.matVertex({ rough: .87 }));
  table.position.set(-0.30, 0.06, 0.55);
  V(table);
  this.tablePos = table.position.clone();

  /* ---------- 桌上的书 ---------- */
  const bookG = [];
  const bookDefs = [
    { x: -0.30, z: 0.06, w: 0.24, h: 0.045, d: 0.33, r: 0.06,  c: '#a83c3c', c2: '#e8e0cc' },
    { x: -0.26, z: 0.02, w: 0.23, h: 0.040, d: 0.31, r: -0.05, c: '#2f6b52', c2: '#e8e0cc' },
    { x: -0.33, z: -0.01,w: 0.22, h: 0.038, d: 0.30, r: 0.11,  c: '#3f4f8a', c2: '#efe4d0' },
    { x: 0.12,  z: -0.10,w: 0.20, h: 0.085, d: 0.28, r: -0.28, c: '#8a5a2c', c2: '#e8e0cc' }
  ];
  bookDefs.forEach(b => {
    const cover = new three.BoxGeometry(b.w, b.h, b.d);
    const pages = new three.BoxGeometry(b.w * 0.93, b.h * 0.72, b.d * 0.97);
    const mg = new three.Group();
    const cm = new three.Matrix4().compose(
      new three.Vector3(b.x, TT_Y + 0.037 + b.h / 2, b.z),
      new three.Quaternion().setFromEuler(new three.Euler(0, b.r, 0)),
      new three.Vector3(1, 1, 1));
    cover.applyMatrix4(cm); FC.tintGeo(cover, b.c); bookG.push(cover);
    const pm = new three.Matrix4().compose(
      new three.Vector3(b.x, TT_Y + 0.037 + b.h / 2, b.z + b.d * 0.012),
      new three.Quaternion().setFromEuler(new three.Euler(0, b.r, 0)),
      new three.Vector3(1, 1, 1));
    pages.applyMatrix4(pm); FC.tintGeo(pages, b.c2); bookG.push(pages);
  });
  /* 一本摊开的书 */
  const openL = new three.BoxGeometry(0.20, 0.022, 0.29);
  const openR = new three.BoxGeometry(0.20, 0.022, 0.29);
  openL.translate(-0.105, 0, 0); openR.translate(0.105, 0, 0);
  const og = new three.Group();
  const om = new three.Matrix4().compose(
    new three.Vector3(0.30, TT_Y + 0.05, 0.16),
    new three.Quaternion().setFromEuler(new three.Euler(0, 0.34, 0)),
    new three.Vector3(1, 1, 1));
  const ol2 = openL.clone(); ol2.applyMatrix4(om); FC.tintGeo(ol2, '#efe6d2'); bookG.push(ol2);
  const or2 = openR.clone(); or2.applyMatrix4(om); FC.tintGeo(or2, '#efe6d2'); bookG.push(or2);
  // 摊开书上的文字线
  for (let i = 0; i < 5; i++) {
    const tl = new three.BoxGeometry(0.13, 0.004, 0.012);
    tl.translate(-0.105, 0.013, -0.09 + i * 0.045);
    tl.applyMatrix4(om); FC.tintGeo(tl, '#9a8f78'); bookG.push(tl);
    const tr = new three.BoxGeometry(0.13, 0.004, 0.012);
    tr.translate(0.105, 0.013, -0.09 + i * 0.045);
    tr.applyMatrix4(om); FC.tintGeo(tr, '#9a8f78'); bookG.push(tr);
  }
  const tableY = this.tablePos.y;
  const bookMesh = new three.Mesh(FC.mergeGeos(bookG), FC.matVertex({ rough: .82 }));
  bookMesh.position.set(this.tablePos.x, tableY, this.tablePos.z);
  V(bookMesh);

  /* ---------- 台灯（可开关，核心交互） ---------- */
  this.buildLamp(this.tablePos.x + 0.38, tableY + TT_Y + 0.037, this.tablePos.z - 0.06);

  /* 茶杯 + 墨水瓶 + 羽毛笔 */
  const miscG = [];
  const cup = new three.CylinderGeometry(0.055, 0.045, 0.085, 8);
  cup.translate(this.tablePos.x - 0.02, tableY + TT_Y + 0.085, this.tablePos.z + 0.26);
  FC.tintGeo(cup, '#e8e2d4'); miscG.push(cup);
  const ink = new three.BoxGeometry(0.075, 0.08, 0.075);
  ink.translate(this.tablePos.x + 0.30, tableY + TT_Y + 0.082, this.tablePos.z + 0.24);
  FC.tintGeo(ink, '#2a2f3a'); miscG.push(ink);
  const quill = new three.CylinderGeometry(0.004, 0.012, 0.3, 4);
  quill.rotateZ(0.55); quill.rotateX(0.2);
  quill.translate(this.tablePos.x + 0.42, tableY + TT_Y + 0.20, this.tablePos.z + 0.22);
  FC.tintGeo(quill, '#e8e0cc'); miscG.push(quill);
  // 小蜡烛
  const candle = new three.CylinderGeometry(0.035, 0.04, 0.16, 6);
  candle.translate(this.tablePos.x - 0.36, tableY + TT_Y + 0.12, this.tablePos.z + 0.22);
  FC.tintGeo(candle, '#efe6cc'); miscG.push(candle);
  const cbase = new three.CylinderGeometry(0.075, 0.075, 0.02, 8);
  cbase.translate(this.tablePos.x - 0.36, tableY + TT_Y + 0.048, this.tablePos.z + 0.22);
  FC.tintGeo(cbase, '#6a6a62'); miscG.push(cbase);
  const mV = new three.Mesh(FC.mergeGeos(miscG), FC.matVertex({ rough: .78 }));
  V(mV);

  /* ---------- 椅子（拉在桌旁） ---------- */
  const chG = [];
  const CS = 0.42, CH = 0.45;
  const seat = new three.BoxGeometry(CS, 0.06, CS);
  seat.translate(0, CH, 0); FC.tintGeo(seat, '#8a5f36'); chG.push(seat);
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(c => {
    const l = new three.BoxGeometry(0.05, CH, 0.05);
    l.translate(c[0] * (CS / 2 - 0.05), CH / 2, c[1] * (CS / 2 - 0.05));
    FC.tintGeo(l, '#6b4527'); chG.push(l);
  });
  // 靠背
  for (let i = 0; i < 3; i++) {
    const b = new three.BoxGeometry(CS, 0.055, 0.04);
    b.translate(0, CH + 0.22 + i * 0.15, -CS / 2 + 0.04);
    FC.tintGeo(b, '#7d5330'); chG.push(b);
  }
  [-1, 1].forEach(s => {
    const p = new three.BoxGeometry(0.05, 0.5, 0.05);
    p.translate(s * (CS / 2 - 0.05), CH + 0.25, -CS / 2 + 0.04);
    FC.tintGeo(p, '#6b4527'); chG.push(p);
  });
  const chair = new three.Mesh(FC.mergeGeos(chG), FC.matVertex({ rough: .88 }));
  chair.position.set(this.tablePos.x + 0.05, 0.06, this.tablePos.z + 1.04);
  chair.rotation.y = Math.PI + 0.20;
  V(chair);

  /* ---------- 床 ---------- */
  const bedG = [];
  const BW = 1.02, BL = 2.02, BH = 0.38;
  const bframe = new three.BoxGeometry(BW, BH, BL);
  bframe.translate(0, BH / 2, 0);
  FC.tintGeo(bframe, '#7d5330'); bedG.push(bframe);
  // 床垫
  const matt = new three.BoxGeometry(BW - 0.06, 0.20, BL - 0.06);
  matt.translate(0, BH + 0.10, 0);
  FC.tintGeo(matt, '#e8e0cc'); bedG.push(matt);
  // 被子
  const quilt = new three.BoxGeometry(BW - 0.04, 0.17, BL * 0.62);
  quilt.translate(0, BH + 0.24, BL * 0.16);
  FC.tintGeo(quilt, '#7a4a6b'); bedG.push(quilt);
  // 被子格纹
  for (let i = 0; i < 4; i++) {
    const s = new three.BoxGeometry(BW - 0.04, 0.02, 0.03);
    s.translate(0, BH + 0.33, BL * 0.16 - BL * 0.31 + i * (BL * 0.62 / 4));
    FC.tintGeo(s, '#9a6a86'); bedG.push(s);
  }
  // 枕头
  const pil = new three.BoxGeometry(BW - 0.26, 0.14, 0.36);
  pil.rotateX(0.12);
  pil.translate(0, BH + 0.28, -BL / 2 + 0.32);
  FC.tintGeo(pil, '#f4ede0'); bedG.push(pil);
  const pil2 = pil.clone(); pil2.translate(0, 0.045, 0.02); FC.tintGeo(pil2, '#e8dfc8'); bedG.push(pil2);
  // 床头板
  const hb = new three.BoxGeometry(BW + 0.10, 0.62, 0.08);
  hb.translate(0, BH + 0.34, -BL / 2 + 0.02);
  FC.tintGeo(hb, '#6b4527'); bedG.push(hb);
  const bed = new three.Mesh(FC.mergeGeos(bedG), FC.matVertex({ rough: .9 }));
  bed.position.set(W - 0.68, 0.06, -0.62);
  bed.rotation.y = -Math.PI / 2;
  V(bed);
  this.bedPos = bed.position.clone();

  /* ---------- 床头柜 + 小台灯 ---------- */
  const nsG = [];
  const ns = new three.BoxGeometry(0.46, 0.54, 0.40);
  ns.translate(0, 0.27, 0); FC.tintGeo(ns, '#8a5f36'); nsG.push(ns);
  const drawer = new three.BoxGeometry(0.36, 0.14, 0.03);
  drawer.translate(0, 0.34, 0.21); FC.tintGeo(drawer, '#6b4527'); nsG.push(drawer);
  const knob = new three.SphereGeometry(0.026, 6, 4);
  knob.translate(0, 0.34, 0.23); FC.tintGeo(knob, '#c8a45c'); nsG.push(knob);
  const nightstand = new three.Mesh(FC.mergeGeos(nsG), FC.matVertex({ rough: .88 }));
  nightstand.position.set(W - 0.66, 0.06, -1.92);
  nightstand.rotation.y = -Math.PI / 2;
  V(nightstand);
  // 柜上小夜灯
  this.buildNightLamp(W - 0.72, 0.06 + 0.54, -1.62);

  /* ---------- 壁炉 ---------- */
  const fpG = [];
  const FPW = 1.30, FPH = 1.30, FPD = 0.42;
  // 炉体
  const body = new three.BoxGeometry(FPW, FPH, FPD);
  body.translate(0, FPH / 2, 0); FC.tintGeo(body, '#8e8478'); fpG.push(body);
  // 炉口（挖空用深色内嵌盒表示）
  const mouth = new three.BoxGeometry(0.72, 0.66, 0.30);
  mouth.translate(0, 0.42, 0.14); FC.tintGeo(mouth, '#241a14'); fpG.push(mouth);
  // 炉台
  const mant = new three.BoxGeometry(FPW + 0.22, 0.11, FPD + 0.16);
  mant.translate(0, FPH + 0.05, 0.04); FC.tintGeo(mant, '#6b5a4a'); fpG.push(mant);
  // 石砖纹理块
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (Math.abs(c - 2) < 1 && r < 3) continue;     // 让出炉口
      const bs = new three.BoxGeometry(0.24, 0.24, 0.05);
      bs.translate(-FPW / 2 + 0.15 + c * 0.25, 0.14 + r * 0.235, FPD / 2 + 0.005);
      FC.tintGeo(bs, rng() < .4 ? '#9a8e7e' : (rng() < .6 ? '#a89c8c' : '#8a7e6e'));
      fpG.push(bs);
    }
  }
  const fireplace = new three.Mesh(FC.mergeGeos(fpG), FC.matVertex({ rough: .97 }));
  fireplace.position.set(-W + 0.26, 0.06, -1.05);
  fireplace.rotation.y = Math.PI / 2;
  V(fireplace);

  /* 炉火（发光面片 + 点光） */
  this.fire = new three.Group();
  this.fire.position.set(-W + 0.42, 0.58, -1.05);
  const fl = [];
  for (let i = 0; i < 9; i++) {
    const f = FC.blob(0.11 + rng() * 0.09, 0, .55, i < 4 ? '#ff9a3c' : (i < 7 ? '#ffc65c' : '#ff6a1e'));
    FC.place(f, (rng() - .5) * 0.34, rng() * 0.34 - 0.05, (rng() - .5) * 0.26, 1, rng() * 6.28);
    fl.push(f);
  }
  // 木柴
  for (let i = 0; i < 3; i++) {
    const lg = new three.CylinderGeometry(0.055, 0.06, 0.5, 5);
    lg.rotateZ(Math.PI / 2 + (rng() - .5) * .3);
    lg.rotateY((rng() - .5) * .7);
    lg.translate(0, -0.06 - i * 0.03, (rng() - .5) * 0.16);
    FC.tintGeo(lg, '#4a3524'); fl.push(lg);
  }
  this.fireMesh = new three.Mesh(FC.mergeGeos(fl), new three.MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: .55, metalness: 0,
    emissive: new three.Color('#ff8a2a'), emissiveIntensity: 1.5
  }));
  this.fire.add(this.fireMesh);
  this.fireGlow = new three.Sprite(new three.SpriteMaterial({
    map: FC.makeGlowTexture(), color: new THREE.Color('#ffa03c'),
    transparent: true, opacity: .85, blending: three.AdditiveBlending, depthWrite: false
  }));
  this.fireGlow.scale.set(2.6, 2.0, 1);
  this.fire.add(this.fireGlow);
  g.add(this.fire);

  /* ---------- 书架 ---------- */
  const shG = [];
  const SHW = 1.20, SHH = 1.55, SHD = 0.32;
  const back = new three.BoxGeometry(SHW, SHH, 0.04);
  back.translate(0, SHH / 2, -SHD / 2); FC.tintGeo(back, '#6b4527'); shG.push(back);
  [-1, 1].forEach(s => {
    const sd = new three.BoxGeometry(0.04, SHH, SHD);
    sd.translate(s * SHW / 2, SHH / 2, 0); FC.tintGeo(sd, '#7d5330'); shG.push(sd);
  });
  for (let i = 0; i < 4; i++) {
    const sh = new three.BoxGeometry(SHW, 0.035, SHD);
    sh.translate(0, i * SHH / 3.4 + 0.02, 0); FC.tintGeo(sh, '#7d5330'); shG.push(sh);
    // 书
    let bx = -SHW / 2 + 0.06;
    while (bx < SHW / 2 - 0.10) {
      const bw = 0.035 + rng() * 0.045;
      const bh = 0.19 + rng() * 0.09;
      const bd = 0.19 + rng() * 0.06;
      const skip = rng() < 0.10;
      if (!skip) {
        const b = new three.BoxGeometry(bw, bh, bd);
        b.translate(bx + bw / 2, i * SHH / 3.4 + 0.04 + bh / 2, 0.02);
        FC.tintGeo(b, ['#a83c3c', '#2f6b52', '#3f4f8a', '#8a5a2c', '#6b3a5c', '#c8a45c', '#4a6b7a'][(rng() * 7) | 0]);
        shG.push(b);
      } else bx += 0.10;
      bx += bw + 0.004;
    }
  }
  const shelf = new three.Mesh(FC.mergeGeos(shG), FC.matVertex({ rough: .86 }));
  shelf.position.set(W - 0.24, 0.06, 1.95);
  shelf.rotation.y = -Math.PI / 2;
  V(shelf);

  /* ---------- 挂画 ---------- */
  const artG = [];
  for (let i = 0; i < 2; i++) {
    const fw = 0.52, fh = 0.40;
    const fr = new three.BoxGeometry(fw, fh, 0.045);
    fr.translate(0, 0, 0); FC.tintGeo(fr, '#5c3d23'); artG.push(fr);
    const cv = new three.BoxGeometry(fw - 0.08, fh - 0.08, 0.02);
    cv.translate(0, 0, 0.025);
    FC.tintGeo(cv, i === 0 ? '#7a9a72' : '#c8a86a'); artG.push(cv);
    // 画里的内容：远山 + 太阳
    const h1 = new three.ConeGeometry(0.12, 0.16, 4);
    h1.translate(-0.04, -0.05, 0.04); FC.tintGeo(h1, i === 0 ? '#3d5f42' : '#7a5a3c'); artG.push(h1);
    const su = new three.CircleGeometry(0.035, 8);
    su.translate(0.11, 0.08, 0.04); FC.tintGeo(su, '#e8c46a'); artG.push(su);
  }
  const art = new three.Mesh(FC.mergeGeos(artG), FC.matVertex({ rough: .85 }));
  // 摆在书架上方的墙上
  const art1 = art.clone(); art1.position.set(W - 0.06, 1.95, 1.60); art1.rotation.y = -Math.PI / 2; g.add(art1);
  const art2 = art.clone(); art2.position.set(1.10, 1.95, -D + 0.06); g.add(art2);

  /* ---------- 吊灯（主照明，也随开关一起亮） ---------- */
  const chG2 = [];
  const chain = new three.CylinderGeometry(0.014, 0.014, 0.55, 4);
  chain.translate(0, H - 0.27, 0); FC.tintGeo(chain, '#3a322b'); chG2.push(chain);
  const ring = new three.TorusGeometry(0.20, 0.024, 5, 10);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, H - 0.57, 0); FC.tintGeo(ring, '#3a322b'); chG2.push(ring);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * 6.28;
    const arm = new three.CylinderGeometry(0.012, 0.012, 0.16, 4);
    arm.translate(Math.cos(a) * 0.09, H - 0.65, Math.sin(a) * 0.09);
    FC.tintGeo(arm, '#3a322b'); chG2.push(arm);
  }
  const chand = new three.Mesh(FC.mergeGeos(chG2), FC.matVertex({ rough: .8 }));
  chand.position.set(-0.20, 0, 0.25);
  g.add(chand);
  // 灯罩（发光）
  this.chandelierMat = new three.MeshStandardMaterial({
    color: '#ffd9a0', emissive: new three.Color('#ffc270'), emissiveIntensity: 0,
    roughness: .5, metalness: 0, transparent: true, opacity: .9, side: three.DoubleSide
  });
  const shade = new three.Mesh(new three.ConeGeometry(0.30, 0.24, 10, 1, true), this.chandelierMat);
  shade.rotation.x = Math.PI;
  shade.position.set(-0.20, H - 0.72, 0.25);
  g.add(shade);
  this.chandelierGlow = new three.Sprite(new three.SpriteMaterial({
    map: FC.makeGlowTexture(), color: new THREE.Color('#ffc070'),
    transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false
  }));
  this.chandelierGlow.scale.set(3.2, 3.2, 1);
  this.chandelierGlow.position.set(-0.20, H - 0.80, 0.25);
  g.add(this.chandelierGlow);

  /* ---------- 木箱 / 杂物 / 挂衣架 ---------- */
  const miscG2 = [];
  const crate = new three.BoxGeometry(0.62, 0.50, 0.54);
  crate.translate(0, 0.25, 0); FC.tintGeo(crate, '#8a6a44'); miscG2.push(crate);
  for (let i = 0; i < 3; i++) {
    const s = new three.BoxGeometry(0.62, 0.035, 0.54);
    s.translate(0, 0.12 + i * 0.17, 0); FC.tintGeo(s, '#6b5030'); miscG2.push(s);
  }
  const crate2 = new three.BoxGeometry(0.50, 0.42, 0.46);
  crate2.translate(0.02, 0.71, 0); FC.tintGeo(crate2, '#7d5f3c'); miscG2.push(crate2);
  const crates = new three.Mesh(FC.mergeGeos(miscG2), FC.matVertex({ rough: .95 }));
  crates.position.set(-W + 0.55, 0.06, 1.55);
  crates.rotation.y = 0.4;
  V(crates);

  // 挂衣架 + 大衣
  const hookG = [];
  const pole = new three.CylinderGeometry(0.03, 0.03, 1.5, 5);
  pole.translate(0, 0.75, 0); FC.tintGeo(pole, '#5c3d23'); hookG.push(pole);
  const bar = new three.CylinderGeometry(0.025, 0.025, 0.5, 5);
  bar.rotateZ(Math.PI / 2); bar.translate(0, 1.48, 0); FC.tintGeo(bar, '#5c3d23'); hookG.push(bar);
  const coat = new three.ConeGeometry(0.24, 0.66, 6, 1, true);
  coat.translate(-0.14, 1.14, 0); FC.tintGeo(coat, '#4a5a4a'); hookG.push(coat);
  const hookM = new three.Mesh(FC.mergeGeos(hookG), FC.matVertex({ rough: .92, side: three.DoubleSide }));
  hookM.position.set(0.95, 0.06, -D + 0.40);
  g.add(hookM);

  /* ---------- 梯子（通往阁楼，暗示二层；比楼梯省空间且不穿墙） ---------- */
  const stG = [];
  const LAD_LEN = 2.30;
  const LAD_ANG = 0.30;
  // 两根侧梁
  [-0.26, 0.26].forEach(x => {
    const r = new three.BoxGeometry(0.065, LAD_LEN, 0.055);
    r.rotateX(-LAD_ANG);
    r.translate(x, LAD_LEN / 2 * Math.cos(LAD_ANG), LAD_LEN / 2 * Math.sin(LAD_ANG));
    FC.tintGeo(r, '#6b4527'); stG.push(r);
  });
  // 横杆
  for (let i = 1; i <= 7; i++) {
    const t = i / 8;
    const s = new three.BoxGeometry(0.60, 0.05, 0.075);
    s.translate(0, LAD_LEN * t * Math.cos(LAD_ANG), LAD_LEN * t * Math.sin(LAD_ANG));
    FC.tintGeo(s, '#8a6a44'); stG.push(s);
  }
  const ladder = new three.Mesh(FC.mergeGeos(stG), FC.matVertex({ rough: .92 }));
  ladder.castShadow = true;
  // 靠在后墙左侧
  ladder.position.set(-W + 0.48, 0.06, -D + 0.55);
  ladder.rotation.y = 0;
  g.add(ladder);

  /* 阁楼开口（视觉暗示二层） */
  const hatch = new three.Mesh(
    new three.BoxGeometry(0.92, 0.05, 0.82),
    FC.mat('#4a3524', { rough: .95 })
  );
  hatch.position.set(-W + 0.58, H - 0.03, -D + 0.95);
  g.add(hatch);

  /* ---------- 阁楼横梁 ---------- */
  const beamG = [];
  for (let i = 0; i < 5; i++) {
    const b = new three.BoxGeometry(W * 2, 0.16, 0.18);
    b.translate(0, H - 0.10, -D + 0.5 + i * (D * 2 - 1.0) / 4);
    FC.tintGeo(b, '#5c3d23'); beamG.push(b);
  }
  const beams = new three.Mesh(FC.mergeGeos(beamG), FC.matVertex({ rough: .94 }));
  g.add(beams);

  /* ---------- 窗内发光面（让室内窗户在夜里也亮） ---------- */
  this.interiorPanels = [];
};

/* ---------- 桌上台灯 ---------- */
FC.Cabin.prototype.buildLamp = function (x, y, z) {
  const three = FC.THREE;
  const grp = new three.Group();
  grp.position.set(x, y, z);
  const gs = [];
  const bs = new three.CylinderGeometry(0.085, 0.10, 0.022, 10);
  bs.translate(0, 0.011, 0); FC.tintGeo(bs, '#4a3a2c'); gs.push(bs);
  const st = new three.CylinderGeometry(0.014, 0.018, 0.34, 5);
  st.translate(0, 0.19, 0); FC.tintGeo(st, '#3a2e22'); gs.push(st);
  const arm = new three.CylinderGeometry(0.033, 0.033, 0.03, 6);
  arm.rotateZ(Math.PI / 2);
  arm.translate(0, 0.36, 0); FC.tintGeo(arm, '#3a2e22'); gs.push(arm);
  const bm = new three.Mesh(FC.mergeGeos(gs), FC.matVertex({ rough: .72, metal: .15 }));
  bm.castShadow = true;
  grp.add(bm);

  // 灯罩
  this.lampShadeMat = new three.MeshStandardMaterial({
    color: new THREE.Color('#ffd9a8'), emissive: new THREE.Color('#ffc270'),
    emissiveIntensity: 0, roughness: .62, metalness: 0, side: three.DoubleSide, flatShading: true
  });
  const shade = new three.Mesh(new three.ConeGeometry(0.145, 0.19, 8, 1, true), this.lampShadeMat);
  shade.rotation.x = Math.PI;
  shade.position.set(0, 0.40, 0);
  grp.add(shade);

  // 灯泡核心
  this.lampCoreMat = new three.MeshBasicMaterial({ color: new three.Color('#ffdca0') });
  const core = new three.Mesh(new three.SphereGeometry(0.042, 7, 5), this.lampCoreMat);
  core.position.set(0, 0.35, 0);
  grp.add(core);

  // 光晕
  this.lampGlow = new three.Sprite(new three.SpriteMaterial({
    map: FC.makeGlowTexture(), color: new THREE.Color('#ffc070'),
    transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false
  }));
  this.lampGlow.scale.set(1.5, 1.5, 1);
  this.lampGlow.position.set(0, 0.38, 0);
  grp.add(this.lampGlow);

  this.interior.add(grp);
  this.lamp = grp;
};

/* ---------- 床边小夜灯 ---------- */
FC.Cabin.prototype.buildNightLamp = function (x, y, z) {
  const three = FC.THREE;
  const grp = new three.Group();
  grp.position.set(x, y, z);
  const gs = [];
  const bs = new three.CylinderGeometry(0.07, 0.085, 0.02, 8);
  bs.translate(0, 0.01, 0); FC.tintGeo(bs, '#4a3a2c'); gs.push(bs);
  const st = new three.CylinderGeometry(0.012, 0.016, 0.20, 5);
  st.translate(0, 0.11, 0); FC.tintGeo(st, '#3a2e22'); gs.push(st);
  grp.add(new three.Mesh(FC.mergeGeos(gs), FC.matVertex({ rough: .72 })));
  this.nightShadeMat = new three.MeshStandardMaterial({
    color: new THREE.Color('#e8d8b8'), emissive: new THREE.Color('#ffb070'),
    emissiveIntensity: 0, roughness: .7, metalness: 0, side: three.DoubleSide, flatShading: true
  });
  const shade = new three.Mesh(new three.ConeGeometry(0.10, 0.14, 7, 1, true), this.nightShadeMat);
  shade.rotation.x = Math.PI;
  shade.position.set(0, 0.235, 0);
  grp.add(shade);
  this.nightGlow = new three.Sprite(new three.SpriteMaterial({
    map: FC.makeGlowTexture(), color: new THREE.Color('#ffb070'),
    transparent: true, opacity: 0, blending: three.AdditiveBlending, depthWrite: false
  }));
  this.nightGlow.scale.set(1.0, 1.0, 1);
  this.nightGlow.position.set(0, 0.22, 0);
  grp.add(this.nightGlow);
  this.interior.add(grp);
};

/* ============================================================
   室内灯光（点光）
   ============================================================ */
FC.Cabin.prototype.buildLights = function () {
  const three = FC.THREE;

  // 台灯点光
  const lampPos = new three.Vector3(
    this.tablePos.x + 0.38,
    0.06 + 0.76 + 0.40,
    this.tablePos.z - 0.06
  );
  this.lampLight = new three.PointLight(new three.Color('#ffc070'), 0, 6.5, 1.8);
  this.lampLight.position.copy(lampPos);
  this.lampLight.castShadow = false;
  this.group.add(this.lampLight);

  // 吊灯点光
  this.ceilLight = new three.PointLight(new three.Color('#ffcf90'), 0, 10.5, 1.6);
  this.ceilLight.position.set(0, this.inH - 0.9, 0.05);
  this.ceilLight.castShadow = false;
  this.group.add(this.ceilLight);

  // 壁炉点光
  this.fireLight = new three.PointLight(new three.Color('#ff8f35'), 0.9, 5.5, 2.0);
  this.fireLight.position.set(-this.W + 0.60, 0.70, -1.05);
  this.group.add(this.fireLight);

  // 夜灯
  this.nightLight = new three.PointLight(new three.Color('#ffa860'), 0, 3.4, 2.0);
  this.nightLight.position.set(this.W - 0.66, 0.06 + 0.78, -1.92);
  this.group.add(this.nightLight);

  // 门口提灯光
  this.doorLight = new three.PointLight(new three.Color('#ffb870'), 0, 5.0, 2.0);
  this.doorLight.position.set(1.62, 2.60, this.D + 0.35);
  this.group.add(this.doorLight);

  // 室内整体补光（保证进屋后能看清陈设，不依赖主光穿透）
  this.roomFill = new three.PointLight(new three.Color('#fff2e0'), 0, 9, 1.7);
  this.roomFill.position.set(-0.20, 1.85, 0.30);
  this.group.add(this.roomFill);
};

/* ============================================================
   门（双扇对开动画）
   ============================================================ */
FC.Cabin.prototype.buildDoor = function () {
  const three = FC.THREE;
  const D = this.D, W = this.DOOR_W, H = this.DOOR_H;
  const half = W / 2;
  this.doorPivots = [];

  [-1, 1].forEach(s => {
    const pivot = new three.Group();
    // 合页在外侧：左扇轴在 -W/2，右扇轴在 +W/2
    pivot.position.set(s * half, 0, D + 0.01);

    const gs = [];
    const panel = new three.BoxGeometry(half - 0.02, H, 0.10);
    panel.translate(-s * half / 2 + s * 0.01, H / 2, 0);
    FC.tintGeo(panel, '#7d5330'); gs.push(panel);
    // 门板横纹
    for (let i = 0; i < 4; i++) {
      const st = new three.BoxGeometry(half - 0.16, 0.032, 0.032);
      st.translate(-s * half / 2 + s * 0.01, 0.28 + i * (H - 0.6) / 3, 0.055);
      FC.tintGeo(st, '#6b4527'); gs.push(st);
    }
    // Z 形斜撑（木门的经典做法，视觉上很"乡土"）
    const brace = new three.BoxGeometry(half - 0.18, 0.075, 0.036);
    brace.rotateZ(s * 0.52);
    brace.translate(-s * half / 2 + s * 0.01, H * 0.52, 0.058);
    FC.tintGeo(brace, '#5c3d23'); gs.push(brace);

    const doorMesh = new three.Mesh(FC.mergeGeos(gs), FC.matVertex({ rough: .9 }));
    doorMesh.castShadow = true;
    pivot.add(doorMesh);

    // 门把手（内侧）
    const knob = new three.SphereGeometry(0.042, 8, 6);
    knob.translate(-s * (half - 0.20), H * 0.48, 0.085);
    pivot.add(new three.Mesh(knob, FC.mat('#c8a45c', { rough: .35, metal: .7 })));
    const plate = new three.CylinderGeometry(0.055, 0.055, 0.02, 8);
    plate.rotateX(Math.PI / 2);
    plate.translate(-s * (half - 0.20), H * 0.48, 0.05);
    pivot.add(new three.Mesh(plate, FC.mat('#a8843c', { rough: .4, metal: .7 })));

    this.group.add(pivot);
    this.doorPivots.push({ pivot, side: s });
  });

  this.doorTarget = 0;
  this.doorOpen = 0;
};

/* ============================================================
   每帧更新：灯光 / 门 / 炉火闪烁 / 烟囱烟
   ============================================================ */
FC.Cabin.prototype.update = function (dt, env, targetLamp) {
  const three = FC.THREE;
  this.time = (this.time || 0) + dt;

  /* --- 室内灯开关平滑 --- */
  const goal = targetLamp ? 1 : 0;
  this.lampLevel = FC.damp(this.lampLevel, goal, 4.5, dt);
  const L = this.lampLevel;
  const t = this.time;          // 提前声明：屋檐吊灯的闪烁也用它
  // 阴天 / 夜晚即使没开灯，也让窗户透一点环境光，避免全黑
  const envGlow = FC.clamp(1 - env.cur.sunIntensity / 2.2, 0, 1) * 0.14;

  /* --- 台灯 --- */
  // ⚠️ 白天室外自然光已经把室内照亮，此时灯具若仍全功率 → 室内严重过曝（一片白）。
  //    按室外太阳强度反推"夜色因子 nightF"：晴天约 0.34、夜里约 0.89。
  const nightF = FC.clamp(1 - env.cur.sunIntensity / 2.6, 0.34, 1);
  const Lg = L * nightF;                        // 灯光强度
  const Le = L * (0.5 + 0.5 * nightF);          // 自发光（灯罩/光晕），略亮以保留"亮着"观感
  if (this.lampLight) this.lampLight.intensity = Lg * 2.3;
  if (this.lampShadeMat) this.lampShadeMat.emissiveIntensity = Le * 2.4;
  if (this.lampGlow) this.lampGlow.material.opacity = Le * 0.85;
  if (this.lampCoreMat) this.lampCoreMat.color.setRGB(
    Math.pow(0.35 + Le * 0.65, 2.2), Math.pow(0.28 + Le * 0.58, 2.2), Math.pow(0.22 + Le * 0.42, 2.2)
  );

  /* --- 吊灯 --- */
  if (this.ceilLight) this.ceilLight.intensity = Lg * 1.55;
  if (this.chandelierMat) this.chandelierMat.emissiveIntensity = Le * 1.35;
  if (this.chandelierGlow) this.chandelierGlow.material.opacity = Le * 0.55;
  if (this.roomFill) this.roomFill.intensity = Lg * 0.42;

  /* --- 夜灯 --- */
  if (this.nightLight) this.nightLight.intensity = Lg * 1.1;
  if (this.nightShadeMat) this.nightShadeMat.emissiveIntensity = Le * 1.8;
  if (this.nightGlow) this.nightGlow.material.opacity = Le * 0.6;

  /* --- 窗户发光：夜里点亮；白天保持半透（能从室内看见外面） ---
     ⚠️ winGlow 必须同样乘夜色因子，否则晴天开灯时窗玻璃会整片发白过曝 */
  const winGlow = Math.max(L * nightF, envGlow);
  this.windows.forEach((w) => {
    w.glassMat.emissiveIntensity = winGlow * 1.9;
    w.glassMat.color.setStyle('#8fb0c4').multiplyScalar(1 - winGlow * 0.55);
    w.glassMat.opacity = 0.40 + winGlow * 0.34;
    w.halo.material.opacity = winGlow * 0.50 * (env.cur.fogDensity > 0.03 ? 1.5 : 1.0);
  });
  // 山墙圆窗同步发光
  if (this.gableGlass) {
    this.gableGlass.emissiveIntensity = winGlow * 1.7;
    this.gableGlass.color.setStyle('#8fb0c4').multiplyScalar(1 - winGlow * 0.5);
    this.gableGlass.opacity = 0.55 + winGlow * 0.3;
  }

  /* --- 门口提灯：天色越暗越亮 --- */
  const dark = FC.clamp(1 - env.cur.sunIntensity / 1.9, 0, 1);
  const dl = Math.max(dark * 0.9, L * 0.8);
  if (this.lanternGlass) this.lanternGlass.material.emissiveIntensity = dl * 2.2;
  if (this.lanternGlow) this.lanternGlow.material.opacity = dl * 0.7;
  if (this.doorLight) this.doorLight.intensity = dl * 1.5;

  /* --- 屋檐吊灯 ×4：夜 / 雨 / 雾自动点亮 ---
     晴天 sunIntensity≈2.35 → dark=0 熄灭；
     雾/雨 sunIntensity≈0.62 → dark≈0.67 亮起；
     夜晚 sunIntensity≈0.30 → dark≈0.84 最亮。
     dusk(2.0) 只有一丝微光，不算"坏天气"。 */
  if (this.eaveLamps) {
    const el = dark * (0.92 + 0.08 * Math.sin(t * 3.7));   // 轻微灯丝闪烁
    for (let i = 0; i < this.eaveLamps.length; i++) {
      const e = this.eaveLamps[i];
      const ph = i * 1.7;                                   // 每盏相位错开
      const f = el * (0.94 + 0.06 * Math.sin(t * 4.3 + ph));
      e.glassMat.emissiveIntensity = f * 2.6;
      e.glow.material.opacity = f * 0.62;
      if (e.light) e.light.intensity = f * 1.35;
    }
  }

  /* --- 炉火：闪烁 --- */
  const fl = 0.72 + 0.28 * Math.sin(t * 7.3) * Math.sin(t * 3.1) + 0.08 * Math.sin(t * 17.0);
  if (this.fireLight) this.fireLight.intensity = fl * (this.fireOn ? 1.15 : 0);
  if (this.fireMesh) {
    this.fireMesh.material.emissiveIntensity = fl * (this.fireOn ? 1.9 : 0);
    this.fireMesh.visible = this.fireOn;
    const sc = 0.94 + 0.10 * Math.sin(t * 5.1);
    this.fireMesh.scale.set(sc, 0.92 + 0.16 * Math.sin(t * 6.3), sc);
  }
  if (this.fireGlow) this.fireGlow.material.opacity = fl * (this.fireOn ? 0.72 : 0);

  /* --- 烟囱冒烟 --- */
  if (this.fireOn && env.cur.rain < 0.5) {
    if (!this.smoke) this.buildSmoke();
    this.smoke.visible = true;
    const u = this.smokeMat.uniforms;
    u.uTime.value = t;
    u.uFog.value = env.cur.fogDensity * 42;
    u.uColor.value.copy(env.cur.fogColor).lerp(new three.Color('#ffffff'), 0.30);
  } else if (this.smoke) {
    this.smoke.visible = false;
  }

  /* --- 门开合（双扇，各自向外开） --- */
  this.doorOpen = FC.damp(this.doorOpen, this.doorTarget, 3.4, dt);
  if (this.doorPivots) {
    this.doorPivots.forEach(d => {
      d.pivot.rotation.y = -d.side * this.doorOpen * 1.30;
    });
  }
};

/* ---------- 烟囱烟：GPU 粒子 ---------- */
FC.Cabin.prototype.buildSmoke = function () {
  const three = FC.THREE;
  const N = 90;
  const pos = new Float32Array(N * 3);
  const dat = new Float32Array(N * 2);
  const rng = FC.rng(8181);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rng() - .5) * 0.24;
    pos[i * 3 + 1] = rng();                    // 0~1 生命进度
    pos[i * 3 + 2] = (rng() - .5) * 0.24;
    dat[i * 2] = rng();                        // 相位
    dat[i * 2 + 1] = 0.7 + rng() * 0.8;        // 速度
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.BufferAttribute(pos, 3));
  g.setAttribute('aD', new three.BufferAttribute(dat, 2));

  this.smokeMat = new three.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uColor: { value: new three.Color('#d8d4cc') },
      uFog:   { value: 0.4 },
      uPR:    { value: 1 }
    },
    vertexShader: `
      attribute vec2 aD;
      uniform float uTime, uPR;
      varying float vLife;
      void main(){
        float life = fract(position.y + uTime * 0.055 * aD.y);
        vLife = life;
        vec3 p = position;
        p.y = life * 4.6;
        p.x += sin(uTime * 0.55 + aD.x * 6.28) * (0.28 + life * 1.5)
             + uTime * 0.0 + life * life * 1.1;
        p.z += cos(uTime * 0.42 + aD.x * 6.28) * (0.24 + life * 1.2);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (7.0 + life * 44.0) * uPR * (52.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uFog;
      varying float vLife;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if(d > 0.5) discard;
        // 出生淡入、消散淡出
        float a = pow(1.0 - d * 2.0, 1.9) * smoothstep(0.0, 0.14, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));
        vec3 col = mix(uColor, vec3(0.85,0.84,0.82), vLife);
        col = mix(col, vec3(0.72,0.76,0.74), uFog * 0.5);
        gl_FragColor = vec4(col, a * 0.4);
      }`,
    transparent: true,
    depthWrite: false
  });
  this.smoke = new three.Points(g, this.smokeMat);
  this.smoke.frustumCulled = false;
  if (this.chimTop) this.smoke.position.copy(this.chimTop);
  else this.smoke.position.set(-this.W + 0.35, this.HW + 3.0, -1.05);
  this.group.add(this.smoke);
};
