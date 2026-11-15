/* ============================================================
   godrays.js —— 丁达尔效应（体积光）系统
   三层叠加：① 太阳辉光  ② 锥形光柱（自定义着色器，加色混合）
             ③ 空气中的浮尘微粒
   ============================================================ */
FC.GodRays = function (scene, opts) {
  const three = FC.THREE;
  this.scene = scene;
  this.opts = opts || {};
  this.intensity = 1;              // 总强度
  this.targetIntensity = 1;
  this.enabled = true;
  this.mood = 1;                   // 光晕"融天"程度（天气切换时更新）
  this.group = new three.Group();
  this.group.name = 'godrays';
  scene.add(this.group);

  // 光源方向（由 main 每帧同步）
  this.dir = new three.Vector3(0.5, 0.42, 0.7).normalize();
  this.color = new three.Color('#ffd9a0');
  // ⚠️ 光柱的"顶"高度。原来是 42，光柱整体悬在 y≈22~42，
  //    而相机俯视 y≈1.5 的小屋 —— 光柱全部在画面上方之外，等于没画。
  //    压到树冠高度附近，让光柱真正落进画面。
  this.originHeight = 15.5;
  // ⚠️ 新增：光柱顶端的"融天高度"。光束顶点越接近这个高度，
  //    越要淡成天空的一部分（而不是一根白棍突然截止）。
  this.skyBlendH = 20.0;

  /* ---------------- ① 太阳辉光 ----------------
     ⚠️ 旧版辉光 56×56、opacity 0.9+，是个很扎眼的"白盘子"，
        和天空完全分离。现在改成两层大而极柔的辉光：
        外层巨大（≈200）几乎只有氛围，内层中等负责核心亮度，
        加起来像是天空本身在发光 —— 光束从这里"长"出来。 */
  const glowTex = FC.makeGlowTexture();
  this.sunHalo = new three.Sprite(new three.SpriteMaterial({
    map: glowTex, color: 0xffd9a0, transparent: true, opacity: 0,
    blending: three.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }));
  this.sunHalo.scale.set(210, 210, 1);
  this.group.add(this.sunHalo);

  this.sunGlow = new three.Sprite(new three.SpriteMaterial({
    map: glowTex, color: 0xffeccb, transparent: true, opacity: .55,
    blending: three.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }));
  this.sunGlow.scale.set(74, 74, 1);
  this.group.add(this.sunGlow);

  this.sunCore = new three.Sprite(new three.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true, opacity: .70,
    blending: three.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }));
  this.sunCore.scale.set(22, 22, 1);
  this.group.add(this.sunCore);

  /* ---------------- ② 锥形光柱 ---------------- */
  this.shaftMat = new three.ShaderMaterial({
    uniforms: {
      uColor:     { value: new three.Color('#ffd9a0') },
      uIntensity: { value: 1 },
      uTime:      { value: 0 },
      uOpacity:   { value: 1 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3  uColor;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vWorld;

      // 简易噪声，让光柱边缘有流动的絮状感
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main(){
        // 横向：中间亮、两侧大幅羽化（边缘更软 → 不像一块硬塑料片）
        float ex = smoothstep(0.0, 0.52, vUv.x) * smoothstep(1.0, 0.48, vUv.x);
        ex = pow(ex, 1.25);

        /* 纵向：不再是"顶端最亮、底部消散"的硬截止。
           ⚠️ 旧版 ey = pow(vUv.y, 1.65) 让光束顶端（vUv.y=1）最亮，
              于是每根光柱的头顶都是一条明亮的切口，看上去像插在天空里的白棍。
           现在改成"中上段最亮、顶端渐隐入天、底端柔和消散"的钟形：
           顶端 0.68→1.0 淡出，于是光束与天空是连起来的。 */
        float y  = clamp(vUv.y, 0.0, 1.0);
        float ey = smoothstep(0.0, 0.34, y) * (1.0 - smoothstep(0.66, 1.0, y));
        ey = pow(max(ey, 0.0), 1.15);

        // 流动絮状：横向更密（细丝感），纵向拉长（从天垂下的光缕）
        float n1 = noise(vec2(vUv.x * 6.2, vUv.y * 1.15 - uTime * 0.055));
        float n2 = noise(vec2(vUv.x * 2.4 + 11.0, vUv.y * 0.55 - uTime * 0.031));
        float n = 0.55 * n1 + 0.45 * n2;
        n = 0.56 + 0.44 * n;

        float a = ex * ey * n * uIntensity * uOpacity;
        if(a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false,
    side: three.DoubleSide
  });

  /* 光柱几何：被拉长的锥体（上宽下窄），斜射进林间空地
     ⚠️ 旧版长度 15~26、顶端固定在 y=15.5，光束在画面里就是"悬空的一截"，
        既够不到天、又扎不进地，看着很突兀。
        现在把光束顶推到 y≈24（树冠之上、接近天穹），长度拉到 26~46，
        配合着色器顶端的渐隐，光束看起来是"从天上垂下来"的。 */
  this.shafts = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    // 主光来自 +X 侧（sunAzi≈18°）：把光柱撒在小屋/空地一带，
    // 避免落到 z≈-24 的池塘上空空荡荡
    const ang = -0.35 + (i / (N - 1)) * 1.5 + (Math.random() - 0.5) * 0.22;
    const rad = FC.rand(6, 20);
    const topW = FC.rand(3.4, 7.4);      // 顶端宽度
    const len  = FC.rand(26, 46);        // 长度：足够从天上垂到林间
    const geo = new three.CylinderGeometry(topW, topW * 0.26, len, 7, 1, true);
    // 打开 UV 纵向铺满
    const uv = geo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k));
    const mesh = new three.Mesh(geo, this.shaftMat);
    mesh.frustumCulled = false;
    // ⚠️ 每根光柱必须独占材质实例，否则 baseOpacity / 近距离淡出全是死代码
    //    （共享材质 → 所有光柱只能同一亮度，粗细与强度完全一致，很假）
    mesh.material = this.shaftMat.clone();
    const sh = {
      mesh,
      mat: mesh.material,
      ang, rad,
      len,
      topW,
      swing: FC.rand(0, Math.PI * 2),
      speed: FC.rand(0.05, 0.16),
      baseOpacity: FC.rand(0.52, 1.0),
      yOff: FC.rand(-2.5, 4.0)
    };
    this.shafts.push(sh);
    this.group.add(mesh);
  }

  /* ---------------- ③ 浮尘微粒 ---------------- */
  const dustCount = 1100;
  const dpos = new Float32Array(dustCount * 3);
  const dsize = new Float32Array(dustCount);
  const dspeed = new Float32Array(dustCount);
  const dphase = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    // 以小屋为中心的一个圆柱体空间
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 0.62) * 34;
    dpos[i * 3]     = Math.cos(a) * r;
    dpos[i * 3 + 1] = FC.rand(0.4, 26);
    dpos[i * 3 + 2] = Math.sin(a) * r;
    dsize[i]  = FC.rand(0.7, 2.9);
    dspeed[i] = FC.rand(0.14, 0.62);
    dphase[i] = Math.random() * Math.PI * 2;
  }
  const dgeo = new three.BufferGeometry();
  dgeo.setAttribute('position', new three.BufferAttribute(dpos, 3));
  dgeo.setAttribute('aSize',    new three.BufferAttribute(dsize, 1));
  dgeo.setAttribute('aPhase',   new three.BufferAttribute(dphase, 1));

  this.dustMat = new three.ShaderMaterial({
    uniforms: {
      uTime:      { value: 0 },
      uColor:     { value: new three.Color('#ffe9bd') },
      uIntensity: { value: 1 },
      uPixelRatio:{ value: 1 },
      uLightDir:  { value: this.dir.clone() }
    },
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      uniform vec3  uLightDir;
      varying float vFade;
      void main(){
        vec3 p = position;
        // 缓慢上浮 + 横向漂移
        p.y = mod(p.y + uTime * (0.18 + aSize * 0.07), 28.0);
        p.x += sin(uTime * 0.22 + aPhase) * 0.9;
        p.z += cos(uTime * 0.19 + aPhase * 1.3) * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * (34.0 / -mv.z);
        // 越靠近光柱方向越亮 —— 制造"光里能看见灰尘"的感觉
        vec3 nd = normalize(p);
        vFade = mix(0.28, 1.0, max(0.0, dot(nd, normalize(uLightDir))));
      }`,
    fragmentShader: `
      uniform vec3  uColor;
      uniform float uIntensity;
      varying float vFade;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if(d > 0.5) discard;
        float a = pow(1.0 - d * 2.0, 2.1) * 0.5 * uIntensity * vFade;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false
  });
  this.dust = new three.Points(dgeo, this.dustMat);
  this.dust.frustumCulled = false;
  this.group.add(this.dust);

  this.time = 0;
};

/* 生成柔和辉光贴图（径向渐变） */
FC.makeGlowTexture = function () {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,244,214,0.86)');
  g.addColorStop(0.38, 'rgba(255,224,162,0.34)');
  g.addColorStop(0.68, 'rgba(255,206,130,0.09)');
  g.addColorStop(1.00, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new FC.THREE.CanvasTexture(cv);
  tex.colorSpace = FC.THREE.SRGBColorSpace || undefined;
  return tex;
};

FC.GodRays.prototype = {
  /* 每帧：让光柱沿太阳方向倾斜，并围绕小屋轻微摆动 */
  update: function (dt, camera, sunDir, sunPos) {
    this.time += dt;
    const three = FC.THREE;
    this.dir.copy(sunDir).normalize();

    this.intensity = FC.damp(this.intensity, this.targetIntensity * (this.enabled ? 1 : 0), 2.2, dt);
    const I = this.intensity;

    this.shaftMat.uniforms.uTime.value = this.time;
    this.shaftMat.uniforms.uIntensity.value = I;
    this.dustMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uIntensity.value = 0.42 + I * 0.62;
    this.dustMat.uniforms.uLightDir.value.copy(this.dir);
    // 太阳位置：沿光方向推到很远处。辉光比光柱更远一档，
    // 让"太阳"落在天穹上，光柱从它下方垂进林中 —— 眼感上是一体的。
    const sunDist = 150;
    this.sunHalo.position.copy(this.dir).multiplyScalar(sunDist - 3);
    this.sunGlow.position.copy(this.dir).multiplyScalar(sunDist);
    this.sunCore.position.copy(this.dir).multiplyScalar(sunDist + 0.6);
    this.sunHalo.material.opacity = (0.10 + I * 0.36) * this.mood;
    this.sunGlow.material.opacity = (0.16 + I * 0.42) * this.mood;
    this.sunCore.material.opacity = (0.10 + I * 0.34) * this.mood;
    const gs = 52 + I * 30;
    this.sunGlow.scale.set(gs, gs, 1);
    this.sunHalo.scale.set(150 + I * 90, 150 + I * 90, 1);
    this.sunCore.scale.set(14 + I * 9, 14 + I * 9, 1);

    /* 每根光柱：位置环绕中心，旋转对齐光方向 */
    const up = new three.Vector3(0, 1, 0);
    const q = new three.Quaternion().setFromUnitVectors(up, this.dir);
    this.shafts.forEach((sh, i) => {
      // 摆动幅度收小（0.10→0.055），慢一点 → 更像自然空气流动，不"甩"
      const sw = Math.sin(this.time * sh.speed + sh.swing);
      const a = sh.ang + sw * 0.055;
      const rad = sh.rad + sw * 1.1;
      const cx = Math.cos(a) * rad;
      const cz = Math.sin(a) * rad;

      // 光柱中点：顶端挂在高处，沿光方向往下垂
      const top = new THREE.Vector3(cx, this.originHeight + sh.yOff, cz);
      const mid = new THREE.Vector3().copy(top).addScaledVector(this.dir, -sh.len * 0.5);
      sh.mesh.position.copy(mid);
      sh.mesh.quaternion.copy(q);

      // 当镜头贴近时淡出，避免糊脸（范围放宽，过渡更软）
      const d = camera.position.distanceTo(mid);
      const near = FC.clamp((d - 3.0) / 6.5, 0, 1);
      const nearS = near * near * (3 - 2 * near);          // 再平滑一次
      const breathe = 0.90 + 0.10 * Math.sin(this.time * 0.55 + i * 1.3);
      const vis = I * sh.baseOpacity * nearS * breathe * this.mood * (sh.allow === false ? 0 : 1);
      // 每根光柱独立控制强度（材质已 clone）
      sh.mat.uniforms.uTime.value = this.time;
      sh.mat.uniforms.uIntensity.value = vis;
      sh.mat.uniforms.uColor.value.copy(this.shaftMat.uniforms.uColor.value);
      sh.mesh.visible = vis > 0.02;
      sh.mesh.scale.set(1.0, 1.0, 1.0);
    });

    this.dust.visible = I > 0.02;
    this.sunGlow.visible = this.sunCore.visible = this.sunHalo.visible = I > 0.015;
  },
  /* 切换天气时调色 */
  setMood: function (colorHex, strength, enabled) {
    this.color.set(colorHex);
    this.shaftMat.uniforms.uColor.value.set(colorHex);
    this.dustMat.uniforms.uColor.value.set(colorHex).lerp(new FC.THREE.Color('#ffffff'), 0.22);
    this.sunGlow.material.color.set(colorHex);
    this.sunCore.material.color.set(colorHex).lerp(new FC.THREE.Color('#ffffff'), 0.45);
    this.sunHalo.material.color.set(colorHex);
    this.targetIntensity = strength;
    // mood：太阳被云/暮色"吃"掉多少。黄昏 0.82 → 光晕仍在但被暮霭软化；
    //       夜 0.34 → 只剩一层很淡的月晕，不会破坏夜色。
    this.mood = enabled === false ? 0
      : (strength >= 1.25 ? 1.0 : (strength <= 0.4 ? 0.34 : 0.82));
    this.enabled = enabled !== false;
  },
  setPixelRatio: function (pr) { this.dustMat.uniforms.uPixelRatio.value = pr; },
  setQuality: function (q) {
    const n = q === 'low' ? 7 : (q === 'mid' ? 16 : 22);
    this.shafts.forEach((s, i) => {
      s.allow = i < n;                        // update() 里据此剔除光柱
      if (!s.allow) s.mesh.visible = false;
    });
    this.dust.visible = q !== 'low';
  }
};
