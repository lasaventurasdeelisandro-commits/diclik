import React, { useState, lazy, Suspense } from "react";
import { ArrowRight, BriefcaseBusiness, MousePointer2, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { isAdminPage } from "./services/api";
import { DirectoMobileApp } from "./components/DirectoMobileApp";

const AdminPage = (import.meta as ImportMeta & { env?: { VITE_DICLIK_ANDROID?: string } }).env?.VITE_DICLIK_ANDROID === "true" ? null : lazy(() => import("./components/AdminPage"));

const voice = registerPlugin<{ speak(options: { text: string }): Promise<void> }>("DiclikVoice");

type Portal = "cliente" | "profesional" | "tecnico";
const roles: { id: Portal; name: string; description: string; accent: string; icon: LucideIcon }[] = [
  { id: "cliente", name: "Cliente", description: "Busca y contrata servicios", accent: "bg-blue-400/15 text-blue-300", icon: UserRound },
  { id: "profesional", name: "Profesional", description: "Ofrece tus servicios profesionales", accent: "bg-orange-400/15 text-orange-300", icon: BriefcaseBusiness },
  { id: "tecnico", name: "Técnico", description: "Encuentra trabajos de tu oficio", accent: "bg-emerald-400/15 text-emerald-300", icon: Wrench },
];

export default function App() {
  const [portal,setPortal] = useState<Portal|null>(null);
  const [voiceError, setVoiceError] = useState("");
  const handleSpeak = (text:string) => {
    if (Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("DiclikVoice")) {
      setVoiceError("");
      void voice.speak({ text }).catch(error => setVoiceError(error.message || "No se pudo reproducir la voz de Android."));
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "es-DO";
    window.speechSynthesis.speak(utterance);
  };
  if (AdminPage && isAdminPage() && !Capacitor.isNativePlatform()) {
    return <Suspense fallback={<p role="status">Cargando Administración…</p>}><AdminPage /></Suspense>;
  }
  if (portal) return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <button type="button" onClick={()=>setPortal(null)} className="fixed z-[100] top-3 left-3 rounded-full bg-slate-950/90 border border-amber-400/50 px-4 py-2 text-white text-sm shadow-xl" aria-label="Volver a elegir rol">← Cambiar rol</button>
      {voiceError && <p role="status" className="fixed z-[100] bottom-16 left-3 right-3 mx-auto max-w-md rounded-xl bg-slate-900 p-3 text-sm text-amber-200">{voiceError}</p>}
      <DirectoMobileApp standalone={true} onSpeak={handleSpeak} initialRole={portal}/>
    </div>
  );
  return (
    <main className="grid min-h-dvh place-items-center bg-[#08172e] px-5 py-8 text-white">
      <div className="w-full max-w-md">
        <header className="mb-9 text-center">
          <div className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="grid size-12 place-items-center rounded-xl bg-blue-600 text-white">
              <MousePointer2 size={25} fill="currentColor" />
            </span>
            <span className="text-4xl font-extrabold leading-none tracking-tight">DICLIK<span aria-hidden="true" className="text-amber-400">.</span></span>
          </div>
          <p className="mt-3 text-sm text-slate-300 sm:text-base">Un clic, miles de soluciones</p>
        </header>
        <h1 className="mb-3 text-lg font-semibold">Elige tu perfil</h1>
        <ul className="space-y-3">
          {roles.map(role => (
            <li key={role.id}>
              <button
                type="button"
                aria-label={`Entrar como ${role.name}`}
                onClick={() => {
                  setPortal(role.id);
                  handleSpeak(`Bienvenido a DICLIK. Has elegido el perfil de ${role.name}.`);
                }}
                className="flex w-full items-center gap-3 rounded-xl border border-slate-700 bg-[#11243e] p-3 text-left transition-colors hover:border-blue-300/60 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-300 sm:px-4"
              >
                <span aria-hidden="true" className={`grid size-11 shrink-0 place-items-center rounded-lg ${role.accent}`}><role.icon size={21} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold">{role.name}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-slate-300">{role.description}</span>
                </span>
                <ArrowRight aria-hidden="true" size={17} className="mr-1 shrink-0 text-slate-400" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
