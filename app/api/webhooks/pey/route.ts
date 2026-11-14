import { handlePeyEvent } from "@/lib/pey-events";
import { verifyPeyWebhook, WebhookConfigError } from "@/lib/pey-webhook";

// Endpoint que se registra en el portal de pey (Developer → engrane de la API key).
export async function POST(request: Request) {
  // El cuerpo debe leerse CRUDO: la firma se calcula sobre el texto exacto que mandó pey.
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers);

  let event;
  try {
    event = verifyPeyWebhook(rawBody, headers);
  } catch (e) {
    if (e instanceof WebhookConfigError) {
      return Response.json({ error: e.message }, { status: 500 });
    }
    return Response.json({ error: "firma inválida" }, { status: 401 });
  }

  await handlePeyEvent(event, headers["webhook-id"] ?? "");
  return Response.json({ received: true });
}

// Para comprobar a mano que la ruta está desplegada.
export function GET() {
  return Response.json({ ok: true, service: "pey-webhook" });
}
