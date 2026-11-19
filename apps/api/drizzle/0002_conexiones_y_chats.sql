CREATE TABLE "conexiones" (
	"cuenta_id" text PRIMARY KEY NOT NULL,
	"plataforma" text NOT NULL,
	"nombre" text NOT NULL,
	"modo" text DEFAULT 'opticas' NOT NULL,
	"prompt" text,
	"activa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "configuracion" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversaciones" ALTER COLUMN "telefono" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "conversaciones" ADD COLUMN "plataforma" text;--> statement-breakpoint
ALTER TABLE "conversaciones" ADD COLUMN "cuenta_id" text;--> statement-breakpoint
ALTER TABLE "conversaciones" ADD COLUMN "participante_nombre" text;