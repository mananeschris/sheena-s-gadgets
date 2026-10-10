(() => {
  const main = document.querySelector('.customer-profile-page .main');
  if (!main) return;

  main.insertBefore(document.getElementById('statementSection'), document.getElementById('paymentActivitySection'));

  const groups = {
    orders: ['ordersSection'],
    account: ['accountSettingsSection'],
    addresses: ['addressBookSection'],
    payments: ['paymentActivitySection', 'statementSection'],
    installments: ['installmentsSection'],
    layaways: ['layawaysSection'],
    repairs: ['repairWarrantySection'],
    wishlist: ['wishlistSection'],
    notifications: ['notificationsSection']
  };

  const panels = new Map();
  for (const [view, ids] of Object.entries(groups)) {
    panels.set(view, ids.map(id => {
      const element = document.getElementById(id);
      return element;
    }).filter(Boolean));
  }

  const panelElements = new Set();
  for (const elements of panels.values()) {
    elements.forEach(element => panelElements.add(element));
  }

  function renderView() {
    const requested = location.hash.slice(1);
    const view = panels.has(requested) ? requested : 'orders';

    panelElements.forEach(element => {
      element.hidden = true;
    });

    const visiblePanels = panels.get(view) || [];
    visiblePanels.forEach(element => {
      element.hidden = false;
    });

    const summary = main.querySelector('.summary-grid');
    if (summary) {
      summary.hidden = view !== 'orders';
    }

    document.querySelectorAll('[data-profile-view]').forEach(link => {
      if (link.dataset.profileView === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  window.showProfileView = view => {
    if (!panels.has(view)) return;
    if (location.hash !== '#' + view) location.hash = '#' + view;
    renderView();
  };

  document.querySelectorAll('[data-profile-view]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      window.showProfileView(link.dataset.profileView);
    });
  });

  window.addEventListener('hashchange', renderView);
  renderView();

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
})();
