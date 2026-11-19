import { useEffect, useState, type FormEvent } from "react";
import { api, type Accreditation, type ReviewAccreditation } from "../services/api";

const kinds: Record<Accreditation["kind"], string> = {
  titulo: "Título", diploma: "Diploma", carta: "Carta de experiencia laboral", referencias: "Experiencia con referencias",
};
const statuses = { pending: "En revisión", approved: "Aprobada", rejected: "Rechazada" };
const button = "rounded-lg border border-amber-400/50 px-3 py-2 text-sm text-amber-200 disabled:opacity-50";

function encodeFile(file: Blob): Promise<{ mime: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ mime: file.type, data: String(reader.result).split(",")[1] });
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file: File) {
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 12 * 1024 * 1024) {
    throw new Error("Selecciona una foto JPG o PNG de hasta 12 MB.");
  }
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 480 / Math.max(image.width, image.height));
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la foto.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const photo = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (!photo || photo.size > 180 * 1024) throw new Error("Selecciona una foto más pequeña.");
    return encodeFile(photo);
  } finally {
    image.close();
  }
}

export function SpecialistAccreditation({ role }: { role: "tecnico" | "profesional" }) {
  const [kind, setKind] = useState<Accreditation["kind"]>("titulo");
  const [record, setRecord] = useState<Accreditation | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    if (evidence.some(file => !["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > limit)) {
      setMessage(`Los archivos deben ser PDF, JPG o PNG de hasta ${isReferences ? "400 KB por carta" : "1 MB"}.`);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const files = await Promise.all(evidence.map(encodeFile));
      const preparedPhoto = await preparePhoto(photo);
      setRecord(await api.accreditation.submit({
        kind, photo: preparedPhoto,
        ...(isReferences ? { references: files, referencesConsent: inputs.get("referencesConsent") === "on" } : { document: files[0] }),
      }));
      form.reset();
      setKind("titulo");
      setMessage("Acreditación enviada a revisión.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo subir la acreditación.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-3 rounded-xl border border-slate-700 p-3 text-xs text-slate-200">
    <h3 className="text-sm font-bold text-white">Foto y acreditación</h3>
    {record && <p>Estado <strong>{statuses[record.status]}</strong>{record.reason && <> · {record.reason}</>}</p>}
    <p>La foto se muestra en tu perfil cuando se aprueba. La evidencia se comparte con Administración para la revisión.</p>
    {record?.status === "approved" && <p>Si envías nuevos archivos, tu acreditación volverá a revisión.</p>}
    <form onSubmit={submit} className="space-y-3">
      <label className="block">Foto de perfil
        <input name="photo" type="file" accept="image/jpeg,image/png" required className="block w-full mt-1" />
      </label>
      <label className="block">Tipo de documento
        <select name="kind" value={kind} onChange={event => setKind(event.target.value as Accreditation["kind"])} className="block mt-1 w-full rounded-lg bg-slate-900 p-2">
          <option value="titulo">Título</option>
          <option value="diploma">Diploma</option>
          {role === "tecnico" ? <option value="referencias">{kinds.referencias}</option> : <option value="carta">{kinds.carta}</option>}
        </select>
      </label>
      {kind === "referencias" ? <>
        <p>Adjunta una carta por cliente. Incluye el trabajo realizado, la fecha y un contacto autorizado de cada cliente.</p>
        {[1, 2, 3].map(number => <label key={number} className="block">Carta {number} (PDF, JPG o PNG, hasta 400 KB)
          <input name="document" type="file" accept="application/pdf,image/jpeg,image/png" required className="block w-full mt-1" />
        </label>)}
        <label className="flex gap-2">
          <input type="checkbox" name="referencesConsent" required />
          Confirmo que las cartas son de tres clientes distintos y que autorizaron el uso de su contacto para verificar la referencia.
        </label>
      </> : <label className="block">Documento (PDF, JPG o PNG, hasta 1 MB)
        <input name="document" type="file" accept="application/pdf,image/jpeg,image/png" required className="block w-full mt-1" />
      </label>}
      <button type="submit" className={button} disabled={busy}>{busy ? "Enviando…" : record ? "Enviar nuevos archivos" : "Enviar a revisión"}</button>
    </form>
    {message && <p role="status">{message}</p>}
  </section>;
}

export function AccreditationReview() {
  const [items, setItems] = useState<ReviewAccreditation[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try { await action(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo completar la operación."); }
    finally { setBusy(false); }
  }
  async function refresh() { setItems(await api.accreditation.list()); }
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
    {message && <p role="status">{message}</p>}
  </section>;
}
