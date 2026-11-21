ALTER TABLE "productos" ALTER COLUMN "material" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "codigo" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "familia" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "diseno" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "nivel" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "uso" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "notas" text;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "consultar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "productos" ADD COLUMN "unidad" text DEFAULT 'par' NOT NULL;