export function preparePublicationSound() {
  if (typeof AudioContext === "undefined") return null;
  try {
    const context = new AudioContext();
    void context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

export async function playPublicationSound(context: AudioContext | null) {
  if (!context || context.state !== "running") return;
  const tone = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime;
  tone.frequency.setValueAtTime(620, start);
  tone.frequency.setValueAtTime(830, start + 0.095);
  gain.gain.setValueAtTime(0.09, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + 0.21);
  tone.connect(gain).connect(context.destination);
  await new Promise<void>(resolve => {
    tone.onended = () => resolve();
    tone.start(start);
    tone.stop(start + 0.22);
  });
}
