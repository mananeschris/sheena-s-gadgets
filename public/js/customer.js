let allProducts = [];
let productModal;
let modalSelectedVariantIndex = null;
let modalCurrentProduct = null;
let customerNotifications = [];
let catalogPage = 1;
let catalogView = "grid";
let catalogLoading = true;
let catalogLoadError = false;
const CATALOG_PAGE_SIZE = 12;

function money(value) {
  return `₱${Number(value || 0).toLocaleString(undefined, {
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
  const search = document.getElementById("search");
  search?.scrollIntoView({ behavior: "smooth", block: "center" });
  search?.focus({ preventScroll: true });
}

function resetShopFilters() {
  const search = document.getElementById("search");
  if (search) search.value = "";
  ["categoryFilter", "priceFilter", "stockFilter"].forEach(id => {
    const filter = document.getElementById(id);
    if (filter) filter.value = "all";
  });
  const sort = document.getElementById("sortBy");
  if (sort) sort.value = "featured";
  const saved = document.getElementById("savedFilter");
  if (saved) saved.checked = false;
  renderCategoryControls();
  renderProducts();
  search?.focus();
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
    if (hidden) element.style.setProperty("display", "none", "important");
    else element.style.removeProperty("display");
    element.setAttribute("aria-hidden", hidden ? "true" : "false");
  };

  if (isCustomer) {
    window.updateCustomerHeaderAccount(currentUser);
    setHidden(loginLink, true);
    setHidden(signupLink, true);
    setHidden(profileLink, false);
    setHidden(document.getElementById("cartButton"), false);
    setHidden(notificationButton, false);
    setHidden(logoutButton, false);
    loadNotifications();
    if (!catalogLoading) renderProducts(true);
    return;
  }

  window.updateCustomerHeaderAccount(null);
  setHidden(loginLink, false);
  setHidden(signupLink, false);
  setHidden(profileLink, true);
  setHidden(document.getElementById("cartButton"), true);
  setHidden(notificationButton, true);
  setHidden(logoutButton, true);
  document.getElementById("cartPanel")?.classList.add("d-none");
  if (!catalogLoading) renderProducts(true);
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
function notificationEventTitle(item) {
  const title = String(item.title || "Notification");
  const productName = String(item.order_product_name || "");
  if (!productName || title.toLowerCase().indexOf(productName.toLowerCase()) !== 0) return title;
  return title.slice(productName.length).replace(/^[\s:|\-]+/, "") || "Order update";
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
    <div class="notification-item customer-notification-item ${Number(item.is_read) ? "" : "unread"}">
      ${item.order_product_image ? `<img class="notification-product-image" src="${escapeHtml(item.order_product_image)}" alt="${escapeHtml(item.order_product_name || "Ordered product")}" loading="lazy" onerror="this.hidden=true">` : `<span class="notification-icon"><i data-lucide="bell" aria-hidden="true"></i></span>`}
      <div class="notification-content">
        ${item.order_product_name ? `<strong class="notification-product-name">${escapeHtml(item.order_product_name)}</strong>` : ""}
        <strong>${escapeHtml(notificationEventTitle(item))}</strong>
        <p>${escapeHtml(item.message)}</p>
        ${item.action_url ? `<a class="btn btn-sm btn-dark" href="${escapeHtml(normalizeNotificationUrl(item.action_url))}" onclick="markNotificationRead(${item.id})">${notificationActionLabel(item)}</a>` : ""}
      </div>
    </div>
  `).join("");
  if (window.lucide) window.lucide.createIcons();
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
  catalogLoading = true;
  catalogLoadError = false;
  renderProducts();
  try {
    const res = await fetch("/products");
    const data = await res.json();
    if (!res.ok || !Array.isArray(data)) throw new Error("Unable to load products.");
    allProducts = data;
    renderHeroStats();
    renderCategoryControls();
  } catch (error) {
    catalogLoadError = true;
  }
  catalogLoading = false;
  renderProducts();
}

function renderHeroStats() {
  const categoryCount = new Set(allProducts.map(product => productCategory(product))).size;
  document.getElementById("heroProductCount").innerText = allProducts.length;
  document.getElementById("heroStockCount").innerText = categoryCount.toLocaleString();
}

function getFilteredProducts() {
  const search = document.getElementById("search")?.value.trim().toLowerCase() || "";
  const categoryFilter = document.getElementById("categoryFilter")?.value || "all";
  const priceFilter = document.getElementById("priceFilter")?.value || "all";
  const stockFilter = document.getElementById("stockFilter")?.value || "all";
  const sortBy = document.getElementById("sortBy")?.value || "featured";
  const savedOnly = document.getElementById("savedFilter")?.checked;

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
      (stockFilter === "low" && stock > 0 && stock <= 5) ||
      (stockFilter === "out" && stock <= 0);

    return matchesSearch && matchesCategory && matchesPrice && matchesStock && (!savedOnly || isWishlisted(product.id));
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
  const categories = [...new Set(allProducts.map(productCategory))].filter(Boolean).sort((a, b) => a.localeCompare(b));

  if (select) {
    select.innerHTML = `<option value="all">All categories</option>` +
      categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
    select.value = categories.includes(current) ? current : "all";
  }

  if (pills) {
    const active = select?.value || "all";
    pills.innerHTML = [`<button type="button" class="category-pill ${active === "all" ? "active" : ""}" aria-pressed="${active === "all"}" data-category="all">All products <span>${allProducts.length}</span></button>`]
      .concat(categories.map(category => `
        <button type="button" class="category-pill ${active === category ? "active" : ""}" aria-pressed="${active === category}" data-category="${escapeHtml(category)}">
          ${escapeHtml(category)} <span>${allProducts.filter(product => productCategory(product) === category).length}</span>
        </button>
      `))
      .join("");
  }
}

function setCategoryFilter(category) {
  const focusedCategory = document.activeElement?.dataset.category;
  const select = document.getElementById("categoryFilter");
  if (select) select.value = category;
  renderCategoryControls();
  renderProducts();
  if (focusedCategory !== undefined) {
    [...document.querySelectorAll("[data-category]")].find(button => button.dataset.category === category)?.focus({ preventScroll: true });
  }
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
  if (getCurrentUser()?.role !== "customer") { showGuestAccountModal(); return; }
  const id = Number(productId);
  const current = wishlistIds();
  const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
  localStorage.setItem("wishlist", JSON.stringify(next));
  renderProducts(true);
  (document.getElementById(`catalogSave${id}`) || document.querySelector(".catalog-empty button") || document.getElementById("catalogResultSummary"))?.focus({ preventScroll: true });
}
function toggleCatalogFilters() {
  const filters = document.getElementById("catalogFilters");
  const open = filters.dataset.mobileOpen !== "true";
  filters.dataset.mobileOpen = String(open);
  document.querySelector(".catalog-filter-toggle").setAttribute("aria-expanded", String(open));
}

function setCatalogView(view) {
  catalogView = view === "list" ? "list" : "grid";
  localStorage.setItem("catalogView", catalogView);
  renderProducts(true);
}

function setCatalogPage(page) {
  catalogPage = Number(page);
  renderProducts(true);
  document.querySelector(".catalog-results-head").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("catalogResultSummary").focus({ preventScroll: true });
}

function removeCatalogFilter(id) {
  const field = document.getElementById(id);
  if (id === "savedFilter") field.checked = false;
  else field.value = id === "search" ? "" : "all";
  renderProducts();
  document.getElementById("catalogResultSummary").focus({ preventScroll: true });
}

function renderCatalogFilters() {
  const filters = [];
  const search = document.getElementById("search").value.trim();
  if (search) filters.push(["search", `Search: ${search}`]);
  ["categoryFilter", "priceFilter", "stockFilter"].forEach(id => {
    const field = document.getElementById(id);
    if (field.value !== "all") filters.push([id, field.selectedOptions[0].textContent]);
  });
  if (document.getElementById("savedFilter").checked) filters.push(["savedFilter", "Saved products"]);
  const container = document.getElementById("catalogActiveFilters");
  container.hidden = !filters.length;
  container.innerHTML = filters.map(([id, label]) => `<button type="button" class="catalog-filter-chip" onclick="removeCatalogFilter('${id}')" aria-label="Remove ${escapeHtml(label)} filter"><span>${escapeHtml(label)}</span><i data-lucide="x" aria-hidden="true"></i></button>`).join("");
  const badge = document.getElementById("catalogFilterBadge");
  badge.hidden = !filters.length;
  badge.textContent = filters.length;
}

function renderProducts(preservePage = false) {
  const container = document.getElementById("productList");
  const products = getFilteredProducts();
  if (!preservePage) catalogPage = 1;
  const pages = Math.max(1, Math.ceil(products.length / CATALOG_PAGE_SIZE));
  catalogPage = Math.max(1, Math.min(catalogPage, pages));
  const start = (catalogPage - 1) * CATALOG_PAGE_SIZE;
  const productNoun = products.length === 1 ? "product" : "products";
  container.dataset.view = catalogView;
  container.setAttribute("aria-busy", String(catalogLoading));
  document.getElementById("catalogGridView").setAttribute("aria-pressed", String(catalogView === "grid"));
  document.getElementById("catalogListView").setAttribute("aria-pressed", String(catalogView === "list"));
  document.getElementById("catalogCount").textContent = catalogLoading ? "Loading..." : catalogLoadError ? "Unavailable" : `${products.length} ${productNoun}`;
  const summary = document.getElementById("catalogResultSummary");
  summary.textContent = catalogLoading ? "Loading products..." : catalogLoadError ? "Products unavailable" : products.length ? `Showing ${start + 1}-${Math.min(start + CATALOG_PAGE_SIZE, products.length)} of ${products.length} ${productNoun}` : "0 products";
  const pagination = document.getElementById("catalogPagination");
  pagination.hidden = catalogLoading || catalogLoadError || pages <= 1;
  pagination.innerHTML = `<button class="catalog-icon" type="button" title="Previous page" aria-label="Previous page" ${catalogPage === 1 ? "disabled" : ""} onclick="setCatalogPage(${catalogPage - 1})"><i data-lucide="chevron-left" aria-hidden="true"></i></button><span>Page ${catalogPage} of ${pages}</span><button class="catalog-icon" type="button" title="Next page" aria-label="Next page" ${catalogPage === pages ? "disabled" : ""} onclick="setCatalogPage(${catalogPage + 1})"><i data-lucide="chevron-right" aria-hidden="true"></i></button>`;
  renderCategoryControls();
  renderCatalogFilters();
  if (catalogLoading) {
    container.innerHTML = Array.from({ length: 6 }, () => `<div class="catalog-skeleton" aria-hidden="true"><div></div><span></span><span></span></div>`).join("");
    window.lucide?.createIcons();
    return;
  }
  if (catalogLoadError) {
    container.innerHTML = `<div class="catalog-empty" role="status"><i data-lucide="cloud-off" aria-hidden="true"></i><h3>Unable to load products</h3><p>Please try again in a moment.</p><button class="btn btn-dark" type="button" onclick="loadProducts()">Try Again</button></div>`;
    window.lucide?.createIcons();
    return;
  }
  if (!products.length) {
    container.innerHTML = `<div class="catalog-empty"><i data-lucide="${allProducts.length ? "search-x" : "package-open"}" aria-hidden="true"></i><h3>${allProducts.length ? "No matching products" : "No products available yet"}</h3>${allProducts.length ? '<button class="btn btn-outline-dark" type="button" onclick="resetShopFilters()">Clear All Filters</button>' : ""}</div>`;
    window.lucide?.createIcons();
    return;
  }

  container.innerHTML = products.slice(start, start + CATALOG_PAGE_SIZE).map(product => {
    const firstImage = productImages(product)[0];
    const stock = stockLabel(product.stock);
    const category = productCategory(product);
    const disabled = Number(product.stock || 0) <= 0 ? "disabled" : "";

    const id = Number(product.id);
    const saved = isWishlisted(id);
    const prices = variantPrices(product);
    const hasRange = Math.min(...prices) !== Math.max(...prices);
    const reviewCount = Number(product.review_count || 0);
    const cartAction = getCurrentUser()?.role === "customer"
      ? `<button class="catalog-icon cart-add" title="Add to Cart" aria-label="Add ${escapeHtml(product.name)} to cart" ${disabled} onclick="cartActionFor(${id})"><i data-lucide="shopping-cart" aria-hidden="true"></i></button>`
      : "";

    return `
      <article class="product-card">
        <div class="catalog-product-media">
          <a href="/customer/product.html?id=${id}" aria-label="View ${escapeHtml(product.name)}" class="catalog-product-image-link">
            ${firstImage ? `<img src="${escapeHtml(firstImage)}" class="product-image" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ""}
            <span class="catalog-image-fallback" ${firstImage ? "hidden" : ""}><i data-lucide="image" aria-hidden="true"></i><span>No image available</span></span>
          </a>
          <button id="catalogSave${id}" class="catalog-icon catalog-save ${saved ? "is-saved" : ""}" type="button" title="${saved ? "Remove from Wishlist" : "Save to Wishlist"}" aria-label="${saved ? "Remove" : "Save"} ${escapeHtml(product.name)} ${saved ? "from" : "to"} wishlist" aria-pressed="${saved}" onclick="toggleWishlist(${id})"><i data-lucide="heart" aria-hidden="true"></i></button>
        </div>
        <div class="product-body">
          <div class="product-card-head">
            <span class="product-category">${escapeHtml(category)}</span>
            ${productVariants(product).length ? `<span class="variant-count">${escapeHtml(variantCountText(product))}</span>` : ""}
          </div>

          <h3 class="product-title"><a href="/customer/product.html?id=${id}">${escapeHtml(product.name)}</a></h3>
          <p class="product-desc">${escapeHtml(product.description || "")}</p>
          <div class="catalog-rating">${reviewCount ? `<i data-lucide="star" aria-hidden="true"></i><strong>${Number(product.average_rating || 0).toFixed(1)}</strong><span>(${reviewCount})</span>` : `<span>No reviews yet</span>`}</div>
          <div class="catalog-product-price">${hasRange ? "<small>From</small>" : ""}<span class="price">${money(lowestProductPrice(product))}</span></div>
          <div class="catalog-product-footer"><span class="stock-pill ${stock.className}">${stock.text}</span>
          <div class="product-actions" data-product-id="${id}">
            ${cartAction}
            <button class="catalog-icon catalog-buy" title="Buy Now" aria-label="Buy ${escapeHtml(product.name)} now" ${disabled} onclick="handleBuyNowClick(${id})"><i data-lucide="shopping-bag" aria-hidden="true"></i></button>
          </div></div>
        </div>
      </article>
    `;
  }).join("");
  if (window.lucide) window.lucide.createIcons();
}

function openProductPage(productId) {
  window.location.href = `/customer/product.html?id=${productId}`;
}

function isInteractiveProductTarget(target) {
  return Boolean(target?.closest?.("button, a, input, select, textarea, label"));
}

function openProductCard(event, productId) {
  if (isInteractiveProductTarget(event.target)) return;
  openProductPage(productId);
}

function handleProductCardKey(event, productId) {
  if (!["Enter", " "].includes(event.key)) return;
  if (isInteractiveProductTarget(event.target)) return;
  event.preventDefault();
  openProductPage(productId);
}

function handleBuyNowClick(productId) {
  openProductPage(productId);
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

  if (!currentUser || currentUser.role !== "customer") {
    if (typeof showGuestAccountModal === "function") showGuestAccountModal();
    return;
  }

  localStorage.setItem("checkout", JSON.stringify({
    product_id: productId,
    variant_index: variantIndex
  }));
  window.location.href = "/checkout.html";
}

document.addEventListener("DOMContentLoaded", () => {
  catalogView = localStorage.getItem("catalogView") === "list" ? "list" : "grid";
  document.getElementById("categoryPills").addEventListener("click", event => {
    const button = event.target.closest("[data-category]");
    if (button) setCategoryFilter(button.dataset.category);
  });
  productModal = new bootstrap.Modal(document.getElementById("productModal"));
  renderAccountNav();
  loadProducts();
});

window.addEventListener("pageshow", renderAccountNav);
window.addEventListener("storage", event => {
  if (event.key === "currentUser") renderAccountNav();
  if (event.key === "wishlist") renderProducts(true);
});

async function clearReadNotifications() {
  const currentUser = getCurrentUser()
  if (!currentUser) return
  await fetch(`/notifications/customer/${currentUser.id}/read`, { method: "DELETE" })
  await loadNotifications()
}
