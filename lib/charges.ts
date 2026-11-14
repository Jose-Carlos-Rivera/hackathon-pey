// Motor de cobros: apartado, renta y póliza son la misma cosa (una plantilla + un trato).
// Cada cobro genera un QR de CoDi nuevo (o un push al celular) con su propio numRef.
import { sql } from "./db";
import { createPush, createQr, PeyError } from "./pey";

export type ChargeMethod = "qr" | "push";
export type ChargeStatus = "pendiente" | "pagado" | "expirado" | "fallido";

export type Charge = {
  id: string;
  dealId: string | null;
  templateId: string | null;
  numRef: number;
  kind: string;
  concept: string;
  /** Lo que dice el trato (p. ej. 20,000). */
  nominalAmount: number;
  /** Lo que se cobra de verdad en pey (en demo: $0.01). */
  amount: number;
  status: ChargeStatus;
  method: ChargeMethod | null;
  qrString: string | null;
  trackingKey: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  clientName: string | null;
  propertyTitle: string | null;
  templateName: string | null;
};

/**
 * Monto que de verdad se cobra. En el hackatón cobramos $0.01 por cobro para no mover dinero real;
 * la ficha sigue mostrando el monto nominal. `DEMO_AMOUNT_MXN=off` cobra el monto nominal.
 */
export function chargedAmount(nominal: number): number {
  const demo = process.env.DEMO_AMOUNT_MXN ?? "0.01";
  if (demo === "off") return nominal;
  const n = Number(demo);
  return Number.isFinite(n) && n > 0 ? n : 0.01;
}

export const isDemoAmount = () => (process.env.DEMO_AMOUNT_MXN ?? "0.01") !== "off";

type Row = Record<string, unknown>;

function toCharge(r: Row): Charge {
  const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
  return {
    id: r.id as string,
    dealId: (r.deal_id as string | null) ?? null,
    templateId: (r.template_id as string | null) ?? null,
    numRef: Number(r.num_ref),
    kind: r.kind as string,
    concept: r.concept as string,
    nominalAmount: Number(r.nominal_amount),
    amount: Number(r.amount),
    status: r.status as ChargeStatus,
    method: (r.method as ChargeMethod | null) ?? null,
    qrString: (r.qr_string as string | null) ?? null,
    trackingKey: (r.tracking_key as string | null) ?? null,
    expiresAt: iso(r.expires_at),
    paidAt: iso(r.paid_at),
    clientName: (r.client_name as string | null) ?? null,
    propertyTitle: (r.property_title as string | null) ?? null,
    templateName: (r.template_name as string | null) ?? null,
  };
}

export async function getCharge(id: string): Promise<Charge | null> {
  const rows = (await sql()`
    select c.*, d.client_name, p.title as property_title, t.name as template_name
    from charges c
    left join deals d on d.id = c.deal_id
    left join properties p on p.id = d.property_id
    left join charge_templates t on t.id = c.template_id
    where c.id = ${id}
  `) as Row[];
  if (!rows[0]) return null;
  const charge = toCharge(rows[0]);
  // Un QR vencido sin pago se ve como "expirado" (el cobro se puede reemitir).
  if (charge.status === "pendiente" && charge.expiresAt && new Date(charge.expiresAt) < new Date()) {
    return { ...charge, status: "expirado" };
  }
  return charge;
}

export class ChargeInputError extends Error {}

export async function createCharge(input: {
  dealId: string;
  templateId: string;
  method: ChargeMethod;
  /** 10 dígitos; solo para `push`. */
  phone?: string;
}): Promise<Charge> {
  const db = sql();

  const tpl = ((await db`select * from charge_templates where id = ${input.templateId}`) as Row[])[0];
  if (!tpl) throw new ChargeInputError("Plantilla de cobro no encontrada");
  const deal = ((await db`
    select d.*, p.title as property_title from deals d
    left join properties p on p.id = d.property_id where d.id = ${input.dealId}
  `) as Row[])[0];
  if (!deal) throw new ChargeInputError("Trato no encontrado");

  const phone = input.method === "push" ? (input.phone ?? (deal.client_phone as string | null) ?? "") : null;
  if (input.method === "push" && !/^[0-9]{10}$/.test(phone ?? "")) {
    throw new ChargeInputError("El push de CoDi necesita un celular de 10 dígitos");
  }

  const nominal = Number(tpl.nominal_amount);
  const amount = chargedAmount(nominal);
  const validity = Number(tpl.validity_seconds);

  // 1) El cobro nace en la base (así tiene numRef propio y el webhook siempre lo encuentra).
  const inserted = (await db`
    insert into charges (template_id, deal_id, kind, concept, nominal_amount, amount, method, expires_at)
    values (${tpl.id}, ${deal.id}, ${tpl.kind}, ${tpl.concept}, ${nominal}, ${amount}, ${input.method},
            ${validity > 0 ? new Date(Date.now() + validity * 1000).toISOString() : null})
    returning id, num_ref
  `) as Row[];
  const chargeId = inserted[0].id as string;
  const numRef = String(inserted[0].num_ref);

  // pey devuelve `metadata.externalMetadata` tal cual: con esto el webhook liga el pago al cobro.
  const metadata = {
    chargeId,
    dealId: deal.id as string,
    kind: tpl.kind as string,
    ...(deal.property_id ? { propertyId: deal.property_id as string } : {}),
  };

  try {
    if (input.method === "qr") {
      const qr = await createQr({
        amount,
        concept: tpl.concept as string,
        expiration: validity,
        numRef,
        metadata,
      });
      await db`update charges set pey_qr_id = ${qr.id}, qr_string = ${qr.qrString} where id = ${chargeId}`;
    } else {
      const push = await createPush({
        amount,
        phoneNumber: phone as string,
        concept: tpl.concept as string,
        expiration: Math.max(validity, 360),
        numRef,
        metadata,
      });
      await db`update charges set pey_transaction_id = ${push.transactionId} where id = ${chargeId}`;
    }
  } catch (e) {
    // Si pey rechaza el cobro no dejamos un "pendiente" fantasma.
    await db`update charges set status = 'fallido' where id = ${chargeId}`;
    if (e instanceof PeyError) {
      throw new ChargeInputError(`pey rechazó el cobro (${e.type}): ${e.message}`);
    }
    throw e;
  }

  await db`
    insert into activity (deal_id, charge_id, kind, text)
    values (${deal.id}, ${chargeId}, 'cobro_creado',
            ${`Cobro creado: ${tpl.name} por $${nominal.toLocaleString("es-MX")} (${input.method === "qr" ? "QR" : "push"})`})
    on conflict do nothing
  `;

  const charge = await getCharge(chargeId);
  if (!charge) throw new Error("El cobro recién creado no se encontró");
  return charge;
}
