(function () {
  let activeResolve = null;
  let activeMode = "confirm";
  let lastFocusedElement = null;

  function ensureDialog() {
    let layer = document.getElementById("appDialogLayer");
    if (layer) return layer;

    layer = document.createElement("div");
    layer.id = "appDialogLayer";
    layer.className = "app-dialog-layer";
    layer.hidden = true;
    layer.innerHTML = `
      <section class="app-dialog-panel" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage">
        <header class="app-dialog-header">
          <div>
            <p id="appDialogEyebrow" class="app-dialog-eyebrow"></p>
            <h2 id="appDialogTitle" class="app-dialog-title"></h2>
          </div>
          <button class="app-dialog-close" type="button" aria-label="Close dialog"><span aria-hidden="true">&times;</span></button>
        </header>
        <form id="appDialogForm">
          <div class="app-dialog-body">
            <div id="appDialogPreview" class="app-dialog-preview" hidden></div>
            <p id="appDialogMessage" class="app-dialog-message"></p>
            <div id="appDialogDetails" class="app-dialog-details"></div>
            <div id="appDialogFields" class="app-dialog-fields"></div>
          </div>
          <footer class="app-dialog-footer">
            <button class="app-dialog-button app-dialog-cancel" type="button">Cancel</button>
            <button class="app-dialog-button app-dialog-submit" type="submit">Continue</button>
          </footer>
        </form>
      </section>`;
    document.body.appendChild(layer);

    layer.querySelector(".app-dialog-close").addEventListener("click", () => finish(null));
    layer.querySelector(".app-dialog-cancel").addEventListener("click", () => finish(activeMode === "confirm" ? false : null));
    layer.addEventListener("click", event => {
      if (event.target === layer) finish(activeMode === "confirm" ? false : null);
    });
    layer.querySelector("#appDialogForm").addEventListener("submit", event => {
      event.preventDefault();
      event.currentTarget.querySelectorAll('textarea[required], input[required]').forEach(control => {
        if (control.tagName === 'TEXTAREA' || control.type === 'text') {
          control.setCustomValidity(control.value.trim() ? '' : 'Please enter a value.');
        }
      });
      if (!event.currentTarget.reportValidity()) return;
      if (activeMode === "confirm") {
        finish(true);
        return;
      }
      const values = {};
      new FormData(event.currentTarget).forEach((value, key) => {
        values[key] = String(value);
      });
      finish(values);
    });
    layer.querySelector("#appDialogForm").addEventListener("input", event => {
      if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity('');
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !layer.hidden) finish(activeMode === "confirm" ? false : null);
    });
    return layer;
  }

  function finish(value) {
    const layer = document.getElementById("appDialogLayer");
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    document.body.classList.remove("app-dialog-open");
    if (layer.parentElement !== document.body) document.body.appendChild(layer);
    const resolve = activeResolve;
    activeResolve = null;
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") lastFocusedElement.focus();
    lastFocusedElement = null;
    if (resolve) resolve(value);
  }

  function addDetails(container, details) {
    container.replaceChildren();
    (details || []).forEach(detail => {
      const row = document.createElement("div");
      row.className = "app-dialog-detail";
      row.dataset.label = detail.label || '';
      const label = document.createElement("span");
      label.textContent = detail.label || "Detail";
      if (/^[a-z0-9-]+$/.test(detail.icon || '')) {
        const icon = document.createElement('i');
        icon.dataset.lucide = detail.icon;
        icon.setAttribute('aria-hidden', 'true');
        label.prepend(icon);
      }
      const value = document.createElement("strong");
      value.textContent = detail.value === undefined || detail.value === null ? "" : String(detail.value);
      row.append(label, value);
      container.appendChild(row);
    });
    container.hidden = !container.children.length;
  }

  function addPreview(container, preview) {
    container.replaceChildren();
    container.hidden = !preview?.items?.length;
    (preview?.items || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'app-dialog-preview-item';
      const photo = document.createElement('span');
      photo.className = 'app-dialog-preview-photo';
      const fallback = document.createElement('i');
      fallback.dataset.lucide = 'package';
      fallback.setAttribute('aria-hidden', 'true');
      photo.append(fallback);
      if (item.image) {
        const url = new URL(item.image, window.location.href);
        if (['http:', 'https:'].includes(url.protocol)) {
          const image = document.createElement('img');
          image.src = url.href;
          image.alt = item.name || 'Product';
          image.onload = () => { fallback.hidden = true; };
          image.onerror = () => { image.hidden = true; fallback.hidden = false; };
          photo.append(image);
        }
      }
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.name;
      const description = document.createElement('span');
      description.textContent = item.description;
      copy.append(name, description);
      row.append(photo, copy);
      container.append(row);
    });
  }

  function addFields(container, fields) {
    container.replaceChildren();
    (fields || []).forEach((field, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "app-dialog-field";
      const id = `appDialogField${index}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = field.label || field.name;
      let control;
      if (field.type === "textarea") {
        control = document.createElement("textarea");
        control.rows = field.rows || 4;
      } else if (field.type === "select") {
        control = document.createElement("select");
        (field.options || []).forEach(option => {
          const element = document.createElement("option");
          const normalized = typeof option === "object" ? option : { value: option, label: option };
          element.value = String(normalized.value);
          element.textContent = normalized.label;
          control.appendChild(element);
        });
      } else {
        control = document.createElement("input");
        control.type = field.type || "text";
      }
      control.id = id;
      control.name = field.name;
      control.required = Boolean(field.required);
      if (field.placeholder) control.placeholder = field.placeholder;
      if (field.min !== undefined) control.min = field.min;
      if (field.max !== undefined) control.max = field.max;
      if (field.step !== undefined) control.step = field.step;
      if (Number.isInteger(field.maxLength) && field.maxLength > 0) control.maxLength = field.maxLength;
      if (field.defaultValue !== undefined && field.defaultValue !== null) control.value = String(field.defaultValue);
      wrapper.append(label, control);
      container.appendChild(wrapper);
    });
    container.hidden = !container.children.length;
  }

  function open(options, mode) {
    const layer = ensureDialog();
    if (activeResolve) finish(activeMode === "confirm" ? false : null);
    activeMode = mode;
    lastFocusedElement = document.activeElement;
    const activeBootstrapModal = document.querySelector(".modal.show");
    if (activeBootstrapModal && !activeBootstrapModal.contains(layer)) {
      activeBootstrapModal.appendChild(layer);
    } else if (!activeBootstrapModal && layer.parentElement !== document.body) {
      document.body.appendChild(layer);
    }
    const panel = layer.querySelector(".app-dialog-panel");
    panel.dataset.tone = options.tone || "default";
    panel.dataset.variant = options.variant || '';
    addPreview(layer.querySelector('#appDialogPreview'), options.preview);
    const eyebrow = layer.querySelector("#appDialogEyebrow");
    eyebrow.textContent = options.eyebrow || (mode === "confirm" ? "Please confirm" : "Complete details");
    eyebrow.hidden = !eyebrow.textContent;
    layer.querySelector("#appDialogTitle").textContent = options.title || "Confirm action";
    const message = layer.querySelector("#appDialogMessage");
    message.textContent = options.message || "";
    message.hidden = !message.textContent;
    addDetails(layer.querySelector("#appDialogDetails"), options.details);
    addFields(layer.querySelector("#appDialogFields"), mode === "form" ? options.fields : []);
    layer.querySelector(".app-dialog-cancel").textContent = options.cancelText || "Cancel";
    layer.querySelector(".app-dialog-submit").textContent = options.confirmText || options.submitText || "Continue";
    if (/^[a-z0-9-]+$/.test(options.confirmIcon || '')) {
      const icon = document.createElement('i');
      icon.dataset.lucide = options.confirmIcon;
      icon.setAttribute('aria-hidden', 'true');
      layer.querySelector('.app-dialog-submit').prepend(icon);
    }
    window.lucide?.createIcons();
    layer.hidden = false;
    document.body.classList.add("app-dialog-open");

    return new Promise(resolve => {
      activeResolve = resolve;
      requestAnimationFrame(() => {
        const firstField = layer.querySelector(".app-dialog-fields input, .app-dialog-fields select, .app-dialog-fields textarea");
        (firstField || layer.querySelector(".app-dialog-submit")).focus();
      });
    });
  }

  window.AppDialog = {
    confirm(options) {
      return open(options || {}, "confirm");
    },
    form(options) {
      return open(options || {}, "form");
    },
    close() {
      finish(activeMode === "confirm" ? false : null);
    }
  };
})();
