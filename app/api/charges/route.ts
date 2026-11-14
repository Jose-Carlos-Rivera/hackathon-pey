import { ChargeInputError, createCharge } from "@/lib/charges";

// Crea un cobro (QR o push de CoDi) a partir de una plantilla y un trato.
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "El cuerpo debe ser JSON" }, { status: 400 });
  }

  const { dealId, templateId, method, phone } = body;
  if (typeof dealId !== "string" || typeof templateId !== "string" || (method !== "qr" && method !== "push")) {
    return Response.json({ error: "Faltan dealId, templateId o method ('qr' | 'push')" }, { status: 400 });
  }
  if (phone !== undefined && typeof phone !== "string") {
    return Response.json({ error: "phone debe ser texto de 10 dígitos" }, { status: 400 });
  }

  try {
    const charge = await createCharge({ dealId, templateId, method, phone });
    return Response.json(charge, { status: 201 });
  } catch (e) {
    if (e instanceof ChargeInputError) return Response.json({ error: e.message }, { status: 422 });
    console.error("createCharge falló", e);
    return Response.json({ error: "No se pudo crear el cobro" }, { status: 500 });
  }
}
