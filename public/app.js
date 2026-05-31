/* ============================================
   SS Climbing — Booking App Logic
   (Connected to Backend API)
   ============================================ */

(function () {
  'use strict';

  // ── State ──────────────────────────────────
  const state = {
    currentStep: 1,
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    selectedDate: null,
    selectedSession: null,
    userName: '',
    userEmail: '',
    userWhatsApp: '',
    addons: { shoes: false, chalk: false },
    paymentMethod: 'qris',

    // Package flow states
    bookingMode: 'single',
    selectedPackage: null,
    packBookingSesi: false,

    // Calendar slot data (from API)
    calendarSlots: {}, // { 'YYYY-MM-DD': { isOpen, totalSlots, bookedSlots, allFull } }

    // Session data (from API)
    sessionsData: null, // API response for selected date
  };

  // ── Constants (kept for UI rendering) ──────
  const MONTHS_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  const PACKAGES = {
    'pass-wd-5': { id: 'pass-wd-5', name: '5x Weekday Pass', price: 329000, type: 'weekday', desc: '5x masuk di weekdays' },
    'pass-wd-10': { id: 'pass-wd-10', name: '10x Weekday Pass', price: 599000, type: 'weekday', desc: '10x masuk di weekdays' },
    'pass-we-5': { id: 'pass-we-5', name: '5x All-Day Pass', price: 599000, type: 'weekend', desc: '5x masuk bebas hari' },
    'pass-we-10': { id: 'pass-we-10', name: '10x All-Day Pass', price: 1090000, type: 'weekend', desc: '10x masuk bebas hari' },
    'member-1m': { id: 'member-1m', name: '1 Month Unlimited Pass', price: 419000, type: 'unlimited', desc: 'Member 1 Bulan sepuasnya' },
  };

  const MAX_QUOTA = 6;
  const ADDON_SHOES = 25000;
  const ADDON_CHALK = 15000;

  // ── Helpers ────────────────────────────────
  function formatRupiah(num) {
    return 'Rp ' + num.toLocaleString('id-ID');
  }

  function formatDateID(date) {
    return `${DAYS_ID[date.getDay()]}, ${date.getDate()} ${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`;
  }

  function dateToStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function isOpenDay(dayOfWeek) {
    return [1, 3, 5, 6].includes(dayOfWeek);
  }

  // ── DOM Refs ───────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── API Helper ─────────────────────────────
  async function api(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      console.error(`API Error [${url}]:`, err);
      throw err;
    }
  }

  // ── Fetch Calendar Slots (Monthly) ─────────
  async function fetchCalendarSlots() {
    try {
      const month = state.calendarMonth + 1; // API uses 1-indexed
      const year = state.calendarYear;
      const data = await api(`/api/sessions/slots?month=${month}&year=${year}`);

      state.calendarSlots = {};
      for (const day of data.days) {
        state.calendarSlots[day.date] = day;
      }
    } catch (err) {
      console.error('Failed to fetch calendar slots:', err);
      // Fallback: empty slots (show all as available based on day rules)
      state.calendarSlots = {};
    }
  }

  // ── Fetch Sessions for Date ────────────────
  async function fetchSessions(dateStr) {
    try {
      const data = await api(`/api/sessions?date=${dateStr}`);
      state.sessionsData = data;
      return data;
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      state.sessionsData = null;
      return null;
    }
  }

  // ── Calendar Rendering ─────────────────────
  async function renderCalendar() {
    const title = $('#cal-title');
    const grid = $('#cal-grid');
    title.textContent = `${MONTHS_ID[state.calendarMonth]} ${state.calendarYear}`;

    // Show loading state
    grid.innerHTML = '<div class="cal-loading">Memuat kalender...</div>';

    // Fetch real availability data from backend
    await fetchCalendarSlots();

    const firstDay = new Date(state.calendarYear, state.calendarMonth, 1);
    const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0);
    const startDow = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Day headers
    const dayHeaders = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    let html = dayHeaders.map(d => `<div class="cal-day-header">${d}</div>`).join('');

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
      html += `<div class="cal-day empty"></div>`;
    }

    for (let d = 1; d <= totalDays; d++) {
      const date = new Date(state.calendarYear, state.calendarMonth, d);
      date.setHours(0, 0, 0, 0);
      const dow = date.getDay();
      const dateStr = dateToStr(date);
      const isPast = date < today;
      const isToday = date.getTime() === today.getTime();

      // Package restrictions
      let isRestricted = false;
      if (state.bookingMode === 'package' && state.selectedPackage && state.selectedPackage.type === 'weekday') {
        if (dow === 6 || dow === 0) isRestricted = true;
      }

      // Read override open status from API slots data
      const slotData = state.calendarSlots[dateStr];
      const apiOpen = slotData ? slotData.isOpen : isOpenDay(dow);
      const open = apiOpen && !isRestricted;

      let classes = ['cal-day'];

      if (isPast) {
        classes.push('past');
      } else if (!open) {
        classes.push('closed');
      } else {
        // Use real data from API
        if (slotData && slotData.allFull) {
          classes.push('full');
        } else {
          classes.push('available');
        }
      }

      if (isToday) classes.push('today');

      if (state.selectedDate && dateStr === dateToStr(state.selectedDate)) {
        classes.push('selected');
      }

      const clickable = !isPast && open && !classes.includes('full');
      
      let titleAttr = '';
      let cellHtml = `${d}`;
      if (slotData && slotData.note) {
        titleAttr = `title="${slotData.note}"`;
      }
      
      if (slotData && !slotData.isOpen && slotData.note) {
        cellHtml = `<span style="font-size:0.95rem;font-weight:bold;display:block;line-height:1.1;">${d}</span><span style="font-size:0.55rem;display:block;color:var(--text-muted);font-weight:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;" title="${slotData.note}">Libur</span>`;
      } else if (slotData && slotData.isOpen && !isOpenDay(dow)) {
        cellHtml = `<span style="font-size:0.95rem;font-weight:bold;display:block;line-height:1.1;">${d}</span><span style="font-size:0.55rem;display:block;color:var(--accent-primary);font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;" title="${slotData.note || 'Buka khusus!'}">Buka!</span>`;
      }

      html += `<div class="${classes.join(' ')}" ${titleAttr} ${clickable ? `data-date="${dateStr}" data-day="${d}"` : ''} ${clickable ? 'role="button" tabindex="0"' : ''}>${cellHtml}</div>`;
    }

    grid.innerHTML = html;

    // Attach click handlers
    grid.querySelectorAll('.cal-day[data-date]').forEach(el => {
      el.addEventListener('click', () => {
        const parts = el.dataset.date.split('-');
        state.selectedDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);

        // Highlight selection immediately
        grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');

        // Advance to step 2
        setTimeout(() => goToStep(2), 300);
      });
    });
  }

  // ── Sessions Rendering (Real Data) ─────────
  async function renderSessions() {
    if (!state.selectedDate) return;

    const container = $('#sessions-container');
    const label = $('#session-date-label');
    const dateStr = dateToStr(state.selectedDate);

    label.textContent = formatDateID(state.selectedDate);
    container.innerHTML = '<div class="sessions-loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div><span>Memuat sesi...</span></div>';

    // Fetch real session data from API
    const data = await fetchSessions(dateStr);

    if (!data || !data.isOpen || data.sessions.length === 0) {
      container.innerHTML = '<div class="no-sessions">Tidak ada sesi tersedia untuk tanggal ini.</div>';
      return;
    }

    let html = '';
    data.sessions.forEach((session) => {
      const available = session.availableSlots;
      const isFull = available <= 0;
      const fillPercent = (session.bookedCount / session.maxSlots) * 100;

      let fillClass = '';
      if (fillPercent >= 100) fillClass = 'full';
      else if (fillPercent >= 60) fillClass = 'medium';

      const isSelected = state.selectedSession && state.selectedSession.index === session.index;

      html += `
        <div class="session-card ${isFull ? 'disabled' : ''} ${isSelected ? 'selected' : ''}" 
             data-session-index="${session.index}" 
             ${!isFull ? 'role="button" tabindex="0"' : ''}>
          <div class="session-top">
            <div>
              <div class="session-title">${session.name}</div>
              <div class="session-time">🕐 ${session.time}</div>
            </div>
            <div class="session-price-tag">${formatRupiah(session.price)}</div>
          </div>
          <div class="session-bottom">
            <div class="session-quota">
              <div class="quota-bar">
                <div class="quota-fill ${fillClass}" style="width: ${fillPercent}%"></div>
              </div>
              <span class="quota-text">${available} / ${session.maxSlots} slot tersisa</span>
            </div>
            <span class="session-status ${isFull ? 'full' : 'available'}">
              ${isFull ? '🔴 Penuh' : '🟢 Tersedia'}
            </span>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click handlers
    container.querySelectorAll('.session-card:not(.disabled)').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.sessionIndex);
        const sessionInfo = data.sessions.find(s => s.index === idx);
        state.selectedSession = { ...sessionInfo };
        renderSessionsUI(data.sessions); // re-render to show selection
        setTimeout(() => goToStep(3), 300);
      });
    });
  }

  // Re-render session cards (for selection highlight, without re-fetching)
  function renderSessionsUI(sessions) {
    const container = $('#sessions-container');
    let html = '';
    sessions.forEach((session) => {
      const available = session.availableSlots;
      const isFull = available <= 0;
      const fillPercent = (session.bookedCount / session.maxSlots) * 100;
      let fillClass = '';
      if (fillPercent >= 100) fillClass = 'full';
      else if (fillPercent >= 60) fillClass = 'medium';
      const isSelected = state.selectedSession && state.selectedSession.index === session.index;

      html += `
        <div class="session-card ${isFull ? 'disabled' : ''} ${isSelected ? 'selected' : ''}" 
             data-session-index="${session.index}" 
             ${!isFull ? 'role="button" tabindex="0"' : ''}>
          <div class="session-top">
            <div>
              <div class="session-title">${session.name}</div>
              <div class="session-time">🕐 ${session.time}</div>
            </div>
            <div class="session-price-tag">${formatRupiah(session.price)}</div>
          </div>
          <div class="session-bottom">
            <div class="session-quota">
              <div class="quota-bar">
                <div class="quota-fill ${fillClass}" style="width: ${fillPercent}%"></div>
              </div>
              <span class="quota-text">${available} / ${session.maxSlots} slot tersisa</span>
            </div>
            <span class="session-status ${isFull ? 'full' : 'available'}">
              ${isFull ? '🔴 Penuh' : '🟢 Tersedia'}
            </span>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  }

  // ── Booking Summary ────────────────────────
  function updateSummary() {
    if (state.bookingMode === 'package') {
      if (state.packBookingSesi && state.selectedDate && state.selectedSession) {
        $('#summary-date').textContent = formatDateID(state.selectedDate);
        $('#summary-time').textContent = state.selectedSession.time;
      } else {
        $('#summary-date').textContent = '🎫 Beli Paket Hemat';
        $('#summary-time').textContent = state.selectedPackage ? state.selectedPackage.name : '—';
      }
    } else {
      if (!state.selectedDate || !state.selectedSession) return;
      $('#summary-date').textContent = formatDateID(state.selectedDate);
      $('#summary-time').textContent = state.selectedSession.time;
    }

    const total = calculateTotal();
    $('#summary-total').textContent = formatRupiah(total);
  }

  function calculateTotal() {
    let total = 0;
    if (state.bookingMode === 'package' && state.selectedPackage) {
      total = state.selectedPackage.price;
    } else if (state.selectedSession) {
      total = state.selectedSession.price;
    }

    if (state.addons.shoes) total += ADDON_SHOES;
    if (state.addons.chalk) total += ADDON_CHALK;
    return total;
  }

  // ── Step Navigation ────────────────────────
  function goToStep(step) {
    const oldStep = state.currentStep;
    state.currentStep = step;

    $$('.step-panel').forEach(panel => {
      panel.classList.remove('active');
    });

    const target = $(`#step-${step}`);
    target.classList.add('active');

    target.style.opacity = '0';
    target.style.transform = step > oldStep ? 'translateX(20px)' : 'translateX(-20px)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        target.style.transition = 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
        target.style.opacity = '1';
        target.style.transform = 'translateY(0)';
      });
    });

    $$('.step-item').forEach(item => {
      const s = parseInt(item.dataset.step);
      item.classList.remove('active', 'done');
      if (s === step) item.classList.add('active');
      else if (s < step) item.classList.add('done');
    });

    $$('.step-connector').forEach((conn, idx) => {
      conn.classList.toggle('filled', idx < step - 1);
    });

    const summaryBar = $('#booking-summary-bar');
    if (step === 3) {
      summaryBar.classList.add('visible');
      updateSummary();
    } else {
      summaryBar.classList.remove('visible');
    }

    if (step === 2) renderSessions();
    if (step === 4) renderPaymentReview();
    if (step === 5) renderSuccess();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Payment Review ─────────────────────────
  function renderPaymentReview() {
    $('#review-name').textContent = state.userName || '—';
    $('#review-email').textContent = state.userEmail || '—';
    $('#review-wa').textContent = state.userWhatsApp ? `+62${state.userWhatsApp}` : '—';

    const ticketPriceLabel = $('#review-ticket-price-label');

    if (state.bookingMode === 'claim' && state.claimPackage) {
      if (ticketPriceLabel) ticketPriceLabel.textContent = 'Jenis Transaksi';
      $('#review-date').textContent = state.selectedDate ? formatDateID(state.selectedDate) : '—';
      $('#review-session').textContent = `${state.selectedSession.name} (${state.selectedSession.time})`;
      $('#review-ticket-price').textContent = `Potong Sesi (${state.claimPackage.packageName})`;
      
      const payOptions = $('.payment-options');
      const payDetails = $('#payment-details-container');
      const payTitle = document.querySelector('.payment-card.payment-methods .payment-card-title');
      const btnPayText = document.querySelector('#btn-pay .btn-pay-text');
      
      if (payOptions) payOptions.style.display = 'none';
      if (payDetails) {
        payDetails.style.display = 'block';
        const remaining = state.claimPackage.remainingUses;
        const newRemaining = remaining === -1 ? 'Unlimited' : remaining - 1;
        payDetails.innerHTML = `
          <div class="payment-details-title" style="margin-bottom: 8px;">
            <span>👑</span> Keanggotaan Member Aktif
          </div>
          <div style="font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary);">
            Sesi ini akan dipotong langsung dari paket Anda:<br>
            📦 <strong>${state.claimPackage.packageName}</strong><br>
            Sisa sesi Anda saat ini: <strong>${remaining === -1 ? 'Unlimited' : remaining + ' Sesi'}</strong><br>
            Sisa sesi setelah booking: <strong>${remaining === -1 ? 'Unlimited' : newRemaining + ' Sesi'}</strong>
          </div>
        `;
      }
      if (payTitle) payTitle.textContent = '💳 Validasi Keanggotaan';
      if (btnPayText) btnPayText.textContent = 'Konfirmasi Booking Sesi';
    } else {
      // Restore standard payment display
      const payOptions = $('.payment-options');
      const payTitle = document.querySelector('.payment-card.payment-methods .payment-card-title');
      const btnPayText = document.querySelector('#btn-pay .btn-pay-text');
      if (payOptions) payOptions.style.display = 'flex';
      if (payTitle) payTitle.textContent = '💳 Metode Pembayaran';
      if (btnPayText) btnPayText.textContent = 'Bayar Sekarang';

      if (state.bookingMode === 'package' && state.selectedPackage) {
        if (ticketPriceLabel) ticketPriceLabel.textContent = 'Harga Paket';

        if (state.packBookingSesi && state.selectedDate && state.selectedSession) {
          $('#review-date').textContent = formatDateID(state.selectedDate);
          $('#review-session').textContent = `${state.selectedPackage.name} (Booking Sesi 1: ${state.selectedSession.name})`;
        } else {
          $('#review-date').textContent = '🎫 Aktivasi Saat Datang';
          $('#review-session').textContent = state.selectedPackage.name;
        }
        $('#review-ticket-price').textContent = formatRupiah(state.selectedPackage.price);
      } else {
        if (ticketPriceLabel) ticketPriceLabel.textContent = 'Tiket Masuk';
        $('#review-date').textContent = state.selectedDate ? formatDateID(state.selectedDate) : '—';
        $('#review-session').textContent = state.selectedSession ? `${state.selectedSession.name} (${state.selectedSession.time})` : '—';
        $('#review-ticket-price').textContent = state.selectedSession ? formatRupiah(state.selectedSession.price) : '—';
      }
    }

    const shoesRow = $('#review-shoes-row');
    const chalkRow = $('#review-chalk-row');
    shoesRow.style.display = state.addons.shoes ? 'flex' : 'none';
    chalkRow.style.display = state.addons.chalk ? 'flex' : 'none';

    const total = calculateTotal();
    $('#review-total').textContent = formatRupiah(total);
    $('#btn-pay-amount').textContent = formatRupiah(total);

    // Render default checked payment method details
    const selectedRadio = document.querySelector('input[name="payment"]:checked');
    const method = selectedRadio ? selectedRadio.value : 'qris';
    updatePaymentDetails(method);
  }

  // ── Render Dynamic Payment details (QRIS, Bank, etc.) ──
  function updatePaymentDetails(method) {
    const container = $('#payment-details-container');
    if (!container) return;

    container.style.display = 'block';
    
    if (method === 'qris' || method === 'gopay' || method === 'ovo') {
      const methodName = method === 'qris' ? 'QRIS' : (method === 'gopay' ? 'GoPay' : 'OVO');
      const icon = method === 'qris' ? '📱' : (method === 'gopay' ? '💚' : '💜');
      container.innerHTML = `
        <div class="payment-details-title">
          <span>${icon}</span> Detail Pembayaran ${methodName}
        </div>
        <div class="qris-display">
          <div class="qris-img-wrapper">
            <img src="qris.png" alt="QRIS Code Ssshophaus Boulder">
          </div>
          <div class="qris-instructions">
            <strong>Scan QRIS di atas</strong> menggunakan aplikasi Mobile Banking atau e-Wallet favorit kamu (GoPay, OVO, Dana, LinkAja, BCA, dll).<br>
            <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 6px; display: inline-block;">Setelah berhasil scan & bayar, klik <strong>Bayar Sekarang</strong> di bawah untuk mendapatkan tiket kamu.</span>
          </div>
        </div>
      `;
    } else if (method === 'bank') {
      container.innerHTML = `
        <div class="payment-details-title">
          <span>🏦</span> Rekening Transfer Bank
        </div>
        <div class="bank-accounts-list">
          <!-- BCA -->
          <div class="bank-account-card">
            <div class="bank-info-left">
              <div class="bank-logo-badge bca">BCA</div>
              <div>
                <span class="bank-num-label">Nomor Rekening:</span>
                <span class="bank-number" id="bca-num">1234567890</span>
                <div class="bank-owner">a/n Ssshophaus Boulder / Budi Aji</div>
              </div>
            </div>
            <button class="btn-copy-num" data-copy-target="bca-num">Salin</button>
          </div>
          <!-- Mandiri -->
          <div class="bank-account-card">
            <div class="bank-info-left">
              <div class="bank-logo-badge mandiri">MANDIRI</div>
              <div>
                <span class="bank-num-label">Nomor Rekening:</span>
                <span class="bank-number" id="mandiri-num">0987654321</span>
                <div class="bank-owner">a/n Ssshophaus Boulder / Budi Aji</div>
              </div>
            </div>
            <button class="btn-copy-num" data-copy-target="mandiri-num">Salin</button>
          </div>
        </div>
        <div class="bank-instructions" style="margin-top: 12px;">
          Silakan transfer ke salah satu rekening di atas sebesar nominal total pembayaran.<br>
          <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; display: inline-block;">Setelah transfer, klik <strong>Bayar Sekarang</strong> untuk membuat tiket. Bukti transfer diunggah via WhatsApp konfirmasi.</span>
        </div>
      `;
      
      // Setup copy buttons
      container.querySelectorAll('.btn-copy-num').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = btn.dataset.copyTarget;
          const text = document.getElementById(targetId).textContent;
          navigator.clipboard.writeText(text).then(() => {
            btn.textContent = 'Disalin!';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = 'Salin';
              btn.classList.remove('copied');
            }, 2000);
          });
        });
      });
    } else {
      container.style.display = 'none';
    }
  }

  // ── Submit Booking to Backend ──────────────
  async function submitBooking() {
    const modal = $('#processing-modal');
    modal.classList.add('active');

    try {
      let result;

      if (state.bookingMode === 'claim' && state.claimPackage) {
        // ── Claim Session Booking ────────────
        const payload = {
          packageId: state.claimPackage.id,
          date: dateToStr(state.selectedDate),
          sessionIndex: state.selectedSession.index,
          addonShoes: state.addons.shoes,
          addonChalk: state.addons.chalk,
        };

        result = await api('/api/packages/redeem', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        state._serverResult = {
          type: 'claim',
          ticketId: result.booking.ticketId,
          totalAmount: result.booking.totalAmount,
          remainingUses: result.remainingUses,
        };
      } else if (state.bookingMode === 'package' && state.selectedPackage) {
        // ── Package Purchase ─────────────────
        const payload = {
          name: state.userName,
          email: state.userEmail,
          whatsapp: state.userWhatsApp,
          packageType: state.selectedPackage.id,
          addonShoes: state.addons.shoes,
          addonChalk: state.addons.chalk,
          paymentMethod: state.paymentMethod,
          bookFirstSession: state.packBookingSesi,
        };

        if (state.packBookingSesi && state.selectedDate && state.selectedSession) {
          payload.firstSessionDate = dateToStr(state.selectedDate);
          payload.firstSessionIndex = state.selectedSession.index;
        }

        result = await api('/api/packages', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        // Store ticket info for success page
        state._serverResult = {
          type: 'package',
          ticketId: result.package.ticketId,
          totalAmount: result.package.totalAmount,
          firstBooking: result.firstBooking,
        };
      } else {
        // ── Single Entry Booking ─────────────
        const payload = {
          name: state.userName,
          email: state.userEmail,
          whatsapp: state.userWhatsApp,
          date: dateToStr(state.selectedDate),
          sessionIndex: state.selectedSession.index,
          addonShoes: state.addons.shoes,
          addonChalk: state.addons.chalk,
          paymentMethod: state.paymentMethod,
        };

        result = await api('/api/bookings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        state._serverResult = {
          type: 'single',
          ticketId: result.booking.ticketId,
          totalAmount: result.booking.totalAmount,
        };
      }

      modal.classList.remove('active');
      goToStep(5);
    } catch (err) {
      modal.classList.remove('active');
      
      // Show error to user
      const errorMsg = err.message || 'Terjadi kesalahan. Coba lagi.';
      showErrorToast(errorMsg);
    }
  }

  // ── Error Toast ────────────────────────────
  function showErrorToast(message) {
    // Remove existing toast
    const existing = document.querySelector('.error-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.innerHTML = `
      <span class="toast-icon">❌</span>
      <span class="toast-message">${message}</span>
    `;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(239, 68, 68, 0.95);
      color: white;
      padding: 14px 24px;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 500;
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 8px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(239, 68, 68, 0.3);
      animation: fadeInUp 0.3s ease;
      max-width: 90vw;
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── Success Page ───────────────────────────
  function renderSuccess() {
    const serverResult = state._serverResult;
    const ticketId = serverResult ? serverResult.ticketId : 'SS-??????';
    const totalAmount = serverResult ? serverResult.totalAmount : calculateTotal();

    $('#ticket-id').textContent = ticketId;
    $('#ticket-name').textContent = state.userName;

    const ticketDateLabel = $('#ticket-date-label');
    const ticketSessionLabel = $('#ticket-session-label');

    if (state.bookingMode === 'claim' && state.claimPackage) {
      if (ticketDateLabel) ticketDateLabel.textContent = 'Jenis Transaksi';
      if (ticketSessionLabel) ticketSessionLabel.textContent = 'Paket / Sesi';

      const remaining = serverResult ? serverResult.remainingUses : state.claimPackage.remainingUses;
      const remainingText = remaining === -1 ? 'Unlimited' : `${remaining} Sesi Tersisa`;

      $('#ticket-date').textContent = 'Klaim Sesi Paket (Rp 0)';
      $('#ticket-session').textContent = `${state.claimPackage.packageName}\n(Sesi: ${state.selectedSession.name} - ${remainingText})`;
    } else if (state.bookingMode === 'package' && state.selectedPackage) {
      if (ticketDateLabel) ticketDateLabel.textContent = 'Tipe Transaksi';
      if (ticketSessionLabel) ticketSessionLabel.textContent = 'Paket / Item';

      if (state.packBookingSesi && state.selectedDate && state.selectedSession) {
        $('#ticket-date').textContent = 'Paket + Booking Sesi';
        $('#ticket-session').textContent = `${state.selectedPackage.name}\n(Sesi 1: ${formatDateID(state.selectedDate)} - ${state.selectedSession.name})`;
      } else {
        $('#ticket-date').textContent = 'Pembelian Paket';
        $('#ticket-session').textContent = state.selectedPackage.name;
      }
    } else {
      if (ticketDateLabel) ticketDateLabel.textContent = 'Tanggal';
      if (ticketSessionLabel) ticketSessionLabel.textContent = 'Sesi';

      $('#ticket-date').textContent = state.selectedDate ? formatDateID(state.selectedDate) : '—';
      $('#ticket-session').textContent = state.selectedSession ? `${state.selectedSession.name}` : '—';
    }

    $('#ticket-total').textContent = formatRupiah(totalAmount);

    // Generate barcode lines
    const barcodeContainer = document.querySelector('.barcode-lines');
    let barcodeHtml = '';
    for (let i = 0; i < 40; i++) {
      const h = 10 + Math.random() * 20;
      const w = Math.random() > 0.5 ? 2 : 3;
      barcodeHtml += `<div class="barcode-line" style="height:${h}px;width:${w}px;"></div>`;
    }
    barcodeContainer.innerHTML = barcodeHtml;

    // Hide stepper
    $('#stepper').style.display = 'none';

    // ── WhatsApp Receipt Link ──
    const waPhone = '6282120985291';
    let bookingItemDetails = '';

    let isClaim = state.bookingMode === 'claim';

    if (isClaim && state.claimPackage) {
      const remaining = serverResult ? serverResult.remainingUses : state.claimPackage.remainingUses;
      const remainingText = remaining === -1 ? 'Unlimited' : `${remaining} Sesi`;
      bookingItemDetails = `🎟️ *Klaim Paket:* ${state.claimPackage.packageName}\n📅 *Sesi:* ${formatDateID(state.selectedDate)} (${state.selectedSession.name})\n👑 *Sisa Sesi:* ${remainingText}`;
    } else if (state.bookingMode === 'package' && state.selectedPackage) {
      if (state.packBookingSesi && state.selectedDate && state.selectedSession) {
        bookingItemDetails = `📦 *Paket:* ${state.selectedPackage.name}\n📅 *Sesi 1:* ${formatDateID(state.selectedDate)} (${state.selectedSession.name})`;
      } else {
        bookingItemDetails = `📦 *Paket:* ${state.selectedPackage.name} (Aktivasi Saat Datang)`;
      }
    } else {
      bookingItemDetails = `📅 *Tanggal:* ${formatDateID(state.selectedDate)}\n🕐 *Sesi:* ${state.selectedSession.name} (${state.selectedSession.time})`;
    }

    let addonDetails = [];
    if (state.addons.shoes) addonDetails.push('Sewa Sepatu (Rp 25.000)');
    if (state.addons.chalk) addonDetails.push('Sewa Chalk Bag (Rp 15.000)');
    const addonText = addonDetails.length > 0 ? addonDetails.join(', ') : 'Tidak ada';

    const waMessage = isClaim
      ? `Hi Ssshophaus Boulder! Saya ingin mengonfirmasi booking sesi menggunakan paket member saya:\n\n🎟️ *ID TIKET:* ${ticketId}\n👤 *Nama:* ${state.userName}\n📞 *WhatsApp:* +62${state.userWhatsApp}\n\n🛒 *RINCIAN KLAIM SESI:*\n---------------------\n${bookingItemDetails}\n🎒 *Add-ons:* ${addonText}\n💰 *TOTAL BAYAR (Add-ons):* ${formatRupiah(totalAmount)}\n\n(Mohon konfirmasi pendaftaran sesi ini di sistem admin Anda)`
      : `Hi Ssshophaus Boulder! Saya ingin mengonfirmasi booking & mengirimkan bukti pembayaran:\n\n🎟️ *ID TIKET:* ${ticketId}\n👤 *Nama:* ${state.userName}\n📞 *WhatsApp:* +62${state.userWhatsApp}\n📧 *Email:* ${state.userEmail}\n\n🛒 *RINCIAN BOOKING:*\n---------------------\n${bookingItemDetails}\n🎒 *Add-ons:* ${addonText}\n💰 *TOTAL BAYAR:* ${formatRupiah(totalAmount)}\n\n(Mohon sertakan foto/screenshot struk bukti transfer/QRIS Anda di bawah chat ini)`;

    const encodedMessage = encodeURIComponent(waMessage);
    const waUrl = `https://wa.me/${waPhone}?text=${encodedMessage}`;

    $('#btn-send-wa-receipt').onclick = () => {
      window.open(waUrl, '_blank');
    };
  }

  // ── Form Validation ────────────────────────
  function validateForm() {
    const name = $('#input-name').value.trim();
    const email = $('#input-email').value.trim();
    const wa = $('#input-whatsapp').value.trim();

    const errors = [];
    if (!name) errors.push('Nama lengkap harus diisi');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email tidak valid');
    if (!wa || wa.length < 9) errors.push('Nomor WhatsApp tidak valid');

    if (errors.length > 0) {
      showValidationError(errors);
      return false;
    }

    state.userName = name;
    state.userEmail = email;
    state.userWhatsApp = wa;
    return true;
  }

  function showValidationError(errors) {
    const inputs = $$('.form-group input');
    inputs.forEach(input => {
      if (!input.value.trim()) {
        input.style.borderColor = 'var(--danger)';
        input.style.animation = 'shake 0.4s ease';
        setTimeout(() => {
          input.style.borderColor = '';
          input.style.animation = '';
        }, 2000);
      }
    });

    const phoneWrapper = $('.phone-input-wrapper');
    const phoneInput = $('#input-whatsapp');
    if (!phoneInput.value.trim() || phoneInput.value.trim().length < 9) {
      phoneWrapper.style.borderColor = 'var(--danger)';
      setTimeout(() => {
        phoneWrapper.style.borderColor = '';
      }, 2000);
    }
  }

  // ── Navigation Toggle ──────────────────────
  function setupNavigation() {
    const navLinks = $$('.nav-link');
    const bookNav = navLinks[0];
    const aboutNav = navLinks[1];
    const contactNav = navLinks[2];
    const stepper = $('#stepper');
    const aboutPanel = $('#about-panel');
    const contactPanel = $('#contact-panel');
    const summaryBar = $('#booking-summary-bar');
    const packFlowBar = $('#package-flow-bar');

    aboutNav.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach(link => link.classList.remove('active'));
      aboutNav.classList.add('active');
      $$('.step-panel').forEach(panel => panel.classList.remove('active'));
      stepper.style.display = 'none';
      summaryBar.classList.remove('visible');
      packFlowBar.classList.add('hidden');
      contactPanel.classList.remove('active');
      aboutPanel.classList.add('active');
      aboutPanel.style.opacity = '0';
      aboutPanel.style.transform = 'translateY(15px)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          aboutPanel.style.transition = 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
          aboutPanel.style.opacity = '1';
          aboutPanel.style.transform = 'translateY(0)';
        });
      });
    });

    contactNav.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach(link => link.classList.remove('active'));
      contactNav.classList.add('active');
      $$('.step-panel').forEach(panel => panel.classList.remove('active'));
      stepper.style.display = 'none';
      summaryBar.classList.remove('visible');
      packFlowBar.classList.add('hidden');
      aboutPanel.classList.remove('active');
      contactPanel.classList.add('active');
      contactPanel.style.opacity = '0';
      contactPanel.style.transform = 'translateY(15px)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          contactPanel.style.transition = 'all 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
          contactPanel.style.opacity = '1';
          contactPanel.style.transform = 'translateY(0)';
        });
      });
    });

    bookNav.addEventListener('click', (e) => {
      if (e) e.preventDefault();
      navLinks.forEach(link => link.classList.remove('active'));
      bookNav.classList.add('active');
      aboutPanel.classList.remove('active');
      contactPanel.classList.remove('active');
      if (state.currentStep !== 5) {
        stepper.style.display = 'flex';
      }
      const currentPanel = $(`#step-${state.currentStep}`);
      if (currentPanel) currentPanel.classList.add('active');
      if (state.currentStep === 3) {
        summaryBar.classList.add('visible');
      }
      if (state.currentStep === 1 && state.bookingMode === 'package' && state.selectedPackage) {
        packFlowBar.classList.remove('hidden');
      }
    });

    $('#btn-about-to-book').addEventListener('click', () => { bookNav.click(); });
    $('#btn-contact-to-book').addEventListener('click', () => { bookNav.click(); });

    // ── Hamburger Menu Toggle for Mobile ──
    const hamburgerBtn = $('#hamburger-btn');
    const headerNav = $('.header-nav');

    if (hamburgerBtn && headerNav) {
      hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hamburgerBtn.classList.toggle('active');
        headerNav.classList.toggle('active');
      });

      // Close menu when clicking any nav link
      navLinks.forEach(link => {
        link.addEventListener('click', () => {
          hamburgerBtn.classList.remove('active');
          headerNav.classList.remove('active');
        });
      });

      // Close menu when clicking anywhere outside
      document.addEventListener('click', (e) => {
        if (!headerNav.contains(e.target) && !hamburgerBtn.contains(e.target)) {
          hamburgerBtn.classList.remove('active');
          headerNav.classList.remove('active');
        }
      });
    }
  }

  // ── Initialization ─────────────────────────
  function init() {
    setupNavigation();
    renderCalendar();

    const tabSingle = $('#tab-single');
    const tabPackage = $('#tab-package');
    const tabClaim = $('#tab-claim');
    const tabCheckTicket = $('#tab-check-ticket');
    const singleWrapper = $('#single-pass-wrapper');
    const packageWrapper = $('#packages-wrapper');
    const claimWrapper = $('#claim-session-wrapper');
    const checkTicketWrapper = $('#check-ticket-wrapper');
    const packFlowBar = $('#package-flow-bar');

    tabSingle.addEventListener('click', () => {
      state.bookingMode = 'single';
      state.selectedPackage = null;
      state.claimPackage = null;
      state.packBookingSesi = false;

      tabSingle.classList.add('active');
      tabPackage.classList.remove('active');
      tabClaim.classList.remove('active');
      tabCheckTicket.classList.remove('active');

      singleWrapper.classList.remove('hidden');
      packageWrapper.classList.add('hidden');
      claimWrapper.classList.add('hidden');
      checkTicketWrapper.classList.add('hidden');
      packFlowBar.classList.add('hidden');

      state.selectedDate = null;
      state.selectedSession = null;
      
      const alertBanner = $('#pack-booking-alert');
      if (alertBanner) alertBanner.remove();

      renderCalendar();
    });

    tabPackage.addEventListener('click', () => {
      state.bookingMode = 'package';
      state.claimPackage = null;

      tabPackage.classList.add('active');
      tabSingle.classList.remove('active');
      tabClaim.classList.remove('active');
      tabCheckTicket.classList.remove('active');

      packageWrapper.classList.remove('hidden');
      singleWrapper.classList.add('hidden');
      claimWrapper.classList.add('hidden');
      checkTicketWrapper.classList.add('hidden');

      const alertBanner = $('#pack-booking-alert');
      if (alertBanner) alertBanner.remove();

      if (state.selectedPackage) {
        packFlowBar.classList.remove('hidden');
      } else {
        packFlowBar.classList.add('hidden');
      }
    });

    tabClaim.addEventListener('click', () => {
      state.bookingMode = 'claim';
      state.selectedPackage = null;
      state.claimPackage = null;
      state.packBookingSesi = false;

      tabClaim.classList.add('active');
      tabSingle.classList.remove('active');
      tabPackage.classList.remove('active');
      tabCheckTicket.classList.remove('active');

      claimWrapper.classList.remove('hidden');
      singleWrapper.classList.add('hidden');
      packageWrapper.classList.add('hidden');
      checkTicketWrapper.classList.add('hidden');
      packFlowBar.classList.add('hidden');

      state.selectedDate = null;
      state.selectedSession = null;
      
      const alertBanner = $('#pack-booking-alert');
      if (alertBanner) alertBanner.remove();
      
      // Clear input and results
      $('#claim-whatsapp').value = '';
      $('#claim-result-box').classList.add('hidden');
      $('#claim-result-box').innerHTML = '';
    });

    tabCheckTicket.addEventListener('click', () => {
      state.bookingMode = 'check-ticket';
      state.selectedPackage = null;
      state.claimPackage = null;
      state.packBookingSesi = false;

      tabCheckTicket.classList.add('active');
      tabSingle.classList.remove('active');
      tabPackage.classList.remove('active');
      tabClaim.classList.remove('active');

      checkTicketWrapper.classList.remove('hidden');
      singleWrapper.classList.add('hidden');
      packageWrapper.classList.add('hidden');
      claimWrapper.classList.add('hidden');
      packFlowBar.classList.add('hidden');

      state.selectedDate = null;
      state.selectedSession = null;
      
      const alertBanner = $('#pack-booking-alert');
      if (alertBanner) alertBanner.remove();
      
      // Clear input and results
      $('#check-ticket-whatsapp').value = '';
      $('#check-ticket-result-box').classList.add('hidden');
      $('#check-ticket-result-box').innerHTML = '';
    });

    // Package Card Selection
    $$('.package-card').forEach(card => {
      card.addEventListener('click', () => {
        $$('.package-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');

        const pkgId = card.dataset.packageId;
        state.selectedPackage = PACKAGES[pkgId];

        $('#selected-pack-name').textContent = state.selectedPackage.name;
        packFlowBar.classList.remove('hidden');
      });
    });

    // Package Flow Bar Actions
    $('#btn-pack-buy-only').addEventListener('click', () => {
      state.packBookingSesi = false;
      state.selectedDate = null;
      state.selectedSession = null;
      goToStep(3);
    });

    $('#btn-pack-and-book').addEventListener('click', () => {
      state.packBookingSesi = true;

      singleWrapper.classList.remove('hidden');
      packageWrapper.classList.add('hidden');

      let alertBanner = $('#pack-booking-alert');
      if (!alertBanner) {
        alertBanner = document.createElement('div');
        alertBanner.id = 'pack-booking-alert';
        alertBanner.style.cssText = `
          background: rgba(204, 65, 37, 0.1);
          border: 1px solid rgba(204, 65, 37, 0.25);
          color: var(--accent-primary);
          padding: 12px 16px;
          border-radius: var(--radius-md);
          margin-bottom: var(--space-md);
          font-size: 0.85rem;
          font-weight: 500;
          animation: fadeInUp 0.4s ease;
        `;
        alertBanner.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; width:100%;">
            <span style="text-align:left;">🌟 <strong>Booking Sesi Pertama:</strong> Pilih tanggal climbing kamu pada kalender di bawah.</span>
            <button id="btn-cancel-pack-booking" class="btn btn-sm btn-ghost" style="padding:4px 8px; font-size:0.75rem; color:var(--accent-primary); border:1px solid rgba(204, 65, 37, 0.2); background:transparent; cursor:pointer;">
              ← Kembali ke Paket
            </button>
          </div>
        `;
        singleWrapper.insertBefore(alertBanner, singleWrapper.firstChild);
        
        alertBanner.querySelector('#btn-cancel-pack-booking').addEventListener('click', (e) => {
          e.preventDefault();
          tabPackage.click();
        });
      } else {
        alertBanner.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; width:100%;">
            <span style="text-align:left;">🌟 <strong>Booking Sesi Pertama:</strong> Pilih tanggal climbing kamu pada kalender di bawah.</span>
            <button id="btn-cancel-pack-booking" class="btn btn-sm btn-ghost" style="padding:4px 8px; font-size:0.75rem; color:var(--accent-primary); border:1px solid rgba(204, 65, 37, 0.2); background:transparent; cursor:pointer;">
              ← Kembali ke Paket
            </button>
          </div>
        `;
        alertBanner.querySelector('#btn-cancel-pack-booking').addEventListener('click', (e) => {
          e.preventDefault();
          tabPackage.click();
        });
      }

      renderCalendar();
    });

    // Calendar navigation
    $('#cal-prev').addEventListener('click', () => {
      state.calendarMonth--;
      if (state.calendarMonth < 0) {
        state.calendarMonth = 11;
        state.calendarYear--;
      }
      renderCalendar();
    });

    $('#cal-next').addEventListener('click', () => {
      state.calendarMonth++;
      if (state.calendarMonth > 11) {
        state.calendarMonth = 0;
        state.calendarYear++;
      }
      renderCalendar();
    });

    // Back buttons
    $('#back-to-calendar').addEventListener('click', () => {
      goToStep(1);
    });

    $('#back-to-sessions').addEventListener('click', () => {
      if (state.bookingMode === 'package' && !state.packBookingSesi) {
        goToStep(1);
        tabPackage.click();
      } else if (state.bookingMode === 'claim') {
        goToStep(1);
        tabClaim.click();
      } else {
        goToStep(2);
      }
    });

    $('#back-to-form').addEventListener('click', () => goToStep(3));

    // Add-on checkboxes
    $('#addon-shoes').addEventListener('change', (e) => {
      state.addons.shoes = e.target.checked;
      updateSummary();
    });

    $('#addon-chalk').addEventListener('change', (e) => {
      state.addons.chalk = e.target.checked;
      updateSummary();
    });

    // To Payment button
    $('#btn-to-payment').addEventListener('click', () => {
      if (validateForm()) {
        goToStep(4);
      }
    });

    // Pay button → REAL API CALL
    $('#btn-pay').addEventListener('click', () => {
      // Get selected payment method
      const paymentRadio = document.querySelector('input[name="payment"]:checked');
      state.paymentMethod = paymentRadio ? paymentRadio.value : 'qris';

      submitBooking();
    });

    // Payment radio button selection change
    $$('input[name="payment"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        updatePaymentDetails(e.target.value);
      });
    });

    // New booking button
    $('#btn-new-booking').addEventListener('click', () => {
      state.bookingMode = 'single';
      state.selectedPackage = null;
      state.packBookingSesi = false;
      state.selectedDate = null;
      state.selectedSession = null;
      state.userName = '';
      state.userEmail = '';
      state.userWhatsApp = '';
      state.addons = { shoes: false, chalk: false };
      state._serverResult = null;

      const alertBanner = $('#pack-booking-alert');
      if (alertBanner) alertBanner.remove();

      tabSingle.classList.add('active');
      tabPackage.classList.remove('active');
      singleWrapper.classList.remove('hidden');
      packageWrapper.classList.add('hidden');
      packFlowBar.classList.add('hidden');
      $$('.package-card').forEach(c => c.classList.remove('selected'));

      $('#input-name').value = '';
      $('#input-email').value = '';
      $('#input-whatsapp').value = '';
      $('#addon-shoes').checked = false;
      $('#addon-chalk').checked = false;

      $('#stepper').style.display = 'flex';

      goToStep(1);
      renderCalendar();
    });

    // ── Check Claim Code & Redeem Flow ──
    const btnCheckClaim = $('#btn-check-claim');
    const claimWhatsappInput = $('#claim-whatsapp');
    const claimLoading = $('#claim-loading');
    const claimResultBox = $('#claim-result-box');

    if (btnCheckClaim && claimWhatsappInput) {
      btnCheckClaim.addEventListener('click', async () => {
        const wa = claimWhatsappInput.value.trim();
        if (!wa || wa.length < 9) {
          showErrorToast('Nomor WhatsApp tidak valid.');
          return;
        }

        // Show loading
        claimLoading.classList.remove('hidden');
        claimResultBox.classList.add('hidden');
        claimResultBox.innerHTML = '';

        try {
          const result = await api(`/api/packages/check/active?whatsapp=${encodeURIComponent(wa)}`);
          claimLoading.classList.add('hidden');

          if (result && result.success && result.packages.length > 0) {
            claimResultBox.classList.remove('hidden');
            let html = `<h4 style="font-family:'Space Grotesk',sans-serif;font-size:0.95rem;margin-bottom:12px;color:var(--accent-primary);">🎟️ Paket Aktif Ditemukan:</h4>`;
            
            result.packages.forEach(pkg => {
              const remaining = pkg.remainingUses === -1 ? 'Unlimited' : `${pkg.remainingUses} Sesi`;
              const expDate = new Date(pkg.expiresAt);
              const formattedExp = expDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
              
              html += `
                <div class="active-package-card" style="padding:12px;border:1px solid var(--glass-border);border-radius:var(--radius-md);background:rgba(255,255,255,0.01);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
                  <div>
                    <strong style="display:block;font-size:0.9rem;text-align:left;">${pkg.packageName}</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted);display:block;text-align:left;">a/n ${pkg.name} | Sisa: <strong>${remaining}</strong></span>
                    <span style="display:block;font-size:0.7rem;color:var(--text-muted);margin-top:2px;text-align:left;">Berlaku s/d: ${formattedExp}</span>
                  </div>
                  <button class="btn btn-primary btn-sm btn-redeem-pack" data-id="${pkg.id}" style="padding:6px 12px;font-size:0.8rem;border-radius:var(--radius-sm);flex-shrink:0;">
                    Gunakan Sesi
                  </button>
                </div>
              `;
            });
            
            claimResultBox.innerHTML = html;
            
            // Attach click listeners to Redeem buttons
            claimResultBox.querySelectorAll('.btn-redeem-pack').forEach(btn => {
              btn.addEventListener('click', () => {
                const pkgId = parseInt(btn.dataset.id);
                const pkg = result.packages.find(p => p.id === pkgId);
                
                // Store active package in state
                state.claimPackage = pkg;
                state.bookingMode = 'claim';
                
                // Auto fill client details in Step 3
                state.userName = pkg.name;
                state.userEmail = pkg.email;
                state.userWhatsApp = pkg.whatsapp;
                
                $('#input-name').value = pkg.name;
                $('#input-email').value = pkg.email;
                $('#input-whatsapp').value = pkg.whatsapp;

                // Take them to the calendar wrapper to choose a date
                claimWrapper.classList.add('hidden');
                singleWrapper.classList.remove('hidden');
                
                // Create a dynamic claim alert banner in calendar wrapper
                let alertBanner = $('#pack-booking-alert');
                if (!alertBanner) {
                  alertBanner = document.createElement('div');
                  alertBanner.id = 'pack-booking-alert';
                  alertBanner.style.cssText = `
                    background: rgba(204, 65, 37, 0.1);
                    border: 1px solid rgba(204, 65, 37, 0.25);
                    color: var(--accent-primary);
                    padding: 12px 16px;
                    border-radius: var(--radius-md);
                    margin-bottom: var(--space-md);
                    font-size: 0.85rem;
                    font-weight: 500;
                    animation: fadeInUp 0.4s ease;
                  `;
                  alertBanner.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; width:100%;">
                      <span style="text-align:left;">👑 <strong>Klaim Sesi Member:</strong> Pilih tanggal climbing kamu pada kalender di bawah.</span>
                      <button id="btn-cancel-claim-booking" class="btn btn-sm btn-ghost" style="padding:4px 8px; font-size:0.75rem; color:var(--accent-primary); border:1px solid rgba(204, 65, 37, 0.2); background:transparent; cursor:pointer;">
                        ← Kembali
                      </button>
                    </div>
                  `;
                  singleWrapper.insertBefore(alertBanner, singleWrapper.firstChild);
                  
                  alertBanner.querySelector('#btn-cancel-claim-booking').addEventListener('click', (e) => {
                    e.preventDefault();
                    tabClaim.click();
                  });
                } else {
                  alertBanner.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; width:100%;">
                      <span style="text-align:left;">👑 <strong>Klaim Sesi Member:</strong> Pilih tanggal climbing kamu pada kalender di bawah.</span>
                      <button id="btn-cancel-claim-booking" class="btn btn-sm btn-ghost" style="padding:4px 8px; font-size:0.75rem; color:var(--accent-primary); border:1px solid rgba(204, 65, 37, 0.2); background:transparent; cursor:pointer;">
                        ← Kembali
                      </button>
                    </div>
                  `;
                  alertBanner.querySelector('#btn-cancel-claim-booking').addEventListener('click', (e) => {
                    e.preventDefault();
                    tabClaim.click();
                  });
                }
                
                renderCalendar();
              });
            });
          }
        } catch (err) {
          claimLoading.classList.add('hidden');
          const errorMsg = err.message || 'Paket tidak ditemukan atau sudah kedaluwarsa.';
          showErrorToast(errorMsg);
        }
      });
    }

    // ── Search Ticket Flow ──
    const btnSearchTicket = $('#btn-search-ticket');
    const searchTicketWhatsappInput = $('#check-ticket-whatsapp');
    const searchTicketLoading = $('#search-ticket-loading');
    const searchTicketResultBox = $('#check-ticket-result-box');

    if (btnSearchTicket && searchTicketWhatsappInput) {
      btnSearchTicket.addEventListener('click', async () => {
        const wa = searchTicketWhatsappInput.value.trim();
        if (!wa || wa.length < 9) {
          showErrorToast('Nomor WhatsApp tidak valid.');
          return;
        }

        // Show loading
        searchTicketLoading.classList.remove('hidden');
        searchTicketResultBox.classList.add('hidden');
        searchTicketResultBox.innerHTML = '';

        try {
          const result = await api(`/api/bookings/check/active?whatsapp=${encodeURIComponent(wa)}`);
          searchTicketLoading.classList.add('hidden');

          if (result && result.success && result.bookings.length > 0) {
            searchTicketResultBox.classList.remove('hidden');
            let html = `<h4 style="font-family:'Space Grotesk',sans-serif;font-size:0.95rem;margin-bottom:12px;color:var(--accent-primary);">📅 Booking Aktif Ditemukan:</h4>`;
            
            result.bookings.forEach(b => {
              const parts = b.bookingDate.split('-');
              const bDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
              const formattedDate = bDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
              const typeText = b.bookingType === 'package' ? 'Member Claim' : 'Single Entry';
              
              html += `
                <div class="active-package-card" style="padding:12px;border:1px solid var(--glass-border);border-radius:var(--radius-md);background:rgba(255,255,255,0.01);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;">
                  <div>
                    <strong style="display:block;font-size:0.9rem;text-align:left;">${formattedDate}</strong>
                    <span style="font-size:0.75rem;color:var(--text-muted);display:block;text-align:left;">Sesi: ${b.sessionName} (${b.sessionTime})</span>
                    <span style="display:block;font-size:0.7rem;color:var(--accent-primary);margin-top:2px;text-align:left;">Tipe: ${typeText} | Kode: ${b.ticketId}</span>
                  </div>
                  <button class="btn btn-primary btn-sm btn-view-barcode" data-id="${b.id}" style="padding:6px 12px;font-size:0.8rem;border-radius:var(--radius-sm);flex-shrink:0;">
                    Lihat Tiket
                  </button>
                </div>
              `;
            });
            
            searchTicketResultBox.innerHTML = html;
            
            // Attach click listeners to View Barcode buttons
            searchTicketResultBox.querySelectorAll('.btn-view-barcode').forEach(btn => {
              btn.addEventListener('click', () => {
                const bId = parseInt(btn.dataset.id);
                const b = result.bookings.find(item => item.id === bId);
                
                // Store selected booking in state so success screen renders it
                state.bookingMode = b.bookingType === 'package' ? 'claim' : 'single';
                if (b.bookingType === 'package') {
                  state.claimPackage = {
                    packageName: 'Sesi Member / Multipass',
                    remainingUses: -1
                  };
                }
                
                state._serverResult = {
                  type: b.bookingType === 'package' ? 'claim' : 'single',
                  ticketId: b.ticketId,
                  totalAmount: b.totalAmount,
                  remainingUses: -1
                };
                
                // Update credentials
                state.userName = b.name;
                state.userEmail = b.email;
                state.userWhatsApp = b.whatsapp;
                
                // Set state date and session
                const dateParts = b.bookingDate.split('-');
                state.selectedDate = new Date(+dateParts[0], +dateParts[1] - 1, +dateParts[2]);
                state.selectedSession = {
                  index: b.sessionIndex,
                  name: b.sessionName,
                  time: b.sessionTime,
                  price: b.basePrice
                };
                
                // Render and transition to Step 5
                renderSuccess();
                goToStep(5);
              });
            });
          }
        } catch (err) {
          searchTicketLoading.classList.add('hidden');
          const errorMsg = err.message || 'Tidak ada booking aktif yang ditemukan untuk nomor WhatsApp ini.';
          showErrorToast(errorMsg);
        }
      });
    }

    // Share button
    $('#btn-share').addEventListener('click', () => {
      if (navigator.share) {
        navigator.share({
          title: 'Ssshophaus Boulder Booking',
          text: `Aku sudah booking sesi climbing di Ssshophaus Boulder! 🧗`,
          url: window.location.href,
        });
      } else {
        navigator.clipboard.writeText(window.location.href).then(() => {
          const btn = $('#btn-share');
          const origHTML = btn.innerHTML;
          btn.innerHTML = '✅ Link disalin!';
          setTimeout(() => { btn.innerHTML = origHTML; }, 2000);
        });
      }
    });

    // Add shake animation CSS
    const style = document.createElement('style');
    style.textContent = `
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
        20%, 40%, 60%, 80% { transform: translateX(4px); }
      }
      .cal-loading, .sessions-loading {
        grid-column: 1 / -1;
        text-align: center;
        padding: 32px;
        color: var(--text-secondary);
        font-size: 0.9rem;
      }
      .sessions-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .loading-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-primary);
        animation: loadingPulse 1.2s infinite ease-in-out;
      }
      .loading-dot:nth-child(2) { animation-delay: 0.2s; }
      .loading-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes loadingPulse {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }
      .no-sessions {
        text-align: center;
        padding: 48px 24px;
        color: var(--text-secondary);
        font-size: 0.95rem;
      }
    `;
    document.head.appendChild(style);
  }

  // Start the app
  document.addEventListener('DOMContentLoaded', init);
})();
