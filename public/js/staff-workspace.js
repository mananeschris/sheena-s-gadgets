(() => {
  let selected = 'prepare';
  let activityState = 'loading';
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  const empty = (symbol, message, command = '') => `<div class="staff-empty">${adminIcon(symbol)}<strong>${message}</strong>${command}</div>`;
  function groups() {
    const clear = order => order.cancellation_request_status !== 'pending' && orderPaymentReadyForProcessing(order);
    return {
      prepare: allOrders.filter(order => ['pending', 'processing'].includes(orderStatus(order)) && clear(order))
        .sort((a,b) => Number(orderStatus(b) === 'processing') - Number(orderStatus(a) === 'processing') || new Date(a.created_at) - new Date(b.created_at)),
      ready: allOrders.filter(order => orderStatus(order) === 'shipped' && clear(order) && !['picked_up','out_for_delivery','delivered'].includes(order.delivery_status)),
      repair: allOrders.filter(order => order.repair_request_status === 'approved' && order.repair_service_status !== 'completed')
    };
  }
  function render() {
    if (!isStaffUser()) return;
    const work = groups();
    const stocks = allProducts.filter(product => Number(product.stock || 0) <= 5).sort((a,b) => Number(a.stock) - Number(b.stock));
    set('staffWelcomeName', currentAdminUser.name || 'Your workspace');
    set('staffUpdatedAt', `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
    for (const [key, label] of [['prepare','Prepare'],['ready','Ready'],['repair','Repair']]) {
      set(`staff${label}Count`, orderLoadState === 'ready' ? work[key].length : '-');
      set(`staff${label}Badge`, work[key].length);
    }
    set('staffStockCount', productLoadState === 'ready' ? stocks.length : '-');
    document.querySelectorAll('[data-staff-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.staffFilter === selected)));
    const container = document.getElementById('staffQueue');
    if (orderLoadState === 'loading') container.innerHTML = empty('loader-circle', 'Loading your work queue...');
    else if (orderLoadState === 'error') container.innerHTML = empty('circle-alert', 'Unable to load orders.', '<button class="btn btn-outline-dark" onclick="loadOrders()">Retry</button>');
    else {
      container.innerHTML = work[selected].length ? work[selected].map((order, index) => {
        const item = normalizedOrderItems(order)[0] || order;
        const title = item.product_name || order.product_name || 'Product';
        const state = selected === 'repair' ? repairServiceStatusLabel(order.repair_service_status || 'approved') : ORDER_STATUS_LABELS[orderStatus(order)];
        const action = selected === 'prepare' ? orderPrimaryAction(order) : { icon: selected === 'repair' ? 'wrench' : 'eye', label: selected === 'repair' ? 'View Repair' : 'View Order', onclick: `viewOrder(${Number(order.id)})` };
        return `<article class="staff-queue-row" style="--staff-delay:${Math.min(index,5) * 25}ms"><img src="${escapeHtml(item.product_image || order.product_image || '/assets/sheena-mark.svg')}" alt="${escapeHtml(title)}" onerror="this.onerror=null;this.src='/assets/sheena-mark.svg'"><div class="staff-row-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(order.recipient_name || order.customer_name || 'Customer')} / Qty ${escapeHtml(item.quantity || order.quantity || 1)}${normalizedOrderItems(order).length > 1 ? ` / ${normalizedOrderItems(order).length} items` : ''}</span><div class="staff-row-meta"><span class="staff-row-status">${escapeHtml(state)}</span><span>${escapeHtml(shortDate(order.created_at))}</span></div></div><button type="button" class="btn ${selected === 'prepare' ? 'btn-dark' : 'btn-outline-dark'}" onclick="${action.onclick}">${adminIcon(action.icon)}<span>${action.label}</span></button></article>`;
      }).join('') : empty(selected === 'repair' ? 'wrench' : 'package-check', { prepare: 'No orders waiting to be prepared', ready: 'No orders ready for handoff', repair: 'No active approved repairs' }[selected]);
    }
    const held = allOrders.filter(order => ['pending','processing'].includes(orderStatus(order)) && !work.prepare.includes(order)).length;
    const notice = document.getElementById('staffApprovalNotice');
    notice.hidden = !held || orderLoadState !== 'ready';
    notice.innerHTML = `${adminIcon('shield-check')}<span>${held} order${held === 1 ? '' : 's'} awaiting admin review</span>`;
    document.getElementById('staffStockWatch').innerHTML = productLoadState !== 'ready' ? '<div class="staff-stock-empty">Stock data unavailable</div>' : stocks.length ? stocks.slice(0,5).map(product => `<button type="button" class="staff-stock-row" onclick="openAdminInventoryFromAlert(${Number(product.id)}, '${Number(product.stock) <= 0 ? 'out_stock' : 'low_stock'}')" title="View ${escapeHtml(product.name)} stock"><img src="${escapeHtml(productImages(product)[0] || '/assets/sheena-mark.svg')}" alt="" onerror="this.onerror=null;this.src='/assets/sheena-mark.svg'"><strong>${escapeHtml(product.name)}</strong><span class="${Number(product.stock) <= 0 ? 'is-empty' : ''}">${Number(product.stock)} left</span></button>`).join('') : '<div class="staff-stock-empty">Stock levels look good</div>';
    document.getElementById('staffActivityList').innerHTML = activityState === 'loading' ? '<div class="staff-stock-empty">Loading stock history...</div>' : activityState === 'error' ? '<div class="staff-stock-empty">Stock history unavailable</div>' : inventoryMovements.length ? inventoryMovements.slice(0,5).map(item => `<div class="staff-activity-row">${adminIcon(Number(item.quantity_change) >= 0 ? 'package-plus' : 'package-minus')}<div><strong>${escapeHtml(item.display_product_name || item.product_name || 'Product')}</strong><small>${escapeHtml(item.actor_name || 'System')} / ${escapeHtml(item.note || inventoryMovementLabel(item.movement_type))}</small></div><span>${Number(item.quantity_change) > 0 ? '+' : ''}${Number(item.quantity_change || 0)}</span><time>${escapeHtml(shortDate(item.created_at))}</time></div>`).join('') : '<div class="staff-stock-empty">No stock activity yet</div>';
    refreshAdminIcons();
  }
  function filter(value) {
    if (!['prepare','ready','repair'].includes(value)) return;
    selected = value;
    render();
  }
  function account() {
    if (!isStaffUser()) return;
    document.getElementById('staffDisplayName').value = currentAdminUser.name || '';
    set('staffAccountEmail', currentAdminUser.email || '');
    document.getElementById('staffPasswordForm').reset();
    set('staffPasswordMessage', ''); set('staffProfileMessage', '');
  }
  async function save(event, kind) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    if (button.disabled) return;
    const message = document.getElementById(kind === 'profile' ? 'staffProfileMessage' : 'staffPasswordMessage');
    message.textContent = '';
    const payload = kind === 'profile' ? { name: document.getElementById('staffDisplayName').value.trim() } : { current_password: document.getElementById('staffCurrentPassword').value, password: document.getElementById('staffNewPassword').value };
    if (kind === 'password' && payload.password !== document.getElementById('staffConfirmPassword').value) { message.textContent = 'Passwords do not match.'; return; }
    button.disabled = true;
    try {
      const response = await fetch(`/staff/account/${kind}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      message.textContent = data.message;
      if (response.ok && data.user) { currentAdminUser = data.user; localStorage.setItem('currentUser', JSON.stringify(data.user)); syncRoleCopy(); render(); }
      if (response.ok && kind === 'password') form.reset();
    } catch (_) { message.textContent = 'Unable to connect. Please try again.'; }
    finally { button.disabled = false; }
  }
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('staffProfileForm').addEventListener('submit', event => save(event, 'profile'));
    document.getElementById('staffPasswordForm').addEventListener('submit', event => save(event, 'password'));
  });
  window.StaffWorkspace = { render, filter, account, activity: state => { activityState = state; render(); } };
})();
