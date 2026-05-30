import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { packagePurchases, bookings } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';
import { getSessionsForDay, isOpenDay, MAX_QUOTA } from './sessions.js';
import { generateTicketId, ADDON_SHOES, ADDON_CHALK } from './bookings.js';

const router = Router();

// ── Package definitions ────────────────────────
const PACKAGES: Record<string, {
  name: string;
  price: number;
  type: string;
  uses: number;       // -1 = unlimited
  validityMonths: number;
}> = {
  'pass-wd-5':  { name: '5x Weekday Pass',       price: 329000,  type: 'weekday',   uses: 5,  validityMonths: 3 },
  'pass-wd-10': { name: '10x Weekday Pass',      price: 599000,  type: 'weekday',   uses: 10, validityMonths: 6 },
  'pass-we-5':  { name: '5x All-Day Pass',       price: 599000,  type: 'weekend',   uses: 5,  validityMonths: 3 },
  'pass-we-10': { name: '10x All-Day Pass',      price: 1090000, type: 'weekend',   uses: 10, validityMonths: 6 },
  'member-1m':  { name: '1 Month Unlimited Pass', price: 419000,  type: 'unlimited', uses: -1, validityMonths: 1 },
};

// ── POST /api/packages ─────────────────────────
// Purchase a package (with optional first session booking)
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      email,
      whatsapp,
      packageType,
      addonShoes = false,
      addonChalk = false,
      paymentMethod = 'qris',
      // Optional: book first session
      bookFirstSession = false,
      firstSessionDate,
      firstSessionIndex,
    } = req.body;

    // ── Validation ───────────────────────────
    if (!name || !email || !whatsapp || !packageType) {
      res.status(400).json({
        error: 'Field wajib: name, email, whatsapp, packageType',
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Format email tidak valid' });
      return;
    }

    if (whatsapp.length < 9) {
      res.status(400).json({ error: 'Nomor WhatsApp terlalu pendek' });
      return;
    }

    const pkg = PACKAGES[packageType];
    if (!pkg) {
      res.status(400).json({
        error: 'Tipe paket tidak valid',
        validTypes: Object.keys(PACKAGES),
      });
      return;
    }

    // ── Calculate pricing ────────────────────
    const addonTotal =
      (addonShoes ? ADDON_SHOES : 0) +
      (addonChalk ? ADDON_CHALK : 0);
    const totalAmount = pkg.price + addonTotal;

    // ── Calculate expiry ─────────────────────
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + pkg.validityMonths);
    const expiresAtStr = expiresAt.toISOString().split('T')[0];

    // ── Generate unique ticket ID ────────────
    let ticketId = generateTicketId();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db
        .select({ id: packagePurchases.id })
        .from(packagePurchases)
        .where(eq(packagePurchases.ticketId, ticketId))
        .limit(1);
      if (existing.length === 0) break;
      ticketId = generateTicketId();
      attempts++;
    }

    // ── Insert package purchase ──────────────
    let remainingUses = pkg.uses; // -1 for unlimited

    const [newPackage] = await db
      .insert(packagePurchases)
      .values({
        ticketId,
        name,
        email,
        whatsapp,
        packageType,
        packageName: pkg.name,
        price: pkg.price,
        addonShoes,
        addonChalk,
        addonTotal,
        totalAmount,
        remainingUses,
        expiresAt: expiresAtStr,
        paymentMethod,
        paymentStatus: 'paid',
      })
      .returning();

    // ── Optionally book first session ────────
    let firstBooking = null;

    if (bookFirstSession && firstSessionDate && firstSessionIndex !== undefined) {
      const dateObj = new Date(firstSessionDate + 'T00:00:00');
      const dayOfWeek = dateObj.getDay();

      if (isOpenDay(dayOfWeek)) {
        const sessions = getSessionsForDay(dayOfWeek);
        const session = sessions.find(s => s.index === firstSessionIndex);

        if (session) {
          // Check slot availability
          const [countResult] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(bookings)
            .where(
              and(
                eq(bookings.bookingDate, firstSessionDate),
                eq(bookings.sessionIndex, firstSessionIndex),
                eq(bookings.paymentStatus, 'paid')
              )
            );

          const bookedCount = countResult?.count || 0;
          if (bookedCount < MAX_QUOTA) {
            // Generate booking ticket
            let bookingTicketId = generateTicketId();
            let bAttempts = 0;
            while (bAttempts < 5) {
              const existing = await db
                .select({ id: bookings.id })
                .from(bookings)
                .where(eq(bookings.ticketId, bookingTicketId))
                .limit(1);
              if (existing.length === 0) break;
              bookingTicketId = generateTicketId();
              bAttempts++;
            }

            [firstBooking] = await db
              .insert(bookings)
              .values({
                ticketId: bookingTicketId,
                name,
                email,
                whatsapp,
                bookingDate: firstSessionDate,
                sessionIndex: firstSessionIndex,
                sessionName: session.name,
                sessionTime: session.time,
                dayType: session.type,
                bookingType: 'package',
                packagePurchaseId: newPackage.id,
                addonShoes,
                addonChalk,
                basePrice: 0, // included in package
                addonTotal,
                totalAmount: addonTotal, // only addons for session booking
                paymentMethod,
                paymentStatus: 'paid',
              })
              .returning();

            // Decrement remaining uses (if not unlimited)
            if (remainingUses > 0) {
              await db
                .update(packagePurchases)
                .set({ remainingUses: remainingUses - 1 })
                .where(eq(packagePurchases.id, newPackage.id));
              
              newPackage.remainingUses = remainingUses - 1;
            }
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      package: newPackage,
      firstBooking,
    });
  } catch (error) {
    console.error('Error purchasing package:', error);
    res.status(500).json({ error: 'Gagal membeli paket. Coba lagi.' });
  }
});

// ── GET /api/packages/:ticketId ────────────────
// Retrieve package details by ticket ID
router.get('/:ticketId', async (req: Request, res: Response) => {
  try {
    const ticketId = req.params.ticketId as string;

    const [pkg] = await db
      .select()
      .from(packagePurchases)
      .where(eq(packagePurchases.ticketId, ticketId.toUpperCase()))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: 'Paket tidak ditemukan' });
      return;
    }

    res.json({ package: pkg });
  } catch (error) {
    console.error('Error fetching package:', error);
    res.status(500).json({ error: 'Gagal memuat data paket' });
  }
});

// ── GET /api/packages/check/active ──────────────
// Check active packages by WhatsApp number
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

    // Query package purchases where whatsapp contains the clean string, payment is paid, and expiresAt is in the future
    const activePackages = await db
      .select()
      .from(packagePurchases)
      .where(
        and(
          sql`${packagePurchases.whatsapp} LIKE ${'%' + cleanWa}`,
          eq(packagePurchases.paymentStatus, 'paid'),
          sql`${packagePurchases.expiresAt} >= ${nowStr}`
        )
      );

    // Filter: only show packages that still have uses remaining (remainingUses > 0 or remainingUses === -1)
    const validPackages = activePackages.filter(
      pkg => pkg.remainingUses > 0 || pkg.remainingUses === -1
    );

    if (validPackages.length === 0) {
      res.status(404).json({ error: 'Tidak ada paket/membership aktif yang ditemukan untuk nomor WhatsApp ini.' });
      return;
    }

    res.json({ success: true, packages: validPackages });
  } catch (error) {
    console.error('Error checking packages:', error);
    res.status(500).json({ error: 'Gagal mencari paket keanggotaan' });
  }
});

// ── POST /api/packages/redeem ───────────────────
// Book a session using an active package
router.post('/redeem', async (req: Request, res: Response) => {
  try {
    const {
      packageId,
      date,
      sessionIndex,
      addonShoes = false,
      addonChalk = false,
    } = req.body;

    if (!packageId || !date || sessionIndex === undefined) {
      res.status(400).json({ error: 'Field wajib: packageId, date, sessionIndex' });
      return;
    }

    // 1. Fetch package details
    const [pkg] = await db
      .select()
      .from(packagePurchases)
      .where(eq(packagePurchases.id, packageId))
      .limit(1);

    if (!pkg) {
      res.status(404).json({ error: 'Paket tidak ditemukan' });
      return;
    }

    // Check expiry
    const nowStr = new Date().toISOString().split('T')[0];
    if (pkg.expiresAt < nowStr) {
      res.status(400).json({ error: 'Paket sudah kadaluwarsa' });
      return;
    }

    // Check remaining uses
    if (pkg.remainingUses === 0) {
      res.status(400).json({ error: 'Kuota sesi paket sudah habis' });
      return;
    }

    // 2. Validate session availability
    const dateObj = new Date(date + 'T00:00:00');
    const dayOfWeek = dateObj.getDay();

    if (!isOpenDay(dayOfWeek)) {
      res.status(400).json({ error: 'Hari terpilih tutup' });
      return;
    }

    const sessions = getSessionsForDay(dayOfWeek);
    const session = sessions.find(s => s.index === sessionIndex);
    if (!session) {
      res.status(400).json({ error: 'Sesi tidak valid untuk hari ini' });
      return;
    }

    // Check quota
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
      res.status(400).json({ error: 'Sesi terpilih sudah penuh (maksimal 6 orang)' });
      return;
    }

    // 3. Create booking seharga Rp 0
    const addonTotal = (addonShoes ? ADDON_SHOES : 0) + (addonChalk ? ADDON_CHALK : 0);
    let bookingTicketId = generateTicketId();

    // Verify unique ticket ID
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.ticketId, bookingTicketId))
        .limit(1);
      if (existing.length === 0) break;
      bookingTicketId = generateTicketId();
      attempts++;
    }

    const [newBooking] = await db
      .insert(bookings)
      .values({
        ticketId: bookingTicketId,
        name: pkg.name,
        email: pkg.email,
        whatsapp: pkg.whatsapp,
        bookingDate: date,
        sessionIndex,
        sessionName: session.name,
        sessionTime: session.time,
        dayType: session.type,
        bookingType: 'package',
        packagePurchaseId: pkg.id,
        addonShoes,
        addonChalk,
        basePrice: 0, // Rp 0
        addonTotal,
        totalAmount: addonTotal, // only pay for addons if selected
        paymentMethod: 'package',
        paymentStatus: 'paid',
      })
      .returning();

    // 4. Update remaining uses (unless unlimited -1)
    if (pkg.remainingUses > 0) {
      await db
        .update(packagePurchases)
        .set({ remainingUses: pkg.remainingUses - 1 })
        .where(eq(packagePurchases.id, pkg.id));
    }

    res.status(201).json({
      success: true,
      booking: newBooking,
      remainingUses: pkg.remainingUses === -1 ? -1 : pkg.remainingUses - 1,
    });
  } catch (error) {
    console.error('Error redeeming package session:', error);
    res.status(500).json({ error: 'Gagal mengklaim sesi paket. Coba lagi.' });
  }
});

export default router;
