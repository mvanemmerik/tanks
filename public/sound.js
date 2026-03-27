// Procedural sound effects via Web Audio API. Exposes a global `Sound` object.
// All sounds are synthesized — no audio files required.
// AudioContext must be created after a user gesture (browser autoplay policy).

const Sound = (() => {
  let ctx = null;
  let enabled = true;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Noise burst: filtered white noise with gain envelope
  function noise(duration, filterFreq, filterQ, gainPeak, filterType = 'bandpass') {
    if (!enabled) return;
    const c = getCtx();
    const bufLen = Math.ceil(c.sampleRate * duration);
    const buf = c.createBuffer(1, bufLen, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    src.buffer = buf;

    const filt = c.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.value = filterFreq;
    filt.Q.value = filterQ;

    const gain = c.createGain();
    const now = c.currentTime;
    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(filt);
    filt.connect(gain);
    gain.connect(c.destination);
    src.start(now);
    src.stop(now + duration);
  }

  // Oscillator tone with frequency sweep and gain envelope
  function tone(startFreq, endFreq, duration, gainPeak, type = 'sine') {
    if (!enabled) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    const now = c.currentTime;

    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

    gain.gain.setValueAtTime(gainPeak, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  // ── Public sound effects ────────────────────────────────────────────────

  // Player fires a shot
  function shoot() {
    noise(0.07, 3500, 2, 0.35, 'highpass');
    tone(180, 60, 0.07, 0.25, 'square');
  }

  // Distant/enemy shot (quieter version)
  function shootEnemy() {
    noise(0.06, 2800, 2, 0.15, 'highpass');
    tone(140, 50, 0.06, 0.10, 'square');
  }

  // Projectile hits a tank
  function hit() {
    noise(0.15, 900, 1.5, 0.55, 'bandpass');
    tone(120, 35, 0.15, 0.20, 'sawtooth');
  }

  // Tank destroyed
  function explode() {
    noise(0.45, 400, 0.8, 0.80, 'lowpass');
    tone(90, 18, 0.45, 0.45, 'sawtooth');
    // Second noise layer for thickness
    noise(0.25, 1200, 1, 0.30, 'bandpass');
  }

  // Player's own tank destroyed (louder, lower)
  function playerExplode() {
    noise(0.60, 300, 0.7, 1.0, 'lowpass');
    tone(70, 15, 0.60, 0.55, 'sawtooth');
    noise(0.35, 800, 1, 0.45, 'bandpass');
  }

  // Win/game-over jingle — three rising tones
  function victory() {
    if (!enabled) return;
    const c = getCtx();
    const notes = [330, 415, 523];
    notes.forEach((freq, i) => {
      const delay = i * 0.18;
      const osc = c.createOscillator();
      const gain = c.createGain();
      const now = c.currentTime + delay;
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0, now);
      gain.gain.linearRampToValueAtTime(0.25, now + 0.03);
      gain.gain.setValueAtTime(0.25, now + 0.12);
      gain.gain.linearRampToValueAtTime(0.0, now + 0.18);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now);
      osc.stop(now + 0.20);
    });
  }

  function setEnabled(val) { enabled = val; }
  function isEnabled() { return enabled; }

  // Call on first user interaction to unblock AudioContext
  function unlock() { getCtx(); }

  return { unlock, shoot, shootEnemy, hit, explode, playerExplode, victory, setEnabled, isEnabled };
})();
