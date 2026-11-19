import { useEffect, useState, type FormEvent } from "react";
import { api } from "../services/api";
import type { AuthUserSummary } from "./DiclikAccountModal";
import { DiclikOperations } from "./DiclikOperations";
import { CommissionPreview } from "./CommissionPreview";
import { AccountingDashboard } from "./AccountingDashboard";
import { AdminDashboard } from "./AdminDashboard";
import { AccreditationReview } from "./Accreditation";

export default function AdminPage() {
  const [section, setSection] = useState(() => {
    const hash = window.location.hash.slice(1);
    return ["contabilidad", "acreditaciones", "usuarios"].includes(hash) ? hash : "operaciones";
  });
  const [user, setUser] = useState<AuthUserSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    api.auth.getMe().then(data => {
      if (active && data?.user?.role === "admin") setUser({ ...data.user, fullName: data.user.full_name });
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function syncSection() {
      const hash = window.location.hash.slice(1);
      setSection(["contabilidad", "acreditaciones", "usuarios"].includes(hash) ? hash : "operaciones");
    }
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const result = await api.auth.login(String(data.get("email")), String(data.get("password")));
      setUser(result.user);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <h1 className="text-xl font-black text-amber-300">Administración DICLIK</h1>
        {user && <button className="text-sm underline" onClick={async () => { await api.auth.logout(); setUser(null); }}>Cerrar sesión</button>}
      </header>
      {user ? <>
        <nav aria-label="Secciones de Administración" className="flex flex-wrap gap-2">
          {[
            ["operaciones", "Operaciones"],
            ["contabilidad", "Contabilidad"],
            ["acreditaciones", "Acreditaciones"],
            ["usuarios", "Usuarios y disputas"],
          ].map(([id, name]) => <a key={id} href={`#${id}`}
            aria-current={section === id ? "page" : undefined}
            className={`rounded-lg border px-4 py-2 text-sm font-bold ${section === id ? "border-amber-400 bg-amber-400 text-slate-950" : "border-slate-700 text-slate-200"}`}>
            {name}
          </a>)}
        </nav>
        {section === "operaciones" && <AdminDashboard />}
        {section === "contabilidad" && <><AccountingDashboard /><CommissionPreview /></>}
        {section === "acreditaciones" && <AccreditationReview />}
        {section === "usuarios" && <DiclikOperations view="requests" role="cliente" user={user} onSignIn={() => setUser(null)} onContractAccepted={() => {}} />}
      </> : <form onSubmit={signIn} className="max-w-sm space-y-3 rounded-xl border border-slate-700 p-4">
        <label className="block">Correo de administración
          <input name="email" type="email" autoComplete="username" required className="block w-full rounded-lg bg-slate-900 p-2" />
        </label>
        <label className="block">Contraseña
          <input name="password" type="password" autoComplete="current-password" required className="block w-full rounded-lg bg-slate-900 p-2" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-amber-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">Entrar a Administración</button>
        {message && <p role="status">{message}</p>}
      </form>}
    </div>
  </main>;
}
