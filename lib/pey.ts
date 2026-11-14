// Cliente tipado de la API pública de pey (https://docs.pey.mx).
// Solo corre en el servidor: usa PEY_API_KEY, que nunca debe llegar al navegador.
// Montos en MXN, ids ULID, timestamps en segundos Unix.

const BASE_URL = process.env.PEY_API_BASE ?? "https://api.pey.mx";

/** Pares clave/valor que pey devuelve tal cual en `metadata.externalMetadata` (siempre como string). */
export type PeyMetadataInput = Record<string, string | number | boolean | null>;

export class PeyError extends Error {
  constructor(
    public status: number,
    public type: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "PeyError";
  }
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const apiKey = process.env.PEY_API_KEY;
  if (!apiKey) {
    throw new PeyError(500, "MISSING_API_KEY", "Falta la variable PEY_API_KEY");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new PeyError(res.status, "INVALID_RESPONSE", `Respuesta no JSON de pey (HTTP ${res.status})`);
    }
  }

  if (!res.ok) {
    const err = (data as { error?: { type?: string; message?: string; requestId?: string } } | null)?.error;
    throw new PeyError(
      res.status,
      err?.type ?? "UNKNOWN",
      err?.message ?? res.statusText,
      err?.requestId,
    );
  }
  return data as T;
}

// ───────────────────────── CoDi ─────────────────────────

export type CreateQrInput = {
  /** MXN. 0 = el pagador captura el monto al escanear. */
  amount: number;
  concept?: string;
  /** Segundos. 0 = sin expiración; si se fija, mínimo 360. */
  expiration?: number;
  /** Solo dígitos, máximo 7. */
  numRef?: string;
  /** Más lento: conviene dibujar el QR en el cliente con `qrString`. */
  generateImage?: boolean;
  /** Cuenta (ULID) que recibe el pago; debe estar ACTIVE. Si se omite, la de la API key. */
  bankAccountId?: string;
  metadata?: PeyMetadataInput;
};

export type CreateQrResult = {
  /** IDC asignado por Banxico. */
  id: string;
  /** Contenido a codificar en el QR. */
  qrString: string;
  qrImage?: string | null;
};

export const createQr = (input: CreateQrInput) =>
  request<CreateQrResult>("POST", "/codi/qr", input);

export type CreatePushInput = {
  /** MXN, mayor a 0 y hasta 1,000,000. */
  amount: number;
  /** 10 dígitos. */
  phoneNumber: string;
  concept?: string;
  /** Segundos, mínimo 360 (default 360). */
  expiration?: number;
  numRef?: string;
  bankAccountId?: string;
  metadata?: PeyMetadataInput;
};

export type CreatePushResult = {
  transactionId: string;
  /** Folio CoDi de 20 dígitos asignado por Banxico. */
  codiId: string;
};

export const createPush = (input: CreatePushInput) =>
  request<CreatePushResult>("POST", "/codi/pn", input);

// ───────────────────────── Links de pago (tarjeta) ─────────────────────────

export type CreatePaymentLinkInput = {
  amount: number;
  /** HTTPS. */
  successUrl: string;
  /** HTTPS. */
  backUrl: string;
  hasTip?: boolean;
  /** Máximo 255 caracteres. */
  clientReferenceId?: string;
  metadata?: PeyMetadataInput;
};

export const createPaymentLink = (input: CreatePaymentLinkInput) =>
  request<{ id: string; url: string }>("POST", "/payment-link/create", input);

export const updatePaymentLink = (paymentLinkId: string, amount: number) =>
  request<{ id: string; amount: number }>("POST", "/payment-link/update", { paymentLinkId, amount });

export type PeyPaymentLinkStatus = "pending" | "processing" | "paid" | "partial";

// ───────────────────────── Transacciones ─────────────────────────

export type PeyAmountBreakdown = { base: number; tip?: number; fee?: number };

/** Lo que pey agrega al pago; en CoDi trae la clave de rastreo de Banxico. */
export type PeyTransactionMetadata = {
  clabe?: string;
  bankCode?: number;
  accountType?: number;
  description?: string;
  trackingKey?: string;
  /** El `metadata` que mandaste al crear el cobro (valores siempre string). */
  externalMetadata?: Record<string, string>;
};

export type PeyTransaction = {
  id: string;
  status: "PENDING" | "PAID";
  amount: number;
  amountBreakdown: PeyAmountBreakdown;
  currency: string;
  paymentMethod: "CARD" | "CODI";
  payableType: "PAYMENT_LINK" | "API_CODI_QR" | "API_CODI_PN";
  payableId?: string;
  description?: string;
  applicationFee?: number;
  dateCreated: number;
  datePaid?: number;
  metadata?: PeyTransactionMetadata;
};

export type PeyPage<T> = { items: T[]; nextToken: string | null };

export const getTransaction = (id: string) =>
  request<PeyTransaction>("GET", `/transaction/${encodeURIComponent(id)}`);

export const listApiKeyTransactions = (nextToken?: string) =>
  request<PeyPage<PeyTransaction>>(
    "GET",
    `/transaction/api-key${nextToken ? `?nextToken=${encodeURIComponent(nextToken)}` : ""}`,
  );

// ───────────────────────── Cuentas bancarias (CLABE) ─────────────────────────

export type PeyCodiStatus = "PENDING" | "PROCESSING" | "ACTIVE" | "ERROR";

export type RegisterBankAccountInput = {
  alias: string;
  /** Nombre legal completo del titular. */
  name: string;
  /** 18 dígitos con dígito verificador válido y banco con CoDi. */
  clabe: string;
  entity: "BUSINESS" | "PERSON";
};

export const registerBankAccount = (input: RegisterBankAccountInput) =>
  request<{ id: string; codiStatus: PeyCodiStatus }>("POST", "/bank-account", input);

export type PeyBankAccount = {
  id: string;
  alias: string;
  name: string;
  clabe: string;
  entity: "BUSINESS" | "PERSON";
  taxId?: string;
  codiStatus: PeyCodiStatus;
  errorMessage?: string;
  dateCreated: number;
};

export const getBankAccount = (id: string) =>
  request<PeyBankAccount>("GET", `/bank-account/${encodeURIComponent(id)}`);
