(() => {
  let dialog, file, previewUrl, busy = false, assignmentId, selection = 0;
  let cameraStream, cameraGeneration = 0, capturing = false;
  let needsSession = false;
  let options = {};
  function initialize() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'delivery-proof-dialog rider-proof-dialog';
    dialog.setAttribute('aria-labelledby', 'deliveryProofTitle');
    dialog.innerHTML = `<header><div class="proof-heading"><span class="proof-heading-icon"><i data-lucide="package-check" aria-hidden="true"></i></span><div><p class="proof-eyebrow">Delivery confirmation</p><h2 id="deliveryProofTitle">Proof of Delivery</h2></div></div><button type="button" class="proof-close" aria-label="Close" title="Close"><i data-lucide="x" aria-hidden="true"></i></button></header>
      <form><div class="proof-body"><div class="proof-order-context" hidden><strong class="proof-product"></strong><span class="proof-recipient"></span></div>
      <div class="proof-field-heading"><label for="deliveryProofPhoto">Delivery photo</label><span>Required</span></div>
      <input id="deliveryProofPhoto" type="file" accept="image/jpeg,image/png,image/webp" hidden aria-describedby="proofFileHelp">
      <div class="proof-upload-area"><button type="button" class="proof-browse"><i data-lucide="image-up" aria-hidden="true"></i><strong>Add delivery photo</strong></button><img class="proof-preview" alt="Delivery photo preview" hidden></div>
      <div class="proof-photo-tools"><button type="button" class="proof-change"><i data-lucide="folder-open" aria-hidden="true"></i><span>Upload Photo</span></button><button type="button" class="proof-camera"><i data-lucide="camera" aria-hidden="true"></i>Take Photo</button></div>
      <input class="proof-camera-input" type="file" accept="image/*" capture="environment" hidden>
      <div class="proof-file-details" hidden><div><strong class="proof-file-name"></strong><span class="proof-file-size"></span></div><button type="button" class="proof-remove" aria-label="Remove photo" title="Remove photo"><i data-lucide="trash-2" aria-hidden="true"></i></button></div>
      <p id="proofFileHelp" class="proof-help">JPG, PNG, WEBP &middot; Up to 5 MB</p><p class="proof-error" role="alert"></p></div>
      <footer><button type="button" class="proof-cancel">Cancel</button><button type="submit" class="proof-submit" disabled><i data-lucide="check" aria-hidden="true"></i><span>Submit Proof</span></button></footer>
      <section class="proof-camera-view" aria-label="Delivery camera" hidden><video autoplay muted playsinline aria-label="Live camera preview"></video><p class="proof-camera-status" role="status"></p><div class="proof-camera-actions"><button type="button" class="proof-camera-back"><i data-lucide="arrow-left" aria-hidden="true"></i>Back</button><button type="button" class="proof-shutter proof-submit" disabled><i data-lucide="camera" aria-hidden="true"></i><span>Capture Photo</span></button></div></section>
      <section class="proof-auth-view" hidden aria-labelledby="proofAuthTitle"><h3 id="proofAuthTitle">Confirm your account</h3><p class="proof-help">Your session needs a new sign-in. Your selected photo is saved in this modal.</p><label for="proofAuthEmail">Email</label><input id="proofAuthEmail" type="email" autocomplete="username"><label for="proofAuthPassword">Password</label><input id="proofAuthPassword" type="password" autocomplete="current-password"><p class="proof-auth-error proof-error" role="alert"></p><div class="proof-camera-actions"><button type="button" class="proof-auth-back"><i data-lucide="arrow-left" aria-hidden="true"></i>Back</button><button type="button" class="proof-auth-submit proof-submit"><i data-lucide="log-in" aria-hidden="true"></i><span>Sign In &amp; Submit</span></button></div></section></form>`;
    document.body.append(dialog);
    dialog.querySelectorAll('.proof-close, .proof-cancel').forEach(button => button.onclick = () => { if (!busy) dialog.close(); });
    dialog.addEventListener('cancel', event => {
      if (busy) event.preventDefault();
      else if (!dialog.querySelector('.proof-auth-view').hidden) { event.preventDefault(); closeSignIn(); }
      else if (!dialog.querySelector('.proof-camera-view').hidden) { event.preventDefault(); stopCamera(); }
    });
    dialog.addEventListener('close', reset);
    dialog.querySelector('.proof-camera').onclick = openCamera;
    dialog.querySelector('.proof-camera-back').onclick = stopCamera;
    dialog.querySelector('.proof-shutter').onclick = capturePhoto;
    dialog.querySelector('.proof-auth-back').onclick = closeSignIn;
    dialog.querySelector('.proof-auth-submit').onclick = confirmSession;
    dialog.querySelectorAll('.proof-browse, .proof-change').forEach(button => button.onclick = () => dialog.querySelector('#deliveryProofPhoto').click());
    dialog.querySelector('.proof-remove').onclick = reset;
    const area = dialog.querySelector('.proof-upload-area');
    area.addEventListener('dragover', event => { event.preventDefault(); if (!busy) area.classList.add('dragging'); });
    area.addEventListener('dragleave', () => area.classList.remove('dragging'));
    area.addEventListener('drop', event => { event.preventDefault(); area.classList.remove('dragging'); if (!busy) choose(event.dataTransfer.files[0]); });
    dialog.querySelectorAll('input[type=file]').forEach(input => input.onchange = () => choose(input.files[0]));
    dialog.querySelector('form').onsubmit = submit;
  }
  function reset() {
    stopCamera();
    closeSignIn(); needsSession = false;
    selection++;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; file = null;
    dialog.querySelector('form').reset();
    dialog.querySelector('img').hidden = true;
    dialog.querySelector('img').removeAttribute('src');
    dialog.querySelector('.proof-browse').hidden = false;
    dialog.querySelector('.proof-upload-area').classList.remove('has-photo', 'dragging');
    dialog.querySelector('.proof-file-details').hidden = true;
    dialog.querySelector('.proof-change span').textContent = 'Upload Photo';
    dialog.querySelector('.proof-error').textContent = '';
    dialog.querySelector('.proof-submit').disabled = true;
  }
  function closeSignIn() {
    if (!dialog) return;
    dialog.querySelector('.proof-auth-view').hidden = true;
    dialog.querySelector('.proof-body').hidden = false;
    dialog.querySelector('footer').hidden = false;
    dialog.querySelector('#proofAuthEmail').value = '';
    dialog.querySelector('#proofAuthPassword').value = '';
  }
  function showSignIn() {
    stopCamera();
    needsSession = true;
    dialog.querySelector('.proof-body').hidden = true;
    dialog.querySelector('footer').hidden = true;
    dialog.querySelector('.proof-auth-view').hidden = false;
    dialog.querySelector('.proof-auth-error').textContent = '';
    let account = {};
    try { account = JSON.parse(localStorage.getItem('currentUser') || '{}'); } catch { /* Ask for email if the saved account is unavailable. */ }
    const email = dialog.querySelector('#proofAuthEmail');
    email.value = account.email || ''; email.readOnly = Boolean(account.email);
  }
  async function confirmSession() {
    if (busy) return;
    const email = dialog.querySelector('#proofAuthEmail');
    const password = dialog.querySelector('#proofAuthPassword');
    const error = dialog.querySelector('.proof-auth-error');
    error.textContent = '';
    if (!email.value.trim() || !email.validity.valid || !password.value) {
      error.textContent = 'Enter your account email and password.'; return;
    }
    const payload = { email: email.value.trim(), password: password.value };
    const expectedActor = Number(actorPayload().actor_id);
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button, input').forEach(control => control.disabled = true);
    const label = dialog.querySelector('.proof-auth-submit span');
    label.textContent = 'Signing in...';
    let verified = false;
    try {
      const response = await fetch('/auth/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to sign in. Please retry.');
      if (Number(data.user?.id) !== expectedActor || String(data.user?.role).toLowerCase() !== (options.role || 'rider')) throw new Error('Sign in with the same account to confirm this delivery.');
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      needsSession = false; verified = true;
      closeSignIn();
    } catch (failure) { error.textContent = failure.message || 'Unable to sign in. Please retry.'; }
    finally {
      password.value = ''; busy = false;
      dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('button, input').forEach(control => control.disabled = false);
      dialog.querySelector('.proof-submit').disabled = !file;
      label.textContent = 'Sign In & Submit';
    }
    if (verified) await submit({ preventDefault() {} });
    else password.focus();
  }
  function stopCamera() {
    cameraGeneration++;
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null; capturing = false;
    if (!dialog) return;
    dialog.querySelector('video').srcObject = null;
    dialog.querySelector('.proof-camera-view').hidden = true;
    dialog.querySelector('.proof-body').hidden = false;
    dialog.querySelector('footer').hidden = false;
    dialog.querySelector('.proof-shutter').disabled = true;
    dialog.querySelector('.proof-shutter span').textContent = 'Capture Photo';
    dialog.querySelector('.proof-submit').disabled = !file || busy;
  }
  async function openCamera() {
    if (busy) return;
    dialog.querySelector('.proof-error').textContent = '';
    // Mobile browsers use the native camera and return its photo to this input.
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      const input = dialog.querySelector('.proof-camera-input');
      input.value = ''; input.click(); return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      dialog.querySelector('.proof-error').textContent = 'Camera requires HTTPS or localhost. You can still use Upload Photo.'; return;
    }
    stopCamera();
    const current = cameraGeneration;
    dialog.querySelector('.proof-body').hidden = true;
    dialog.querySelector('footer').hidden = true;
    dialog.querySelector('.proof-camera-view').hidden = false;
    const status = dialog.querySelector('.proof-camera-status');
    const video = dialog.querySelector('video');
    status.textContent = 'Opening camera...';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (current !== cameraGeneration || !dialog.open) { stream.getTracks().forEach(track => track.stop()); return; }
      cameraStream = stream;
      video.srcObject = stream;
      await video.play();
      if (current !== cameraGeneration) return;
      status.textContent = '';
      dialog.querySelector('.proof-shutter').disabled = false;
      dialog.querySelector('.proof-shutter').focus();
    } catch (error) {
      if (current !== cameraGeneration) return;
      stopCamera();
      const messages = { NotAllowedError: 'Camera access was denied. Allow camera permission in your browser, then try again.', NotFoundError: 'No camera was found. Connect a camera or use Upload Photo.', NotReadableError: 'Camera is busy or unavailable. Close other camera apps, then try again.' };
      dialog.querySelector('.proof-error').textContent = messages[error.name] || 'Unable to open the camera. Try again or use Upload Photo.';
      dialog.querySelector('.proof-camera').focus();
    }
  }
  function capturePhoto() {
    const video = dialog.querySelector('video');
    if (capturing || !cameraStream || !video.videoWidth || !video.videoHeight) return;
    const current = cameraGeneration;
    capturing = true;
    dialog.querySelector('.proof-shutter').disabled = true;
    dialog.querySelector('.proof-shutter span').textContent = 'Capturing...';
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (current !== cameraGeneration) return;
      stopCamera();
      if (!blob) { dialog.querySelector('.proof-error').textContent = 'Unable to capture the photo. Please try again.'; return; }
      choose(new File([blob], `delivery-${assignmentId}-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      dialog.querySelector('.proof-change').focus();
    }, 'image/jpeg', .9);
  }
  function choose(selected) {
    if (!selected || busy) return;
    reset();
    const current = selection;
    file = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const image = dialog.querySelector('img');
    image.hidden = true;
    dialog.querySelector('.proof-submit').disabled = true;
    const error = dialog.querySelector('.proof-error');
    error.textContent = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || selected.size > 5 * 1024 * 1024) {
      error.textContent = 'Choose a JPG, PNG, or WEBP photo of 5 MB or smaller.'; return;
    }
    previewUrl = URL.createObjectURL(selected);
    image.onload = () => {
      if (current !== selection) return;
      file = selected; image.hidden = false;
      dialog.querySelector('.proof-browse').hidden = true;
      dialog.querySelector('.proof-upload-area').classList.add('has-photo');
      dialog.querySelector('.proof-file-details').hidden = false;
      dialog.querySelector('.proof-file-name').textContent = selected.name;
      dialog.querySelector('.proof-file-size').textContent = `${(selected.size / 1024 / 1024).toFixed(2)} MB`;
      dialog.querySelector('.proof-change span').textContent = 'Change Photo';
      dialog.querySelector('.proof-submit').disabled = false;
    };
    image.onerror = () => { if (current === selection) error.textContent = 'This photo could not be opened. Choose another photo.'; };
    image.src = previewUrl;
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !file) return;
    if (needsSession) {
      if (dialog.querySelector('.proof-auth-view').hidden) { showSignIn(); dialog.querySelector('#proofAuthPassword').focus(); return; }
      await confirmSession(); return;
    }
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    dialog.querySelectorAll('button, input').forEach(control => control.disabled = true);
    const label = dialog.querySelector('.proof-submit span');
    label.textContent = 'Uploading...';
    const error = dialog.querySelector('.proof-error');
    error.textContent = '';
    try {
      const form = new FormData(); form.append('delivery_proof', file);
      const res = await fetch(`${options.basePath || '/rider'}/assignments/${assignmentId}/delivery-proof`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Actor-Id': String(actorPayload().actor_id) }, body: form });
      const data = await res.json();
      if (res.status === 401) { showSignIn(); return; }
      if (!res.ok) throw new Error(data.message || 'Unable to upload delivery proof. Please retry.');
      dialog.close();
      if (options.onComplete) await options.onComplete();
      else await loadAssignments();
    } catch (failure) { error.textContent = failure.message || 'Upload failed. Please retry.'; }
    finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      dialog.querySelectorAll('button, input').forEach(control => control.disabled = false);
      dialog.querySelector('.proof-submit').disabled = !file;
      label.textContent = 'Submit Proof';
      if (needsSession) dialog.querySelector('#proofAuthPassword').focus();
    }
  }
  window.DeliveryProofRider = { open(id, item, configuration = {}) {
    options = configuration;
    initialize(); assignmentId = Number(id); reset();
    const product = item?.items?.map(product => product.product_name).filter(Boolean).join(', ') || '';
    dialog.querySelector('.proof-order-context').hidden = !product;
    dialog.querySelector('.proof-product').textContent = product;
    dialog.querySelector('.proof-recipient').textContent = item?.customer_display_name || '';
    dialog.showModal(); window.lucide?.createIcons();
  } };
})();
