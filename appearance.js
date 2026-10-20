(() => {
  const KEY = 'runlog-appearance-v2';
  const FONTS = {
    default: "'Noto Sans TC', 'DM Sans', 'Microsoft JhengHei', sans-serif",
    jhenghei: "'Microsoft JhengHei', 'PingFang TC', 'Noto Sans TC', sans-serif",
    system: "system-ui, -apple-system, 'Segoe UI', 'Noto Sans TC', sans-serif",
    serif: "'Noto Serif TC', 'PMingLiU', 'Songti TC', serif",
    mono: "ui-monospace, 'Cascadia Mono', Consolas, 'Noto Sans TC', monospace"
  };
  const ACCENTS = [
    ['#00519b', '北馬藍'], ['#002158', '深海軍藍'], ['#3b82f6', '海洋藍'],
    ['#2f9e5f', '森林綠'], ['#8b5cf6', '紫羅蘭'], ['#e5484d', '賽道紅']
  ];
  const DEFAULTS = { font: 'default', size: 100, accent: '', text: { light: '', dark: '' } };
  const HEX = /^#[0-9a-f]{6}$/i;
  const root = document.documentElement;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
      const size = Math.min(140, Math.max(80, Number(saved.size) || DEFAULTS.size));
      return {
        font: FONTS[saved.font] ? saved.font : DEFAULTS.font,
        size,
        accent: HEX.test(saved.accent) ? saved.accent : '',
        text: {
          light: HEX.test(saved.text?.light) ? saved.text.light : '',
          dark: HEX.test(saved.text?.dark) ? saved.text.dark : ''
        }
      };
    } catch { return { ...DEFAULTS }; }
  }

  function inkFor(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#103238' : '#ffffff';
  }

  const theme = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

  function apply(s) {
    root.style.setProperty('--app-font', FONTS[s.font]);
    root.style.setProperty('--ui-scale', String(s.size / 100));
    if (s.accent) {
      root.dataset.accent = '1';
      root.style.setProperty('--user-accent', s.accent);
      root.style.setProperty('--accent-ink', inkFor(s.accent));
    } else {
      delete root.dataset.accent;
      root.style.removeProperty('--user-accent');
      root.style.removeProperty('--accent-ink');
    }
    const text = s.text[theme()];
    if (text) {
      root.dataset.text = '1';
      root.style.setProperty('--user-text', text);
    } else {
      delete root.dataset.text;
      root.style.removeProperty('--user-text');
    }
  }

  let state = load();
  apply(state);

  function init() {
    const button = document.getElementById('appearanceButton');
    const panel = document.getElementById('appearancePanel');
    if (!button || !panel) return;
    const fontSelect = panel.querySelector('#fontSelect');
    const sizeRange = panel.querySelector('#fontSizeRange');
    const sizeOutput = panel.querySelector('#fontSizeValue');
    const accentInput = panel.querySelector('#accentColor');
    const textInput = panel.querySelector('#textColor');
    const swatches = panel.querySelector('#accentSwatches');
    const preview = panel.querySelector('#appearancePreview');

    swatches.innerHTML = ACCENTS.map(([color, name]) =>
      `<button type="button" class="appearance-swatch" style="--swatch:${color}" data-color="${color}" title="${name}" aria-label="${name}" aria-pressed="false"></button>`).join('');

    function sync() {
      fontSelect.value = state.font;
      sizeRange.value = state.size;
      sizeOutput.textContent = `${state.size}%`;
      accentInput.value = state.accent || ACCENTS[0][0];
      textInput.value = state.text[theme()] || (theme() === 'dark' ? '#eef3fb' : '#1f2937');
      swatches.querySelectorAll('.appearance-swatch').forEach(el =>
        el.setAttribute('aria-pressed', String(el.dataset.color === (state.accent || '').toLowerCase())));
      preview.style.fontFamily = FONTS[state.font];
    }

    function update(patch) {
      state = { ...state, ...patch };
      apply(state);
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
      sync();
    }

    const setOpen = open => {
      panel.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    };

    button.addEventListener('click', () => setOpen(panel.hidden));
    document.addEventListener('click', event => {
      if (!panel.hidden && !event.target.closest('.appearance-wrap')) setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !panel.hidden) { setOpen(false); button.focus(); }
    });
    fontSelect.addEventListener('change', () => update({ font: fontSelect.value }));
    sizeRange.addEventListener('input', () => update({ size: Number(sizeRange.value) }));
    panel.querySelectorAll('[data-size-step]').forEach(step =>
      step.addEventListener('click', () => update({ size: Math.min(140, Math.max(80, state.size + Number(step.dataset.sizeStep))) })));
    swatches.addEventListener('click', event => {
      const swatch = event.target.closest('[data-color]');
      if (swatch) update({ accent: swatch.dataset.color });
    });
    accentInput.addEventListener('input', () => update({ accent: accentInput.value }));
    textInput.addEventListener('input', () => update({ text: { ...state.text, [theme()]: textInput.value } }));
    panel.querySelector('#textColorReset').addEventListener('click', () => update({ text: { ...state.text, [theme()]: '' } }));
    panel.querySelector('#appearanceReset').addEventListener('click', () => update({ ...DEFAULTS, text: { light: '', dark: '' } }));
    new MutationObserver(() => { apply(state); sync(); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
