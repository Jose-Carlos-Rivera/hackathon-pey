// Verificación de webhooks de pey (firmados con Standard Webhooks) y tipos de sus eventos.
// Docs: https://docs.pey.mx/docs/webhooks/introduction
import { Webhook } from "standardwebhooks";
import type { PeyAmountBreakdown, PeyPaymentLinkStatus, PeyTransactionMetadata } from "./pey";

type CodiPaymentBase = {
  apiKeyId: string;
  /** Solo viene si el cobro se creó con `bankAccountId`. */
  bankAccountId?: string;
  amount: number;
  concept: string;
  /** Segundos Unix. */
  datePaid: number;
  numRef: string;
  transactionId: string;
  metadata: PeyTransactionMetadata;
};

export type CodiQrPaymentReceived = CodiPaymentBase & {
  type: "codi.qr.payment_received";
  /** IDC de Banxico (el `id` que devolvió createQr). */
  codiQrId: string;
};

export type CodiPnPaymentReceived = CodiPaymentBase & {
  type: "codi.pn.payment_received";
};

export type PaymentLinkStatusUpdated = {
  type: "payment_link.status_updated";
  apiKeyId: string;
  paymentLinkId: string;
  status: Exclude<PeyPaymentLinkStatus, "partial">;
  clientReferenceId?: string;
  transactions: Array<{
    transactionId: string;
    paymentMethod: string;
    datePaid: number;
    amount: number;
    amountBreakdown: PeyAmountBreakdown;
    applicationFee: number | null;
    metadata: PeyTransactionMetadata;
  }>;
};

export type BankAccountUpdated = {
  type: "bank.account.updated";
  bankAccountId: string;
  name: string;
  ownerType: string;
  ownerId: string;
  taxId?: string;
  codiStatus: "ACTIVE";
  clabe: string;
  entity: "BUSINESS" | "PERSON";
};

export type PeyWebhookEvent =
  | CodiQrPaymentReceived
  | CodiPnPaymentReceived
  | PaymentLinkStatusUpdated
  | BankAccountUpdated;

export class WebhookConfigError extends Error {}
export class WebhookSignatureError extends Error {}

/**
 * Valida la firma con el cuerpo CRUDO (string, no el JSON ya parseado) y devuelve el evento.
 * Lanza WebhookConfigError si falta el secreto y WebhookSignatureError si la firma no cuadra.
 */
export function verifyPeyWebhook(rawBody: string, headers: Record<string, string>): PeyWebhookEvent {
  const secret = process.env.PEY_WEBHOOK_SECRET;
  if (!secret) throw new WebhookConfigError("Falta la variable PEY_WEBHOOK_SECRET");
  try {
    return new Webhook(secret).verify(rawBody, headers) as PeyWebhookEvent;
  } catch (e) {
    throw new WebhookSignatureError(e instanceof Error ? e.message : "firma inválida");
  }
}
