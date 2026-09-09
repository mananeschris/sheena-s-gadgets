let allProducts = [];
let productModal;
let modalSelectedVariantIndex = null;
let modalCurrentProduct = null;
let customerNotifications = [];
const PRODUCT_CATEGORIES = [
  "Phones",
  "Tablets",
  "Audio",
  "Power",
  "Chargers",
  "Cables",
  "Wearables",
  "Protection",
  "Cases",
  "Desk Accessories",
  "Cameras",
  "Hubs",
  "Gaming",
  "Bags",
  "Accessories"
];

function money(value) {
  return `PHP ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function focusSearch() {
  document.getElementById("search")?.focus();
}

function getCurrentUser() {
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

function renderAccountNav() {
  const currentUser = getCurrentUser();
  const accountLabel = document.getElementById("accountLabel");
  const loginLink = document.getElementById("loginLink");
  const signupLink = document.getElementById("signupLink");
  const profileLink = document.getElementById("profileLink");
  const logoutButton = document.getElementById("logoutButton");
  const notificationButton = document.getElementById("notificationButton");

  if (!accountLabel || !loginLink || !signupLink || !logoutButton) return;

  const isCustomer = Boolean(currentUser && currentUser.role === "customer");
  document.body.classList.toggle("customer-logged-in", isCustomer);
  document.body.classList.toggle("customer-logged-out", !isCustomer);

  const setHidden = (element, hidden) => {
    if (!element) return;
    element.classList.toggle("d-none", hidden);
    element.toggleAttribute("hidden", hidden);
    element.setAttribute("aria-hidden", hidden ? "true" : "false");
  };

  if (isCustomer) {
    const displayName = currentUser.name || currentUser.email || "Customer";
    accountLabel.innerText = `Hi, ${displayName}`;
    setHidden(loginLink, true);
    setHidden(signupLink, true);
    setHidden(profileLink, false);
    setHidden(notificationButton, false);
    setHidden(logoutButton, false);
    loadNotifications();
    return;
  }

  accountLabel.innerText = "";
  setHidden(loginLink, false);
  setHidden(signupLink, false);
  setHidden(profileLink, true);
  setHidden(notificationButton, true);
  setHidden(logoutButton, true);
}

function logoutCustomer() {
  localStorage.removeItem("currentUser");
  renderAccountNav();
}

function toggleNotifications() {
  document.getElementById("notificationPanel")?.classList.toggle("d-none");
  loadNotifications();
}

async function loadNotifications() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  try {
    const res = await fetch(`/notifications/customer/${currentUser.id}`);
    const data = await res.json();
    customerNotifications = Array.isArray(data) ? data : [];
    renderNotifications();
  } catch (error) {
  }
}

function normalizeNotificationUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = new URL(rawUrl, window.location.origin);
    const orderId = url.searchParams.get("order_id") || url.searchParams.get("order");
    if (orderId && (url.pathname.includes("/customer/profile.html") || url.pathname.includes("/customer/order.html"))) {
      return `/customer/order.html?order_id=${encodeURIComponent(orderId)}`;
    }
    return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
  } catch (error) {
    return rawUrl;
  }
}

function notificationActionLabel(item) {
  const url = normalizeNotificationUrl(item.action_url || "");
  const text = `${item.type || ""} ${item.title || ""} ${item.message || ""}`.toLowerCase();
  if (url.includes("/customer/order.html") || text.includes("order id") || text.includes("installment") || text.includes("repair") || text.includes("payment")) return "View Order";
  return "Open";
}
function renderNotifications() {
  const list = document.getElementById("notificationList");
  const count = document.getElementById("notificationCount");
  if (!list || !count) return;

  const unread = customerNotifications.filter(item => !Number(item.is_read)).length;
  count.innerText = unread;
  count.classList.toggle("d-none", unread === 0);

  if (!customerNotifications.length) {
    list.innerHTML = "No notifications yet.";
    return;
  }

  list.innerHTML = customerNotifications.map(item => `
    <div class="notification-item ${Number(item.is_read) ? "" : "unread"}">
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.message)}</p>
      ${item.action_url ? `<a class="btn btn-sm btn-dark" href="${escapeHtml(normalizeNotificationUrl(item.action_url))}" onclick="markNotificationRead(${item.id})">${notificationActionLabel(item)}</a>` : ""}
    </div>
  `).join("");
}

async function markNotificationRead(id) {
  await fetch(`/notifications/${id}/read`, { method: "PUT" });
}

async function markAllNotificationsRead() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  await fetch(`/notifications/customer/${currentUser.id}/read-all`, { method: "PUT" });
  await loadNotifications();
}

async function loadProducts() {
  const res = await fetch("/products");
  const data = await res.json();

  allProducts = Array.isArray(data) ? data : [];
  renderHeroStats();
  renderCategoryControls();
  renderProducts();
}

function renderHeroStats() {
  const categoryCount = new Set(allProducts.map(product => productCategory(product))).size;
  document.getElementById("heroProductCount").innerText = allProducts.length;
  document.getElementById("heroStockCount").innerText = categoryCount.toLocaleString();
}

function getFilteredProducts() {
  const search = document.getElementById("search")?.value.toLowerCase() || "";
  const categoryFilter = document.getElementById("categoryFilter")?.value || "all";
  const priceFilter = document.getElementById("priceFilter")?.value || "all";
  const stockFilter = document.getElementById("stockFilter")?.value || "all";
  const sortBy = document.getElementById("sortBy")?.value || "featured";

  const filtered = allProducts.filter(product => {
    const stock = Number(product.stock || 0);
    const category = productCategory(product);
    const variantText = productVariants(product).map(variant => variant.name || "").join(" ");
    const text = `${product.name || ""} ${category} ${product.description || ""} ${variantText}`.toLowerCase();
    const matchesSearch = text.includes(search);
    const matchesCategory = categoryFilter === "all" || category === categoryFilter;
    const matchesPrice = matchesPriceFilter(product, priceFilter);
    const matchesStock = stockFilter === "all" ||
      (stockFilter === "available" && stock > 0) ||
      (stockFilter === "low" && stock > 0 && stock <= 5);

    return matchesSearch && matchesCategory && matchesPrice && matchesStock;
  });

  filtered.sort((a, b) => {
    if (sortBy === "price-low") return lowestProductPrice(a) - lowestProductPrice(b);
    if (sortBy === "price-high") return lowestProductPrice(b) - lowestProductPrice(a);
    if (sortBy === "rating") return Number(b.average_rating || 0) - Number(a.average_rating || 0) || Number(b.review_count || 0) - Number(a.review_count || 0);
    if (sortBy === "stock") return Number(b.stock || 0) - Number(a.stock || 0);
    if (sortBy === "name") return String(a.name || "").localeCompare(String(b.name || ""));
    return Number(a.id || 0) - Number(b.id || 0);
  });

  return filtered;
}

function stockLabel(stock) {
  const count = Number(stock || 0);
  if (count <= 0) return { text: "Unavailable", className: "out" };
  if (count <= 5) return { text: "Limited pieces", className: "low" };
  return { text: "Available today", className: "ok" };
}

function productImages(product) {
  try {
    const images = product.images ? JSON.parse(product.images) : [];
    if (Array.isArray(images) && images.length) return images;
  } catch (error) {
  }

  return product.image ? [product.image] : [];
}

function productVariants(product) {
  try {
    const variants = product.variants ? JSON.parse(product.variants) : [];
    return Array.isArray(variants) ? variants : [];
  } catch (error) {
    return [];
  }
}

function productCategory(product) {
  const category = String(product?.category || "Accessories").trim();
  return category || "Accessories";
}

function variantPrices(product) {
  const variants = productVariants(product)
    .map(variant => Number(variant.price || product.price || 0))
    .filter(price => price >= 0);
  return variants.length ? variants : [Number(product.price || 0)];
}

function lowestProductPrice(product) {
  return Math.min(...variantPrices(product));
}

function productPriceLabel(product) {
  const prices = variantPrices(product);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? money(min) : `${money(min)} - ${money(max)}`;
}

function variantCountText(product) {
  const count = productVariants(product).length;
  if (!count) return "Default";
  return `${count} option${count === 1 ? "" : "s"}`;
}

function renderCategoryControls() {
  const select = document.getElementById("categoryFilter");
  const pills = document.getElementById("categoryPills");
  const current = select?.value || "all";
  const categories = [...new Set([...PRODUCT_CATEGORIES, ...allProducts.map(productCategory)])].filter(Boolean);

  if (select) {
    select.innerHTML = `<option value="all">All categories</option>` +
      categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    select.value = categories.includes(current) ? current : "all";
  }

  if (pills) {
    const active = select?.value || "all";
    pills.innerHTML = [`<button type="button" class="category-pill ${active === "all" ? "active" : ""}" onclick="setCategoryFilter('all')">All</button>`]
      .concat(categories.map(category => `
        <button type="button" class="category-pill ${active === category ? "active" : ""}" onclick="setCategoryFilter('${escapeHtml(category)}')">
          ${escapeHtml(category)}
        </button>
      `))
      .join("");
  }
}

function setCategoryFilter(category) {
  const select = document.getElementById("categoryFilter");
  if (select) select.value = category;
  renderCategoryControls();
  renderProducts();
}

function matchesPriceFilter(product, filter) {
  if (filter === "all") return true;
  const price = lowestProductPrice(product);
  if (filter === "under-500") return price < 500;
  if (filter === "500-1500") return price >= 500 && price <= 1500;
  if (filter === "1500-5000") return price > 1500 && price <= 5000;
  if (filter === "5000-15000") return price > 5000 && price <= 15000;
  if (filter === "15000-up") return price > 15000;
  return true;
}

function ratingSummary(product) {
  const average = Number(product.average_rating || 0);
  const count = Number(product.review_count || 0);
  if (!count) return "No reviews yet";
  return `${average.toFixed(1)} / 5 (${count} review${count === 1 ? "" : "s"})`;
}

function reviewImagesHtml(value) {
  try {
    const images = value ? JSON.parse(value) : [];
    if (!Array.isArray(images) || !images.length) return "";
    return `<div class="review-images">${images.map(image => `<img src="${escapeHtml(image)}" alt="Review photo">`).join("")}</div>`;
  } catch (error) {
    return "";
  }
}
function ratingStars(value) {
  const rating = Math.round(Number(value || 0));
  return Array.from({ length: 5 }, (_, index) => index < rating ? "&#9733;" : "&#9734;").join("");
}

async function loadProductReviews(productId) {
  const container = document.getElementById("modalReviews");
  if (!container) return;
  container.innerHTML = "Loading reviews...";

  try {
    const res = await fetch(`/reviews/product/${productId}`);
    const data = await res.json();
    const reviews = Array.isArray(data) ? data : [];

    if (!reviews.length) {
      container.innerHTML = "No reviews yet.";
      return;
    }

    container.innerHTML = reviews.map(review => `
      <div class="review-item">
        <strong>${escapeHtml(review.customer_name || "Customer")}</strong>
        <span>${ratingStars(review.rating)} ${Number(review.rating || 0)}/5</span>
        ${review.comment ? `<p>${escapeHtml(review.comment)}</p>` : ""}
      </div>
    `).join("");
  } catch (error) {
    container.innerHTML = "Unable to load reviews.";
  }
}
function wishlistIds() {
  try { return JSON.parse(localStorage.getItem("wishlist") || "[]").map(Number); } catch (error) { return []; }
}

function isWishlisted(productId) {
  return wishlistIds().includes(Number(productId));
}

function toggleWishlist(productId) {
  const id = Number(productId);
  const current = wishlistIds();
  const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
  localStorage.setItem("wishlist", JSON.stringify(next));
  renderProducts();
}
function renderProducts() {
  const container = document.getElementById("productList");
  const products = getFilteredProducts();

  document.getElementById("catalogCount").innerText =
    `${products.length} item${products.length === 1 ? "" : "s"}`;

  renderCategoryControls();

  if (!products.length) {
    container.innerHTML = `
      <div class="empty-state">
        <h4>No products found</h4>
        <p class="mb-0">Try a different search term, category, price, or availability filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = products.map(product => {
    const firstImage = productImages(product)[0] || "https://via.placeholder.com/600x460?text=Product";
    const stock = stockLabel(product.stock);
    const category = productCategory(product);
    const disabled = Number(product.stock || 0) <= 0 ? "disabled" : "";

    return `
      <article class="product-card">
        <img src="${escapeHtml(firstImage)}"
             class="product-image"
             alt="${escapeHtml(product.name)}">

        <div class="product-body">
          <div class="product-card-head">
            <span class="product-category">${escapeHtml(category)}</span>
            <span class="variant-count">${escapeHtml(variantCountText(product))}</span>
          </div>

          <h3 class="product-title">${escapeHtml(product.name)}</h3>
          <p class="product-desc">${escapeHtml(product.description || "Quality tech item available from Sheena's Gadgets & Accessories Shop.")}</p>

          <div class="product-meta">
            <span class="price">${productPriceLabel(product)}</span>
            <span class="stock-pill ${stock.className}">${stock.text}</span>
          </div>

          <div class="product-meta">
            <span class="rating-text">${ratingStars(product.average_rating)} ${ratingSummary(product)}</span>
          </div>

          <div class="product-actions" data-product-id="${product.id}">
            <button class="btn btn-outline-dark" onclick="toggleWishlist(${product.id})">${isWishlisted(product.id) ? "Saved" : "Save"}</button>
            <button class="btn btn-dark" ${disabled} onclick="openProductPage(${product.id})">Buy Now</button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function openProductPage(productId) {
  window.location.href = `/customer/product.html?id=${productId}`;
}

function openProductDetails(productId) {
  const product = allProducts.find(item => item.id === productId);
  if (!product) return;

  modalCurrentProduct = product;
  const variants = productVariants(product);
  const images = productImages(product);
  modalSelectedVariantIndex = variants.length ? variants.findIndex(variant => Number(variant.stock || 0) > 0) : null;
  if (modalSelectedVariantIndex < 0) modalSelectedVariantIndex = 0;
  const activeVariant = variants[modalSelectedVariantIndex];
  const activeStock = activeVariant ? Number(activeVariant.stock || 0) : Number(product.stock || 0);
  const activePrice = activeVariant ? Number(activeVariant.price || product.price) : Number(product.price || 0);
  const stock = stockLabel(activeStock);

  document.getElementById("modalProductName").innerText = product.name;
  document.getElementById("modalProductBody").innerHTML = `
    <div class="row g-4">
      <div class="col-md-5">
        <img id="modalMainImage"
             src="${images[0] || "https://via.placeholder.com/600x460?text=Product"}"
             class="gallery-main"
             alt="${product.name}">
        ${images.length > 1 ? `
          <div class="gallery-thumbs">
            ${images.slice(0, 20).map((img, index) => `
              <button type="button" class="gallery-thumb ${index === 0 ? "active" : ""}" onclick="setModalImage('${img}', this)">
                <img src="${img}" alt="${product.name}">
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
      <div class="col-md-7">
        <span id="modalStock" class="stock-pill ${stock.className}">${stock.text}</span>
        <h3 id="modalPrice" class="mt-3">${money(activePrice)}</h3>
        <p class="text-muted">${product.description || "No description available."}</p>
        <div class="product-meta mb-3"><span>${ratingStars(product.average_rating)} ${ratingSummary(product)}</span></div>
        <hr>
        <h6 class="fw-bold">Variants</h6>
        ${
          variants.length
            ? `<div class="variant-options">${variants.map((variant, index) => `
                <button
                  type="button"
                  class="variant-option ${index === modalSelectedVariantIndex ? "active" : ""}"
                  ${Number(variant.stock || 0) <= 0 ? "disabled" : ""}
                  onclick="selectModalVariant(${index}, this)">
                  <strong>${variant.name}</strong>
                  <span>${money(variant.price)} - ${Number(variant.stock || 0) <= 5 ? "Limited pieces" : "Available today"}</span>
                </button>
              `).join("")}</div>`
            : "<p class='text-muted mb-0'>Default item only.</p>"
        }
      </div>
    </div>
  `;

  const buyButton = document.getElementById("modalBuyButton");
  const cartButton = document.getElementById("modalCartButton");
  buyButton.disabled = activeStock <= 0;
  cartButton.disabled = activeStock <= 0;
  buyButton.onclick = () => {
    goToCheckout(product.id, modalSelectedVariantIndex ?? "");
  };
  cartButton.onclick = () => {
    addToCart(product.id, modalSelectedVariantIndex ?? "");
  };
  loadProductReviews(product.id);
  productModal.show();
}

function setModalImage(src, button) {
  document.getElementById("modalMainImage").src = src;
  document.querySelectorAll(".gallery-thumb").forEach(thumb => thumb.classList.remove("active"));
  button.classList.add("active");
}

function selectModalVariant(index, button) {
  const variants = productVariants(modalCurrentProduct);
  const variant = variants[index];
  if (!variant) return;

  modalSelectedVariantIndex = index;
  document.querySelectorAll(".variant-option").forEach(option => option.classList.remove("active"));
  button.classList.add("active");

  const stock = stockLabel(variant.stock);
  const stockEl = document.getElementById("modalStock");
  stockEl.className = `stock-pill ${stock.className}`;
  stockEl.innerText = stock.text;
  document.getElementById("modalPrice").innerText = money(variant.price);
  const disabled = Number(variant.stock || 0) <= 0;
  document.getElementById("modalBuyButton").disabled = disabled;
  document.getElementById("modalCartButton").disabled = disabled;
}

function goToCheckout(productId, variantIndex = "") {
  const currentUser = getCurrentUser();
  localStorage.setItem("checkout", JSON.stringify({
    product_id: productId,
    variant_index: variantIndex
  }));

  if (!currentUser || currentUser.role !== "customer") {
    window.location.href = "/auth.html?returnTo=/checkout.html";
    return;
  }

  window.location.href = "/checkout.html";
}

document.addEventListener("DOMContentLoaded", () => {
  productModal = new bootstrap.Modal(document.getElementById("productModal"));
  renderAccountNav();
  loadProducts();
});

async function clearReadNotifications() {
  const currentUser = getCurrentUser()
  if (!currentUser) return
  await fetch(`/notifications/customer/${currentUser.id}/read`, { method: "DELETE" })
  await loadNotifications()
}