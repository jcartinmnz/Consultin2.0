CREATE TYPE "public"."estado_caso" AS ENUM('nuevo', 'en_atencion', 'en_espera', 'resuelto');--> statement-breakpoint
CREATE TYPE "public"."estado_conversacion" AS ENUM('bot', 'humano', 'cerrada');--> statement-breakpoint
CREATE TYPE "public"."nivel_caso" AS ENUM('N2', 'N3');--> statement-breakpoint
CREATE TYPE "public"."rol_mensaje" AS ENUM('cliente', 'bot', 'agente');--> statement-breakpoint
CREATE TABLE "casos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversacion_id" uuid NOT NULL,
	"optica_id" uuid,
	"nivel" "nivel_caso" NOT NULL,
	"motivo" text NOT NULL,
	"resumen" text NOT NULL,
	"estado" "estado_caso" DEFAULT 'nuevo' NOT NULL,
	"asignado_a" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resuelto_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contactos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"optica_id" uuid NOT NULL,
	"nombre" text,
	"telefono" text NOT NULL,
	"autorizado" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversaciones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canal" text NOT NULL,
	"external_id" text NOT NULL,
	"telefono" text NOT NULL,
	"optica_id" uuid,
	"estado" "estado_conversacion" DEFAULT 'bot' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversacion_id" uuid,
	"tipo" text NOT NULL,
	"tool" text,
	"ok" boolean,
	"latencia_ms" integer,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mensajes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversacion_id" uuid NOT NULL,
	"rol" "rol_mensaje" NOT NULL,
	"contenido" text NOT NULL,
	"autor" text,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mensajes_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "notas_caso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"caso_id" uuid NOT NULL,
	"autor" text NOT NULL,
	"texto" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opticas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"codigo_lensware" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opticas_codigo_lensware_unique" UNIQUE("codigo_lensware")
);
--> statement-breakpoint
CREATE TABLE "productos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sku" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"material" text NOT NULL,
	"indice" numeric(4, 2),
	"tratamiento" text,
	"esfera_min" numeric(5, 2),
	"esfera_max" numeric(5, 2),
	"cilindro_max" numeric(5, 2),
	"precio" numeric(12, 2) NOT NULL,
	"moneda" text DEFAULT 'CRC' NOT NULL,
	"alias" text,
	"activo" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "productos_sku_unique" UNIQUE("sku")
);
--> statement-breakpoint
ALTER TABLE "casos" ADD CONSTRAINT "casos_conversacion_id_conversaciones_id_fk" FOREIGN KEY ("conversacion_id") REFERENCES "public"."conversaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "casos" ADD CONSTRAINT "casos_optica_id_opticas_id_fk" FOREIGN KEY ("optica_id") REFERENCES "public"."opticas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contactos" ADD CONSTRAINT "contactos_optica_id_opticas_id_fk" FOREIGN KEY ("optica_id") REFERENCES "public"."opticas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversaciones" ADD CONSTRAINT "conversaciones_optica_id_opticas_id_fk" FOREIGN KEY ("optica_id") REFERENCES "public"."opticas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos" ADD CONSTRAINT "eventos_conversacion_id_conversaciones_id_fk" FOREIGN KEY ("conversacion_id") REFERENCES "public"."conversaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_conversacion_id_conversaciones_id_fk" FOREIGN KEY ("conversacion_id") REFERENCES "public"."conversaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notas_caso" ADD CONSTRAINT "notas_caso_caso_id_casos_id_fk" FOREIGN KEY ("caso_id") REFERENCES "public"."casos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "casos_estado_idx" ON "casos" USING btree ("estado");--> statement-breakpoint
CREATE UNIQUE INDEX "contactos_telefono_uq" ON "contactos" USING btree ("telefono");--> statement-breakpoint
CREATE UNIQUE INDEX "conv_canal_ext_uq" ON "conversaciones" USING btree ("canal","external_id");--> statement-breakpoint
CREATE INDEX "eventos_tipo_fecha_idx" ON "eventos" USING btree ("tipo","created_at");--> statement-breakpoint
CREATE INDEX "mensajes_conv_idx" ON "mensajes" USING btree ("conversacion_id","created_at");--> statement-breakpoint
CREATE INDEX "productos_tipo_idx" ON "productos" USING btree ("tipo");