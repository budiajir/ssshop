import { Router, Request, Response } from 'express';
import { db } from '../db/index.js';
import { bookings, scheduleOverrides } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

const router = Router();

// ── Schedule Constants ─────────────────────────
const PRICE_WEEKDAY = 69000;
const PRICE_WEEKEND = 129000;
const MAX_QUOTA = 6;

interface SessionInfo {
  index: number;
  name: string;
  time: string;
  price: number;
  type: 'weekday' | 'weekend';
}

function getSessionsForTemplate(template: string): SessionInfo[] {
  if (template === 'weekend') {
    return [
      {
        index: 0,
        name: 'Sesi Pagi',
        time: '09:00 – 12:00',
        price: PRICE_WEEKEND,
        type: 'weekend',
      },
      {
        index: 1,
        name: 'Sesi Siang',
        time: '12:00 – 15:00',
        price: PRICE_WEEKEND,
        type: 'weekend',
      },
    ];
  } else {
    return [{
      index: 0,
      name: 'Sesi Malam',
      time: '18:00 – 21:00',
      price: PRICE_WEEKDAY,
      type: 'weekday',
    }];
  }
}

function getSessionsForDay(dayOfWeek: number): SessionInfo[] {
  switch (dayOfWeek) {
    case 1: // Monday
    case 3: // Wednesday
    case 5: // Friday
      return [{
        index: 0,
        name: 'Sesi Malam',
        time: '18:00 – 21:00',
        price: PRICE_WEEKDAY,
        type: 'weekday',
      }];
    case 6: // Saturday
      return [
        {
          index: 0,
          name: 'Sesi Pagi',
          time: '09:00 – 12:00',
          price: PRICE_WEEKEND,
          type: 'weekend',
        },
        {
          index: 1,
          name: 'Sesi Siang',
          time: '12:00 – 15:00',
          price: PRICE_WEEKEND,
          type: 'weekend',
        },
      ];
    default:
      return [];
  }
}

function isOpenDay(dayOfWeek: number): boolean {
  return [1, 3, 5, 6].includes(dayOfWeek);
}

// ── GET /api/sessions?date=YYYY-MM-DD ──────────
// Returns available sessions with real-time slot counts for a specific date
router.get('/', async (req: Request, res: Response) => {
  try {
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      res.status(400).json({ error: 'Parameter "date" (YYYY-MM-DD) wajib diisi' });
      return;
    }

    // Validate date format
    const dateObj = new Date(date + 'T00:00:00');
    if (isNaN(dateObj.getTime())) {
      res.status(400).json({ error: 'Format tanggal tidak valid. Gunakan YYYY-MM-DD' });
      return;
    }

    const dayOfWeek = dateObj.getDay();

    // Check for schedule overrides in database
    const [override] = await db
      .select()
      .from(scheduleOverrides)
      .where(eq(scheduleOverrides.overrideDate, date))
      .limit(1);

    let open = false;
    let sessions: SessionInfo[] = [];
    let note: string | null = null;

    if (override) {
      open = override.isOpen;
      note = override.note || null;
      if (open) {
        sessions = getSessionsForTemplate(override.sessionTemplate || 'weekday');
      }
    } else {
      open = isOpenDay(dayOfWeek);
      sessions = getSessionsForDay(dayOfWeek);
    }

    if (!open || sessions.length === 0) {
      res.json({
        date,
        dayOfWeek,
        isOpen: false,
        note,
        dayType: null,
        sessions: [],
      });
      return;
    }

    // Count booked slots per session from database
    const bookedCounts = await db
      .select({
        sessionIndex: bookings.sessionIndex,
        count: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.bookingDate, date),
          eq(bookings.paymentStatus, 'paid')
        )
      )
      .groupBy(bookings.sessionIndex);

    // Build booked map
    const bookedMap: Record<number, number> = {};
    for (const row of bookedCounts) {
      bookedMap[row.sessionIndex] = row.count;
    }

    const sessionsWithAvailability = sessions.map((session) => {
      const bookedCount = bookedMap[session.index] || 0;
      return {
        ...session,
        maxSlots: MAX_QUOTA,
        bookedCount,
        availableSlots: Math.max(0, MAX_QUOTA - bookedCount),
      };
    });

    res.json({
      date,
      dayOfWeek,
      isOpen: true,
      note,
      dayType: sessions[0].type,
      sessions: sessionsWithAvailability,
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ error: 'Gagal memuat data sesi' });
  }
});

// ── GET /api/slots?month=6&year=2026 ───────────
// Returns availability summary for entire month (for calendar rendering)
router.get('/slots', async (req: Request, res: Response) => {
  try {
    const month = parseInt(req.query.month as string);
    const year = parseInt(req.query.year as string);

    if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
      res.status(400).json({ error: 'Parameter "month" (1-12) dan "year" wajib diisi' });
      return;
    }

    // Get first and last day of month
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const totalDays = lastDay.getDate();

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(totalDays).padStart(2, '0')}`;

    // Fetch all bookings for this month at once
    const monthBookings = await db
      .select({
        bookingDate: bookings.bookingDate,
        sessionIndex: bookings.sessionIndex,
        count: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(
        and(
          sql`${bookings.bookingDate} >= ${startDate}`,
          sql`${bookings.bookingDate} <= ${endDate}`,
          eq(bookings.paymentStatus, 'paid')
        )
      )
      .groupBy(bookings.bookingDate, bookings.sessionIndex);

    // Fetch all schedule overrides for this month at once
    const monthOverrides = await db
      .select()
      .from(scheduleOverrides)
      .where(
        and(
          sql`${scheduleOverrides.overrideDate} >= ${startDate}`,
          sql`${scheduleOverrides.overrideDate} <= ${endDate}`
        )
      );

    // Build lookup map: date -> sessionIndex -> count
    const bookedMap: Record<string, Record<number, number>> = {};
    for (const row of monthBookings) {
      const dateStr = row.bookingDate;
      if (!bookedMap[dateStr]) bookedMap[dateStr] = {};
      bookedMap[dateStr][row.sessionIndex] = row.count;
    }

    // Build override map: dateStr -> override
    const overrideMap: Record<string, typeof scheduleOverrides.$inferSelect> = {};
    for (const ov of monthOverrides) {
      overrideMap[ov.overrideDate] = ov;
    }

    // Generate day-by-day summary
    const days = [];
    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      const override = overrideMap[dateStr];
      let open = false;
      let sessions: SessionInfo[] = [];
      let note: string | null = null;

      if (override) {
        open = override.isOpen;
        note = override.note || null;
        if (open) {
          sessions = getSessionsForTemplate(override.sessionTemplate || 'weekday');
        }
      } else {
        open = isOpenDay(dow);
        sessions = getSessionsForDay(dow);
      }

      if (!open || sessions.length === 0) {
        days.push({ date: dateStr, isOpen: false, note, totalSlots: 0, bookedSlots: 0, allFull: false });
        continue;
      }

      const dateBooked = bookedMap[dateStr] || {};
      let totalSlots = sessions.length * MAX_QUOTA;
      let bookedSlots = 0;
      let allFull = true;

      for (const session of sessions) {
        const count = dateBooked[session.index] || 0;
        bookedSlots += count;
        if (count < MAX_QUOTA) allFull = false;
      }

      days.push({ date: dateStr, isOpen: true, note, totalSlots, bookedSlots, allFull });
    }

    res.json({ month, year, days });
  } catch (error) {
    console.error('Error fetching slots:', error);
    res.status(500).json({ error: 'Gagal memuat data ketersediaan' });
  }
});

export default router;
export { getSessionsForDay, isOpenDay, MAX_QUOTA, PRICE_WEEKDAY, PRICE_WEEKEND };
