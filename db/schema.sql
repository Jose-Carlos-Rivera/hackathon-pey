-- Esquema de "Cobro en la cita" (Postgres en Neon). Es idempotente: se puede correr varias veces.
-- Los datos de ejemplo (propiedades, clientes) son SIMULADOS para la demo del hackatón.

-- Etapas del pipeline y sus automatizaciones (se configuran por etapa).
create table if not exists pipeline_stages (
  id               text primary key,
  name             text    not null,
  position         int     not null,
  suspend_property boolean not null default false,  -- al entrar: la propiedad deja de publicarse
  send_agreement   boolean not null default false,  -- al entrar: se manda el acuerdo al cliente
  notify_agent     boolean not null default true    -- al entrar: se avisa al asesor
);

create table if not exists properties (
  id          text primary key,
  title       text not null,
  address     text not null,
  kind        text not null check (kind in ('venta', 'renta')),
  price       numeric(14, 2) not null,              -- pesos MXN
  status      text not null default 'publicada' check (status in ('publicada', 'apartada', 'suspendida')),
  updated_at  timestamptz not null default now()
);

create table if not exists deals (
  id            text primary key,
  property_id   text references properties (id),
  client_name   text not null,
  client_phone  text,                               -- 10 dígitos, para el push de CoDi
  client_email  text,
  stage_id      text not null references pipeline_stages (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Plantillas de cobro: monto, concepto y vigencia ya definidos. Cada cobro genera un QR nuevo.
create table if not exists charge_templates (
  id                text primary key,
  kind              text not null check (kind in ('apartado', 'renta', 'poliza')),
  name              text not null,
  concept           text not null,
  nominal_amount    numeric(12, 2) not null,        -- lo que dice el trato (p. ej. 20,000)
  validity_seconds  int not null default 1800 check (validity_seconds = 0 or validity_seconds >= 360),
  moves_to_stage    text references pipeline_stages (id)  -- etapa a la que pasa el trato al pagarse
);

-- numRef de pey: hasta 7 dígitos, cada cobro usa uno distinto.
create sequence if not exists charge_num_ref_seq minvalue 1 maxvalue 9999999 cycle;

create table if not exists charges (
  id                  text primary key default gen_random_uuid()::text,
  num_ref             int  not null default nextval('charge_num_ref_seq'),
  template_id         text references charge_templates (id),
  deal_id             text references deals (id),
  kind                text not null,
  concept             text not null,
  nominal_amount      numeric(12, 2) not null,      -- el monto "de verdad" del trato
  amount              numeric(12, 2) not null,      -- lo que se cobra en pey (en demo: $0.01)
  status              text not null default 'pendiente'
                      check (status in ('pendiente', 'pagado', 'expirado', 'fallido')),
  method              text check (method in ('qr', 'push', 'link')),
  pey_qr_id           text,
  qr_string           text,                         -- lo que se dibuja en el QR
  pey_transaction_id  text unique,
  tracking_key        text,                         -- clave de rastreo de Banxico, el comprobante
  expires_at          timestamptz,
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);
-- Para bases creadas antes de que existiera la columna.
alter table charges add column if not exists qr_string text;
create index if not exists charges_deal_idx   on charges (deal_id);
create index if not exists charges_numref_idx on charges (num_ref);

-- Un renglón por webhook recibido: `webhook_id` es la llave de idempotencia de pey.
create table if not exists pey_events (
  webhook_id    text primary key,
  type          text  not null,
  payload       jsonb not null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz
);

-- Bitácora del trato: lo que el CRM registra solo (cobro creado, pagado, propiedad apartada…).
create table if not exists activity (
  id          bigserial primary key,
  deal_id     text references deals (id),
  charge_id   text references charges (id),
  kind        text not null,
  text        text not null,
  created_at  timestamptz not null default now(),
  unique (charge_id, kind)                          -- evita duplicados si un evento se reintenta
);

-- ---------- Datos de ejemplo (simulados) ----------
insert into pipeline_stages (id, name, position, suspend_property, send_agreement, notify_agent) values
  ('interesado',      'Interesado',        1, false, false, false),
  ('visita',          'Visita agendada',   2, false, false, true),
  ('apartado_pagado', 'Apartado pagado',   3, true,  true,  true),
  ('contrato',        'Contrato firmado',  4, false, false, true),
  ('cerrado',         'Cerrado',           5, false, false, false)
on conflict (id) do nothing;

insert into properties (id, title, address, kind, price) values
  ('prop-lomas',  'Departamento en Lomas de Chapultepec', 'Av. Paseo de la Reforma 2650, Lomas, CDMX', 'venta', 6800000),
  ('prop-roma',   'Loft en la Roma Norte',                'Calle Durango 190, Roma Norte, CDMX',        'renta', 24500),
  ('prop-polanco','Casa en Polanco',                      'Calle Moliere 45, Polanco, CDMX',            'venta', 14200000)
on conflict (id) do nothing;

insert into charge_templates (id, kind, name, concept, nominal_amount, validity_seconds, moves_to_stage) values
  ('tpl-apartado', 'apartado', 'Apartado de propiedad',    'Apartado inmueble',  20000, 1800, 'apartado_pagado'),
  ('tpl-renta',    'renta',    'Renta mensual',            'Renta mensual',      24500,  360, null),
  ('tpl-poliza',   'poliza',   'Póliza jurídica',          'Poliza juridica',     6500, 1800, null)
on conflict (id) do nothing;

insert into deals (id, property_id, client_name, client_phone, client_email, stage_id) values
  ('deal-ana',   'prop-lomas',   'Ana Torres',   null, null, 'visita'),
  ('deal-juan',  'prop-roma',    'Juan Pérez',   null, null, 'interesado')
on conflict (id) do nothing;
