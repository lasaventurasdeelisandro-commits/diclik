import { FileText, IdCard, Upload, UserRound } from "lucide-react";
import { prepareImage, readDataUrl } from "../services/prepareImage";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { api, type Accreditation, type ReviewAccreditation, type IdentitySubmission } from "../services/api";

const kinds: Record<Accreditation["kind"], string> = {
  titulo: "Título", diploma: "Certificado o diploma", carta: "Carta de experiencia laboral", referencias: "Experiencia con referencias",
};
const statuses = { pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" };
const button = "rounded-lg border border-amber-400/50 px-3 py-2 text-sm text-amber-200 disabled:opacity-50";

const uploadStyle = {
  identity: { panel: "border-sky-500/50 bg-sky-950", title: "text-sky-100", action: "bg-sky-200 text-sky-950", Icon: IdCard },
  portrait: { panel: "border-violet-500/50 bg-violet-950", title: "text-violet-100", action: "bg-violet-200 text-violet-950", Icon: UserRound },
  evidence: { panel: "border-amber-500/50 bg-amber-950", title: "text-amber-100", action: "bg-amber-200 text-amber-950", Icon: FileText },
};

function UploadField({ name, action, accept, tone, disabled }: {
  name: string; action: string; accept: string; tone: keyof typeof uploadStyle; disabled: boolean;
}) {
  const [filename, setFilename] = useState("");
  const descriptionId = useId();
  return <div className="space-y-1.5">
    <label className={`relative flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-white ${uploadStyle[tone].action}`}>
      <Upload className="size-4 shrink-0" aria-hidden="true" />
      {action}
      <input type="file" aria-label={action} aria-describedby={descriptionId} name={name} accept={accept} required disabled={disabled}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        onChange={event => setFilename(event.currentTarget.files?.[0]?.name ?? "")} />
    </label>
    <p id={descriptionId} className="break-all text-sm text-slate-200" aria-live="polite">{filename || "Sin archivo seleccionado"}</p>
  </div>;
}

function UploadSection({ tone, title, children }: {
  tone: keyof typeof uploadStyle; title: string; children?: ReactNode;
}) {
  const { panel, title: titleStyle, Icon } = uploadStyle[tone];
  return <section className={`space-y-3 rounded-xl border p-3.5 text-sm text-slate-100 ${panel}`}>
    <h3 className={`flex items-center gap-2 text-lg leading-tight font-bold ${titleStyle}`}>
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      {title}
    </h3>
    {children}
  </section>;
}

async function encodeFile(file: Blob) {
  const url = await readDataUrl(file);
  return { mime: file.type, data: url.slice(url.indexOf(",") + 1) };
}

async function prepareEvidence(file: File, limit: number) {
  if (file.type === "application/pdf") {
    if (file.size > limit) throw new Error(`El PDF supera el límite de ${limit / 1024} KB. Reduce su tamaño o adjunta una foto.`);
    return encodeFile(file);
  }
  return encodeFile(await prepareImage(file, 1800, limit));
}

export function AccountIdentity() {
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.accreditation.identity(controller.signal).then(result => setSubmitted(result.submitted)).catch(() => {
      if (!controller.signal.aborted) setMessage("No se pudo consultar la identificación.");
    });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("identity");
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    try {
      await api.accreditation.submitIdentity(await encodeFile(await prepareImage(file, 1600, 1024 * 1024)));
      setSubmitted(true);
      setMessage("Identificación recibida.");
      setFormVersion(version => version + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo enviar la identificación.");
    } finally {
      setBusy(false);
    }
  }

  return <UploadSection tone="identity" title="Cédula o identificación">
    <p>{submitted ? "Identificación recibida." : "Sube una foto legible de tu documento de identidad."}</p>
    <p className="text-sky-100/90">Solo Administración puede ver este documento.</p>
    <form key={formVersion} onSubmit={submit} className="space-y-3">
      <UploadField name="identity" action="Seleccionar foto de cédula o identificación" accept="image/*" tone="identity" disabled={busy} />
      <button type="submit" className={`${button} min-h-10`} disabled={busy}>
        {busy ? "Enviando identificación…" : submitted ? "Actualizar identificación" : "Enviar identificación"}
      </button>
    </form>
    {message && <p role="status" className="rounded-lg bg-slate-950/65 px-3 py-2">{message}</p>}
  </UploadSection>;
}

export function SpecialistAccreditation({ role }: { role: "tecnico" | "profesional" }) {
  const [kind, setKind] = useState<Accreditation["kind"]>("titulo");
  const [record, setRecord] = useState<Accreditation | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.accreditation.mine(controller.signal).then(setRecord).catch(() => {
      if (!controller.signal.aborted) setMessage("No se pudo consultar el estado de la acreditación.");
    });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const inputs = new FormData(form);
    const photo = inputs.get("photo");
    const isReferences = kind === "referencias";
    const evidence = inputs.getAll("document").filter((file): file is File => file instanceof File && file.size > 0);
    if (!(photo instanceof File) || !photo.size || evidence.length !== (isReferences ? 3 : 1)) {
      setMessage(isReferences ? "Selecciona tu foto y tres cartas de recomendación." : "Selecciona la foto y el documento.");
      return;
    }
    const limit = isReferences ? 400 * 1024 : 1024 * 1024;
    setBusy(true);
    setMessage("");
    try {
      const preparedPhoto = await encodeFile(await prepareImage(photo, 480, 180 * 1024));
      const files = [];
      for (const file of evidence) files.push(await prepareEvidence(file, limit));
      setRecord(await api.accreditation.submit({
        kind, photo: preparedPhoto,
        ...(isReferences ? { references: files, referencesConsent: inputs.get("referencesConsent") === "on" } : { document: files[0] }),
      }));
      setFormVersion(version => version + 1);
      setKind("titulo");
      setMessage("Acreditación enviada a revisión.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir la acreditación.");
    } finally {
      setBusy(false);
    }
  }

  return <form key={formVersion} onSubmit={submit} className="space-y-3">
    <UploadSection tone="portrait" title="Foto de perfil">
      <p>Sube una foto de tu rostro. Aparecerá en tu perfil cuando se apruebe.</p>
      <UploadField name="photo" action="Seleccionar foto de perfil" accept="image/*" tone="portrait" disabled={busy} />
    </UploadSection>
    <UploadSection tone="evidence" title="Documentos de acreditación">
      {record && <p>Estado <strong>{statuses[record.status]}</strong>{record.reason && <> · {record.reason}</>}</p>}
      <label className="block font-semibold">Tipo de documento
        <select name="kind" value={kind} disabled={busy} onChange={event => setKind(event.target.value as Accreditation["kind"])}
          className="mt-1.5 block min-h-11 w-full rounded-lg border border-amber-500/50 bg-slate-950 px-3 text-white">
          <option value="titulo">Título</option>
          <option value="diploma">Certificado o diploma</option>
          {role === "tecnico" ? <option value="referencias">{kinds.referencias}</option> : <option value="carta">{kinds.carta}</option>}
        </select>
      </label>
      {kind === "referencias" ? <>
        <p>Adjunta una carta por cliente en foto o PDF de hasta 400 KB. Incluye su nombre, contacto autorizado, trabajo realizado y fecha.</p>
        {[1, 2, 3].map(number => <div key={`carta-${number}`}>
          <UploadField name="document" action={`Seleccionar carta ${number}`} accept="application/pdf,image/*" tone="evidence" disabled={busy} />
        </div>)}
        <label className="flex items-start gap-2">
          <input className="mt-1 size-4 shrink-0" type="checkbox" name="referencesConsent" required disabled={busy} />
          Confirmo que las cartas son de tres clientes distintos y que autorizaron el uso de su contacto para verificar la referencia.
        </label>
      </> : <>
        <p>Adjunta una foto legible o un PDF de hasta 1 MB.</p>
        <div key={kind}>
          <UploadField name="document" action={`Seleccionar ${kinds[kind].toLowerCase()}`} accept="application/pdf,image/*" tone="evidence" disabled={busy} />
        </div>
      </>}
      {record?.status === "approved" && <p>Si envías nuevos archivos, tu acreditación volverá a revisión.</p>}
      <button type="submit" className={`${button} min-h-10`} disabled={busy}>
        {busy ? "Enviando…" : "Enviar foto y documentos a revisión"}
      </button>
      {message && <p role="status" className="rounded-lg bg-slate-950/65 px-3 py-2">{message}</p>}
    </UploadSection>
  </form>;
}

export function AccreditationReview() {
  const [items, setItems] = useState<ReviewAccreditation[]>([]);
  const [identities, setIdentities] = useState<IdentitySubmission[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  async function refresh() {
    const [accreditations, documents] = await Promise.all([api.accreditation.list(), api.accreditation.listIdentity()]);
    setItems(accreditations);
    setIdentities(documents);
  }
  useEffect(() => { void run(refresh); }, []);

  return <section className="space-y-3">
    <div className="flex items-center justify-between">
      <h2 className="font-bold text-amber-300">Acreditaciones de especialistas</h2>
      <button className={button} disabled={busy} onClick={() => run(refresh)}>Actualizar acreditaciones</button>
    </div>
    {!items.length && !busy && !message && <p>No hay acreditaciones enviadas.</p>}
    {items.map(item => <article key={item.revision} className="space-y-2 rounded-xl border border-slate-700 p-3">
      <h3 className="font-bold">{item.full_name} · {item.role === "tecnico" ? "Técnico" : "Profesional"}</h3>
      <p>{kinds[item.kind]} · {statuses[item.status]}{item.reason && <> · {item.reason}</>}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => run(() => api.accreditation.download(item.user_id, item.revision, "photo"))}>Descargar foto</button>
        <button className={button} disabled={busy} onClick={() => run(() => api.accreditation.download(item.user_id, item.revision, "document"))}>{item.kind === "referencias" ? "Descargar carta 1" : "Descargar documento"}</button>
        {item.kind === "referencias" && <>
          <button className={button} disabled={busy} onClick={() => run(() => api.accreditation.download(item.user_id, item.revision, "reference-2"))}>Descargar carta 2</button>
          <button className={button} disabled={busy} onClick={() => run(() => api.accreditation.download(item.user_id, item.revision, "reference-3"))}>Descargar carta 3</button>
        </>}
      </div>
      {item.status === "pending" && <form className="space-y-2" onSubmit={event => {
        event.preventDefault();
        const decision = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "rejected" ? "rejected" : "approved";
        const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
        if (decision === "rejected" && !reason) {
          setMessage("Indica el motivo del rechazo.");
          return;
        }
        void run(async () => {
          await api.accreditation.review(item.user_id, item.revision, decision, reason);
          await refresh();
          setMessage(decision === "approved" ? "Acreditación aprobada." : "Acreditación rechazada.");
        });
      }}>
        <label className="block">Motivo del rechazo
          <textarea name="reason" maxLength={500} className="block mt-1 w-full rounded-lg bg-slate-950 p-2" />
        </label>
        <div className="flex gap-2">
          <button type="submit" value="approved" className={button} disabled={busy}>Aprobar</button>
          <button type="submit" value="rejected" className={button} disabled={busy}>Rechazar</button>
        </div>
      </form>}
    </article>)}
    <h2 className="font-bold text-amber-300">Identificaciones recibidas</h2>
    {identities.map(item => <article key={item.user_id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700 p-3">
      <p>{item.full_name} · {item.role}</p>
      <button className={button} disabled={busy} onClick={() => run(() => api.accreditation.downloadIdentity(item.user_id))}>Descargar identificación</button>
    </article>)}
    {message && <p role="status">{message}</p>}
  </section>;
}
