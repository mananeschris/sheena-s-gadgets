(function () {
  'use strict';
  if (document.getElementById('shopAssistantLauncher')) return;
  let history = [], busy = false, accountId = null;
  let revision = 0, requestController = null;
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/css/shop-assistant.css?v=1';
  document.head.appendChild(css);
  document.body.insertAdjacentHTML('beforeend', `
    <button id="shopAssistantLauncher" class="shop-ai-launcher" type="button" aria-label="Open AI shopping assistant" title="AI shopping assistant"><i data-lucide="bot-message-square" aria-hidden="true"></i><span>AI assistant</span></button>
    <dialog id="shopAssistantDialog" class="shop-ai-dialog" aria-labelledby="shopAssistantTitle">
      <header class="shop-ai-head"><span class="shop-ai-mark"><i data-lucide="bot" aria-hidden="true"></i></span><div><h2 id="shopAssistantTitle">Shop assistant</h2><p>AI assistance</p></div><button id="shopAssistantReset" type="button" aria-label="Start a new chat" title="Start a new chat"><i data-lucide="rotate-ccw" aria-hidden="true"></i></button><button id="shopAssistantClose" type="button" aria-label="Close AI assistant" title="Close"><i data-lucide="x" aria-hidden="true"></i></button></header>
      <div id="shopAssistantMessages" class="shop-ai-messages" role="log" aria-live="polite" aria-label="AI conversation"></div>
      <div class="shop-ai-suggestions"><button type="button" data-ai-question="What payment methods can I use?">Payment options</button><button type="button" data-ai-question="How does product warranty work?">Warranty</button><button type="button" data-ai-question="How can I track my delivery?">Delivery</button></div>
      <div id="shopAssistantNotice" class="shop-ai-notice" role="status"></div>
      <p id="shopAssistantPrivacy" class="shop-ai-privacy" hidden>Questions are sent to Google Gemini and may be used to improve Google products. Do not share personal, payment, or account details. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Privacy terms</a></p>
      <div class="shop-ai-links"><a href="/customer/profile.html#orders">My orders</a><button id="shopAssistantSeller" type="button"><i data-lucide="messages-square" aria-hidden="true"></i>Contact the shop</button><button id="shopAssistantRetry" type="button" title="Check assistant availability" aria-label="Check assistant availability"><i data-lucide="refresh-cw" aria-hidden="true"></i></button><a id="shopAssistantSignIn" href="/auth.html" hidden>Sign in</a></div>
      <form id="shopAssistantForm" class="shop-ai-composer"><label for="shopAssistantInput" class="shop-ai-sr">Your question</label><textarea id="shopAssistantInput" rows="2" maxlength="1500" placeholder="Ask about a product or your purchase..." required></textarea><button id="shopAssistantSend" type="submit" aria-label="Send question" title="Send question"><i data-lucide="send" aria-hidden="true"></i></button></form>
      <p class="shop-ai-disclaimer">AI answers may be inaccurate. Never share passwords or verification codes.</p>
    </dialog>`);
  const byId = id => document.getElementById(id);
  const dialog = byId('shopAssistantDialog');
  const input = byId('shopAssistantInput');
  const log = byId('shopAssistantMessages');
  const notice = byId('shopAssistantNotice');
  function user() { try { return JSON.parse(localStorage.getItem('currentUser') || 'null'); } catch { return null; } }
  function icons() { window.lucide?.createIcons(); }
  function bubble(text, role, id) {
    const article = document.createElement('article');
    article.className = 'shop-ai-message ' + role;
    if (id) article.id = id;
    const label = document.createElement('small'); label.textContent = role === 'user' ? 'You' : 'Shop assistant';
    const body = document.createElement('p'); body.textContent = text;
    article.append(label, body); log.appendChild(article); log.scrollTop = log.scrollHeight;
  }
  function reset() {
    history = []; log.replaceChildren(); input.value = '';
    bubble('Hi! What can I help you with? Ask about products, payment options, delivery, or warranty.', 'assistant');
  }
  function clearAccountChat() {
    revision++;
    requestController?.abort(); requestController = null;
    busy = false; accountId = null;
    reset(); controls(false);
    notice.textContent = 'Sign in to start a new conversation.';
    if (dialog.open) dialog.close();
  }
  function controls(available) {
    input.disabled = !available || busy;
    byId('shopAssistantSend').disabled = !available || busy;
    document.querySelectorAll('[data-ai-question]').forEach(button => { button.disabled = !available || busy; });
    byId('shopAssistantReset').disabled = busy;
  }
  async function availability() {
    const currentRevision = revision;
    controls(false);
    const customer = user();
    const loggedIn = customer?.role === 'customer';
    byId('shopAssistantSignIn').hidden = loggedIn;
    if (!loggedIn) { notice.textContent = 'Sign in to ask the AI assistant a question.'; return; }
    notice.textContent = 'Connecting to the assistant...';
    try {
      const response = await fetch('/ai-assistant/status');
      if (revision !== currentRevision || user()?.id !== accountId) return;
      if ([401, 403].includes(response.status)) {
        history = []; log.replaceChildren(); input.value = '';
        byId('shopAssistantSignIn').hidden = false;
        throw new Error('Sign in again to use the assistant.');
      }
      if (!response.ok) throw new Error('The assistant is unavailable. Contact the shop for help.');
      const data = await response.json();
      byId('shopAssistantPrivacy').hidden = data.provider !== 'gemini';
      notice.textContent = data.available ? '' : 'The AI assistant is offline. You can still contact the shop.';
      controls(Boolean(data.available));
      if (data.available) input.focus();
    } catch (error) { if (revision === currentRevision) { notice.textContent = error.message; controls(false); } }
  }
  async function send(event) {
    event.preventDefault();
    if (busy || input.disabled) return;
    if (user()?.role !== 'customer' || user()?.id !== accountId) { clearAccountChat(); return; }
    const text = input.value.trim();
    if (!text) return;
    const previous = history.slice(-10);
    while (previous.length && previous.reduce((size, message) => size + message.content.length, text.length) > 10000) previous.splice(0, 2);
    const messages = [...previous, { role: 'user', content: text }];
    bubble(text, 'user'); input.value = ''; busy = true; controls(false); notice.textContent = '';
    bubble('Thinking...', 'assistant', 'shopAssistantThinking');
    const currentRevision = revision;
    let authorized = true;
    const controller = new AbortController();
    requestController = controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    try {
      const response = await fetch('/ai-assistant/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }), signal: requestController.signal });
      const data = await response.json().catch(() => ({}));
      if (revision !== currentRevision) return;
      if (user()?.id !== accountId) { clearAccountChat(); return; }
      if ([401, 403].includes(response.status)) {
        authorized = false;
        history = []; log.replaceChildren();
        byId('shopAssistantSignIn').hidden = false;
      }
      if (!response.ok) throw new Error(data.message || 'Unable to answer right now. Please try again.');
      if (typeof data.reply !== 'string') throw new Error('Unable to answer right now. Please try again.');
      history = [...messages, { role: 'assistant', content: data.reply }];
      bubble(data.reply, 'assistant');
    } catch (error) {
      if (revision === currentRevision) {
        notice.textContent = error.name === 'AbortError' ? 'The assistant took too long. Try again or contact the shop.' : error.message;
        if (authorized) input.value = text;
      }
    } finally {
      clearTimeout(timeout);
      if (revision === currentRevision) {
        byId('shopAssistantThinking')?.remove(); busy = false; requestController = null;
        controls(authorized);
        if (authorized && dialog.open) input.focus();
      }
    }
  }
  byId('shopAssistantLauncher').onclick = () => {
    const nextId = user()?.id || null;
    if (accountId !== nextId) { clearAccountChat(); accountId = nextId; }
    if (!log.children.length) reset();
    dialog.showModal();
    if (!busy) availability();
  };
  window.addEventListener('storage', event => { if (event.key === 'currentUser' || event.key === null) clearAccountChat(); });
  byId('shopAssistantClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => byId('shopAssistantLauncher').focus());
  byId('shopAssistantReset').onclick = () => { if (!busy) { reset(); availability(); } };
  byId('shopAssistantRetry').onclick = () => { if (!busy) availability(); };
  byId('shopAssistantForm').onsubmit = send;
  input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); byId('shopAssistantForm').requestSubmit(); } });
  document.querySelectorAll('[data-ai-question]').forEach(button => { button.onclick = () => { input.value = button.dataset.aiQuestion; byId('shopAssistantForm').requestSubmit(); }; });
  byId('shopAssistantSeller').onclick = async () => {
    if (user()?.role !== 'customer') { location.href = '/auth.html'; return; }
    const orderId = Number(new URLSearchParams(location.search).get('order_id') || new URLSearchParams(location.search).get('order'));
    if (!orderId) { location.href = '/customer/profile.html#orders'; return; }
    try {
      if (!window.OrderSupport) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = '/js/order-support.js?v=2'; script.onload = resolve; script.onerror = reject; document.body.appendChild(script);
      });
      dialog.close(); window.OrderSupport.open({ orderId });
    } catch { notice.textContent = 'Open My Orders to contact the shop about your purchase.'; }
  };
  icons();
})();
