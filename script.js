const STORAGE_KEY = 'runlog-records-v1';
const THEME_KEY = 'runlog-theme-v1';
const ACTIVE_PERSON_KEY = 'runlog-active-person-v1';
const RACE_SOURCE_STORAGE_KEY = 'runlog-race-source-v3';
const DISTANCES = { full: 42.195, half: 21.0975, '10k': 10, '5k': 5, ultra: 50, other: 1 };
const TYPE_LABELS = { full: '全馬', half: '半馬', '10k': '10K', '5k': '5K', ultra: '超馬', other: '其他距離' };
// Ultra / other races carry their own distanceKm; the DISTANCES value is only a fallback.
const distanceOf = record => (Number(record?.distanceKm) > 0 ? Number(record.distanceKm) : DISTANCES[record?.type] || 0);
const typeChipClass = type => (type === 'full' || type === 'half' ? type : 'other');
const typeLabel = record => `${TYPE_LABELS[record.type] || '其他距離'} · ${Number(distanceOf(record).toFixed(4))} KM`;
// Demo build (GitHub Pages): no Tomcat/Oracle, so the API is emulated in the browser's localStorage.
const DEMO_MODE = Boolean(document.querySelector('meta[name="runlog-demo"]')) || location.hostname.endsWith('.github.io');
const STORE_LABEL = DEMO_MODE ? '瀏覽器（展示版）' : 'Oracle';
const DEMO_PEOPLE_KEY = 'runlog-demo-people-v1';
// Live: Tomcat proxies both upstream sites. Demo (static): a GitHub Action refreshes data-*.html copies every few hours.
const RACE_SOURCE_URLS = DEMO_MODE
  ? { taipei: () => 'data-contest.html', ctrra: year => `data-ctrra-${year}.html` }
  : { taipei: () => 'api/contests', ctrra: year => `api/contests?source=ctrra&year=${year}` };
const RACE_SOURCE_LABELS = { taipei: '跑者廣場', ctrra: '路協' };
const RACE_REFRESH_MS = 15 * 60 * 1000;
const KNOWN_RACE_FALLBACK = Array.isArray(window.RACE_SNAPSHOT) ? window.RACE_SNAPSHOT : [];
let records = loadRecords();
let people = [];
let activePerson = null;
let activeView = 'dashboard';
let activeFilter = 'all';
let sourceRaces = [];
let raceListLoaded = false;
let raceListLoadedAt = 0;
let raceListLoading = false;
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadRecords(storageKey = STORAGE_KEY, useEmbedded = true) {
  try {
    const stored = localStorage.getItem(storageKey);
    const embedded = useEmbedded ? document.getElementById('initialRaceData')?.textContent : null;
    const parsed = JSON.parse(stored || embedded || '[]');
    const valid = Array.isArray(parsed) ? parsed.filter(item => item && item.id && item.date && DISTANCES[item.type] && Number.isFinite(Number(item.seconds)) && Number(item.seconds) > 0) : [];
    if (!stored && valid.length) localStorage.setItem(storageKey, JSON.stringify(valid));
    return valid;
  } catch (error) {
    console.warn('無法讀取 RUNLOG 紀錄：', error);
    return [];
  }
}

const isDefaultPerson = person => person?.id === '1';

function personStorageKey(person) {
  return isDefaultPerson(person)
    ? STORAGE_KEY
    : `${STORAGE_KEY}-person-${person?.id || 'unknown'}`;
}

function saveLocalRecords() {
  if (!activePerson) return;
  try { localStorage.setItem(personStorageKey(activePerson), JSON.stringify(records)); } catch {}
}

function racesApiPath(id = '') {
  if (!activePerson) throw new Error('尚未選擇人員，請先在左下角選擇或新增人員。');
  const path = id ? `/${encodeURIComponent(id)}` : '';
  return `${path}?personId=${encodeURIComponent(activePerson.id)}`;
}

function updatePersonPresentation() {
  if (!activePerson) return;
  const name = activePerson.name;
  const upperName = name.toLocaleUpperCase();
  $('#profileName').textContent = name;
  $('#profileAvatar').textContent = [...name][0] || '?';
  $('#journalEyebrow').textContent = `${upperName}'S RUNNING JOURNAL`;
  $('#welcomeHeading').textContent = `${name}，繼續向前。`;
  $('#challengeKicker').textContent = `${upperName}'S MARATHON CHALLENGE`;
  $('#heroIndex').textContent = `${upperName} · ${new Date().getFullYear()}`;
  document.title = `RUNLOG｜${name}的賽事成績`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function formatTime(totalSeconds, includeHours = true) {
  const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;
  return includeHours || hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatPace(seconds, type) {
  return formatTime(Number(seconds) / (typeof type === 'object' ? distanceOf(type) : DISTANCES[type]), false);
}

function formatDate(dateString, options = { year: 'numeric', month: 'short', day: 'numeric' }) {
  if (!dateString) return '—';
  const date = new Date(`${dateString}T12:00:00`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-TW', options).format(date);
}

function sortedRecords(list = records) {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || Number(b.seconds) - Number(a.seconds));
}

function setView(view) {
  activeView = view;
  $$('.view').forEach(section => section.classList.toggle('active', section.id === `${view}View`));
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  const titles = { dashboard: '總覽', records: '賽事紀錄', analytics: '成績分析', paceCalculator: '配速計算器', raceList: '可參加賽事', people: '人員管理' };
  $('#breadcrumbCurrent').textContent = titles[view] || titles.dashboard;
  $('#sidebar').classList.remove('open');
  if (view === 'analytics') renderAnalytics();
  if (view === 'records') renderRecords();
  if (view === 'raceList' && raceListLoaded && Date.now() - raceListLoadedAt > RACE_REFRESH_MS) loadRaceSource(true);
}

function parseContestRows(markup) {
  const sourceDocument = new DOMParser().parseFromString(markup, 'text/html');
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  let inferredYear = today.getFullYear();
  let previousMonth = 0;
  const races = [];

  sourceDocument.querySelectorAll('tr').forEach(row => {
    const cells = [...row.cells];
    const link = cells[1]?.querySelector('a') || cells.map(cell => cell.querySelector('a')).find(anchor => anchor?.textContent.trim());
    const dateCell = cells[3]?.textContent.match(/\b\d{1,2}\s*\/\s*\d{1,2}\b/)
      ? cells[3]
      : cells.find(cell => /\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(cell.textContent));
    const dateText = dateCell?.textContent.trim() || '';
    const dateMatch = dateText.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    const name = link?.textContent.replace(/\s+/g, ' ').trim() || '';
    if (!name || !dateMatch || cells.length < 6) return;

    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    if (month < previousMonth) inferredYear++;
    previousMonth = month;
    const explicitYear = name.match(/\b(20\d{2})\b/);
    const rocYear = name.match(/\b(1\d{2})\s*年/);
    const namedYear = explicitYear ? Number(explicitYear[1]) : rocYear ? Number(rocYear[1]) + 1911 : 0;
    if (namedYear > inferredYear) inferredYear = namedYear;
    const year = inferredYear;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date < todayKey) return;

    let url = link.getAttribute('href') || link.href;
    try {
      const parsedUrl = new URL(url, 'http://www.taipeimarathon.org.tw/contest.aspx');
      url = ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : 'http://www.taipeimarathon.org.tw/contest.aspx';
    } catch {
      url = 'http://www.taipeimarathon.org.tw/contest.aspx';
    }
    const location = cells[4]?.textContent.replace(/\s+/g, ' ').trim() || '';
    const mileageCell = cells[5];
    const mileageLabels = [...(mileageCell?.querySelectorAll('.ui-button-text, button') || [])]
      .map(item => item.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const mileage = mileageLabels.length
      ? [...new Set(mileageLabels)].join('、')
      : mileageCell?.textContent.replace(/\s+/g, ' ').trim() || '';
    races.push({
      name, date,
      location,
      mileage, url,
      source: 'taipei'
    });
  });
  return [...new Map(races.map(race => [`${race.date}|${race.name}`, race])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'zh-TW'));
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Parses the CTRRA (sportsnet.org.tw) calendar. Rows are [logo, no., "M/D(週)", name link, location, categories]; the year comes from the page requested.
function parseCtrraRows(markup, year) {
  const pageUrl = 'https://www.sportsnet.org.tw/schedule.php';
  const sourceDocument = new DOMParser().parseFromString(markup, 'text/html');
  const todayKey = localDateKey(new Date());
  const races = [];
  sourceDocument.querySelectorAll('table.races tr').forEach(row => {
    const cells = [...row.cells];
    if (cells.length < 6) return;
    const dateMatch = cells[2].textContent.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    const link = cells[3].querySelector('a');
    const name = (link || cells[3]).textContent.replace(/\s+/g, ' ').trim();
    if (!name || !dateMatch) return;
    const month = Number(dateMatch[1]);
    const day = Number(dateMatch[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (date < todayKey) return;
    let url = pageUrl;
    try {
      const parsedUrl = new URL(link?.getAttribute('href') || pageUrl, pageUrl);
      if (['http:', 'https:'].includes(parsedUrl.protocol)) url = parsedUrl.href;
    } catch {}
    races.push({
      name, date, url, source: 'ctrra',
      location: cells[4].textContent.replace(/\s+/g, ' ').trim(),
      mileage: cells[5].textContent.replace(/\s+/g, ' ').trim().replace(/\s*\/\s*/g, '、')
    });
  });
  return races;
}

function mergeRaces(...lists) {
  return [...new Map(lists.flat().map(race => [`${race.date}|${race.name}`, race])).values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'zh-TW'));
}

function renderRaceList() {
  const body = $('#raceListBody');
  if (!body) return;
  const selectedYear = $('#raceYearSelect')?.value || '';
  const monthSelect = $('#raceMonthSelect');
  const selectedMonth = monthSelect?.value || '';
  const monthRaces = sourceRaces.filter(race =>
    (!selectedYear || race.date.startsWith(`${selectedYear}-`))
    && (selectedMonth === 'all' || !selectedMonth || race.date.slice(5, 7) === selectedMonth)
  );
  $('#raceListCount').textContent = `${monthRaces.length} 場未來賽事`;
  $('#raceListMonthLabel').textContent = selectedYear
    ? `顯示 ${selectedYear}年${selectedMonth === 'all' ? '全部月份' : `${Number(selectedMonth)}月`}的未來賽事`
    : '顯示所有尚未舉行的賽事';
  body.innerHTML = monthRaces.length
    ? monthRaces.map(race => `
      <tr>
        <td data-label="賽事名稱"><a class="race-table-link" href="${escapeHtml(race.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(race.name)} <span aria-hidden="true">↗</span></a>${RACE_SOURCE_LABELS[race.source] ? ` <span class="race-source-tag">${RACE_SOURCE_LABELS[race.source]}</span>` : ''}</td>
        <td data-label="日期">${formatDate(race.date, { calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })}</td>
        <td data-label="地點">${escapeHtml(race.location || '—')}</td>
        <td data-label="里程">${escapeHtml(race.mileage || '—')}</td>
        <td data-label="收藏"><button type="button" class="fav-button" data-fav="${escapeHtml(`${race.date}|${race.name}`)}" aria-pressed="${typeof isFavorite === 'function' && isFavorite(race)}" aria-label="收藏 ${escapeHtml(race.name)}">${typeof isFavorite === 'function' && isFavorite(race) ? '★' : '☆'}</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="race-table-empty">這個月份目前沒有未來賽事，請選擇其他年月或查看跑者廣場。</td></tr>';
}

function getRaceMonthOptions(races) {
  const now = new Date();
  const months = new Set(races.map(race => race.date.slice(0, 7)));
  for (let offset = 0; offset < 24; offset++) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    months.add(`${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`);
  }
  return [...months].sort();
}

function setRaceMonthOptions(races, previousYear = '', previousMonth = '') {
  const yearSelect = $('#raceYearSelect');
  const monthSelect = $('#raceMonthSelect');
  const years = [...new Set(getRaceMonthOptions(races).map(value => value.slice(0, 4)))].sort();
  yearSelect.innerHTML = years.map(year => `<option value="${year}">${year}年</option>`).join('');
  monthSelect.innerHTML = '<option value="all">全部月份</option>'
    + Array.from({ length: 12 }, (_, index) => `<option value="${String(index + 1).padStart(2, '0')}">${index + 1}月</option>`).join('');
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  yearSelect.value = years.includes(previousYear) ? previousYear : currentYear;
  monthSelect.value = [...monthSelect.options].some(option => option.value === previousMonth) ? previousMonth : currentMonth;
  yearSelect.disabled = false;
  monthSelect.disabled = false;
}

async function loadRaceSource(force = false) {
  if (raceListLoading || (raceListLoaded && !force)) return;
  raceListLoading = true;
  const status = $('#raceListStatus');
  const yearSelect = $('#raceYearSelect');
  const monthSelect = $('#raceMonthSelect');
  const previousYear = yearSelect.value;
  const previousMonth = monthSelect.value;
  status.textContent = '正在同步跑者廣場與路協賽事…';
  yearSelect.disabled = true;
  monthSelect.disabled = true;
  try {
    const thisYear = new Date().getFullYear();
    const fetchSource = async path => {
      const response = await fetch(new URL(path, document.baseURI), { headers: { Accept: 'text/html' }, cache: 'no-cache' });
      if (!response.ok) throw new Error(`來源回應 HTTP ${response.status}`);
      return response.text();
    };
    const [taipeiResult, ...ctrraResults] = await Promise.allSettled([
      fetchSource(RACE_SOURCE_URLS.taipei()).then(parseContestRows),
      ...[thisYear, thisYear + 1].map(year => fetchSource(RACE_SOURCE_URLS.ctrra(year)).then(markup => parseCtrraRows(markup, year)))
    ]);
    const taipeiRaces = taipeiResult.status === 'fulfilled' ? taipeiResult.value : null;
    const ctrraOk = ctrraResults.some(result => result.status === 'fulfilled');
    const ctrraRaces = ctrraOk ? ctrraResults.flatMap(result => (result.status === 'fulfilled' ? result.value : [])) : null;
    if (!taipeiRaces && !ctrraRaces) throw taipeiResult.reason || ctrraResults[0].reason;
    const races = mergeRaces(taipeiRaces || [], ctrraRaces || []);
    sourceRaces = races;
    try { localStorage.setItem(RACE_SOURCE_STORAGE_KEY, JSON.stringify(races)); } catch {}
    raceListLoaded = true;
    raceListLoadedAt = Date.now();
    setRaceMonthOptions(races, previousYear, previousMonth);
    const detail = `跑者廣場 ${taipeiRaces ? `${taipeiRaces.length} 場` : '同步失敗'}、路協 ${ctrraRaces ? `${ctrraRaces.length} 場` : '同步失敗'}`;
    status.textContent = races.length
      ? `已同步 ${races.length} 場未來賽事（${detail}）· ${new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit' }).format(new Date())} 更新`
      : `同步完成，目前沒有未來賽事（${detail}）`;
    renderRaceList();
  } catch (error) {
    console.error('讀取賽事來源失敗：', error);
    const localToday = new Date();
    const today = localDateKey(localToday);
    let cachedRaces = [];
    try {
      const stored = JSON.parse(localStorage.getItem(RACE_SOURCE_STORAGE_KEY) || '[]');
      if (Array.isArray(stored)) {
        cachedRaces = stored.filter(race => race && race.date >= today).map(race => ({
          name: race.name, date: race.date, location: race.location || '',
          mileage: race.mileage || race.eventCategory || race.distances?.join('、') || '',
          url: race.url || 'http://www.taipeimarathon.org.tw/contest.aspx',
          source: race.source
        }));
      }
    } catch {}
    const availableFallbacks = KNOWN_RACE_FALLBACK.filter(race => race.date >= today);
    const fallbackByRace = new Map();
    [...cachedRaces, ...availableFallbacks].forEach(race => {
      fallbackByRace.set(`${race.date}|${race.name}`, race);
    });
    const fallbackRaces = [...fallbackByRace.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (fallbackRaces.length) {
      sourceRaces = fallbackRaces;
      raceListLoaded = true;
      setRaceMonthOptions(fallbackRaces, previousYear, previousMonth);
      status.textContent = '賽事來源暫時無法同步，顯示暫存賽事；活動資訊請以官方公告為準';
      renderRaceList();
    } else {
      yearSelect.disabled = false;
      monthSelect.disabled = false;
      status.textContent = `無法同步賽事：${error.message}`;
      $('#raceListCount').textContent = '暫無資料';
      $('#raceListBody').innerHTML = '<tr><td colspan="5" class="race-table-empty">無法載入賽事資料。請稍後重新整理，或前往跑者廣場查看最新賽會。</td></tr>';
    }
  } finally {
    raceListLoading = false;
  }
}

function calculatePace() {
  const distance = Number($('#paceDistance').value);
  const hours = Number($('#paceHours').value || 0);
  const minutes = Number($('#paceMinutes').value || 0);
  const seconds = Number($('#paceSeconds').value || 0);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const error = $('#paceCalculatorError');
  if (!Number.isFinite(distance) || distance <= 0 || totalSeconds <= 0) {
    error.textContent = totalSeconds <= 0 ? '請輸入大於 0 的完賽時間。' : '請輸入有效的跑步距離。';
    return false;
  }
  error.textContent = '';
  const exactPaceSeconds = totalSeconds / distance;
  const paceSeconds = Math.round(exactPaceSeconds);
  const paceMinutes = Math.floor(paceSeconds / 60);
  const paceRemainder = paceSeconds % 60;
  $('#paceResult').textContent = `${String(paceMinutes).padStart(2, '0')}:${String(paceRemainder).padStart(2, '0')}`;
  $('#paceSpeedResult').textContent = (distance / (totalSeconds / 3600)).toFixed(1);
  const projections = [
    { label: '5K', distance: 5 },
    { label: '10K', distance: 10 },
    { label: '半馬', distance: DISTANCES.half },
    { label: '全馬', distance: DISTANCES.full }
  ];
  $('#paceProjections').innerHTML = projections.map(item => `
    <div class="pace-projection-item"><span>${item.label}</span><strong>${formatTime(Math.round(exactPaceSeconds * item.distance))}</strong></div>
  `).join('');
  return true;
}

function setApiStatus(message, state = '') {
  const status = $('#apiStatus');
  if (!status) return;
  status.textContent = message;
  if (state) status.dataset.state = state;
  else delete status.dataset.state;
}

function demoPeople() {
  try {
    const stored = JSON.parse(localStorage.getItem(DEMO_PEOPLE_KEY) || 'null');
    if (Array.isArray(stored) && stored.length) return stored;
  } catch {}
  return [{ id: '1', name: 'Tommy' }];
}

// Emulates api/races for the static demo. Race lists live in localStorage via saveLocalRecords(), so only people need storing here.
async function demoApiRequest(path, options) {
  const [pathname, query = ''] = path.split('?');
  const method = (options.method || 'GET').toUpperCase();
  const params = new URLSearchParams(query);
  const newId = () => `demo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  if (pathname === '/people' || /^\/people\/\d+$/.test(pathname)) {
    const list = demoPeople();
    if (method === 'GET') return list;
    const target = pathname === '/people' ? null : list.find(item => item.id === pathname.split('/')[2]);
    if (pathname !== '/people' && !target) throw new Error('找不到指定的人員。');
    if (method === 'DELETE') {
      if (list.length <= 1) throw new Error('至少需要保留一位人員，無法刪除。');
      localStorage.setItem(DEMO_PEOPLE_KEY, JSON.stringify(list.filter(item => item !== target)));
      return { id: target.id };
    }
    const name = String(JSON.parse(options.body || '{}').name || '').trim();
    if (!name || name.length > 30) throw new Error('人員名稱為必填，且不可超過 30 個字元。');
    if (list.some(person => person !== target && person.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('已有相同名稱的人員。');
    if (target) {
      const renamed = { ...target, name };
      localStorage.setItem(DEMO_PEOPLE_KEY, JSON.stringify(list.map(item => (item === target ? renamed : item))));
      return renamed;
    }
    const person = { id: String(Math.max(0, ...list.map(item => Number(item.id) || 0)) + 1), name };
    localStorage.setItem(DEMO_PEOPLE_KEY, JSON.stringify([...list, person]));
    return person;
  }
  const person = demoPeople().find(item => item.id === params.get('personId'));
  if (!person) throw new Error('找不到指定的人員。');
  const id = pathname.replace(/^\//, '');
  if (method === 'GET') return loadRecords(personStorageKey(person), isDefaultPerson(person));
  if (method === 'DELETE') return null;
  const body = JSON.parse(options.body || '{}');
  if (method === 'PUT') return { ...body, id };
  return Array.isArray(body) ? body.map(item => ({ ...item, id: newId() })) : { ...body, id: newId() };
}

async function apiRequest(path = '', options = {}) {
  if (DEMO_MODE) return demoApiRequest(path, options);
  const baseUrl = new URL('api/races', document.baseURI);
  const requestUrl = new URL(`${baseUrl}${path}`);
  if (!['http:', 'https:'].includes(requestUrl.protocol)) {
    throw new Error(`目前頁面使用 ${requestUrl.protocol} 開啟，無法呼叫 RUN API；請透過 Tomcat 的 http(s) 網址開啟。`);
  }
  let response;
  try {
    response = await fetch(requestUrl, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
  } catch (error) {
    throw new Error(`無法連線至 ${requestUrl.href}。請確認 RUN 網頁與 Servlet 已部署至 Tomcat，且瀏覽器可連線到此網址。`);
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(`API 回傳非 JSON 資料（HTTP ${response.status}）。請確認已部署 RUN Servlet。`);
  }
  if (!response.ok || !result.success) {
    if (path === '/people' && (response.status === 400 || response.status === 404)
      && ['賽事 ID 格式錯誤。', 'API 路徑不存在。'].includes(result.message)) {
      throw new Error('RUN 後端仍是舊版，尚未部署新增人員 API；請重新部署更新後的 RUN 專案。');
    }
    throw new Error(result.message || `API 請求失敗（HTTP ${response.status}）。`);
  }
  return result.data;
}

async function loadRacesFromDatabase() {
  const requestedPerson = activePerson;
  if (!requestedPerson) return;
  setApiStatus(`正在連線 ${STORE_LABEL}…`, 'syncing');
  try {
    const data = await apiRequest(`?personId=${encodeURIComponent(requestedPerson.id)}`);
    if (activePerson?.id !== requestedPerson.id) return;
    records.splice(0, records.length, ...data.map(record => ({ ...record, id: String(record.id) })));
    saveLocalRecords();
    renderAll();
    setApiStatus(`已連線 ${STORE_LABEL} · ${requestedPerson.name} · 全馬 ${records.filter(record => record.type === 'full').length} 場／半馬 ${records.filter(record => record.type === 'half').length} 場`, 'connected');
  } catch (error) {
    if (activePerson?.id !== requestedPerson.id) return;
    console.error('讀取 Oracle 賽事資料失敗：', error);
    setApiStatus(`${STORE_LABEL} 尚未連線：${error.message}`, 'error');
  }
}

async function loadPeopleFromDatabase() {
  const selector = $('#personSelect');
  try {
    people = await apiRequest('/people');
    selector.innerHTML = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
    selector.disabled = people.length === 0;
    renderPeople();
    if (!people.length) {
      selector.innerHTML = '<option value="">尚無人員</option>';
      setApiStatus('人員清單是空的，請先新增人員。', 'error');
      return;
    }
    const savedPersonId = localStorage.getItem(ACTIVE_PERSON_KEY);
    const selected = people.find(person => person.id === savedPersonId)
      || people.find(person => person.name.toLocaleLowerCase() === 'tommy')
      || people[0];
    selector.value = selected.id;
    await selectPerson(selected);
  } catch (error) {
    selector.disabled = true;
    selector.innerHTML = '<option value="">無法載入人員</option>';
    console.error('讀取 Oracle 人員清單失敗：', error);
    setApiStatus(`人員清單尚未連線：${error.message}`, 'error');
  }
}

async function selectPerson(person) {
  if (!person || activePerson?.id === person.id) return;
  activePerson = person;
  $('#personSelect').value = person.id;
  renderPeople();
  try { localStorage.setItem(ACTIVE_PERSON_KEY, person.id); } catch {}
  records = loadRecords(personStorageKey(person), isDefaultPerson(person));
  updatePersonPresentation();
  renderAll();
  await loadRacesFromDatabase();
}

function renderPeople() {
  const list = $('#peopleList');
  const select = $('#pmPersonSelect');
  if (!list || !select) return;
  const options = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
  select.innerHTML = options || '<option value="">尚無人員</option>';
  select.disabled = !people.length;
  if (activePerson) select.value = activePerson.id;
  list.innerHTML = people.length
    ? people.map(person => {
      const active = activePerson?.id === person.id;
      const actions = `<button type="button" class="button button-outline people-action" data-rename-person="${escapeHtml(person.id)}" aria-label="修改 ${escapeHtml(person.name)}">改名</button><button type="button" class="button button-outline people-action people-delete" data-delete-person="${escapeHtml(person.id)}" aria-label="刪除 ${escapeHtml(person.name)}"${people.length <= 1 ? ' disabled title="至少需要保留一位人員"' : ''}>刪除</button>`;
      return `<li class="people-item${active ? ' active' : ''}"><span class="avatar">${escapeHtml([...person.name][0] || '?')}</span><strong>${escapeHtml(person.name)}</strong>${active ? '<span class="people-badge">目前使用中</span>' : `<button type="button" class="button button-outline people-switch" data-person-id="${escapeHtml(person.id)}">切換</button>`}${actions}</li>`;
    }).join('')
    : '<li class="people-empty">尚無人員，請先新增。</li>';
  $('#peopleRaceTitle').textContent = activePerson ? `替 ${activePerson.name} 新增賽事紀錄` : '新增賽事紀錄';
  $('#pmRecordCount').textContent = activePerson ? `${activePerson.name} 目前共有 ${records.length} 筆賽事紀錄。` : '';
}

function openPeopleView() {
  setView('people');
  setTimeout(() => $('#personNameInput')?.focus(), 50);
}

function refreshPersonSelector() {
  const selector = $('#personSelect');
  selector.innerHTML = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
  selector.disabled = people.length === 0;
  if (activePerson) selector.value = activePerson.id;
}

async function renamePerson(personId) {
  const person = people.find(item => item.id === personId);
  if (!person) return;
  const input = prompt('修改人員名稱：', person.name);
  const name = input?.trim();
  if (!name || name === person.name) return;
  try {
    const saved = await apiRequest(`/people/${encodeURIComponent(person.id)}`, { method: 'PUT', body: JSON.stringify({ name }) });
    Object.assign(person, { name: saved.name });
    refreshPersonSelector();
    if (activePerson?.id === person.id) updatePersonPresentation();
    renderPeople();
    showToast(`已將人員改名為「${saved.name}」。`);
  } catch (error) {
    showToast(error.message || '修改人員失敗，請稍後再試。');
  }
}

async function deletePerson(personId) {
  const person = people.find(item => item.id === personId);
  if (!person) return;
  if (people.length <= 1) {
    showToast('至少需要保留一位人員，無法刪除。');
    return;
  }
  if (!confirm(`確定刪除「${person.name}」嗎？\n這位人員的所有賽事紀錄也會一併刪除，且無法復原。`)) return;
  try {
    await apiRequest(`/people/${encodeURIComponent(person.id)}`, { method: 'DELETE' });
    try { localStorage.removeItem(personStorageKey(person)); } catch {}
    people = people.filter(item => item.id !== person.id);
    const wasActive = activePerson?.id === person.id;
    if (wasActive) {
      activePerson = null;
      records = [];
    }
    refreshPersonSelector();
    renderPeople();
    showToast(`已刪除「${person.name}」及其賽事紀錄。`);
    if (wasActive) {
      const next = people.find(item => isDefaultPerson(item)) || people[0];
      await selectPerson(next);
    }
  } catch (error) {
    showToast(error.message || '刪除人員失敗，請稍後再試。');
  }
}

async function savePerson(event) {
  event.preventDefault();
  const name = $('#personNameInput').value.trim();
  if (!name) {
    $('#personFormError').textContent = '請輸入人員姓名或暱稱。';
    return;
  }
  const button = $('#savePersonButton');
  button.disabled = true;
  $('#personFormError').textContent = '';
  try {
    const person = await apiRequest('/people', { method: 'POST', body: JSON.stringify({ name }) });
    people.push(person);
    $('#personSelect').insertAdjacentHTML('beforeend', `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`);
    $('#personSelect').disabled = false;
    $('#personForm').reset();
    await selectPerson(person);
    showToast(`已新增 ${person.name}，請在右側記錄個人賽事。`);
    setTimeout(() => $('#pmRaceName')?.focus(), 50);
  } catch (error) {
    $('#personFormError').textContent = error.message || '新增人員失敗，請稍後再試。';
  } finally {
    button.disabled = false;
  }
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function updateDashboard() {
  const full = records.filter(record => record.type === 'full');
  const half = records.filter(record => record.type === 'half');
  const best = list => [...list].sort((a, b) => Number(a.seconds) - Number(b.seconds))[0];
  const fullBest = best(full);
  const halfBest = best(half);
  $('#fullCount').textContent = full.length;
  $('#halfCount').textContent = half.length;
  $('#totalDistance').textContent = records.reduce((sum, record) => sum + distanceOf(record), 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
  $('#fullPbTime').textContent = fullBest ? formatTime(fullBest.seconds) : '--:--:--';
  $('#halfPbTime').textContent = halfBest ? formatTime(halfBest.seconds) : '--:--:--';
  $('#fullPbMeta').textContent = fullBest ? `${escapeHtml(fullBest.name)} · ${formatDate(fullBest.date)}` : '尚無完賽紀錄';
  $('#halfPbMeta').textContent = halfBest ? `${escapeHtml(halfBest.name)} · ${formatDate(halfBest.date)}` : '尚無完賽紀錄';
  const otherPbRow = $('#otherPbRow');
  if (otherPbRow) {
    const groups = ['10k', '5k', 'ultra', 'other'].map(type => ({ type, list: records.filter(record => record.type === type) })).filter(group => group.list.length);
    otherPbRow.hidden = !groups.length;
    otherPbRow.innerHTML = groups.map(group => {
      const top = [...group.list].sort((a, b) => Number(a.seconds) / distanceOf(a) - Number(b.seconds) / distanceOf(b))[0];
      return `<div class="other-pb-item"><span>${escapeHtml(TYPE_LABELS[group.type])} 最佳</span><strong>${formatTime(top.seconds)}</strong><small>${escapeHtml(top.name)} · ${formatDate(top.date)}</small></div>`;
    }).join('');
  }
  const recent = sortedRecords().slice(0, 4);
  $('#recentRaces').innerHTML = recent.length ? recent.map(record => `
    <div class="recent-row">
      <div class="recent-event">${escapeHtml(record.name)}<small>${escapeHtml(record.location || '未填寫地點')}</small></div>
      <span class="type-chip ${typeChipClass(record.type)}">${escapeHtml(typeLabel(record))}</span>
      <span class="row-time">${formatTime(record.seconds)}</span>
      <span class="row-date">${formatDate(record.date)}</span>
      <span class="row-pace">${formatPace(record.seconds, record)} /KM</span>
    </div>`).join('') : '<div class="recent-empty"><div><strong>你的第一場賽事，正等著被記錄。</strong><p>新增賽事後，近期紀錄會出現在這裡。</p></div></div>';
}

function renderRecords() {
  const query = $('#searchInput').value.trim().toLocaleLowerCase();
  const filtered = sortedRecords().filter(record => {
    const matchesType = activeFilter === 'all' || (activeFilter === 'other' ? !['full', 'half'].includes(record.type) : record.type === activeFilter);
    const matchesQuery = !query || `${record.name} ${record.location || ''} ${record.note || ''}`.toLocaleLowerCase().includes(query);
    return matchesType && matchesQuery;
  });
  $('#allFilterCount').textContent = records.length;
  $('#recordsSummary').textContent = `共 ${filtered.length} 場賽事${query || activeFilter !== 'all' ? `（全部 ${records.length} 場）` : ''}`;
  $('#recordsBody').innerHTML = filtered.map(record => `
    <tr>
      <td>${escapeHtml(record.name)}</td>
      <td>${formatDate(record.date, { year: 'numeric', month: '2-digit', day: '2-digit' })}</td>
      <td><span class="type-chip ${typeChipClass(record.type)}">${escapeHtml(typeLabel(record))}</span></td>
      <td><span class="row-time">${formatTime(record.seconds)}</span></td>
      <td>${formatPace(record.seconds, record)} /KM</td>
      <td class="location-cell" title="${escapeHtml(record.location || '')}">${escapeHtml(record.location || '—')}</td>
      <td><div class="table-actions"><button class="mini-action" data-edit="${escapeHtml(record.id)}" aria-label="編輯 ${escapeHtml(record.name)}" title="編輯">✎</button><button class="mini-action delete" data-delete="${escapeHtml(record.id)}" aria-label="刪除 ${escapeHtml(record.name)}" title="刪除">×</button></div></td>
    </tr>`).join('');
  $('#recordsEmpty').style.display = filtered.length ? 'none' : 'block';
  $('#recordsEmpty').innerHTML = records.length
    ? '<div class="empty-icon">⌕</div><h3>找不到符合條件的紀錄</h3><p>試試其他關鍵字或切換距離篩選。</p>'
    : '<div class="empty-icon">↗</div><h3>第一場賽事，從這裡開始</h3><p>新增你的全馬或半馬完賽紀錄，讓每一步努力都被好好收藏。</p><button class="button button-primary" id="emptyAddButton">＋ 新增賽事</button>';
  $('#emptyAddButton')?.addEventListener('click', () => openModal());
}

function renderAnalytics() {
  const years = [...new Set(records.map(record => record.date.slice(0, 4)).filter(year => /^\d{4}$/.test(year)))].sort((a, b) => b.localeCompare(a));
  const yearSelect = $('#analyticsYear');
  const previousValue = yearSelect.value;
  yearSelect.innerHTML = '<option value="all">全部年度</option>' + years.map(year => `<option value="${year}">${year} 年</option>`).join('');
  if (years.includes(previousValue)) yearSelect.value = previousValue;
  const year = yearSelect.value;
  const scoped = year === 'all' ? records : records.filter(record => record.date.startsWith(year));
  const totalMeters = scoped.reduce((sum, record) => sum + distanceOf(record), 0);
  const totalSeconds = scoped.reduce((sum, record) => sum + Number(record.seconds), 0);
  const totalDistance = scoped.reduce((sum, record) => sum + distanceOf(record), 0);
  $('#analyticsRaces').innerHTML = `${scoped.length} <small>場</small>`;
  $('#analyticsDistance').innerHTML = `${totalDistance.toLocaleString('zh-TW', { maximumFractionDigits: 2 })} <small>KM</small>`;
  $('#analyticsPace').innerHTML = `${totalMeters ? formatTime(totalSeconds / totalMeters, false) : '--:--'} <small>/KM</small>`;
  $('#analyticsThisYear').innerHTML = `${records.filter(record => record.date.startsWith(String(new Date().getFullYear()))).length} <small>場</small>`;
  drawTrend(scoped);
  drawDonut(scoped);
  drawYearChart(year === 'all' ? records : scoped);
}

function drawTrend(list) {
  const chart = $('#trendChart');
  const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) {
    chart.innerHTML = '<div class="chart-empty"><div><span>留下第一筆紀錄</span>成績趨勢將隨賽事逐步呈現。</div></div>';
    return;
  }
  const width = 640, height = 214, left = 43, right = 15, top = 14, bottom = 34;
  const values = sorted.map(record => Number(record.seconds) / distanceOf(record) / 60);
  const low = Math.floor(Math.min(...values) - 0.5);
  const high = Math.ceil(Math.max(...values) + 0.5);
  const span = Math.max(1, high - low);
  const x = index => sorted.length === 1 ? (left + width - right) / 2 : left + (width - left - right) * index / (sorted.length - 1);
  const y = value => top + (height - top - bottom) * (high - value) / span;
  const grid = Array.from({ length: 4 }, (_, index) => {
    const val = high - span * index / 3;
    const yy = y(val);
    return `<line x1="${left}" y1="${yy}" x2="${width - right}" y2="${yy}" stroke="var(--line)" stroke-dasharray="3 4"/><text x="${left - 8}" y="${yy + 3}" text-anchor="end">${formatTime(val * 60, false)}</text>`;
  }).join('');
  const paths = ['full', 'half', 'other'].map(type => {
    const points = sorted.map((record, index) => ({ record, index })).filter(point => typeChipClass(point.record.type) === type);
    if (!points.length) return '';
    const color = type === 'full' ? 'var(--full-color, var(--orange))' : type === 'half' ? 'var(--green)' : 'var(--tpm-grey, #797c81)';
    const line = points.map(point => `${x(point.index)},${y(values[point.index])}`).join(' ');
    const circles = points.map(point => `<circle cx="${x(point.index)}" cy="${y(values[point.index])}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="2"><title>${escapeHtml(point.record.name)}｜${formatDate(point.record.date)}｜${formatPace(point.record.seconds, point.record)} /KM</title></circle>`).join('');
    return `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${circles}`;
  }).join('');
  const labelIndices = [...new Set([0, Math.floor((sorted.length - 1) / 2), sorted.length - 1])];
  const labels = labelIndices.map(index => `<text x="${x(index)}" y="${height - 8}" text-anchor="middle">${formatDate(sorted[index].date, { year: '2-digit', month: 'numeric' })}</text>`).join('');
  chart.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="每公里平均配速趨勢圖">${grid}${paths}${labels}</svg>`;
}

function drawDonut(list) {
  const fullCount = list.filter(record => record.type === 'full').length;
  const halfCount = list.filter(record => record.type === 'half').length;
  const otherCount = list.length - fullCount - halfCount;
  const percentage = fullCount + halfCount ? fullCount / (fullCount + halfCount) * 100 : 0;
  $('#donutChart').style.background = fullCount + halfCount
    ? `conic-gradient(var(--full-color, var(--orange)) 0 ${percentage}%, var(--green) ${percentage}% 100%)`
    : 'conic-gradient(var(--line) 0 100%)';
  $('#donutTotal').textContent = list.length;
  $('#donutFull').textContent = fullCount;
  $('#donutHalf').textContent = halfCount;
  $('#distanceInsight').textContent = list.length
    ? `全馬佔 ${Math.round(percentage)}%，半馬佔 ${Math.round(100 - percentage)}%${otherCount ? `（另有 ${otherCount} 場其他距離）` : ''}。每一種距離，都是不同的突破。`
    : '新增賽事後，這裡會顯示你的距離分布。';
}

function drawYearChart(list) {
  const chart = $('#yearChart');
  const byYear = new Map();
  list.forEach(record => {
    const year = record.date.slice(0, 4);
    if (!/^\d{4}$/.test(year)) return;
    byYear.set(year, (byYear.get(year) || 0) + distanceOf(record));
  });
  const years = [...byYear.keys()].sort();
  if (!years.length) {
    chart.innerHTML = '<div class="year-empty">完成賽事後，年度里程會顯示在這裡。</div>';
    return;
  }
  const max = Math.max(...byYear.values());
  chart.innerHTML = `<div class="year-bars">${years.map(year => {
    const distance = byYear.get(year);
    const barHeight = Math.max(5, distance / max * 100);
    return `<div class="year-bar-item" title="${year} 年：${distance.toLocaleString('zh-TW', { maximumFractionDigits: 2 })} KM"><span class="year-bar-value">${distance.toLocaleString('zh-TW', { maximumFractionDigits: 1 })}</span><div class="year-bar" style="height:${barHeight}%"></div><span class="year-bar-label">${year}</span></div>`;
  }).join('')}</div>`;
}

function openModal(record = null) {
  const modal = $('#raceModal');
  $('#raceForm').reset();
  $('#formError').textContent = '';
  $('#raceId').value = record?.id || '';
  $('#modalTitle').textContent = record ? '編輯賽事紀錄' : '新增賽事紀錄';
  $('#saveRaceButton').innerHTML = record ? '儲存變更 <span>↗</span>' : '儲存紀錄 <span>↗</span>';
  $('#raceDate').value = record?.date || new Date().toISOString().slice(0, 10);
  $('#raceName').value = record?.name || '';
  $('#raceType').value = record?.type || 'full';
  $('#raceDistance').value = record?.distanceKm || '';
  syncDistanceRow('raceType', 'raceDistanceRow', 'raceDistance');
  $('#raceLocation').value = record?.location || '';
  $('#raceNote').value = record?.note || '';
  const seconds = Number(record?.seconds || 0);
  $('#timeHours').value = record ? Math.floor(seconds / 3600) : '';
  $('#timeMinutes').value = record ? Math.floor((seconds % 3600) / 60) : '';
  $('#timeSeconds').value = record ? seconds % 60 : '';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#raceName').focus(), 50);
}

function closeModal() {
  $('#raceModal').classList.remove('open');
  $('#raceModal').setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

const MODAL_RACE_FIELDS = { name: 'raceName', date: 'raceDate', type: 'raceType', distance: 'raceDistance', hours: 'timeHours', minutes: 'timeMinutes', seconds: 'timeSeconds', location: 'raceLocation', note: 'raceNote' };
const PEOPLE_RACE_FIELDS = { name: 'pmRaceName', date: 'pmRaceDate', type: 'pmRaceType', distance: 'pmRaceDistance', hours: 'pmTimeHours', minutes: 'pmTimeMinutes', seconds: 'pmTimeSeconds', location: 'pmRaceLocation', note: 'pmRaceNote' };

// Ultra / other-distance races need the actual kilometres.
function syncDistanceRow(typeId, rowId, inputId) {
  const needsDistance = ['ultra', 'other'].includes($(`#${typeId}`).value);
  $(`#${rowId}`).hidden = !needsDistance;
  $(`#${inputId}`).required = needsDistance;
}

function readRaceFields(ids) {
  const field = key => $(`#${ids[key]}`);
  const name = field('name').value.trim();
  const date = field('date').value;
  const type = field('type').value;
  const hours = Number(field('hours').value);
  const minutes = Number(field('minutes').value);
  const secondsPart = Number(field('seconds').value);
  const distanceKm = ['ultra', 'other'].includes(type) ? Number(field('distance').value) : 0;
  if (!name || !date || !DISTANCES[type] || (['ultra', 'other'].includes(type) && !(distanceKm >= 0.1 && distanceKm <= 1000)) || !Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(secondsPart) || hours < 0 || hours > 99 || minutes < 0 || minutes > 59 || secondsPart < 0 || secondsPart > 59) {
    return { error: '請確認賽事名稱、日期及有效的完賽時間（分與秒需介於 0–59）；超馬與其他距離需填寫實際公里數（0.1–1000）。' };
  }
  const totalSeconds = hours * 3600 + minutes * 60 + secondsPart;
  if (!totalSeconds) return { error: '完賽時間必須大於 0。' };
  return { item: { name, date, type, ...(distanceKm ? { distanceKm: Math.round(distanceKm * 100) / 100 } : {}), seconds: totalSeconds, location: field('location').value.trim(), note: field('note').value.trim() } };
}

async function saveRace(event) {
  event.preventDefault();
  const { item, error } = readRaceFields(MODAL_RACE_FIELDS);
  if (error) {
    $('#formError').textContent = error;
    return;
  }
  const id = $('#raceId').value;
  const index = records.findIndex(record => record.id === id);
  $('#saveRaceButton').disabled = true;
  $('#formError').textContent = '';
  try {
    const saved = await apiRequest(racesApiPath(id), {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(item)
    });
    if (index >= 0) records[index] = { ...saved, id: String(saved.id) };
    else records.push({ ...saved, id: String(saved.id) });
    saveLocalRecords();
    closeModal();
    renderAll();
    showToast(index >= 0 ? `賽事紀錄已更新並儲存至 ${STORE_LABEL}。` : `賽事紀錄已新增並儲存至 ${STORE_LABEL}！`);
  } catch (error) {
    $('#formError').textContent = error.message || `儲存至 ${STORE_LABEL} 失敗，請確認後端服務。`;
  } finally {
    $('#saveRaceButton').disabled = false;
  }
}

async function savePersonRace(event) {
  event.preventDefault();
  const errorBox = $('#pmFormError');
  if (!activePerson) {
    errorBox.textContent = '請先選擇或新增人員。';
    return;
  }
  const { item, error } = readRaceFields(PEOPLE_RACE_FIELDS);
  if (error) {
    errorBox.textContent = error;
    return;
  }
  const person = activePerson;
  $('#pmSaveButton').disabled = true;
  errorBox.textContent = '';
  try {
    const saved = await apiRequest(racesApiPath(), { method: 'POST', body: JSON.stringify(item) });
    if (activePerson?.id === person.id) {
      records.push({ ...saved, id: String(saved.id) });
      saveLocalRecords();
      renderAll();
    }
    ['pmRaceName', 'pmRaceLocation', 'pmRaceNote', 'pmRaceDistance', 'pmTimeHours', 'pmTimeMinutes', 'pmTimeSeconds'].forEach(id => { $(`#${id}`).value = ''; });
    showToast(`已為 ${person.name} 新增「${saved.name}」。`);
    $('#pmRaceName').focus();
  } catch (err) {
    errorBox.textContent = err.message || '儲存失敗，請確認後端服務。';
  } finally {
    $('#pmSaveButton').disabled = false;
  }
}

async function deleteRace(id) {
  const record = records.find(item => item.id === id);
  if (!record || !confirm(`確定刪除「${record.name}」的賽事紀錄嗎？此動作無法復原。`)) return;
  try {
    await apiRequest(racesApiPath(id), { method: 'DELETE' });
    records.splice(records.indexOf(record), 1);
    saveLocalRecords();
    renderAll();
    showToast(`賽事紀錄已從 ${STORE_LABEL} 刪除。`);
  } catch (error) {
    showToast(error.message || '刪除失敗，請確認後端服務。');
  }
}

function renderAll() {
  updateDashboard();
  renderRecords();
  renderPeople();
  if (activeView === 'analytics') renderAnalytics();
}

function csvToRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index++; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(cell); cell = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some(value => value.trim())) rows.push(row); }
  return rows;
}

function normalizedHeader(value) {
  return String(value || '').toLowerCase().replace(/[\s_\-·.]/g, '').replace(/[（）()]/g, '');
}

function parseImportedRows(rows, sheetName = '') {
  if (!rows.length) return [];
  const headerRowIndex = rows.findIndex(row => {
    const values = row.map(normalizedHeader);
    return values.includes('日期') && values.some(value => ['名稱', '賽事名稱', '比賽名稱', 'event', 'race', 'racename'].includes(value)) && values.some(value => ['成績', '完賽時間', '時間', 'time', 'finishtime', 'result'].includes(value));
  });
  const headers = rows[headerRowIndex >= 0 ? headerRowIndex : 0].map(normalizedHeader);
  const findIndex = aliases => headers.findIndex(header => aliases.includes(header));
  const indexes = {
    name: findIndex(['賽事名稱', '賽事', '比賽名稱', '名稱', 'event', 'race', 'racename']),
    date: findIndex(['日期', '比賽日期', '完賽日期', 'date', 'racedate']),
    type: findIndex(['距離組別', '組別', '距離', '類型', '賽事類型', 'type', 'category', 'distance']),
    time: findIndex(['完賽時間', '成績', '時間', '完賽成績', 'time', 'finishtime', 'result']),
    location: findIndex(['地點', '比賽地點', '城市', 'location', 'city']),
    note: findIndex(['筆記', '備註', 'note', 'notes']),
    count: findIndex(['次數', '場次', 'number', 'count'])
  };
  const dataRows = rows.slice(headerRowIndex >= 0 ? headerRowIndex + 1 : 1);
  return dataRows.map(row => {
    const get = key => indexes[key] >= 0 ? row[indexes[key]] : '';
    const rawType = String(get('type') || '').toLowerCase();
    const sheetType = /半|half|21(?:\.0975|\.1)?\s*k/i.test(sheetName) ? 'half' : /全|full|42(?:\.195)?\s*k|marathon/i.test(sheetName) ? 'full' : '';
    const type = /全馬|42\.195|42,195|full|marathon/.test(rawType) ? 'full' : /半馬|21\.0975|21\.1|half|21k/.test(rawType) ? 'half' : /10\s*k|10公里/.test(rawType) ? '10k' : /(^|[^\d.])5\s*k|(^|[^\d.])5公里/.test(rawType) ? '5k' : sheetType;
    const rawDate = get('date');
    let date = '';
    if (rawDate instanceof Date && !Number.isNaN(rawDate.getTime())) date = `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}-${String(rawDate.getDate()).padStart(2, '0')}`;
    else if (typeof rawDate === 'number' && rawDate > 10000 && globalThis.XLSX?.SSF) {
      const parts = XLSX.SSF.parse_date_code(rawDate);
      if (parts) date = `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
    } else {
      const dateText = String(rawDate || '').trim();
      const match = dateText.match(/^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
      if (match) date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      else if (/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(dateText)) date = dateText.slice(0, 10);
    }
    const rawTime = get('time');
    let timeSeconds = 0;
    if (rawTime instanceof Date && !Number.isNaN(rawTime.getTime())) timeSeconds = rawTime.getHours() * 3600 + rawTime.getMinutes() * 60 + rawTime.getSeconds();
    else if (typeof rawTime === 'number' && rawTime > 0) timeSeconds = Math.round((rawTime % 1 || rawTime) * 86400);
    else {
      const timeText = String(rawTime || '').trim();
      const timeMatch = timeText.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
      if (timeMatch) timeSeconds = Number(timeMatch[1]) * 3600 + Number(timeMatch[2]) * 60 + Number(timeMatch[3] || 0);
    }
    const name = String(get('name') || '').trim();
    if (!name || !date || !type || !timeSeconds) return null;
    const sourceCount = String(get('count') || '').trim();
    const sourceNote = String(get('note') || '').trim();
    if (/67\s*K|超馬/i.test(`${name} ${sourceNote}`)) return null;
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name, date, type, seconds: timeSeconds,
      location: String(get('location') || '').trim(),
      note: [sourceCount ? `原表次數：${sourceCount}` : '', sourceNote].filter(Boolean).join(' · '),
      updatedAt: new Date().toISOString()
    };
  }).filter(Boolean);
}

async function importFile(file) {
  if (!file) return;
  try {
    let rows;
    if (file.name.toLowerCase().endsWith('.csv')) {
      const text = await file.text();
      rows = csvToRows(text.replace(/^\uFEFF/, ''));
    } else {
      if (!globalThis.XLSX) throw new Error('Excel 元件尚未載入，請確認網路連線後重新整理頁面。');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      rows = workbook.SheetNames.flatMap(sheetName => {
        const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
        return parseImportedRows(sheetRows, sheetName);
      });
    }
    const imported = file.name.toLowerCase().endsWith('.csv') ? parseImportedRows(rows) : rows;
    if (!imported.length) throw new Error('找不到有效資料。請確認表格欄位包含：賽事名稱、日期、距離組別、完賽時間。');
    const existingKeys = new Set(records.map(record => `${record.date}|${record.name}|${record.type}|${record.seconds}`));
    const fresh = imported.filter(record => {
      const key = `${record.date}|${record.name}|${record.type}|${record.seconds}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    if (!fresh.length) {
      showToast(`沒有新增資料，略過重複 ${imported.length} 筆。`);
      return;
    }
    const saved = await apiRequest(racesApiPath(), { method: 'POST', body: JSON.stringify(fresh) });
    records.push(...saved.map(record => ({ ...record, id: String(record.id) })));
    saveLocalRecords();
    renderAll();
    showToast(`已匯入 ${STORE_LABEL}：新增 ${saved.length} 筆${imported.length > fresh.length ? `，略過重複 ${imported.length - fresh.length} 筆` : ''}。`);
  } catch (error) {
    alert(error.message || '匯入失敗，請確認檔案格式。');
  } finally {
    $('#importFile').value = '';
  }
}

function exportRecords() {
  if (!records.length) { showToast('目前沒有賽事紀錄可匯出。'); return; }
  const rows = sortedRecords().map(record => ({
    '賽事名稱': record.name,
    '日期': record.date,
    '距離組別': TYPE_LABELS[record.type] || '其他距離',
    '距離(KM)': distanceOf(record),
    '完賽時間': formatTime(record.seconds),
    '平均配速(/KM)': formatPace(record.seconds, record),
    '地點': record.location || '',
    '筆記': record.note || ''
  }));
  if (globalThis.XLSX) {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 17 }, { wch: 18 }, { wch: 38 }];
    XLSX.utils.book_append_sheet(workbook, sheet, '賽事紀錄');
    XLSX.writeFile(workbook, 'RUN.xlsx');
    showToast('Excel 已匯出為 RUN.xlsx。');
    return;
  }
  const headers = Object.keys(rows[0]);
  const csv = '\uFEFF' + [headers, ...rows.map(row => headers.map(header => row[header]))]
    .map(line => line.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'RUN.csv';
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Excel 元件未載入，已改匯出為 RUN.csv。');
}

function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  applyTheme(stored || (prefersDark ? 'dark' : 'light'));
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#themeIcon').textContent = theme === 'dark' ? '☼' : '◐';
  $('#themeToggle').setAttribute('aria-label', theme === 'dark' ? '切換淺色模式' : '切換深色模式');
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}

function applyDemoMode() {
  if (!DEMO_MODE) return;
  const banner = document.createElement('div');
  banner.className = 'demo-banner';
  banner.setAttribute('role', 'note');
  banner.textContent = '展示版：資料只儲存在你的這個瀏覽器，不會上傳，也不連線資料庫。';
  document.querySelector('.main-content')?.prepend(banner);
  $$('.page-footer span:last-child').forEach(item => { item.textContent = item.textContent.replace('Oracle', STORE_LABEL); });
}

function init() {
  applyDemoMode();
  initTheme();
  try { localStorage.removeItem('runlog-appearance-v1'); } catch {}
  $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date());
  $$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  $$('[data-go="records"]').forEach(button => button.addEventListener('click', () => setView('records')));
  [$('#topAddButton'), $('#heroAddButton'), $('#recordsAddButton'), $('#emptyAddButton')].forEach(button => button?.addEventListener('click', () => openModal()));
  $('#themeToggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#closeModal').addEventListener('click', closeModal);
  $('#cancelModal').addEventListener('click', closeModal);
  $('#raceModal').addEventListener('click', event => { if (event.target === $('#raceModal')) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  $('#raceForm').addEventListener('submit', saveRace);
  $('#raceType').addEventListener('change', () => syncDistanceRow('raceType', 'raceDistanceRow', 'raceDistance'));
  $('#pmRaceType')?.addEventListener('change', () => syncDistanceRow('pmRaceType', 'pmRaceDistanceRow', 'pmRaceDistance'));
  $('#personSelect')?.addEventListener('change', event => {
    const person = people.find(item => item.id === event.target.value);
    if (person) selectPerson(person);
  });
  $('#addPersonButton')?.addEventListener('click', openPeopleView);
  $('#personForm')?.addEventListener('submit', savePerson);
  $('#peopleRaceForm')?.addEventListener('submit', savePersonRace);
  $('#pmPersonSelect')?.addEventListener('change', event => {
    const person = people.find(item => item.id === event.target.value);
    if (person) selectPerson(person);
  });
  $('#peopleList')?.addEventListener('click', event => {
    const renameButton = event.target.closest('[data-rename-person]');
    const deleteButton = event.target.closest('[data-delete-person]');
    if (renameButton) return renamePerson(renameButton.dataset.renamePerson);
    if (deleteButton) return deletePerson(deleteButton.dataset.deletePerson);
    const button = event.target.closest('[data-person-id]');
    const person = button && people.find(item => item.id === button.dataset.personId);
    if (person) selectPerson(person);
  });
  $('#pmImportButton')?.addEventListener('click', () => $('#importFile').click());
  if ($('#pmRaceDate')) $('#pmRaceDate').value = new Date().toISOString().slice(0, 10);
  $('#searchInput').addEventListener('input', renderRecords);
  $$('.filter-pill').forEach(button => button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    $$('.filter-pill').forEach(pill => pill.classList.toggle('selected', pill === button));
    renderRecords();
  }));
  $('#recordsBody').addEventListener('click', event => {
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-delete]');
    if (editButton) {
      const record = records.find(item => item.id === editButton.dataset.edit);
      if (record) openModal(record);
    }
    if (deleteButton) deleteRace(deleteButton.dataset.delete);
  });
  $('#analyticsYear').addEventListener('change', renderAnalytics);
  $('#raceYearSelect').addEventListener('change', renderRaceList);
  $('#raceMonthSelect').addEventListener('change', renderRaceList);
  $('#raceListRefresh').addEventListener('click', () => loadRaceSource(true));
  $('#paceCalculatorForm').addEventListener('submit', event => {
    event.preventDefault();
    calculatePace();
  });
  $('#paceCalculatorForm').addEventListener('input', () => {
    const form = $('#paceCalculatorForm');
    const totalSeconds = Number($('#paceHours').value || 0) * 3600 + Number($('#paceMinutes').value || 0) * 60 + Number($('#paceSeconds').value || 0);
    const distance = Number($('#paceDistance').value);
    $$('.pace-preset').forEach(button => button.classList.toggle('selected', Number(button.dataset.distance) === distance));
    if (form.checkValidity() && totalSeconds > 0) calculatePace();
  });
  $$('.pace-preset').forEach(button => button.addEventListener('click', () => {
    $('#paceDistance').value = button.dataset.distance;
    $$('.pace-preset').forEach(preset => preset.classList.toggle('selected', preset === button));
    calculatePace();
  }));
  $('#importButton').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', event => importFile(event.target.files?.[0]));
  $('#exportButton').addEventListener('click', exportRecords);
  renderAll();
  calculatePace();
  loadRaceSource();
  if ($('#personSelect')) loadPeopleFromDatabase();
}

document.addEventListener('DOMContentLoaded', init);
