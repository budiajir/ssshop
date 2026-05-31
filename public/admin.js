/* ============================================
   SS Climbing — Owner/Admin Dashboard Logic
   ============================================ */

(function () {
  'use strict';

  // ── State ──────────────────────────────────
  const state = {
    isAuthenticated: false,
    adminToken: null,
    currentPIN: '',
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    selectedDate: null,
    overrides: [],      // array of { overrideDate, isOpen, note, sessionTemplate }
    overridesMap: {},   // lookup map: dateStr -> override
    climbers: []        // climbers booked for selected date
  };

  // ── Constants ──────────────────────────────
  const MONTHS_ID = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const DAYS_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  // ── DOM Refs ───────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Toast Helper ───────────────────────────
  function showToast(message, isError = false) {
    // Remove existing toast
    const existing = document.querySelector('.error-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: ${isError ? 'rgba(239, 68, 68, 0.95)' : 'rgba(34, 197, 94, 0.95)'};
      color: white;
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 500;
      z-index: 100000;
      display: flex;
      align-items: center;
      gap: 8px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
      animation: fadeInUp 0.3s ease;
      max-width: 90vw;
    `;
    toast.innerHTML = `<span class="toast-icon">${isError ? '❌' : '✅'}</span> <span class="toast-message">${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ── API Helper ─────────────────────────────
  async function api(url, options = {}) {
    try {
      const res = await fetch(url, {
        headers: { 
          'Content-Type': 'application/json'
        },
        ...options,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      return data;
    } catch (err) {
      console.error(`Admin API Error [${url}]:`, err);
      throw err;
    }
  }

  // ── Date Formatting Helpers ────────────────
  function dateToStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function formatDateID(date) {
    return `${DAYS_ID[date.getDay()]}, ${date.getDate()} ${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`;
  }

  function isOpenDay(dayOfWeek) {
    return [1, 3, 5, 6].includes(dayOfWeek);
  }

  // ── PIN Screen Logic ───────────────────────
  function setupNumpad() {
    const dots = $$('.pin-dot');
    
    $$('.num-btn[data-value]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.currentPIN.length < 4) {
          state.currentPIN += btn.dataset.value;
          updatePinDots();
          if (state.currentPIN.length === 4) {
            verifyPIN();
          }
        }
      });
    });

    $('#btn-pin-clear').addEventListener('click', () => {
      state.currentPIN = '';
      updatePinDots();
    });

    $('#btn-pin-back').addEventListener('click', () => {
      state.currentPIN = state.currentPIN.slice(0, -1);
      updatePinDots();
    });
  }

  function updatePinDots() {
    const dots = $$('.pin-dot');
    dots.forEach((dot, idx) => {
      if (idx < state.currentPIN.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  async function verifyPIN() {
    try {
      const result = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ pin: state.currentPIN })
      });

      if (result && result.success) {
        state.isAuthenticated = true;
        state.adminToken = result.token;
        localStorage.setItem('ss_admin_token', result.token);
        
        // Hide PIN screen
        $('#pin-screen').classList.add('hidden');
        showToast('Login berhasil!');
        
        // Initialize dashboard data
        await initDashboard();
      }
    } catch (err) {
      // PIN wrong: clear and shake
      state.currentPIN = '';
      updatePinDots();
      
      const pinCard = $('.pin-card');
      pinCard.style.animation = 'shake 0.4s ease';
      showToast(err.message || 'PIN salah!', true);
      
      setTimeout(() => {
        pinCard.style.animation = '';
      }, 4000);
    }
  }

  // ── Dashboard Core Logic ───────────────────
  async function initDashboard() {
    // Show clock update
    updateClock();
    setInterval(updateClock, 1000);

    // Fetch active schedule overrides
    await fetchOverrides();

    // Fetch stats
    await fetchStats();

    // Render calendar
    renderCalendar();

    // Bind Calendar nav
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

    // Bind Admin Action Controls
    setupControlListeners();

    // Bind Logout
    $('#btn-admin-logout').addEventListener('click', () => {
      state.isAuthenticated = false;
      state.adminToken = null;
      localStorage.removeItem('ss_admin_token');
      $('#pin-screen').classList.remove('hidden');
      state.currentPIN = '';
      updatePinDots();
      showToast('Berhasil keluar.');
    });
  }

  function updateClock() {
    const timeSpan = $('#admin-time');
    if (timeSpan) {
      const now = new Date();
      timeSpan.textContent = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
  }

  // ── Overrides Management ───────────────────
  async function fetchOverrides() {
    try {
      const data = await api('/api/admin/overrides');
      state.overrides = data.overrides;
      
      // Build lookup map
      state.overridesMap = {};
      data.overrides.forEach(ov => {
        state.overridesMap[ov.overrideDate] = ov;
      });
      
      renderOverridesList();
    } catch (err) {
      showToast('Gagal memuat daftar libur.', true);
    }
  }

  function renderOverridesList() {
    const container = $('#overrides-list');
    if (state.overrides.length === 0) {
      container.innerHTML = '<div class="no-climbers">Belum ada hari libur atau buka khusus terdaftar.</div>';
      return;
    }

    let html = '';
    state.overrides.forEach(ov => {
      const dateParts = ov.overrideDate.split('-');
      const d = new Date(+dateParts[0], +dateParts[1] - 1, +dateParts[2]);
      const formattedDate = d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      
      const badgeClass = ov.isOpen ? 'badge-open' : 'badge-closed';
      const badgeText = ov.isOpen ? 'BUKA KHUSUS' : 'LIBUR / TUTUP';
      const details = ov.isOpen ? `Template: ${ov.sessionTemplate}` : (ov.note || 'Tidak ada alasan');
      
      html += `
        <div class="override-item">
          <div class="override-item-meta">
            <span class="override-badge ${badgeClass}">${badgeText}</span>
            <strong>${formattedDate}</strong>
            <span style="display:block;font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${details}</span>
          </div>
          <button class="btn btn-ghost btn-sm btn-delete-override" data-date="${ov.overrideDate}" style="padding:6px 12px;color:#f87171;border:1px solid rgba(239, 68, 68, 0.15);">
            Hapus
          </button>
        </div>
      `;
    });

    container.innerHTML = html;

    // Bind delete buttons
    container.querySelectorAll('.btn-delete-override').forEach(btn => {
      btn.addEventListener('click', async () => {
        const date = btn.dataset.date;
        await deleteOverride(date);
      });
    });
  }

  async function deleteOverride(date) {
    try {
      const res = await api(`/api/admin/overrides/${date}`, {
        method: 'DELETE'
      });
      if (res.success) {
        showToast('Berhasil mengembalikan jadwal rutin.');
        await fetchOverrides();
        renderCalendar();
        
        // Refresh selected date detail if deleted
        if (state.selectedDate && dateToStr(state.selectedDate) === date) {
          selectDate(state.selectedDate);
        }
      }
    } catch (err) {
      showToast('Gagal mereset tanggal.', true);
    }
  }

  // ── Stats Dashboard ───────────────────────────
  async function fetchStats() {
    try {
      const data = await api('/api/admin/stats');
      if (data && data.success) {
        const s = data.stats;
        
        // Format currency
        const formatRp = (n) => 'Rp ' + n.toLocaleString('id-ID');
        
        $('#stat-revenue').textContent = formatRp(s.monthlyRevenue);
        $('#stat-revenue-sub').textContent = `Tiket: ${formatRp(s.bookingRevenue)} | Paket: ${formatRp(s.packageRevenue)}`;
        
        $('#stat-members').textContent = `${s.activeMembers} Orang`;
        $('#stat-members-sub').textContent = `${s.totalPackageSales} paket terjual bulan ini`;
        
        $('#stat-visits').textContent = `${s.totalVisits} Sesi`;
        $('#stat-visits-sub').textContent = `Periode: ${s.period}`;
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      const statRevenue = $('#stat-revenue');
      if (statRevenue) statRevenue.textContent = 'Rp 0';
      const statMembers = $('#stat-members');
      if (statMembers) statMembers.textContent = '0 Orang';
      const statVisits = $('#stat-visits');
      if (statVisits) statVisits.textContent = '0 Sesi';
    }
  }

  // ── Calendar Logic (Admin-specific rendering) ──
  function renderCalendar() {
    const title = $('#cal-title');
    const grid = $('#cal-grid');
    title.textContent = `${MONTHS_ID[state.calendarMonth]} ${state.calendarYear}`;

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

      let classes = ['cal-day'];
      if (isPast) classes.push('past');

      // Check overrides
      const override = state.overridesMap[dateStr];
      let isOpen = false;
      let isOverridden = false;

      if (override) {
        isOpen = override.isOpen;
        isOverridden = true;
        classes.push(isOpen ? 'override-open' : 'override-closed');
      } else {
        isOpen = isOpenDay(dow);
        if (!isOpen) classes.push('closed');
        else classes.push('available');
      }

      if (isToday) classes.push('today');
      if (state.selectedDate && dateStr === dateToStr(state.selectedDate)) {
        classes.push('selected');
      }

      let labelText = `${d}`;
      if (isOverridden) {
        if (isOpen) {
          labelText = `<span style="font-size:0.95rem;font-weight:bold;display:block;line-height:1.1;">${d}</span><span style="font-size:0.55rem;display:block;color:#4ade80;font-weight:bold;">Buka</span>`;
        } else {
          labelText = `<span style="font-size:0.95rem;font-weight:bold;display:block;line-height:1.1;">${d}</span><span style="font-size:0.55rem;display:block;color:#f87171;font-weight:bold;">Libur</span>`;
        }
      }

      html += `
        <div class="${classes.join(' ')}" 
             data-date="${dateStr}" 
             role="button" 
             tabindex="0" 
             title="${override ? 'Jadwal Khusus: ' + (override.note || (override.isOpen ? 'Buka khusus' : 'Tutup Toko')) : ''}">
          ${labelText}
        </div>
      `;
    }

    grid.innerHTML = html;

    // Attach click events to grid cells
    grid.querySelectorAll('.cal-day[data-date]').forEach(cell => {
      cell.addEventListener('click', () => {
        const parts = cell.dataset.date.split('-');
        const dateObj = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        selectDate(dateObj);
        
        // Highlight selection
        grid.querySelectorAll('.cal-day').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
      });
    });
  }

  // ── Selected Date Operations ───────────────
  async function selectDate(date) {
    state.selectedDate = date;
    const dateStr = dateToStr(date);

    // Update Date Header
    const formattedDate = formatDateID(date);
    $('#selected-date-title').textContent = formattedDate;

    // Show date controls
    $('#date-controls-box').classList.remove('hidden');

    // Get current status
    const override = state.overridesMap[dateStr];
    const dow = date.getDay();
    const isStandardOpen = isOpenDay(dow);

    let statusText = '';
    if (override) {
      statusText = override.isOpen 
        ? `🔥 Status: <strong>Buka Khusus (Jadwal Khusus)</strong> | ${override.note || ''}`
        : `🛑 Status: <strong>Libur / Tutup Toko</strong> | Alasan: "${override.note || 'Keluar Kota'}"`;
      
      $('#override-note').value = override.note || '';
      if (override.isOpen) {
        $('#template-select-group').classList.remove('hidden');
        $('#session-template').value = override.sessionTemplate || 'weekday';
      } else {
        $('#template-select-group').classList.add('hidden');
      }
    } else {
      statusText = isStandardOpen
        ? `🟢 Status: <strong>Buka Rutin (Jadwal Default)</strong>`
        : `⚪ Status: <strong>Tutup Rutin (Jadwal Default)</strong>`;
      
      $('#override-note').value = '';
      $('#template-select-group').classList.add('hidden');
    }
    
    $('#selected-date-status').innerHTML = statusText;

    // Load attendance list of climbers for selected date
    await loadClimbers(dateStr);
  }

  async function loadClimbers(dateStr) {
    const container = $('#climber-attendance-list');
    container.innerHTML = '<div class="sessions-loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div><span>Memuat absensi climbers...</span></div>';

    try {
      const res = await api(`/api/admin/bookings?date=${dateStr}`);
      state.climbers = res.bookings;

      $('#climber-date-subtitle').textContent = `Daftar customer terdaftar untuk tanggal ${res.bookings.length > 0 ? dateStr : 'terpilih'}. Total: ${res.bookings.length} Orang`;

      if (res.bookings.length === 0) {
        container.innerHTML = '<div class="no-climbers">Belum ada climbers yang membooking pada tanggal ini.</div>';
        return;
      }

      // Group climbers by session
      const sessionsGroup = {};
      res.bookings.forEach(b => {
        if (!sessionsGroup[b.sessionName]) {
          sessionsGroup[b.sessionName] = [];
        }
        sessionsGroup[b.sessionName].push(b);
      });

      let html = '';
      for (const [sessionName, list] of Object.entries(sessionsGroup)) {
        const time = list[0].sessionTime;
        html += `
          <div class="climber-session-group">
            <h4 class="session-group-title">🎯 ${sessionName} (${time})</h4>
            <div class="climber-cards-container">
        `;

        list.forEach(c => {
          const cleanWa = c.whatsapp.replace(/^(\+62|62|0)/, '');
          const waLink = `https://wa.me/62${cleanWa}?text=Halo%20${encodeURIComponent(c.name)},%20ini%20dari%20SS%20Climbing.%20Sesi%20climbing%20kamu%20pada%20tanggal%20${encodeURIComponent(c.bookingDate)}%20sudah%20terdaftar.`;
          
          let addonsHtml = '';
          if (c.addonShoes) addonsHtml += '<span class="addon-pill">👟 Sewa Sepatu</span>';
          if (c.addonChalk) addonsHtml += '<span class="addon-pill">🎒 Sewa Chalk</span>';
          if (!addonsHtml) addonsHtml = '<span class="addon-pill">Tanpa Addons</span>';

          html += `
            <div class="climber-card">
              <div class="climber-details">
                <span class="climber-name">${c.name}</span>
                <span class="climber-wa">📱 +62 ${cleanWa} | ✉️ ${c.email}</span>
                <div class="climber-addons">
                  ${addonsHtml}
                </div>
              </div>
              <a href="${waLink}" target="_blank" class="btn btn-ghost btn-sm btn-action-sm" style="display:flex;align-items:center;gap:4px;border:1px solid rgba(34, 197, 94, 0.2);color:#4ade80;">
                💬 Hubungi
              </a>
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      }

      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<div class="no-climbers">Gagal memuat absensi customer.</div>';
    }
  }

  function setupControlListeners() {
    // Template visibility helper
    $('#btn-set-open').addEventListener('mouseenter', () => {
      const dateStr = dateToStr(state.selectedDate);
      const override = state.overridesMap[dateStr];
      if (!override || !override.isOpen) {
        $('#template-select-group').classList.remove('hidden');
      }
    });

    // Set Tutup / Libur Toko
    $('#btn-set-closed').addEventListener('click', async () => {
      if (!state.selectedDate) return;
      const dateStr = dateToStr(state.selectedDate);
      const note = $('#override-note').value.trim() || 'Keluar Kota';

      try {
        const res = await api('/api/admin/overrides', {
          method: 'POST',
          body: JSON.stringify({
            date: dateStr,
            isOpen: false,
            note: note
          })
        });

        if (res.success) {
          showToast('Toko berhasil diset LIBUR untuk tanggal ini.');
          await fetchOverrides();
          renderCalendar();
          selectDate(state.selectedDate);
        }
      } catch (err) {
        showToast('Gagal merubah jadwal toko.', true);
      }
    });

    // Set Buka Khusus
    $('#btn-set-open').addEventListener('click', async () => {
      if (!state.selectedDate) return;
      const dateStr = dateToStr(state.selectedDate);
      const note = $('#override-note').value.trim() || 'Buka Khusus';
      const template = $('#session-template').value;

      try {
        const res = await api('/api/admin/overrides', {
          method: 'POST',
          body: JSON.stringify({
            date: dateStr,
            isOpen: true,
            note: note,
            sessionTemplate: template
          })
        });

        if (res.success) {
          showToast('Toko berhasil diset BUKA KHUSUS untuk tanggal ini.');
          await fetchOverrides();
          renderCalendar();
          selectDate(state.selectedDate);
        }
      } catch (err) {
        showToast('Gagal merubah jadwal toko.', true);
      }
    });

    // Reset Override (Kembalikan ke Jadwal default)
    $('#btn-reset-override').addEventListener('click', async () => {
      if (!state.selectedDate) return;
      const dateStr = dateToStr(state.selectedDate);
      await deleteOverride(dateStr);
    });
  }

  // ── Initialization ─────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    setupNumpad();

    // Check localStorage auto login
    const savedToken = localStorage.getItem('ss_admin_token');
    if (savedToken) {
      state.isAuthenticated = true;
      state.adminToken = savedToken;
      $('#pin-screen').classList.add('hidden');
      initDashboard();
    }
  });

})();
