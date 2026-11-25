/** Alertas sonoros gerados com Web Audio (sem arquivos de áudio). */
let ctx = null;

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    return null;
  }
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.28 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

/** Alarme de fim do timer: três sequências de sinos ascendentes. */
export function playAlarm() {
  if (!unlockAudio()) return;
  const t0 = ctx.currentTime + 0.05;
  const notes = [880, 1108.73, 1318.51, 1760];
  for (let r = 0; r < 3; r++) {
    notes.forEach((f, i) => {
      tone(f, t0 + r * 1.1 + i * 0.13, 0.5);
      tone(f * 2, t0 + r * 1.1 + i * 0.13, 0.25, { gain: 0.05, type: 'triangle' });
    });
  }
}

/** Bipe curto (avisos dos últimos segundos). */
export function playTick() {
  if (!unlockAudio()) return;
  tone(660, ctx.currentTime + 0.01, 0.12, { gain: 0.12, type: 'triangle' });
}
