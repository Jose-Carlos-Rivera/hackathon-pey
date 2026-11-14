import { getCharge } from "@/lib/charges";

// Estado de un cobro. La página del cliente lo consulta cada par de segundos hasta que se paga.
export async function GET(_request: Request, ctx: RouteContext<"/api/charges/[id]">) {
  const { id } = await ctx.params;
  const charge = await getCharge(id);
  if (!charge) return Response.json({ error: "Cobro no encontrado" }, { status: 404 });
  return Response.json(charge, { headers: { "Cache-Control": "no-store" } });
}
