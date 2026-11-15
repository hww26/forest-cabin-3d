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

  /* ---------------- ① 太阳辉光 ---------------- */
  const glowTex = FC.makeGlowTexture();
  this.sunGlow = new three.Sprite(new three.SpriteMaterial({
    map: glowTex, color: 0xfff0c8, transparent: true, opacity: .9,
    blending: three.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }));
  this.sunGlow.scale.set(56, 56, 1);
  this.group.add(this.sunGlow);

  this.sunCore = new three.Sprite(new three.SpriteMaterial({
    map: glowTex, color: 0xffffff, transparent: true, opacity: .95,
    blending: three.AdditiveBlending, depthWrite: false, depthTest: false, fog: false
  }));
  this.sunCore.scale.set(16, 16, 1);
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
        // 横向：中间亮、两侧羽化
        float ex = smoothstep(0.0, 0.42, vUv.x) * smoothstep(1.0, 0.58, vUv.x);
        // 纵向：上端（uv.y=1）最亮，向下逐渐消散
        float ey = pow(clamp(vUv.y, 0.0, 1.0), 1.65);
        // 流动絮状
        float n = noise(vec2(vUv.x * 3.2, vUv.y * 2.2 - uTime * 0.055));
        n = 0.62 + 0.38 * n;
        float a = ex * ey * n * uIntensity * uOpacity;
        if(a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false,
    side: three.DoubleSide
  });

  /* 光柱几何：被拉长的锥体（上宽下窄），斜射进林间空地 */
  this.shafts = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    // 主光来自 +X 侧（sunAzi≈18°）：把光柱撒在小屋/空地一带，
    // 避免落到 z≈-24 的池塘上空空荡荡
    const ang = -0.35 + (i / (N - 1)) * 1.5 + (Math.random() - 0.5) * 0.22;
    const rad = FC.rand(7, 21);
    const topW = FC.rand(3.0, 6.2);       // 顶端宽度（收窄 → 更像"斜射的光束"）
    const len  = FC.rand(15, 26);         // 长度（下探到地面附近）
    const geo = new three.CylinderGeometry(topW, topW * 0.30, len, 6, 1, true);
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
      swing: FC.rand(0, Math.PI * 2),
      speed: FC.rand(0.05, 0.16),
      baseOpacity: FC.rand(0.42, 1.0),
      yOff: FC.rand(-1.5, 3.5)
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
    this.dustMat.uniforms.uIntensity.value = 0.55 + I * 0.85;
    this.dustMat.uniforms.uLightDir.value.copy(this.dir);
    // 太阳位置：沿光方向推到很远处
    const sunDist = 130;
    this.sunGlow.position.copy(this.dir).multiplyScalar(sunDist);
    this.sunCore.position.copy(this.dir).multiplyScalar(sunDist + 0.5);
    this.sunGlow.material.opacity = 0.34 + I * 0.68;
    this.sunCore.material.opacity = 0.20 + I * 0.60;
    const gs = 42 + I * 26;
    this.sunGlow.scale.set(gs, gs, 1);

    /* 每根光柱：位置环绕中心，旋转对齐光方向 */
    const up = new three.Vector3(0, 1, 0);
    const q = new three.Quaternion().setFromUnitVectors(up, this.dir);
    const target = new three.Vector3();
    const mid = new three.Vector3();
    this.shafts.forEach((sh, i) => {
      const sw = Math.sin(this.time * sh.speed + sh.swing);
      const a = sh.ang + sw * 0.1;
      const rad = sh.rad + sw * 1.6;
      const cx = Math.cos(a) * rad;
      const cz = Math.sin(a) * rad;

      // 光柱中点：从高处沿光方向往下落
      const top = new three.Vector3(cx, this.originHeight + sh.yOff, cz);
      mid.copy(top).addScaledVector(this.dir, -sh.len * 0.5);
      sh.mesh.position.copy(mid);
      sh.mesh.quaternion.copy(q);

      // 当镜头贴近时淡出，避免糊脸
      const d = camera.position.distanceTo(mid);
      const near = FC.clamp((d - 3.2) / 5.5, 0, 1);
      const breathe = 0.86 + 0.14 * Math.sin(this.time * 0.7 + i);
      const vis = I * sh.baseOpacity * near * breathe;
      // 每根光柱独立控制强度（材质已 clone）+ 轻微呼吸脉动
      sh.mat.uniforms.uTime.value = this.time;
      sh.mat.uniforms.uIntensity.value = vis;
      sh.mat.uniforms.uColor.value.copy(this.shaftMat.uniforms.uColor.value);
      sh.mesh.visible = vis > 0.02;
      sh.mesh.scale.set(breathe, 1, breathe);
    });

    this.dust.visible = I > 0.02;
    this.sunGlow.visible = this.sunCore.visible = I > 0.02;
  },
  /* 切换天气时调色 */
  setMood: function (colorHex, strength, enabled) {
    this.color.set(colorHex);
    this.shaftMat.uniforms.uColor.value.set(colorHex);
    this.dustMat.uniforms.uColor.value.set(colorHex).lerp(new FC.THREE.Color('#ffffff'), 0.22);
    this.sunGlow.material.color.set(colorHex);
    this.targetIntensity = strength;
    this.enabled = enabled !== false;
  },
  setPixelRatio: function (pr) { this.dustMat.uniforms.uPixelRatio.value = pr; },
  setQuality: function (q) {
    const n = q === 'low' ? 6 : (q === 'mid' ? 14 : 22);
    this.shafts.forEach((s, i) => { s.mesh.visible = i < n; s._allow = i < n; });
    this.dust.visible = q !== 'low';
  }
};
