(() => {
  const mobile = window.matchMedia('(max-width: 1180px)');
  const sidebar = document.getElementById('adminSidebar');
  const toggle = document.getElementById('adminNavToggle');
  const backdrop = document.getElementById('adminNavBackdrop');
  const main = document.querySelector('main');
  let open = false;
  let iconFrame = null;

  function setNavigation(value, restoreFocus = true) {
    open = mobile.matches && value;
    document.body.classList.toggle('workspace-nav-open', open);
    sidebar.inert = mobile.matches && !open;
    main.inert = open;
    backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('.nav-button.active:not(.role-hidden)')?.focus();
    else if (mobile.matches && restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', () => setNavigation(!open));
  document.getElementById('adminNavClose').addEventListener('click', () => setNavigation(false));
  backdrop.addEventListener('click', () => setNavigation(false));
  mobile.addEventListener('change', () => setNavigation(false, false));
  sidebar.addEventListener('click', event => {
    if (event.target.closest('[data-section]') && mobile.matches) setNavigation(false);
  });
  document.addEventListener('keydown', event => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setNavigation(false);
    } else if (event.key === 'Tab') {
      const controls = [...sidebar.querySelectorAll('button, a[href]')].filter(el => el.getClientRects().length && !el.disabled);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  function syncSection() {
    const section = main.querySelector(':scope > .section.active');
    const active = document.querySelector(`.nav-button[data-section="${section?.id}"]`);
    document.getElementById('activeSectionLabel').textContent = active?.querySelector('.nav-label span')?.textContent || 'Overview';
    document.querySelectorAll('.nav-button').forEach(button => {
      if (button === active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  // Keep utility controls consistent when tables and order actions are rerendered.
  function decorate(root) {
    const buttons = root.matches?.('button.btn') ? [root] : [...root.querySelectorAll?.('button.btn') || []];
    let changed = false;
    buttons.forEach(button => {
      if (button.querySelector('svg, [data-lucide]') || button.closest('#productModal')) return;
      const command = button.getAttribute('onclick')?.match(/^\s*([\w$]+)\(/)?.[1] || '';
      const label = button.textContent.trim();
      if (!command || !label) return;
      const utility = /^(export|reset|load|refresh|print|render)/.test(command);
      const actionIcon = { Approve: 'check', Reject: 'x', Review: 'eye', 'Record Payment': 'banknote', 'Notify Customer': 'bell' }[label];
      const icon = actionIcon || (command.startsWith('export') ? 'download' : command.startsWith('print') ? 'printer' : command.startsWith('reset') ? 'filter-x' : /^(load|refresh|render)/.test(command) ? 'refresh-cw' : /^(approve|confirm|save|checkout)/.test(command) ? 'check' : /^(reject|cancel|delete|clear)/.test(command) ? 'x' : /^(add|create)/.test(command) ? 'plus' : /^(view|open)/.test(command) ? 'arrow-up-right' : command.startsWith('copy') ? 'copy' : command.startsWith('send') ? 'send' : null);
      if (!icon) return;
      const node = document.createElement('i');
      node.dataset.lucide = icon;
      node.setAttribute('aria-hidden', 'true');
      if (utility && button.closest('.toolbar, .admin-subpanel, .inventory-filter-bar, .audit-filter-bar')) {
        button.setAttribute('aria-label', label);
        button.title = label;
        button.classList.add('workspace-tool');
        button.replaceChildren(node);
      } else button.prepend(node);
      changed = true;
    });
    root.querySelectorAll?.('.table-responsive').forEach(region => {
      region.tabIndex = 0;
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', `${region.closest('.section')?.querySelector('h4')?.textContent || 'Records'} table`);
    });
    if (changed && !iconFrame) iconFrame = requestAnimationFrame(() => {
      iconFrame = null;
      window.lucide?.createIcons();
    });
  }

  const sections = main.querySelectorAll(':scope > .section');
  const sectionObserver = new MutationObserver(syncSection);
  sections.forEach(section => sectionObserver.observe(section, { attributes: true, attributeFilter: ['class'] }));
  const controlsObserver = new MutationObserver(records => {
    records.forEach(record => {
      if (record.target.matches?.('button.btn')) decorate(record.target);
      record.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) decorate(node);
      });
    });
  });
  [main, document.getElementById('orderModal'), document.getElementById('statusUpdateModal')].forEach(root => {
    decorate(root);
    controlsObserver.observe(root, { childList: true, subtree: true });
  });
  setNavigation(false, false);
  syncSection();
})();
