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
  // ⚠️ 用户反馈："光束要柔和一点，而且是从天上射下来的，
  //    而不是一整块压在屋顶上。"
  //    根因：黄昏太阳仰角只有 6.5°，光柱若照真实方向铺 26~46m 长，
  //    就等于一根横躺的粗管子斜跨全场景 → 看着是一块"板"压在屋顶/树冠上；
  //    而且原顶端只到 y≈15.5（刚好屋顶高度），根本没有"从天上"的感觉。
  //    现在改为：光柱根部落在林间地面，顶端推到接近天穹的高度，
  //    并给射向一个最小仰角，让它始终是"从高空斜射下来的一束"。
  this.skyTop = 27.0;              // 光柱顶端高度（树冠之上、接近天穹）
  this.minElev = 0.62;             // 射向 y 分量下限（≈38°）→ 不再横躺
  this.rayDir = new three.Vector3(0.4, 0.7, 0.5).normalize();

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
      uOpacity:   { value: 1 },
      uSunDir:    { value: new three.Vector3(0.4, 0.7, 0.5).normalize() },
      // ⚠️ ShaderMaterial 不会自动吃场景雾 → 远处光柱和近处一样亮，
      //    在屏幕上就是"贴上去的一块板"。这里手动按深度做吸收衰减。
      uFogK:      { value: 0.014 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying vec3 vView;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        vNrm = normalize(mat3(modelMatrix) * normal);
        // 视线方向：用于按"视线穿过光柱的厚度"算亮度
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3  uColor;
      uniform float uIntensity;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uFogK;
      uniform vec3  uSunDir;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying vec3 vView;

      // 简易噪声，让光柱边缘有流动的絮状感
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main(){
        /* ⚠️ 关键修正（用户："不是一整块压在屋顶上"）。
           旧版只在 vUv.x（圆柱周长）上做羽化，而圆柱的周长在屏幕上
           就是那个矩形投影的左右两边 —— 于是整个矩形几乎等亮，
           画出来就是"一块灰白的板"压在屋顶/树冠上。
           现在改成按真实几何算"视线穿过这根光柱的厚度"：
             厚度 ∝ sqrt(1 - (N·V)^2)
           正中央（视线垂直于柱面）最厚最亮，越到柱体轮廓越薄直到 0。
           这样光柱在屏幕上是一根"中间实、两侧自然融掉"的圆柱光，
           而不是一块平面板。 */
        float ndv = abs(dot(normalize(vNrm), normalize(vView)));
        float thick = sqrt(max(0.0, 1.0 - ndv * ndv));
        thick = pow(thick, 0.92);

        // 纵向：从天上垂下来的一缕。顶端渐隐入天、底端柔和消散。
        // ⚠️ 底部 fade 从 0.20 放宽到 0.34 —— 否则能看见圆柱底面那圈硬边
        //    （用户："不要那么突兀"）。现在根部是慢慢化进空气里的。
        float y  = clamp(vUv.y, 0.0, 1.0);
        float ey = smoothstep(0.0, 0.34, y) * (1.0 - smoothstep(0.52, 1.0, y));
        ey = pow(max(ey, 0.0), 1.05);

        // 流动絮状：横向更密（细丝感），纵向拉长（从天垂下的光缕）
        float n1 = noise(vec2(vUv.x * 5.0, vUv.y * 1.05 - uTime * 0.05));
        float n2 = noise(vec2(vUv.x * 2.0 + 11.0, vUv.y * 0.5 - uTime * 0.028));
        float n = 0.58 * n1 + 0.42 * n2;
        n = 0.62 + 0.38 * n;

        float a = thick * ey * n * uIntensity * uOpacity;
        // 深度衰减：越远越淡 → 光柱自然融进远处的树林与雾里
        float dist = length(vWorld - cameraPosition);
        a *= exp(-dist * uFogK);
        /* ⚠️ "从天上射下来"的关键：贴脸的光柱必须淡出。
           加色混合下，一根从地面伸到天穹的粗光柱若贴着镜头，
           就会糊满整个画面（看着就是一大块亮面）。
           这里用两层约束：
             ① 绝对近距淡出：<7m 快速溶解
             ② 方向约束：光柱越偏离太阳方向越淡 —— 只有朝太阳那侧的
                光柱才亮，于是屏幕上呈现"光从太阳那头斜射下来"的透视感 */
        a *= smoothstep(2.0, 9.0, dist);
        vec3 toFrag = normalize(vWorld - cameraPosition);
        float align = dot(toFrag, normalize(uSunDir));
        a *= mix(0.30, 1.0, clamp(align * 0.5 + 0.5, 0.0, 1.0));
        if(a < 0.0025) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false,
    side: three.DoubleSide
  });

  /* 光柱几何：细长圆柱（上下略收），从高空斜射下来
     ⚠️ 旧版长度 26~46、顶端固定 y=15.5 → 光束要么横躺成"板"，
        要么悬在半空。现在改为：
        长度 24~40，顶端推到 y≈skyTop(27) 附近（树冠之上、接近天穹），
        根部落在林间地面（update 里锚定 base 点），
        配合着色器顶端渐隐，光柱看起来是"从天穹垂到地上"的一束光。 */
  this.shafts = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    // 主光来自 +X 侧（sunAzi≈18°）：把光柱撒在小屋/空地一带，
    // 避免落到 z≈-24 的池塘上空空荡荡
    const ang = -0.35 + (i / (N - 1)) * 1.5 + (Math.random() - 0.5) * 0.22;
    const rad = FC.rand(6, 20);
    const topW = FC.rand(2.6, 5.6);      // 顶端宽度（略收，更柔不生硬）
    const len  = FC.rand(24, 40);        // 长度：从天上垂到林间
    const geo = new three.CylinderGeometry(topW * 0.92, topW * 0.34, len, 9, 1, true);
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
      // ⚠️ 亮度整体收柔：用户要"柔和一点"，所以基准不透明度往下压
      baseOpacity: FC.rand(0.26, 0.55),
      yOff: FC.rand(-1.5, 2.5)
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

    /* ⚠️ 用户："光束是从天上射下来的，而不是一整块压在屋顶上。"
       如果直接照真实太阳方向铺光柱，黄昏（仰角 6.5°）时太阳几乎是
       贴着地平线的，光柱就会横躺成一块板。
       所以这里给光束单独算一个"永远保有仰角"的射向：
         · 保持太阳的方位角（光从哪边来不变）
         · 但把仰角抬到至少 ≈38°
       这样无论天气如何，光束都是"从高空斜斜射下"的一束。 */
    const az = Math.atan2(this.dir.z, this.dir.x);
    const elev = Math.max(this.minElev, Math.abs(this.dir.y) * 0.6 + this.minElev * 0.7);
    const ce = Math.cos(elev);
    this.rayDir.set(Math.cos(az) * ce, Math.sin(elev), Math.sin(az) * ce).normalize();
    const dir = this.rayDir;

    this.intensity = FC.damp(this.intensity, this.targetIntensity * (this.enabled ? 1 : 0), 2.2, dt);
    const I = this.intensity;

    this.shaftMat.uniforms.uTime.value = this.time;
    this.shaftMat.uniforms.uIntensity.value = I;
    // 光柱"朝向太阳方向才亮"用真实太阳方向（不是被打抬的 rayDir），
    // 这样光束的透视收敛点正好落在天上那个太阳辉光上。
    this.shaftMat.uniforms.uSunDir.value.copy(this.dir);
    this.dustMat.uniforms.uTime.value = this.time;
    this.dustMat.uniforms.uIntensity.value = 0.38 + I * 0.55;
    this.dustMat.uniforms.uLightDir.value.copy(this.dir);
    // 太阳位置：沿光方向推到很远处。辉光比光柱更远一档，
    // 让"太阳"落在天穹上，光柱从它下方垂进林中 —— 眼感上是一体的。
    const sunDist = 150;
    this.sunHalo.position.copy(this.dir).multiplyScalar(sunDist - 3);
    this.sunGlow.position.copy(this.dir).multiplyScalar(sunDist);
    this.sunCore.position.copy(this.dir).multiplyScalar(sunDist + 0.6);
    // ⚠️ 太阳辉光整体收柔：用户要"柔和一点"，所以核心亮度也压下来
    this.sunHalo.material.opacity = (0.07 + I * 0.26) * this.mood;
    this.sunGlow.material.opacity = (0.11 + I * 0.30) * this.mood;
    this.sunCore.material.opacity = (0.07 + I * 0.24) * this.mood;
    const gs = 52 + I * 30;
    this.sunGlow.scale.set(gs, gs, 1);
    this.sunHalo.scale.set(150 + I * 90, 150 + I * 90, 1);
    this.sunCore.scale.set(14 + I * 9, 14 + I * 9, 1);

    /* 每根光柱：根部锚在林间地面，顶端沿射向伸向天穹
       （不再"以顶端为锚往下垂" —— 那正是"整块压在屋顶上"的观感来源） */
    const up = new three.Vector3(0, 1, 0);
    const q = new three.Quaternion().setFromUnitVectors(up, dir);
    this.shafts.forEach((sh, i) => {
      // 摆动幅度收小（0.10→0.055），慢一点 → 更像自然空气流动，不"甩"
      const sw = Math.sin(this.time * sh.speed + sh.swing);
      const a = sh.ang + sw * 0.055;
      const rad = sh.rad + sw * 1.1;
      const cx = Math.cos(a) * rad;
      const cz = Math.sin(a) * rad;

      // 根部：落在林间地面（略高于地，避免穿地）
      const baseY = 0.6 + Math.max(0, sh.yOff) * 0.4;
      const base = new three.Vector3(cx, baseY, cz);
      // 中点 = 根部 + 射向 × 半长 → 整根柱子向上方天空延伸
      const mid = new three.Vector3().copy(base).addScaledVector(dir, sh.len * 0.5);
      sh.mesh.position.copy(mid);
      sh.mesh.quaternion.copy(q);

      // 当镜头贴近时淡出，避免糊脸（范围放宽，过渡更软）
      const d = camera.position.distanceTo(mid);
      const near = FC.clamp((d - 3.5) / 8.0, 0, 1);
      const nearS = near * near * (3 - 2 * near);          // 再平滑一次
      const breathe = 0.90 + 0.10 * Math.sin(this.time * 0.55 + i * 1.3);
      const vis = I * sh.baseOpacity * nearS * breathe * this.mood * (sh.allow === false ? 0 : 1);
      // 每根光柱独立控制强度（材质已 clone）
      sh.mat.uniforms.uTime.value = this.time;
      sh.mat.uniforms.uIntensity.value = vis;
      sh.mat.uniforms.uColor.value.copy(this.shaftMat.uniforms.uColor.value);
      sh.mat.uniforms.uSunDir.value.copy(this.dir);
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
