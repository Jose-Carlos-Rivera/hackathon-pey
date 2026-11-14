import { notFound } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { Suspense } from "react";
import { getCharge, isDemoAmount } from "@/lib/charges";
import { PayPanel } from "./pay-panel";

// Página pública que ve el cliente: el QR para pagar el apartado y, después, su comprobante.
async function Content({ params }: { params: PageProps<"/pay/[id]">["params"] }) {
  await connection(); // el estado del cobro cambia solo: nunca se prerenderiza
  const { id } = await params;
  const charge = await getCharge(id);
  if (!charge) notFound();

  const qrSvg = charge.qrString
    ? await QRCode.toString(charge.qrString, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
    : null;

  return <PayPanel initial={charge} qrSvg={qrSvg} demo={isDemoAmount()} />;
}

export default function PayPage(props: PageProps<"/pay/[id]">) {
  return (
    <Suspense fallback={<p className="p-8 text-center text-sm text-slate-500">Cargando cobro…</p>}>
      <Content params={props.params} />
    </Suspense>
  );
}
