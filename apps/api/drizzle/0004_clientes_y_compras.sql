CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"optica_id" uuid,
	"nombre" text NOT NULL,
	"empresa" text,
	"email" text,
	"telefono" text,
	"direccion" text,
	"origen" text,
	"notas" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_optica_id_unique" UNIQUE("optica_id")
);
--> statement-breakpoint
CREATE TABLE "compras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"sku" text,
	"descripcion" text NOT NULL,
	"cantidad" integer DEFAULT 1 NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"moneda" text DEFAULT 'CRC' NOT NULL,
	"notas" text,
	"autor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversaciones" ADD COLUMN "cliente_id" uuid;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_optica_id_opticas_id_fk" FOREIGN KEY ("optica_id") REFERENCES "public"."opticas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compras_cliente_idx" ON "compras" USING btree ("cliente_id","fecha");--> statement-breakpoint
ALTER TABLE "conversaciones" ADD CONSTRAINT "conversaciones_cliente_id_clientes_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."clientes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill: un cliente por óptica existente
INSERT INTO "clientes" ("tipo", "optica_id", "nombre", "origen") SELECT 'optica', "id", "nombre", 'whatsapp' FROM "opticas";--> statement-breakpoint
UPDATE "conversaciones" c SET "cliente_id" = cl."id" FROM "clientes" cl WHERE cl."optica_id" = c."optica_id";--> statement-breakpoint
-- Backfill: un cliente "persona" por cada conversación sin óptica (Instagram, Messenger, WhatsApp no registrado)
DO $$
DECLARE r record; nuevo uuid;
BEGIN
  FOR r IN SELECT "id", "participante_nombre", "telefono", "plataforma" FROM "conversaciones"
           WHERE "optica_id" IS NULL AND "cliente_id" IS NULL AND "canal" <> 'dev' LOOP
    INSERT INTO "clientes" ("tipo", "nombre", "telefono", "origen")
    VALUES ('persona', COALESCE(r."participante_nombre", '+' || r."telefono", 'Sin nombre'), r."telefono", r."plataforma")
    RETURNING "id" INTO nuevo;
    UPDATE "conversaciones" SET "cliente_id" = nuevo WHERE "id" = r."id";
  END LOOP;
END $$;
