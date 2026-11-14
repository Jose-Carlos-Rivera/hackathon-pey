// Aquí aterriza cada evento ya verificado de pey.
//
// Idempotencia: pey puede reenviar el mismo webhook. `webhook-id` es la llave: se reclama con un
// INSERT único y, si ya se procesó, se sale sin tocar nada. Además cada paso de la automatización
// es idempotente por sí mismo (UPDATE a un valor fijo, bitácora con restricción única), así que un
// evento que falló a medias se puede reintentar sin duplicar acciones.
import { sql } from "./db";
import type { CodiPnPaymentReceived, CodiQrPaymentReceived, PeyWebhookEvent } from "./pey-webhook";

type Row = Record<string, unknown>;

export type HandleResult = {
  status: "processed" | "duplicate" | "ignored" | "unmatched" | "amount_mismatch" | "extra_payment";
  detail?: string;
};

const mxn = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

export async function handlePeyEvent(event: PeyWebhookEvent, webhookId: string): Promise<HandleResult> {
  const db = sql();

  // 1) Reclamar el evento. Si ya existe y ya se procesó, es un reenvío: no se hace nada.
  const claimed = (await db`
    insert into pey_events (webhook_id, type, payload)
    values (${webhookId}, ${event.type}, ${JSON.stringify(event)}::jsonb)
    on conflict (webhook_id) do nothing
    returning webhook_id
  `) as Row[];
  if (claimed.length === 0) {
    const prev = ((await db`select processed_at from pey_events where webhook_id = ${webhookId}`) as Row[])[0];
    if (prev?.processed_at) {
      log(webhookId, event.type, { status: "duplicate" });
      return { status: "duplicate" };
    }
    // Existe pero no terminó (falló antes): se vuelve a procesar.
  }

  // 2) Aplicar.
  let result: HandleResult;
  if (event.type === "codi.qr.payment_received" || event.type === "codi.pn.payment_received") {
    result = await applyCodiPayment(event);
  } else {
    result = { status: "ignored", detail: event.type };
  }

  // 3) Marcar como procesado solo si todo lo anterior salió bien (si lanzó, pey reintenta).
  await db`update pey_events set processed_at = now() where webhook_id = ${webhookId}`;
  log(webhookId, event.type, result, "transactionId" in event ? event.transactionId : undefined);
  return result;
}

async function applyCodiPayment(event: CodiQrPaymentReceived | CodiPnPaymentReceived): Promise<HandleResult> {
  const db = sql();

  // Liga el pago con su cobro: primero por el id que mandamos en `metadata`, luego por el numRef.
  const chargeId = event.metadata?.externalMetadata?.chargeId;
  let charge: Row | undefined;
  if (chargeId) {
    charge = ((await db`select * from charges where id = ${chargeId}`) as Row[])[0];
  }
  const numRef = Number(event.numRef);
  if (!charge && Number.isInteger(numRef)) {
    charge = ((await db`select * from charges where num_ref = ${numRef} order by created_at desc limit 1`) as Row[])[0];
  }
  if (!charge) return { status: "unmatched", detail: `numRef ${event.numRef}` };

  const dealId = (charge.deal_id as string | null) ?? null;

  // Confirmación del lado del servidor: el monto pagado debe ser el del cobro.
  if (Math.abs(Number(charge.amount) - event.amount) > 0.005) {
    await activity(dealId, charge.id as string, `monto_distinto:${event.transactionId}`,
      `Llegó un pago de ${mxn(event.amount)} pero el cobro era de ${mxn(Number(charge.amount))}: requiere revisión manual`);
    return { status: "amount_mismatch", detail: `${event.amount} vs ${charge.amount}` };
  }

  const trackingKey = event.metadata?.trackingKey ?? null;
  const paid = (await db`
    update charges
    set status = 'pagado', paid_at = to_timestamp(${event.datePaid}),
        pey_transaction_id = ${event.transactionId}, tracking_key = ${trackingKey}
    where id = ${charge.id as string} and status <> 'pagado'
    returning id
  `) as Row[];

  const ownPayment = paid.length > 0 || charge.pey_transaction_id === event.transactionId;
  if (!ownPayment) {
    // El cobro ya estaba pagado con otra transacción: un segundo pago al mismo QR. Se registra, no se repite nada.
    await activity(dealId, charge.id as string, `pago_extra:${event.transactionId}`,
      `Segundo pago recibido (${mxn(event.amount)}) en un cobro ya pagado: devolución manual si no corresponde`);
    return { status: "extra_payment" };
  }

  await activity(dealId, charge.id as string, "pago_recibido",
    `Pago recibido: ${mxn(Number(charge.nominal_amount))}${trackingKey ? ` · clave de rastreo ${trackingKey}` : ""}`);
  await runStageAutomations(charge);
  return { status: "processed" };
}

// Automatizaciones por etapa: la plantilla dice a qué etapa pasa el trato y la etapa dice qué dispara.
async function runStageAutomations(charge: Row): Promise<void> {
  const db = sql();
  const dealId = charge.deal_id as string | null;
  if (!dealId || !charge.template_id) return;

  const tpl = ((await db`select moves_to_stage from charge_templates where id = ${charge.template_id as string}`) as Row[])[0];
  const stageId = tpl?.moves_to_stage as string | null | undefined;
  if (!stageId) return;

  const stage = ((await db`select * from pipeline_stages where id = ${stageId}`) as Row[])[0];
  if (!stage) return;
  const deal = ((await db`select property_id from deals where id = ${dealId}`) as Row[])[0];

  await db`update deals set stage_id = ${stageId}, updated_at = now() where id = ${dealId}`;
  await activity(dealId, charge.id as string, "etapa_movida", `Trato movido a «${stage.name}»`);

  if (stage.suspend_property && deal?.property_id) {
    await db`update properties set status = 'apartada', updated_at = now() where id = ${deal.property_id as string}`;
    await activity(dealId, charge.id as string, "propiedad_apartada",
      "La propiedad se despublicó: ahora aparece como «Apartada»");
  }
  if (stage.send_agreement) {
    await activity(dealId, charge.id as string, "acuerdo_enviado", "Acuerdo de apartado enviado al cliente (simulado)");
  }
  if (stage.notify_agent) {
    await activity(dealId, charge.id as string, "asesor_notificado", "Asesor notificado del pago (simulado)");
  }
}

async function activity(dealId: string | null, chargeId: string, kind: string, text: string): Promise<void> {
  await sql()`
    insert into activity (deal_id, charge_id, kind, text)
    values (${dealId}, ${chargeId}, ${kind}, ${text})
    on conflict (charge_id, kind) do nothing
  `;
}

function log(webhookId: string, type: string, result: HandleResult, transactionId?: string) {
  console.log(JSON.stringify({ src: "pey-webhook", webhookId, type, transactionId, ...result }));
}
