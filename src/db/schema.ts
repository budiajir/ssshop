import {
  pgTable,
  serial,
  varchar,
  integer,
  boolean,
  date,
  timestamp,
} from 'drizzle-orm/pg-core';

// ── Bookings Table ─────────────────────────────
// Stores all individual session bookings (single entry + package session bookings)
export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  ticketId: varchar('ticket_id', { length: 20 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 100 }).notNull(),
  whatsapp: varchar('whatsapp', { length: 20 }).notNull(),

  // Session details
  bookingDate: date('booking_date').notNull(),
  sessionIndex: integer('session_index').notNull(), // 0 = sesi tunggal/pagi, 1 = sesi siang
  sessionName: varchar('session_name', { length: 50 }).notNull(),
  sessionTime: varchar('session_time', { length: 30 }).notNull(),
  dayType: varchar('day_type', { length: 10 }).notNull(), // 'weekday' | 'weekend'

  // Booking type
  bookingType: varchar('booking_type', { length: 10 }).notNull().default('single'), // 'single' | 'package'
  packagePurchaseId: integer('package_purchase_id'), // FK to package_purchases (nullable)

  // Add-ons
  addonShoes: boolean('addon_shoes').notNull().default(false),
  addonChalk: boolean('addon_chalk').notNull().default(false),

  // Pricing
  basePrice: integer('base_price').notNull(), // ticket price or 0 if from package
  addonTotal: integer('addon_total').notNull().default(0),
  totalAmount: integer('total_amount').notNull(),

  // Payment
  paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
  paymentStatus: varchar('payment_status', { length: 20 }).notNull().default('paid'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Package Purchases Table ────────────────────
// Stores multi-pass and membership purchases
export const packagePurchases = pgTable('package_purchases', {
  id: serial('id').primaryKey(),
  ticketId: varchar('ticket_id', { length: 20 }).unique().notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  email: varchar('email', { length: 100 }).notNull(),
  whatsapp: varchar('whatsapp', { length: 20 }).notNull(),

  // Package details
  packageType: varchar('package_type', { length: 20 }).notNull(), // 'pass-wd-5', 'pass-wd-10', etc.
  packageName: varchar('package_name', { length: 50 }).notNull(),
  price: integer('price').notNull(),

  // Add-ons
  addonShoes: boolean('addon_shoes').notNull().default(false),
  addonChalk: boolean('addon_chalk').notNull().default(false),
  addonTotal: integer('addon_total').notNull().default(0),
  totalAmount: integer('total_amount').notNull(),

  // Usage tracking
  remainingUses: integer('remaining_uses').notNull(), // -1 = unlimited
  expiresAt: date('expires_at').notNull(),

  // Payment
  paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
  paymentStatus: varchar('payment_status', { length: 20 }).notNull().default('paid'),

  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Schedule Overrides Table ───────────────────
// Stores exceptions to the regular calendar schedule (holidays or special open days)
export const scheduleOverrides = pgTable('schedule_overrides', {
  id: serial('id').primaryKey(),
  overrideDate: date('override_date').unique().notNull(), // format YYYY-MM-DD
  isOpen: boolean('is_open').notNull(), // true = open, false = closed/holiday
  note: varchar('note', { length: 255 }), // e.g. "Keluar Kota", "Maintenance"
  sessionTemplate: varchar('session_template', { length: 20 }), // 'weekday' | 'weekend' (if isOpen is true)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ── Type Exports ───────────────────────────────
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type PackagePurchase = typeof packagePurchases.$inferSelect;
export type NewPackagePurchase = typeof packagePurchases.$inferInsert;
export type ScheduleOverride = typeof scheduleOverrides.$inferSelect;
export type NewScheduleOverride = typeof scheduleOverrides.$inferInsert;
