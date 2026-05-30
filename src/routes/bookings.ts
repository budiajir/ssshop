import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { bookings } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { getSessionsForDay, isOpenDay, MAX_QUOTA } from './sessions.js';

const router = Router();

const ADDON_SHOES = 25000;
const ADDON_CHALK = 15000;

// ── Helpers ────────────────────────────────────
function generateTicketId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'SS-';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ── POST /api/bookings ─────────────────────────
// Create a new single-entry booking
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      whatsapp,
      date,
      sessionIndex,
      addonShoes = false,
      addonChalk = false,
      paymentMethod = 'qris',
    } = req.body;

    // ── Validation ───────────────────────────
    if (!name || !email || !whatsapp || !date || sessionIndex === undefined) {
      res.status(400).json({
        error: 'Field wajib: name, email, whatsapp, date, sessionIndex',
      });
      return;
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Format email tidak valid' });
      return;
    }

    // Validate WA number
    if (whatsapp.length < 9) {
      res.status(400).json({ error: 'Nomor WhatsApp terlalu pendek' });
      return;
    }

    // Validate date & day
    const dateObj = new Date(date + 'T00:00:00');
    if (isNaN(dateObj.getTime())) {
      res.status(400).json({ error: 'Format tanggal tidak valid' });
      return;
    }

    const dayOfWeek = dateObj.getDay();
    if (!isOpenDay(dayOfWeek)) {
      res.status(400).json({ error: 'Hari ini tutup. Pilih hari lain.' });
      return;
    }

    // Validate session exists
    const sessions = getSessionsForDay(dayOfWeek);
    const session = sessions.find(s => s.index === sessionIndex);
    if (!session) {
      res.status(400).json({ error: 'Sesi tidak ditemukan untuk hari ini' });
      return;
    }

    // ── Check slot availability ──────────────
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(
        and(
          eq(bookings.bookingDate, date),
          eq(bookings.sessionIndex, sessionIndex),
          eq(bookings.paymentStatus, 'paid')
        )
      );

    const bookedCount = countResult?.count || 0;
    if (bookedCount >= MAX_QUOTA) {
      res.status(409).json({
        error: 'Maaf, sesi ini sudah penuh. Silakan pilih sesi atau tanggal lain.',
        bookedCount,
        maxQuota: MAX_QUOTA,
      });
      return;
    }

    // ── Calculate pricing ────────────────────
    const basePrice = session.price;
    const addonTotal =
      (addonShoes ? ADDON_SHOES : 0) +
      (addonChalk ? ADDON_CHALK : 0);
    const totalAmount = basePrice + addonTotal;

    // ── Generate unique ticket ID ────────────
    let ticketId = generateTicketId();
    // Ensure uniqueness (rare collision)
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.ticketId, ticketId))
        .limit(1);
      if (existing.length === 0) break;
      ticketId = generateTicketId();
      attempts++;
    }

    // ── Insert booking ───────────────────────
    const [newBooking] = await db
      .insert(bookings)
      .values({
        ticketId,
        name,
        email,
        whatsapp,
        bookingDate: date,
        sessionIndex,
        sessionName: session.name,
        sessionTime: session.time,
        dayType: session.type,
        bookingType: 'single',
        addonShoes,
        addonChalk,
        basePrice,
        addonTotal,
        totalAmount,
        paymentMethod,
        paymentStatus: 'paid', // auto-confirm for now
      })
      .returning();

    res.status(201).json({
      success: true,
      booking: newBooking,
    });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Gagal membuat booking. Coba lagi.' });
  }
});

// ── GET /api/bookings/check/active ──────────────
// Check active bookings by WhatsApp number
router.get('/check/active', async (req: Request, res: Response) => {
  try {
    const whatsapp = req.query.whatsapp as string;
    if (!whatsapp) {
      res.status(400).json({ error: 'Parameter "whatsapp" wajib diisi' });
      return;
    }

    // Normalize: strip leading '0' or '+62' or '62' if they entered it
    let cleanWa = whatsapp.trim().replace(/^(\+62|62|0)/, '');

    const nowStr = new Date().toISOString().split('T')[0];

    // Query bookings where whatsapp contains the clean string, payment is paid, and bookingDate is today or in the future
    const activeBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          sql`${bookings.whatsapp} LIKE ${'%' + cleanWa}`,
          eq(bookings.paymentStatus, 'paid'),
          sql`${bookings.bookingDate} >= ${nowStr}`
        )
      );

    if (activeBookings.length === 0) {
      res.status(404).json({ error: 'Tidak ada booking aktif yang ditemukan untuk nomor WhatsApp ini.' });
      return;
    }

    res.json({ success: true, bookings: activeBookings });
  } catch (error) {
    console.error('Error checking bookings:', error);
    res.status(500).json({ error: 'Gagal mencari data booking' });
  }
});

// ── GET /api/bookings/:ticketId ────────────────
// Retrieve booking details by ticket ID
router.get('/:ticketId', async (req: Request, res: Response) => {
  try {
    const ticketId = req.params.ticketId as string;

    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.ticketId, ticketId.toUpperCase()))
      .limit(1);

    if (!booking) {
      res.status(404).json({ error: 'Booking tidak ditemukan' });
      return;
    }

    res.json({ booking });
  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ error: 'Gagal memuat data booking' });
  }
});

export default router;
export { generateTicketId, ADDON_SHOES, ADDON_CHALK };
