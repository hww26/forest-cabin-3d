/* ============================================================
   main.js —— 主控
   渲染器 / 相机 / 交互 / 天气切换 / 进出小屋 / 自动巡游 / UI 绑定
   ============================================================ */
(function () {
  const three = FC.THREE;

  /* ============================================================
     ① 渲染器
     ============================================================ */
  const app = document.getElementById('app');
  const renderer = new three.WebGLRenderer({
    antialias: window.devicePixelRatio <= 1.5,
    powerPreference: 'high-performance',
    stencil: false
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = three.PCFSoftShadowMap;
  renderer.outputEncoding = three.sRGBEncoding;
  renderer.toneMapping = three.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.physicallyCorrectLights = false;
  app.appendChild(renderer.domElement);

  const scene = new three.Scene();

  /* ============================================================
     ② 相机
     ============================================================ */
  const camera = new three.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.1, 900);
  const HOME_POS = new three.Vector3(8.6, 3.55, 15.4);
  const HOME_TGT = new three.Vector3(0, 1.55, 0.9);
  camera.position.copy(HOME_POS);

  const controls = new three.OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME_TGT);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.maxPolarAngle = Math.PI * 0.495;      // 不许钻到地下
  controls.minDistance = 1.2;
  controls.maxDistance = 78;
  controls.rotateSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.7;
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 0.42;

  /* ============================================================
     ③ 场景内容
     ============================================================ */
  let quality = 'mid';
  let env, terrain, veg, cabin, creatures, godrays, audio;

  const loading = { pct: 0 };
  const ldFill = document.getElementById('ldFill');
  const ldPct  = document.getElementById('ldPct');
  const setLoad = (p, label) => {
    loading.pct = p;
    ldFill.style.width = p + '%';
    ldPct.textContent = Math.round(p) + '%';
  };

  function buildWorld() {
    // 环境
    env = new FC.Environment(scene, renderer);
    env.setPixelRatio(renderer.getPixelRatio());
    setLoad(12);

    // 地形
    terrain = new FC.Terrain(scene, quality);
    setLoad(32);

    // 植被
    veg = new FC.Vegetation(scene, terrain, quality);
    setLoad(58);

    // 小屋
    cabin = new FC.Cabin(scene, quality);
    setLoad(76);

    // 生物
    creatures = new FC.Creatures(scene, veg, terrain, cabin, quality);
    setLoad(88);

    // 丁达尔
    godrays = new FC.GodRays(scene, {});
    godrays.setPixelRatio(renderer.getPixelRatio());
    godrays.setQuality(quality);
    setLoad(96);

    // 音效
    audio = new FC.Audio();
    setLoad(100);
  }

  /* ============================================================
     ④ UI：天气按钮
     ============================================================ */
  const weatherEl = document.getElementById('weather');
  FC.WEATHERS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'wbtn' + (i === 0 ? ' on' : '');
    b.dataset.id = w.id;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + FC.WICON[w.icon] + '</svg><span>' + w.name + '</span>';
    b.addEventListener('click', () => setWeather(w.id));
    weatherEl.appendChild(b);
  });

  let currentWeather = 'sunny';
  function setWeather(id) {
    currentWeather = id;
    const P = env.setWeather(id);
    // 按钮状态
    weatherEl.querySelectorAll('.wbtn').forEach(b => {
      b.classList.toggle('on', b.dataset.id === id);
    });
    // 丁达尔随天气变化
    godrays.setMood(P.rayColor, P.rayStrength, P.rayOn && raysOn);
    // 音效
    if (audio) audio.setWeather(id);
    // 天气联动：雨天/夜晚/黄昏自动开灯（但保留用户手动覆盖）
    if (P.indoorOn && !userTouchedLamp) {
      lampOn = true; syncLampUI();
    } else if (!P.indoorOn && !userTouchedLamp) {
      lampOn = false; syncLampUI();
    }
    FC.toast('已切换到「' + P.label + '」');
    // 场景标识
    document.getElementById('sScene').textContent = P.label;
  }

  /* ============================================================
     ⑤ UI：开关与按钮
     ============================================================ */
  let raysOn = true;
  let lampOn = false;
  let userTouchedLamp = false;
  let autoTour = false;

  const swRays = document.getElementById('swRays');
  const swLamp = document.getElementById('swLamp');
  const swAudio = document.getElementById('swAudio');

  swRays.addEventListener('click', () => {
    raysOn = !raysOn;
    swRays.classList.toggle('on', raysOn);
    godrays.enabled = raysOn;
    FC.toast(raysOn ? '丁达尔光束：开' : '丁达尔光束：关');
  });

  function syncLampUI() { swLamp.classList.toggle('on', lampOn); }

  function toggleLamp(userAction) {
    lampOn = !lampOn;
    if (userAction) userTouchedLamp = true;
    syncLampUI();
    if (audio && userAction) audio.click();
    FC.toast(lampOn ? '室内灯：开' : '室内灯：关');
  }
  swLamp.addEventListener('click', () => toggleLamp(true));

  swAudio.addEventListener('click', () => {
    const next = !audio.enabled;
    const ok = audio.setEnabled(next);
    if (!ok) { FC.toast('当前环境不支持音频'); return; }
    swAudio.classList.toggle('on', next);
    if (next) audio.setWeather(currentWeather);
    FC.toast(next ? '环境音效：开' : '环境音效：关');
  });

  /* ---------- 画质 ---------- */
  const segQ = document.getElementById('segQuality');
  segQ.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setQuality(b.dataset.q);
  });
  function setQuality(q) {
    if (q === quality) { updateSeg(); return; }
    quality = q;
    updateSeg();
    godrays.setQuality(q);
    env.setQuality(q);
    FC.toast('画质：' + ({ low: '低', mid: '中', high: '高' }[q]) + '（部分设置需刷新完全生效）');
  }
  function updateSeg() {
    segQ.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.q === quality));
  }

  /* ---------- 进入小屋 ---------- */
  const btnEnter = document.getElementById('btnEnter');
  const zoneEl = document.getElementById('zone');
  let inside = false;
  let doorT = 0;

  // 室内与室外的相机位
  const OUT_POS = HOME_POS.clone();
  const OUT_TGT = HOME_TGT.clone();
  const IN_POS  = new three.Vector3(0.30, 1.55, 2.35);
  const IN_TGT  = new three.Vector3(-1.10, 1.05, -1.20);

  function enterCabin() {
    inside = true;
    btnEnter.querySelector('span').textContent = '走出小屋';
    cabin.doorTarget = 0.0;                         // 进屋后门关上
    zoneEl.classList.add('show');
    zoneEl.textContent = '屋内 · 点击台灯或按 L 开灯';
    if (audio) { audio.setIndoor(true); audio.step(true); }
    document.getElementById('sScene').textContent = FC.ENV_PRESETS[currentWeather].label + ' · 室内';
    // 相机进屋（用 tween 平滑）
    tweenCam(new three.Vector3(0.30, 1.55, 2.35), new three.Vector3(-1.10, 1.05, -1.20), 1.4);
    FC.toast('进入小屋');
    // 自动开灯（夜里/阴天进屋体验更好）
    if (!lampOn && (currentWeather === 'night' || currentWeather === 'rain' || currentWeather === 'dusk')) {
      setTimeout(() => { if (inside && !lampOn) toggleLamp(false); }, 700);
    }
  }
  function exitCabin() {
    inside = false;
    btnEnter.querySelector('span').textContent = '进入小屋';
    cabin.doorTarget = 1.0;
    zoneEl.classList.remove('show');
    if (audio) { audio.setIndoor(false); audio.step(true); }
    document.getElementById('sScene').textContent = FC.ENV_PRESETS[currentWeather].label;
    tweenCam(new three.Vector3(6.5, 4.2, 12.5), new three.Vector3(0, 2.0, 1.4), 1.5);
    FC.toast('走出小屋');
    // 稍后把门关回
    setTimeout(() => { if (!inside) cabin.doorTarget = 0.0; }, 1800);
  }
  btnEnter.addEventListener('click', () => { inside ? exitCabin() : enterCabin(); });

  /* ---------- 相机 tween ---------- */
  let camTween = null;
  function tweenCam(pos, tgt, dur) {
    camTween = {
      t: 0, dur: dur || 1.2,
      p0: camera.position.clone(), p1: pos.clone(),
      t0: controls.target.clone(), t1: tgt.clone()
    };
  }
  function updateCamTween(dt) {
    if (!camTween) return;
    camTween.t += dt;
    let k = FC.clamp(camTween.t / camTween.dur, 0, 1);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // easeInOutCubic
    camera.position.lerpVectors(camTween.p0, camTween.p1, e);
    controls.target.lerpVectors(camTween.t0, camTween.t1, e);
    if (k >= 1) camTween = null;
  }

  /* ---------- 自动巡游 ---------- */
  const btnTour = document.getElementById('btnTour');
  btnTour.addEventListener('click', () => {
    autoTour = !autoTour;
    controls.autoRotate = autoTour;
    btnTour.classList.toggle('primary', autoTour);
    btnTour.querySelector('span').textContent = autoTour ? '停止巡游' : '自动巡游';
    FC.toast(autoTour ? '自动巡游：开' : '自动巡游：关');
  });

  /* ---------- 拍照 ---------- */
  const btnShot = document.getElementById('btnShot');
  btnShot.addEventListener('click', () => {
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = '林间小屋_' + FC.ENV_PRESETS[currentWeather].label + '_' + ts + '.png';
    a.href = url;
    a.click();
    FC.toast('已保存截图');
  });

  /* ---------- 快捷键面板 ---------- */
  const btnKeys = document.getElementById('btnKeys');
  const keysEl = document.getElementById('keys');
  btnKeys.addEventListener('click', () => {
    keysEl.classList.toggle('show');
  });

  /* ============================================================
     ⑥ 键盘
     ============================================================ */
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '5') {
      const w = FC.WEATHERS[parseInt(k, 10) - 1];
      if (w) setWeather(w.id);
      return;
    }
    switch (k) {
      case 'l': toggleLamp(true); break;
      case 'e': inside ? exitCabin() : enterCabin(); break;
      case 'r':
        raysOn = !raysOn; swRays.classList.toggle('on', raysOn);
        godrays.enabled = raysOn;
        FC.toast(raysOn ? '丁达尔光束：开' : '丁达尔光束：关');
        break;
      case 't': btnTour.click(); break;
      case 'c':
        if (inside) tweenCam(new three.Vector3(0.30, 1.55, 2.35), new three.Vector3(-1.10, 1.05, -1.20), 0.9);
        else tweenCam(HOME_POS, HOME_TGT, 0.9);
        FC.toast('视角已复位');
        break;
      case 'p': btnShot.click(); break;
    }
  });

  /* ============================================================
     ⑦ 鼠标交互：点击小屋进入 / 点击台灯开关灯
     ============================================================ */
  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2();
  let downPos = null;

  renderer.domElement.addEventListener('pointerdown', e => {
    downPos = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 6) return;                    // 拖拽不算点击
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    if (inside) {
      // 点台灯
      if (cabin.lamp) {
        const hits = raycaster.intersectObject(cabin.lamp, true);
        if (hits.length) { toggleLamp(true); return; }
      }
    }
    // 点小屋本体 → 进入
    if (!inside) {
      const hits = raycaster.intersectObject(cabin.group, true);
      if (hits.length && hits[0].distance < 46) {
        enterCabin();
        return;
      }
    }
  });

  /* ============================================================
     ⑧ 悬停时光标提示
     ============================================================ */
  let hoverT = 0;
  renderer.domElement.addEventListener('pointermove', e => {
    hoverT = 0.06;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  /* ============================================================
     ⑨ 自适应
     ============================================================ */
  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  /* ============================================================
     ⑩ 主循环
     ============================================================ */
  const clock = new three.Clock();
  let fpsAcc = 0, fpsFrames = 0, fpsShown = 0;
  const sFps = document.getElementById('sFps');
  const sTime = document.getElementById('sTime');

  let ready = false;

  function init() {
    buildWorld();
    // 初始化天气（直接生效）
    env.setWeather('sunny', true);
    godrays.setMood(FC.ENV_PRESETS.sunny.rayColor, FC.ENV_PRESETS.sunny.rayStrength, true);
    document.getElementById('sScene').textContent = FC.ENV_PRESETS.sunny.label;
    cabin.doorTarget = 1.0;                    // 开场门半开，显得有人住
    ready = true;
    // 淡出加载层
    setTimeout(() => {
      document.getElementById('loader').classList.add('done');
    }, 260);
  }

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!ready) { renderer.render(scene, camera); return; }

    // 风
    FC.updateWind(dt, env);

    // 环境
    env.update(dt, camera);

    // 地形 / 水
    terrain.update(dt, env);

    // 植被
    veg.update(dt, env);

    // 小屋（灯光、门、炉火、烟）
    cabin.update(dt, env, lampOn);

    // 生物
    creatures.update(dt, camera, env);

    // 丁达尔：光源方向同步
    godrays.update(dt, camera, env.sunDir, env.sunPos);
    // 天气影响灰尘强度
    godrays.dustMat.uniforms.uIntensity.value *= 0.55 + env.cur.dust * 0.55;

    // 相机
    updateCamTween(dt);
    controls.update();

    // 音频
    if (audio) {
      audio.update(dt);
      // 跟随相机位置：室外近火炉时能听到一点
      const d = camera.position.distanceTo(new three.Vector3(-cabin.W + 0.6, 1, -1.3));
      if (!inside && audio.fireGain) {
        const near = FC.clamp(1 - (d - 4) / 8, 0, 1) * 0.05;
        audio.fireGain.gain.setTargetAtTime(near, audio.ctx.currentTime, 0.5);
      }
    }

    renderer.render(scene, camera);

    /* --- 状态栏 --- */
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) {
      fpsShown = Math.round(fpsFrames / fpsAcc);
      sFps.textContent = fpsShown;
      fpsAcc = 0; fpsFrames = 0;
    }
    const now = new Date();
    sTime.textContent = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  /* ============================================================
     启动
     ============================================================ */
  init();
  loop();

  // 首次交互时解锁音频（浏览器策略）
  const unlock = () => {
    if (audio && audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: false });

  // 暴露调试接口
  window.FC_APP = {
    scene, camera, renderer, controls, env, terrain, veg, cabin, creatures, godrays, audio,
    setWeather: id => setWeather(id),
    setLamp: v => { lampOn = v; userTouchedLamp = true; syncLampUI(); }
  };
})();
