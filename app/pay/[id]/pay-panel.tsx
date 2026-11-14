"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Charge } from "@/lib/charges";

const mxn = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export function PayPanel({ initial, qrSvg, demo }: { initial: Charge; qrSvg: string | null; demo: boolean }) {
  const router = useRouter();
  const [charge, setCharge] = useState(initial);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Confirmación: el estado "pagado" lo escribe el webhook en el servidor; aquí solo se consulta.
  useEffect(() => {
    if (charge.status !== "pendiente") return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/charges/${charge.id}`, { cache: "no-store" });
        if (res.ok) setCharge(await res.json());
      } catch {
        /* sin red un momento: se reintenta en el siguiente ciclo */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [charge.id, charge.status]);

  // Cuenta regresiva (se calcula en el cliente para no desfasar el HTML del servidor).
  useEffect(() => {
    if (charge.status !== "pendiente" || !charge.expiresAt) return;
    const expires = new Date(charge.expiresAt).getTime();
    const tick = () => setSecondsLeft(Math.max(0, Math.round((expires - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [charge.expiresAt, charge.status]);

  async function reissue() {
    if (!charge.dealId || !charge.templateId) return;
    setReissuing(true);
    setError(null);
    try {
      const res = await fetch("/api/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: charge.dealId, templateId: charge.templateId, method: charge.method ?? "qr" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo generar un QR nuevo");
      router.push(`/pay/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
      setReissuing(false);
    }
  }

  const status = charge.status;
  const expired = status === "expirado" || (status === "pendiente" && secondsLeft === 0);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-8">
      <header>
        <p className="text-sm text-slate-500">{charge.propertyTitle ?? "Propiedad"}</p>
        <h1 className="text-2xl font-bold">{charge.templateName ?? charge.concept}</h1>
        {charge.clientName && <p className="text-sm text-slate-500">Para {charge.clientName}</p>}
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
        <p className="text-sm text-slate-500">Monto</p>
        <p className="text-4xl font-bold tracking-tight">{mxn(charge.nominalAmount)}</p>
        {demo && (
          <p className="mx-auto mt-3 max-w-xs rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Demo: para no mover dinero de verdad, esta prueba cobra {mxn(charge.amount)} reales.
          </p>
        )}
      </section>

      {status === "pagado" ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-xl text-white">✓</span>
            <div>
              <p className="text-lg font-semibold text-emerald-900">Pago recibido</p>
              <p className="text-sm text-emerald-800">Tu comprobante ya quedó registrado.</p>
            </div>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="Concepto" value={charge.concept} />
            <Row label="Cobrado" value={mxn(charge.amount)} />
            {charge.paidAt && (
              <Row
                label="Fecha"
                value={new Date(charge.paidAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
              />
            )}
            <Row label="Referencia" value={`#${charge.numRef}`} />
            <Row label="Clave de rastreo" value={charge.trackingKey ?? "—"} mono />
          </dl>
        </section>
      ) : expired ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
          <p className="font-semibold">Este QR venció</p>
          <p className="mt-1 text-sm text-slate-600">Por seguridad los QR duran poco. Genera uno nuevo para pagar.</p>
          <button
            type="button"
            onClick={reissue}
            disabled={reissuing}
            className="mt-4 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {reissuing ? "Generando…" : "Generar un QR nuevo"}
          </button>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </section>
      ) : status === "fallido" ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          No se pudo generar el cobro. Pide al asesor que lo intente de nuevo.
        </section>
      ) : charge.method === "push" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
          <p className="font-semibold">Revisa tu celular</p>
          <p className="mt-1 text-sm text-slate-600">
            Te enviamos una solicitud de cobro CoDi. Ábrela en la app de tu banco para autorizar el pago.
          </p>
          <p className="mt-3 text-xs text-slate-500">Esperando confirmación…</p>
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
          {qrSvg && (
            <div
              className="mx-auto w-64 max-w-full [&>svg]:h-auto [&>svg]:w-full"
              role="img"
              aria-label="Código QR de CoDi para pagar"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <p className="mt-3 font-semibold">Escanéalo con la app de tu banco</p>
          <p className="text-sm text-slate-600">Paga con CoDi desde cualquier banco participante.</p>
          {secondsLeft !== null && (
            <p className="mt-2 text-xs text-slate-500">
              Vence en {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">Esperando confirmación…</p>
        </section>
      )}

      <footer className="mt-auto text-center text-xs text-slate-400">
        Simulación del Hackatón Cursor × pey · propiedades y clientes de ejemplo
      </footer>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-emerald-900/70">{label}</dt>
      <dd className={`text-right font-medium text-emerald-950 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
