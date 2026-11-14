"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ChargeButton({
  dealId,
  templateId,
  label,
}: {
  dealId: string;
  templateId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId, templateId, method: "qr" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el cobro");
      router.push(`/pay/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? "Generando QR…" : label}
      </button>
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
    </span>
  );
}
