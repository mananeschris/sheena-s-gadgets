(() => {
  const rawFetch = window.fetch.bind(window);
  let readyPromise;
  let identity;
  let lastActivity = Date.now();
  let lastHeartbeat = 0;
  let deadline = 0;
  let warning;
  let reauthPromise;
  let leaving = false;
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const refreshIcons = () => window.lucide?.createIcons();

  function signin() {
    if (leaving) return;
    leaving = true;
    localStorage.removeItem('currentUser');
    window.location.replace(`/auth.html?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
  }
  async function logout() {
    try {
      const response = await rawFetch('/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error();
      signin();
    } catch (_) {
      window.alert('Unable to sign out securely. Check your connection and try again.');
    }
  }
  async function ready() {
    if (!readyPromise) readyPromise = (async () => {
      try {
        const response = await rawFetch('/auth/session', { cache: 'no-store' });
        if ([401, 403].includes(response.status)) { signin(); return false; }
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!data.user || !['admin', 'staff'].includes(data.user.role)) { signin(); return false; }
        identity = data.user;
        localStorage.setItem('currentUser', JSON.stringify(identity));
        document.body.dataset.sessionReady = 'true';
        deadline = Date.now() + Number(data.remaining_seconds || 900) * 1000;
        return true;
      } catch (_) {
        const status = document.getElementById('adminSessionLoading');
        status.textContent = 'Unable to verify your session.';
        const reload = document.createElement('button');
        reload.type = 'button'; reload.className = 'btn btn-outline-dark'; reload.textContent = 'Try Again';
        reload.onclick = () => location.reload(); status.append(reload);
        return false;
      }
    })();
    return readyPromise;
  }
  function modal(id, title, symbol, body, footer = '') {
    let element = document.getElementById(id);
    if (!element) {
      element = document.createElement('div');
      element.id = id; element.className = 'modal fade admin-security-modal'; element.tabIndex = -1;
      element.setAttribute('aria-labelledby', `${id}Title`);
      element.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content"><div class="modal-header">${icon(symbol)}<h2 id="${id}Title" class="modal-title">${title}</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body">${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ''}</div></div>`;
      document.body.append(element);
    }
    refreshIcons();
    return { element, instance: bootstrap.Modal.getOrCreateInstance(element) };
  }
  function confirmIdentity() {
    if (reauthPromise) return reauthPromise;
    reauthPromise = (async () => {
      const previous = [...document.querySelectorAll('.modal.show')];
      for (const element of previous) {
        await new Promise(resolve => {
          element.addEventListener('hidden.bs.modal', resolve, { once: true });
          bootstrap.Modal.getInstance(element).hide();
        });
      }
      return await new Promise(resolve => {
      const dialog = modal('adminReauthModal', 'Confirm Your Identity', 'shield-check',
        `<form id="adminReauthForm"><div id="adminReauthPasswordGroup"><label class="form-label" for="adminReauthPassword">Current Password</label><input id="adminReauthPassword" type="password" class="form-control" autocomplete="current-password" required></div><div id="adminReauthCodeGroup" hidden><label class="form-label" for="adminReauthCode">Email Security Code</label><input id="adminReauthCode" class="form-control security-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></div></form><p id="adminReauthMessage" class="admin-security-message" role="status"></p>`,
        `<button type="button" class="btn btn-outline-dark" data-bs-dismiss="modal">Cancel</button><button id="adminReauthSubmit" type="submit" form="adminReauthForm" class="btn btn-dark">${icon('mail')}<span>Send Security Code</span></button>`);
      const form = document.getElementById('adminReauthForm');
      const password = document.getElementById('adminReauthPassword');
      const code = document.getElementById('adminReauthCode');
      const note = document.getElementById('adminReauthMessage');
      const button = document.getElementById('adminReauthSubmit');
      let stage = 'start'; let verified = false;
      password.value = ''; code.value = ''; password.required = true; code.required = false;
      document.getElementById('adminReauthPasswordGroup').hidden = false;
      document.getElementById('adminReauthCodeGroup').hidden = true;
      button.querySelector('span').textContent = 'Send Security Code'; note.textContent = '';
      form.onsubmit = async event => {
        event.preventDefault(); if (button.disabled) return;
        const controls = dialog.element.querySelectorAll('button'); controls.forEach(control => { control.disabled = true; });
        try {
          const response = await rawFetch(`/auth/admin/reauth/${stage}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stage === 'start' ? { password: password.value, email: identity.email } : { code: code.value }) });
          const data = await response.json();
          if (response.status === 401) { signin(); return; }
          if (!response.ok) throw new Error(data.message);
          password.value = '';
          if (stage === 'start') {
            stage = 'verify'; password.required = false; code.required = true;
            document.getElementById('adminReauthPasswordGroup').hidden = true;
            document.getElementById('adminReauthCodeGroup').hidden = false;
            button.querySelector('span').textContent = 'Confirm Identity'; note.className = 'admin-security-message'; note.textContent = data.message;
            code.focus();
          } else { verified = true; dialog.instance.hide(); }
        } catch (error) { note.className = 'admin-security-message security-error'; note.textContent = error.message || 'Unable to connect. Please try again.'; }
        finally { controls.forEach(control => { control.disabled = false; }); }
      };
      dialog.element.addEventListener('hidden.bs.modal', () => {
        password.value = ''; code.value = ''; reauthPromise = null;
        previous.forEach(element => bootstrap.Modal.getInstance(element).show());
        resolve(verified);
      }, { once: true });
      dialog.element.addEventListener('shown.bs.modal', () => password.focus(), { once: true });
      dialog.instance.show();
      });
    })();
    return reauthPromise;
  }

  window.fetch = async (input, options) => {
    const request = new Request(input instanceof Request ? input : new URL(input, location.href), options);
    if (new URL(request.url).origin !== location.origin) return rawFetch(request);
    const retry = request.clone();
    const response = await rawFetch(request);
    if (response.status === 401) { signin(); return response; }
    if (response.status === 428 && identity?.role === 'admin' && !request.url.includes('/auth/admin/')) {
      if (await confirmIdentity()) {
        const retried = await rawFetch(retry);
        if (retried.status === 401) signin();
        return retried;
      }
    }
    return response;
  };

  async function checkSession() {
    if (!identity || identity.role !== 'admin' || leaving) return;
    try {
      const response = await rawFetch('/auth/session', { cache: 'no-store' });
      if ([401,403].includes(response.status)) { signin(); return; }
      if (!response.ok) return;
      const data = await response.json();
      deadline = Date.now() + Number(data.remaining_seconds) * 1000;
      if (data.remaining_seconds <= 120) showWarning();
    } catch (_) {}
  }
  function showWarning() {
    if (warning) return;
    warning = modal('adminIdleModal', 'Session Expiring', 'timer', `<p class="security-warning-time" id="adminIdleCountdown"></p>`,
      `<button type="button" class="btn btn-outline-dark" onclick="AdminSecurity.logout()">${icon('log-out')}<span>Sign Out</span></button><button type="button" class="btn btn-dark" onclick="AdminSecurity.keepActive()">${icon('refresh-cw')}<span>Stay Signed In</span></button>`);
    warning.instance.show();
  }
  async function keepActive() {
    const response = await rawFetch('/auth/session/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) { if (response.status === 401) signin(); return; }
    lastHeartbeat = Date.now();
    await checkSession();
    warning?.instance.hide(); warning = null;
  }
  function activity(event) {
    if (!event.isTrusted || document.hidden) return;
    lastActivity = Date.now();
    if (identity?.role === 'admin' && lastActivity - lastHeartbeat > 60000 && !warning) {
      lastHeartbeat = lastActivity;
      keepActive().catch(() => {});
    }
  }
  ['pointerdown', 'keydown', 'scroll'].forEach(name => window.addEventListener(name, activity, { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkSession(); });
  setInterval(() => {
    if (!identity || identity.role !== 'admin' || leaving) return;
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const countdown = document.getElementById('adminIdleCountdown');
    if (countdown) countdown.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    if (seconds === 0) signin();
    else if (seconds <= 120) showWarning();
  }, 1000);
  setInterval(checkSession, 30000);

  function openSettings() {
    const dialog = modal('adminSecurityModal', 'Account Security', 'shield-check',
      `<dl class="security-status-list"><div><dt>Email Verification</dt><dd>Required</dd></div><div><dt>Idle Timeout</dt><dd>15 minutes</dd></div><div><dt>Maximum Session</dt><dd>8 hours</dd></div></dl><form id="adminPasswordForm"><label class="form-label" for="adminNewPassword">New Password</label><input id="adminNewPassword" class="form-control" type="password" autocomplete="new-password" minlength="8" required><label class="form-label mt-3" for="adminConfirmPassword">Confirm Password</label><input id="adminConfirmPassword" class="form-control" type="password" autocomplete="new-password" minlength="8" required><button class="btn btn-dark mt-3" type="submit">${icon('key-round')}<span>Update Password</span></button></form><div class="security-actions"><button id="adminRevokeSessions" class="btn btn-outline-dark" type="button">${icon('log-out')}<span>Sign Out Other Sessions</span></button><button class="btn btn-outline-dark" type="button" onclick="AdminSecurity.openAudit()">${icon('file-clock')}<span>Security Logs</span></button></div><p id="adminSecurityMessage" class="admin-security-message" role="status"></p>`);
    const note = document.getElementById('adminSecurityMessage'); note.textContent = '';
    const password = document.getElementById('adminNewPassword'); const confirm = document.getElementById('adminConfirmPassword');
    password.value = ''; confirm.value = '';
    async function action(path, payload) {
      const controls = dialog.element.querySelectorAll('button'); controls.forEach(button => { button.disabled = true; });
      try {
        let response = await rawFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.status === 428 && await confirmIdentity()) response = await rawFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.status === 401) { signin(); return; }
        const data = await response.json();
        note.className = `admin-security-message ${response.ok ? 'security-success' : 'security-error'}`; note.textContent = data.message;
        if (response.ok) { password.value = ''; confirm.value = ''; await checkSession(); }
      } catch (_) { note.className = 'admin-security-message security-error'; note.textContent = 'Unable to connect. Please try again.'; }
      finally { controls.forEach(button => { button.disabled = false; }); }
    }
    document.getElementById('adminPasswordForm').onsubmit = event => {
      event.preventDefault();
      if (password.value !== confirm.value) { note.className = 'admin-security-message security-error'; note.textContent = 'Passwords do not match.'; return; }
      action('/auth/admin/password', { password: password.value });
    };
    document.getElementById('adminRevokeSessions').onclick = () => action('/auth/admin/sessions/revoke', {});
    dialog.element.addEventListener('hidden.bs.modal', () => { password.value = ''; confirm.value = ''; }, { once: true });
    dialog.instance.show();
  }
  function openAudit() {
    bootstrap.Modal.getInstance(document.getElementById('adminSecurityModal')).hide();
    document.getElementById('auditSearch').value = '';
    document.getElementById('auditRoleFilter').value = 'all';
    document.getElementById('auditEntityFilter').value = 'account_security';
    document.getElementById('auditActionFilter').value = 'all';
    showSection('audit');
  }
  window.AdminSecurity = { ready, logout, keepActive, openSettings, openAudit };
})();
