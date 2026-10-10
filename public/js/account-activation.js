(() => {
  let token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  history.replaceState(null,'',location.pathname);
  const form = document.getElementById('activationForm');
  const status = document.getElementById('activationStatus');
  const retry = document.getElementById('activationRetry');
  const icons = () => window.lucide?.createIcons();
  async function request(path,payload) {
    const response = await fetch(`/account-invitations/${path}`,{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(payload) });
    const data = await response.json();
    return { response,data };
  }
  async function inspect() {
    retry.hidden = true; form.hidden = true;
    if (!/^[a-f0-9]{64}$/.test(token)) { status.textContent = 'This invitation is invalid or expired. Ask the admin for a new invitation.'; return; }
    status.textContent = 'Checking invitation...';
    try {
      const { response,data } = await request('inspect',{ token });
      if (!response.ok) { status.textContent = data.message; retry.hidden = response.status >= 500 ? false : true; return; }
      document.getElementById('activationName').textContent = data.user.name;
      document.getElementById('activationEmail').textContent = data.user.email;
      document.getElementById('activationRole').textContent = data.user.role;
      document.getElementById('activationIdentity').hidden = false;
      status.textContent = 'Set your password to activate your account.';
      form.hidden = false;
    } catch (_) { status.textContent = 'Unable to check invitation. Please try again.'; retry.hidden = false; }
  }
  document.querySelectorAll('[data-toggle]').forEach(button => button.addEventListener('click',() => {
    const input = document.getElementById(button.dataset.toggle);
    const show = input.type === 'password'; input.type = show ? 'text' : 'password';
    const label = `${show ? 'Hide' : 'Show'} ${button.dataset.toggle === 'activationConfirm' ? 'confirm password' : 'password'}`;
    button.title = label; button.setAttribute('aria-label',label);
    button.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}" aria-hidden="true"></i>`; icons();
  }));
  form.addEventListener('submit',async event => {
    event.preventDefault();
    const submit = document.getElementById('activationSubmit');
    if (submit.disabled) return;
    const password = document.getElementById('activationPassword').value;
    const error = document.getElementById('activationError'); error.textContent = '';
    if (password !== document.getElementById('activationConfirm').value) { error.textContent = 'Passwords do not match.'; return; }
    submit.disabled = true;
    try {
      const { response,data } = await request('activate',{ token,password });
      if (!response.ok) { error.textContent = data.message; return; }
      token = ''; form.reset(); form.hidden = true;
      document.getElementById('activationTitle').textContent = 'Account Activated';
      status.textContent = data.message;
      document.getElementById('activationSignin').innerHTML = '<i data-lucide="log-in" aria-hidden="true"></i>Sign In';
      icons();
    } catch (_) { error.textContent = 'Unable to connect. Please try again.'; }
    finally { submit.disabled = false; }
  });
  retry.addEventListener('click',inspect); icons(); inspect();
})();
