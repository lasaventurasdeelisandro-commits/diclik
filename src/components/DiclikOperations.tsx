import { BadgeCheck, Check, ClipboardList, Phone, Star, Timer, UserRound } from "lucide-react";
import { ServicePreview, ServiceRequester, requestPhotos, type ServiceArea } from "./ServicePreview";
import type { WorkAlert } from "../services/publicationSound";
import { FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { RadarPoint } from "./RadarMap";
import { RadarGrid, RadarServiceCard, type RadarSort, type RadarSpecialist } from "./RadarServices";
import { needsAccountDocuments, api } from "../services/api";
import { ContractMap } from "./ContractMap";
import { getCurrentLocation } from "../services/geolocation";
import type { AuthUserSummary } from "./DiclikAccountModal";
const RadarMap = lazy(() => import("./RadarMap").then(module => ({ default: module.RadarMap })));

type Role = "cliente" | "tecnico" | "profesional";
type View = "requests" | "radar" | "contracts" | "chat";
type RequestRow = { id: string; client_id?: string; target_role?: Role; title: string; description: string; status: string; category_name?: string; urgency?: string; min_budget?: number; address?: string; photos?: string[]; client_name?: string; client_avatar?: string | null; approximate_area?: ServiceArea | null };
type RadarRequest = {
  id: string; title: string; status: string; category: string | null;
  approxLat: number; approxLng: number; min_budget: number; distanceKm: number; clientAvatar?: string | null; clientName?: string | null;
};
type Offer = { id: string; pro_name: string; pro_avatar?: string; pro_phone?: string; pro_trade?: string; pro_rating?: number; pro_reviews?: number; pro_verified?: boolean; eta_minutes?: number; eta_reported?: boolean; professional_id: string; price: number; counter_price?: number; counter_proposed_by?: string; message: string; status: string };
type Contract = { completed_at?: string; pro_name?: string; agreed_price: number; commission_rate: number; platform_fee: number; professional_payout: number; id: string; request_title: string; status: string; address: string; otp_code?: string; professional_id: string; client_id: string };
type Conversation = { id: string; client_id: string; request_title: string; client_name: string; pro_name: string };
type Message = { id: string; sender_name: string; content: string };
type GPS = { lat: number; lng: number; updated_at?: string };

const card = "rounded-2xl border border-slate-700 bg-slate-800/80 p-3 space-y-2";
const button = "rounded-lg border border-amber-400/50 px-2.5 py-1.5 text-amber-200 font-bold disabled:opacity-50";
const input = "w-full rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-white";
const active = ["held_in_escrow", "active_in_transit", "in_progress"];
const statusLabel: Record<string, string> = {
  open: "Abierta", negotiating: "En negociación", held_in_escrow: "Fondos retenidos",
  active_in_transit: "En camino", in_progress: "En curso", completed: "Completada",
  cancelled: "Cancelada", disputed: "En disputa", pending: "Pendiente", countered: "Contraoferta",
  accepted: "Aceptada", rejected: "Rechazada",
};

const pesos = new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP" });
const percent = new Intl.NumberFormat("es-DO", { style: "percent", maximumFractionDigits: 2 });

const initialRadarCenter = { lat: 18.48, lng: -69.94 };
const radarRadius = 15;

function approximateCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function AmountForm({ label, onSubmit, disabled, amountRef, requestEta = false }: {
  label: string; onSubmit: (amount: number, eta?: number) => void; requestEta?: boolean; disabled: boolean; amountRef?: { current: HTMLInputElement | null };
}) {
  const [amount, setAmount] = useState("");
  const [eta, setEta] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(Number(amount), requestEta && eta ? Number(eta) : undefined);
  };
  return <form className={requestEta ? "grid gap-2" : "flex flex-wrap gap-2"} onSubmit={submit}>
    <input ref={amountRef} className={input} aria-label={label + " en pesos"} type="number" min="1" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
    {requestEta && <label className="space-y-1 text-sm text-slate-200">
      <span>Llegada estimada en minutos (opcional)</span>
      <input className={input} type="number" min="5" max="480" step="1" value={eta} onChange={event => setEta(event.target.value)} />
    </label>}
    <button className={requestEta ? "min-h-10 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50" : button} disabled={disabled}>{label}</button>
  </form>;
}

export function DiclikOperations({ view, user, role, onSignIn, initialRequest, onContractAccepted, onWorkAlert, onOpenRadarRequest }: {
  view: View; user: AuthUserSummary | null; role: Role; onSignIn: () => void; initialRequest?: string; onContractAccepted: () => void; onWorkAlert?: (event: WorkAlert, text: string) => void; onOpenRadarRequest?: (id: string) => void;
}) {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [offerResult, setOfferResult] = useState<{ id: string; rows: Offer[] } | null>(null);
  const [offerPanel, setOfferPanel] = useState(role === "cliente" && Boolean(initialRequest));
  const [selection, setSelection] = useState(initialRequest || "");
  const detailRef = useRef<HTMLElement>(null);
  const offers = offerResult?.id === selection ? offerResult.rows : [];
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [specialists, setSpecialists] = useState<RadarSpecialist[]>([]);
  const [radarRequests, setRadarRequests] = useState<RadarRequest[]>([]);
  const [radarRevision, setRadarRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [scanned, setScanned] = useState(false);
  const [radarCenter, setRadarCenter] = useState<GPS | null>(null);
  const [radarSelected, setRadarSelected] = useState<string | null>(null);
  const [radarError, setRadarError] = useState(false);
  const [offerSort, setOfferSort] = useState<RadarSort>("precio");
  const [requestCategory, setRequestCategory] = useState("");
  const quoteInput = useRef<HTMLInputElement>(null);
  const [focusQuote, setFocusQuote] = useState("");
  const [radarSort, setRadarSort] = useState<RadarSort>("precio");
  const [geographicMap, setGeographicMap] = useState(false);
  const sortedSpecialists = useMemo(() => [...specialists].sort((a, b) => {
    if (radarSort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
    if (radarSort === "rapido") return (a.etaMin ?? Infinity) - (b.etaMin ?? Infinity);
    return (a.basePrice ?? Infinity) - (b.basePrice ?? Infinity);
  }), [specialists, radarSort]);
  const mapCenter = radarCenter ?? initialRadarCenter;
  const isClient = role === "cliente";
  const radarMarkers = useMemo(() => isClient ? sortedSpecialists : radarRequests.map(item => ({
    id: item.id,
    name: item.title,
    trade: item.category || "Solicitud",
    distanceKm: item.distanceKm,
    basePrice: item.min_budget,
    latOffset: 50 + (item.approxLat - approximateCoordinate(mapCenter.lat)) * 111 * 35 / radarRadius,
    lngOffset: 50 + (item.approxLng - approximateCoordinate(mapCenter.lng)) * 111 * 35 / radarRadius,
  })), [isClient, sortedSpecialists, radarRequests, mapCenter]);
  const radarPoints: RadarPoint[] = useMemo(() => isClient
    ? sortedSpecialists.filter(item => Number.isFinite(item.latOffset) && Number.isFinite(item.lngOffset)).map(item => ({
      id: item.id,
      label: `${item.trade} · ${item.name}`,
      lat: approximateCoordinate(mapCenter.lat + (item.latOffset - 50) * radarRadius / (35 * 111)),
      lng: approximateCoordinate(mapCenter.lng + (item.lngOffset - 50) * radarRadius / (35 * 111)),
    }))
    : radarRequests.map(item => ({ id: item.id, label: item.title, lat: item.approxLat, lng: item.approxLng })),
  [isClient, sortedSpecialists, radarRequests, mapCenter]);

  const [adminUsers, setAdminUsers] = useState<{ id: string; email: string; role: string; status: string }[]>([]);
  const [disputes, setDisputes] = useState<{ id: string; reason: string; status: string }[]>([]);
  const isAdmin = user?.role === "admin";
  const canQuote = !isClient && user?.role === role;
  useEffect(() => {
    if (selection && focusQuote === selection) {
      quoteInput.current?.focus();
      setFocusQuote("");
    }
  }, [focusQuote, selection]);


  useEffect(() => {
    if (view !== "requests" || isClient || !initialRequest || !requestsLoaded || selection !== initialRequest) return;
    detailRef.current?.scrollIntoView({ block: "start" });
  }, [view, isClient, initialRequest, requestsLoaded, selection]);

  async function refresh() {
    if (isAdmin && view === "requests") {
      const [users, claims] = await Promise.all([api.admin.getUsers(), api.admin.getDisputes()]);
      setAdminUsers(Array.isArray(users) ? users : users.users || []);
      setDisputes(Array.isArray(claims) ? claims : []);
    } else if (view === "requests") {
      const rows: RequestRow[] = await api.services.list(isClient ? (user ? { clientId: user.id } : undefined) : { targetRole: role });
      const visible = isClient ? rows : rows.filter(row => ["open", "negotiating"].includes(row.status));
      if (initialRequest && !visible.some(row => row.id === initialRequest)) {
        const selected: RequestRow | null = await api.services.getById(initialRequest).catch(() => null);
        if (selected && (isClient ? selected.client_id === user?.id :
          selected.target_role === role && ["open", "negotiating"].includes(selected.status))) {
          visible.unshift(selected);
        }
      }
      setRequests(visible);
      setRequestsLoaded(true);
      if (selection && user) {
        const rows: Offer[] = await api.services.getOffers(selection);
        setOfferResult({ id: selection, rows });
      }
    } else if (view === "contracts" && user) {
      setContracts(await api.services.listContracts());
    } else if (view === "chat" && user) {
      setConversations(await api.chat.getConversations());
      if (selection) setMessages(await api.chat.getMessages(selection));
    }
  }

  useEffect(() => {
    refresh().catch(error => setNotice(error.message));
  }, [view, user?.id, role, selection]);

  useEffect(() => {
    if (view !== "requests" || !isClient || !user?.id || !selection || busy) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function updateOffers() {
      try {
        const rows: Offer[] = await api.services.getOffers(selection, controller.signal);
        if (!controller.signal.aborted) setOfferResult({ id: selection, rows });
      } catch {
        // Keep the current offers until the next refresh.
      }
      if (!controller.signal.aborted) timer = setTimeout(updateOffers, 8000);
    }
    timer = setTimeout(updateOffers, 8000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [view, isClient, user?.id, selection, busy]);

  useEffect(() => {
    if (view !== "radar") return;
    let current = true;
    setRadarError(false);
    setScanned(false);
    setSpecialists([]);
    setRadarRequests([]);
    setRadarSelected(null);
    const scan = role === "cliente"
      ? api.radar.scan({ ...mapCenter, radius: radarRadius }).then(rows => { if (current) setSpecialists(rows); })
      : api.radar.scanRequests(role, mapCenter, radarRadius).then(rows => { if (current) setRadarRequests(rows); });
    scan.then(() => { if (current) setScanned(true); })
      .catch(() => { if (current) setRadarError(true); });
    return () => { current = false; };
  }, [view, role, user?.id, mapCenter, radarRevision]);

  async function run(task: () => Promise<void>, success?: string) {
    setBusy(true);
    setNotice("");
    try {
      await task();
      if (success) setNotice(success);
    } catch (error) {
      if (needsAccountDocuments(error)) onSignIn();
      setNotice(error instanceof Error ? error.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  const categories: string[] = [...new Set<string>(requests.map(row => row.category_name).filter(Boolean) as string[])];
  const visibleRequests = offerPanel ? requests.filter(row => row.id === initialRequest)
    : !isClient && requestCategory ? requests.filter(row => row.category_name === requestCategory) : requests;
  const orderedOffers = [...offers].sort((first, second) => {
    if (first.status === "accepted" || second.status === "accepted") return Number(second.status === "accepted") - Number(first.status === "accepted");
    if (offerSort === "rapido") return (first.eta_reported ? first.eta_minutes ?? Infinity : Infinity) - (second.eta_reported ? second.eta_minutes ?? Infinity : Infinity);
    if (offerSort === "rating") return (Number(second.pro_reviews) > 0 ? Number(second.pro_rating) : 0) -
      (Number(first.pro_reviews) > 0 ? Number(first.pro_rating) : 0);
    return Number(first.counter_price ?? first.price) - Number(second.counter_price ?? second.price);
  });
  const list = view === "requests" && (
    <>
      <h2 className="font-bold text-amber-300">{isAdmin ? "Administración" : offerPanel ? "Ofertas de tu solicitud" : isClient ? "Mis solicitudes y ofertas" : "Solicitudes disponibles"}</h2>
      {!isClient && categories.length > 0 && <div className="space-y-2">
        <p className="flex justify-between gap-2 text-xs font-bold text-slate-300">
          <span>Filtrar por especialidad</span><span className="text-amber-300">{visibleRequests.length} {visibleRequests.length === 1 ? "solicitud" : "solicitudes"}</span>
        </p>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filtrar por especialidad">
          {["", ...categories].map(category => <button key={category} type="button" aria-pressed={requestCategory === category}
            onClick={() => setRequestCategory(category)} className="shrink-0 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold aria-pressed:border-amber-400 aria-pressed:bg-amber-400 aria-pressed:text-slate-950">
            {category || "Todas"}
          </button>)}
        </div>
      </div>}
      {offerPanel && <button type="button" className={button} onClick={() => { setOfferPanel(false); setSelection(""); }}>Ver todas mis solicitudes</button>}
      {isAdmin ? <>
        <h3 className="font-bold">Usuarios</h3>
        {adminUsers.map(item => <div className={card} key={item.id}>
          <p>{item.email} · {item.role} · {item.status}</p>
          {item.role !== "admin" && <div className="flex flex-wrap gap-2">
            <button className={button} disabled={busy} onClick={() => run(async () => {
              await api.admin.updateUserStatus(item.id, item.status === "active" ? "suspended" : "active");
              await refresh();
            }, "Estado actualizado.")}>{item.status === "active" ? "Suspender" : "Activar"}</button>

          </div>}
        </div>)}
        <h3 className="font-bold">Disputas</h3>
        {disputes.map(item => <div className={card} key={item.id}>
          <p>{item.reason} · {item.status}</p>
          {["open", "under_review"].includes(item.status) && <div className="flex flex-wrap gap-2">
            {(["refund_client", "release_pro"] as const).map(decision => <button key={decision} className={button} disabled={busy} onClick={() => run(async () => {
              await api.admin.resolveDispute(item.id, decision);
              await refresh();
            }, "Disputa resuelta.")}>{decision === "refund_client" ? "Reembolsar al cliente" : "Liberar al especialista"}</button>)}
          </div>}
        </div>)}
      </> : visibleRequests.length ? visibleRequests.map(row => <article key={row.id} ref={row.id === selection ? detailRef : undefined}
        className={`${card} scroll-mt-3 ${isClient ? "" : "border-emerald-500/45 bg-[#192639] p-3.5"}`}>
        {isClient ? <>
          <h3 className="font-bold">{row.title}</h3>
          <p>{row.description}</p>
          <p className="text-slate-300">{statusLabel[row.status] || row.status}</p>
        </> : <>
          <div className="flex items-center justify-between gap-2 rounded-xl bg-slate-950 px-3 py-2">
            <p className="flex items-center gap-2 font-bold text-slate-100"><ClipboardList size={16} aria-hidden="true" className="shrink-0 text-amber-300" />{row.category_name || "Servicio"}</p>
            <span className="rounded-md bg-emerald-950 px-2 py-1 text-xs font-semibold text-emerald-200">{statusLabel[row.status] || row.status}</span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-0.5 py-1">
            <ServiceRequester avatar={row.client_avatar} clientName={user ? row.client_name : undefined} />
            <div className="text-right text-xs text-slate-300">
              {Number(row.min_budget) > 0 && <p>Presupuesto desde</p>}
              <p className="font-bold text-emerald-300">{Number(row.min_budget) > 0 ? pesos.format(row.min_budget!) : "Cotización abierta"}</p>
            </div>
          </div>
          <div className="space-y-2.5 rounded-xl bg-slate-950/75 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-bold text-amber-300">{row.title}</h3>
              {row.urgency && <span className={`rounded-md px-2 py-1 text-xs font-bold ${row.urgency === "urgente" ? "bg-rose-950 text-rose-200" : "bg-slate-800 text-slate-200"}`}>
                {{ urgente: "Urgente", express: "Exprés", programado: "Programado" }[row.urgency] ?? row.urgency}
              </span>}
            </div>
            <p className="whitespace-pre-line break-words text-slate-100">{row.description}</p>
            <ServicePreview area={row.approximate_area} />
          </div>
        </>}
        {!offerPanel && <div className="flex flex-wrap gap-2">
          <button type="button" className={`${button} min-h-10`} onClick={() => {
            setOfferResult(null);
            setSelection(id => id === row.id ? "" : row.id);
          }} aria-expanded={selection === row.id}>
            {isClient ? (selection === row.id ? "Ocultar ofertas" : "Ver ofertas")
              : (selection === row.id ? "Ocultar detalles" : "Ver detalles de la solicitud")}
          </button>
          {!isClient && selection !== row.id && canQuote && row.client_id !== user?.id && <button type="button"
            className="min-h-10 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-white"
            onClick={() => { setOfferResult(null); setSelection(row.id); setFocusQuote(row.id); }}>Cotizar</button>}
        </div>}
        {selection === row.id && <>
          {!isClient && <div className="space-y-1 rounded-lg border border-slate-600 bg-slate-950 p-3 text-sm">
            <h4 className="font-bold text-white">Detalles del servicio</h4>
            {user && user.id === row.client_id && <p className="font-semibold text-amber-200">Tú publicaste esta solicitud. Solo otro especialista puede cotizarla.</p>}
            {user && !canQuote && user.id !== row.client_id && <p className="text-amber-200">Para cotizar, entra con una cuenta acreditada del rol que solicita el cliente.</p>}
          </div>}
          {isClient && user && (offerResult?.id !== row.id
            ? <p role="status" className="text-slate-300">Consultando ofertas…</p>
            : <p role="status" className="text-slate-300">{offers.length
                ? `${offers.length} ${offers.length === 1 ? "propuesta recibida" : "propuestas recibidas"}`
                : ["open", "negotiating"].includes(row.status) ? "Esperando cotizaciones. Las ofertas aparecerán aquí." : "Esta solicitud no tiene ofertas."}</p>)}
          {requestPhotos(row.photos).map((url, index) =>
            <img key={index} src={url} alt={`Foto de la solicitud ${index + 1}`} className="max-h-32 rounded-lg object-contain" />
          )}
          {isClient && offers.length > 1 && <div className="flex flex-wrap gap-2" aria-label="Ordenar propuestas">
            {([["precio", "Precio"], ["rapido", "Llegada"], ["rating", "Valoración"]] as const).map(([sort, label]) =>
              <button key={sort} type="button" aria-pressed={offerSort === sort} onClick={() => setOfferSort(sort)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-bold aria-pressed:border-emerald-400 aria-pressed:bg-emerald-500 aria-pressed:text-slate-950">{label}</button>)}
          </div>}
          {orderedOffers.filter(offer => (isClient && row.client_id === user?.id) || offer.professional_id === user?.id).map((offer, index) => {
            const amount = pesos.format(offer.counter_price ?? offer.price);
            const avatar = requestPhotos([offer.pro_avatar])[0];
            const phone = offer.pro_phone?.replace(/[^+0-9]/g, "");
            const pending = ["pending", "countered"].includes(offer.status);
            const canAccept = isClient ? offer.counter_proposed_by !== user?.id : Boolean(offer.counter_proposed_by && offer.counter_proposed_by !== user?.id);
            return <section key={offer.id} aria-label={`Propuesta de ${offer.pro_name}`} className={`space-y-3 rounded-2xl border bg-[#192639] p-3.5 ${index === 0 ? "border-amber-400/70" : "border-slate-600"}`}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {avatar ? <img src={avatar} alt="Foto de perfil del especialista" loading="lazy" referrerPolicy="no-referrer"
                    className="size-12 shrink-0 rounded-2xl border-2 border-amber-400 object-cover" />
                    : <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-amber-300"><UserRound size={20} /></span>}
                  <div className="min-w-0">
                    <h4 className="break-words font-bold text-white">{offer.pro_name}{offer.pro_verified && <BadgeCheck size={15} className="ml-1 inline text-amber-300" aria-label="Acreditado" />}</h4>
                    {offer.pro_trade && <p className="break-words text-xs text-slate-300">{offer.pro_trade}</p>}
                    <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold">
                      {Number(offer.pro_reviews) > 0 && <span className="inline-flex items-center gap-1 text-amber-300"><Star size={12} aria-hidden="true" />{offer.pro_rating} · {offer.pro_reviews} reseñas</span>}
                      {offer.eta_reported && Number(offer.eta_minutes) > 0 && <span className="inline-flex items-center gap-1 text-emerald-300"><Timer size={12} aria-hidden="true" />{offer.eta_minutes} min estimados</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-300">{statusLabel[offer.status] || offer.status}</p>
                  <p className="font-black text-emerald-300">{amount}</p>
                </div>
              </div>
              {offer.message && <p className="whitespace-pre-line break-words rounded-xl bg-slate-950/70 p-2.5 text-sm text-slate-100">{offer.message}</p>}
              <div className="flex flex-wrap gap-2">
                {isClient && offer.status === "accepted" && <>
                  {phone && <a href={`tel:${phone}`} className={`${button} inline-flex min-h-10 items-center gap-2`}><Phone size={15} aria-hidden="true" />Llamar</a>}
                  <button type="button" className={`${button} min-h-10`} onClick={onContractAccepted}>Ver contrato</button>
                </>}
                {pending && <>
                  <details className="min-w-32 flex-1 rounded-xl bg-slate-800">
                    <summary className="min-h-10 cursor-pointer px-3 py-2 font-bold text-emerald-100">Negociar</summary>
                    <div className="space-y-2 px-2 pb-2">
                      <AmountForm label="Contraofertar" disabled={busy} onSubmit={value => run(async () => {
                        await api.services.counterOffer(offer.id, value); await refresh();
                      }, "Contraoferta enviada. Si la otra parte acepta, se formalizará el contrato.")} />
                      <button type="button" className={button} disabled={busy} onClick={() => run(async () => {
                        await api.services.rejectOffer(offer.id); await refresh();
                      }, "Oferta rechazada.")}>Rechazar propuesta</button>
                    </div>
                  </details>
                  {canAccept && <button type="button" className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 self-start rounded-xl bg-amber-400 px-3 py-2 font-black text-slate-950 disabled:opacity-50"
                    disabled={busy} onClick={() => run(async () => {
                      await api.services.acceptOffer(offer.id);
                      onWorkAlert?.("hired", "Contratación confirmada.");
                      onContractAccepted();
                    }, "Contratación confirmada.")}><Check size={16} aria-hidden="true" />{isClient ? `Elegir por ${amount}` : "Aceptar contrapropuesta"}</button>}
                </>}
              </div>
            </section>;
          })}
          {canQuote && row.client_id !== user?.id && <AmountForm label="Enviar cotización" amountRef={quoteInput} requestEta disabled={busy} onSubmit={(amount, eta) => run(async () => {
            await api.services.submitOffer(row.id, amount, eta); await refresh();
          }, "Cotización enviada.")} />}
          {isClient && user && row.client_id === user.id && ["open", "negotiating"].includes(row.status) && <button className={button} disabled={busy} onClick={() => run(async () => {
            await api.services.remove(row.id); await refresh();
          }, "Solicitud cancelada.")}>Cancelar solicitud</button>}
        </>}
      </article>) : <p>{offerPanel && !requestsLoaded && !notice ? "Cargando tu solicitud…" : "No hay solicitudes para mostrar."}</p>}
    </>
  );

  return <section className="space-y-3 text-sm">
    {notice && <p role="status" className={card}>{notice}</p>}
    {!user && view !== "radar" && <button className={button} onClick={onSignIn}>Inicia sesión para continuar</button>}
    {view !== "radar" && <button className={button} disabled={busy} onClick={() => run(refresh)}>Actualizar</button>}
    {list}
    {view === "radar" && <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-emerald-300">Radar GPS</h2>
        <button type="button" className={button} onClick={() => setGeographicMap(value => !value)}>
          {geographicMap ? "Ver radar" : "Ver mapa de calles"}
        </button>
      </div>
      <figure className={card}>
        {geographicMap ? <Suspense fallback={<p role="status">Cargando mapa…</p>}>
          <RadarMap
            center={{ lat: approximateCoordinate(mapCenter.lat), lng: approximateCoordinate(mapCenter.lng) }}
            points={radarPoints}
            selected={radarSelected}
            onSelect={setRadarSelected}
            label={isClient ? "Mapa de especialistas" : "Mapa de solicitudes"}
          />
        </Suspense> : <RadarGrid specialists={radarMarkers} requestMode={!isClient} selected={radarSelected}
          onSelect={setRadarSelected} hasLocation={Boolean(radarCenter)} />}
        <figcaption className="text-slate-300">
          {radarCenter ? "Zona aproximada de tu ubicación" : "Vista inicial de Santo Domingo"}
          {radarPoints.length > 0 && " · Marcadores aproximados"}
        </figcaption>
      </figure>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => run(async () => {
          setRadarCenter(await getCurrentLocation());
        })}>Buscar cerca de mi ubicación</button>
        <button type="button" className={button} onClick={() => setRadarRevision(value => value + 1)}>Actualizar radar</button>
      </div>
      {radarError && <p role="status">No se pudo actualizar el radar. Intenta de nuevo.</p>}
      {!scanned && !radarError && <p role="status">{isClient ? "Buscando especialistas…" : "Buscando solicitudes…"}</p>}
      {isClient ? <>
        <div id="radar-resultados" className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-extrabold text-white">Especialistas disponibles</h3>
          <div className="flex gap-1 rounded-xl border border-slate-700 bg-slate-800 p-1" aria-label="Ordenar especialistas">
            {([["precio", "Precio"], ["rapido", "Rápido"], ["rating", "Rating"]] as const).map(([sort, label]) =>
              <button key={sort} type="button" aria-pressed={radarSort === sort}
                className={`rounded-lg px-2 py-1 text-xs font-bold ${radarSort === sort ? "bg-emerald-400 text-slate-950" : "text-slate-200"}`}
                onClick={() => setRadarSort(sort)}>{label}</button>)}
          </div>
        </div>
        {scanned && !specialists.length && <p>No hay especialistas disponibles en el radio consultado.</p>}
        {sortedSpecialists.map(item => <div key={item.id}>
          <RadarServiceCard specialist={item} selected={radarSelected === item.id} onSelect={() => setRadarSelected(item.id)} />
        </div>)}
      </> : <div id="radar-resultados" className="space-y-2">
        <h3 className="font-extrabold text-white">{role === "tecnico" ? "Solicitudes para técnicos" : "Solicitudes para profesionales"}</h3>
        {scanned && !radarRequests.length && <p>No hay solicitudes abiertas para este rol en la zona consultada.</p>}
        {radarRequests.map(item => <article key={item.id} className={`${card}${item.id === radarSelected ? " ring-2 ring-amber-400" : ""}`}>
          <h4 className="font-bold text-white">{item.title}</h4>
          <p className="text-slate-300">{item.category || "Servicio"} · {statusLabel[item.status]} · {item.distanceKm} km aprox.</p>
          {Number(item.min_budget) > 0 && <p>Presupuesto desde {pesos.format(item.min_budget)}</p>}
          <ServiceRequester avatar={item.clientAvatar} clientName={item.clientName} />
          <ServicePreview area={{ lat: item.approxLat, lng: item.approxLng }} />
          <button type="button" className={button} onClick={() => onOpenRadarRequest?.(item.id)}>Ver detalles de la solicitud</button>
        </article>)}
      </div>}
    </>}
    {view === "contracts" && <>
      <h2 className="font-bold text-amber-300">Contratos y rastreo</h2>
      {user && !contracts.length && <p>No hay contratos para mostrar.</p>}
      {contracts.map(item => <article className={card} key={item.id}>
        <h3 className="font-bold">{item.request_title}</h3>
        <p>{statusLabel[item.status] || item.status}</p>
        {(active.includes(item.status) || item.status === "completed") && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-xl bg-slate-950/70 p-3 text-xs">
            <dt>Precio acordado</dt><dd className="font-bold">{pesos.format(item.agreed_price)}</dd>
            <dt>Comisión DICLIK ({percent.format(item.commission_rate)})</dt><dd>{pesos.format(item.platform_fee)}</dd>
            <dt>Neto del especialista</dt><dd className="font-bold text-emerald-300">{pesos.format(item.professional_payout)}</dd>
          </dl>
        )}
        {item.status === "completed" && user?.id === item.client_id && (
          <details className="rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-sm">
            <summary className="cursor-pointer font-bold text-amber-200">Ver comprobante del servicio</summary>
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <dt>Servicio</dt><dd>{item.request_title}</dd>
              <dt>Referencia</dt><dd>{item.id}</dd>
              {item.pro_name && <><dt>Especialista</dt><dd>{item.pro_name}</dd></>}
              {item.completed_at && <><dt>Fecha de cierre</dt><dd>{new Date(item.completed_at).toLocaleDateString("es-DO", { timeZone: "America/Santo_Domingo" })}</dd></>}
              <dt className="font-bold">Total acordado</dt><dd className="font-bold">{pesos.format(item.agreed_price)}</dd>
            </dl>
            <p className="mt-3 text-xs text-slate-400">Comprobante informativo de DICLIK.</p>
          </details>
        )}
        {item.otp_code && active.includes(item.status) && <p>Código OTP: <strong>{item.otp_code}</strong></p>}
        {user && active.includes(item.status) && (item.client_id === user.id || item.professional_id === user.id) && (
          <ContractMap contractId={item.id} isClient={item.client_id === user.id} address={item.address} />
        )}
        {item.professional_id === user?.id && active.includes(item.status) && <>
          {item.status !== "in_progress" && <button className={button} disabled={busy} onClick={() => run(async () => {
            const arriving = item.status !== "held_in_escrow";
            await api.services.updateContractStatus(item.id, arriving ? "in_progress" : "active_in_transit");
            if (arriving) onWorkAlert?.("arrived", "Llegada registrada. Se avisó al cliente.");
            await refresh();
          }, "Estado actualizado.")}>{item.status === "held_in_escrow" ? "Iniciar trayecto" : "Marcar llegada"}</button>}
          <form className="flex gap-2" onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            run(async () => { await api.services.verifyOtp(item.id, String(data.get("otp"))); await refresh(); }, "Servicio completado y fondos liberados.");
          }}>
            <input className={input} aria-label="Código OTP del cliente" name="otp" pattern="[0-9]{4}" maxLength={4} inputMode="numeric" required />
            <button className={button} disabled={busy}>Validar OTP</button>
          </form>
        </>}
      </article>)}
    </>}
    {view === "chat" && <>
      <h2 className="font-bold text-indigo-300">Chat</h2>
      {user && !conversations.length && <p>Las conversaciones aparecen al contratar un servicio.</p>}
      {conversations.map(item => <button className={button} key={item.id} onClick={() => { setMessages([]); setSelection(item.id); }}>{item.request_title} · {item.client_id === user?.id ? item.pro_name : item.client_name}</button>)}
      {selection && <>
        {messages.map(item => <div className={card} key={item.id}><strong>{item.sender_name}</strong><p>{item.content}</p></div>)}
        <form className="flex gap-2" onSubmit={event => {
          event.preventDefault();
          run(async () => { await api.chat.sendMessage(selection, message.trim()); setMessage(""); await refresh(); });
        }}>
          <input className={input} aria-label="Mensaje" required value={message} onChange={event => setMessage(event.target.value)} />
          <button className={button} disabled={busy || !message.trim()}>Enviar</button>
        </form>
      </>}
    </>}
  </section>;
}
