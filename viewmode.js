(() => {
  const KEY = 'runlog-view-mode-v1';
  const MODES = [
    ['auto', '◐', '自動（依螢幕大小）'],
    ['mobile', '📱', '手機版'],
    ['desktop', '🖥', '電腦版']
  ];
  const PHONE_WIDTH = 600;
  const isFrame = window.self !== window.top;
  const viewport = document.querySelector('meta[name="viewport"]');
  const AUTO_VIEWPORT = viewport?.getAttribute('content') || 'width=device-width, initial-scale=1';

  const load = () => {
    try {
      const mode = localStorage.getItem(KEY);
      return MODES.some(item => item[0] === mode) ? mode : 'auto';
    } catch { return 'auto'; }
  };

  let mode = load();
  let preview = null;

  function setPreview(on) {
    if (on && !preview) {
      preview = document.createElement('div');
      preview.className = 'mobile-preview';
      const frame = document.createElement('iframe');
      frame.title = '手機版預覽';
      frame.src = location.href.split('#')[0];
      preview.append(frame);
      document.body.append(preview);
    } else if (!on && preview) {
      preview.remove();
      preview = null;
    }
    document.body.classList.toggle('mobile-preview-on', on);
  }

  function apply() {
    if (isFrame) return;
    const narrow = Math.min(screen.width, window.innerWidth) <= PHONE_WIDTH;
    // A real phone asking for the desktop layout gets a wide layout viewport; wide screens preview the phone layout in a frame.
    viewport?.setAttribute('content', mode === 'desktop' && narrow ? 'width=1280' : AUTO_VIEWPORT);
    setPreview(mode === 'mobile' && window.innerWidth > PHONE_WIDTH);
    $all('.viewmode-option').forEach(button => button.setAttribute('aria-checked', String(button.dataset.mode === mode)));
    const current = MODES.find(item => item[0] === mode);
    const toggle = document.querySelector('.viewmode-toggle');
    if (toggle) {
      toggle.textContent = current[1];
      toggle.setAttribute('aria-label', `顯示模式：${current[2]}`);
    }
  }

  const $all = selector => [...document.querySelectorAll(selector)];

  function setMode(next) {
    mode = next;
    try { localStorage.setItem(KEY, mode); } catch {}
    apply();
  }

  function init() {
    if (isFrame) return;
    const wrap = document.createElement('div');
    wrap.className = 'viewmode';
    wrap.innerHTML = `
      <button type="button" class="viewmode-toggle" aria-haspopup="menu" aria-expanded="false" title="切換手機／電腦版"></button>
      <div class="viewmode-menu" role="menu" aria-label="顯示模式" hidden>
        ${MODES.map(([value, icon, label]) => `<button type="button" role="menuitemradio" class="viewmode-option" data-mode="${value}" aria-checked="false"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}
      </div>`;
    document.body.append(wrap);
    const toggle = wrap.querySelector('.viewmode-toggle');
    const menu = wrap.querySelector('.viewmode-menu');
    const setOpen = open => {
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    toggle.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', event => {
      const option = event.target.closest('[data-mode]');
      if (!option) return;
      setMode(option.dataset.mode);
      setOpen(false);
    });
    document.addEventListener('click', event => { if (!event.target.closest('.viewmode')) setOpen(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', apply);
    apply();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
