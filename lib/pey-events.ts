// Aquí aterriza cada evento ya verificado de pey.
// `webhookId` es la llave de idempotencia: pey puede reenviar el mismo evento y la acción
// (mover etapa, suspender propiedad, mandar recibo) NO debe ejecutarse dos veces.
import type { PeyWebhookEvent } from "./pey-webhook";

export async function handlePeyEvent(event: PeyWebhookEvent, webhookId: string): Promise<void> {
  // TODO(db): registrar `webhookId` con restricción única; si ya existe, salir sin hacer nada.
  // TODO(db): ligar el pago al cobro con `metadata.externalMetadata` (cobro, cliente, propiedad)
  //           y disparar las automatizaciones de la etapa.
  console.log(
    JSON.stringify({
      src: "pey-webhook",
      webhookId,
      type: event.type,
      ...("transactionId" in event ? { transactionId: event.transactionId, amount: event.amount } : {}),
    }),
  );
}
