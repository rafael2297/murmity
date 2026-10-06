/**
 * Confere, de verdade, se o áudio do próprio Murmity ficou FORA da captura do
 * sistema usada no compartilhamento de tela.
 *
 * Como: toca um tom bem agudo (19 kHz, quase inaudível) por uma fração de
 * segundo pelo Murmity e olha se esse tom aparece na faixa capturada. Se a
 * exclusão estiver funcionando, o tom NÃO aparece; se aparecer, o áudio do
 * Murmity (vozes dos outros etc.) está indo junto pra quem assiste — eco.
 *
 * @returns true se o áudio do Murmity VAZA na captura (exclusão não funcionou)
 */
export async function ownAudioLeaksIntoCapture(captured: MediaStreamTrack): Promise<boolean> {
  const TONE_HZ = 19000;
  const ctx = new AudioContext({ sampleRate: 48000 });
  try {
    await ctx.resume();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    // Só analisa — a captura NÃO é ligada na saída de som (senão tocaria de volta).
    ctx.createMediaStreamSource(new MediaStream([captured])).connect(analyser);

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.05);
    gain.gain.setValueAtTime(0.08, now + 0.55);
    gain.gain.linearRampToValueAtTime(0, now + 0.6);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = TONE_HZ;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.65);

    const bins = new Float32Array(analyser.frequencyBinCount);
    const hzPerBin = ctx.sampleRate / analyser.fftSize;
    const toneBin = Math.round(TONE_HZ / hzPerBin);
    const noiseFrom = Math.round(16000 / hzPerBin);
    const noiseTo = Math.round(17500 / hzPerBin);

    let bestDb = -Infinity;
    const end = performance.now() + 900;
    while (performance.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      analyser.getFloatFrequencyData(bins);

      const tone = Math.max(bins[toneBin - 1], bins[toneBin], bins[toneBin + 1]);
      let noise = 0;
      for (let i = noiseFrom; i <= noiseTo; i++) noise += bins[i];
      noise /= noiseTo - noiseFrom + 1;

      // Captura em silêncio digital dá -Infinity: não é "vazamento".
      if (Number.isFinite(tone) && Number.isFinite(noise)) {
        bestDb = Math.max(bestDb, tone - noise);
      }
    }

    console.info(`[Murmity] teste de exclusão do áudio próprio: tom ${bestDb.toFixed(1)} dB acima do ruído`);
    // Um tom real aparece com folga (dezenas de dB acima do ruído de fundo).
    return bestDb > 25;
  } finally {
    ctx.close().catch(() => {});
  }
}
