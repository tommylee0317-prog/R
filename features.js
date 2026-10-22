/*
 * Extra features layered on script.js (goals, race countdown, backup/restore, PWA).
 * Loaded after script.js: it relies on script.js globals and wraps a few of its functions.
 */
(() => {
  'use strict';

  const GOALS_KEY = id => `runlog-goals-v1-${id}`;
  const FAVS_KEY = id => `runlog-favs-v1-${id}`;
  const MAX_PEOPLE = 50;
  const MAX_RECORDS = 5000;

  const read = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const fmt = value => Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 1 });

  /* ---------- Goals ---------- */
  const getGoal = person => {
    const km = Number(read(GOALS_KEY(person.id), {}).yearKm);
    return km > 0 ? km : 0;
  };

  function yearMileage() {
    const year = String(new Date().getFullYear());
    return records.filter(record => record.date.startsWith(year)).reduce((sum, record) => sum + distanceOf(record), 0);
  }

  function renderGoals() {
    if (!$('#goalCard') || !activePerson) return;
    const goal = getGoal(activePerson);
    const done = yearMileage();
    const percent = goal ? Math.min(100, done / goal * 100) : 0;
    $('#goalProgressBar').style.width = `${percent}%`;
    $('#goalProgressBar').parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));
    $('#goalKmInput').value = goal || '';
    const now = new Date();
    const daysLeft = Math.max(0, Math.ceil((new Date(now.getFullYear(), 11, 31, 23, 59, 59) - now) / 86400000));
    if (!goal) $('#goalSummary').textContent = `今年已完成賽事里程 ${fmt(done)} KM。設定年度目標，追蹤自己的進度。`;
    else if (done >= goal) $('#goalSummary').textContent = `今年已完成 ${fmt(done)} KM，達成 ${fmt(goal)} KM 的年度目標！`;
    else $('#goalSummary').textContent = `今年已完成 ${fmt(done)} / ${fmt(goal)} KM（${Math.floor(percent)}%）。距離年底還有 ${daysLeft} 天，還差 ${fmt(goal - done)} KM。`;
  }

  function saveGoal(event) {
    event.preventDefault();
    if (!activePerson) return;
    const raw = $('#goalKmInput').value.trim();
    const km = Number(raw);
    if (raw && !(km >= 1 && km <= 20000)) {
      showToast('年度目標請輸入 1 到 20000 之間的公里數。');
      return;
    }
    if (!raw) localStorage.removeItem(GOALS_KEY(activePerson.id));
    else write(GOALS_KEY(activePerson.id), { yearKm: Math.round(km * 10) / 10 });
    renderGoals();
    showToast(raw ? '年度目標已儲存。' : '已清除年度目標。');
  }

  /* ---------- Favorite races + countdown ---------- */
  const favKey = race => `${race.date}|${race.name}`;
  const getFavs = person => {
    const list = read(FAVS_KEY(person.id), []);
    return Array.isArray(list) ? list.filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && typeof item.name === 'string') : [];
  };
  const daysUntil = date => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((new Date(`${date}T00:00:00`) - today) / 86400000);
  };
  const safeUrl = url => (/^https?:\/\//i.test(url || '') ? url : '#');

  window.isFavorite = race => Boolean(activePerson) && getFavs(activePerson).some(item => favKey(item) === favKey(race));

  function toggleFavorite(race) {
    if (!activePerson) return false;
    const favs = getFavs(activePerson);
    const exists = favs.some(item => favKey(item) === favKey(race));
    const next = exists
      ? favs.filter(item => favKey(item) !== favKey(race))
      : [...favs, { name: race.name, date: race.date, location: race.location || '', url: race.url || '', mileage: race.mileage || '' }].slice(-200);
    write(FAVS_KEY(activePerson.id), next);
    return !exists;
  }

  function renderCountdown() {
    const list = $('#countdownList');
    if (!list || !activePerson) return;
    const upcoming = getFavs(activePerson).filter(item => daysUntil(item.date) >= 0).sort((a, b) => a.date.localeCompare(b.date));
    list.innerHTML = upcoming.length
      ? upcoming.map(item => {
        const days = daysUntil(item.date);
        const label = days === 0 ? '就是今天！' : days === 1 ? '明天' : `還有 ${days} 天`;
        return `<li class="countdown-item"><div><a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a><small>${formatDate(item.date, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}${item.location ? ` · ${escapeHtml(item.location)}` : ''}</small></div><strong class="countdown-days">${label}</strong><button type="button" class="countdown-remove" data-fav-remove="${escapeHtml(favKey(item))}" aria-label="取消收藏 ${escapeHtml(item.name)}">✕</button></li>`;
      }).join('')
      : '<li class="countdown-empty">到「可參加賽事」按 ☆ 收藏想參加的比賽，這裡會顯示倒數天數。</li>';
  }

  /* ---------- Hook into script.js rendering ---------- */
  const baseRenderAll = window.renderAll;
  window.renderAll = function renderAllWithFeatures() {
    baseRenderAll();
    renderGoals();
    renderCountdown();
  };

  /* ---------- Cleanup when a person is deleted ---------- */
  function cleanupPerson(id) {
    [GOALS_KEY(id), FAVS_KEY(id)].forEach(key => localStorage.removeItem(key));
  }

  const baseDeletePerson = window.deletePerson;
  window.deletePerson = async function deletePersonWithCleanup(personId) {
    const result = await baseDeletePerson(personId);
    if (!people.some(item => item.id === personId)) cleanupPerson(personId);
    return result;
  };
  /* ---------- Mobile navigation: back / home buttons + browser history ---------- */
  const VIEW_IDS = ['dashboard', 'records', 'analytics', 'paceCalculator', 'raceList', 'people'];
  const baseSetView = window.setView;

  function updateNavButtons() {
    const back = $('#navBack');
    if (!back) return;
    const canGoBack = $('#sidebar')?.classList.contains('open') || (history.state?.idx ?? 0) > 0 || activeView !== 'dashboard';
    back.disabled = !canGoBack;
  }

  // Every view change adds a history entry, so the phone's own back button (and swipe-back) steps through views.
  window.setView = function setViewWithHistory(view) {
    baseSetView(view);
    window.scrollTo(0, 0);
    if (history.state?.view !== view) {
      try { history.pushState({ view, idx: (history.state?.idx ?? 0) + 1 }, '', `#${view}`); } catch {}
    }
    updateNavButtons();
  };

  window.addEventListener('popstate', event => {
    if (!VIEW_IDS.includes(event.state?.view)) return;
    baseSetView(event.state.view);
    window.scrollTo(0, 0);
    updateNavButtons();
  });

  function goBack() {
    const sidebar = $('#sidebar');
    if (sidebar?.classList.contains('open')) {
      sidebar.classList.remove('open');
    } else if ($('#raceModal')?.classList.contains('open')) {
      closeModal();
    } else if ((history.state?.idx ?? 0) > 0) {
      history.back();
    } else if (activeView !== 'dashboard') {
      window.setView('dashboard');
    }
    updateNavButtons();
  }

  function goHome() {
    $('#sidebar')?.classList.remove('open');
    if (activeView !== 'dashboard') window.setView('dashboard');
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    updateNavButtons();
  }

  function initNavigation() {
    const hashView = location.hash.slice(1);
    const startView = VIEW_IDS.includes(hashView) ? hashView : 'dashboard';
    try { history.replaceState({ view: startView, idx: 0 }, '', `#${startView}`); } catch {}
    if (startView !== 'dashboard') baseSetView(startView);
    $('#navBack')?.addEventListener('click', goBack);
    $('#navHome')?.addEventListener('click', goHome);
    $('#mobileMenu')?.addEventListener('click', () => setTimeout(updateNavButtons, 0));
    $('.brand')?.addEventListener('click', event => {
      event.preventDefault();
      goHome();
    });
    updateNavButtons();
  }

  /* ---------- Backup / restore (demo build: all data lives in this browser) ---------- */
  const cleanText = (value, max) => String(value ?? '').slice(0, max);

  function sanitizeRecord(item) {
    if (!item || typeof item !== 'object') return null;
    const seconds = Number(item.seconds);
    if (!item.id || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.date)) || !Object.prototype.hasOwnProperty.call(DISTANCES, item.type) || !Number.isFinite(seconds) || seconds <= 0 || seconds > 99999999) return null;
    const clean = {
      id: cleanText(item.id, 80), name: cleanText(item.name, 200).trim(), date: String(item.date), type: String(item.type),
      seconds: Math.round(seconds), location: cleanText(item.location, 200), note: cleanText(item.note, 1000)
    };
    if (!clean.name) return null;
    const km = Number(item.distanceKm);
    if (km > 0 && km <= 1000) clean.distanceKm = km;
    return clean;
  }

  function sanitizeBackup(data) {
    if (!data || data.app !== 'runlog' || !Array.isArray(data.people) || !data.people.length) throw new Error('這不是有效的 RUNLOG 備份檔。');
    const seen = new Set();
    const incoming = data.people.slice(0, MAX_PEOPLE).map(person => {
      const id = String(person?.id ?? '').replace(/\D/g, '').slice(0, 9);
      const name = cleanText(person?.name, 30).trim();
      if (!id || !name || seen.has(id)) return null;
      seen.add(id);
      const goal = Number(person.goals?.yearKm);
      const favs = Array.isArray(person.favorites) ? person.favorites.filter(item => item && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date)) && item.name).slice(0, 200).map(item => ({
        name: cleanText(item.name, 200), date: String(item.date), location: cleanText(item.location, 200), url: safeUrl(String(item.url || '')) === '#' ? '' : cleanText(item.url, 500), mileage: cleanText(item.mileage, 200)
      })) : [];
      return {
        id, name, goal: goal > 0 && goal <= 20000 ? goal : 0, favs,
        records: (Array.isArray(person.records) ? person.records.slice(0, MAX_RECORDS) : []).map(sanitizeRecord).filter(Boolean)
      };
    }).filter(Boolean);
    if (!incoming.length) throw new Error('備份檔裡沒有可用的人員資料。');
    return { incoming, activeId: String(data.activePersonId ?? '') };
  }

  async function exportBackup() {
    const message = $('#backupMessage');
    message.textContent = '';
    const exported = people.map(person => ({
      id: person.id, name: person.name,
      records: person.id === activePerson?.id ? records : loadRecords(personStorageKey(person), isDefaultPerson(person)),
      goals: { yearKm: getGoal(person) }, favorites: getFavs(person)
    }));
    if (!exported.length) {
      message.textContent = '沒有可匯出的人員。';
      return;
    }
    const payload = { app: 'runlog', version: 1, exportedAt: new Date().toISOString(), activePersonId: activePerson?.id || '', people: exported };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    link.download = `RUNLOG-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.textContent = `已匯出 ${exported.length} 位人員的完整備份。`;
  }

  async function importBackup(file) {
    const message = $('#backupMessage');
    message.textContent = '';
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('檔案太大，無法匯入。');
      const { incoming, activeId } = sanitizeBackup(JSON.parse(await file.text()));
      const total = incoming.reduce((sum, person) => sum + person.records.length, 0);
      if (!confirm(`備份檔含 ${incoming.length} 位人員、${total} 筆賽事紀錄。\n匯入會取代這個瀏覽器目前的所有資料，確定嗎？`)) return;
      people.forEach(person => {
        localStorage.removeItem(personStorageKey(person));
        cleanupPerson(person.id);
      });
      write(DEMO_PEOPLE_KEY, incoming.map(({ id, name }) => ({ id, name })));
      incoming.forEach(person => {
        write(personStorageKey(person), person.records);
        if (person.goal) write(GOALS_KEY(person.id), { yearKm: person.goal });
        if (person.favs.length) write(FAVS_KEY(person.id), person.favs);
      });
      try { localStorage.setItem(ACTIVE_PERSON_KEY, incoming.some(person => person.id === activeId) ? activeId : incoming[0].id); } catch {}
      message.textContent = '匯入完成，正在重新載入…';
      setTimeout(() => location.reload(), 600);
    } catch (error) {
      message.textContent = error instanceof SyntaxError ? '檔案不是有效的 JSON。' : error.message || '匯入失敗。';
    } finally {
      $('#backupFile').value = '';
    }
  }

  /* ---------- PWA ---------- */
  let installPrompt = null;
  function showInstallButton() {
    if ($('.install-app') || !installPrompt) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button-outline install-app';
    button.textContent = '＋ 安裝 App';
    button.addEventListener('click', async () => {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      button.remove();
    });
    $('.sidebar-bottom')?.insertBefore(button, $('.sidebar-credit'));
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    showInstallButton();
  });
  window.addEventListener('appinstalled', () => $('.install-app')?.remove());

  /* ---------- Wire up the DOM ---------- */
  function init() {
    initNavigation();
    $('#goalForm')?.addEventListener('submit', saveGoal);

    $('#countdownList')?.addEventListener('click', event => {
      const button = event.target.closest('[data-fav-remove]');
      if (!button || !activePerson) return;
      write(FAVS_KEY(activePerson.id), getFavs(activePerson).filter(item => favKey(item) !== button.dataset.favRemove));
      renderCountdown();
      $$('#raceListBody [data-fav]').forEach(star => {
        if (star.dataset.fav === button.dataset.favRemove) setStar(star, false);
      });
    });

    const setStar = (button, on) => {
      button.setAttribute('aria-pressed', String(on));
      button.textContent = on ? '★' : '☆';
    };
    $('#raceListBody')?.addEventListener('click', event => {
      const button = event.target.closest('[data-fav]');
      if (!button) return;
      const race = sourceRaces.find(item => favKey(item) === button.dataset.fav);
      if (!race) return;
      if (!activePerson) {
        showToast('請先選擇人員，才能收藏賽事。');
        return;
      }
      const on = toggleFavorite(race);
      setStar(button, on);
      renderCountdown();
      showToast(on ? `已收藏「${race.name}」，可在總覽看到倒數天數。` : `已取消收藏「${race.name}」。`);
    });

    if (DEMO_MODE) {
      $('#backupCard')?.removeAttribute('hidden');
      $('#backupExport')?.addEventListener('click', exportBackup);
      $('#backupImport')?.addEventListener('click', () => $('#backupFile').click());
      $('#backupFile')?.addEventListener('change', event => importBackup(event.target.files?.[0]));
    }

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
