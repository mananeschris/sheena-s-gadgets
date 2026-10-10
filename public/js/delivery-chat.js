(function () {
  'use strict';
  let user = null, threads = [], selected = null, messages = [], peerReadId = 0;
  let epoch = 0, timer, listBusy = false, messageBusy = false, hasOlder = false, loadingOlder = false;
  let trigger = null, dialog, readThrough = 0;
  const drafts = new Map();
  const pendingSends = new Set();
  const labels = { assigned: 'Assigned', picked_up: 'Picked Up', out_for_delivery: 'Out for Delivery', failed_attempt: 'Delivery Issue', delivered: 'Delivered', cancelled: 'Cancelled' };
  const statusIcons = { assigned: 'clipboard-list', picked_up: 'package-check', out_for_delivery: 'truck', failed_attempt: 'triangle-alert', delivered: 'circle-check', cancelled: 'circle-x' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icons = () => window.lucide?.createIcons();
  const time = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const name = thread => user?.role === 'rider' ? thread.customer_name || 'Customer' : thread.rider_name || 'Rider';
  function account() { try { const value = JSON.parse(localStorage.getItem('currentUser') || 'null'); return ['customer', 'rider'].includes(value?.role) ? value : null; } catch { return null; } }

  async function api(path, options = {}) {
    const current = account();
    if (!current || current.id !== user?.id) throw new Error('Account changed. Sign in again to use messages.');
    const response = await fetch('/delivery-chat' + path, { ...options, headers: { 'Content-Type': 'application/json', 'X-Chat-User': String(user.id), ...options.headers } });
    const data = await response.json().catch(() => ({ message: 'Messaging service is unavailable.' }));
    if (!response.ok) { const error = new Error(data.message || 'Unable to load messages.'); error.status = response.status; throw error; }
    return data;
  }
  const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
  function showError(error) {
    const element = document.getElementById('chatError');
    element.hidden = false;
    element.querySelector('span').textContent = error.message;
    element.querySelector('a').hidden = error.status !== 401;
  }
  function clearError() { document.getElementById('chatError').hidden = true; }
  function badge(count) {
    document.querySelectorAll('[data-chat-count]').forEach(el => { el.textContent = count > 99 ? '99+' : count; el.hidden = !count; });
    document.querySelectorAll('[data-delivery-inbox]').forEach(el => el.setAttribute('aria-label', count ? `Messages, ${count} unread` : 'Messages'));
  }

  function renderList() {
    syncButtons();
    document.getElementById('chatConversationCount').textContent = threads.length;
    const list = document.getElementById('chatConversations');
    list.innerHTML = threads.length ? threads.map(thread => `<button type="button" class="chat-conversation ${selected?.id === thread.id ? 'selected' : ''}" data-thread="${thread.id}" aria-pressed="${selected?.id === thread.id}">
      <span class="chat-thumb">${thread.product_image ? `<img src="${esc(thread.product_image)}" alt="" onerror="this.hidden=true">` : ''}<i data-lucide="package" aria-hidden="true"></i></span>
      <span class="chat-conversation-copy"><strong>${esc(name(thread))}</strong><span>${esc(thread.product_name)}</span><small>${esc(thread.last_message || labels[thread.delivery_status] || 'Assigned')}${!thread.is_current ? ' · Previous rider' : ''}</small></span>
      <span class="chat-conversation-meta"><time>${esc(time(thread.last_message_at))}</time>${thread.unread_count ? `<b>${thread.unread_count}</b>` : ''}</span></button>`).join('') : '<div class="chat-empty"><i data-lucide="message-circle" aria-hidden="true"></i><p>No delivery conversations yet</p></div>';
    list.querySelectorAll('[data-thread]').forEach(button => button.addEventListener('click', () => choose(Number(button.dataset.thread))));
    icons();
  }

  function renderThread() {
    const empty = document.getElementById('chatNoSelection');
    const workspace = document.getElementById('chatWorkspace');
    empty.hidden = Boolean(selected);
    workspace.hidden = !selected;
    if (!selected) return;
    document.getElementById('chatPeer').textContent = name(selected);
    document.getElementById('chatPeerInitials').textContent = name(selected).trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
    document.getElementById('chatPeerRole').textContent = user.role === 'rider' ? 'Customer' : 'Delivery rider';
    document.getElementById('chatDeliveryStatus').innerHTML = `<i data-lucide="${statusIcons[selected.delivery_status] || 'package'}" aria-hidden="true"></i><span>${esc(labels[selected.delivery_status] || selected.delivery_status)}</span>`;
    document.getElementById('chatProductName').textContent = selected.product_name;
    const photo = document.getElementById('chatProductPhoto');
    photo.hidden = !selected.product_image;
    photo.src = selected.product_image || '';
    photo.onerror = () => { photo.hidden = true; };
    const link = document.getElementById('chatOrderLink');
    link.hidden = user.role !== 'customer';
    link.href = `/customer/order.html?order_id=${selected.order_id}`;
    const closed = !selected.can_send;
    document.getElementById('chatClosed').hidden = !closed;
    document.getElementById('chatClosed').innerHTML = `<i data-lucide="lock-keyhole" aria-hidden="true"></i><span>${selected.is_current ? 'Delivery closed. This conversation is read-only.' : 'Rider changed. This conversation is read-only.'}</span>`;
    document.getElementById('chatComposer').hidden = closed;
    document.getElementById('chatSend').disabled = pendingSends.has(selected.id) || !document.getElementById('chatMessageInput').value.trim();
    icons();
  }

  function renderMessages(preserveScroll = false) {
    const list = document.getElementById('chatMessages');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
    const scrollTop = list.scrollTop;
    list.innerHTML = messages.length ? messages.map(message => {
      const own = Number(message.sender_id) === Number(user.id);
      const read = message.read_at || message.id <= peerReadId;
      return `<article class="chat-message ${own ? 'own' : ''}"><p>${esc(message.body)}</p><span><time>${esc(time(message.created_at))}</time>${own ? `<small><i data-lucide="${read ? 'check-check' : 'check'}" aria-hidden="true"></i>${read ? 'Read' : 'Sent'}</small>` : ''}</span></article>`;
    }).join('') : '<div class="chat-empty"><i data-lucide="message-circle" aria-hidden="true"></i><p>No messages yet</p></div>';
    document.getElementById('chatOlder').hidden = !hasOlder;
    if (!preserveScroll || atBottom) list.scrollTop = list.scrollHeight;
    else list.scrollTop = scrollTop;
    icons();
  }

  async function markRead() {
    if (!selected || !dialog.open || document.hidden || !dialog.classList.contains('chat-show-thread')) return;
    const last = messages.at(-1)?.id;
    if (!last || last <= readThrough) return;
    const id = selected.id, version = epoch;
    try {
      await post(`/threads/${id}/read`, { last_id: last });
      if (version !== epoch || selected?.id !== id) return;
      readThrough = last;
      const thread = threads.find(item => item.id === id);
      if (thread) thread.unread_count = 0;
      badge(threads.reduce((sum, item) => sum + item.unread_count, 0));
      renderList();
    } catch (error) { if (version === epoch) showError(error); }
  }

  async function refreshList() {
    if (listBusy) return listBusy;
    let finish;
    listBusy = new Promise(resolve => { finish = resolve; });
    const version = epoch;
    try {
      const data = await api('/threads');
      if (version !== epoch) return;
      threads = data.threads;
      badge(data.unread_count);
      renderList();
      if (selected) {
        const updated = threads.find(item => item.id === selected.id);
        if (!updated) { selected = null; messages = []; dialog.classList.remove('chat-show-thread'); showError(new Error('This conversation is no longer available.')); }
        else selected = updated;
        renderThread();
      }
    } catch (error) { if (dialog.open && version === epoch) showError(error); }
    finally { listBusy = false; finish(); }
  }

  function syncButtons() {
    document.querySelectorAll('[data-chat-order]').forEach(button => { button.hidden = !threads.some(thread => thread.order_id === Number(button.dataset.chatOrder)); });
  }

  async function choose(id) {
    if (selected) drafts.set(selected.id, { ...(drafts.get(selected.id) || {}), text: document.getElementById('chatMessageInput').value });
    selected = threads.find(item => item.id === id);
    if (!selected) return;
    const version = ++epoch;
    messages = []; peerReadId = 0; readThrough = 0; hasOlder = false;
    dialog.classList.add('chat-show-thread');
    document.getElementById('chatMessageInput').value = drafts.get(id)?.text || '';
    document.getElementById('chatMessages').innerHTML = '<div class="chat-empty">Loading messages...</div>';
    clearError(); renderList(); renderThread();
    try {
      const data = await api(`/threads/${id}/messages`);
      if (version !== epoch) return;
      selected = data.thread; messages = data.messages; peerReadId = data.peer_read_id; hasOlder = data.has_more;
      renderThread(); renderMessages(); await markRead();
    } catch (error) { if (version === epoch) showError(error); }
  }

  async function refreshMessages() {
    if (!selected || messageBusy || loadingOlder) return;
    messageBusy = true;
    const id = selected.id, version = epoch;
    try {
      const last = messages.at(-1)?.id;
      const data = await api(`/threads/${id}/messages${last ? '?after_id=' + last : ''}`);
      if (version !== epoch || selected?.id !== id) return;
      selected = data.thread;
      const readChanged = peerReadId !== data.peer_read_id;
      peerReadId = data.peer_read_id;
      const ids = new Set(messages.map(item => item.id));
      const incoming = data.messages.filter(item => !ids.has(item.id));
      messages.push(...incoming);
      messages.sort((a, b) => a.id - b.id);
      renderThread(); if (incoming.length || readChanged) renderMessages(true); await markRead();
    } catch (error) { if (version === epoch) showError(error); }
    finally { messageBusy = false; }
  }

  async function older() {
    if (!selected || loadingOlder || !messages.length) return;
    loadingOlder = true;
    const version = epoch, id = selected.id;
    const list = document.getElementById('chatMessages');
    const previousHeight = list.scrollHeight, top = list.scrollTop;
    try {
      const data = await api(`/threads/${id}/messages?before_id=${messages[0].id}`);
      if (version !== epoch) return;
      const ids = new Set(messages.map(item => item.id));
      messages.unshift(...data.messages.filter(item => !ids.has(item.id)));
      hasOlder = data.has_more;
      renderMessages(true);
      list.scrollTop = top + list.scrollHeight - previousHeight;
    } catch (error) { if (version === epoch) showError(error); }
    finally { loadingOlder = false; }
  }

  async function send(event) {
    event?.preventDefault();
    if (!selected?.can_send || pendingSends.has(selected.id)) return;
    const input = document.getElementById('chatMessageInput'), text = input.value.trim();
    if (!text || text.length > 1000) return;
    const id = selected.id, version = epoch;
    const previous = drafts.get(id);
    const draft = { text, client_id: previous?.text === text && previous.client_id ? previous.client_id : crypto.randomUUID() };
    drafts.set(id, draft); pendingSends.add(id); renderThread(); clearError();
    try {
      const data = await post(`/threads/${id}/messages`, { body: text, client_id: draft.client_id });
      if (drafts.get(id)?.client_id === draft.client_id) drafts.delete(id);
      if (version !== epoch || selected?.id !== id) return;
      if (!messages.some(item => item.id === data.message.id)) messages.push(data.message);
      messages.sort((a, b) => a.id - b.id);
      if (input.value.trim() === text) input.value = '';
      renderMessages(); input.focus(); await refreshList();
    } catch (error) { if (version === epoch) { showError(error); if (error.status === 409) await refreshList(); } }
    finally { pendingSends.delete(id); if (selected?.id === id) renderThread(); }
  }

  async function open(options = {}) {
    syncAccount();
    if (!user) return;
    trigger = document.activeElement;
    window.closeCustomerNotifications?.(false);
    window.closeCart?.(false);
    if (!dialog.open) dialog.showModal();
    clearError();
    await refreshList();
    const thread = options.assignmentId ? threads.find(item => item.assignment_id === Number(options.assignmentId) && item.is_current) : options.orderId ? threads.find(item => item.order_id === Number(options.orderId) && item.is_current) || threads.find(item => item.order_id === Number(options.orderId)) : null;
    if (thread) await choose(thread.id);
    else if (options.orderId || options.assignmentId) { selected = null; renderThread(); dialog.classList.remove('chat-show-thread'); }
    schedule();
  }

  function syncAccount() {
    const next = account();
    if (next?.id !== user?.id) {
      epoch++; threads = []; selected = null; messages = []; drafts.clear(); badge(0);
      if (dialog.open) dialog.close();
    }
    user = next;
    document.querySelectorAll('[data-delivery-inbox]').forEach(el => { el.hidden = !user; });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      syncAccount();
      if (user && !document.hidden) { await refreshList(); if (dialog.open) await refreshMessages(); }
      schedule();
    }, dialog.open ? 5000 : 20000);
  }

  function initialize() {
    if (document.getElementById('deliveryChatDialog')) return;
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/delivery-chat.css?v=2'; document.head.appendChild(css);
    const target = document.querySelector('#customerStoreNav .nav-actions, .profile-main-header, #checkoutHeader, .customer-review-page .topbar, .rider-dashboard-page .topbar .actions');
    if (target && !target.querySelector('[data-delivery-inbox]')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'nav-tool delivery-inbox-button'; button.dataset.deliveryInbox = ''; button.dataset.tooltip = 'Messages'; button.title = 'Messages'; button.setAttribute('aria-label', 'Messages'); button.innerHTML = '<i data-lucide="messages-square" aria-hidden="true"></i><span data-chat-count hidden></span>';
      target.insertBefore(button, target.querySelector('#notificationButton') || target.lastElementChild);
    }
    document.body.insertAdjacentHTML('beforeend', `<dialog id="deliveryChatDialog" class="delivery-chat-dialog" aria-labelledby="chatTitle">
      <header class="chat-head"><div><i data-lucide="messages-square" aria-hidden="true"></i><h2 id="chatTitle">Messages</h2></div><div><button type="button" id="chatRefresh" aria-label="Refresh messages" title="Refresh messages"><i data-lucide="refresh-cw" aria-hidden="true"></i></button><button type="button" id="chatClose" aria-label="Close messages" title="Close messages"><i data-lucide="x" aria-hidden="true"></i></button></div></header>
      <div id="chatError" class="chat-error" role="alert" hidden><span></span><a href="/auth.html">Sign in</a></div>
      <div class="chat-layout"><aside class="chat-inbox" aria-label="Delivery conversations"><div class="chat-inbox-label"><i data-lucide="truck" aria-hidden="true"></i>Deliveries<span id="chatConversationCount">0</span></div><div id="chatConversations"></div></aside>
        <section class="chat-thread"><div id="chatNoSelection" class="chat-empty"><i data-lucide="message-circle" aria-hidden="true"></i><p>Select a conversation</p></div>
          <div id="chatWorkspace" hidden><header class="chat-peer-head"><button type="button" id="chatBack" aria-label="Back to conversations" title="Back to conversations"><i data-lucide="arrow-left" aria-hidden="true"></i></button><span id="chatPeerInitials" class="chat-peer-avatar" aria-hidden="true"></span><div class="chat-peer-copy"><strong id="chatPeer"></strong><span id="chatPeerRole"></span></div><span id="chatDeliveryStatus"></span></header>
            <div class="chat-product"><img id="chatProductPhoto" alt=""><div><span class="chat-context-label">Delivery item</span><strong id="chatProductName"></strong></div><a id="chatOrderLink" aria-label="View order" title="View order"><i data-lucide="arrow-up-right" aria-hidden="true"></i></a></div>
            <button type="button" id="chatOlder" hidden><i data-lucide="history" aria-hidden="true"></i>Earlier messages</button><div id="chatMessages" role="log" aria-label="Conversation messages" aria-live="polite"></div>
            <p id="chatClosed" hidden></p><form id="chatComposer"><label class="visually-hidden" for="chatMessageInput">Message</label><textarea id="chatMessageInput" rows="2" maxlength="1000" placeholder="Message..." required></textarea><button type="submit" id="chatSend" aria-label="Send message" title="Send message"><i data-lucide="send" aria-hidden="true"></i></button></form>
          </div></section></div></dialog>`);
    dialog = document.getElementById('deliveryChatDialog');
    document.querySelectorAll('[data-delivery-inbox]').forEach(button => button.addEventListener('click', () => open()));
    document.addEventListener('click', event => {
      const order = event.target.closest('[data-chat-order]');
      const assignment = event.target.closest('[data-chat-assignment]');
      if (order) open({ orderId: Number(order.dataset.chatOrder) });
      else if (assignment) open({ assignmentId: Number(assignment.dataset.chatAssignment) });
    });
    document.getElementById('chatClose').addEventListener('click', () => dialog.close());
    document.getElementById('chatRefresh').addEventListener('click', async () => { clearError(); await refreshList(); await refreshMessages(); });
    document.getElementById('chatBack').addEventListener('click', () => { dialog.classList.remove('chat-show-thread'); document.querySelector(`[data-thread="${selected?.id}"]`)?.focus(); });
    document.getElementById('chatOlder').addEventListener('click', older);
    document.getElementById('chatComposer').addEventListener('submit', send);
    document.getElementById('chatMessageInput').addEventListener('input', () => {
      if (selected) drafts.set(selected.id, { text: document.getElementById('chatMessageInput').value });
      renderThread();
    });
    document.getElementById('chatMessageInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); } });
    dialog.addEventListener('close', () => { epoch++; if (trigger?.isConnected) trigger.focus(); schedule(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refreshList(); if (dialog.open) refreshMessages(); } });
    window.addEventListener('storage', syncAccount);
    document.addEventListener('click', event => { if (event.target.closest('[onclick*="logout"], [onclick*="Logout"]')) fetch('/auth/logout', { method: 'POST', keepalive: true }).catch(() => {}); }, true);
    syncAccount(); icons(); if (user) refreshList(); schedule();
  }
  window.DeliveryChat = { open, syncButtons, refresh: () => { if (!dialog) return; syncAccount(); if (user) refreshList(); } };
  document.addEventListener('DOMContentLoaded', initialize);
})();
