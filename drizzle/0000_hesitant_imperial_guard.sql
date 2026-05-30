CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(100) NOT NULL,
	"whatsapp" varchar(20) NOT NULL,
	"booking_date" date NOT NULL,
	"session_index" integer NOT NULL,
	"session_name" varchar(50) NOT NULL,
	"session_time" varchar(30) NOT NULL,
	"day_type" varchar(10) NOT NULL,
	"booking_type" varchar(10) DEFAULT 'single' NOT NULL,
	"package_purchase_id" integer,
	"addon_shoes" boolean DEFAULT false NOT NULL,
	"addon_chalk" boolean DEFAULT false NOT NULL,
	"base_price" integer NOT NULL,
	"addon_total" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"payment_status" varchar(20) DEFAULT 'paid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_ticket_id_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE TABLE "package_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"email" varchar(100) NOT NULL,
	"whatsapp" varchar(20) NOT NULL,
	"package_type" varchar(20) NOT NULL,
	"package_name" varchar(50) NOT NULL,
	"price" integer NOT NULL,
	"addon_shoes" boolean DEFAULT false NOT NULL,
	"addon_chalk" boolean DEFAULT false NOT NULL,
	"addon_total" integer DEFAULT 0 NOT NULL,
	"total_amount" integer NOT NULL,
	"remaining_uses" integer NOT NULL,
	"expires_at" date NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"payment_status" varchar(20) DEFAULT 'paid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_purchases_ticket_id_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"override_date" date NOT NULL,
	"is_open" boolean NOT NULL,
	"note" varchar(255),
	"session_template" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_overrides_override_date_unique" UNIQUE("override_date")
);
