import { useState } from "react";

export const markets = {
  DO: { name: "República Dominicana", locale: "es-DO", currency: "DOP", language: "es" },
  US: { name: "United States", locale: "en-US", currency: "USD", language: "en" },
  MX: { name: "México", locale: "es-MX", currency: "MXN", language: "es" },
  CO: { name: "Colombia", locale: "es-CO", currency: "COP", language: "es" },
  ES: { name: "España", locale: "es-ES", currency: "EUR", language: "es" },
  BR: { name: "Brasil", locale: "pt-BR", currency: "BRL", language: "pt" },
} as const;

export type Market = keyof typeof markets;
const storageKey = "diclik_market";
const isMarket = (value: unknown): value is Market =>
  typeof value === "string" && Object.hasOwn(markets, value);

export function readMarket(): Market {
  try {
    const stored = localStorage.getItem(storageKey);
    return isMarket(stored) ? stored : "DO";
  } catch {
    return "DO";
  }
}

const messages = {
  es: ["País", "Detectar con GPS", "Buscando país…", "No se pudo detectar el país. Puedes elegirlo manualmente.", "Este país aún no tiene operaciones habilitadas en Diclik."],
  en: ["Country", "Detect with GPS", "Detecting country…", "Could not detect your country. You can select it manually.", "Diclik operations are not yet available in this country."],
  pt: ["País", "Detectar via GPS", "Detectando país…", "Não foi possível detectar seu país. Selecione-o manualmente.", "As operações da Diclik ainda não estão disponíveis neste país."],
};

export function MarketSelector({ market, onChange }: { market: Market; onChange: (market: Market) => void }) {
  const [locating, setLocating] = useState(false);
  const [feedback, setFeedback] = useState<"error" | "unsupported" | null>(null);
  const profile = markets[market];
  const [label, locate, locatingLabel, error, unavailable] = messages[profile.language];

  function select(next: Market) {
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // The selection remains available in memory.
    }
    onChange(next);
  }

  async function detect() {
    setLocating(true);
    setFeedback(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000, maximumAge: 60000 });
      });
      const query = new URLSearchParams({
        latitude: position.coords.latitude.toFixed(2),
        longitude: position.coords.longitude.toFixed(2),
        localityLanguage: "en",
      });
      const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${query}`, {
        signal: AbortSignal.timeout(6000),
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("Country lookup failed");
      const { countryCode } = await response.json();
      if (!isMarket(countryCode)) {
        setFeedback("unsupported");
        return;
      }
      select(countryCode);
    } catch {
      setFeedback("error");
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-white/15 bg-[#141f31] p-3 text-sm text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="diclik-market">{label}</label>
        <select id="diclik-market" value={market} disabled={locating} onChange={event => {
          const next = event.currentTarget.value;
          if (isMarket(next)) {
            setFeedback(null);
            select(next);
          }
        }} className="min-w-0 rounded-md bg-[#0b1424] p-2">
          {Object.entries(markets).map(([code, item]) => <option key={code} value={code}>{item.name} · {item.currency}</option>)}
        </select>
        <button type="button" onClick={detect} disabled={locating} className="min-h-9 rounded-md px-2 font-medium text-amber-200 hover:bg-white/10">
          {locating ? locatingLabel : locate}
        </button>
      </div>
      {(feedback || market !== "DO") && (
        <p role="status" className="mt-2 text-xs text-slate-300">{feedback === "error" ? error : unavailable}</p>
      )}
    </div>
  );
}
