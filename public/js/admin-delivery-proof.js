(() => {
  let dialog, generation = 0, polling = false;
  const admin = () => { try { return JSON.parse(localStorage.getItem('currentUser') || '{}').role === 'admin'; } catch { return false; } };
  function initialize() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.className = 'delivery-proof-dialog proof-viewer';
    dialog.setAttribute('aria-labelledby', 'adminDeliveryProofTitle');
    dialog.innerHTML = `<header><h2 id="adminDeliveryProofTitle">Delivery Proof</h2><button type="button" aria-label="Close" title="Close"><i data-lucide="x"></i></button></header><p class="proof-help" role="status">Loading photo...</p><img class="proof-preview" alt="Photo submitted by the delivery rider" hidden><p class="proof-error" role="alert"></p>`;
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { generation++; dialog.querySelector('img').removeAttribute('src'); });
    document.body.append(dialog);
  }
  window.openDeliveryProof = id => {
    if (!admin() || !Number(id)) return;
    initialize(); closeAdminNotificationPanel();
    const modal = document.getElementById('orderModal');
    if (modal) window.bootstrap?.Modal.getInstance(modal)?.hide();
    const current = ++generation;
    const image = dialog.querySelector('img'), status = dialog.querySelector('[role=status]'), error = dialog.querySelector('.proof-error');
    image.hidden = true; error.textContent = ''; status.textContent = 'Loading photo...';
    image.onload = async () => {
      if (current !== generation) return;
      image.hidden = false; status.textContent = '';
      try {
        const response = await fetch(`/admin/riders/assignments/${Number(id)}/proof/seen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actorPayload()) });
        if (!response.ok) throw new Error('Unable to mark this notification read.');
        await loadAdminAlerts(true);
      } catch (failure) { if (current === generation) error.textContent = failure.message; }
    };
    image.onerror = () => { if (current === generation) { status.textContent = ''; error.textContent = 'Delivery photo is unavailable. Close and try again.'; } };
    image.src = `/admin/riders/assignments/${Number(id)}/proof?${actorQueryString()}`;
    if (!dialog.open) dialog.showModal();
    window.lucide?.createIcons();
  };
  window.DeliveryProofAdmin = { async loadNotices() {
    if (!admin()) return [];
    const response = await fetch(`/admin/riders/delivery-notifications?${actorQueryString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load delivery notifications.');
    return Array.isArray(data.items) ? data.items : [];
  } };
  async function refresh() {
    if (!admin() || document.hidden || polling) return;
    polling = true;
    try { await loadAdminAlerts(true); } finally { polling = false; }
  }
  setInterval(refresh, 15000); window.addEventListener('focus', refresh);
})();
