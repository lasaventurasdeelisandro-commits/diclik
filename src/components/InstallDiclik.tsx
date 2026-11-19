import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallDiclik() {
  const installedMode = () => window.matchMedia("(display-mode: standalone)").matches;
  const [installed, setInstalled] = useState(installedMode);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const native = Capacitor.isNativePlatform();
  const androidBrowser = /Android/i.test(navigator.userAgent);

  useEffect(() => {
    if (native) return;
    function prepare(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    }
    function finish() {
      setInstalled(true);
      setPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", prepare);
    window.addEventListener("appinstalled", finish);
    return () => {
      window.removeEventListener("beforeinstallprompt", prepare);
      window.removeEventListener("appinstalled", finish);
    };
  }, [native]);

  if (native || installed || (!prompt && !androidBrowser)) return null;

  async function install() {
    if (!prompt) {
      setShowInstructions(value => !value);
      return;
    }
    setPrompt(null);
    try {
      await prompt.prompt();
      if ((await prompt.userChoice).outcome === "accepted") setInstalled(true);
    } catch {
      setShowInstructions(true);
    }
  }

  return <div className="mt-4 text-center">
    <button type="button" onClick={install} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-500 px-3 text-sm font-bold text-slate-100">
      <Download size={16} aria-hidden="true" />Instalar Diclik
    </button>
    {showInstructions && <p role="status" className="mt-2 text-sm text-slate-300">
      Abre el menú de Chrome y pulsa <strong>Instalar aplicación</strong> o <strong>Añadir a pantalla de inicio</strong>.
    </p>}
  </div>;
}
