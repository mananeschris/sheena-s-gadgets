function initializeCartPanel() {
  const panel = document.getElementById("cartPanel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="cart-head"><div><h2>Shopping Cart</h2><span id="cartItemSummary">0 items</span></div>
      <button type="button" class="cart-icon-button" aria-label="Close cart" title="Close cart" onclick="closeCart()"><i data-lucide="x" aria-hidden="true"></i></button></div>
    <div id="cartSelectionBar" class="cart-selection-bar"><label class="cart-select-all"><input type="checkbox" id="cartSelectAll" onchange="toggleSelectAllCart(this.checked)">Select all</label><span id="cartSelectionSummary"></span></div>
    <div id="cartList" class="cart-list"></div>
    <div id="cartFooter" class="cart-footer"><div><small id="cartSelectedCount">0 selected</small><strong id="cartTotal"></strong></div>
      <button id="cartCheckoutButton" type="button" onclick="checkoutCart()" disabled><i data-lucide="shopping-bag" aria-hidden="true"></i><span>Checkout</span><i data-lucide="arrow-right" aria-hidden="true"></i></button></div>`;
  document.getElementById("cartButton")?.setAttribute("aria-controls", "cartPanel");
  document.getElementById("cartButton")?.setAttribute("aria-expanded", "false");
  renderCart();
}

function closeCart(restoreFocus = true) {
  const panel = document.getElementById("cartPanel");
  if (!panel || panel.classList.contains("d-none")) return;
  panel.classList.add("d-none");
  document.getElementById("cartButton")?.setAttribute("aria-expanded", "false");
  if (restoreFocus) document.getElementById("cartButton")?.focus();
}

function openCartPanel(focusClose = false) {
  const panel = document.getElementById("cartPanel");
  if (!panel) return;
  window.closeCustomerNotifications?.(false);
  renderCart();
  panel.classList.remove("d-none");
  document.getElementById("cartButton")?.setAttribute("aria-expanded", "true");
  if (focusClose) panel.querySelector('[aria-label="Close cart"]')?.focus();
}

function toggleCart() {
  if (!isCustomerLoggedIn()) {
    showGuestAccountModal();
    return;
  }
  const panel = document.getElementById("cartPanel");
  if (panel?.classList.contains("d-none")) openCartPanel(true);
  else closeCart();
}

function getCartCurrentUser() {
  try {
    const user = JSON.parse(localStorage.getItem("currentUser") || "null");
    if (!user) return null;
    user.role = String(user.role || "customer").toLowerCase();
    return user;
  } catch (error) {
    localStorage.removeItem("currentUser");
    return null;
  }
}

function isCustomerLoggedIn() {
  const user = getCartCurrentUser();
  return Boolean(user && user.role === "customer");
}

function setGuestCartAccessState() {
  const isLoggedIn = isCustomerLoggedIn();
  const cartButton = document.getElementById("cartButton");
  const cartPanel = document.getElementById("cartPanel");

  if (cartButton) {
    cartButton.classList.toggle("d-none", !isLoggedIn);
    cartButton.toggleAttribute("hidden", !isLoggedIn);
    cartButton.setAttribute("aria-hidden", isLoggedIn ? "false" : "true");
  }

  if (!isLoggedIn) {
    cartPanel?.classList.add("d-none");
    document.querySelectorAll(".cart-add, [data-guest-cart-action]").forEach(button => {
      button.classList.add("d-none");
      button.toggleAttribute("hidden", true);
    });
  }
}

function showGuestAccountModal() {
  const modalEl = document.getElementById("guestAccountModal");
  if (modalEl && window.bootstrap?.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    return;
  }
  alert("You must create or login an account first.");
}

function continueAsGuest() {
  const modalEl = document.getElementById("guestAccountModal");
  if (modalEl && window.bootstrap?.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
  }
}

function goToCustomerAuth(mode = "login") {
  const target = mode === "register" ? "/auth.html?mode=register" : "/auth.html";
  window.location.href = target;
}

function getCart() {
  try {
    const cart = JSON.parse(localStorage.getItem("cart") || "[]");
    return Array.isArray(cart) ? cart : [];
  } catch (error) {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
  renderCart();
}

function cartEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function catalogProducts() {
  try {
    if (Array.isArray(window.allProducts)) return window.allProducts;
    if (typeof allProducts !== "undefined" && Array.isArray(allProducts)) return allProducts;
  } catch (error) {
  }
  return [];
}

function getProductVariants(product) {
  try {
    return product.variants ? JSON.parse(product.variants) : [];
  } catch (error) {
    return [];
  }
}

function cartProductImages(product) {
  if (!product) return [];
  if (Array.isArray(product.images)) return product.images.filter(Boolean);

  try {
    const parsedImages = JSON.parse(product.images || "[]");
    if (Array.isArray(parsedImages)) return parsedImages.filter(Boolean);
  } catch (error) {
  }

  return product.image ? [product.image] : [];
}

function productImageOf(product, fallback = "") {
  return cartProductImages(product)[0] || product?.image || fallback || "";
}

function findProduct(productId) {
  return catalogProducts().find(product => Number(product.id) === Number(productId));
}

function getVariant(product, variantIndex) {
  if (variantIndex === "" || variantIndex === null || variantIndex === undefined) return null;
  return getProductVariants(product)[Number(variantIndex)] || null;
}

function stockOf(product, variantIndex) {
  const variant = getVariant(product, variantIndex);
  return Number(variant ? variant.stock : product.stock || 0);
}

function priceOf(product, variantIndex) {
  const variant = getVariant(product, variantIndex);
  return Number(variant ? variant.price : product.price || 0);
}

function nameOf(product, variantIndex) {
  const variant = getVariant(product, variantIndex);
  return variant ? variant.name : "Default";
}

function cartVariantValue(value) {
  return value === null || value === undefined ? "" : value;
}

function cartProductSnapshot(item) {
  const product = findProduct(item.product_id);
  if (!product) {
    return {
      ...item,
      stock: 0,
      selected: false,
      unavailable: true,
      unavailable_reason: "Product no longer available"
    };
  }

  const variants = getProductVariants(product);
  const variant = getVariant(product, item.variant_index);
  if (variants.length && !variant) {
    return {
      ...item,
      image: productImageOf(product, item.image),
      name: product.name || item.name,
      stock: 0,
      selected: false,
      unavailable: true,
      unavailable_reason: "Variant no longer available"
    };
  }

  const stock = stockOf(product, item.variant_index);
  const unavailable = stock <= 0;
  const quantity = unavailable
    ? Math.max(Number(item.quantity || 1), 1)
    : Math.min(Math.max(Number(item.quantity || 1), 1), stock);

  return {
    ...item,
    image: productImageOf(product, item.image),
    name: product.name || item.name,
    variant_name: nameOf(product, item.variant_index),
    price: priceOf(product, item.variant_index),
    stock,
    quantity,
    selected: unavailable ? false : item.selected !== false,
    unavailable,
    unavailable_reason: unavailable ? "Out of stock" : ""
  };
}

function syncCartWithCatalog() {
  const cart = getCart();
  if (!cart.length || !catalogProducts().length) return cart;

  const synced = cart.map(cartProductSnapshot);
  if (JSON.stringify(cart) !== JSON.stringify(synced)) {
    localStorage.setItem("cart", JSON.stringify(synced));
  }
  return synced;
}

function addToCart(productId, variantIndex = "", quantity = 1) {
  if (!isCustomerLoggedIn()) {
    showGuestAccountModal();
    return;
  }

  const product = findProduct(productId);
  if (!product) return alert("Product not found");

  const variants = getProductVariants(product);
  if (variants.length && (variantIndex === "" || variantIndex === null || variantIndex === undefined)) {
    if (typeof openProductPage === "function") {
      openProductPage(product.id);
    } else if (typeof openProductDetails === "function") {
      openProductDetails(product.id);
    } else {
      window.location.href = `/customer/product.html?id=${product.id}`;
    }
    return;
  }

  const addQuantity = Math.max(Number(quantity || 1), 1);
  const stock = stockOf(product, variantIndex);
  if (stock <= 0) return alert("This item is out of stock.");

  const key = `${productId}_${variantIndex}`;
  const cart = syncCartWithCatalog();
  const existingItem = cart.find(item => item.key === key);
  const nextQuantity = (existingItem ? Number(existingItem.quantity) : 0) + addQuantity;

  if (nextQuantity > stock) return alert("Not enough stock available");

  if (existingItem) {
    existingItem.quantity = nextQuantity;
    existingItem.stock = stock;
    existingItem.price = priceOf(product, variantIndex);
    existingItem.image = productImageOf(product, existingItem.image);
    existingItem.selected = true;
    existingItem.unavailable = false;
    existingItem.unavailable_reason = "";
  } else {
    cart.push({
      key,
      product_id: Number(productId),
      variant_index: variantIndex,
      name: product.name,
      variant_name: nameOf(product, variantIndex),
      price: priceOf(product, variantIndex),
      image: productImageOf(product),
      stock,
      quantity: addQuantity,
      selected: true,
      unavailable: false,
      unavailable_reason: ""
    });
  }

  saveCart(cart);
  openCartPanel();
}

function updateCartItem(key, quantity) {
  let nextQuantity = Number(quantity);
  const cart = syncCartWithCatalog();
  const item = cart.find(entry => entry.key === key);

  if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
    renderCart();
    return;
  }

  if (item?.unavailable) {
    if (nextQuantity > 0) alert(item.unavailable_reason || "This item is unavailable.");
    nextQuantity = 0;
  }

  if (item && nextQuantity > Number(item.stock)) {
    alert("Not enough stock available");
    nextQuantity = Number(item.stock);
  }

  saveCart(
    cart
      .filter(entry => entry.key !== key || nextQuantity > 0)
      .map(entry => entry.key === key ? { ...entry, quantity: nextQuantity } : entry)
  );
}

function isSelected(item) {
  return item.selected !== false && !item.unavailable && Number(item.stock || 0) > 0 && Number(item.quantity || 0) > 0;
}

function setCartItemSelected(key, selected) {
  saveCart(syncCartWithCatalog().map(item => {
    if (item.key !== key) return item;
    return { ...item, selected: selected && !item.unavailable && Number(item.stock || 0) > 0 };
  }));
}

function toggleSelectAllCart(selected) {
  saveCart(syncCartWithCatalog().map(item => ({
    ...item,
    selected: selected && !item.unavailable && Number(item.stock || 0) > 0
  })));
}

function renderCart() {
  const cart = syncCartWithCatalog();
  const list = document.getElementById("cartList");
  const selectedItems = cart.filter(isSelected);
  let count = 0;
  let selectedCount = 0;
  let total = 0;

  cart.forEach(item => {
    count += Number(item.quantity);
  });
  selectedItems.forEach(item => {
    selectedCount += Number(item.quantity);
    total += Number(item.price) * Number(item.quantity);
  });

  const countEl = document.getElementById("cartCount");
  const selectedCountEl = document.getElementById("cartSelectedCount");
  const totalEl = document.getElementById("cartTotal");
  const selectAllEl = document.getElementById("cartSelectAll");

  if (countEl) countEl.innerText = count;
  const summaryEl = document.getElementById("cartItemSummary");
  if (summaryEl) summaryEl.textContent = `${count} ${count === 1 ? "item" : "items"}`;
  if (selectedCountEl) selectedCountEl.innerText = `${selectedCount} ${selectedCount === 1 ? "item" : "items"} selected`;
  const selectionSummary = document.getElementById("cartSelectionSummary");
  if (selectionSummary) selectionSummary.textContent = `${selectedItems.length} of ${cart.length} selected`;
  const checkoutButton = document.getElementById("cartCheckoutButton");
  if (checkoutButton) checkoutButton.disabled = selectedItems.length === 0;
  const selectionBar = document.getElementById("cartSelectionBar");
  if (selectionBar) selectionBar.hidden = cart.length === 0;
  const footer = document.getElementById("cartFooter");
  if (footer) footer.hidden = cart.length === 0;
  if (totalEl) {
    totalEl.innerText = `₱${total.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  if (selectAllEl) {
    const selectable = cart.filter(item => !item.unavailable && Number(item.stock || 0) > 0);
    selectAllEl.checked = selectable.length > 0 && selectedItems.length === selectable.length;
    selectAllEl.indeterminate = selectedItems.length > 0 && selectedItems.length < selectable.length;
    selectAllEl.disabled = selectable.length === 0;
  }
  if (!list) return;

  if (!cart.length) {
    list.innerHTML = `<div class="cart-empty"><i data-lucide="shopping-cart" aria-hidden="true"></i><strong>Your cart is empty</strong><span>No items added yet.</span><a href="/customer/shop.html#products">Browse products<i data-lucide="arrow-right" aria-hidden="true"></i></a></div>`;
    window.lucide?.createIcons();
    return;
  }

  list.innerHTML = cart.map(item => {
    const unavailable = item.unavailable || Number(item.stock || 0) <= 0;
    const statusText = unavailable ? (item.unavailable_reason || "Unavailable") : `Stock: ${item.stock}`;
    const productId = Number(item.product_id || 0);
    const productName = cartEscape(item.name);
    const imageSrc = cartEscape(item.image || "");
    const key = cartEscape(item.key);
    const amount = value => `&#8369;${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return `
      <article class="cart-item ${isSelected(item) ? "selected" : ""} ${unavailable ? "unavailable" : ""}" data-cart-key="${key}">
        <label class="cart-check">
          <input type="checkbox" aria-label="Select ${productName}" ${isSelected(item) ? "checked" : ""} ${unavailable ? "disabled" : ""} onchange="setCartItemSelected(this.closest('[data-cart-key]').dataset.cartKey, this.checked)">
        </label>
        <a class="cart-thumb" href="/customer/product.html?id=${productId}" aria-label="View ${productName}">
          <span class="cart-photo-fallback" ${imageSrc ? "hidden" : ""}><i data-lucide="image" aria-hidden="true"></i></span>
          ${imageSrc ? `<img src="${imageSrc}" alt="${productName}" onerror="this.hidden=true;this.previousElementSibling.hidden=false">` : ""}
        </a>
        <div class="cart-item-info">
          <a class="cart-product-name" href="/customer/product.html?id=${productId}">${productName}</a>
          ${item.variant_name && item.variant_name !== "Default" ? `<span>${cartEscape(item.variant_name)}</span>` : ""}
          <span>${amount(item.price)} each</span>
          <span class="${unavailable ? "cart-warning" : "cart-stock"}">${cartEscape(statusText)}</span>
        </div>
        <div class="cart-item-controls"><div class="cart-quantity">
          <button type="button" aria-label="Decrease quantity of ${productName}" title="Decrease quantity" data-step="-1" ${unavailable || Number(item.quantity) <= 1 ? "disabled" : ""} onclick="stepCartQuantity(this)"><i data-lucide="minus" aria-hidden="true"></i></button>
          <input class="cart-qty" aria-label="Quantity of ${productName}" type="number" min="1" max="${Number(item.stock || 0)}" value="${Number(item.quantity || 1)}" ${unavailable ? "disabled" : ""} onchange="updateCartItem(this.closest('[data-cart-key]').dataset.cartKey, this.value || -1)">
          <button type="button" aria-label="Increase quantity of ${productName}" title="Increase quantity" data-step="1" ${unavailable || Number(item.quantity) >= Number(item.stock) ? "disabled" : ""} onclick="stepCartQuantity(this)"><i data-lucide="plus" aria-hidden="true"></i></button>
        </div><strong class="cart-item-total">${amount(Number(item.price) * Number(item.quantity))}</strong></div>
        <button type="button" class="cart-remove cart-icon-button" aria-label="Remove ${productName} from cart" title="Remove item" onclick="updateCartItem(this.closest('[data-cart-key]').dataset.cartKey, 0)"><i data-lucide="trash-2" aria-hidden="true"></i></button>
      </article>
    `;
  }).join("");
  window.lucide?.createIcons();
}

function stepCartQuantity(button) {
  const row = button.closest("[data-cart-key]");
  const key = row.dataset.cartKey;
  const step = Number(button.dataset.step);
  updateCartItem(key, Number(row.querySelector(".cart-qty").value) + step);
  const updatedRow = [...document.querySelectorAll("[data-cart-key]")].find(item => item.dataset.cartKey === key);
  const control = updatedRow?.querySelector(`[data-step="${step}"]`);
  if (control && !control.disabled) control.focus();
  else updatedRow?.querySelector(".cart-qty")?.focus();
}

function checkoutCart() {
  if (!isCustomerLoggedIn()) {
    showGuestAccountModal();
    return;
  }

  const selectedItems = syncCartWithCatalog().filter(isSelected);
  if (!selectedItems.length) return alert("Please select available item(s) to checkout.");

  localStorage.setItem("checkout", JSON.stringify({
    mode: "cart",
    items: selectedItems.map(item => ({
      key: item.key,
      product_id: item.product_id,
      variant_index: cartVariantValue(item.variant_index),
      quantity: Number(item.quantity || 1)
    }))
  }));
  location.href = "/checkout.html";
}

function cartActionFor(productId) {
  if (!isCustomerLoggedIn()) {
    showGuestAccountModal();
    return;
  }

  const product = findProduct(productId);
  if (product && getProductVariants(product).length) {
    if (typeof openProductPage === "function") openProductPage(productId);
    else window.location.href = `/customer/product.html?id=${productId}`;
    return;
  }
  addToCart(productId);
}

function enhanceCart() {
  if (!isCustomerLoggedIn()) {
    setGuestCartAccessState();
    return;
  }

  document.querySelectorAll(".product-actions").forEach(actions => {
    if (actions.querySelector(".cart-add")) return;

    const productId = actions.dataset.productId || actions.querySelector("button[onclick^='openProductPage']")?.getAttribute("onclick")?.match(/openProductPage\((\d+)/)?.[1];
    if (!productId) return;

    actions.insertAdjacentHTML(
      "afterbegin",
      `<button class="btn btn-outline-dark cart-add" onclick="event.stopPropagation(); cartActionFor(${productId})">Add to Cart</button>`
    );
  });
  renderCart();
}

function shouldOpenCartOnShop() {
  const params = new URLSearchParams(window.location.search);
  return params.get("cart") === "open" || localStorage.getItem("openCartOnShop") === "1";
}

function openCartFromReorderIfNeeded() {
  if (!isCustomerLoggedIn()) {
    localStorage.removeItem("openCartOnShop");
    setGuestCartAccessState();
    return;
  }

  if (!shouldOpenCartOnShop()) return;
  localStorage.removeItem("openCartOnShop");
  renderCart();
  openCartPanel();
}

document.addEventListener("DOMContentLoaded", () => {
  initializeCartPanel();
  setGuestCartAccessState();
  setTimeout(enhanceCart, 800);
  setTimeout(openCartFromReorderIfNeeded, 900);
  const originalRenderProducts = window.renderProducts;
  if (originalRenderProducts) {
    window.renderProducts = function renderProductsWithCart(...args) {
      originalRenderProducts(...args);
      setTimeout(enhanceCart, 0);
    };
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeCart();
});
document.addEventListener("click", event => {
  if (!event.target.closest("#cartPanel, #cartButton, #modalCartButton, [onclick*='addToCart'], [onclick*='addSelectedToCart'], .cart-add")) closeCart(false);
}, true);
window.addEventListener("storage", event => {
  if (event.key === "cart") renderCart();
});
