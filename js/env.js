/* ============================================================
   env.js —— 大气与环境：天空穹顶 / 雾 / 光照 / 雨 / 星空 / 萤火虫
   五种天气：晴 · 雾 · 雨 · 黄昏 · 夜
   所有参数在切换时做指数平滑过渡，不会突兀跳变
   ============================================================ */

FC.WEATHERS = [
  { id:'sunny', name:'晴天', icon:'sun'    },
  { id:'mist',  name:'雾天', icon:'mist'   },
  { id:'rain',  name:'雨天', icon:'rain'   },
  { id:'dusk',  name:'黄昏', icon:'dusk'   },
  { id:'night', name:'夜晚', icon:'night'  }
];

FC.WICON = {
  sun:  '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"/>',
  mist: '<path d="M3 9h13M6 13h15M3 17h13M17 9h4"/>',
  rain: '<path d="M7 15a4.6 4.6 0 0 1-.3-9.2A6 6 0 0 1 18 7.4 3.8 3.8 0 0 1 17.6 15H7z"/><path d="M8.6 18.4l-1 2.2M12.4 18.4l-1 2.2M16.2 18.4l-1 2.2"/>',
  dusk: '<path d="M4 18h16"/><path d="M8 18a4 4 0 1 1 8 0"/><path d="M12 3.4v2.2M4.8 7.4l1.5 1.5M19.2 7.4l-1.5 1.5"/>',
  night:'<path d="M20.4 14.2A8.6 8.6 0 0 1 9.8 3.6a8.6 8.6 0 1 0 10.6 10.6z"/><path d="M17 3.6l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"/>'
};

/* ---------- 五种天气的目标参数（色板与强度） ---------- */
FC.ENV_PRESETS = {
  sunny: {
    label:'晴天',
    skyTop:'#7fb4d8', skyMid:'#b6d2e4', skyHorizon:'#e2e9dc',
    fogColor:'#cfdccc', fogDensity:0.0125,
    sunColor:'#fff2d4', sunIntensity:2.35, sunElev:34, sunAzi:18,
    hemiSky:'#dcefff', hemiGround:'#6f7d55', hemiIntensity:0.72,
    ambColor:'#cfe0e8', ambIntensity:0.34,
    rayColor:'#ffe3ac', rayStrength:1.45, rayOn:true,
    rain:0, star:0, firefly:0, exposure:1.06,
    groundSat:1.0, windX:0.55, windZ:0.2,
    indoorOn:false, dust:1.0
  },
  mist: {
    label:'雾天',
    // ⚠️ 雾要够浓才有"雾天"感：exp2 密度 0.05 在 25m 处仍有 0.55 可见度，
    //    看起来跟晴天没区别，所以这里上到 0.098，并把整体明度压下来
    skyTop:'#9aa5a5', skyMid:'#b8c0bb', skyHorizon:'#d4d8d1',
    fogColor:'#ccd2cb', fogDensity:0.098,
    sunColor:'#e4e2d2', sunIntensity:0.62, sunElev:40, sunAzi:10,
    hemiSky:'#cdd3ce', hemiGround:'#636d5c', hemiIntensity:0.60,
    ambColor:'#c6ccc6', ambIntensity:0.42,
    rayColor:'#e6e9d8', rayStrength:0.85, rayOn:true,
    rain:0, star:0, firefly:0, exposure:0.96,
    groundSat:0.58, windX:0.3, windZ:0.1,
    indoorOn:false, dust:0.62
  },
  rain: {
    label:'雨天',
    skyTop:'#5d6b78', skyMid:'#7c8894', skyHorizon:'#98a1a6',
    fogColor:'#8b949c', fogDensity:0.062,
    sunColor:'#b9c4cc', sunIntensity:0.62, sunElev:48, sunAzi:-14,
    hemiSky:'#9dabb6', hemiGround:'#4d5a48', hemiIntensity:0.68,
    ambColor:'#93a2ad', ambIntensity:0.5,
    rayColor:'#c3ccd0', rayStrength:0.30, rayOn:true,
    rain:1, star:0, firefly:0, exposure:0.94,
    groundSat:0.66, windX:1.4, windZ:0.5,
    indoorOn:true, dust:0.42
  },
  dusk: {
    label:'黄昏',
    skyTop:'#3f4f7e', skyMid:'#b5708a', skyHorizon:'#f2a566',
    fogColor:'#c9856a', fogDensity:0.020,
    sunColor:'#ffb066', sunIntensity:2.0, sunElev:7, sunAzi:24,
    hemiSky:'#f0b58a', hemiGround:'#4a4530', hemiIntensity:0.62,
    ambColor:'#c98a72', ambIntensity:0.4,
    rayColor:'#ffb877', rayStrength:1.25, rayOn:true,
    rain:0, star:0.35, firefly:0.55, exposure:1.05,
    groundSat:0.92, windX:0.4, windZ:0.15,
    indoorOn:true, dust:1.25
  },
  night: {
    label:'夜晚',
    skyTop:'#070c1a', skyMid:'#111c31', skyHorizon:'#25324a',
    fogColor:'#141d30', fogDensity:0.026,
    sunColor:'#8ea6d8', sunIntensity:0.30, sunElev:56, sunAzi:-40,
    hemiSky:'#22334f', hemiGround:'#0f1714', hemiIntensity:0.22,
    ambColor:'#1c2740', ambIntensity:0.20,
    rayColor:'#bcd0f0', rayStrength:0.55, rayOn:true,
    rain:0, star:1, firefly:1, exposure:1.02,
    groundSat:0.6, windX:0.24, windZ:0.1,
    indoorOn:true, dust:0.85
  }
};

/* ============================================================ */
FC.Environment = function (scene, renderer) {
  const three = FC.THREE;
  this.scene = scene;
  this.renderer = renderer;

  /* ---------- 当前值（会被平滑到目标值） ---------- */
  const P = FC.ENV_PRESETS.sunny;
  this.cur = {
    skyTop:new three.Color(P.skyTop), skyMid:new three.Color(P.skyMid), skyHorizon:new three.Color(P.skyHorizon),
    fogColor:new three.Color(P.fogColor), fogDensity:P.fogDensity,
    sunColor:new three.Color(P.sunColor), sunIntensity:P.sunIntensity, sunElev:P.sunElev, sunAzi:P.sunAzi,
    hemiSky:new three.Color(P.hemiSky), hemiGround:new three.Color(P.hemiGround), hemiIntensity:P.hemiIntensity,
    ambColor:new three.Color(P.ambColor), ambIntensity:P.ambIntensity,
    rayColor:new three.Color(P.rayColor), rayStrength:P.rayStrength,
    rain:P.rain, star:P.star, firefly:P.firefly, exposure:P.exposure,
    groundSat:P.groundSat, windX:P.windX, windZ:P.windZ, dust:P.dust
  };
  this.tgt = JSON.parse(JSON.stringify(this.cur));
  // 颜色对象在 JSON 克隆后会变成对象字面量，重建
  ['skyTop','skyMid','skyHorizon','fogColor','sunColor','hemiSky','hemiGround','ambColor','rayColor'].forEach(k => {
    this.tgt[k] = new three.Color(P[k]);
  });
  this.rayOn = true;
  this.id = 'sunny';

  /* ---------- 雾 ---------- */
  scene.fog = new three.FogExp2(new three.Color(P.fogColor), P.fogDensity);

  /* ---------- 渐变天空穹顶 ---------- */
  const skyGeo = new three.SphereGeometry(420, 32, 20);
  this.skyMat = new three.ShaderMaterial({
    uniforms: {
      uTop:   { value: this.cur.skyTop.clone() },
      uMid:   { value: this.cur.skyMid.clone() },
      uHoriz: { value: this.cur.skyHorizon.clone() },
      uSunDir:{ value: new three.Vector3(0.4, 0.5, 0.6) },
      uSunCol:{ value: new three.Color('#fff1cf') },
      uSunAmt:{ value: 1 }
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uTop, uMid, uHoriz, uSunCol, uSunDir;
      uniform float uSunAmt;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 1.0, -0.2, 1.0);
        vec3 col;
        if(h < 0.24){
          col = mix(uHoriz, uMid, smoothstep(-0.06, 0.24, h));
        } else {
          col = mix(uMid, uTop, smoothstep(0.24, 0.86, h));
        }
        // 太阳方向的暖色晕染
        float s = max(0.0, dot(d, normalize(uSunDir)));
        col += uSunCol * pow(s, 7.0) * 0.55 * uSunAmt;
        col += uSunCol * pow(s, 46.0) * 0.85 * uSunAmt;
        // 地平线附近轻微增亮
        col += uHoriz * pow(1.0 - abs(d.y), 9.0) * 0.11;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: three.BackSide,
    depthWrite: false,
    fog: false
  });
  this.sky = new three.Mesh(skyGeo, this.skyMat);
  this.sky.frustumCulled = false;
  scene.add(this.sky);

  /* ---------- 光照 ---------- */
  this.hemi = new three.HemisphereLight(this.cur.hemiSky, this.cur.hemiGround, this.cur.hemiIntensity);
  scene.add(this.hemi);

  this.amb = new three.AmbientLight(this.cur.ambColor, this.cur.ambIntensity);
  scene.add(this.amb);

  this.sun = new three.DirectionalLight(this.cur.sunColor, this.cur.sunIntensity);
  this.sun.castShadow = true;
  this.sun.shadow.mapSize.set(2048, 2048);
  const sc = this.sun.shadow.camera;
  sc.near = 1; sc.far = 190;
  sc.left = -46; sc.right = 46; sc.top = 46; sc.bottom = -46;
  this.sun.shadow.bias = -0.0011;
  this.sun.shadow.normalBias = 0.022;
  this.sunTarget = new three.Object3D();
  this.sunTarget.position.set(0, 2, 0);
  scene.add(this.sunTarget);
  this.sun.target = this.sunTarget;
  scene.add(this.sun);

  /* 逆光补光：从镜头侧略微补一点，避免背光面全黑（低多边形风格需要体积感） */
  this.fill = new three.DirectionalLight('#c8d8e8', 0.32);
  this.fill.position.set(-14, 9, -18);
  scene.add(this.fill);

  this.sunDir = new three.Vector3(0.4, 0.5, 0.6).normalize();
  this.sunPos = new three.Vector3();

  /* ---------- 雨 ---------- */
  this.buildRain();
  /* ---------- 星空 ---------- */
  this.buildStars();
  /* ---------- 萤火虫 ---------- */
  this.buildFireflies();

  this.time = 0;
  this.windPhase = 0;
};

FC.Environment.prototype.buildRain = function () {
  const three = FC.THREE;
  const N = 4200;                 // 雨丝数量
  const H = 30;                   // 雨幕高度
  const R = 26;                   // 雨幕半径
  const pos  = new Float32Array(N * 2 * 3);
  const dat  = new Float32Array(N * 2 * 3);   // (speed, 段内位置, 随机相位)
  const rng = FC.rng(9182);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * R;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, y = rng() * H;
    const speed = 13 + rng() * 12;
    const len = 0.75 + rng() * 1.7;
    const ph = rng() * 100;
    for (let k = 0; k < 2; k++) {
      const i2 = (i * 2 + k) * 3;
      pos[i2] = x; pos[i2 + 1] = y; pos[i2 + 2] = z;
      dat[i2] = speed; dat[i2 + 1] = k === 0 ? 0 : -len; dat[i2 + 2] = ph;
    }
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.BufferAttribute(pos, 3));
  g.setAttribute('aData', new three.BufferAttribute(dat, 3));

  this.rainMat = new three.ShaderMaterial({
    uniforms: {
      uTime:  { value: 0 },
      uAmt:   { value: 0 },
      uH:     { value: H },
      uCenter:{ value: new three.Vector3() },
      uColor: { value: new three.Color('#d6e2ee') },
      uWind:  { value: new three.Vector2(1.4, 0.5) }
    },
    vertexShader: `
      attribute vec3 aData;
      uniform float uTime, uH, uAmt;
      uniform vec3 uCenter;
      uniform vec2 uWind;
      varying float vA;
      void main(){
        vec3 p = position;
        // 下落并循环
        float y = mod(p.y - uTime * aData.x, uH);
        vec3 world = vec3(uCenter.x + p.x, y, uCenter.z + p.z);
        // 风偏（越靠下越偏，形成斜雨）
        world.xz += uWind * (uH - y) * 0.09;
        // 段内第二个顶点往下拉长成雨丝
        world.y += aData.y;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = uAmt * (0.35 + 0.65 * smoothstep(0.0, 8.0, y)) * (0.5 + 0.5 * fract(aData.z));
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vA;
      void main(){
        if(vA < 0.01) discard;
        gl_FragColor = vec4(uColor, clamp(vA * 1.5, 0.0, 0.92));
      }`,
    transparent: true,
    blending: three.NormalBlending,
    depthWrite: false
  });
  this.rain = new three.LineSegments(g, this.rainMat);
  this.rain.frustumCulled = false;
  this.rain.visible = false;
  this.scene.add(this.rain);
};

FC.Environment.prototype.buildStars = function () {
  const three = FC.THREE;
  const N = 900;
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const ph = new Float32Array(N);
  const rng = FC.rng(4477);
  for (let i = 0; i < N; i++) {
    // 上半球均匀分布
    const u = rng(), v = rng() * 0.62 + 0.06;
    const theta = u * Math.PI * 2;
    const phi = Math.acos(1 - v * 1.0);
    const r = 300;
    pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.9 + 40;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    size[i] = 0.7 + rng() * 2.4;
    ph[i] = rng() * 6.28;
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new three.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new three.BufferAttribute(ph, 1));
  this.starMat = new three.ShaderMaterial({
    uniforms: { uTime:{value:0}, uAmt:{value:0}, uPR:{value:1} },
    vertexShader: `
      attribute float aSize; attribute float aPhase;
      uniform float uTime, uPR, uAmt;
      varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR * (150.0 / -mv.z) * 14.0;
        vA = uAmt * (0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * 1.3 + aPhase)));
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if(d > 0.5) discard;
        float a = pow(1.0 - d * 2.0, 1.7) * vA;
        gl_FragColor = vec4(vec3(1.0, 0.98, 0.92), a);
      }`,
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false,
    fog: false
  });
  this.stars = new three.Points(g, this.starMat);
  this.stars.frustumCulled = false;
  this.scene.add(this.stars);
};

FC.Environment.prototype.buildFireflies = function () {
  const three = FC.THREE;
  const N = 240;
  const pos = new Float32Array(N * 3);
  const d = new Float32Array(N * 3);     // (rand1, rand2, phase)
  const rng = FC.rng(2255);
  for (let i = 0; i < N; i++) {
    const a = rng() * Math.PI * 2;
    const r = 2 + Math.sqrt(rng()) * 26;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0.5 + rng() * 5.5;
    pos[i * 3 + 2] = Math.sin(a) * r;
    d[i * 3] = rng() * 6.28; d[i * 3 + 1] = 0.4 + rng(); d[i * 3 + 2] = rng() * 6.28;
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.BufferAttribute(pos, 3));
  g.setAttribute('aD', new three.BufferAttribute(d, 3));
  this.ffMat = new three.ShaderMaterial({
    uniforms: { uTime:{value:0}, uAmt:{value:0}, uPR:{value:1} },
    vertexShader: `
      attribute vec3 aD;
      uniform float uTime, uPR, uAmt;
      varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.42 + aD.x) * 1.5;
        p.y += sin(uTime * 0.62 + aD.z) * 0.55;
        p.z += cos(uTime * 0.37 + aD.x * 1.4) * 1.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (2.0 + aD.y * 3.0) * uPR * (60.0 / -mv.z);
        float blink = pow(0.5 + 0.5 * sin(uTime * 1.6 + aD.x * 3.0), 2.6);
        vA = uAmt * (0.25 + 0.75 * blink);
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float dd = length(c);
        if(dd > 0.5) discard;
        float core = pow(1.0 - dd * 2.0, 3.0);
        vec3 col = mix(vec3(0.72, 1.0, 0.42), vec3(1.0, 0.95, 0.62), core);
        gl_FragColor = vec4(col, core * vA);
      }`,
    transparent: true,
    blending: three.AdditiveBlending,
    depthWrite: false
  });
  this.fireflies = new three.Points(g, this.ffMat);
  this.fireflies.frustumCulled = false;
  this.scene.add(this.fireflies);
};

FC.Environment.prototype.setWeather = function (id, instant) {
  const P = FC.ENV_PRESETS[id];
  if (!P) return;
  this.id = id;
  const t = this.tgt;
  ['skyTop','skyMid','skyHorizon','fogColor','sunColor','hemiSky','hemiGround','ambColor','rayColor'].forEach(k => {
    t[k].set(P[k]);
  });
  t.fogDensity = P.fogDensity;  t.sunIntensity = P.sunIntensity;
  t.sunElev = P.sunElev;        t.sunAzi = P.sunAzi;
  t.hemiIntensity = P.hemiIntensity; t.ambIntensity = P.ambIntensity;
  t.rayStrength = P.rayStrength; t.rain = P.rain; t.star = P.star;
  t.firefly = P.firefly; t.exposure = P.exposure; t.groundSat = P.groundSat;
  t.windX = P.windX; t.windZ = P.windZ; t.dust = P.dust;
  this.rayOn = P.rayOn;

  if (instant) {
    Object.keys(t).forEach(k => {
      if (this.cur[k] && this.cur[k].isColor) this.cur[k].copy(t[k]);
      else this.cur[k] = t[k];
    });
  }
  return P;
};

FC.Environment.prototype.update = function (dt, camera) {
  const three = FC.THREE;
  this.time += dt;
  const L = 1.7;                        // 过渡速度
  const c = this.cur, t = this.tgt;

  /* --- 颜色/数值平滑 --- */
  ['skyTop','skyMid','skyHorizon','fogColor','sunColor','hemiSky','hemiGround','ambColor','rayColor'].forEach(k => {
    c[k].lerp(t[k], 1 - Math.exp(-L * dt));
  });
  ['fogDensity','sunIntensity','sunElev','sunAzi','hemiIntensity','ambIntensity',
   'rayStrength','rain','star','firefly','exposure','groundSat','windX','windZ','dust'].forEach(k => {
    c[k] = FC.damp(c[k], t[k], L, dt);
  });

  /* --- 天空 --- */
  const su = this.skyMat.uniforms;
  su.uTop.value.copy(c.skyTop);
  su.uMid.value.copy(c.skyMid);
  su.uHoriz.value.copy(c.skyHorizon);
  su.uSunCol.value.copy(c.rayColor);
  // 太阳方向（夜晚让天空里的"太阳"消失）
  const el = c.sunElev * Math.PI / 180, az = c.sunAzi * Math.PI / 180;
  this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
  su.uSunDir.value.copy(this.sunDir);
  su.uSunAmt.value = FC.clamp((c.sunIntensity - 0.25) * 0.66, 0, 1.2);

  /* --- 主光 --- */
  this.sun.color.copy(c.sunColor);
  this.sun.intensity = c.sunIntensity;
  const dist = 78;
  this.sun.position.copy(this.sunDir).multiplyScalar(dist);
  this.sun.position.y = Math.max(this.sun.position.y, 6);
  this.sunPos.copy(this.sun.position);
  this.hemi.color.copy(c.hemiSky);
  this.hemi.groundColor.copy(c.hemiGround);
  this.hemi.intensity = c.hemiIntensity;
  this.amb.color.copy(c.ambColor);
  this.amb.intensity = c.ambIntensity;
  this.fill.intensity = 0.30 * FC.clamp(c.hemiIntensity + c.ambIntensity, 0, 1.4) / 1.0;

  /* --- 雾 --- */
  this.scene.fog.color.copy(c.fogColor);
  this.scene.fog.density = c.fogDensity;

  /* --- 雨 --- */
  const rainAmt = c.rain;
  this.rain.visible = rainAmt > 0.02;
  if (this.rain.visible) {
    const u = this.rainMat.uniforms;
    u.uTime.value = this.time;
    u.uAmt.value = rainAmt * 0.95;
    u.uColor.value.copy(c.fogColor).lerp(new three.Color('#ffffff'), 0.42);
    u.uWind.value.set(c.windX, c.windZ);
    // 雨幕跟随相机（取整避免抖动）
    u.uCenter.value.set(camera.position.x, 0, camera.position.z);
  }

  /* --- 星 / 萤火虫 --- */
  this.starMat.uniforms.uTime.value = this.time;
  this.starMat.uniforms.uAmt.value = c.star * 0.9;
  this.stars.visible = c.star > 0.02;
  if (this.stars.visible) this.stars.position.set(camera.position.x * 0.35, 0, camera.position.z * 0.35);

  this.ffMat.uniforms.uTime.value = this.time;
  this.ffMat.uniforms.uAmt.value = c.firefly * 0.85;
  this.fireflies.visible = c.firefly > 0.02;

  /* --- 曝光 --- */
  this.renderer.toneMappingExposure = c.exposure;

  /* --- 风相位（植被用） --- */
  this.windPhase += dt;
};

FC.Environment.prototype.setPixelRatio = function (pr) {
  this.starMat.uniforms.uPR.value = pr;
  this.ffMat.uniforms.uPR.value = pr;
};

FC.Environment.prototype.setQuality = function (q) {
  this.rain.visible = this.cur.rain > 0.02 && q !== 'low';
  this.rainMat.uniforms.uAmt.value = (q === 'high' ? 0.8 : 0.6) * this.cur.rain;
  this.stars.visible = this.cur.star > 0.02 && q !== 'low';
  if (q === 'high') {
    this.sun.shadow.mapSize.set(2048, 2048);
  } else if (q === 'mid') {
    this.sun.shadow.mapSize.set(1024, 1024);
  } else {
    this.sun.shadow.mapSize.set(512, 512);
  }
  if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
};
