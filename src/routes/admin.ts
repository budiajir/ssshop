import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { scheduleOverrides, bookings, packagePurchases } from '../db/schema.js';
import { eq, sql, and, gte } from 'drizzle-orm';

const router = Router();

// Simple admin PIN configuration
const ADMIN_PIN = process.env.ADMIN_PIN || '9999';

// ── POST /api/admin/login ───────────────────────
// Verify admin login PIN
router.post('/login', (req: Request, res: Response) => {
  const { pin } = req.body;
  if (!pin) {
    res.status(400).json({ error: 'PIN wajib diisi' });
    return;
  }

  if (pin === ADMIN_PIN) {
    res.json({ success: true, token: 'ssshop-admin-token-xyz' });
  } else {
    res.status(401).json({ error: 'PIN salah!' });
  }
});

// ── GET /api/admin/overrides ────────────────────
// Get all schedule overrides
router.get('/overrides', async (req: Request, res: Response) => {
  try {
    const list = await db
      .select()
      .from(scheduleOverrides)
      .orderBy(scheduleOverrides.overrideDate);

    res.json({ success: true, overrides: list });
  } catch (error) {
    console.error('Error fetching overrides:', error);
    res.status(500).json({ error: 'Gagal memuat daftar pengecualian jadwal' });
  }
});

// ── POST /api/admin/overrides ───────────────────
// Upsert a schedule override (holiday or special open)
router.post('/overrides', async (req: Request, res: Response) => {
  try {
    const { date, isOpen, note, sessionTemplate } = req.body;

    if (!date) {
      res.status(400).json({ error: 'Tanggal (date) wajib diisi' });
      return;
    }

    if (isOpen === undefined) {
      res.status(400).json({ error: 'Status isOpen (true/false) wajib diisi' });
      return;
    }

    // Check if override already exists for this date
    const existing = await db
      .select()
      .from(scheduleOverrides)
      .where(eq(scheduleOverrides.overrideDate, date))
      .limit(1);

    let result;
    if (existing.length > 0) {
      // Update
      [result] = await db
        .update(scheduleOverrides)
        .set({
          isOpen: !!isOpen,
          note: note || '',
          sessionTemplate: isOpen ? (sessionTemplate || 'weekday') : null,
        })
        .where(eq(scheduleOverrides.overrideDate, date))
        .returning();
    } else {
      // Insert
      [result] = await db
        .insert(scheduleOverrides)
        .values({
          overrideDate: date,
          isOpen: !!isOpen,
          note: note || '',
          sessionTemplate: isOpen ? (sessionTemplate || 'weekday') : null,
        })
        .returning();
    }

    res.status(200).json({ success: true, override: result });
  } catch (error) {
    console.error('Error upserting override:', error);
    res.status(500).json({ error: 'Gagal menyimpan pengecualian jadwal' });
  }
});

// ── DELETE /api/admin/overrides/:date ───────────
// Delete a schedule override (restore to routine schedule)
router.delete('/overrides/:date', async (req: Request, res: Response) => {
  try {
    const date = req.params.date as string;

    if (!date) {
      res.status(400).json({ error: 'Tanggal wajib diisi' });
      return;
    }

    await db
      .delete(scheduleOverrides)
      .where(eq(scheduleOverrides.overrideDate, date));

    res.json({ success: true, message: `Pengecualian untuk tanggal ${date} berhasil dihapus` });
  } catch (error) {
    console.error('Error deleting override:', error);
    res.status(500).json({ error: 'Gagal menghapus pengecualian jadwal' });
  }
});

// ── GET /api/admin/bookings ─────────────────────
// Retrieve all bookings for a specific date (for admin guest check-in)
router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      res.status(400).json({ error: 'Parameter date (YYYY-MM-DD) wajib diisi' });
      return;
    }

    const climberList = await db
      .select()
      .from(bookings)
      .where(eq(bookings.bookingDate, date))
      .orderBy(bookings.sessionIndex, bookings.name);

    res.json({ success: true, bookings: climberList });
  } catch (error) {
    console.error('Error fetching admin bookings list:', error);
    res.status(500).json({ error: 'Gagal mengambil daftar bookings' });
  }
});

// ── GET /api/admin/stats ────────────────────────
// Get monthly revenue, active members count, and total visits
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
    const todayStr = now.toISOString().split('T')[0];

    // 1. Monthly revenue from single bookings (paid, this month)
    const [bookingRevenue] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.paymentStatus, 'paid'),
          sql`${bookings.createdAt} >= ${startDate}::date`,
          sql`${bookings.createdAt} < (${endDate}::date + interval '1 day')`
        )
      );

    // 2. Monthly revenue from package purchases (paid, this month)
    const [packageRevenue] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${packagePurchases.totalAmount}), 0)::int`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(packagePurchases)
      .where(
        and(
          eq(packagePurchases.paymentStatus, 'paid'),
          sql`${packagePurchases.createdAt} >= ${startDate}::date`,
          sql`${packagePurchases.createdAt} < (${endDate}::date + interval '1 day')`
        )
      );

    // 3. Active members (not expired and remaining uses != 0)
    const [activeMembers] = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
      })
      .from(packagePurchases)
      .where(
        and(
          eq(packagePurchases.paymentStatus, 'paid'),
          sql`${packagePurchases.expiresAt} >= ${todayStr}`,
          sql`(${packagePurchases.remainingUses} = -1 OR ${packagePurchases.remainingUses} > 0)`
        )
      );

    // 4. Total visits this month (bookings count)
    const totalRevenue = (bookingRevenue?.total || 0) + (packageRevenue?.total || 0);
    const totalBookings = bookingRevenue?.count || 0;
    const totalPackageSales = packageRevenue?.count || 0;
    const activeMemberCount = activeMembers?.count || 0;

    res.json({
      success: true,
      stats: {
        monthlyRevenue: totalRevenue,
        bookingRevenue: bookingRevenue?.total || 0,
        packageRevenue: packageRevenue?.total || 0,
        totalVisits: totalBookings,
        totalPackageSales,
        activeMembers: activeMemberCount,
        period: `${String(month).padStart(2, '0')}/${year}`,
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ error: 'Gagal memuat statistik' });
  }
});

export default router;
