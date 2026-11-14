// Conexión a Postgres (Neon). `DATABASE_URL` la inyecta la integración de Neon en Vercel.
// Se usa el driver HTTP: cada consulta es una petición, ideal para funciones serverless
// (el webhook de pey y las páginas caen en instancias distintas, por eso no hay estado en memoria).
import { neon } from "@neondatabase/serverless";

let client: ReturnType<typeof neon> | undefined;

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL: conecta Neon desde Vercel (Storage).");
  return (client ??= neon(url));
}
