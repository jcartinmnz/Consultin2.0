ALTER TABLE "opticas" ALTER COLUMN "codigo_lensware" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "opticas" ADD COLUMN "clave" text;--> statement-breakpoint
ALTER TABLE "opticas" ADD COLUMN "codigo_sap" text;--> statement-breakpoint
ALTER TABLE "opticas" ADD COLUMN "codigo_mac" text;--> statement-breakpoint
ALTER TABLE "opticas" ADD COLUMN "razon_social" text;--> statement-breakpoint
ALTER TABLE "opticas" ADD COLUMN "ruta" text;--> statement-breakpoint
ALTER TABLE "opticas" ADD CONSTRAINT "opticas_clave_unique" UNIQUE("clave");