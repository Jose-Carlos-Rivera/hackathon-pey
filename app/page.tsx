import { connection } from "next/server";
import { Suspense } from "react";
import { listBoard } from "@/lib/deals";
import { ChargeButton } from "./charge-button";

const mxn = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

const STATUS_STYLE: Record<string, string> = {
  publicada: "bg-emerald-100 text-emerald-800",
  apartada: "bg-amber-100 text-amber-800",
  suspendida: "bg-slate-200 text-slate-700",
};

async function Board() {
  await connection(); // datos en vivo: se resuelve en cada petición, nunca en el build
  const { deals, properties, activity } = await listBoard();

  return (
    <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Pipeline</h2>
        {deals.map((d) => (
          <article key={d.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{d.clientName}</p>
                <p className="text-sm text-slate-500">{d.propertyTitle ?? "Sin propiedad"}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {d.stageName}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {d.propertyKind === "renta" ? (
                <ChargeButton dealId={d.id} templateId="tpl-renta" label="Cobrar renta · QR" />
              ) : (
                <ChargeButton dealId={d.id} templateId="tpl-apartado" label="Cobrar apartado · QR" />
              )}
              <ChargeButton dealId={d.id} templateId="tpl-poliza" label="Cobrar póliza · QR" />
            </div>
          </article>
        ))}
      </section>

      <aside className="space-y-8">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Propiedades</h2>
          {properties.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <div>
                <p className="text-sm font-medium">{p.title}</p>
                <p className="text-xs text-slate-500">
                  {mxn(p.price)}
                  {p.kind === "renta" ? " / mes" : ""}
                </p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[p.status] ?? ""}`}>
                {p.status}
              </span>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Bitácora</h2>
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay movimientos.</p>
          ) : (
            <ul className="space-y-2">
              {activity.map((a) => (
                <li key={a.id} className="rounded-lg bg-slate-100 px-3 py-2 text-sm">
                  {a.text}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Simulación · Hackatón Cursor × pey</p>
        <h1 className="mt-1 text-2xl font-bold">Cobro en la cita</h1>
        <p className="mt-1 text-sm text-slate-600">
          El asesor cobra el apartado con CoDi durante la visita, y el pipeline, la propiedad y el recibo se actualizan solos.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-slate-500">Cargando pipeline…</p>}>
        <Board />
      </Suspense>
    </main>
  );
}
