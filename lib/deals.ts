// Lecturas para el tablero (pipeline, propiedades y bitácora).
import { sql } from "./db";

type Row = Record<string, unknown>;

export type BoardDeal = {
  id: string;
  clientName: string;
  stageId: string;
  stageName: string;
  propertyTitle: string | null;
  propertyKind: "venta" | "renta" | null;
};
export type BoardProperty = { id: string; title: string; kind: string; price: number; status: string };
export type BoardActivity = { id: number; text: string; createdAt: string };

export async function listBoard() {
  const db = sql();
  const [deals, properties, activity] = (await Promise.all([
    db`select d.id, d.client_name, d.stage_id, s.name as stage_name, p.title as property_title, p.kind as property_kind
       from deals d join pipeline_stages s on s.id = d.stage_id
       left join properties p on p.id = d.property_id order by d.created_at, d.id`,
    db`select id, title, kind, price, status from properties order by id`,
    db`select id, text, created_at from activity order by id desc limit 12`,
  ])) as [Row[], Row[], Row[]];

  return {
    deals: deals.map<BoardDeal>((r) => ({
      id: r.id as string,
      clientName: r.client_name as string,
      stageId: r.stage_id as string,
      stageName: r.stage_name as string,
      propertyTitle: (r.property_title as string | null) ?? null,
      propertyKind: (r.property_kind as BoardDeal["propertyKind"]) ?? null,
    })),
    properties: properties.map<BoardProperty>((r) => ({
      id: r.id as string,
      title: r.title as string,
      kind: r.kind as string,
      price: Number(r.price),
      status: r.status as string,
    })),
    activity: activity.map<BoardActivity>((r) => ({
      id: Number(r.id),
      text: r.text as string,
      createdAt: new Date(r.created_at as string | Date).toISOString(),
    })),
  };
}
