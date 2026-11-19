type AlertMode = "voice" | "sound";
export type WorkAlert = "publishing" | "published" | "hired" | "arrived";

const storageKey = "diclik_work_alert_mode";
const notes: Record<WorkAlert, number[]> = {
  publishing: [440, 554],
  published: [523, 659, 784],
  hired: [587, 880],
  arrived: [784, 659, 880],
};

let audio: AudioContext | null = null;
let nextTone = 0;

export function getWorkAlertMode(): AlertMode {
  try {
    return localStorage.getItem(storageKey) === "sound" ? "sound" : "voice";
  } catch {
    return "voice";
  }
}

export function setWorkAlertMode(mode: AlertMode) {
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    // The browser may disable local storage.
  }
}

export function unlockWorkAlerts() {
  if (getWorkAlertMode() !== "sound" || typeof AudioContext === "undefined") return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch {
    // Text alerts remain visible if the device has no audio output.
  }
}

export function playWorkAlert(event: WorkAlert, text: string, speak: (text: string) => void) {
  if (getWorkAlertMode() === "voice") {
    speak(text);
    return;
  }
  if (!audio) return;
  const context = audio;
  if (context.state !== "running") {
    void context.resume().then(() => {
      if (getWorkAlertMode() === "sound") playTones(context, event);
    }).catch(() => {});
    return;
  }
  playTones(context, event);
}

function playTones(context: AudioContext, event: WorkAlert) {
  let start = Math.max(context.currentTime, nextTone);
  for (const pitch of notes[event]) {
    const tone = context.createOscillator();
    const envelope = context.createGain();
    tone.frequency.value = pitch;
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.exponentialRampToValueAtTime(0.065, start + 0.018);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    tone.connect(envelope).connect(context.destination);
    tone.start(start);
    tone.stop(start + 0.17);
    start += 0.13;
  }
  nextTone = start + 0.08;
}
