function toggleCart() {
  document.getElementById("cartPanel")?.classList.toggle("d-none");
  renderCart();
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
      stock,
      quantity: addQuantity,
      selected: true,
      unavailable: false,
      unavailable_reason: ""
    });
  }

  saveCart(cart);
  document.getElementById("cartPanel")?.classList.remove("d-none");
}

function updateCartItem(key, quantity) {
  let nextQuantity = Number(quantity);
  const cart = syncCartWithCatalog();
  const item = cart.find(entry => entry.key === key);

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
  if (selectedCountEl) selectedCountEl.innerText = `${selectedCount} selected`;
  if (totalEl) {
    totalEl.innerText = `PHP ${total.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  if (selectAllEl) {
    const selectable = cart.filter(item => !item.unavailable && Number(item.stock || 0) > 0);
    selectAllEl.checked = selectable.length > 0 && selectedItems.length === selectable.length;
    selectAllEl.indeterminate = selectedItems.length > 0 && selectedItems.length < selectable.length;
  }
  if (!list) return;

  if (!cart.length) {
    list.innerHTML = "Cart is empty.";
    return;
  }

  list.innerHTML = cart.map(item => {
    const unavailable = item.unavailable || Number(item.stock || 0) <= 0;
    const statusText = unavailable ? (item.unavailable_reason || "Unavailable") : `Stock: ${item.stock}`;
    return `
      <div class="cart-item ${isSelected(item) ? "selected" : ""} ${unavailable ? "unavailable" : ""}">
        <label class="cart-check">
          <input type="checkbox" ${isSelected(item) ? "checked" : ""} ${unavailable ? "disabled" : ""} onchange="setCartItemSelected('${cartEscape(item.key)}', this.checked)">
        </label>
        <div class="cart-item-info">
          <strong>${cartEscape(item.name)}</strong>
          <span>${cartEscape(item.variant_name)} - PHP ${Number(item.price || 0).toLocaleString()}</span>
          <span class="${unavailable ? "cart-warning" : ""}">${cartEscape(statusText)}</span>
        </div>
        <input class="cart-qty" type="number" min="1" max="${Number(item.stock || 0)}" value="${Number(item.quantity || 1)}" ${unavailable ? "disabled" : ""} onchange="updateCartItem('${cartEscape(item.key)}', this.value)">
        <button class="btn btn-sm btn-outline-dark" onclick="updateCartItem('${cartEscape(item.key)}', 0)">Remove</button>
      </div>
    `;
  }).join("");
}

function checkoutCart() {
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
  const product = findProduct(productId);
  if (product && getProductVariants(product).length) {
    if (typeof openProductPage === "function") openProductPage(productId);
    else window.location.href = `/customer/product.html?id=${productId}`;
    return;
  }
  addToCart(productId);
}

function enhanceCart() {
  document.querySelectorAll(".product-actions").forEach(actions => {
    if (actions.querySelector(".cart-add")) return;

    const productId = actions.dataset.productId || actions.querySelector("button[onclick^='openProductPage']")?.getAttribute("onclick")?.match(/openProductPage\((\d+)/)?.[1];
    if (!productId) return;

    actions.insertAdjacentHTML(
      "afterbegin",
      `<button class="btn btn-outline-dark cart-add" onclick="cartActionFor(${productId})">Add to Cart</button>`
    );
  });
  renderCart();
}

function shouldOpenCartOnShop() {
  const params = new URLSearchParams(window.location.search);
  return params.get("cart") === "open" || localStorage.getItem("openCartOnShop") === "1";
}

function openCartFromReorderIfNeeded() {
  if (!shouldOpenCartOnShop()) return;
  localStorage.removeItem("openCartOnShop");
  renderCart();
  document.getElementById("cartPanel")?.classList.remove("d-none");
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(enhanceCart, 800);
  setTimeout(openCartFromReorderIfNeeded, 900);
  const originalRenderProducts = window.renderProducts;
  if (originalRenderProducts) {
    window.renderProducts = function renderProductsWithCart() {
      originalRenderProducts();
      setTimeout(enhanceCart, 0);
    };
  }
});