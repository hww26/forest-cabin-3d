/* ============================================================
   audio.js —— 环境音效（纯 WebAudio 程序合成，零外部资源）
   ① 风：带通滤波的白噪声 + 慢速包络
   ② 雨：高通白噪声 + 随机"雨滴"脉冲
   ③ 炉火：低频噪声爆发 + 偶发噼啪
   ④ 鸟鸣：定时触发的短促 FM 音
   ⑤ 室内闷响感：切换场景时整体音量/滤波变化
   ============================================================ */
FC.Audio = function () {
  this.ctx = null;
  this.enabled = false;
  this.master = null;
  this.masterGain = 0;
  this.weather = 'sunny';
  this.indoor = false;
  this.timer = 0;
  this.birdTimer = 3;
  this.crackleTimer = 1;
};

FC.Audio.prototype.init = function () {
  if (this.ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  try {
    this.ctx = new AC();
  } catch (e) { return false; }

  const ctx = this.ctx;
  this.master = ctx.createGain();
  this.master.gain.value = 0;
  this.master.connect(ctx.destination);

  // 室内/室外用不同的滤波链
  this.outFilter = ctx.createBiquadFilter();
  this.outFilter.type = 'lowpass';
  this.outFilter.frequency.value = 20000;
  this.outFilter.Q.value = 0.4;
  this.outFilter.connect(this.master);
  this.indoorGain = ctx.createGain();
  this.indoorGain.gain.value = 1;
  this.indoorGain.connect(this.master);

  /* ---------- 噪声源（共用一段缓冲） ---------- */
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  this.noiseBuf = buf;

  /* ---------- 风 ---------- */
  this.windSrc = ctx.createBufferSource();
  this.windSrc.buffer = buf; this.windSrc.loop = true;
  this.windBP = ctx.createBiquadFilter();
  this.windBP.type = 'bandpass'; this.windBP.frequency.value = 420; this.windBP.Q.value = 0.7;
  this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
  this.windSrc.connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(this.outFilter);
  // 风包络调制（LFO）
  this.windLFO = ctx.createOscillator();
  this.windLFO.type = 'sine'; this.windLFO.frequency.value = 0.09;
  this.windLFOGain = ctx.createGain(); this.windLFOGain.gain.value = 0.035;
  this.windLFO.connect(this.windLFOGain); this.windLFOGain.connect(this.windGain.gain);
  this.windLFO.start();
  this.windSrc.start();

  /* ---------- 雨 ---------- */
  this.rainSrc = ctx.createBufferSource();
  this.rainSrc.buffer = buf; this.rainSrc.loop = true;
  this.rainHP = ctx.createBiquadFilter();
  this.rainHP.type = 'highpass'; this.rainHP.frequency.value = 1400;
  this.rainLP = ctx.createBiquadFilter();
  this.rainLP.type = 'lowpass'; this.rainLP.frequency.value = 7000;
  this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
  this.rainSrc.connect(this.rainHP); this.rainHP.connect(this.rainLP);
  this.rainLP.connect(this.rainGain); this.rainGain.connect(this.outFilter);
  this.rainSrc.start();

  /* ---------- 炉火底噪 ---------- */
  this.fireSrc = ctx.createBufferSource();
  this.fireSrc.buffer = buf; this.fireSrc.loop = true;
  this.fireLP = ctx.createBiquadFilter();
  this.fireLP.type = 'lowpass'; this.fireLP.frequency.value = 380; this.fireLP.Q.value = 0.6;
  this.fireGain = ctx.createGain(); this.fireGain.gain.value = 0;
  this.fireSrc.connect(this.fireLP); this.fireLP.connect(this.fireGain);
  this.fireGain.connect(this.indoorGain);
  this.fireSrc.start();

  this.enabled = true;
  return true;
};

FC.Audio.prototype.setEnabled = function (on) {
  if (on) {
    if (!this.init()) return false;
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  this.enabled = on;
  return true;
};

/* 切换天气：调整各层的目标音量与滤波 */
FC.Audio.prototype.setWeather = function (id) {
  if (!this.ctx) return;
  this.weather = id;
  const t = this.ctx.currentTime;
  const set = (param, v, time) => { param.setTargetAtTime(v, this.ctx.currentTime, time || 0.6); };
  switch (id) {
    case 'sunny':
      set(this.windGain.gain, 0.055); set(this.rainGain.gain, 0.0);
      set(this.outFilter.frequency, 18000);
      break;
    case 'mist':
      set(this.windGain.gain, 0.028); set(this.rainGain.gain, 0.0);
      set(this.outFilter.frequency, 6000);
      break;
    case 'rain':
      set(this.windGain.gain, 0.11); set(this.rainGain.gain, 0.16);
      set(this.rainHP.frequency, 1100); set(this.outFilter.frequency, 9000);
      break;
    case 'dusk':
      set(this.windGain.gain, 0.045); set(this.rainGain.gain, 0.0);
      set(this.outFilter.frequency, 14000);
      break;
    case 'night':
      set(this.windGain.gain, 0.038); set(this.rainGain.gain, 0.0);
      set(this.outFilter.frequency, 9000);
      break;
  }
};

/* 进出室内：整体音量 + 低通（墙壁闷音） */
FC.Audio.prototype.setIndoor = function (on) {
  if (!this.ctx) return;
  this.indoor = on;
  const t = this.ctx.currentTime;
  this.outFilter.frequency.setTargetAtTime(on ? 1100 : 16000, t, 0.35);
  this.indoorGain.gain.setTargetAtTime(on ? 0.9 : 0.0, t, 0.35);
  this.fireGain.gain.setTargetAtTime(on ? 0.075 : 0.0, t, 0.4);
};

FC.Audio.prototype.update = function (dt) {
  if (!this.ctx || !this.enabled) {
    if (this.master) this.master.gain.value = FC.damp(this.master.gain.value, 0, 4, dt);
    return;
  }
  const mw = this.weather;
  const target = (mw === 'night') ? 0.5 : (mw === 'rain' ? 0.62 : 0.42);
  this.master.gain.value = FC.damp(this.master.gain.value, target, 2.2, dt);

  /* 炉火噼啪（仅室内） */
  if (this.indoor) {
    this.crackleTimer -= dt;
    if (this.crackleTimer <= 0) {
      this.crackleTimer = FC.rand(0.25, 1.6);
      this.crackle();
    }
  }
  /* 鸟鸣（晴天/黄昏，室外） */
  if (!this.indoor && (mw === 'sunny' || mw === 'dusk')) {
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = FC.rand(2.5, 9);
      this.chirp();
    }
  }
};

/* ---------- 单次音效 ---------- */
FC.Audio.prototype.crackle = function () {
  if (!this.ctx) return;
  const ctx = this.ctx, t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = this.noiseBuf;
  s.playbackRate.value = FC.rand(0.8, 2.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(FC.rand(0.02, 0.09), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0005, t + FC.rand(0.05, 0.22));
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = FC.rand(500, 2600); f.Q.value = 2.5;
  s.connect(f); f.connect(g); g.connect(this.indoorGain);
  s.start(t, Math.random() * 2, 0.4);
};

FC.Audio.prototype.chirp = function () {
  if (!this.ctx) return;
  const ctx = this.ctx, t = ctx.currentTime;
  const notes = 2 + (Math.random() * 3 | 0);
  const base = 1800 + Math.random() * 1400;
  for (let i = 0; i < notes; i++) {
    const st = t + i * FC.rand(0.055, 0.14);
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = base * FC.rand(0.9, 1.35);
    o.frequency.setValueAtTime(f0, st);
    o.frequency.exponentialRampToValueAtTime(f0 * FC.rand(1.15, 1.7), st + 0.045);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, st);
    g.gain.linearRampToValueAtTime(FC.rand(0.010, 0.028), st + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0004, st + FC.rand(0.05, 0.13));
    o.connect(g); g.connect(this.outFilter);
    o.start(st); o.stop(st + 0.2);
  }
};

/* 开关室内灯时的轻微"咔哒" */
FC.Audio.prototype.click = function () {
  if (!this.ctx || !this.enabled) return;
  const ctx = this.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(2600, t);
  o.frequency.exponentialRampToValueAtTime(400, t + 0.035);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.045, t);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 0.06);
  o.connect(g); g.connect(this.master);
  o.start(t); o.stop(t + 0.09);
};

/* 脚步声（进屋/踏板上用） */
FC.Audio.prototype.step = function (soft) {
  if (!this.ctx || !this.enabled) return;
  const ctx = this.ctx, t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = this.noiseBuf;
  s.playbackRate.value = FC.rand(0.5, 0.9);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1400, t);
  f.frequency.exponentialRampToValueAtTime(300, t + 0.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(soft ? 0.05 : 0.09, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0004, t + 0.13);
  s.connect(f); f.connect(g); g.connect(this.master);
  s.start(t, Math.random() * 2, 0.2);
};
