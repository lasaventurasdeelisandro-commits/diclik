import React, { useState, lazy, Suspense } from "react";
import { ArrowRight, BriefcaseBusiness, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { isAdminPage } from "./services/api";
import { DirectoMobileApp } from "./components/DirectoMobileApp";

const AdminPage = (import.meta as ImportMeta & { env?: { VITE_DICLIK_ANDROID?: string } }).env?.VITE_DICLIK_ANDROID === "true" ? null : lazy(() => import("./components/AdminPage"));

const voice = registerPlugin<{ speak(options: { text: string }): Promise<void> }>("DiclikVoice");

type Portal = "cliente" | "profesional" | "tecnico";
const roles: { id: Portal; name: string; description: string; icon: LucideIcon }[] = [
  { id: "cliente", name: "Cliente", description: "Busca y contrata servicios", icon: UserRound },
  { id: "profesional", name: "Profesional", description: "Ofrece tus servicios", icon: BriefcaseBusiness },
  { id: "tecnico", name: "Técnico", description: "Encuentra trabajos de tu oficio", icon: Wrench },
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
    <main className="grid min-h-dvh place-items-center bg-[#0b1424] bg-[radial-gradient(ellipse_at_top,#192e48,transparent_65%)] px-5 py-7 text-white lg:px-10">
      <div className="w-full max-w-md lg:grid lg:max-w-5xl lg:grid-cols-2 lg:items-center">
        <header className="mb-6 text-center lg:mb-0 lg:px-12">
          {/* The original artwork also contains lettering below the emblem. */}
          <div className="relative mx-auto mb-3 aspect-[630/363] w-36 overflow-hidden sm:w-44 lg:mb-5 lg:w-64">
            <img
              src="/assets/brand/diclik-logo-transparent.png"
              alt="Emblema de Diclik con la D, el aro y el dedo"
              className="absolute left-[-17.46%] top-[-10.19%] w-[126.99%] max-w-none"
              style={{ clipPath: "polygon(14% 27%, 30% 5.9%, 93% 5.9%, 93% 63.8%, 14% 63.8%)" }}
            />
          </div>
          <p className="text-5xl font-bold leading-none tracking-tight text-[#f7f1e7] lg:text-7xl">Diclik</p>
          <p className="mt-3 text-sm text-slate-300 lg:text-lg">Un clic, miles de soluciones</p>
        </header>
        <section aria-labelledby="profile-heading" className="border-t border-[#c4a16b]/25 pt-5 lg:border-t-0 lg:border-l lg:py-8 lg:pl-12">
          <h1 id="profile-heading" className="mb-4 text-xl font-semibold tracking-tight text-[#f7f1e7] lg:mb-6 lg:text-3xl">Elige tu perfil</h1>
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
                  className="group flex w-full items-center gap-3 rounded-xl border border-white/15 bg-[#141f31] px-3 py-3 text-left transition-colors hover:border-[#c4a16b]/75 hover:bg-[#1a2940] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#e2be84] sm:gap-4 sm:px-4 lg:py-4"
                >
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-lg border border-[#c4a16b]/25 bg-[#c4a16b]/10 text-[#e2be84] sm:size-11"><role.icon size={21} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-[#f7f1e7] lg:text-lg">{role.name}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-slate-300">{role.description}</span>
                  </span>
                  <ArrowRight aria-hidden="true" size={17} className="mr-1 shrink-0 text-[#e2be84] motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
