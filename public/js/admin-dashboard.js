let allProducts = [];
let productCatalogPage = 1;
let productLoadState = "loading";
let productSaveInProgress = false;
let productCategories = [];
let productCategoryLoadState = 'idle';
let productCategoryModal;
let categoryDeletionInProgress = false;
const PRODUCT_PAGE_SIZE = 12;
let inventoryMovements = [];
let allVouchers = [];
let cart = [];
let lastReceipt = null;
let recentPOSReceipts = [];
let productModal;
let orderModal;
let statusUpdateModal;
let currentPrintableOrderId = null;
let pendingStatusUpdate = null;
let adminLinkedOrderHandled = false;
let allOrders = [];
let orderLoadState = "loading";
let allCustomers = [];
let staffAccounts = [];
let riderAccounts = [];
let deliveryAssignments = [];
let deliveryLoadState = "idle";
let deliverySummary = {};
let auditLogs = [];
let currentAdminUser = null;
let installmentApplications = [];
let installmentSchedules = [];
let collectionItems = [];
let collectionSummary = {};
let layawayItems = [];
let layawaySummary = {};
let adminAlerts = null;
let adminTaskFilter = "all";
let retainedImages = [];
let stagedImageFiles = [];
let productPreviewUrls = [];
const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];
const ORDER_STATUS_LABELS = {
  pending: "Pending",
  processing: "Processing",
  shipped: "Ready",
  delivered: "Completed",
  cancelled: "Cancelled"
};
const ORDER_TRACKING_STEPS = [
  { key: "pending", label: "Order Placed", dateField: "created_at" },
  { key: "processing", label: "Processing", dateField: "processing_at" },
  { key: "shipped", label: "Ready", dateField: "shipped_at" },
  { key: "delivered", label: "Completed", dateField: "delivered_at" }
];
const DELIVERY_STATUS_LABELS = {
  assigned: "Assigned",
  picked_up: "Picked Up",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed_attempt: "Failed Attempt",
  cancelled: "Cancelled"
};
const DELIVERY_ACTIVE_STATUSES = ["assigned", "picked_up", "out_for_delivery", "failed_attempt"];
const ORDER_STATUS_TRANSITIONS = {
  pending: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};
const PAYMENT_STATUS_LABELS = {
  to_collect: "To Collect",
  pending_payment: "Waiting for GCash Proof",
  for_verification: "Checking GCash",
  rejected: "GCash Proof Rejected",
  installment_application_pending: "Installment Application Pending",
  installment_downpayment_pending: "Installment Downpayment Pending",
  installment_downpayment_paid: "Installment Downpayment Paid",
  installment_downpayment_expired: "Installment Downpayment Expired",
  installment_approved_downpayment_pending: "Approved, Waiting Downpayment",
  installment_active: "Installment Active",
  installment_rejected: "Installment Rejected",
  installment_completed: "Installment Completed",
  installment_downpayment_failed: "Installment Downpayment Failed",
  installment_application_failed: "Installment Application Failed",
  pending_verification: "Checking GCash",
  awaiting_payment_setup: "Payment Setup Needed",
  payment_setup_failed: "Payment Failed",
  paid: "Paid",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled"
};
const INSTALLMENT_STATUS_LABELS = {
  pending: "Pending Review",
  approved: "Approved",
  rejected: "Rejected"
};
const LAYAWAY_STATUS_LABELS = {
  pending_downpayment: "Pending Downpayment",
  payment_failed: "Payment Failed",
  active: "Active",
  overdue: "Overdue",
  ready_for_release: "Ready for Release",
  on_the_way: "On the Way",
  delivered: "Delivered",
  released: "Released",
  cancelled: "Cancelled"
};
const LAYAWAY_TERM_MONTHS = 5;

const ADMIN_ONLY_SECTIONS = ["customers", "installments", "collections", "layaway", "vouchers", "finance", "riders", "staff", "audit"];
const STAFF_ALLOWED_SECTIONS = ["overview", "products", "orders", "repairs", "inventory", "pos", "staffAccount"];
const STAFF_TASK_CATEGORIES = ["order", "repair", "inventory"];

function adminIcon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

function refreshAdminIcons() {
  if (!window.lucide || typeof window.lucide.createIcons !== "function") return;
  window.lucide.createIcons();
}

async function logoutAdmin() {
  await window.AdminSecurity.logout();
}
function readAdminUser() {
  try {
    const user = JSON.parse(localStorage.getItem("currentUser") || "null");
    if (!user) return null;
    user.role = String(user.role || "customer").trim().toLowerCase();
    return user;
  } catch (error) {
    return null;
  }
}

function isAdminUser() {
  currentAdminUser = readAdminUser();
  return currentAdminUser?.role === "admin";
}

function isStaffUser() {
  currentAdminUser = readAdminUser();
  return currentAdminUser?.role === "staff";
}

function isStaffTaskCategory(category) {
  return STAFF_TASK_CATEGORIES.includes(category);
}

function staffCanSeeTask(item) {
  return isStaffTaskCategory(adminTaskCategory(item?.type));
}

function visibleTaskItemsForRole(items) {
  const rows = Array.isArray(items) ? items : [];
  return isStaffUser() ? rows.filter(staffCanSeeTask) : rows;
}

function syncTaskFiltersForRole() {
  const staffMode = currentAdminUser?.role === "staff";
  const allowed = staffMode ? ["all", ...STAFF_TASK_CATEGORIES] : null;
  if (staffMode && !allowed.includes(adminTaskFilter)) adminTaskFilter = "all";

  document.querySelectorAll("#adminTaskFilters [data-task-filter]").forEach(button => {
    const allowedForRole = !staffMode || allowed.includes(button.dataset.taskFilter);
    button.classList.toggle("role-hidden", !allowedForRole);
  });
}

function syncRoleCopy() {
  const isAdmin = currentAdminUser?.role === "admin";
  const roleLabel = isAdmin ? "Admin" : "Staff";
  const roleChip = document.getElementById("adminRoleChip");
  const brand = document.getElementById("dashboardBrand");
  const title = document.getElementById("dashboardTitle");
  const userLine = document.getElementById("dashboardUserLine");
  const overviewTitle = document.getElementById("overviewTitle");
  const taskTitle = document.getElementById("taskCenterTitle");
  const taskSubtitle = document.getElementById("taskCenterSubtitle");
  const notificationTitle = document.getElementById("notificationTitle");
  const notificationButton = document.getElementById("notificationButton");

  if (roleChip) roleChip.innerText = roleLabel;
  if (brand) brand.innerText = roleLabel;
  if (userLine) userLine.innerText = currentAdminUser?.name || currentAdminUser?.email || `${roleLabel} account`;
  if (title) title.innerText = isAdmin ? "Shop Dashboard" : "Staff Workspace";
  if (overviewTitle) overviewTitle.innerText = isAdmin ? "Admin Overview" : "Staff Overview";
  if (taskTitle) taskTitle.innerText = isAdmin ? "Admin Task Center" : "Staff Task Center";
  if (taskSubtitle) {
    taskSubtitle.innerText = isAdmin
      ? "Prioritized work queue for orders, payments, installments, and repairs."
      : "Focused queue for order updates, repair requests, POS work, and inventory alerts.";
  }
  if (notificationTitle) notificationTitle.innerText = `${roleLabel} Notifications`;
  if (notificationButton) {
    notificationButton.title = `${roleLabel} notifications`;
    notificationButton.setAttribute("aria-label", `${roleLabel} notifications`);
  }
}

function refreshRoleVisibility() {
  currentAdminUser = currentAdminUser || readAdminUser();
  document.body.dataset.role = currentAdminUser?.role || "guest";
  const isAdmin = currentAdminUser?.role === "admin";
  document.querySelectorAll(".admin-only").forEach(element => {
    element.classList.toggle("role-hidden", !isAdmin);
  });
  document.querySelectorAll('.staff-only').forEach(element => element.classList.toggle('role-hidden', currentAdminUser?.role !== 'staff'));
  syncTaskFiltersForRole();
  refreshAdminIcons();
}

function applyRoleAccess() {
  currentAdminUser = readAdminUser();
  if (!currentAdminUser || !["admin", "staff"].includes(currentAdminUser.role)) {
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/auth.html?returnTo=${returnTo}`;
    return false;
  }

  const path = window.location.pathname.toLowerCase();
  if (currentAdminUser.role === "staff" && path.startsWith("/admin/")) {
    window.location.replace(`/staff/dashboard.html${window.location.search || ""}`);
    return false;
  }
  if (currentAdminUser.role === "admin" && path.startsWith("/staff/")) {
    window.location.replace(`/admin/dashboard.html${window.location.search || ""}`);
    return false;
  }

  syncRoleCopy();
  refreshRoleVisibility();
  if (currentAdminUser.role === "staff") {
    ADMIN_ONLY_SECTIONS.forEach(id => document.getElementById(id)?.classList.remove("active"));
    const activeSection = document.querySelector(".section.active");
    if (!activeSection || ADMIN_ONLY_SECTIONS.includes(activeSection.id)) showSection("overview");
  }
  return true;
}

function togglePasswordVisibility(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  button.innerText = isHidden ? "Hide" : "Show";
}
function adminOrderLink(orderId) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("section", "orders");
  url.searchParams.set("order", orderId);
  return url.toString();
}

function clearAdminOrderUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("order")) return;
  url.searchParams.delete("order");
  if (!url.searchParams.has("section")) url.searchParams.set("section", "orders");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function copyTextToClipboard(text, successMessage) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "readonly");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    alert(successMessage);
  } catch (error) {
    prompt("Copy this:", text);
  }
}

function copyCurrentOrderId() {
  if (!currentPrintableOrderId) return;
  copyTextToClipboard(orderReference(currentPrintableOrderId), `Copied ${orderLabel(currentPrintableOrderId)}.`);
}

function copyCurrentOrderLink() {
  if (!currentPrintableOrderId) return;
  copyTextToClipboard(adminOrderLink(currentPrintableOrderId), `Copied admin link for ${orderLabel(currentPrintableOrderId)}.`);
}

function openLinkedAdminOrderIfNeeded() {
  if (adminLinkedOrderHandled) return;
  const params = new URLSearchParams(window.location.search);
  const orderId = Number(params.get("order"));
  if (!orderId) return;
  const order = allOrders.find(item => Number(item.id) === orderId);
  if (!order) return;
  adminLinkedOrderHandled = true;
  showSection("orders");
  viewOrder(orderId);
}
function actorPayload() {
  currentAdminUser = currentAdminUser || readAdminUser();
  const role = ["admin", "staff"].includes(currentAdminUser?.role) ? currentAdminUser.role : "system";
  const fallbackName = role === "admin" ? "Admin" : role === "staff" ? "Staff" : "Store user";
  return {
    actor_id: currentAdminUser?.id || null,
    actor_name: currentAdminUser?.name || currentAdminUser?.email || fallbackName,
    actor_role: role
  };
}

function actorQueryString() {
  return new URLSearchParams(actorPayload()).toString();
}
function requireAdminAction(message = "Admin access only.") {
  currentAdminUser = readAdminUser();
  if (currentAdminUser?.role === "admin") return true;
  const role = currentAdminUser?.role || "not logged in";
  alert(`${message} Current role: ${role}. Please logout and login with an admin account if this is wrong.`);
  return false;
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

function productFlag(value) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true" || String(value || "") === "1";
}

function productLayawayEnabled(product) {
  return productFlag(product?.allow_layaway);
}

function productInstallmentEnabled(product) {
  return productFlag(product?.allow_installment);
}

function productLayawaySettings(product = {}) {
  const type = String(product.layaway_downpayment_type || "percentage").toLowerCase() === "fixed" ? "fixed" : "percentage";
  const defaultValue = type === "percentage" ? 20 : 0;
  const value = Number(product.layaway_downpayment_value);
  const duration = Number(product.layaway_duration_months);
  const maxQuantity = Number(product.layaway_max_quantity);
  return {
    type,
    value: Number.isFinite(value) && value >= 0 ? value : defaultValue,
    duration: Number.isInteger(duration) && duration > 0 ? duration : 5,
    maxQuantity: Number.isInteger(maxQuantity) && maxQuantity > 0 ? maxQuantity : 1
  };
}

function layawaySettingSummary(product) {
  if (!productLayawayEnabled(product)) return "Layaway off";
  const settings = productLayawaySettings(product);
  const downpayment = settings.type === "fixed"
    ? money(settings.value)
    : `${settings.value}%`;
  return `Layaway: ${downpayment} DP, ${settings.duration} mo, max ${settings.maxQuantity}`;
}

function renderProductCategoryFilter() {
  const select = document.getElementById("productCategoryFilter");
  if (!select) return;
  const current = select.value || "all";
  const categories = [...new Set([...productCategories.map(item => item.name), ...allProducts.map(productCategory), 'Accessories'])].filter(Boolean);
  select.innerHTML = `<option value="all">All categories</option>` +
    categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("");
  select.value = categories.includes(current) ? current : "all";
  const editor = document.getElementById('category');
  if (editor) {
    const selected = editor.value;
    editor.innerHTML = categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
    editor.value = categories.includes(selected) ? selected : 'Accessories';
  }
}

async function loadProductCategories() {
  productCategoryLoadState = 'loading';
  renderProductCategories();
  try {
    const response = await fetch(`/products/categories?${actorQueryString()}`);
    const data = await response.json();
    if (!response.ok || !Array.isArray(data)) throw new Error('Unable to load categories.');
    productCategories = data;
    productCategoryLoadState = 'ready';
    renderProductCategoryFilter();
  } catch { productCategoryLoadState = 'error'; }
  renderProductCategories();
}

async function openProductCategories() {
  if (!requireAdminAction('Only admin can manage categories.')) return;
  productCategoryModal ||= createModalController('productCategoriesModal');
  document.getElementById('categoryDeleteMessage').textContent = '';
  productCategoryModal.show();
  await loadProductCategories();
}

function renderProductCategories() {
  const container = document.getElementById('productCategoriesList');
  if (!container) return;
  if (productCategoryLoadState === 'loading') { container.innerHTML = '<p class="category-list-state" role="status">Loading categories...</p>'; return; }
  if (productCategoryLoadState === 'error') {
    container.innerHTML = `<div class="category-list-state" role="alert">Unable to load categories.<button type="button" class="btn btn-outline-dark" onclick="loadProductCategories()">${adminIcon('refresh-cw')}Retry</button></div>`;
    refreshAdminIcons(); return;
  }
  container.innerHTML = productCategories.map(item => {
    const count = Number(item.product_count || 0);
    const locked = item.protected || count > 0;
    const reason = item.protected ? 'Default category cannot be deleted' : count ? 'Move products and delete category' : 'Delete category';
    const action = count && !item.protected ? `<button type="button" class="category-move-delete-button" data-category-move="${escapeHtml(item.name)}" aria-label="Move products and delete ${escapeHtml(item.name)}" title="${reason}" ${categoryDeletionInProgress ? 'disabled' : ''}>${adminIcon('arrow-right-left')}</button>` : '';
    return `<div class="product-category-row"><span class="category-row-icon">${adminIcon('tags')}</span><div><strong>${escapeHtml(item.name)}</strong><span>${count} ${count === 1 ? 'product' : 'products'}${item.protected ? ' / Default' : ''}</span></div>${action}<button type="button" class="category-delete-button" data-category="${escapeHtml(item.name)}" aria-label="Delete ${escapeHtml(item.name)}" title="${reason}" ${locked || categoryDeletionInProgress ? 'disabled' : ''}>${adminIcon('trash-2')}</button></div>`;
  }).join('');
  container.querySelectorAll('[data-category]').forEach(button => button.onclick = () => deleteProductCategory(button.dataset.category));
  container.querySelectorAll('[data-category-move]').forEach(button => button.onclick = () => moveAndDeleteProductCategory(button.dataset.categoryMove));
  refreshAdminIcons();
}

async function moveAndDeleteProductCategory(name) {
  if (!isAdminUser() || categoryDeletionInProgress) return;
  const destinations = productCategories.filter(item => item.name.toLowerCase() !== name.toLowerCase());
  const values = await AppDialog.form({
    eyebrow: 'Catalog categories', title: 'Move products & delete category',
    message: `Choose where the products in ${name} should go before deleting the category.`,
    fields: [{ name: 'replacement_category', label: 'Move products to', type: 'select', required: true, options: destinations.map(item => ({ value: item.name, label: item.name })) }],
    submitText: 'Move Products & Delete', tone: 'danger'
  });
  if (values?.replacement_category) await deleteProductCategory(name, values.replacement_category);
}

async function deleteProductCategory(name, replacementCategory = '') {
  if (!isAdminUser() || categoryDeletionInProgress) return;
  const category = productCategories.find(item => item.name === name);
  if (!category || category.protected || (Number(category.product_count) && !replacementCategory)) return;
  const confirmed = await AppDialog.confirm({ eyebrow: 'Catalog categories', title: 'Delete this category?', message: `${name} will be removed from the category filters and product editor.`, details: [{ label: 'Category', value: name }, { label: 'Products', value: replacementCategory ? `${category.product_count} moved to ${replacementCategory}` : '0' }], confirmText: 'Delete Category', tone: 'danger' });
  if (!confirmed || categoryDeletionInProgress) return;
  categoryDeletionInProgress = true;
  renderProductCategories();
  const message = document.getElementById('categoryDeleteMessage');
  message.textContent = '';
  try {
    const response = await fetch(`/products/categories/${encodeURIComponent(name)}?${actorQueryString()}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(replacementCategory ? { replacement_category: replacementCategory } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to delete category.');
    productCategories = productCategories.filter(item => item.name !== name);
    renderProductCategoryFilter();
    renderProducts();
    message.textContent = `${name} deleted.`;
  } catch (error) { message.textContent = error.message || 'Unable to delete category.'; }
  finally { categoryDeletionInProgress = false; await loadProductCategories(); }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  return `₱${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function shortMoney(value) {
  const amount = Number(value || 0);
  if (amount >= 1000000) return `₱${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `₱${(amount / 1000).toFixed(1)}K`;
  return money(amount);
}

function escapeJsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ");
}
function shortDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function setNavBadge(id, count) {
  const badge = document.getElementById(id);
  if (!badge) return;

  const value = Number(count || 0);
  badge.textContent = value > 99 ? "99+" : value;
  badge.classList.toggle("show", value > 0);
}

async function loadAdminAlerts(silent = false) {
  const container = document.getElementById("adminActionCenter");
  const roleText = isStaffUser() ? "staff" : "admin";
  if (container && !silent) container.innerHTML = `<div class="text-muted">Loading ${roleText} alerts...</div>`;

  try {
    const res = await fetch("/admin/alerts");
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || "Unable to load admin alerts.");

    let proofs = [];
    try { proofs = isAdminUser() ? await window.DeliveryProofAdmin?.loadNotices() || [] : []; }
    catch (error) { data.delivery_notice_error = error.message; }
    adminAlerts = { ...data, items: [...proofs, ...(data.items || [])], summary: { ...data.summary, total: Number(data.summary?.total || data.items?.length || 0) + proofs.length } };
    renderAdminAlerts();
    window.StaffWorkspace?.render();
  } catch (error) {
    setNavBadge("navOverviewBadge", 0);
    setNavBadge("navOrdersBadge", 0);
    setNavBadge("navRepairsBadge", 0);
    setNavBadge("navInstallmentsBadge", 0);
    setNavBadge("navFinanceBadge", 0);
    setNavBadge("navInventoryBadge", 0);
    setNavBadge("navCollectionsBadge", 0);
    setNavBadge("navLayawayBadge", 0);
    setNavBadge("navRidersBadge", 0);
    if (container) {
      container.innerHTML = `<div class="text-muted">Unable to load ${roleText} alerts.</div>`;
      renderAdminNotificationBell();
    }
  }
}

function renderAdminNotificationBell() {
  const summary = adminAlerts?.summary || {};
  const items = Array.isArray(adminAlerts?.items) ? adminAlerts.items : [];
  const staffMode = isStaffUser();
  const visibleItems = visibleTaskItemsForRole(items);
  const total = staffMode && !adminAlerts?.staff_scope ? visibleItems.length : Number(summary.total || visibleItems.length || 0);
  const badge = document.getElementById("adminNotificationBadge");
  const summaryEl = document.getElementById("adminNotificationSummary");
  const list = document.getElementById("adminNotificationList");

  if (badge) {
    badge.textContent = total > 99 ? "99+" : total;
    badge.classList.toggle("show", total > 0);
  }
  if (summaryEl) summaryEl.innerText = total ? `${total} task${total === 1 ? "" : "s"} need attention` : "No urgent tasks right now";
  if (summaryEl && adminAlerts?.delivery_notice_error) summaryEl.innerText += ` | ${adminAlerts.delivery_notice_error}`;
  if (!list) return;

  const topItems = visibleItems.slice(0, 5);
  if (!topItems.length) {
    list.innerHTML = `<div class="text-muted">No urgent notifications right now.</div>`;
    return;
  }

  list.innerHTML = topItems.map(item => {
    const priority = adminTaskPriority(item.type);
    const icon = ({ payment: "wallet-cards", overdue: "calendar-clock", out_stock: "package-x", low_stock: "boxes", repair: "wrench", installment: "receipt-text", cancel: "circle-x", delivery_proof: "image", order: "shopping-bag" })[item.type] || "bell-ring";
    return `
      <div class="notification-mini-item ${priority === "urgent" ? "urgent" : ""}">
        <span class="notification-mini-icon ${priority}" aria-hidden="true">${adminIcon(icon)}</span>
        <div class="notification-mini-copy">
          <div class="notification-mini-meta"><span class="task-priority ${priority}">${escapeHtml(priority)}</span><span class="small text-muted">${escapeHtml(shortDate(item.created_at))}</span></div>
          <strong>${escapeHtml(item.title)}</strong>
          <div class="small text-muted">${escapeHtml(item.detail)}</div>
          ${adminTaskButtonHtml(item, item.order_id ? "Open Order" : "Open")}
        </div>
      </div>
    `;
  }).join("");
}

function toggleAdminNotificationPanel() {
  const expanded = document.getElementById("adminNotificationPanel")?.classList.toggle("show") || false;
  document.getElementById("notificationButton")?.setAttribute("aria-expanded", String(expanded));
}

function closeAdminNotificationPanel() {
  document.getElementById("adminNotificationPanel")?.classList.remove("show");
  document.getElementById("notificationButton")?.setAttribute("aria-expanded", "false");
}

function openAdminTaskCenter() {
  closeAdminNotificationPanel();
  showSection("overview");
  document.getElementById("adminActionCenter")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function adminTaskButtonHtml(item, label, iconOnly = false) {
  if (isStaffUser() && !staffCanSeeTask(item)) return "";
  const orderId = Number(item.order_id || 0);
  const productId = Number(item.product_id || 0);
  const scheduleId = Number(item.schedule_id || 0);
  let action;
  let actionLabel;
  if (item.type === "delivery_proof" && Number(item.assignment_id) > 0) {
    action = `openDeliveryProof(${Number(item.assignment_id)})`;
    actionLabel = "View Delivery Proof";
  } else if (String(item.type || "") === "overdue" && scheduleId > 0) {
    action = `openCollectionFromAlert(${scheduleId}, ${orderId})`;
    actionLabel = "Open Collection";
  } else if (orderId > 0) {
    action = `openAdminOrderFromAlert(${orderId})`;
    actionLabel = "Open Order";
  } else if (productId > 0) {
    action = `openAdminInventoryFromAlert(${productId}, '${escapeJsString(item.type || "low_stock")}')`;
    actionLabel = "Open Inventory";
  } else {
    action = `openAdminTask('${escapeJsString(item.section || "overview")}', '${escapeJsString(item.type || "alert")}')`;
    actionLabel = "Open Task";
  }
  const text = escapeHtml(item.type === "delivery_proof" ? actionLabel : label || actionLabel);
  return iconOnly
    ? `<button type="button" class="btn btn-sm task-open-button" onclick="${escapeHtml(action)}" aria-label="${text}" title="${text}"><i data-lucide="${item.type === 'delivery_proof' ? 'image' : 'arrow-up-right'}" aria-hidden="true"></i></button>`
    : `<button class="btn btn-sm btn-dark" onclick="${escapeHtml(action)}">${item.type === 'delivery_proof' ? adminIcon('image') : ''}${text}</button>`;
}

async function openCollectionFromAlert(scheduleId, orderId) {
  closeAdminNotificationPanel();
  await showSection("collections");
  const status = document.getElementById("collectionStatusFilter");
  const search = document.getElementById("collectionSearch");
  if (status) status.value = "overdue";
  if (search) search.value = orderId ? orderReference(orderId) : String(scheduleId || "");
  renderCollections();
  document.getElementById("collectionsTable")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function openAdminOrderFromAlert(orderId) {
  closeAdminNotificationPanel();
  const id = Number(orderId);
  if (!id) return;

  const search = document.getElementById("orderSearch");
  const status = document.getElementById("orderStatusFilter");
  const payment = document.getElementById("paymentStatusFilter");
  const repair = document.getElementById("repairStatusFilter");
  if (search) search.value = orderReference(id);
  if (status) status.value = "all";
  if (payment) payment.value = "all";
  if (repair) repair.value = "all";

  await showSection("orders");
  const order = allOrders.find(item => Number(item.id) === id);
  if (!order) {
    alert(`${orderLabel(id)} was not found. It may have been deleted or filtered out.`);
    return;
  }
  viewOrder(id);
}

async function openAdminInventoryFromAlert(productId, type) {
  closeAdminNotificationPanel();
  const id = Number(productId || 0);
  await showSection("inventory");
  const search = document.getElementById("inventorySearch");
  const status = document.getElementById("inventoryStatusFilter");
  const movement = document.getElementById("inventoryMovementFilter");
  const product = allProducts.find(item => Number(item.id) === id);
  if (search) search.value = product?.name || (id ? String(id) : "");
  if (status) status.value = type === "out_stock" ? "out" : "low";
  if (movement) movement.value = "all";
  renderInventory();
}

function openAdminTaskFromBell(section, type) {
  closeAdminNotificationPanel();
  openAdminTask(section, type);
}
function adminTaskCategory(type) {
  if (["low_stock", "out_stock"].includes(type)) return "inventory";
  if (["payment", "overdue"].includes(type)) return "payment";
  if (["installment"].includes(type)) return "installment";
  if (["repair"].includes(type)) return "repair";
  return "order";
}

function adminTaskPriority(type) {
  if (["payment", "overdue", "out_stock"].includes(type)) return "urgent";
  if (["installment", "cancel", "repair", "low_stock"].includes(type)) return "high";
  return "normal";
}

function adminTaskBadgeClass(type) {
  if (["payment", "overdue", "cancel", "out_stock"].includes(type)) return "cancelled";
  if (["repair", "installment", "low_stock"].includes(type)) return "processing";
  return "pending";
}

function setAdminTaskFilter(filter) {
  const requested = filter || "all";
  adminTaskFilter = isStaffUser() && requested !== "all" && !isStaffTaskCategory(requested) ? "all" : requested;
  syncTaskFiltersForRole();
  document.querySelectorAll("#adminTaskFilters [data-task-filter]").forEach(button => {
    const active = button.dataset.taskFilter === adminTaskFilter;
    button.classList.toggle("active", active);
    button.classList.toggle("btn-dark", active);
    button.classList.toggle("btn-outline-dark", !active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderAdminAlerts();
}

function openAdminTask(section, type) {
  if (isStaffUser() && ADMIN_ONLY_SECTIONS.includes(section)) {
    showSection("overview");
    return;
  }

  if (type === "repair") {
    showSection("repairs");
    const status = document.getElementById("repairPageStatusFilter");
    if (status) status.value = "pending";
    renderRepairs();
    return;
  }

  showSection(section || "overview");
  if (section === "orders") {
    const status = document.getElementById("orderStatusFilter");
    const payment = document.getElementById("paymentStatusFilter");
    const repair = document.getElementById("repairStatusFilter");
    if (status) status.value = type === "order" ? "pending" : "all";
    if (payment) payment.value = type === "payment" ? "payment_issue" : "all";
    if (repair) repair.value = type === "repair" ? "pending" : "all";
    renderOrders();
  }
  if (section === "inventory") {
    const search = document.getElementById("inventorySearch");
    const status = document.getElementById("inventoryStatusFilter");
    const movement = document.getElementById("inventoryMovementFilter");
    if (search) search.value = "";
    if (status) status.value = type === "out_stock" ? "out" : "low";
    if (movement) movement.value = "all";
    renderInventory();
  }
}

function renderTaskFilters(items) {
  // Counts describe the loaded queue, not totals outside the API's recent-task limit.
  document.querySelectorAll("#adminTaskFilters [data-task-filter]").forEach(button => {
    const category = button.dataset.taskFilter;
    const count = category === "all" ? items.length : items.filter(item => adminTaskCategory(item.type) === category).length;
    button.querySelector(".task-filter-count").textContent = count;
    button.setAttribute("aria-label", `${button.querySelector(".task-filter-label").textContent}: ${count} tasks`);
    const active = category === adminTaskFilter;
    button.classList.toggle("active", active);
    button.classList.toggle("btn-dark", active);
    button.classList.toggle("btn-outline-dark", !active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.getElementById("taskCenterCount").textContent = `${items.length} ${items.length === 1 ? "task" : "tasks"}`;
}

function renderAdminAlerts() {
  const summary = adminAlerts?.summary || {};
  const items = Array.isArray(adminAlerts?.items) ? adminAlerts.items : [];
  const staffMode = isStaffUser();
  const visibleItems = visibleTaskItemsForRole(items);
  const orderCount = Number(summary.pending_orders || 0);
  const cancellationCount = Number(summary.cancellation_requests || 0);
  const repairCount = Number(summary.repair_requests || 0);
  const installmentCount =
    Number(summary.pending_installments || 0) +
    Number(summary.approved_waiting_downpayment || 0) +
    Number(summary.overdue_installments || 0);
  const paymentCount = Number(summary.overdue_installments || 0) + Number(summary.payment_issues || 0);
  const inventoryCount = Number(summary.low_stock_products || 0) + Number(summary.out_of_stock_products || 0);
  const staffTotal = adminAlerts?.staff_scope ? Number(summary.total || 0) : visibleItems.length || orderCount + cancellationCount + repairCount + inventoryCount;

  setNavBadge("navOverviewBadge", staffMode ? staffTotal : Number(summary.total || items.length || 0));
  setNavBadge("navOrdersBadge", orderCount + cancellationCount);
  setNavBadge("navRepairsBadge", repairCount);
  setNavBadge("navInstallmentsBadge", staffMode ? 0 : installmentCount);
  setNavBadge("navFinanceBadge", staffMode ? 0 : paymentCount);
  setNavBadge("navCollectionsBadge", staffMode ? 0 : Number(collectionSummary.overdue_count ?? summary.overdue_installments ?? 0) + Number(collectionSummary.due_today_count || 0));
  setNavBadge("navInventoryBadge", inventoryCount);

  syncTaskFiltersForRole();
  renderAdminNotificationBell();

  const container = document.getElementById("adminActionCenter");
  if (!container) return;

  const filteredItems = adminTaskFilter === "all"
    ? visibleItems
    : visibleItems.filter(item => adminTaskCategory(item.type) === adminTaskFilter);
  renderTaskFilters(visibleItems);

  if (!visibleItems.length) {
    container.innerHTML = `<div class="overview-queue-empty"><i data-lucide="circle-check" aria-hidden="true"></i><strong>You're all caught up</strong><span class="small">No tasks need your attention right now.</span></div>`;
    refreshAdminIcons();
    return;
  }

  if (!filteredItems.length) {
    container.innerHTML = `<div class="overview-queue-empty"><i data-lucide="list-checks" aria-hidden="true"></i><strong>No tasks in this category</strong></div>`;
    refreshAdminIcons();
    return;
  }

  container.innerHTML = filteredItems.map(item => {
    const priority = adminTaskPriority(item.type);
    const taskLabel = { delivery_proof: "Delivery Proof", order: "Order", cancel: "Cancellation", payment: "Payment", overdue: "Overdue", repair: "Repair", installment: "Installment", low_stock: "Low stock", out_stock: "Out of stock" }[item.type] || "Alert";
    const taskIcon = { delivery_proof: "camera", order: "shopping-bag", cancel: "circle-x", payment: "wallet", overdue: "clock-alert", repair: "wrench", installment: "calendar-clock", low_stock: "package-minus", out_stock: "package-x" }[item.type] || "bell";
    return `
      <div class="action-item task-row ${priority === "urgent" ? "critical" : ""}">
        <span class="task-row-icon ${priority}"><i data-lucide="${taskIcon}" aria-hidden="true"></i></span>
        <div class="task-row-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <div class="task-row-detail">${escapeHtml(item.detail)}</div>
          <div class="task-row-meta">
            <span>${escapeHtml(taskLabel)}</span>
            ${priority !== "normal" ? `<span class="task-row-priority ${priority}">${priority === "urgent" ? "Urgent" : "High priority"}</span>` : ""}
            <span>${escapeHtml(shortDate(item.created_at))}</span>
            ${Number(item.amount) > 0 ? `<span class="task-row-amount">${escapeHtml(money(item.amount))}</span>` : ""}
          </div>
        </div>
        ${adminTaskButtonHtml(item, null, true)}
      </div>
    `;
  }).join("");
  refreshAdminIcons();
}

function orderStatusIndex(status) {
  const index = ORDER_TRACKING_STEPS.findIndex(step => step.key === (status || "pending"));
  return index >= 0 ? index : 0;
}

function trackingDate(order, step, isDone) {
  const value = order[step.dateField] || (step.key === "pending" ? order.created_at : null);
  if (!value || !isDone) return "Waiting";
  return orderDate(value);
}

function orderTrackingHtml(order) {
  const status = orderStatus(order);
  if (status === "cancelled") {
    return `<div class="tracking-cancelled">Order cancelled${order.cancellation_admin_note ? `: ${escapeHtml(order.cancellation_admin_note)}` : ""}</div>`;
  }

  const activeIndex = orderStatusIndex(status);
  return `
    <div class="tracking-timeline">
      ${ORDER_TRACKING_STEPS.map((step, index) => {
        const isDone = index <= activeIndex;
        const isCurrent = index === activeIndex;
        return `
          <div class="tracking-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}">
            <span class="tracking-dot"></span>
            <strong>${escapeHtml(step.label)}</strong>
            <span>${escapeHtml(trackingDate(order, step, isDone))}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}
function allowedStatusOptions(order) {
  const status = orderStatus(order);
  let options = [status, ...(ORDER_STATUS_TRANSITIONS[status] || [])];
  if (isStaffUser()) options = options.filter(option => option === status || ['processing', 'shipped'].includes(option));
  if (status === "pending" && !orderPaymentReadyForProcessing(order)) {
    options = options.filter(option => option !== "processing");
  }
  return options.filter((item, index, list) => list.indexOf(item) === index);
}

function statusOptionsHtml(order) {
  return allowedStatusOptions(order).map(option => `
    <option value="${option}" ${orderStatus(order) === option ? "selected" : ""}>${ORDER_STATUS_LABELS[option]}</option>
  `).join("");
}

function statusSelectDisabled(order) {
  return allowedStatusOptions(order).length <= 1 ? "disabled" : "";
}

function orderPaymentReadyForProcessing(order) {
  const method = String(order.payment_method || "cod").toLowerCase();
  const provider = String(order.payment_provider || "").toLowerCase();
  const status = paymentStatus(order);

  if (provider === "pos" || method === "cash") return true;
  if (method === "cod" || provider === "cod") return ["to_collect", "paid"].includes(status);
  return ["paid", "installment_downpayment_paid", "installment_active", "installment_completed"].includes(status);
}

function orderPaymentBlockText(order) {
  const status = paymentStatus(order);
  if (status === "for_verification") return "GCash proof uploaded. Check it before processing.";
  if (status === "pending_payment") return "Waiting for customer GCash proof before processing.";
  if (status === "rejected") return "Payment proof rejected. Customer must resubmit proof.";
  if (status === "installment_application_pending") return "Installment application needs admin approval first.";
  return "Payment must be verified before processing.";
}

function paymentProcessingWarning(order) {
  if (orderStatus(order) !== "pending" || orderPaymentReadyForProcessing(order)) return "";
  return `<small class="d-block text-muted mt-2">${escapeHtml(orderPaymentBlockText(order))}</small>`;
}

function statusHistoryHtml(order) {
  const history = Array.isArray(order.status_history) ? order.status_history : [];
  if (!history.length) return "";

  return `
    <div class="tracking-history">
      <div class="tracking-history-title">Tracking History</div>
      ${history.map(item => `
        <div class="tracking-history-item">
          <div>
            <strong>${escapeHtml(ORDER_STATUS_LABELS[item.status] || item.status)}</strong>
            <span>${escapeHtml(orderDate(item.created_at))}</span>
          </div>
          <div>
            <strong>${escapeHtml(item.note || "Status updated.")}</strong>
            <span>${escapeHtml(item.actor_name || "System")} ${item.actor_role ? `- ${escapeHtml(item.actor_role)}` : ""}</span>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}
function orderStatus(order) {
  return order.status || "pending";
}

function paymentStatus(order) {
  if (order.payment_status) return order.payment_status;
  return String(order.payment_method || "cod") === "cod" ? "to_collect" : "pending_verification";
}

function isGCashMethod(method) {
  const value = String(method || "").toLowerCase();
  return value === "gcash" || Boolean(value && !["cod", "cash", "installment", "manual", "pos"].includes(value));
}

function isOldPaymentUrl(url) {
  return /gcash/i.test(String(url || ""));
}

function usableCheckoutUrl(record) {
  const url = record?.payment_checkout_url || "";
  return isOldPaymentUrl(url) ? "" : url;
}

function paymentReviewAmount(order) {
  if (order.payment_method === "installment") return Number(order.installment_downpayment || order.total_price || 0);
  return Number(order.total_price || 0);
}

function paymentReviewStatusClass(order) {
  const status = paymentStatus(order);
  if (["paid", "installment_downpayment_paid", "installment_active", "installment_completed"].includes(status)) return "paid";
  if (status === "for_verification" && order.gcash_reference && order.payment_proof_image) return "review";
  if (["rejected", "failed", "payment_setup_failed", "installment_downpayment_failed"].includes(status)) return "rejected";
  return "pending";
}

function paymentReviewHtml(order) {
  const status = paymentStatus(order);
  const reference = order.gcash_reference || order.payment_reference || "";
  const proof = order.payment_proof_image || "";
  const canReview = isAdminUser() && status === "for_verification" && Boolean(reference) && Boolean(proof);
  return `
    <div class="payment-review-card ${paymentReviewStatusClass(order)}">
      <div class="payment-review-head">
        <div>
          <span>GCash Payment</span>
          <strong>${paymentMethodLabel(order.payment_method)}</strong>
          <small>${escapeHtml(PAYMENT_STATUS_LABELS[status] || status)}</small>
        </div>
        <div class="payment-review-amount">
          <span>Expected Amount</span>
          <strong>${money(paymentReviewAmount(order))}</strong>
        </div>
      </div>

      <div class="payment-review-grid">
        <div class="payment-review-field">
          <span>GCash Reference</span>
          <strong>${reference ? escapeHtml(reference) : "Not submitted"}</strong>
        </div>
        <div class="payment-review-field">
          <span>Submitted</span>
          <strong>${order.payment_submitted_at ? escapeHtml(formatDate(order.payment_submitted_at)) : "Not yet"}</strong>
        </div>
        <div class="payment-review-field">
          <span>Verified</span>
          <strong>${order.payment_verified_at ? escapeHtml(formatDate(order.payment_verified_at)) : "Not yet"}</strong>
        </div>
        <div class="payment-review-field">
          <span>Verified By</span>
          <strong>${order.payment_verified_by_name ? escapeHtml(order.payment_verified_by_name) : "Not yet"}</strong>
        </div>
      </div>

      ${proof ? `
        <a class="payment-proof-preview" href="${escapeHtml(proof)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(proof)}" alt="GCash payment proof">
          <span>Open submitted receipt</span>
        </a>
      ` : `<div class="payment-proof-empty">No payment screenshot uploaded yet.</div>`}

      ${order.payment_rejection_reason ? `<div class="payment-review-note rejected">Rejected: ${escapeHtml(order.payment_rejection_reason)}</div>` : ""}
      ${order.payment_error ? `<div class="payment-review-note">Issue: ${escapeHtml(order.payment_error)}</div>` : ""}

      <div class="payment-review-actions">
        ${canReview ? `
          <button type="button" class="btn btn-sm btn-dark" onclick="verifyGcashPayment(${order.id}, 'approved')">${adminIcon("check-circle-2")}<span>Approve Payment</span></button>
          <button type="button" class="btn btn-sm btn-outline-dark" onclick="verifyGcashPayment(${order.id}, 'rejected')">${adminIcon("x-circle")}<span>Reject Payment</span></button>
        ` : ""}
        ${String(order.payment_provider || "").includes("gcash") ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="refreshPaymentStatus(${order.id})">${adminIcon("refresh-cw")}<span>Refresh Status</span></button>` : ""}
      </div>
    </div>
  `;
}

function cancellationStatusLabel(status) {
  const labels = {
    pending: "Cancel Requested",
    approved: "Cancellation Approved",
    rejected: "Cancellation Rejected"
  };
  return labels[status] || status || "";
}

function cancellationRequestHtml(order, showActions = true) {
  if (!order.cancellation_request_status) return "";

  const status = order.cancellation_request_status;
  const canReview = isAdminUser() && showActions && status === "pending";
  return `
    <div class="mt-2 p-2 border rounded">
      <strong>${escapeHtml(cancellationStatusLabel(status))}</strong>
      ${order.cancellation_reason ? `<div class="small text-muted">Reason: ${escapeHtml(order.cancellation_reason)}</div>` : ""}
      ${order.cancellation_admin_note ? `<div class="small text-muted">Admin note: ${escapeHtml(order.cancellation_admin_note)}</div>` : ""}
      ${canReview ? `
        <div class="d-flex gap-2 mt-2 flex-wrap">
          <button class="btn btn-sm btn-dark" onclick="reviewCancellationRequest(${order.id}, 'approved')">Approve Cancel</button>
          <button class="btn btn-sm btn-outline-dark" onclick="reviewCancellationRequest(${order.id}, 'rejected')">Reject</button>
        </div>
      ` : ""}
    </div>
  `;
}

function repairStatusLabel(status) {
  const labels = {
    pending: "Repair Requested",
    approved: "Repair Approved",
    rejected: "Repair Rejected"
  };
  return labels[status] || status || "";
}

function repairServiceStatusLabel(status) {
  const labels = {
    approved: "Approved",
    item_received: "Item Received",
    diagnosing: "Diagnosing",
    repairing: "Repairing",
    ready_for_pickup: "Ready for Pickup",
    completed: "Completed"
  };
  return labels[status] || status || "Not Started";
}

const REPAIR_SERVICE_STATUSES = ["approved", "item_received", "diagnosing", "repairing", "ready_for_pickup", "completed"];
function repairProgressOptions(order) {
  if (!isStaffUser()) return REPAIR_SERVICE_STATUSES;
  const current = order.repair_service_status || 'approved';
  const index = REPAIR_SERVICE_STATUSES.indexOf(current);
  return REPAIR_SERVICE_STATUSES.slice(Math.max(index, 0), Math.max(index, 0) + 2);
}

function isWarrantyActive(order) {
  if ((order.status || "") !== "delivered") return false;
  if (!order.warranty_expires_at) return true;
  return new Date(order.warranty_expires_at).getTime() >= Date.now();
}

function warrantyHtml(order) {
  if ((order.status || "") !== "delivered") return "";
  const warrantyDate = order.warranty_expires_at ? shortDate(order.warranty_expires_at) : "Active";
  const status = isWarrantyActive(order) ? "Active" : "Expired";
  return `<div class="small text-muted mt-1">Warranty: ${escapeHtml(warrantyDate)} (${status})</div>`;
}

function repairRequestHtml(order) {
  if (!order.repair_request_status) return "";

  const status = order.repair_request_status;
  const canReview = isAdminUser() && status === "pending";
  const canTrack = status === "approved";
  return `
    <div class="mt-2 p-2 border rounded">
      <strong>${escapeHtml(repairStatusLabel(status))}</strong>
      ${warrantyHtml(order)}
      ${canTrack ? `<div class="small text-muted">Service Status: ${escapeHtml(repairServiceStatusLabel(order.repair_service_status))}</div>` : ""}
      ${order.repair_issue ? `<div class="small text-muted">Issue: ${escapeHtml(order.repair_issue)}</div>` : ""}
      ${order.repair_admin_note ? `<div class="small text-muted">Repair instructions: ${escapeHtml(order.repair_admin_note)}</div>` : ""}
      ${canReview ? `
        <div class="d-flex gap-2 mt-2 flex-wrap">
          <button class="btn btn-sm btn-dark" onclick="reviewRepairRequest(${order.id}, 'approved')">Approve Repair</button>
          <button class="btn btn-sm btn-outline-dark" onclick="reviewRepairRequest(${order.id}, 'rejected')">Reject</button>
        </div>
      ` : ""}
      ${canTrack ? `
        <div class="d-flex gap-2 mt-2 flex-wrap">
          <select class="form-select form-select-sm" style="max-width: 220px" onchange="updateRepairStatus(${order.id}, this.value)">
            ${repairProgressOptions(order).map(option => `
              <option value="${option}" ${(order.repair_service_status || "approved") === option ? "selected" : ""}>${repairServiceStatusLabel(option)}</option>
            `).join("")}
          </select>
          <button class="btn btn-sm btn-outline-dark" onclick="addRepairNote(${order.id})">Add Note</button>
        </div>
      ` : ""}
    </div>
  `;
}

function canOpenCheckout(order) {
  if (!usableCheckoutUrl(order)) return false;
  if (order.payment_method === "installment") {
    return order.payment_status === "installment_downpayment_pending" &&
      order.installment_application_status === "approved";
  }
  return true;
}

function canRegeneratePaymentLink(order) {
  const status = paymentStatus(order);
  if ((order.status || "") === "cancelled") return false;
  if (["paid", "installment_active", "installment_completed", "installment_rejected"].includes(status)) return false;
  if (order.payment_method === "installment") {
    return order.installment_application_status === "approved" &&
      (["installment_downpayment_pending", "installment_downpayment_failed", "installment_downpayment_expired", "payment_setup_failed"].includes(status) ||
        isOldPaymentUrl(order.payment_checkout_url));
  }
  return isGCashMethod(order.payment_method) &&
    (!usableCheckoutUrl(order) || ["payment_setup_failed", "failed", "expired", "cancelled"].includes(status));
}

function installmentStatus(application) {
  return application.status || "pending";
}

function fullCustomerAddress(order) {
  if (order.delivery_address) return order.delivery_address;

  return [
    order.customer_address,
    order.customer_city,
    order.customer_province,
    order.customer_postal_code
  ].filter(Boolean).join(", ");
}

function shippingRegionLabel(order) {
  const labels = {
    local: "Local / Nearby Sogod-Bacacay",
    luzon: "Luzon",
    visayas: "Visayas"
  };
  const key = String(order.shipping_region || "").toLowerCase();
  return labels[key] || order.shipping_region || "";
}

function orderShippingFee(order) {
  return Number(order.shipping_fee || 0);
}

function orderProductSubtotal(order) {
  return normalizedOrderItems(order).reduce((sum, item) => {
    const qty = Number(item.quantity || 1);
    const subtotal = Number(item.subtotal || Number(item.unit_price || 0) * qty);
    return sum + subtotal;
  }, 0);
}

function shippingSummaryLine(order) {
  const label = shippingRegionLabel(order);
  const fee = orderShippingFee(order);
  if (!label && !fee) return "";
  return `${label || "Delivery"} / ${money(fee)}`;
}

function printableShippingTotalHtml(order) {
  const line = shippingSummaryLine(order);
  return `
    <div class="muted-total">Product Subtotal: ${money(orderProductSubtotal(order))}</div>
    ${line ? `<div class="muted-total">Shipping: ${escapeHtml(line)}</div>` : ""}
    <div>Total: ${money(order.total_price)}</div>
  `;
}

async function exportAllReports() {
  if (!requireAdminAction("Only admin can export all reports.")) return;
  if (!allOrders.length) await loadOrders();
  if (!allProducts.length) await loadProducts();
  if (!allCustomers.length) await loadCustomers();
  if (!installmentApplications.length) await loadInstallmentApplications();
  if (!installmentSchedules.length) await loadInstallmentSchedules();
  exportOrdersCsv();
  exportInventoryCsv();
  exportCustomersCsv();
  exportInstallmentApplicationsCsv();
  exportInstallmentSchedulesCsv();
  exportFinanceCsv();
  exportAnalyticsCsv();
}
function showSection(id) {
  if (id === 'staffAccount' && !isStaffUser()) id = 'overview';
  if (ADMIN_ONLY_SECTIONS.includes(id) && !isAdminUser()) {
    alert("Admin access only for this section.");
    id = "overview";
  }

  const section = document.getElementById(id);
  if (!section) return;

  document.querySelectorAll(".section").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".nav-button").forEach(button => button.classList.remove("active"));
  section.classList.add("active");
  document.querySelector(`[data-section="${id}"]`)?.classList.add("active");
  refreshRoleVisibility();

  if (id === "inventory") {
    renderInventory();
    loadInventoryMovements();
  }
  if (id === "orders") return loadOrders();
  if (id === "repairs") return loadOrders();
  if (id === "customers") loadCustomers();
  if (id === "staff") loadStaffAccounts();
  if (id === "installments") {
    loadInstallmentApplications();
    loadInstallmentSchedules();
  }
  if (id === "pos") {
    renderPosProducts();
    renderPOSDashboard();
    if (!allOrders.length) loadOrders();
  }
  if (id === "vouchers") { renderVoucherProductOptions(); loadVouchers(); }
  if (id === "collections") return loadCollections();
  if (id === "layaway") {
    prepareLayawayForm();
    return loadLayaways();
  }
  if (id === "finance") loadFinance();
  if (id === "riders") {
    loadRiderAccounts();
    loadDeliveryAssignments();
  }
  if (id === "audit") loadAuditLogs();
  if (id === 'staffAccount') window.StaffWorkspace?.account();
}

async function refreshAll() {
  await loadProducts();
  await loadOrders();
  await loadInventoryMovements();
  await loadAdminAlerts();
  if (isAdminUser()) {
    await loadVouchers();
    await loadCustomers();
    await loadInstallmentApplications();
    await loadInstallmentSchedules();
    await loadCollections();
    await loadLayaways();
    await loadRiderAccounts();
    await loadDeliveryAssignments();
    await loadFinance();
  }
  renderInventory();
  renderPosProducts();
  renderPOSDashboard();
}

async function loadAuditLogs() {
  if (!isAdminUser()) return;
  const table = document.getElementById("auditLogTable");
  if (table) table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Loading audit logs...</td></tr>`;
  try {
    const res = await fetch(`/admin/audit-logs?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load audit logs.");
    auditLogs = Array.isArray(data) ? data : [];
    renderAuditLogs();
  } catch (error) {
    if (table) table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Unable to load audit logs.</td></tr>`;
  }
}

function auditActionLabel(action) {
  return String(action || "action")
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function auditActionClass(action) {
  const value = String(action || "").toLowerCase();
  if (value.includes("delete") || value.includes("reject") || value.includes("cancel")) return "audit-critical";
  if (value.includes("create") || value.includes("approve")) return "audit-create";
  if (value.includes("update") || value.includes("status") || value.includes("repair")) return "audit-update";
  return "audit-neutral";
}

function auditEntityText(log) {
  const entityType = String(log.entity_type || "-");
  if (!log.entity_id) return entityType;
  const idText = entityType.toLowerCase() === "order" ? orderReference(log.entity_id) : `#${log.entity_id}`;
  return `${entityType} ${idText}`;
}

function auditDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function isCriticalAudit(log) {
  const action = String(log.action || "").toLowerCase();
  return action.includes("delete") || action.includes("reject") || action.includes("cancel");
}

function getFilteredAuditLogs() {
  const search = document.getElementById("auditSearch")?.value.toLowerCase() || "";
  const role = document.getElementById("auditRoleFilter")?.value || "all";
  const entity = document.getElementById("auditEntityFilter")?.value || "all";
  const action = document.getElementById("auditActionFilter")?.value || "all";

  return auditLogs.filter(log => {
    const roleText = String(log.actor_role || "system").toLowerCase();
    const entityText = String(log.entity_type || "").toLowerCase();
    const actionText = String(log.action || "").toLowerCase();
    const detailsText = String(log.details || "").toLowerCase();
    const searchText = [
      log.id,
      log.actor_name,
      roleText,
      actionText,
      auditActionLabel(log.action),
      entityText,
      log.entity_id,
      auditEntityText(log),
      detailsText,
      log.created_at
    ].join(" ").toLowerCase();

    const matchesRole = role === "all" || roleText === role;
    const matchesEntity = entity === "all" || entityText === entity;
    const matchesAction = action === "all" || actionText.includes(action);
    return searchText.includes(search) && matchesRole && matchesEntity && matchesAction;
  });
}

function renderAuditSummary(filteredLogs = auditLogs) {
  const today = auditDateKey(new Date());
  const values = {
    auditTotalCount: filteredLogs.length,
    auditTodayCount: filteredLogs.filter(log => auditDateKey(log.created_at) === today).length,
    auditAdminCount: filteredLogs.filter(log => String(log.actor_role || "").toLowerCase() === "admin").length,
    auditCriticalCount: filteredLogs.filter(isCriticalAudit).length
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
}

function resetAuditFilters() {
  const fields = {
    auditSearch: "",
    auditRoleFilter: "all",
    auditEntityFilter: "all",
    auditActionFilter: "all"
  };
  Object.entries(fields).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });
  renderAuditLogs();
}

function renderAuditLogs() {
  const table = document.getElementById("auditLogTable");
  if (!table) return;

  const logs = getFilteredAuditLogs();
  renderAuditSummary(logs);

  if (!auditLogs.length) {
    table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No audit logs yet.</td></tr>`;
    return;
  }

  if (!logs.length) {
    table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No audit logs match the current filters.</td></tr>`;
    return;
  }

  table.innerHTML = logs.map(log => `
    <tr>
      <td><strong>${escapeHtml(orderDate(log.created_at))}</strong><br><small class="text-muted">Log #${escapeHtml(log.id || "-")}</small></td>
      <td><strong>${escapeHtml(log.actor_name || "System")}</strong><br><span class="role-chip">${escapeHtml(log.actor_role || "system")}</span></td>
      <td><span class="audit-action-chip ${auditActionClass(log.action)}">${escapeHtml(auditActionLabel(log.action))}</span></td>
      <td><strong>${escapeHtml(auditEntityText(log))}</strong></td>
      <td class="audit-detail-cell">${escapeHtml(log.details || "")}</td>
    </tr>
  `).join("");
}

function exportAuditLogsCsv() {
  const logs = getFilteredAuditLogs();
  if (!logs.length) {
    alert("No audit logs to export.");
    return;
  }

  const rows = [
    ["Log ID", "Date", "Actor", "Role", "Action", "Entity Type", "Entity ID", "Details"],
    ...logs.map(log => [
      log.id || "",
      orderDate(log.created_at),
      log.actor_name || "System",
      log.actor_role || "system",
      auditActionLabel(log.action),
      log.entity_type || "",
      log.entity_id || "",
      log.details || ""
    ])
  ];

  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadStaffAccounts() {
  if (!isAdminUser()) return;
  const table = document.getElementById("staffTable");
  if (table) table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Loading staff accounts...</td></tr>`;
  try {
    const res = await fetch(`/admin/staff?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load staff accounts.");
    staffAccounts = Array.isArray(data) ? data : [];
    renderStaffAccounts();
  } catch (error) {
    if (table) table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Unable to load staff accounts.</td></tr>`;
  }
}

function renderStaffAccounts() {
  const table = document.getElementById("staffTable");
  if (!table) return;
  if (!staffAccounts.length) {
    table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No staff accounts yet.</td></tr>`;
    return;
  }
  table.innerHTML = staffAccounts.map(staff => `
    <tr>
      <td>${staff.id}</td>
      <td><strong>${escapeHtml(staff.name || "Staff")}</strong></td>
      <td>${escapeHtml(staff.email || "")}</td>
      <td>${employeeStatusHtml(staff)}</td>
      <td>${employeeActionsHtml(staff,'staff')}</td>
    </tr>
  `).join("");
  refreshAdminIcons();
}

async function createStaffAccount() {
  await submitEmployeeInvitation('staff');
}

function employeeStatusHtml(user) {
  const status = user.account_status || 'active';
  const labels = { active: 'Active',pending_activation: 'Pending Activation',disabled: 'Disabled' };
  return `<span class="employee-status">${adminIcon(status === 'active' ? 'circle-check' : status === 'disabled' ? 'ban' : 'mail')}<span>${labels[status] || 'Unavailable'}</span></span>`;
}
function employeeActionsHtml(user,role) {
  const id = Number(user.id); const status = user.account_status || 'active';
  const action = (name,label,icon) => `<button class="btn btn-sm btn-outline-dark" type="button" onclick="employeeAccountAction('${role}',${id},'${name}',this)">${adminIcon(icon)}<span>${label}</span></button>`;
  return `<div class="employee-account-actions">${status === 'pending_activation' ? action('invitation','Resend Invitation','mail') : ''}${action(status === 'disabled' ? 'enabled' : 'disabled',status === 'disabled' ? 'Enable' : 'Disable',status === 'disabled' ? 'user-check' : 'user-round-x')}<button class="btn btn-sm btn-outline-dark" type="button" onclick="${role === 'staff' ? 'deleteStaffAccount' : 'deleteRiderAccount'}(${id})" title="Delete account" aria-label="Delete ${escapeHtml(user.name)} account">${adminIcon('trash-2')}</button></div>`;
}
async function submitEmployeeInvitation(role) {
  if (!requireAdminAction()) return;
  const button = document.getElementById(`${role}InviteButton`);
  if (button.disabled) return;
  const message = document.getElementById(`${role}Message`);
  const payload = { name: document.getElementById(`${role}Name`).value.trim(),email: document.getElementById(`${role}Email`).value.trim(),...(role === 'rider' ? { phone: document.getElementById('riderPhone').value.trim() } : {}) };
  button.disabled = true; message.textContent = 'Sending invitation...';
  try {
    const res = await fetch(`/admin/${role === 'staff' ? 'staff' : 'riders'}`,{ method: 'POST',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(payload) });
    const data = await res.json(); message.textContent = data.message;
    if (!res.ok) return;
    [`${role}Name`,`${role}Email`,...(role === 'rider' ? ['riderPhone'] : [])].forEach(id => document.getElementById(id).value = '');
    await (role === 'staff' ? loadStaffAccounts() : loadRiderAccounts());
  } catch (_) { message.textContent = 'Unable to send invitation. Please try again.'; }
  finally { button.disabled = false; }
}
async function employeeAccountAction(role,id,action,button) {
  if (!requireAdminAction() || button.disabled) return;
  button.disabled = true;
  try {
    if (action !== 'invitation' && !await AppDialog.confirm({ title: action === 'disabled' ? 'Disable account?' : 'Enable account?',message: action === 'disabled' ? 'Current sessions will be signed out. Reassign active deliveries first.' : 'Unverified accounts will still need an activation invitation.',confirmText: action === 'disabled' ? 'Disable Account' : 'Enable Account' })) return;
    const res = await fetch(`/admin/${role === 'staff' ? 'staff' : 'riders'}/${id}/${action === 'invitation' ? 'invitation' : 'status'}`,{ method: action === 'invitation' ? 'POST' : 'PUT',headers: { 'Content-Type': 'application/json' },body: JSON.stringify(action === 'invitation' ? {} : { status: action }) });
    const data = await res.json(); document.getElementById(`${role}Message`).textContent = data.message;
    if (res.ok) await (role === 'staff' ? loadStaffAccounts() : loadRiderAccounts());
  } catch (_) { document.getElementById(`${role}Message`).textContent = 'Unable to update account. Please try again.'; }
  finally { button.disabled = false; }
}

async function deleteStaffAccount(id) {
  if (!requireAdminAction()) return;
  const confirmed = await AppDialog.confirm({
    title: "Delete staff account?",
    message: "The staff member will immediately lose access to the dashboard.",
    details: [{ label: "Staff ID", value: id }],
    confirmText: "Delete Account",
    tone: "danger"
  });
  if (!confirmed) return;
  const res = await fetch(`/admin/staff/${id}?${actorQueryString()}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) return alert(data.message || "Unable to delete staff account.");
  await loadStaffAccounts();
}
function deliveryStatusLabel(status) {
  return DELIVERY_STATUS_LABELS[status] || status || "Unassigned";
}

function deliveryStatusClass(status) {
  const map = {
    assigned: "pending",
    picked_up: "processing",
    out_for_delivery: "processing",
    delivered: "delivered",
    failed_attempt: "cancelled",
    cancelled: "cancelled"
  };
  return map[status] || "pending";
}

function deliveryStatusBadge(status) {
  return `<span class="status-badge ${deliveryStatusClass(status)}">${escapeHtml(deliveryStatusLabel(status))}</span>`;
}

function deliveryAssignmentForOrder(orderId, includeClosed = true) {
  const matches = deliveryAssignments.filter(item => Number(item.order_id) === Number(orderId));
  return matches.find(item => DELIVERY_ACTIVE_STATUSES.includes(String(item.status || ""))) || (includeClosed ? matches[0] : null);
}

function deliveryAssignmentHtml(order) {
  const assignment = deliveryAssignmentForOrder(order.id, true);
  if (!assignment) {
    if (isAdminUser() && deliveryLoadState !== "ready") return `<div class="delivery-mini admin-only mt-2"><strong>${deliveryLoadState === "error" ? "Delivery information unavailable" : "Loading delivery information"}</strong></div>`;
    return `<div class="delivery-mini delivery-unassigned admin-only mt-2"><strong>Delivery not assigned</strong><div class="delivery-meta">Admin delivery or rider delivery available.</div></div>`;
  }

  const rider = assignment.rider_name || "Rider";
  const phone = assignment.rider_phone ? `<div class="delivery-meta">${escapeHtml(assignment.rider_phone)}</div>` : "";
  const note = assignment.delivery_note ? `<div class="delivery-meta">Note: ${escapeHtml(assignment.delivery_note)}</div>` : "";
  return `
    <div class="delivery-mini admin-only mt-2">
      <div class="d-flex justify-content-between align-items-start gap-2">
        <strong>${escapeHtml(rider)}</strong>
        ${deliveryStatusBadge(assignment.status)}
      </div>
      ${phone}
      ${note}
      ${assignment.delivery_proof_file && isAdminUser() ? `<button type="button" class="btn btn-sm btn-outline-dark mt-2" onclick="openDeliveryProof(${Number(assignment.id)})">${adminIcon("image")}View Delivery Proof</button>` : ""}
    </div>
  `;
}

function assignRiderButton(order) {
  if (!isAdminUser()) return "";
  if (["delivered", "cancelled"].includes(orderStatus(order))) return "";
  const assignment = deliveryAssignmentForOrder(order.id, false);
  const label = assignment ? "Change Rider" : "Assign Rider";
  return `<button type="button" class="btn btn-sm btn-outline-dark admin-only" onclick="quickAssignRider(${order.id})">${adminIcon("truck")}<span>${label}</span></button>`;
}

function renderRiderAccounts() {
  const table = document.getElementById("riderTable");
  if (!table) return;
  renderDeliveryRiderOptions();
  if (!riderAccounts.length) {
    table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No rider accounts yet.</td></tr>`;
    return;
  }
  table.innerHTML = riderAccounts.map(rider => `
    <tr>
      <td>${rider.id}</td>
      <td><strong>${escapeHtml(rider.name || "Rider")}</strong></td>
      <td>${escapeHtml(rider.email || "")}</td>
      <td>${escapeHtml(rider.phone || "No phone")}</td>
      <td>${employeeStatusHtml(rider)}</td>
      <td>${employeeActionsHtml(rider,'rider')}</td>
    </tr>
  `).join("");
  refreshAdminIcons();
}

async function loadRiderAccounts() {
  if (!isAdminUser()) return;
  const table = document.getElementById("riderTable");
  if (table) table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Loading rider accounts...</td></tr>`;
  try {
    const res = await fetch(`/admin/riders?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load rider accounts.");
    riderAccounts = Array.isArray(data) ? data : [];
    renderRiderAccounts();
  } catch (error) {
    riderAccounts = [];
    renderRiderAccounts();
    if (table) table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Unable to load rider accounts.</td></tr>`;
  }
}

async function createRiderAccount() { await submitEmployeeInvitation('rider'); }

async function deleteRiderAccount(id) {
  if (!requireAdminAction("Only admin can delete rider accounts.")) return;
  const confirmed = await AppDialog.confirm({
    title: "Delete rider account?",
    message: "Active assigned deliveries must be cancelled or completed before this rider can be deleted.",
    details: [{ label: "Rider ID", value: id }],
    confirmText: "Delete Account",
    tone: "danger"
  });
  if (!confirmed) return;
  const res = await fetch(`/admin/riders/${id}?${actorQueryString()}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) return alert(data.message || "Unable to delete rider account.");
  await loadRiderAccounts();
}

function computedDeliverySummary() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total_count: deliveryAssignments.length,
    active_count: deliveryAssignments.filter(item => DELIVERY_ACTIVE_STATUSES.includes(item.status)).length,
    assigned_count: deliveryAssignments.filter(item => item.status === "assigned").length,
    picked_up_count: deliveryAssignments.filter(item => item.status === "picked_up").length,
    out_for_delivery_count: deliveryAssignments.filter(item => item.status === "out_for_delivery").length,
    failed_attempt_count: deliveryAssignments.filter(item => item.status === "failed_attempt").length,
    delivered_today_count: deliveryAssignments.filter(item => item.status === "delivered" && String(item.delivered_at || "").slice(0, 10) === today).length
  };
}

function renderDeliverySummary() {
  const fallback = computedDeliverySummary();
  const summary = { ...fallback, ...deliverySummary };
  const setText = (id, value) => { const el = document.getElementById(id); if (el) el.innerText = value; };
  setText("deliveryActiveCount", summary.active_count || 0);
  setText("deliveryAssignedCount", summary.assigned_count || 0);
  setText("deliveryOutCount", summary.out_for_delivery_count || 0);
  setText("deliveryFailedCount", summary.failed_attempt_count || 0);
  setText("deliveryDeliveredTodayCount", summary.delivered_today_count || 0);
  setNavBadge("navRidersBadge", summary.active_count || 0);
}

function renderDeliveryRiderOptions() {
  const select = document.getElementById("deliveryRiderSelect");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">Select rider</option>` + riderAccounts.filter(rider => !rider.account_status || rider.account_status === 'active').map(rider => `<option value="${rider.id}">${escapeHtml(rider.name || "Rider")} - ${escapeHtml(rider.phone || rider.email || "")}</option>`).join("");
  if (selected && [...select.options].some(option => option.value === selected)) select.value = selected;
}

function renderDeliveryOrderOptions() {
  const select = document.getElementById("deliveryOrderSelect");
  if (!select) return;
  const selected = select.value;
  const deliverable = allOrders.filter(order => {
    if (["cancelled", "delivered"].includes(orderStatus(order))) return false;
    if (String(order.delivery_contact || "").toUpperCase() === "POS") return false;
    return Boolean(fullCustomerAddress(order));
  });
  select.innerHTML = `<option value="">Select order for delivery</option>` + deliverable.map(order => {
    const assignment = deliveryAssignmentForOrder(order.id, false);
    const suffix = assignment ? ` - ${deliveryStatusLabel(assignment.status)} to ${assignment.rider_name || "rider"}` : "";
    return `<option value="${order.id}">${orderReference(order)} - ${escapeHtml(order.customer_name || order.recipient_name || "Customer")}${escapeHtml(suffix)}</option>`;
  }).join("");
  if (selected && [...select.options].some(option => option.value === selected)) select.value = selected;
}

function assignmentItemsSummary(assignment) {
  const items = Array.isArray(assignment.items) ? assignment.items : [];
  if (!items.length) return escapeHtml(assignment.product_name || "Product");
  return items.slice(0, 3).map(item => `${escapeHtml(item.product_name || "Product")} x${item.quantity || 1}`).join(" | ") + (items.length > 3 ? ` +${items.length - 3} more` : "");
}

function getFilteredDeliveryAssignments() {
  const search = document.getElementById("deliverySearch")?.value.toLowerCase() || "";
  const status = document.getElementById("deliveryStatusFilter")?.value || "all";
  return deliveryAssignments.filter(assignment => {
    const text = [
      orderReference(assignment.order_id),
      assignment.customer_display_name,
      assignment.customer_display_phone,
      assignment.delivery_display_address,
      assignment.rider_name,
      assignment.rider_phone,
      assignmentItemsSummary(assignment)
    ].join(" ").toLowerCase();
    return text.includes(search) && (status === "all" || assignment.status === status);
  });
}

function renderDeliveryAssignments() {
  renderDeliverySummary();
  renderDeliveryOrderOptions();
  renderDeliveryRiderOptions();
  const table = document.getElementById("deliveryAssignmentTable");
  if (!table) return;
  const rows = getFilteredDeliveryAssignments();
  if (!rows.length) {
    table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No delivery assignments found.</td></tr>`;
    return;
  }
  table.innerHTML = rows.map(item => {
    const active = DELIVERY_ACTIVE_STATUSES.includes(item.status);
    return `
      <tr>
        <td><strong>${orderReference(item.order_id)}</strong><br><small class="text-muted">${orderDate(item.created_at || item.assigned_at)}</small><br><small class="text-muted">${assignmentItemsSummary(item)}</small></td>
        <td>${escapeHtml(item.customer_display_name || "Customer")}<br><small class="text-muted">${escapeHtml(item.customer_display_phone || "No phone")}</small></td>
        <td><strong>${escapeHtml(item.rider_name || "Rider")}</strong><br><small class="text-muted">${escapeHtml(item.rider_phone || "No phone")}</small></td>
        <td>${deliveryStatusBadge(item.status)}<br><small class="text-muted">Assigned ${formatDate(item.assigned_at)}</small>${item.delivered_at ? `<br><small class="text-muted">Delivered ${formatDate(item.delivered_at)}</small>` : ""}</td>
        <td>${escapeHtml(item.delivery_display_address || "No address")} ${item.delivery_note ? `<br><small class="text-muted">Note: ${escapeHtml(item.delivery_note)}</small>` : ""} ${item.failed_reason ? `<br><small class="text-muted">Reason: ${escapeHtml(item.failed_reason)}</small>` : ""}</td>
        <td><div class="order-actions"><button class="btn btn-sm btn-outline-dark" onclick="viewOrder(${item.order_id})">View Order</button>${item.delivery_proof_file ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="openDeliveryProof(${Number(item.id)})">${adminIcon("image")}View Proof</button>` : ""}${active ? `<button class="btn btn-sm btn-outline-dark" onclick="cancelDeliveryAssignment(${item.id})">Cancel</button>` : ""}</div></td>
      </tr>
    `;
  }).join("");
}

async function loadDeliveryAssignments() {
  if (!isAdminUser()) return;
  deliveryLoadState = "loading";
  const table = document.getElementById("deliveryAssignmentTable");
  if (table) table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Loading delivery assignments...</td></tr>`;
  try {
    const res = await fetch(`/admin/riders/assignments?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load delivery assignments.");
    deliveryAssignments = Array.isArray(data.items) ? data.items : [];
    deliveryLoadState = "ready";
    deliverySummary = data.summary || {};
    renderDeliveryAssignments();
    renderOrders();
  } catch (error) {
    deliveryAssignments = [];
    deliveryLoadState = "error";
    deliverySummary = {};
    renderDeliveryAssignments();
    renderOrders();
    if (table) table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Unable to load delivery assignments.</td></tr>`;
  }
}

async function assignRiderToOrder(orderId = null) {
  if (!requireAdminAction("Only admin can assign riders.")) return;
  const select = document.getElementById("deliveryOrderSelect");
  const riderSelect = document.getElementById("deliveryRiderSelect");
  const message = document.getElementById("deliveryAssignMessage");
  const payload = {
    order_id: Number(orderId || select?.value || 0),
    rider_id: Number(riderSelect?.value || 0),
    note: document.getElementById("deliveryAssignNote")?.value.trim() || "",
    ...actorPayload()
  };
  if (!payload.order_id) return alert("Select an order for delivery.");
  if (!payload.rider_id) return alert("Select a rider.");
  if (message) message.innerText = "Assigning rider...";
  const res = await fetch("/admin/riders/assignments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    if (message) message.innerText = data.message || "Unable to assign rider.";
    return;
  }
  if (message) message.innerText = data.message || "Rider assigned.";
  const note = document.getElementById("deliveryAssignNote");
  if (note) note.value = "";
  await loadDeliveryAssignments();
  await loadOrders();
}

function quickAssignRider(orderId) {
  if (!requireAdminAction("Only admin can assign riders.")) return;
  orderModal.hide();
  showSection("riders");
  setTimeout(() => {
    renderDeliveryOrderOptions();
    const select = document.getElementById("deliveryOrderSelect");
    if (select) select.value = String(orderId);
    document.getElementById("deliveryRiderSelect")?.focus();
    document.getElementById("deliveryOrderSelect")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 150);
}

const adminDeliveryUpdates = new Set();
async function adminDeliveryAction(orderId, status) {
  if (!isAdminUser() || adminDeliveryUpdates.has(orderId)) return;
  const order = allOrders.find(item => Number(item.id) === Number(orderId));
  if (!order || orderStatus(order) !== 'shipped') return;
  adminDeliveryUpdates.add(orderId);
  try {
    let assignment = deliveryAssignmentForOrder(orderId, false);
    if (status === 'delivered') {
      if (!assignment) throw new Error('Start delivery before marking the order delivered.');
      orderModal.hide();
      window.DeliveryProofRider.open(assignment.id, assignment, {
        role: 'admin', basePath: '/admin/riders',
        onComplete: async () => { await loadDeliveryAssignments(); await loadOrders(); }
      });
      return;
    }
    const confirmed = await AppDialog.confirm({
      title: 'Start delivery',
      message: assignment ? `Mark this order out for delivery with ${assignment.rider_name || 'the assigned delivery handler'}?` : 'You will handle this delivery as admin. Notify the customer that their order is on the way?',
      confirmText: 'Out for Delivery'
    });
    if (!confirmed) return;
    if (!assignment) {
      const response = await fetch('/admin/riders/self-delivery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: orderId, ...actorPayload() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to select admin delivery.');
      assignment = { id: data.assignment_id };
    }
    const response = await fetch(`/admin/riders/assignments/${assignment.id}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, ...actorPayload() }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to update delivery.');
    await loadDeliveryAssignments();
    await loadOrders();
    if (document.getElementById('orderModal').classList.contains('show')) viewOrder(orderId, 'delivery');
  } catch (error) { alert(error.message || 'Unable to update delivery. Please retry.'); }
  finally { adminDeliveryUpdates.delete(orderId); }
}

async function cancelDeliveryAssignment(id) {
  if (!requireAdminAction("Only admin can cancel rider assignments.")) return;
  const values = await AppDialog.form({
    eyebrow: "Delivery management",
    title: "Cancel delivery assignment",
    message: "Provide a reason so the assignment history remains clear.",
    details: [{ label: "Assignment ID", value: id }],
    fields: [{ name: "reason", label: "Cancellation reason", type: "textarea", required: true, defaultValue: "Reassigned or delivery no longer needed" }],
    submitText: "Cancel Assignment",
    tone: "danger"
  });
  if (!values) return;
  const reason = values.reason.trim();
  const res = await fetch(`/admin/riders/assignments/${id}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason, ...actorPayload() })
  });
  const data = await res.json();
  if (!res.ok) return alert(data.message || "Unable to cancel delivery assignment.");
  await loadDeliveryAssignments();
  await loadOrders();
}
async function loadCustomers() {
  const res = await fetch(`/admin/customers?${actorQueryString()}`);
  const data = await res.json();
  allCustomers = Array.isArray(data) ? data : [];
  renderCustomers();
  renderLayawayCustomerOptions();
}

function customerAddress(customer) {
  return [customer.address, customer.city, customer.province, customer.postal_code].filter(Boolean).join(", ");
}

function resetCustomerFilters() {
  const search = document.getElementById("customerSearch");
  const filter = document.getElementById("customerFilter");
  if (search) search.value = "";
  if (filter) filter.value = "all";
  renderCustomers();
}
function getFilteredCustomers() {
  const search = document.getElementById("customerSearch")?.value.toLowerCase() || "";
  const filter = document.getElementById("customerFilter")?.value || "all";

  return allCustomers.filter(customer => {
    const orderCount = Number(customer.order_count || 0);
    const text = `${customer.name || ""} ${customer.email || ""} ${customer.phone || ""} ${customerAddress(customer)}`.toLowerCase();
    const matchesSearch = text.includes(search);
    const matchesFilter = filter === "all" ||
      (filter === "with-orders" && orderCount > 0) ||
      (filter === "repeat" && orderCount > 1) ||
      (filter === "no-orders" && orderCount === 0);
    return matchesSearch && matchesFilter;
  });
}

function renderCustomerSummary() {
  const total = allCustomers.length;
  const withOrders = allCustomers.filter(customer => Number(customer.order_count || 0) > 0).length;
  const repeat = allCustomers.filter(customer => Number(customer.order_count || 0) > 1).length;
  const totalSpend = allCustomers.reduce((sum, customer) => sum + Number(customer.total_spent || 0), 0);
  const values = { customerTotalCount: total, customerWithOrdersCount: withOrders, customerTotalSpend: shortMoney(totalSpend), customerRepeatCount: repeat };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
}

function renderCustomers() {
  renderCustomerSummary();
  const table = document.getElementById("customersTable");
  if (!table) return;
  const customers = getFilteredCustomers();

  if (!customers.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No customers found.</td></tr>`;
    return;
  }

  table.innerHTML = customers.map(customer => {
    const orders = Number(customer.order_count || 0);
    return `
      <tr>
        <td><strong>${escapeHtml(customer.name || "Customer")}</strong><br><small class="text-muted">ID ${customer.id}</small></td>
        <td>${escapeHtml(customer.email || "No email")}<br><small class="text-muted">${escapeHtml(customer.phone || "No phone")}</small></td>
        <td>${customerAddress(customer) ? escapeHtml(customerAddress(customer)) : "<span class='text-muted'>No address</span>"}</td>
        <td><strong>${orders}</strong><br><small class="text-muted">Completed: ${Number(customer.delivered_orders || 0)}</small></td>
        <td>${money(customer.total_spent || 0)}</td>
        <td>${customer.last_order_at ? orderDate(customer.last_order_at) : "<span class='text-muted'>No orders</span>"}</td>
        <td><div class="order-actions"><button class="btn btn-sm btn-outline-dark" onclick="viewCustomerProfile(${customer.id})">View Profile</button>${orders > 0 ? `<button class="btn btn-sm btn-dark" onclick="viewCustomerOrders(${customer.id})">View Orders</button>` : ""}</div></td>
      </tr>
    `;
  }).join("");
}


function customerAge(customer) {
  if (!customer.birthday) return "-";
  const birthDate = new Date(customer.birthday);
  if (Number.isNaN(birthDate.getTime())) return "-";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const passed = today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  if (!passed) age -= 1;
  return age;
}

async function viewCustomerProfile(customerId) {
  const customer = allCustomers.find(item => Number(item.id) === Number(customerId));
  if (!customer) return;
  const orders = Number(customer.order_count || 0);
  const address = customerAddress(customer) || "No saved address";
  if (!allOrders.length) await loadOrders();
  const recentOrders = allOrders
    .filter(order => Number(order.user_id) === Number(customer.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 5);
  const recentOrdersHtml = recentOrders.length
    ? recentOrders.map(order => `
      <div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2">
        <div>
          <strong>${orderLabel(order)}</strong>
          <div class="text-muted small">${orderDate(order.created_at)} | ${ORDER_STATUS_LABELS[orderStatus(order)] || orderStatus(order)}</div>
        </div>
        <div class="text-end">
          <strong>${money(order.total_price)}</strong><br>
          <button class="btn btn-sm btn-outline-dark mt-1" onclick="orderModal.hide(); viewOrder(${order.id})">Open</button>
        </div>
      </div>
    `).join("")
    : `<div class="text-muted border rounded p-3">No recent orders yet.</div>`;
  currentPrintableOrderId = null;
  document.getElementById("printOrderButton")?.classList.add("d-none");
  document.getElementById("copyOrderIdButton")?.classList.add("d-none");
  document.getElementById("copyOrderLinkButton")?.classList.add("d-none");
  document.getElementById("orderModalTitle").innerText = `Customer #${customer.id}`;
  document.getElementById("orderModalBody").innerHTML = `
    <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
      <div>
        <span class="status-badge ${orders > 1 ? "delivered" : "pending"}">${orders > 1 ? "Repeat Buyer" : orders === 1 ? "Buyer" : "New Customer"}</span>
        <div class="text-muted mt-2">${customer.last_order_at ? `Last order ${orderDate(customer.last_order_at)}` : "No orders yet"}</div>
      </div>
      <strong class="fs-4">${money(customer.total_spent || 0)}</strong>
    </div>

    <div class="detail-grid">
      <div class="detail-box">
        <span>Customer</span>
        <strong>${escapeHtml(customer.name || "Customer")}</strong>
        <div>ID ${customer.id}</div>
        <div>${escapeHtml(customer.email || "No email")}</div>
      </div>
      <div class="detail-box">
        <span>Contact</span>
        <strong>${escapeHtml(customer.phone || "No phone")}</strong>
        <div>${escapeHtml(customer.gender || "No gender saved")}</div>
      </div>
      <div class="detail-box">
        <span>Profile</span>
        <strong>Age: ${escapeHtml(customerAge(customer))}</strong>
        <div>Birthday: ${customer.birthday ? escapeHtml(String(customer.birthday).slice(0, 10)) : "Not saved"}</div>
      </div>
      <div class="detail-box">
        <span>Address</span>
        <strong>${escapeHtml(address)}</strong>
      </div>
      <div class="detail-box">
        <span>Order Summary</span>
        <strong>${orders} order${orders === 1 ? "" : "s"}</strong>
        <div>Completed: ${Number(customer.delivered_orders || 0)}</div>
        <div>Pending: ${Number(customer.pending_orders || 0)}</div>
      </div>
      <div class="detail-box">
        <span>Spend Summary</span>
        <strong>${money(customer.total_spent || 0)}</strong>
        <div>Average: ${orders ? money(Number(customer.total_spent || 0) / orders) : money(0)}</div>
      </div>
    </div>

    <div class="mt-3">
      <h6 class="fw-bold">Recent Orders</h6>
      ${recentOrdersHtml}
    </div>

    <div class="order-actions mt-3">
      ${orders > 0 ? `<button class="btn btn-dark" onclick="orderModal.hide(); viewCustomerOrders(${customer.id})">View Orders</button>` : ""}
      <button class="btn btn-outline-dark" onclick="orderModal.hide()">Close</button>
    </div>
  `;
  orderModal.show();
}
async function viewCustomerOrders(customerId) {
  const customer = allCustomers.find(item => Number(item.id) === Number(customerId));
  if (!customer) return;

  showSection("orders");
  await loadOrders();

  const search = document.getElementById("orderSearch");
  const status = document.getElementById("orderStatusFilter");
  const payment = document.getElementById("paymentStatusFilter");
  const repair = document.getElementById("repairStatusFilter");

  if (search) search.value = customer.email || customer.name || String(customer.id);
  if (status) status.value = "all";
  if (payment) payment.value = "all";
  if (repair) repair.value = "all";
  renderOrders();
}

function exportCustomersCsv() {
  const customers = getFilteredCustomers();
  if (!customers.length) {
    alert("No customers to export.");
    return;
  }

  const headers = ["Customer ID", "Name", "Email", "Phone", "Address", "Orders", "Completed Orders", "Total Spend", "Last Order"];
  const rows = customers.map(customer => [customer.id, customer.name || "Customer", customer.email || "", customer.phone || "", customerAddress(customer), Number(customer.order_count || 0), Number(customer.delivered_orders || 0), Number(customer.total_spent || 0).toFixed(2), customer.last_order_at ? orderDate(customer.last_order_at) : ""]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `customers-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
async function loadProducts() {
  productLoadState = "loading";
  renderProducts(false);
  try {
    const res = await fetch("/products");
    if (!res.ok) throw new Error("Products could not be loaded.");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Products could not be loaded.");
    allProducts = data;
    await loadProductCategories();
    productLoadState = "ready";
    renderMetrics();
    renderProductCategoryFilter();
    renderProducts();
    renderInventory();
    renderPosProducts();
    renderLayawayProductOptions();
    setLayawayDefaultDeadline();
    updateLayawayEstimate();
  } catch (error) {
    productLoadState = "error";
    renderProducts(false);
  }
}

function renderVoucherProductOptions() {
  const select = document.getElementById("voucherProduct");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Select product</option>` + allProducts.map(product => `<option value="${product.id}">${escapeHtml(product.name)}</option>`).join("");
  select.value = current;
}

function voucherProductName(id) {
  if (!id) return "All products";
  return allProducts.find(product => Number(product.id) === Number(id))?.name || `Product #${id}`;
}

function voucherDiscount(voucher) {
  const base = voucher.discount_type === "percent" ? `${Number(voucher.discount_value)}%` : money(voucher.discount_value);
  return voucher.discount_type === "percent" && Number(voucher.max_discount_amount || 0) > 0
    ? `${base} max ${money(voucher.max_discount_amount)}`
    : base;
}

function voucherRules(voucher) {
  const rules = [];
  if (Number(voucher.min_amount || 0) > 0) rules.push(`Min spend ${money(voucher.min_amount)}`);
  if (Number(voucher.min_quantity || 0) > 0) rules.push(`Min qty ${voucher.min_quantity}`);
  if (voucher.starts_at) rules.push(`Starts ${orderDate(voucher.starts_at)}`);
  if (voucher.expires_at) rules.push(`Expires ${orderDate(voucher.expires_at)}`);
  return rules.join(" | ") || "No minimum";
}

function parseVoucherList(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function voucherApplicabilityLabel(voucher) {
  const type = String(voucher.applicability_type || "all");
  if (type === "selected_products") {
    const ids = parseVoucherList(voucher.applicable_product_ids);
    if (ids.length) return ids.map(voucherProductName).join(", ");
    return voucherProductName(voucher.product_id);
  }
  if (type === "selected_categories") {
    const categories = parseVoucherList(voucher.applicable_categories);
    return categories.length ? categories.join(", ") : "Selected categories";
  }
  return "All products";
}

function voucherAllowedLabel(voucher) {
  const allowed = parseVoucherList(voucher.allowed_checkout_types);
  return allowed.length ? allowed.map(item => item.charAt(0).toUpperCase() + item.slice(1)).join(", ") : "Regular";
}

function voucherUsageLabel(voucher) {
  const used = Number(voucher.redemption_count || 0);
  const total = Number(voucher.usage_limit || 0);
  const customer = Number(voucher.usage_limit_per_customer || 0);
  return `${used}/${total || "Unlimited"}${customer ? ` | ${customer}/customer` : ""}`;
}

async function loadVouchers() {
  try {
    const res = await fetch(`/vouchers/admin/all?${actorQueryString()}`);
    const data = await res.json();
    allVouchers = Array.isArray(data) ? data : [];
  } catch (error) {
    allVouchers = [];
  }
  renderVoucherProductOptions();
  renderVouchers();
}

function renderVouchers() {
  const table = document.getElementById("voucherTable");
  if (!table) return;
  if (!allVouchers.length) {
    table.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">No vouchers yet.</td></tr>`;
    return;
  }
  table.innerHTML = allVouchers.map(voucher => `
    <tr>
      <td><strong>${escapeHtml(voucher.code)}</strong></td>
      <td>${escapeHtml(voucherDiscount(voucher))}</td>
      <td>${escapeHtml(voucherRules(voucher))}</td>
      <td>${escapeHtml(voucherApplicabilityLabel(voucher))}</td>
      <td>${escapeHtml(voucherAllowedLabel(voucher))}</td>
      <td>${escapeHtml(voucherUsageLabel(voucher))}</td>
      <td>${Number(voucher.is_active) ? "Active" : "Inactive"}</td>
      <td>
        <button class="btn btn-sm btn-outline-dark" onclick="toggleVoucher(${voucher.id}, ${Number(voucher.is_active) ? 0 : 1})">${Number(voucher.is_active) ? "Deactivate" : "Activate"}</button>
        <button class="btn btn-sm btn-dark" onclick="deleteVoucher(${voucher.id})">Delete</button>
      </td>
    </tr>
  `).join("");
}

function exportVouchersCsv() {
  if (!allVouchers.length) {
    alert("No vouchers to export.");
    return;
  }
  const headers = ["Voucher ID", "Code", "Discount", "Rules", "Applies To", "Allowed", "Usage", "Status"];
  const rows = allVouchers.map(voucher => [
    voucher.id,
    voucher.code || "",
    voucherDiscount(voucher),
    voucherRules(voucher),
    voucherApplicabilityLabel(voucher),
    voucherAllowedLabel(voucher),
    voucherUsageLabel(voucher),
    Number(voucher.is_active) ? "Active" : "Inactive"
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `vouchers-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
async function createVoucher() {
  if (!requireAdminAction("Only admin can create vouchers.")) return;
  const payload = {
    code: document.getElementById("voucherCode").value.trim().toUpperCase(),
    discount_type: document.getElementById("voucherType").value,
    discount_value: Number(document.getElementById("voucherValue").value || 0),
    max_discount_amount: document.getElementById("voucherMaxDiscount").value || null,
    min_amount: Number(document.getElementById("voucherMinAmount").value || 0),
    min_quantity: Number(document.getElementById("voucherMinQty").value || 0),
    product_id: document.getElementById("voucherProduct").value || null,
    starts_at: document.getElementById("voucherStart").value || null,
    expires_at: document.getElementById("voucherExpiry").value || null,
    usage_limit: document.getElementById("voucherUsageLimit").value || null,
    usage_limit_per_customer: document.getElementById("voucherCustomerLimit").value || null,
    applicability_type: document.getElementById("voucherApplicability").value,
    applicable_product_ids: document.getElementById("voucherProduct").value ? [Number(document.getElementById("voucherProduct").value)] : [],
    applicable_categories: document.getElementById("voucherCategories").value.split(",").map(item => item.trim()).filter(Boolean),
    allowed_checkout_types: [
      document.getElementById("voucherAllowRegular").checked ? "regular" : "",
      document.getElementById("voucherAllowInstallment").checked ? "installment" : "",
      document.getElementById("voucherAllowLayaway").checked ? "layaway" : ""
    ].filter(Boolean),
    ...actorPayload()
  };
  if (!payload.code || payload.discount_value <= 0) return alert("Enter voucher code and discount value.");
  if (!payload.allowed_checkout_types.length) return alert("Choose at least one allowed checkout type.");
  const res = await fetch("/vouchers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return alert(data.message || "Failed to create voucher.");
  ["voucherCode", "voucherValue", "voucherMaxDiscount", "voucherMinAmount", "voucherMinQty", "voucherStart", "voucherExpiry", "voucherUsageLimit", "voucherCustomerLimit", "voucherCategories"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("voucherProduct").value = "";
  document.getElementById("voucherApplicability").value = "all";
  document.getElementById("voucherAllowRegular").checked = true;
  document.getElementById("voucherAllowInstallment").checked = false;
  document.getElementById("voucherAllowLayaway").checked = false;
  await loadVouchers();
}

async function toggleVoucher(id, isActive) {
  if (!requireAdminAction("Only admin can update vouchers.")) return;
  const res = await fetch(`/vouchers/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: isActive, ...actorPayload() }) });
  if (!res.ok) return alert("Failed to update voucher.");
  await loadVouchers();
}

async function deleteVoucher(id) {
  if (!requireAdminAction("Only admin can delete vouchers.")) return;
  const confirmed = await AppDialog.confirm({
    title: "Delete voucher?",
    message: "Customers will no longer be able to apply this voucher at checkout.",
    details: [{ label: "Voucher", value: allVouchers.find(voucher => Number(voucher.id) === Number(id))?.code || id }],
    confirmText: "Delete Voucher",
    tone: "danger"
  });
  if (!confirmed) return;
  try {
    const res = await fetch(`/vouchers/${id}?${actorQueryString()}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Failed to delete voucher.");
    await loadVouchers();
  } catch (_) { alert('Unable to delete voucher. Check your connection and try again.'); }
}
function analyticsEmpty(id, message = "No data yet.") {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.add("is-empty");
  element.innerHTML = `<div class="analytics-empty-state"><i data-lucide="chart-no-axes-column-increasing" aria-hidden="true"></i><span>${message}</span></div>`;
}

function renderBarChart(id, rows, valueFormatter = value => value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.remove("is-empty");
  if (!rows.length) return analyticsEmpty(id);
  const max = Math.max(...rows.map(row => Number(row.value || 0)), 1);
  element.innerHTML = rows.map(row => {
    const value = Number(row.value || 0);
    const height = value > 0 ? Math.max((value / max) * 100, 3) : 0;
    return `
      <div class="bar-item" data-zero="${value <= 0}" title="${escapeHtml(row.label)}: ${escapeHtml(valueFormatter(row.value))}">
        <span class="bar-value">${value > 0 ? escapeHtml(shortMoney(value)) : ""}</span>
        <div class="bar-fill" style="height:${height}%"></div>
        <div class="bar-label">${escapeHtml(row.shortLabel || row.label)}</div>
      </div>
    `;
  }).join("");
}

function renderRowChart(id, rows, valueFormatter = value => value) {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.remove("is-empty");
  if (!rows.length) return analyticsEmpty(id);
  const max = Math.max(...rows.map(row => Number(row.value || 0)), 1);
  element.innerHTML = rows.map(row => {
    const width = Math.max((Number(row.value || 0) / max) * 100, 2);
    return `
      <div>
        <div class="mini-row-head"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(valueFormatter(row.value))}</span></div>
        <div class="mini-row-track"><div class="mini-row-fill" style="width:${width}%"></div></div>
      </div>
    `;
  }).join("");
}

function analyticsOrderDate(order) {
  const date = new Date(order.created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getAnalyticsRange() {
  return document.getElementById("analyticsRange")?.value || "7";
}

function getAnalyticsOrders() {
  const range = getAnalyticsRange();
  if (range === "all") return [...allOrders];

  const days = Number(range || 7);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.max(days - 1, 0));

  return allOrders.filter(order => {
    const date = analyticsOrderDate(order);
    return date && date >= start;
  });
}

function buildAnalyticsSummary() {
  const range = getAnalyticsRange();
  const orders = getAnalyticsOrders();
  const totalSales = orders.reduce((sum, order) => sum + Number(order.total_price || 0), 0);
  const avgOrder = orders.length ? totalSales / orders.length : 0;

  const dailySales = new Map();
  if (range === "all") {
    orders.forEach(order => {
      const date = analyticsOrderDate(order);
      if (!date) return;
      const key = date.toISOString().slice(0, 7);
      dailySales.set(key, (dailySales.get(key) || 0) + Number(order.total_price || 0));
    });
  } else {
    const today = new Date();
    const days = Number(range || 7);
    for (let index = Math.max(days - 1, 0); index >= 0; index -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      const key = date.toISOString().slice(0, 10);
      dailySales.set(key, 0);
    }
    orders.forEach(order => {
      const date = analyticsOrderDate(order);
      if (!date) return;
      const key = date.toISOString().slice(0, 10);
      if (dailySales.has(key)) dailySales.set(key, dailySales.get(key) + Number(order.total_price || 0));
    });
  }

  const statusRows = ORDER_STATUSES.map(status => ({
    label: ORDER_STATUS_LABELS[status] || status,
    value: orders.filter(order => orderStatus(order) === status).length
  })).filter(row => row.value > 0);

  const paymentMap = new Map();
  orders.forEach(order => {
    const label = paymentMethodLabel(order.payment_method);
    paymentMap.set(label, (paymentMap.get(label) || 0) + 1);
  });
  const paymentRows = Array.from(paymentMap.entries()).map(([label, value]) => ({ label, value }));

  const productMap = new Map();
  orders.forEach(order => {
    normalizedOrderItems(order).forEach(item => {
      const name = item.product_name || "Product";
      productMap.set(name, (productMap.get(name) || 0) + Number(item.quantity || 1));
    });
  });
  const topProducts = Array.from(productMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));

  return { range, orders, totalSales, avgOrder, dailySales, statusRows, paymentRows, topProducts };
}
function renderAnalyticsDashboard() {
  if (isStaffUser()) return;
  const summary = buildAnalyticsSummary();
  document.getElementById("analyticsPeriodValue").textContent = money(summary.totalSales);
  document.getElementById("analyticsPeriodOrders").textContent = `${summary.orders.length} ${summary.orders.length === 1 ? "order" : "orders"}`;
  document.getElementById("analyticsPeriodLabel").textContent = summary.range === "all" ? "All time" : `Last ${summary.range} days`;

  if (summary.orders.length) {
    renderBarChart("analyticsSalesTrend", Array.from(summary.dailySales.entries()).map(([date, value]) => ({
      label: date,
      shortLabel: date.length === 7 ? date.slice(2) : date.slice(5),
      value
    })), money);
  } else {
    analyticsEmpty("analyticsSalesTrend", "No sales in this period.");
  }

  renderRowChart("analyticsOrderStatus", summary.statusRows, value => `${value}`);
  renderRowChart("analyticsPaymentMix", summary.paymentRows, value => `${value}`);
  const ranking = document.getElementById("analyticsTopProducts");
  if (!summary.topProducts.length) {
    analyticsEmpty("analyticsTopProducts");
  } else {
    ranking.classList.remove("is-empty");
    const items = summary.orders.flatMap(normalizedOrderItems);
    ranking.innerHTML = summary.topProducts.map((row, index) => {
      const product = allProducts.find(product => product.name === row.label);
      const item = items.find(item => item.product_name === row.label);
      const image = productImages(product || {})[0] || item?.product_image || "/assets/sheena-mark.svg";
      return `<div class="overview-ranked-product"><span class="overview-product-rank">${index + 1}</span><img src="${escapeHtml(image)}" alt="" loading="lazy"><span class="overview-product-name" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><strong>${row.value}<span>${row.value === 1 ? "unit" : "units"}</span></strong></div>`;
    }).join("");
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const todaySales = allOrders
    .filter(order => new Date(order.created_at).toISOString().slice(0, 10) === todayKey)
    .reduce((sum, order) => sum + Number(order.total_price || 0), 0);
  const bestPayment = summary.paymentRows.sort((a, b) => b.value - a.value)[0]?.label || "-";
  const bestSeller = summary.topProducts[0]?.label || "-";
  const insightValues = {
    analyticsTodaySales: money(todaySales),
    analyticsAvgOrder: money(summary.avgOrder),
    analyticsBestPayment: bestPayment,
    analyticsBestSeller: bestSeller
  };
  Object.entries(insightValues).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerText = value;
      el.classList.toggle("is-long-value", id !== "analyticsBestSeller" && value.length > 16);
      if (id === "analyticsBestSeller") el.title = value;
    }
  });
  refreshAdminIcons();
}
function exportAnalyticsCsv() {
  const summary = buildAnalyticsSummary();
  if (!summary.orders.length) {
    alert("No analytics data to export.");
    return;
  }

  const rangeLabel = getAnalyticsRange() === "all" ? "All time" : `Last ${getAnalyticsRange()} days`;
  const rows = [
    ["Report", "Admin Analytics"],
    ["Period", rangeLabel],
    ["Generated", new Date().toLocaleString()],
    ["Total Orders", summary.orders.length],
    ["Total Sales", summary.totalSales.toFixed(2)],
    ["Average Order", summary.avgOrder.toFixed(2)],
    [],
    ["Order Status", "Count"],
    ...summary.statusRows.map(row => [row.label, row.value]),
    [],
    ["Payment Method", "Count"],
    ...summary.paymentRows.map(row => [row.label, row.value]),
    [],
    ["Top Product", "Quantity Sold"],
    ...summary.topProducts.map(row => [row.label, row.value])
  ];

  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `analytics-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
async function loadOrders() {
  orderLoadState = "loading";
  window.StaffWorkspace?.render();
  renderOrders();
  let data;
  try {
    const res = await fetch("/orders");
    if (!res.ok) throw new Error("Orders request failed");
    data = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid orders response");
  } catch (error) {
    orderLoadState = "error";
    window.StaffWorkspace?.render();
    renderOrders();
    return;
  }
  orderLoadState = "ready";
  allOrders = Array.isArray(data) ? data.filter(order => {
    const awaitingInitialGcashProof = isGCashMethod(order.payment_method) &&
      order.payment_provider === "manual_gcash" &&
      paymentStatus(order) === "pending_payment" &&
      !order.payment_proof_image &&
      orderStatus(order) !== "cancelled";
    return !awaitingInitialGcashProof;
  }) : [];
  if (isAdminUser()) await loadDeliveryAssignments();
  renderOrderMetric();
  renderRepairQueue();
  renderOrders();
  renderRepairs();
  renderDeliveryOrderOptions();
  renderDeliveryAssignments();
  renderAnalyticsDashboard();
  renderPOSDashboard();
  window.StaffWorkspace?.render();
  openLinkedAdminOrderIfNeeded();
}

function renderOrderMetric() {
  const metric = document.getElementById("metricOrders");
  if (metric) metric.innerText = allOrders.length;
  document.getElementById("orderAllCount").textContent = allOrders.length;
  document.getElementById("orderTotalLabel").textContent = `${allOrders.length} ${allOrders.length === 1 ? "order" : "orders"}`;
  const reviewCount = allOrders.filter(order => paymentStatus(order) === "for_verification").length;
  document.getElementById("orderReviewCount").textContent = reviewCount;
  document.getElementById("orderReviewShortcut").hidden = !reviewCount;

  const counts = ORDER_STATUSES.reduce((summary, status) => {
    summary[status] = allOrders.filter(order => orderStatus(order) === status).length;
    return summary;
  }, {});

  const countMap = {
    pending: "orderPendingCount",
    processing: "orderProcessingCount",
    shipped: "orderShippedCount",
    delivered: "orderDeliveredCount",
    cancelled: "orderCancelledCount"
  };

  Object.entries(countMap).forEach(([status, id]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = counts[status] || 0;
  });

  const repairPending = allOrders.filter(order => order.repair_request_status === "pending").length;
  const repairActive = allOrders.filter(order => order.repair_request_status === "approved" && (order.repair_service_status || "approved") !== "completed").length;
  const repairCompleted = allOrders.filter(order => order.repair_request_status === "approved" && order.repair_service_status === "completed").length;
  const repairMap = { repairPendingCount: repairPending, repairActiveCount: repairActive, repairCompletedCount: repairCompleted };
  Object.entries(repairMap).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
}

function orderDate(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDate(value) {
  return value ? orderDate(value) : "-";
}

function resetOrderFilters() {
  const search = document.getElementById("orderSearch");
  const status = document.getElementById("orderStatusFilter");
  const payment = document.getElementById("paymentStatusFilter");
  const repair = document.getElementById("repairStatusFilter");
  if (search) search.value = "";
  if (status) status.value = "all";
  if (payment) payment.value = "all";
  if (repair) repair.value = "all";
  document.getElementById("orderSort").value = "newest";
  renderOrders();
}
function setOrderStatusFilter(status) {
  document.getElementById("orderStatusFilter").value = status;
  renderOrders();
}
function showOrdersForPaymentReview() {
  document.getElementById("orderStatusFilter").value = "all";
  document.getElementById("paymentStatusFilter").value = "for_verification";
  document.getElementById("orderSearch").value = "";
  renderOrders();
}
function getFilteredOrders() {
  const search = document.getElementById("orderSearch")?.value.toLowerCase() || "";
  const status = document.getElementById("orderStatusFilter")?.value || "all";
  const payment = document.getElementById("paymentStatusFilter")?.value || "all";
  const repair = document.getElementById("repairStatusFilter")?.value || "all";

  const orders = allOrders.filter(order => {
    const text = [orderReference(order), orderLabel(order), order.id, order.customer_name, order.customer_email, order.product_name, order.variant_name, orderItemsCsvText(order)].join(" ").toLowerCase();
    const matchesStatus = status === "all" || orderStatus(order) === status;
    const matchesPayment = payment === "all" ||
      (payment === "payment_issue" && ["rejected", "failed", "payment_setup_failed", "installment_downpayment_failed"].includes(paymentStatus(order))) ||
      paymentStatus(order) === payment;
    const repairService = order.repair_service_status || "approved";
    const matchesRepair = repair === "all" ||
      order.repair_request_status === repair ||
      (repair === "active" && order.repair_request_status === "approved" && repairService !== "completed") ||
      (repair === "completed" && order.repair_request_status === "approved" && repairService === "completed");
    return text.includes(search) && matchesStatus && matchesPayment && matchesRepair;
  });
  const sort = document.getElementById("orderSort")?.value || "newest";
  return orders.sort((a, b) => {
    if (sort === "total-high") return Number(b.total_price || 0) - Number(a.total_price || 0);
    if (sort === "total-low") return Number(a.total_price || 0) - Number(b.total_price || 0);
    const byDate = (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0);
    const result = byDate || Number(a.id) - Number(b.id);
    return sort === "oldest" ? result : -result;
  });
}

function orderItemImage(item, order) {
  return item?.product_image || order.product_image || "https://via.placeholder.com/120x120?text=Product";
}

function openCustomerProduct(productId) {
  if (!productId) return alert("No product record linked to this order.");
  window.open(`/customer/product.html?id=${encodeURIComponent(productId)}`, "_blank");
}

function normalizedOrderItems(order) {
  const fallbackSubtotal = Math.max(Number(order.total_price || 0) - Number(order.shipping_fee || 0), 0);
  const items = Array.isArray(order.items) && order.items.length ? order.items : [{
    product_id: order.product_id,
    product_name: order.product_name || "Product",
    variant_name: order.variant_name || "Default",
    quantity: order.quantity || 1,
    unit_price: order.variant_price || fallbackSubtotal,
    subtotal: fallbackSubtotal,
    product_image: order.product_image
  }];

  return items.map(item => ({
    ...item,
    product_image: orderItemImage(item, order)
  }));
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function orderItemsCsvText(order) {
  return normalizedOrderItems(order)
    .map(item => `${item.product_name || "Product"} (${item.variant_name || "Default"}) x${item.quantity}`)
    .join(" | ");
}

function exportOrdersCsv() {
  const orders = getFilteredOrders();
  if (!orders.length) {
    alert("No orders to export.");
    return;
  }

  const headers = [
    "Order ID",
    "Date",
    "Customer",
    "Email",
    "Contact",
    "Items",
    "Payment Method",
    "Payment Status",
    "Order Status",
    "Product Subtotal",
    "Shipping Area",
    "Shipping Fee",
    "Total",
    "Delivery Address",
    "Repair Status",
    "Warranty Until"
  ];

  const rows = orders.map(order => [
    orderReference(order),
    orderDate(order.created_at),
    order.customer_name || order.recipient_name || "Customer",
    order.customer_email || "",
    order.delivery_contact || order.customer_phone || "",
    orderItemsCsvText(order),
    paymentMethodLabel(order.payment_method),
    PAYMENT_STATUS_LABELS[paymentStatus(order)] || paymentStatus(order),
    ORDER_STATUS_LABELS[orderStatus(order)] || orderStatus(order),
    Number(orderProductSubtotal(order) || 0).toFixed(2),
    shippingRegionLabel(order),
    Number(order.shipping_fee || 0).toFixed(2),
    Number(order.total_price || 0).toFixed(2),
    fullCustomerAddress(order) || "",
    order.repair_request_status ? repairStatusLabel(order.repair_request_status) : "",
    order.warranty_expires_at ? shortDate(order.warranty_expires_at) : ""
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `orders-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function orderItemsSummary(order) {
  const items = normalizedOrderItems(order);
  if (items.length <= 1) {
    const item = items[0];
    const productId = Number(item.product_id || order.product_id || 0);
    return `
      <div class="order-product-cell">
        <img class="order-product-thumb" src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name || "Product")}">
        <div>
          <strong>${escapeHtml(item.product_name || "Product")}</strong><br>
          <small class="text-muted">Qty: ${item.quantity}${item.variant_name ? ` | ${escapeHtml(item.variant_name)}` : ""}</small>
          ${productId ? `<button type="button" class="btn btn-sm btn-outline-dark mt-2" onclick="openCustomerProduct(${productId})">View Product</button>` : ""}
        </div>
      </div>
    `;
  }

  return `
    <div class="order-product-cell">
      <div class="order-product-stack">
        ${items.slice(0, 4).map(item => `<img class="order-product-thumb" src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name || "Product")}">`).join("")}
      </div>
      <div>
        <strong>${items.length} items</strong><br>
        <small class="text-muted">${items.map(item => `${escapeHtml(item.product_name || "Product")} x${item.quantity}`).join(" | ")}</small>
      </div>
    </div>
  `;
}

function orderItemsDetail(order) {
  const items = normalizedOrderItems(order);
  return items.map(item => `
    <div class="order-detail-product">
      <img src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name || "Product")}">
      <div>
        <strong>${escapeHtml(item.product_name || "Product")}</strong>
        <div>Variant: ${escapeHtml(item.variant_name || "Default")}</div>
        <div>Quantity: ${item.quantity}</div>
        <div>Unit Price: ${item.unit_price ? money(item.unit_price) : "Default price"}</div>
        <div>Subtotal: ${money(item.subtotal || Number(item.unit_price || 0) * Number(item.quantity || 1))}</div>
        ${Number(item.product_id || order.product_id || 0) ? `<button type="button" class="btn btn-sm btn-outline-dark mt-2" onclick="openCustomerProduct(${Number(item.product_id || order.product_id || 0)})">View Product Page</button>` : ""}
      </div>
    </div>
  `).join("");
}

function orderPrimaryItem(order) {
  return normalizedOrderItems(order)[0] || {};
}

function orderPaymentSummary(order) {
  const status = paymentStatus(order);
  const label = PAYMENT_STATUS_LABELS[status] || status;
  const classes = ["admin-order-payment", paymentReviewStatusClass(order)];
  return `
    <div class="${classes.join(" ")}">
      <span>${escapeHtml(paymentMethodLabel(order.payment_method))}</span>
      <strong>${escapeHtml(label)}</strong>
      ${paymentProcessingWarning(order)}
    </div>
  `;
}

function orderStatusControl(order) {
  const status = orderStatus(order);
  return `
    <div class="admin-order-status">
      <span class="status-badge ${status}">${escapeHtml(ORDER_STATUS_LABELS[status] || status)}</span>
      ${order.stock_restored_at ? `<small class="text-muted">Stock returned ${formatDate(order.stock_restored_at)}</small>` : ""}
    </div>
  `;
}

function orderInlineNotes(order) {
  return [
    warrantyHtml(order),
    cancellationRequestHtml(order, false),
    deliveryAssignmentHtml(order)
  ].filter(Boolean).join("");
}

function renderRepairQueue() {
  const container = document.getElementById("repairQueue");
  if (!container) return;

  const queue = allOrders.filter(order => order.repair_request_status === "pending" || order.repair_request_status === "approved");
  const priority = queue.slice().sort((a, b) => {
    const weight = status => status === "pending" ? 0 : 1;
    return weight(a.repair_request_status) - weight(b.repair_request_status) || new Date(b.repair_requested_at || b.created_at) - new Date(a.repair_requested_at || a.created_at);
  }).slice(0, 3);

  if (!priority.length) {
    container.innerHTML = `<div class="repair-queue-card"><h5>No active repair requests</h5><p>New customer repair requests will appear here.</p></div>`;
    return;
  }

  container.innerHTML = priority.map(order => {
    const serviceStatus = order.repair_service_status || "approved";
    const productText = order.product_name || orderItemsSummary(order).replace(/<[^>]+>/g, "");
    const productId = Number((normalizedOrderItems(order)[0] || {}).product_id || order.product_id || 0);
    return `
      <article class="repair-queue-card">
        <div>
          <h5>${orderLabel(order)} - ${escapeHtml(order.customer_name || "Customer")}</h5>
          <p>${escapeHtml(productText)}</p>
        </div>
        <div>
          <span class="status-badge ${order.repair_request_status === "pending" ? "pending" : "processing"}">${escapeHtml(repairStatusLabel(order.repair_request_status))}</span>
          ${order.repair_request_status === "approved" ? `<span class="status-badge processing ms-1">${escapeHtml(repairServiceStatusLabel(serviceStatus))}</span>` : ""}
        </div>
        ${order.repair_issue ? `<p>Issue: ${escapeHtml(order.repair_issue)}</p>` : ""}
        <div class="repair-queue-actions">
          <button class="btn btn-sm btn-outline-dark" onclick="viewOrder(${order.id})">View Order</button>
          ${productId ? `<button class="btn btn-sm btn-outline-dark" onclick="openCustomerProduct(${productId})">View Product</button>` : ""}
          ${isAdminUser() && order.repair_request_status === "pending" ? `<button class="btn btn-sm btn-dark" onclick="reviewRepairRequest(${order.id}, 'approved')">Approve</button>` : ""}
          ${isAdminUser() && order.repair_request_status === "pending" ? `<button class="btn btn-sm btn-outline-dark" onclick="reviewRepairRequest(${order.id}, 'rejected')">Reject</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function resetRepairFilters() {
  const search = document.getElementById("repairSearch");
  const status = document.getElementById("repairPageStatusFilter");
  if (search) search.value = "";
  if (status) status.value = "all";
  renderRepairs();
}

function getFilteredRepairs() {
  const search = document.getElementById("repairSearch")?.value.toLowerCase() || "";
  const status = document.getElementById("repairPageStatusFilter")?.value || "all";
  return allOrders.filter(order => {
    if (!order.repair_request_status) return false;
    const serviceStatus = order.repair_service_status || "approved";
    const statusMatch = status === "all" ||
      order.repair_request_status === status ||
      (status === "active" && order.repair_request_status === "approved" && serviceStatus !== "completed") ||
      (status === "completed" && order.repair_request_status === "approved" && serviceStatus === "completed");
    const text = [
      orderReference(order),
      orderLabel(order),
      order.customer_name,
      order.customer_email,
      order.product_name,
      orderItemsCsvText(order),
      order.repair_issue,
      order.repair_admin_note,
      order.repair_request_status,
      serviceStatus
    ].join(" ").toLowerCase();
    return statusMatch && text.includes(search);
  });
}

function renderRepairs() {
  const table = document.getElementById("repairsTable");
  if (!table) return;

  const repairs = getFilteredRepairs();
  if (!repairs.length) {
    table.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No repair requests found.</td></tr>`;
    refreshRoleVisibility();
    return;
  }

  table.innerHTML = repairs.map(order => {
    const serviceStatus = order.repair_service_status || "approved";
    const productId = Number((normalizedOrderItems(order)[0] || {}).product_id || order.product_id || 0);
    return `
      <tr>
        <td>
          <strong>${orderLabel(order)}</strong><br>
          <small class="text-muted">Requested: ${formatDate(order.repair_requested_at || order.created_at)}</small>
        </td>
        <td>${escapeHtml(order.customer_name || "Customer")}<br><small class="text-muted">${escapeHtml(order.customer_email || "")}</small></td>
        <td>${orderItemsSummary(order)}</td>
        <td>
          <strong>${escapeHtml(order.repair_issue || "No issue details")}</strong>
          ${order.repair_admin_note ? `<br><small class="text-muted">Note: ${escapeHtml(order.repair_admin_note)}</small>` : ""}
        </td>
        <td>
          <span class="status-badge ${order.repair_request_status === "pending" ? "pending" : "processing"}">${escapeHtml(repairStatusLabel(order.repair_request_status))}</span>
          ${order.repair_request_status === "approved" ? `
            <select class="form-select form-select-sm mt-2" onchange="updateRepairStatus(${order.id}, this.value)">
              ${repairProgressOptions(order).map(option => `
                <option value="${option}" ${serviceStatus === option ? "selected" : ""}>${repairServiceStatusLabel(option)}</option>
              `).join("")}
            </select>
          ` : ""}
        </td>
        <td>
          <div class="order-actions">
            <button class="btn btn-sm btn-outline-dark" onclick="viewOrder(${order.id})">View Order</button>
            ${productId ? `<button class="btn btn-sm btn-outline-dark" onclick="openCustomerProduct(${productId})">View Product</button>` : ""}
            ${isAdminUser() && order.repair_request_status === "pending" ? `<button class="btn btn-sm btn-dark" onclick="reviewRepairRequest(${order.id}, 'approved')">Approve</button>` : ""}
            ${isAdminUser() && order.repair_request_status === "pending" ? `<button class="btn btn-sm btn-outline-dark" onclick="reviewRepairRequest(${order.id}, 'rejected')">Reject</button>` : ""}
            ${order.repair_request_status === "approved" ? `<button class="btn btn-sm btn-outline-dark" onclick="addRepairNote(${order.id})">Add Note</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
  refreshRoleVisibility();
}

function renderOrders() {
  const board = document.getElementById("ordersTable");
  if (!board) return;

  const orders = getFilteredOrders();
  board.setAttribute("aria-busy", String(orderLoadState === "loading"));
  document.getElementById("orderResultsCount").textContent = orderLoadState === "loading" ? "Loading orders..." : `${orders.length} of ${allOrders.length} ${allOrders.length === 1 ? "order" : "orders"}`;
  document.querySelectorAll("[data-order-status]").forEach(button => {
    const active = button.dataset.orderStatus === document.getElementById("orderStatusFilter").value;
    button.setAttribute("aria-pressed", String(active));
  });
  if (orderLoadState === "error") {
    board.innerHTML = `<div class="admin-empty-state"><i data-lucide="cloud-alert" aria-hidden="true"></i><strong>Unable to load orders</strong><button type="button" class="btn btn-outline-dark" onclick="loadOrders()">${adminIcon("refresh-cw")}<span>Retry</span></button></div>`;
    refreshAdminIcons();
    return;
  }
  if (orderLoadState === "loading" && !allOrders.length) {
    board.innerHTML = `<div class="admin-empty-state"><i data-lucide="loader-circle" aria-hidden="true"></i><strong>Loading orders...</strong></div>`;
    refreshAdminIcons();
    return;
  }

  if (!orders.length) {
    board.innerHTML = `
      <div class="admin-empty-state">
        <i data-lucide="shopping-bag" aria-hidden="true"></i><strong>No orders found.</strong>
        ${allOrders.length ? `<button type="button" class="btn btn-outline-dark" onclick="resetOrderFilters()">${adminIcon("filter-x")}<span>Clear filters</span></button>` : ""}
      </div>
    `;
    refreshRoleVisibility();
    refreshAdminIcons();
    return;
  }

  board.innerHTML = orders.map(order => {
    const status = orderStatus(order);
    const item = orderPrimaryItem(order);
    const itemCount = normalizedOrderItems(order).length;
    const productId = Number(item.product_id || order.product_id || 0);
    return `
      <article class="admin-order-card ${status}" data-order-id="${Number(order.id)}">
        <div class="orders-record-heading">
          <div class="admin-order-id">
            <strong>${orderReference(order)}</strong>
            <span>${escapeHtml(orderDate(order.created_at))}</span>
          </div>
          ${orderStatusControl(order)}
        </div>
        <div class="admin-order-main">
          <div class="admin-order-product">
            <img src="${escapeHtml(orderItemImage(item, order))}" alt="${escapeHtml(item.product_name || order.product_name || "Product")}">
            <div>
              <strong title="${escapeHtml(item.product_name || order.product_name || "Product")}">${escapeHtml(item.product_name || order.product_name || "Product")}</strong>
              <span>Qty ${escapeHtml(item.quantity || order.quantity || 1)}${item.variant_name || order.variant_name ? ` / ${escapeHtml(item.variant_name || order.variant_name)}` : ""}</span>
              ${itemCount > 1 ? `<span>${itemCount} items in this order</span>` : ""}
              ${productId ? `<button type="button" class="link-button" onclick="openCustomerProduct(${productId})">${adminIcon("external-link")}<span>View product</span></button>` : ""}
            </div>
          </div>
          <div class="admin-order-customer">
            <span>Customer</span>
            <strong>${escapeHtml(order.customer_name || order.recipient_name || "Customer")}</strong>
            <small>${escapeHtml(order.customer_email || order.delivery_contact || "No contact")}</small>
          </div>
          ${orderPaymentSummary(order)}
          <div class="admin-order-total">
            <span>Total</span>
            <strong>${money(order.total_price)}</strong>
            ${shippingSummaryLine(order) ? `<small>Shipping: ${escapeHtml(shippingSummaryLine(order))}</small>` : ""}
          </div>
        </div>

        <div class="admin-order-footer">
          <div class="admin-order-notes">${orderInlineNotes(order)}</div>
          <div class="order-actions">
            ${orderActionsHtml(order)}
          </div>
        </div>
      </article>
    `;
  }).join("");
  refreshRoleVisibility();
  refreshAdminIcons();
}

function orderPrimaryAction(order) {
  const status = orderStatus(order);
  const details = { label: "View Details", icon: "eye", onclick: `viewOrder(${order.id})`, opensDetails: true };
  if (isStaffUser() && (order.cancellation_request_status === 'pending' || !orderPaymentReadyForProcessing(order))) return details;
  if (["delivered", "cancelled"].includes(status)) return details;
  if (order.cancellation_request_status === "pending") return { label: "Review Cancellation", icon: "circle-alert", onclick: `viewOrder(${order.id}, 'cancellation')`, opensDetails: true };
  if (["for_verification", "pending_verification"].includes(paymentStatus(order))) return { label: "Review Payment", icon: "wallet", onclick: `viewOrder(${order.id}, 'payment')`, opensDetails: true };
  if (!orderPaymentReadyForProcessing(order)) return { label: "View Payment Issue", icon: "circle-alert", onclick: `viewOrder(${order.id}, 'payment')`, opensDetails: true };
  if (status === "pending") return { label: "Process Order", icon: "arrow-right", onclick: `beginOrderStatusUpdate(${order.id}, 'processing')` };
  if (status === "processing") {
    if (isAdminUser() && deliveryLoadState !== "ready") return { label: deliveryLoadState === "error" ? "Retry Delivery" : "Loading Delivery", icon: "refresh-cw", onclick: "loadDeliveryAssignments()", disabled: deliveryLoadState !== "error", title: "Loading rider assignments" };
    return { label: "Mark Ready", icon: "package-check", onclick: `beginOrderStatusUpdate(${order.id}, 'shipped')` };
  }
  if (status === 'shipped' && isAdminUser()) {
    if (deliveryLoadState !== 'ready') return { label: 'Retry Delivery', icon: 'refresh-cw', onclick: 'loadDeliveryAssignments()', disabled: deliveryLoadState !== 'error' };
    const assignment = deliveryAssignmentForOrder(order.id, false);
    if (assignment?.status === 'out_for_delivery') return { label: 'Mark Delivered', icon: 'package-check', onclick: `adminDeliveryAction(${order.id}, 'delivered')` };
    return { label: 'Out for Delivery', icon: 'truck', onclick: `adminDeliveryAction(${order.id}, 'out_for_delivery')` };
  }
  if (status === "shipped") return { label: "View Delivery", icon: "truck", onclick: `viewOrder(${order.id}, 'delivery')`, opensDetails: true };
  return details;
}

function orderActionsHtml(order, inModal = false) {
  const primary = orderPrimaryAction(order);
  const action = !inModal || !primary.opensDetails ? `<button type="button" class="btn btn-sm btn-dark order-primary-action" onclick="${primary.onclick}" ${primary.disabled ? `disabled title="${primary.title}"` : ""}>${adminIcon(primary.icon)}<span>${primary.label}</span></button>` : "";
  const details = !inModal && primary.label !== "View Details" ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="viewOrder(${order.id})">${adminIcon("eye")}<span>View Details</span></button>` : "";
  const status = orderStatus(order);
  const secondary = [];
  if (["processing", "shipped"].includes(status) && isAdminUser() && deliveryLoadState === "ready" && order.cancellation_request_status !== "pending") secondary.push(`<button type="button" class="dropdown-item" onclick="quickAssignRider(${order.id})">${adminIcon("truck")}<span>${deliveryAssignmentForOrder(order.id, false) ? 'Change Rider' : 'Assign Rider'}</span></button>`);
  if (isAdminUser() && ["pending", "processing"].includes(status) && order.cancellation_request_status !== "pending") secondary.push(`<button type="button" class="dropdown-item text-danger" onclick="beginOrderStatusUpdate(${order.id}, 'cancelled')">${adminIcon("ban")}<span>Cancel Order</span></button>`);
  const menu = secondary.length ? `<div class="dropdown order-more-actions"><button type="button" class="btn btn-outline-dark orders-icon-button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="More actions for ${escapeHtml(orderLabel(order))}" title="More order actions">${adminIcon("ellipsis")}</button><div class="dropdown-menu dropdown-menu-end">${secondary.join("")}</div></div>` : "";
  return `${details}${action}${menu}`;
}

function viewOrder(id, focusSection = "") {
  currentPrintableOrderId = id;
  document.getElementById("printOrderButton")?.classList.remove("d-none");
  const order = allOrders.find(item => item.id === id);
  if (!order) return;

  const status = orderStatus(order);
  const address = fullCustomerAddress(order) || "No saved address";
  const recipient = order.recipient_name || order.customer_name || "Customer";
  const contact = order.delivery_contact || order.customer_phone || "No phone";
  document.getElementById("orderModalTitle").innerText = orderLabel(order);
  document.getElementById("orderModalBody").innerHTML = `
    <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
      <div>
        <span class="status-badge ${status}">${ORDER_STATUS_LABELS[status] || status}</span>
        <div class="text-muted mt-2">${orderDate(order.created_at)}</div>
      </div>
      <strong class="fs-4">${money(order.total_price)}</strong>
    </div>

        ${orderTrackingHtml(order)}
        ${statusHistoryHtml(order)}

    <div class="detail-grid">
      <div class="detail-box">
        <span>Customer</span>
        <strong>${escapeHtml(recipient)}</strong>
        <div>${escapeHtml(order.customer_email || "No email")}</div>
        <div>${escapeHtml(contact)}</div>
      </div>
      <div class="detail-box">
        <span>Delivery Address</span>
        <strong>${escapeHtml(address)}</strong>
        ${shippingSummaryLine(order) ? `<div class="mt-2">Delivery Area: ${escapeHtml(shippingRegionLabel(order) || "Delivery")}</div><div>Shipping Fee: ${money(orderShippingFee(order))}</div>` : ""}
        ${order.delivery_note ? `<div class="mt-2">Note: ${escapeHtml(order.delivery_note)}</div>` : ""}
      </div>
      <div class="detail-box">
        <span>Product</span>
        ${orderItemsDetail(order)}
        ${order.stock_restored_at ? `<div class="mt-2 text-muted">Stock Returned: ${formatDate(order.stock_restored_at)}</div>` : ""}

      </div>
      <div class="detail-box" id="orderPaymentDetails" tabindex="-1">
        <span>Payment</span>
        ${paymentReviewHtml(order)}
        ${order.payment_method === "installment" ? `
          <div class="payment-plan-mini">
            <div><span>Terms</span><strong>${order.installment_terms || "-"} months</strong></div>
            <div><span>Downpayment</span><strong>${money(order.installment_downpayment || 0)}</strong></div>
            <div><span>Monthly</span><strong>${money(order.installment_monthly || 0)}</strong></div>
            <div><span>Balance</span><strong>${money(order.installment_balance || 0)}</strong></div>
          </div>
        ` : ""}
        <div class="payment-total-mini">
          <div><span>Product Subtotal</span><strong>${money(orderProductSubtotal(order))}</strong></div>
          ${shippingSummaryLine(order) ? `<div><span>Shipping</span><strong>${escapeHtml(shippingSummaryLine(order))}</strong></div>` : ""}
          <div><span>Order Total</span><strong>${money(order.total_price)}</strong></div>
        </div>
      </div>
    </div>

    <div id="orderCancellationDetails" tabindex="-1">${cancellationRequestHtml(order)}</div>
    ${warrantyHtml(order)}
    ${repairRequestHtml(order)}
    <div id="orderDeliveryDetails" tabindex="-1"><h6 class="mt-3">Delivery</h6>${deliveryAssignmentHtml(order)}<div class="small text-muted mt-2">${escapeHtml(address)}</div></div>

    <div class="order-actions order-modal-actions mt-3">${orderActionsHtml(order, true)}</div>
  `;
  const url = new URL(window.location.href);
  url.searchParams.set("section", "orders");
  url.searchParams.set("order", id);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  orderModal.show();
  refreshAdminIcons();
  const focusId = { payment: "orderPaymentDetails", cancellation: "orderCancellationDetails", delivery: "orderDeliveryDetails" }[focusSection];
  if (focusId) {
    const focusDetails = () => {
      const target = document.getElementById(focusId);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
    };
    const modal = document.getElementById("orderModal");
    if (modal.classList.contains("show") && getComputedStyle(modal).opacity === "1") focusDetails();
    else modal.addEventListener("shown.bs.modal", focusDetails, { once: true });
  }
}

function printableOrderHtml(order) {
  const status = orderStatus(order);
  const recipient = order.recipient_name || order.customer_name || "Customer";
  const contact = order.delivery_contact || order.customer_phone || "No phone";
  const address = fullCustomerAddress(order) || "No saved address";
  const items = normalizedOrderItems(order);
  return `
    <!doctype html>
    <html>
    <head>
      <title>${orderLabel(order)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 28px; }
        .head { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 18px; }
        h1, h2, h3, p { margin: 0; }
        h1 { font-size: 24px; }
        .muted { color: #555; font-size: 13px; margin-top: 4px; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 18px; }
        .box { border: 1px solid #111; padding: 12px; min-height: 96px; }
        .label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #555; margin-bottom: 6px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #111; padding: 9px; text-align: left; vertical-align: top; }
        th { background: #f3f3f3; font-size: 12px; text-transform: uppercase; }
        .total { margin-top: 16px; font-size: 18px; font-weight: 800; text-align: right; }
        .muted-total { color: #555; font-size: 13px; font-weight: 700; margin-bottom: 4px; }
        .foot { margin-top: 28px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; }
        .line { border-top: 1px solid #111; padding-top: 8px; text-align: center; font-size: 12px; }
        @media print { body { padding: 16px; } }
      </style></head>
    <body>
      <div class="head">
        <div>
          <h1>Sheena's Gadgets & Accessories Shop</h1>
          <p class="muted">Order receipt / packing slip</p>
        </div>
        <div>
          <h2>${orderLabel(order)}</h2>
          <p class="muted">${escapeHtml(orderDate(order.created_at))}</p>
          <p class="muted">Status: ${escapeHtml(ORDER_STATUS_LABELS[status] || status)}</p>
        </div>
      </div>

      <div class="grid">
        <div class="box">
          <div class="label">Customer</div>
          <strong>${escapeHtml(recipient)}</strong>
          <p>${escapeHtml(order.customer_email || "No email")}</p>
          <p>${escapeHtml(contact)}</p>
        </div>
        <div class="box">
          <div class="label">Delivery Address</div>
          <strong>${escapeHtml(address)}</strong>
          ${shippingSummaryLine(order) ? `<p>Delivery Area: ${escapeHtml(shippingRegionLabel(order) || "Delivery")}</p><p>Shipping Fee: ${money(orderShippingFee(order))}</p>` : ""}
          ${order.delivery_note ? `<p>Note: ${escapeHtml(order.delivery_note)}</p>` : ""}
        </div>
        <div class="box">
          <div class="label">Payment</div>
          <strong>${paymentMethodLabel(order.payment_method)}</strong>
          <p>${escapeHtml(PAYMENT_STATUS_LABELS[paymentStatus(order)] || paymentStatus(order))}</p>
          ${order.payment_reference ? `<p>Reference: ${escapeHtml(order.payment_reference)}</p>` : ""}
        </div>
        <div class="box">
          <div class="label">Service Notes</div>
          <p>${order.warranty_expires_at ? `Warranty until ${escapeHtml(shortDate(order.warranty_expires_at))}` : "No warranty date"}</p>
          <p>${order.repair_request_status ? `Repair: ${escapeHtml(repairStatusLabel(order.repair_request_status))}` : "No repair request"}</p>
        </div>
      </div>

      <h3>Items</h3>
      <table>
        <thead><tr><th>Product</th><th>Variant</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${escapeHtml(item.product_name || "Product")}</td>
              <td>${escapeHtml(item.variant_name || "Default")}</td>
              <td>${item.quantity}</td>
              <td>${money(item.unit_price || 0)}</td>
              <td>${money(item.subtotal || Number(item.unit_price || 0) * Number(item.quantity || 1))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <div class="total">${printableShippingTotalHtml(order)}</div>

      <div class="foot">
        <div class="line">Prepared by</div>
        <div class="line">Received by</div>
      </div>
      
</body>
    </html>
  `;
}

function printCurrentOrder() {
  if (!currentPrintableOrderId) return;
  const order = allOrders.find(item => Number(item.id) === Number(currentPrintableOrderId));
  if (!order) return alert("Order not found.");
  const printWindow = window.open("", "_blank", "width=900,height=720");
  if (!printWindow) return alert("Please allow pop-ups to print this order.");
  printWindow.document.open();
  printWindow.document.write(printableOrderHtml(order));
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
}
async function refreshPaymentStatus(id) {
  const res = await fetch(`/payments/gcash/status/${id}`);
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to refresh payment status.");
    return;
  }

  updateLocalOrderPayment(id, data);
  renderOrders();
  viewOrder(id);
  loadFinance();
  loadAdminAlerts();
}

function updateLocalOrderPayment(id, data) {
  const order = allOrders.find(item => Number(item.id) === Number(id));
  if (!order) return;
  order.payment_status = data.payment_status || order.payment_status;
  order.payment_provider = data.payment_provider || order.payment_provider;
  order.payment_reference = data.payment_reference || order.payment_reference;
  order.gcash_reference = data.gcash_reference || order.gcash_reference;
  order.payment_proof_image = data.payment_proof_image || order.payment_proof_image;
  order.payment_submitted_at = data.payment_submitted_at || order.payment_submitted_at;
  order.payment_verified_at = data.payment_verified_at || order.payment_verified_at;
  order.payment_verified_by_name = data.payment_verified_by_name || order.payment_verified_by_name;
  order.payment_rejection_reason = data.payment_rejection_reason || null;
  order.payment_error = data.payment_error || null;
  order.payment_last_checked_at = data.checked_at || order.payment_last_checked_at;
  if (["paid", "installment_downpayment_paid", "installment_active", "installment_completed"].includes(data.payment_status)) {
    order.payment_completed_at = data.checked_at || order.payment_completed_at;
  }
  if (["failed", "expired", "cancelled", "installment_downpayment_failed", "installment_downpayment_expired"].includes(data.payment_status)) {
    order.payment_failed_at = data.checked_at || order.payment_failed_at;
  }
}

async function verifyGcashPayment(id, decision) {
  if (!requireAdminAction('Only admin can review payments.')) return;
  const payload = actorPayload();
  payload.decision = decision;
  if (decision === "rejected") {
    const values = await AppDialog.form({
      eyebrow: "Payment review",
      title: "Reject GCash payment proof",
      message: "Explain why the proof cannot be accepted. The customer will see this reason.",
      details: [{ label: "Order", value: orderLabel(id) }],
      fields: [{ name: "reason", label: "Rejection reason", type: "textarea", required: true, placeholder: "Example: The reference number does not match the screenshot." }],
      submitText: "Reject Payment",
      tone: "danger"
    });
    if (!values) return;
    payload.rejection_reason = values.reason.trim();
  } else {
    const confirmed = await AppDialog.confirm({
      eyebrow: "Payment review",
      title: "Approve GCash payment proof?",
      message: "Confirm that the reference number, amount, and screenshot have been verified.",
      details: [{ label: "Order", value: orderLabel(id) }],
      confirmText: "Approve Payment"
    });
    if (!confirmed) return;
  }

  const res = await fetch(`/payments/gcash/${id}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to verify payment.");
    return;
  }

  updateLocalOrderPayment(id, data);
  await loadOrders();
  viewOrder(id);
  loadFinance();
  loadAdminAlerts();
  loadAuditLogs();
  alert(data.message || "Payment verification updated.");
}

async function regeneratePaymentLink(id) {
  const res = await fetch(`/payments/gcash/retry/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(actorPayload())
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to prepare GCash upload.");
    await loadOrders();
    viewOrder(id);
    return;
  }

  updateLocalOrderPayment(id, data);
  await loadOrders();
  viewOrder(id);
  loadFinance();
  loadAdminAlerts();
  alert(data.message || "You can now upload GCash proof.");
}
async function deleteOrder(id) {
  if (!requireAdminAction("Only admin can delete orders.")) return;
  const confirmed = await AppDialog.confirm({
    title: `Delete ${orderLabel(id)}?`,
    message: "Related payment, installment, item, and review records will also be permanently removed.",
    confirmText: "Delete Order",
    tone: "danger"
  });
  if (!confirmed) return;

  const res = await fetch(`/orders/${id}?${actorQueryString()}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || "Unable to delete order.");
    return;
  }

  allOrders = allOrders.filter(item => Number(item.id) !== Number(id));
  renderOrderMetric();
  renderRepairQueue();
  renderOrders();
  renderAnalyticsDashboard();
  loadAdminAlerts();
  loadAuditLogs();
  alert(`${orderLabel(id)} deleted.`);
}
function statusUpdateDefaultNote(status) {
  const notes = {
    processing: "Order is being prepared by the shop.",
    shipped: "Order is ready for release.",
    delivered: "Order completed by the shop.",
    cancelled: "Order cancelled by admin."
  };
  return notes[status] || "Status updated by admin.";
}
function resetStatusUpdateControls() {
  renderOrders();
  if (document.getElementById("orderModal").classList.contains("show") && currentPrintableOrderId) {
    viewOrder(currentPrintableOrderId);
  }
}

function beginOrderStatusUpdate(id, status) {
  if (isStaffUser() && !['processing', 'shipped'].includes(status)) return;
  const order = allOrders.find(item => Number(item.id) === Number(id));
  if (!order) {
    alert("Order not found.");
    resetStatusUpdateControls();
    return;
  }

  const currentStatus = orderStatus(order);
  if (!status || currentStatus === status) {
    resetStatusUpdateControls();
    return;
  }

  if (status === "processing" && !orderPaymentReadyForProcessing(order)) {
    alert(orderPaymentBlockText(order));
    resetStatusUpdateControls();
    return;
  }

  if (["processing", "shipped"].includes(status) && order.cancellation_request_status === "pending") {
    alert("Review the cancellation request before continuing this order.");
    resetStatusUpdateControls();
    return;
  }

  const returnToOrderModal = document.getElementById("orderModal").classList.contains("show") && Number(currentPrintableOrderId) === Number(id);
  pendingStatusUpdate = { id: Number(id), status, returnToOrderModal };
  const currentLabel = ORDER_STATUS_LABELS[currentStatus] || currentStatus;
  const nextLabel = ORDER_STATUS_LABELS[status] || status;
  document.getElementById("statusUpdateTitle").innerText = `Update ${orderLabel(order)}`;
  document.getElementById("statusUpdateOrderLabel").innerText = orderLabel(order);
  document.getElementById("statusUpdateStatusText").innerText = `${currentLabel} to ${nextLabel}`;
  document.getElementById("statusUpdateNote").value = statusUpdateDefaultNote(status);
  if (returnToOrderModal) orderModal.hide();
  statusUpdateModal.show();
  setTimeout(() => document.getElementById("statusUpdateNote")?.focus(), 150);
}

function cancelStatusUpdate() {
  const payload = pendingStatusUpdate;
  pendingStatusUpdate = null;
  resetStatusUpdateControls();
  if (payload?.returnToOrderModal) viewOrder(payload.id);
}

async function confirmStatusUpdate() {
  if (!pendingStatusUpdate) return;
  const button = document.querySelector("#statusUpdateModal .modal-footer .btn-dark");
  const originalText = button ? button.innerText : "Save Update";
  if (button) {
    button.disabled = true;
    button.innerText = "Saving...";
  }

  const payload = pendingStatusUpdate;
  const adminNote = document.getElementById("statusUpdateNote")?.value.trim() || "";
  const ok = await updateOrderStatus(payload.id, payload.status, adminNote);

  if (button) {
    button.disabled = false;
    button.innerText = originalText;
  }
  if (!ok) return;

  pendingStatusUpdate = null;
  statusUpdateModal.hide();
}

async function updateOrderStatus(id, status, adminNote = "") {
  const openOrderModal = document.getElementById("orderModal").classList.contains("show") || Boolean(pendingStatusUpdate?.returnToOrderModal);
  const res = await fetch(`/orders/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      admin_note: adminNote,
      ...actorPayload()
    })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.message || "Failed to update order status.");
    await loadOrders();
    return false;
  }

  await loadOrders();
  if (openOrderModal) viewOrder(id);
  loadAdminAlerts();
  return true;
}
async function reviewCancellationRequest(id, decision) {
  if (!requireAdminAction('Only admin can review cancellations.')) return;
  const defaultNote = decision === "approved"
    ? "Cancellation approved by admin."
    : "Cancellation request rejected by admin.";
  const values = await AppDialog.form({
    eyebrow: "Cancellation review",
    title: decision === "approved" ? "Approve cancellation request?" : "Reject cancellation request?",
    message: "The customer will see the admin note with the request decision.",
    details: [{ label: "Order", value: orderLabel(id) }],
    fields: [{ name: "adminNote", label: "Admin note", type: "textarea", required: true, defaultValue: defaultNote }],
    submitText: decision === "approved" ? "Approve Request" : "Reject Request",
    tone: decision === "approved" ? "default" : "danger"
  });
  if (!values) return;
  const adminNote = values.adminNote.trim();

  const res = await fetch(`/orders/${id}/cancellation-request`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, admin_note: adminNote, ...actorPayload() })
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to review cancellation request.");
    await loadOrders();
    return;
  }

  await loadOrders();
  await loadAdminAlerts();
  const openOrderModal = document.getElementById("orderModal").classList.contains("show") || Boolean(pendingStatusUpdate?.returnToOrderModal);
  if (openOrderModal) viewOrder(id);
}

async function reviewRepairRequest(id, decision) {
  if (!requireAdminAction('Only admin can approve repair requests.')) return;
  const defaultNote = decision === "approved"
    ? "Repair approved. Please bring the item with receipt and accessories for checking."
    : "Repair request rejected after admin review.";
  const values = await AppDialog.form({
    eyebrow: "Repair review",
    title: decision === "approved" ? "Approve repair request?" : "Reject repair request?",
    message: "Add clear service instructions or the reason for the decision.",
    details: [{ label: "Order", value: orderLabel(id) }],
    fields: [{ name: "adminNote", label: "Repair instruction / admin note", type: "textarea", required: true, defaultValue: defaultNote }],
    submitText: decision === "approved" ? "Approve Repair" : "Reject Request",
    tone: decision === "approved" ? "default" : "danger"
  });
  if (!values) return;
  const adminNote = values.adminNote.trim();

  const res = await fetch(`/orders/${id}/repair-request`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, admin_note: adminNote, ...actorPayload() })
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to review repair request.");
    await loadOrders();
    return;
  }

  await loadOrders();
  await loadAdminAlerts();
  const openOrderModal = document.getElementById("orderModal").classList.contains("show") || Boolean(pendingStatusUpdate?.returnToOrderModal);
  if (openOrderModal) viewOrder(id);
}

async function updateRepairStatus(id, status, adminNote = "") {
  const res = await fetch(`/orders/${id}/repair-status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, admin_note: adminNote, ...actorPayload() })
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to update repair status.");
    await loadOrders();
    return;
  }

  await loadOrders();
  const openOrderModal = document.getElementById("orderModal").classList.contains("show") || Boolean(pendingStatusUpdate?.returnToOrderModal);
  if (openOrderModal) viewOrder(id);
}

async function addRepairNote(id) {
  const order = allOrders.find(item => item.id === id);
  const values = await AppDialog.form({
    eyebrow: "Repair update",
    title: "Add repair note",
    details: [{ label: "Order", value: orderLabel(id) }],
    fields: [{ name: "adminNote", label: "Repair note / instruction", type: "textarea", required: true, defaultValue: order?.repair_admin_note || "" }],
    submitText: "Save Note"
  });
  if (!values) return;
  const adminNote = values.adminNote.trim();
  await updateRepairStatus(id, order?.repair_service_status || "approved", adminNote);
}

async function loadInstallmentApplications() {
  const table = document.getElementById("installmentTable");
  if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Loading applications...</td></tr>`;

  const res = await fetch(`/installments?${actorQueryString()}`);
  const data = await res.json();

  if (!res.ok) {
    if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Unable to load applications.</td></tr>`;
    return;
  }

  installmentApplications = Array.isArray(data) ? data : [];
  renderInstallmentApplications();
}

function getFilteredInstallmentApplications() {
  const search = document.getElementById("installmentSearch")?.value.toLowerCase() || "";
  const status = document.getElementById("installmentStatusFilter")?.value || "all";

  return installmentApplications.filter(application => {
    const text = [
      application.full_name,
      application.customer_name,
      application.customer_email,
      application.phone,
      application.employment_status,
      application.employer_name,
      application.valid_id_type,
      application.valid_id_number
    ].join(" ").toLowerCase();
    const matchesStatus = status === "all" || installmentStatus(application) === status;
    return text.includes(search) && matchesStatus;
  });
}

function exportInstallmentApplicationsCsv() {
  const applications = getFilteredInstallmentApplications();
  if (!applications.length) {
    alert("No installment applications to export.");
    return;
  }
  const headers = ["Application ID", "Customer", "Email", "Phone", "Order ID", "Order Total", "Downpayment", "Balance", "Terms", "Monthly", "Status", "Submitted"];
  const rows = applications.map(application => [
    application.id,
    application.full_name || application.customer_name || "Customer",
    application.customer_email || "",
    application.phone || "",
    application.order_id ? orderReference(application.order_id) : "",
    Number(application.order_total || 0).toFixed(2),
    Number(application.downpayment_amount || 0).toFixed(2),
    Number(application.financed_amount || application.requested_limit || 0).toFixed(2),
    application.preferred_terms || "",
    Number(application.monthly_amount || 0).toFixed(2),
    installmentStatusLabel(installmentStatus(application)),
    application.created_at ? orderDate(application.created_at) : ""
  ]);
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `installment-applications-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportInstallmentSchedulesCsv() {
  const schedules = getFilteredInstallmentSchedules();
  if (!schedules.length) {
    alert("No installment schedules to export.");
    return;
  }
  const headers = ["Schedule ID", "Due Date", "Customer", "Email", "Order ID", "Installment No", "Amount Due", "Amount Paid", "Balance", "Status"];
  const rows = schedules.map(schedule => {
    const balance = Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
    return [
      schedule.id,
      String(schedule.due_date || "").slice(0, 10),
      schedule.full_name || "Customer",
      schedule.customer_email || "",
      schedule.order_id ? orderReference(schedule.order_id) : "",
      schedule.installment_no || "",
      Number(schedule.amount_due || 0).toFixed(2),
      Number(schedule.amount_paid || 0).toFixed(2),
      balance.toFixed(2),
      scheduleStatusLabel(scheduleStatus(schedule))
    ];
  });
  const csv = [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `installment-schedules-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function renderInstallmentApplications() {
  const table = document.getElementById("installmentTable");
  if (!table) return;

  const applications = getFilteredInstallmentApplications();

  if (!applications.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No installment applications found.</td></tr>`;
    return;
  }

  table.innerHTML = applications.map(application => {
    const status = installmentStatus(application);
    return `
      <tr>
        <td>
          <strong>${escapeHtml(application.full_name || application.customer_name || "Customer")}</strong><br>
          <small class="text-muted">${escapeHtml(application.customer_email || "")}</small><br>
          <small class="text-muted">${escapeHtml(application.phone || "")}</small>
        </td>
        <td>
          <strong>${application.order_id ? orderReference(application.order_id) : "-"}</strong><br>
          <small class="text-muted">${escapeHtml(application.product_name || "Checkout order")}</small><br>
          <small class="text-muted">${money(application.order_total)}</small>
        </td>
        <td>
          <strong>${money(application.downpayment_amount)}</strong><br>
          <small class="text-muted">${paymentMethodLabel(application.downpayment_method || "gcash")} · ${application.downpayment_status || "pending"}</small>
        </td>
        <td>${money(application.financed_amount || application.requested_limit)}</td>
        <td>${application.preferred_terms || 3} months<br><small class="text-muted">${money(application.monthly_amount)} / month</small></td>
        <td>
          <span class="status-badge ${status === "approved" ? "delivered" : status === "rejected" ? "cancelled" : "pending"}">
            ${INSTALLMENT_STATUS_LABELS[status] || status}
          </span>
        </td>
        <td>
          <div class="order-actions">
            <button type="button" class="btn btn-sm btn-outline-dark" onclick="reviewInstallmentApplication(${application.id})">Review</button>
            ${application.order_id ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="viewInstallmentFullPlan(${Number(application.order_id)})">${adminIcon("notebook-tabs")}<span>View Full Plan</span></button>` : ""}
            ${status === "pending" ? `
              <button type="button" class="btn btn-sm btn-dark" onclick="updateInstallmentApplication(${application.id}, 'approved')">Approve</button>
              <button type="button" class="btn btn-sm btn-outline-dark" onclick="updateInstallmentApplication(${application.id}, 'rejected')">Reject</button>
            ` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
  refreshAdminIcons();
}

function reviewInstallmentApplication(id) {
  currentPrintableOrderId = null;
  document.getElementById("printOrderButton")?.classList.add("d-none");
  document.getElementById("copyOrderIdButton")?.classList.add("d-none");
  document.getElementById("copyOrderLinkButton")?.classList.add("d-none");
  const application = installmentApplications.find(item => item.id === id);
  if (!application) return;

  const status = installmentStatus(application);
  document.getElementById("orderModalTitle").innerText = `Installment Application #${application.id}`;
  document.getElementById("orderModalBody").innerHTML = `
    <div class="d-flex justify-content-between align-items-start gap-3 mb-3">
      <div>
        <span class="status-badge ${status === "approved" ? "delivered" : status === "rejected" ? "cancelled" : "pending"}">
          ${INSTALLMENT_STATUS_LABELS[status] || status}
        </span>
        <div class="text-muted mt-2">Submitted ${orderDate(application.created_at)}</div>
      </div>
      <strong class="fs-4">${money(application.requested_limit)}</strong>
    </div>

    <div class="detail-grid">
      <div class="detail-box">
        <span>Customer</span>
        <strong>${escapeHtml(application.full_name || application.customer_name || "Customer")}</strong>
        <div>${escapeHtml(application.customer_email || "No email")}</div>
        <div>${escapeHtml(application.phone || "No phone")}</div>
      </div>
      <div class="detail-box">
        <span>Order</span>
        <strong>${application.order_id ? orderReference(application.order_id) : "-"}</strong>
        <div>${escapeHtml(application.product_name || "Checkout order")}</div>
        <div>Order Total: ${money(application.order_total)}</div>
      </div>
      <div class="detail-box">
        <span>Employment</span>
        <strong>${escapeHtml(application.employment_status || "National ID verification")}</strong>
        <div>${application.employer_name ? escapeHtml(application.employer_name) : "No employer/business name"}</div>
        ${Number(application.monthly_income || 0) > 0 ? `<div>Monthly Income: ${money(application.monthly_income)}</div>` : ""}
      </div>
      <div class="detail-box">
        <span>Installment Request</span>
        <strong>${application.preferred_terms || 3} months</strong>
        <div>Downpayment: ${money(application.downpayment_amount)} via ${paymentMethodLabel(application.downpayment_method || "gcash")}</div>
        <div>Downpayment Status: ${escapeHtml(application.downpayment_status || "pending")}</div>
        <div>Financed Balance: ${money(application.financed_amount || application.requested_limit)}</div>
        <div>Monthly: ${money(application.monthly_amount)} / month</div>
        <div>${escapeHtml(application.valid_id_type || "ID")}: ${escapeHtml(application.valid_id_number || "-")}</div>
        ${application.admin_note ? `<div class="text-muted mt-2">Admin note: ${escapeHtml(application.admin_note)}</div>` : ""}
      </div>
      <div class="detail-box">
        <span>Address</span>
        <strong>${escapeHtml(application.address || "No address")}</strong>
        <div>Birthday: ${escapeHtml(String(application.birthday || "").slice(0, 10))}</div>
      </div>
    </div>

    <div class="verification-grid">
      <div class="verification-card">
        <strong>National ID Photo</strong>
        ${application.national_id_image
          ? `<a class="btn btn-sm btn-outline-dark float-end" href="${escapeHtml(application.national_id_image)}" target="_blank">Open</a><img src="${escapeHtml(application.national_id_image)}" alt="National ID photo">`
          : `<div class="text-muted mt-2">No National ID photo uploaded.</div>`}
      </div>
      <div class="verification-card">
        <strong>Selfie with National ID</strong>
        ${application.selfie_with_id_image
          ? `<a class="btn btn-sm btn-outline-dark float-end" href="${escapeHtml(application.selfie_with_id_image)}" target="_blank">Open</a><img src="${escapeHtml(application.selfie_with_id_image)}" alt="Selfie with National ID">`
          : `<div class="text-muted mt-2">No selfie uploaded.</div>`}
      </div>
    </div>

    <div class="mt-3">
      <label class="form-label">Admin Note</label>
      <textarea id="installmentAdminNote" class="form-control" rows="3" placeholder="Optional note for approval or rejection">${escapeHtml(application.admin_note || "")}</textarea>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button class="btn btn-dark" onclick="updateInstallmentApplication(${application.id}, 'approved', true)">Approve</button>
        <button class="btn btn-outline-dark" onclick="updateInstallmentApplication(${application.id}, 'rejected', true)">Reject</button>
      </div>
    </div>
  `;
  orderModal.show();
}

async function updateInstallmentApplication(id, status, fromModal = false) {
  if (!requireAdminAction("Only admin can approve or reject installment applications.")) return;
  const noteElement = document.getElementById("installmentAdminNote");
  const fallbackNote = status === "approved"
    ? "Approved for installment checkout."
    : "Application rejected after admin review.";
  const adminNote = fromModal && noteElement ? noteElement.value.trim() : fallbackNote;
  const proceed = await AppDialog.confirm({
    eyebrow: "Installment review",
    title: `${INSTALLMENT_STATUS_LABELS[status] || status} this application?`,
    message: "The customer will be notified of this decision and the attached admin note.",
    details: [{ label: "Application ID", value: id }, { label: "Decision", value: INSTALLMENT_STATUS_LABELS[status] || status }],
    confirmText: status === "approved" ? "Approve Application" : "Reject Application",
    tone: status === "approved" ? "default" : "danger"
  });
  if (!proceed) return;

  const res = await fetch(`/installments/${id}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, admin_note: adminNote, ...actorPayload() })
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to update installment application.");
    return;
  }

  const application = installmentApplications.find(item => item.id === id);
  if (application) {
    application.status = status;
    application.admin_note = adminNote;
  }

  renderInstallmentApplications();
  if (fromModal) reviewInstallmentApplication(id);
  loadInstallmentSchedules();
  loadFinance();
  loadAdminAlerts();
}

async function loadInstallmentSchedules() {
  const table = document.getElementById("installmentScheduleTable");
  if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Loading schedules...</td></tr>`;

  const res = await fetch(`/installments/schedules?${actorQueryString()}`);
  const data = await res.json();

  if (!res.ok) {
    if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Unable to load schedules.</td></tr>`;
    return;
  }

  installmentSchedules = Array.isArray(data) ? data : [];
  renderInstallmentSchedules();
}

function scheduleStatus(schedule) {
  return schedule.status || "unpaid";
}

function scheduleStatusLabel(status) {
  const labels = {
    unpaid: "Unpaid",
    partial: "Partial",
    overdue: "Overdue",
    paid: "Paid"
  };
  return labels[status] || status;
}

function schedulePaymentLabel(schedule) {
  if ((schedule.status || "") === "paid") return "Paid";
  const status = schedule.payment_status || "not_started";
  const labels = {
    not_started: "No GCash proof yet",
    pending_verification: "GCash proof uploaded",
    paid: "Paid",
    failed: "Payment failed",
    expired: "Payment expired",
    cancelled: "Payment cancelled"
  };
  return labels[status] || status;
}

function getFilteredInstallmentSchedules() {
  const search = document.getElementById("scheduleSearch")?.value.toLowerCase() || "";
  const status = document.getElementById("scheduleStatusFilter")?.value || "all";

  return installmentSchedules.filter(schedule => {
    const text = [
      orderReference(schedule.order_id),
      schedule.full_name,
      schedule.customer_email,
      schedule.product_name,
      schedule.installment_no
    ].join(" ").toLowerCase();
    const matchesStatus = status === "all" || scheduleStatus(schedule) === status;
    return text.includes(search) && matchesStatus;
  });
}

function renderInstallmentSchedules() {
  const table = document.getElementById("installmentScheduleTable");
  if (!table) return;

  const schedules = getFilteredInstallmentSchedules();

  if (!schedules.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No installment schedules found.</td></tr>`;
    return;
  }

  table.innerHTML = schedules.map(schedule => {
    const status = scheduleStatus(schedule);
    const remaining = Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
    return `
      <tr>
        <td><strong>${String(schedule.due_date || "").slice(0, 10)}</strong></td>
        <td>
          <strong>${escapeHtml(schedule.full_name || "Customer")}</strong><br>
          <small class="text-muted">${escapeHtml(schedule.customer_email || "")}</small>
        </td>
        <td>${orderReference(schedule.order_id)}<br><small class="text-muted">${escapeHtml(schedule.product_name || "Product")}</small></td>
        <td>${schedule.installment_no}</td>
        <td>
          <strong>${money(schedule.amount_due)}</strong><br>
          <small class="text-muted">Paid: ${money(schedule.amount_paid)} | Balance: ${money(remaining)}</small><br>
          <small class="text-muted">GCash: ${escapeHtml(schedulePaymentLabel(schedule))}</small>
        </td>
        <td><span class="status-badge ${status === "paid" ? "delivered" : status === "overdue" ? "cancelled" : "pending"}">${scheduleStatusLabel(status)}</span></td>
        <td>
          <div class="order-actions">
            ${status !== "paid" ? `<button class="btn btn-sm btn-dark" onclick="recordInstallmentPayment(${schedule.id}, ${remaining})">Record Payment</button>` : `<span class="text-muted">Completed</span>`}
            ${schedule.payment_status === "pending_verification" ? `<button class="btn btn-sm btn-outline-dark" onclick="refreshInstallmentSchedulePayment(${schedule.id})">Check Payment</button>` : ""}
            ${schedule.payment_checkout_id && !isOldPaymentUrl(schedule.payment_checkout_url) && status !== "paid" ? `<button class="btn btn-sm btn-outline-dark" onclick="refreshInstallmentSchedulePayment(${schedule.id})">Refresh Proof</button>` : ""}
            <button type="button" class="btn btn-sm btn-outline-dark" onclick="viewInstallmentFullPlan(${Number(schedule.order_id)})">${adminIcon("notebook-tabs")}<span>View Full Plan</span></button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
  refreshAdminIcons();
}

function statementStatusLabel(status) {
  const labels = {
    paid: "Paid",
    overdue: "Overdue",
    due_soon: "Due Soon",
    partial: "Partial",
    current: "Current",
    unpaid: "Unpaid",
    pending_verification: "Checking GCash",
    failed: "Failed",
    expired: "Expired",
    cancelled: "Cancelled"
  };
  return labels[status] || status || "Current";
}

function adminStatementSummaryHtml(statement) {
  return `
    <div class="row g-3 mb-3">
      <div class="col-md-3"><div class="detail-box"><span>Total Plan</span><strong>${money(statement.total_price)}</strong></div></div>
      <div class="col-md-3"><div class="detail-box"><span>Total Paid</span><strong>${money(statement.total_paid)}</strong></div></div>
      <div class="col-md-3"><div class="detail-box"><span>Balance</span><strong>${money(statement.balance)}</strong></div></div>
      <div class="col-md-3"><div class="detail-box"><span>Next Due</span><strong>${statement.next_due_date ? `${formatDate(statement.next_due_date)} / ${money(statement.next_due_amount)}` : "None"}</strong></div></div>
    </div>
  `;
}

function adminStatementSchedulesHtml(statement) {
  const schedules = Array.isArray(statement.schedules) ? statement.schedules : [];
  if (!schedules.length) return `<div class="text-muted">No monthly schedule yet.</div>`;
  return `
    <div class="table-responsive mb-3">
      <table class="table table-bordered align-middle">
        <thead><tr><th>No.</th><th>Due Date</th><th>Deadline</th><th>Paid</th><th>Balance</th><th>Status</th><th>GCash Proof</th></tr></thead>
        <tbody>
          ${schedules.map(schedule => `
            <tr>
              <td>${escapeHtml(schedule.installment_no || "")}</td>
              <td>${escapeHtml(formatDate(schedule.due_date))}</td>
              <td>${money(schedule.amount_due)}</td>
              <td>${money(schedule.amount_paid)}</td>
              <td>${money(schedule.balance)}</td>
              <td><span class="status-badge ${schedule.status === "paid" ? "delivered" : schedule.status === "overdue" ? "cancelled" : "pending"}">${escapeHtml(statementStatusLabel(schedule.status))}</span></td>
              <td>${escapeHtml(schedulePaymentLabel(schedule))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function adminStatementLedgerHtml(statement) {
  const payments = Array.isArray(statement.payments) ? statement.payments : [];
  if (!payments.length) return `<div class="text-muted">No payment ledger records yet.</div>`;
  return `
    <div class="table-responsive">
      <table class="table table-bordered align-middle">
        <thead><tr><th>Entry</th><th>Date Paid</th><th>Amount</th><th>Balance After</th><th>Status</th></tr></thead>
        <tbody>
          ${payments.map(payment => `
            <tr>
              <td>Payment #${escapeHtml(payment.entry_no || payment.id)}</td>
              <td>${escapeHtml(formatDate(payment.paid_at || payment.created_at))}</td>
              <td>${money(payment.amount_paid)}</td>
              <td>${money(payment.balance)}</td>
              <td>${escapeHtml(statementStatusLabel(payment.status))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function viewInstallmentStatement(orderId) {
  try {
    const res = await fetch(`/soa/order/${orderId}`);
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Unable to load statement of account.");
    const statement = data.statement;
    if (!statement) return alert("No statement found for this order.");
    currentPrintableOrderId = null;
    document.getElementById("copyOrderIdButton")?.classList.add("d-none");
    document.getElementById("copyOrderLinkButton")?.classList.add("d-none");
    document.getElementById("printOrderButton")?.classList.add("d-none");
    document.getElementById("orderModalTitle").innerText = `${orderLabel(statement.order_id)} Statement of Account`;
    document.getElementById("orderModalBody").innerHTML = `
      <div class="detail-grid mb-3">
        <div class="detail-box"><span>Customer</span><strong>${escapeHtml(statement.customer_name || "Customer")}</strong><div>${escapeHtml(statement.customer_email || "")}</div></div>
        <div class="detail-box"><span>Order</span><strong>${escapeHtml(statement.product_name || "Installment order")}</strong><div>${escapeHtml(String(statement.installment_terms || "-") + " months")}</div></div>
      </div>
      ${adminStatementSummaryHtml(statement)}
      <h6 class="fw-bold">Monthly Schedule</h6>
      ${adminStatementSchedulesHtml(statement)}
      <h6 class="fw-bold">Payment Ledger</h6>
      ${adminStatementLedgerHtml(statement)}
    `;
    orderModal.show();
  } catch (error) {
    alert(error.message || "Unable to load statement of account.");
  }
}
async function refreshInstallmentSchedulePayment(scheduleId) {
  const res = await fetch(`/installments/schedules/${scheduleId}/status?${actorQueryString()}`);
  const data = await res.json();
  if (!res.ok) {
    alert(data.message || "Unable to refresh installment payment.");
    return;
  }
  await loadInstallmentSchedules();
  await loadOrders();
  await loadFinance();
  await loadCollections();
  await loadAdminAlerts();
  alert(`Installment payment status: ${schedulePaymentLabel(data)}`);
}

async function recordInstallmentPayment(scheduleId, suggestedAmount) {
  const values = await AppDialog.form({
    eyebrow: "Manual collection",
    title: "Record installment payment",
    message: "Confirm the amount received before updating the customer schedule.",
    details: [{ label: "Schedule ID", value: scheduleId }],
    fields: [{ name: "amount", label: "Payment amount", type: "number", required: true, min: "0.01", step: "0.01", defaultValue: Number(suggestedAmount || 0).toFixed(2) }],
    submitText: "Record Payment"
  });
  if (!values) return;
  const amount = Number(values.amount);

  const res = await fetch(`/installments/schedules/${scheduleId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount_paid: amount, ...actorPayload() })
  });
  const data = await res.json();

  if (!res.ok) {
    alert(data.message || "Unable to record payment.");
    return;
  }

  await loadInstallmentSchedules();
  await loadOrders();
  await loadFinance();
  await loadCollections();
  await loadAdminAlerts();
}

function renderMetrics() {
  const totalStock = allProducts.reduce((sum, item) => sum + Number(item.stock || 0), 0);
  const lowStock = allProducts.filter(item => Number(item.stock || 0) > 0 && Number(item.stock || 0) <= 5).length;

  document.getElementById("metricProducts").innerText = allProducts.length;
  document.getElementById("metricStock").innerText = totalStock.toLocaleString();
  document.getElementById("metricLowStock").innerText = lowStock;

  const lowItems = allProducts.filter(item => Number(item.stock || 0) <= 5);
  document.getElementById("overviewAlerts").innerHTML = lowItems.length
    ? lowItems.map(item => `<div class="d-flex justify-content-between border-bottom py-2"><div class="overview-stock-name"><img src="${escapeHtml(productImages(item)[0] || "/assets/sheena-mark.svg")}" alt="" loading="lazy"><span>${escapeHtml(item.name)}</span></div><strong>${Number(item.stock || 0)} left</strong></div>`).join("")
    : `<div class="overview-queue-empty"><i data-lucide="package-check" aria-hidden="true"></i><strong>Stock levels look good</strong></div>`;
  window.StaffWorkspace?.render();
  refreshAdminIcons();
}

function getFilteredProducts() {
  const search = document.getElementById("productSearch")?.value.toLowerCase() || "";
  const filter = document.getElementById("productFilter")?.value || "all";
  const categoryFilter = document.getElementById("productCategoryFilter")?.value || "all";
  const warrantyFilter = document.getElementById("productWarrantyFilter")?.value || "all";
  const sort = document.getElementById("productSort")?.value || "newest";

  return allProducts.filter(product => {
    const stock = Number(product.stock || 0);
    const category = productCategory(product);
    const variantText = productVariants(product).map(variant => variant.name || "").join(" ");
    const text = `${product.name || ""} ${category} ${product.description || ""} ${variantText}`.toLowerCase();
    const matchesSearch = text.includes(search);
    const matchesCategory = categoryFilter === "all" || category === categoryFilter;
    const matchesFilter = filter === "all" ||
      (filter === "low" && stock > 0 && stock <= 5) ||
      (filter === "out" && stock <= 0);

    const eligible = Number(product.warranty_eligible) === 1;
    const matchesWarranty = warrantyFilter === "all" || (warrantyFilter === "eligible" ? eligible : !eligible);
    return matchesSearch && matchesCategory && matchesFilter && matchesWarranty;
  }).sort((a, b) => {
    if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""));
    if (sort === "stock") return Number(a.stock || 0) - Number(b.stock || 0);
    if (sort === "price") return Number(a.price || 0) - Number(b.price || 0);
    return Number(b.id) - Number(a.id);
  });
}

function productWarrantyLabel(product) {
  if (Number(product.warranty_eligible) !== 1) return "Not eligible";
  const months = Number(product.warranty_duration_months || 0);
  if (!months) return "Duration not set";
  return months % 12 === 0 ? `${months / 12} ${months === 12 ? "year" : "years"}` : `${months} ${months === 1 ? "month" : "months"}`;
}

function resetProductFilters() {
  document.getElementById("productSearch").value = "";
  ["productCategoryFilter", "productFilter", "productWarrantyFilter"].forEach(id => { document.getElementById(id).value = "all"; });
  document.getElementById("productSort").value = "newest";
  renderProducts();
}

function setProductCatalogPage(page) {
  productCatalogPage = page;
  renderProducts(false);
  document.getElementById("productTable")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderProducts(resetPage = true) {
  const board = document.getElementById("productTable");
  if (!board) return;
  if (resetPage) productCatalogPage = 1;
  const products = getFilteredProducts();
  const pagination = document.getElementById("productPagination");
  if (pagination) pagination.hidden = true;
  board.setAttribute("aria-busy", productLoadState === "loading" ? "true" : "false");
  if (productLoadState !== "ready") {
    board.innerHTML = `<div class="admin-empty-state">${adminIcon(productLoadState === "error" ? "package-x" : "package")}<strong>${productLoadState === "error" ? "Unable to load products" : "Loading products..."}</strong>${productLoadState === "error" ? '<button type="button" class="btn btn-outline-dark" onclick="loadProducts()">Try again</button>' : ""}</div>`;
    window.lucide?.createIcons();
    return;
  }
  document.getElementById("productTotalCount").textContent = allProducts.length.toLocaleString();
  document.getElementById("productLowCount").textContent = allProducts.filter(item => Number(item.stock) > 0 && Number(item.stock) <= 5).length.toLocaleString();
  document.getElementById("productOutCount").textContent = allProducts.filter(item => Number(item.stock || 0) <= 0).length.toLocaleString();
  document.getElementById("productWarrantyCount").textContent = allProducts.filter(item => Number(item.warranty_eligible) === 1).length.toLocaleString();
  const pageCount = Math.max(1, Math.ceil(products.length / PRODUCT_PAGE_SIZE));
  productCatalogPage = Math.max(1, Math.min(productCatalogPage, pageCount));
  const start = (productCatalogPage - 1) * PRODUCT_PAGE_SIZE;
  document.getElementById("productShowingCount").textContent = products.length ? `Showing ${start + 1}-${Math.min(start + PRODUCT_PAGE_SIZE, products.length)} of ${products.length} products` : "0 products";
  if (!products.length) {
    board.innerHTML = `<div class="admin-empty-state">${adminIcon("package-search")}<strong>${allProducts.length ? "No matching products" : "Your catalog is empty"}</strong>${allProducts.length ? '<button type="button" class="btn btn-outline-dark" onclick="resetProductFilters()">Reset Filters</button>' : isAdminUser() ? '<button type="button" class="btn btn-dark" onclick="openProductModal()">Add Product</button>' : ""}</div>`;
    window.lucide?.createIcons();
    return;
  }
  board.innerHTML = `<table class="admin-products-table"><thead><tr><th scope="col">Product</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Stock</th><th scope="col">Payment</th><th scope="col">Warranty</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead><tbody>${products.slice(start, start + PRODUCT_PAGE_SIZE).map(product => {
    const images = productImages(product);
    const variants = productVariants(product);
    const name = escapeHtml(product.name);
    const stock = Number(product.stock || 0);
    const eligible = Number(product.warranty_eligible) === 1;
    return `<tr class="admin-product-card" data-product-id="${Number(product.id)}">
      <td class="product-identity"><div class="product-identity-inner"><div class="product-row-photo"><span ${images[0] ? "hidden" : ""}>${adminIcon("image")}</span>${images[0] ? `<img src="${escapeHtml(images[0])}" alt="${name}" loading="lazy" onerror="this.hidden=true;this.previousElementSibling.hidden=false">` : ""}</div><div><a href="/customer/product.html?id=${Number(product.id)}" target="_blank" rel="noopener">${name}</a><small>${variants.length || 1} option${variants.length > 1 ? "s" : ""} &middot; ${images.length} photo${images.length === 1 ? "" : "s"}</small></div></div></td>
      <td data-label="Category">${escapeHtml(productCategory(product))}</td>
      <td data-label="Price" class="product-row-price">${money(product.price)}</td>
      <td data-label="Stock"><strong>${stock.toLocaleString()}</strong><small class="product-stock-status ${stock <= 0 ? "out" : stock <= 5 ? "low" : ""}">${stock <= 0 ? "Out of stock" : stock <= 5 ? "Low stock" : "In stock"}</small></td>
      <td data-label="Payment"><span>COD / GCash</span>${productInstallmentEnabled(product) ? "<small>Installment</small>" : ""}${productLayawayEnabled(product) ? "<small>Layaway</small>" : ""}</td>
      <td data-label="Warranty"><span class="product-row-warranty ${eligible ? "eligible" : ""}">${eligible ? adminIcon("shield-check") : ""}${escapeHtml(productWarrantyLabel(product))}</span></td>
      <td class="product-row-actions">${isAdminUser() ? `<button type="button" class="product-tool-button" aria-label="Edit ${name}" title="Edit product" onclick="editProduct(${Number(product.id)})">${adminIcon("pencil")}</button><button type="button" class="product-tool-button product-delete" aria-label="Delete ${name}" title="Delete product" onclick="deleteProduct(${Number(product.id)})">${adminIcon("trash-2")}</button>` : '<span class="text-muted">View only</span>'}</td>
    </tr>`;
  }).join("")}</tbody></table>`;
  if (pagination && pageCount > 1) {
    pagination.hidden = false;
    pagination.innerHTML = `<span>Page ${productCatalogPage} of ${pageCount}</span><div><button type="button" class="product-tool-button" title="Previous page" aria-label="Previous product page" ${productCatalogPage <= 1 ? "disabled" : ""} onclick="setProductCatalogPage(${productCatalogPage - 1})">${adminIcon("chevron-left")}</button><button type="button" class="product-tool-button" title="Next page" aria-label="Next product page" ${productCatalogPage >= pageCount ? "disabled" : ""} onclick="setProductCatalogPage(${productCatalogPage + 1})">${adminIcon("chevron-right")}</button></div>`;
  }
  refreshRoleVisibility();
  window.lucide?.createIcons();
}

function productSoldQuantity(product) {
  const productId = Number(product.id);
  const productName = String(product.name || "").toLowerCase();
  return allOrders.reduce((sum, order) => {
    return sum + normalizedOrderItems(order).reduce((itemSum, item) => {
      const itemProductId = Number(item.product_id || item.id || 0);
      const itemName = String(item.product_name || "").toLowerCase();
      const matches = (itemProductId && itemProductId === productId) || (itemName && itemName === productName);
      return matches ? itemSum + Number(item.quantity || 1) : itemSum;
    }, 0);
  }, 0);
}

function inventoryMovement(product) {
  const sold = productSoldQuantity(product);
  if (sold >= 10) return { label: "Fast", className: "stock-low", sold };
  if (sold >= 3) return { label: "Steady", className: "stock-ok", sold };
  return { label: "Slow", className: "stock-ok", sold };
}

function suggestedRestockQuantity(product) {
  const stock = Number(product.stock || 0);
  const sold = productSoldQuantity(product);
  const target = Math.max(10, Math.ceil(sold * 1.5), productVariants(product).length * 5);
  return Math.max(target - stock, 0);
}

function inventoryInsightRows() {
  return allProducts.map(product => {
    const stock = Number(product.stock || 0);
    const sold = productSoldQuantity(product);
    const suggestedRestock = suggestedRestockQuantity(product);
    return { product, stock, sold, suggestedRestock, value: stock * Number(product.price || 0) };
  });
}

function renderInventoryIntelligence() {
  const rows = inventoryInsightRows();
  const critical = rows
    .filter(row => row.stock <= 5)
    .sort((a, b) => a.stock - b.stock || b.sold - a.sold)
    .slice(0, 5);
  const fastMoving = rows
    .filter(row => row.sold > 0)
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);
  const restock = rows
    .filter(row => row.suggestedRestock > 0)
    .sort((a, b) => b.suggestedRestock - a.suggestedRestock)
    .slice(0, 5);

  const renderRows = (id, data, emptyText, valueFormatter) => {
    const element = document.getElementById(id);
    if (!element) return;
    if (!data.length) {
      element.innerHTML = emptyText;
      return;
    }
    element.innerHTML = data.map(row => `
      <div class="inventory-mini-row">
        <strong>${escapeHtml(row.product.name || "Product")}</strong>
        <span>${escapeHtml(valueFormatter(row))}</span>
      </div>
    `).join("");
  };

  renderRows("inventoryCriticalStock", critical, "No critical stock right now.", row => `${row.stock} left`);
  renderRows("inventoryFastMoving", fastMoving, "No sales movement yet.", row => `${row.sold} sold`);
  renderRows("inventoryRestockSuggestions", restock, "No restock needed right now.", row => `Add ${row.suggestedRestock}`);
}
function inventoryStatus(product) {
  const stock = Number(product.stock || 0);
  if (stock <= 0) return { label: "Out of Stock", className: "stock-low" };
  if (stock <= 5) return { label: "Low Stock", className: "stock-low" };
  return { label: "In Stock", className: "stock-ok" };
}

function renderInventorySummary() {
  const totalItems = allProducts.length;
  const totalStock = allProducts.reduce((sum, product) => sum + Number(product.stock || 0), 0);
  const lowStock = allProducts.filter(product => Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 5).length;
  const stockValue = allProducts.reduce((sum, product) => sum + (Number(product.stock || 0) * Number(product.price || 0)), 0);
  const values = {
    inventoryTotalItems: totalItems,
    inventoryTotalStock: totalStock.toLocaleString(),
    inventoryLowStock: lowStock,
    inventoryStockValue: shortMoney(stockValue)
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
}

function inventoryVariantText(product) {
  const variants = productVariants(product);
  return variants.length ? variants.map(variant => variant.name || "Default").join(" | ") : "Default";
}

function restockPlanRows() {
  return inventoryInsightRows()
    .filter(row => row.suggestedRestock > 0)
    .sort((a, b) => b.suggestedRestock - a.suggestedRestock || b.sold - a.sold)
    .map(row => ({
      ...row,
      estimatedCost: row.suggestedRestock * Number(row.product.price || 0)
    }));
}

function inventoryPriority(row) {
  if (row.stock <= 0) return { label: "Critical", className: "priority-critical" };
  if (row.stock <= 5 && row.sold >= 3) return { label: "High", className: "priority-high" };
  if (row.suggestedRestock >= 10) return { label: "High", className: "priority-high" };
  if (row.suggestedRestock > 0) return { label: "Watch", className: "priority-watch" };
  return { label: "Healthy", className: "priority-healthy" };
}

function suggestedTargetStock(row) {
  return Number(row.stock || 0) + Number(row.suggestedRestock || 0);
}
function renderRestockPlan() {
  const container = document.getElementById("restockPlanTable");
  if (!container) return;
  const rows = restockPlanRows();
  if (!rows.length) {
    container.innerHTML = `<div class="admin-empty-state"><strong>No restock needed.</strong><span>Stock levels are currently healthy based on movement.</span></div>`;
    return;
  }

  container.innerHTML = rows.map(row => {
    const priority = inventoryPriority(row);
    const targetStock = suggestedTargetStock(row);
    return `
      <article class="inventory-plan-card">
        <div>
          <span class="priority-pill ${priority.className}">${priority.label}</span>
          <h6>${escapeHtml(row.product.name || "Product")}</h6>
          <small class="text-muted">ID ${escapeHtml(row.product.id)} / ${escapeHtml(productCategory(row.product))}</small>
        </div>
        <div class="inventory-plan-metrics">
          <div><span>Current</span><strong>${row.stock}</strong></div>
          <div><span>Sold</span><strong>${row.sold}</strong></div>
          <div><span>Add</span><strong>${row.suggestedRestock}</strong></div>
          <div><span>Target</span><strong>${targetStock}</strong></div>
          <div><span>Cost</span><strong>${money(row.estimatedCost)}</strong></div>
        </div>
        <div class="product-row-actions">
          <button type="button" class="btn btn-sm btn-dark" onclick="restockProduct(${row.product.id}, ${targetStock})">${adminIcon("package-plus")}<span>Use Suggestion</span></button>
          <button type="button" class="btn btn-sm btn-outline-dark" onclick="restockProduct(${row.product.id})">${adminIcon("plus")}<span>Manual</span></button>
        </div>
      </article>
    `;
  }).join("");
}
function exportRestockPlanCsv() {
  const rows = restockPlanRows();
  if (!rows.length) {
    alert("No restock plan to export.");
    return;
  }
  const headers = ["Product ID", "Product", "Current Stock", "Sold Qty", "Suggested Restock", "Target Stock", "Priority", "Unit Price", "Estimated Cost"];
  const csvRows = rows.map(row => [
    row.product.id,
    row.product.name || "Product",
    row.stock,
    row.sold,
    row.suggestedRestock,
    suggestedTargetStock(row),
    inventoryPriority(row).label,
    Number(row.product.price || 0).toFixed(2),
    row.estimatedCost.toFixed(2)
  ]);
  const csv = [headers, ...csvRows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `restock-plan-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function printRestockPlan() {
  const rows = restockPlanRows();
  if (!rows.length) {
    alert("No restock plan to print.");
    return;
  }
  const totalCost = rows.reduce((sum, row) => sum + row.estimatedCost, 0);
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return alert("Please allow pop-ups to print this restock plan.");
  printWindow.document.write(`
    <html><head><title>Restock Plan</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#111;}
        h1{margin:0 0 4px;font-size:24px;}
        p{margin:0 0 18px;color:#555;}
        table{width:100%;border-collapse:collapse;margin-top:16px;}
        th,td{border:1px solid #111;padding:9px;text-align:left;font-size:13px;}
        th{background:#f5f5f5;text-transform:uppercase;font-size:11px;}
        .total{text-align:right;font-weight:800;margin-top:16px;}
      </style></head><body>
      <h1>Restock Plan</h1>
      <p>Sheena's Gadgets & Accessories Shop · ${new Date().toLocaleString()}</p>
      <table>
        <thead><tr><th>Product</th><th>Current Stock</th><th>Sold Qty</th><th>Suggested Qty</th><th>Priority</th><th>Estimated Cost</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${escapeHtml(row.product.name || "Product")}</td><td>${row.stock}</td><td>${row.sold}</td><td>${row.suggestedRestock}</td><td>${inventoryPriority(row).label}</td><td>${money(row.estimatedCost)}</td></tr>`).join("")}</tbody>
      </table>
      <div class="total">Estimated Total: ${money(totalCost)}</div>
      <script>window.print();<\/script>
      
</body></html>
  `);
  printWindow.document.close();
}
function exportInventoryCsv() {
  if (!allProducts.length) {
    alert("No inventory records to export.");
    return;
  }

  const headers = ["Product ID", "Product", "Category", "Price", "Stock", "Status", "Sold Qty", "Suggested Restock", "Stock Value", "Variants", "Images"];
  const rows = allProducts.map(product => {
    const stock = Number(product.stock || 0);
    const status = inventoryStatus(product).label;
    const images = productImages(product);
    return [
      product.id,
      product.name || "Product",
      productCategory(product),
      Number(product.price || 0).toFixed(2),
      stock,
      status,
      productSoldQuantity(product),
      suggestedRestockQuantity(product),
      (stock * Number(product.price || 0)).toFixed(2),
      inventoryVariantText(product),
      images.length
    ];
  });
  const csv = [headers, ...rows]
    .map(row => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `inventory-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function exportLowStockCsv() {
  const rows = inventoryInsightRows().filter(row => row.stock <= 5 || row.suggestedRestock > 0);
  if (!rows.length) {
    alert("No low-stock or restock records to export.");
    return;
  }

  const headers = ["Product ID", "Product", "Category", "Current Stock", "Sold Qty", "Suggested Restock", "Target Stock", "Priority", "Estimated Cost"];
  const csvRows = rows.map(row => [
    row.product.id,
    row.product.name || "Product",
    productCategory(row.product),
    row.stock,
    row.sold,
    row.suggestedRestock,
    suggestedTargetStock(row),
    inventoryPriority(row).label,
    (row.suggestedRestock * Number(row.product.price || 0)).toFixed(2)
  ]);
  const csv = [headers, ...csvRows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `low-stock-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const INVENTORY_MOVEMENT_LABELS = {
  customer_order: "Customer Order",
  pos_sale: "POS Sale",
  manual_restock: "Manual Restock",
  manual_reduction: "Manual Reduction",
  stock_return: "Stock Return",
  initial_stock: "Initial Stock",
  layaway_reserve: "Layaway Reserve",
  layaway_cancel_restore: "Layaway Restore",
  product_update: "Product Update",
  staff_inventory_update: "Staff Stock Update"
};

function inventoryMovementLabel(type) {
  return INVENTORY_MOVEMENT_LABELS[type] || String(type || "Movement").replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function inventoryMovementClass(change) {
  return Number(change || 0) >= 0 ? "stock-ok" : "stock-low";
}

async function loadInventoryMovements() {
  window.StaffWorkspace?.activity('loading');
  const table = document.getElementById("inventoryMovementTable");
  if (table) table.innerHTML = `<div class="admin-empty-state"><strong>Loading stock history...</strong><span>Please wait while inventory records load.</span></div>`;
  try {
    const res = await fetch(`/admin/inventory-movements?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load stock history.");
    inventoryMovements = Array.isArray(data) ? data : [];
    renderInventoryMovements();
    window.StaffWorkspace?.activity('ready');
  } catch (error) {
    inventoryMovements = [];
    window.StaffWorkspace?.activity('error');
    if (table) table.innerHTML = `<div class="admin-empty-state"><strong>Unable to load stock history.</strong><span>Please refresh and try again.</span></div>`;
  }
}

function getFilteredInventoryMovements() {
  const search = document.getElementById("inventoryMovementSearch")?.value.toLowerCase() || "";
  const type = document.getElementById("inventoryMovementTypeFilter")?.value || "all";
  return inventoryMovements.filter(movement => {
    const movementType = String(movement.movement_type || "").toLowerCase();
    const productName = movement.display_product_name || movement.product_name || "Product";
    const orderText = movement.order_id ? orderReference(movement.order_id) : "";
    const text = [
      movement.id,
      productName,
      movement.variant_name,
      movement.category,
      movementType,
      inventoryMovementLabel(movementType),
      movement.source,
      movement.actor_name,
      movement.actor_role,
      movement.note,
      movement.order_id,
      orderText,
      movement.created_at
    ].join(" ").toLowerCase();
    return (type === "all" || movementType === type) && text.includes(search);
  });
}

function renderInventoryMovementSummary(rows) {
  const count = document.getElementById("inventoryMovementCount");
  const net = document.getElementById("inventoryMovementNet");
  const netChange = rows.reduce((sum, movement) => sum + Number(movement.quantity_change || 0), 0);
  if (count) count.innerText = rows.length.toLocaleString();
  if (net) net.innerText = `${netChange > 0 ? "+" : ""}${netChange.toLocaleString()}`;
}

function renderInventoryMovements() {
  const container = document.getElementById("inventoryMovementTable");
  if (!container) return;
  const rows = getFilteredInventoryMovements();
  renderInventoryMovementSummary(rows);

  if (!inventoryMovements.length) {
    container.innerHTML = `<div class="admin-empty-state"><strong>No stock history yet.</strong><span>Sales, restocks, returns, and reductions will appear here.</span></div>`;
    return;
  }

  if (!rows.length) {
    container.innerHTML = `<div class="admin-empty-state"><strong>No matching stock history.</strong><span>Try another search term or history type.</span></div>`;
    return;
  }

  container.innerHTML = rows.map(movement => {
    const change = Number(movement.quantity_change || 0);
    const productName = movement.display_product_name || movement.product_name || "Product";
    const variant = movement.variant_name ? `<small>${escapeHtml(movement.variant_name)}</small>` : "";
    const order = movement.order_id
      ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="viewOrder(${movement.order_id})">${adminIcon("eye")}<span>${orderReference(movement.order_id)}</span></button>`
      : `<span class="text-muted">-</span>`;
    return `
      <article class="inventory-history-row">
        <div class="inventory-history-date">
          <strong>${movement.created_at ? orderDate(movement.created_at) : "-"}</strong>
          <span>${escapeHtml(inventoryMovementLabel(movement.movement_type))}</span>
        </div>
        <div class="inventory-history-product">
          <strong>${escapeHtml(productName)}</strong>
          ${variant}
          <span>ID ${escapeHtml(movement.product_id || "-")}</span>
        </div>
        <div class="inventory-history-change">
          <span class="stock-pill ${inventoryMovementClass(change)}">${change > 0 ? "+" : ""}${change}</span>
          <small>${movement.quantity_before ?? "-"} to ${movement.quantity_after ?? "-"}</small>
        </div>
        <div class="inventory-history-source">
          <strong>${escapeHtml(movement.source || "system")}</strong>
          <span>${escapeHtml(movement.note || "No note")}</span>
        </div>
        <div class="inventory-history-actor">
          <strong>${escapeHtml(movement.actor_name || "System")}</strong>
          <span>${escapeHtml(movement.actor_role || "system")}</span>
        </div>
        <div class="inventory-history-order">${order}</div>
      </article>
    `;
  }).join("");
  refreshRoleVisibility();
}

function exportInventoryMovementsCsv() {
  const rows = getFilteredInventoryMovements();
  if (!rows.length) {
    alert("No stock history to export.");
    return;
  }
  const headers = ["Date", "Product ID", "Product", "Variant", "Type", "Change", "Before", "After", "Source", "Actor", "Role", "Order", "Note"];
  const csvRows = rows.map(movement => [
    movement.created_at ? orderDate(movement.created_at) : "",
    movement.product_id || "",
    movement.display_product_name || movement.product_name || "Product",
    movement.variant_name || "",
    inventoryMovementLabel(movement.movement_type),
    movement.quantity_change || 0,
    movement.quantity_before ?? "",
    movement.quantity_after ?? "",
    movement.source || "",
    movement.actor_name || "System",
    movement.actor_role || "system",
    movement.order_id ? orderReference(movement.order_id) : "",
    movement.note || ""
  ]);
  const csv = [headers, ...csvRows].map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stock-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetInventoryFilters() {
  const search = document.getElementById("inventorySearch");
  const status = document.getElementById("inventoryStatusFilter");
  const movement = document.getElementById("inventoryMovementFilter");
  if (search) search.value = "";
  if (status) status.value = "all";
  if (movement) movement.value = "all";
  renderInventory();
}

function getFilteredInventoryRows() {
  const search = document.getElementById("inventorySearch")?.value.toLowerCase() || "";
  const statusFilter = document.getElementById("inventoryStatusFilter")?.value || "all";
  const movementFilter = document.getElementById("inventoryMovementFilter")?.value || "all";

  return inventoryInsightRows().filter(row => {
    const product = row.product;
    const movement = inventoryMovement(product).label.toLowerCase();
    const variantText = productVariants(product).map(variant => [variant.name, variant.stock, variant.price].join(" ")).join(" ");
    const text = [product.id, product.name, productCategory(product), product.description, variantText].join(" ").toLowerCase();
    const matchesSearch = text.includes(search);
    const matchesStatus = statusFilter === "all" ||
      (statusFilter === "out" && row.stock <= 0) ||
      (statusFilter === "low" && row.stock > 0 && row.stock <= 5) ||
      (statusFilter === "needs-restock" && row.suggestedRestock > 0) ||
      (statusFilter === "healthy" && row.stock > 5 && row.suggestedRestock <= 0);
    const matchesMovement = movementFilter === "all" || movement === movementFilter;
    return matchesSearch && matchesStatus && matchesMovement;
  });
}
function renderInventory() {
  const container = document.getElementById("inventoryTable");
  if (!container) return;
  renderInventorySummary();
  renderInventoryIntelligence();
  renderRestockPlan();
  renderInventoryMovements();

  if (!allProducts.length) {
    container.innerHTML = `<div class="admin-empty-state"><strong>No inventory records.</strong><span>Add products first to track stock.</span></div>`;
    return;
  }

  const rows = getFilteredInventoryRows();
  if (!rows.length) {
    container.innerHTML = `<div class="admin-empty-state"><strong>No matching inventory records.</strong><span>Try another filter or search term.</span></div>`;
    return;
  }

  container.innerHTML = rows.map(row => {
    const product = row.product;
    const stock = Number(product.stock || 0);
    const status = stock <= 0 ? "Out of Stock" : stock <= 5 ? "Low Stock" : "In Stock";
    const statusClass = stock <= 5 ? "stock-low" : "stock-ok";
    const movement = inventoryMovement(product);
    const suggestedRestock = row.suggestedRestock;
    const priority = inventoryPriority(row);
    const targetStock = suggestedTargetStock(row);
    const image = productImages(product)[0] || "";

    return `
      <article class="inventory-card">
        <div class="inventory-card-media">
          ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">` : `<div class="admin-product-placeholder">${adminIcon("boxes")}</div>`}
        </div>
        <div class="inventory-card-main">
          <div class="inventory-card-head">
            <div>
              <span class="mini-chip category-chip">${escapeHtml(productCategory(product))}</span>
              <h5>${escapeHtml(product.name)}</h5>
              <small class="text-muted">ID ${escapeHtml(product.id)} / ${escapeHtml(inventoryVariantText(product))}</small>
            </div>
            <div class="inventory-card-status">
              <span class="stock-pill ${statusClass}">${status}</span>
              <span class="priority-pill ${priority.className}">${priority.label}</span>
            </div>
          </div>
          <div class="inventory-card-metrics">
            <div><span>Stock</span><strong>${stock.toLocaleString()}</strong></div>
            <div><span>Movement</span><strong>${escapeHtml(movement.label)}</strong><small>${movement.sold} sold</small></div>
            <div><span>Restock</span><strong>${suggestedRestock > 0 ? `+${suggestedRestock}` : "None"}</strong><small>${suggestedRestock > 0 ? `Target ${targetStock}` : "Healthy"}</small></div>
            <div><span>Value</span><strong>${money(stock * Number(product.price || 0))}</strong></div>
          </div>
        </div>
        <div class="inventory-card-actions">
          <div class="product-row-actions">
            ${suggestedRestock > 0 ? `<button type="button" class="btn btn-sm btn-dark" onclick="restockProduct(${product.id}, ${targetStock})">${adminIcon("package-plus")}<span>Use Suggestion</span></button>` : ""}
            <button type="button" class="btn btn-sm btn-outline-dark" onclick="restockProduct(${product.id})">${adminIcon("plus")}<span>Restock</span></button>
            ${isAdminUser() ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="editProduct(${product.id})">${adminIcon("pencil")}<span>Edit</span></button>` : ""}
          </div>
        </div>
      </article>
    `;
  }).join("");
  refreshRoleVisibility();
}
function renderPosProducts() {
  const container = document.getElementById("posProducts");
  if (!container) return;

  const search = document.getElementById("posSearch")?.value.toLowerCase() || "";
  const products = allProducts.filter(product => {
    const variants = productVariants(product).map(variant => variant.name).join(" ");
    const text = [product.name, productCategory(product), product.description, variants].join(" ").toLowerCase();
    return text.includes(search) && (Number(product.stock || 0) > 0 || productVariants(product).some(variant => Number(variant.stock || 0) > 0));
  });

  if (!products.length) {
    container.innerHTML = `<div class="empty-state">No available POS products.</div>`;
    return;
  }

  container.innerHTML = products.map(product => {
    const variants = productVariants(product).filter(variant => Number(variant.stock || 0) > 0);
    const defaultStock = Number(product.stock || 0);
    const category = productCategory(product);
    const image = productImages(product)[0] || product.image || "/assets/hero-iphone-style.png";
    const variantButtons = variants.length
      ? variants.map((variant, index) => `
        <button class="pos-variant-button" type="button" onclick="addToCart(${product.id}, '${index}')">
          <span class="pos-variant-name">${escapeHtml(variant.name || "Variant")}</span>
          <strong>${money(variant.price || product.price)}</strong>
          <small>${Number(variant.stock || 0)} in stock</small>
        </button>
      `).join("")
      : `<button class="btn btn-dark btn-sm w-100" ${defaultStock <= 0 ? "disabled" : ""} onclick="addToCart(${product.id})">Add to Cart</button>`;

    return `
      <div class="pos-item">
        <div class="pos-item-media">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">
        </div>
        <div class="pos-item-info">
          <div class="product-card-head mb-2">
            <span class="product-category">${escapeHtml(category)}</span>
            <span class="variant-count">${variants.length ? `${variants.length} variants` : `${defaultStock} stock`}</span>
          </div>
          <strong class="pos-product-title">${escapeHtml(product.name)}</strong>
          <div class="pos-price-line">Starts at ${money(product.price)}</div>
          <small>${defaultStock} total stock</small>
        </div>
        <div class="pos-variant-list">${variantButtons}</div>
      </div>
    `;
  }).join("");
}
function showFallbackModal(id) {
  const modal = document.getElementById(id);
  modal.style.display = "block";
  modal.removeAttribute("aria-hidden");
  modal.setAttribute("aria-modal", "true");
  modal.classList.add("show");
  document.body.classList.add("modal-open");
}

function hideFallbackModal(id) {
  const modal = document.getElementById(id);
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
  modal.removeAttribute("aria-modal");
  modal.classList.remove("show");
  document.body.classList.remove("modal-open");
}

function createModalController(id) {
  const modalElement = document.getElementById(id);
  const bootstrapController = window.bootstrap?.Modal ? new bootstrap.Modal(modalElement) : null;
  let opening = false;
  let closeAfterOpening = false;
  if (bootstrapController) {
    modalElement.addEventListener("show.bs.modal", () => { opening = true; });
    modalElement.addEventListener("shown.bs.modal", () => {
      opening = false;
      if (closeAfterOpening) {
        closeAfterOpening = false;
        bootstrapController.hide();
      }
    });
    modalElement.addEventListener("hidden.bs.modal", () => {
      opening = false;
      closeAfterOpening = false;
    });
  }
  const controller = bootstrapController
    ? {
        show: () => bootstrapController.show(),
        hide: () => {
          if (opening) closeAfterOpening = true;
          else bootstrapController.hide();
        },
      }
    : {
        show: () => showFallbackModal(id),
        hide: () => hideFallbackModal(id)
      };

  modalElement.querySelectorAll("[data-bs-dismiss='modal']").forEach(button => {
    button.addEventListener("click", () => controller.hide());
  });

  return controller;
}

function initializeModals() {
  productModal = createModalController("productModal");
  document.querySelector(".product-editor-tabs")?.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...document.querySelectorAll(".product-editor-tabs [role=tab]")];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[index];
    showProductEditorTab(document.getElementById(tab.getAttribute("aria-controls")).dataset.productTab);
    tab.focus();
  });
  orderModal = createModalController("orderModal");
  statusUpdateModal = createModalController("statusUpdateModal");
  document.getElementById("orderModal")?.addEventListener("hidden.bs.modal", () => {
    if (currentPrintableOrderId) clearAdminOrderUrl();
  });
  document.getElementById("statusUpdateModal")?.addEventListener("hidden.bs.modal", () => {
    if (pendingStatusUpdate) cancelStatusUpdate();
  });
}

function totalSelectedImages() {
  return retainedImages.length + stagedImageFiles.length;
}

function resetImageState(images = []) {
  retainedImages = [...images].slice(0, 20);
  stagedImageFiles = [];
  document.getElementById("image").value = "";
  renderImagePreview();
}

function renderImagePreview() {
  productPreviewUrls.forEach(url => URL.revokeObjectURL(url));
  productPreviewUrls = [];
  const preview = document.getElementById("imagePreview");
  const existingInput = document.getElementById("existingImage");
  const imageHelp = document.getElementById("imageHelp");
  existingInput.value = JSON.stringify(retainedImages);
  imageHelp.innerText = `${totalSelectedImages()} of 20 images selected. First image becomes the main product image.`;

  if (!totalSelectedImages()) {
    preview.className = "";
    preview.innerHTML = `<div class="image-preview-empty">No product images yet.</div>`;
    return;
  }

  preview.className = "image-preview-grid";
  const existing = retainedImages.map((src, index) => `
    <div class="image-preview-item">
      <img src="${escapeHtml(src)}" alt="Product image ${index + 1}">
      <button type="button" title="Remove image" aria-label="Remove product image ${index + 1}" onclick="removeExistingImage(${index})">${adminIcon("trash-2")}</button>
    </div>
  `).join("");

  const staged = stagedImageFiles.map((file, index) => {
    const url = URL.createObjectURL(file);
    productPreviewUrls.push(url);
    return `
    <div class="image-preview-item">
      <img src="${url}" alt="New product image ${index + 1}">
      <button type="button" title="Remove image" aria-label="Remove new product image ${index + 1}" onclick="removeStagedImage(${index})">${adminIcon("trash-2")}</button>
    </div>
  `;
  }).join("");

  preview.innerHTML = existing + staged;
  window.lucide?.createIcons();
}

function handleImageSelection(event) {
  const incomingFiles = Array.from(event.target.files || []);
  const availableSlots = 20 - totalSelectedImages();

  if (incomingFiles.length > availableSlots) {
    alert(`You can add ${availableSlots} more image${availableSlots === 1 ? "" : "s"} only.`);
  }

  stagedImageFiles = stagedImageFiles.concat(incomingFiles.slice(0, Math.max(availableSlots, 0)));
  event.target.value = "";
  renderImagePreview();
}

function removeExistingImage(index) {
  retainedImages.splice(index, 1);
  renderImagePreview();
}

function removeStagedImage(index) {
  stagedImageFiles.splice(index, 1);
  renderImagePreview();
}

function openProductModal() {
  if (!requireAdminAction("Only admin can add products.")) return;
  clearProductForm();
  document.getElementById("productModalTitle").innerText = "Add Product";
  productModal.show();
}

function showProductEditorTab(name) {
  document.querySelectorAll("#productModal [data-product-tab]").forEach(panel => {
    const selected = panel.dataset.productTab === name;
    panel.hidden = !selected;
    const tab = document.getElementById(panel.getAttribute("aria-labelledby"));
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
}

function productFormError(message, fieldId) {
  const error = document.getElementById("productFormError");
  error.textContent = message;
  error.hidden = !message;
  const field = document.getElementById(fieldId);
  if (field) {
    showProductEditorTab(field.closest("[data-product-tab]").dataset.productTab);
    field.focus();
  }
}

function toggleProductWarrantySettings() {
  const enabled = document.getElementById("warrantyEligible").checked;
  const settings = document.getElementById("productWarrantySettings");
  settings.hidden = !enabled;
  settings.querySelectorAll("input, select, textarea").forEach(input => { input.disabled = !enabled; });
  document.getElementById("warrantyDuration").required = enabled;
  updateProductWarrantyPreview();
}

function updateProductWarrantyPreview() {
  const duration = document.getElementById("warrantyDuration");
  const years = document.getElementById("warrantyUnit").value === "years";
  duration.max = years ? "10" : "120";
  const months = Number(duration.value) * (years ? 12 : 1);
  document.getElementById("productWarrantyPreview").textContent = Number.isInteger(Number(duration.value)) && months >= 1 && months <= 120 ? productWarrantyLabel({ warranty_eligible: 1, warranty_duration_months: months }) + (years ? ` (${months} months)` : "") : "Duration not set";
}

function setProductWarrantyOptions(product = {}) {
  const months = Number(product.warranty_duration_months || 12);
  const years = months % 12 === 0;
  document.getElementById("warrantyEligible").checked = Number(product.warranty_eligible) === 1;
  document.getElementById("warrantyUnit").value = years ? "years" : "months";
  document.getElementById("warrantyDuration").value = years ? months / 12 : months;
  document.getElementById("warrantyCoverage").value = product.warranty_coverage || "";
  document.getElementById("warrantyExclusions").value = product.warranty_exclusions || "";
  toggleProductWarrantySettings();
}

function toggleLayawaySettings() {
  const enabled = document.getElementById("allowLayaway")?.checked;
  const settings = document.getElementById("layawaySettings");
  if (!settings) return;
  settings.classList.toggle("d-none", !enabled);
  settings.querySelectorAll("input, select").forEach(input => {
    input.disabled = !enabled;
  });
}

function setProductSellingOptions(product = {}) {
  const settings = productLayawaySettings(product);
  document.getElementById("allowLayaway").checked = productLayawayEnabled(product);
  document.getElementById("allowInstallment").checked = productInstallmentEnabled(product);
  document.getElementById("layawayDownpaymentType").value = settings.type;
  document.getElementById("layawayDownpaymentValue").value = settings.value;
  document.getElementById("layawayDurationMonths").value = settings.duration;
  document.getElementById("layawayMaxQuantity").value = settings.maxQuantity;
  toggleLayawaySettings();
}

function editProduct(id) {
  const product = allProducts.find(item => item.id === id);
  if (!product) return;

  clearProductForm();
  document.getElementById("productModalTitle").innerText = "Edit Product";
  document.getElementById("productId").value = product.id;
  document.getElementById("name").value = product.name || "";
  document.getElementById("price").value = product.price ?? "";
  document.getElementById("stock").value = product.stock ?? "";
  document.getElementById("description").value = product.description || "";
  document.getElementById("category").value = productCategory(product);
  setProductSellingOptions(product);
  setProductWarrantyOptions(product);
  resetImageState(productImages(product));

  try {
    const variants = productVariants(product);
    variants.forEach(addVariant);
  } catch (error) {
    addVariant();
  }

  productModal.show();
}

function clearProductForm() {
  productFormError("");
  showProductEditorTab("details");
  setProductWarrantyOptions();
  document.getElementById("productId").value = "";
  document.getElementById("name").value = "";
  document.getElementById("price").value = "";
  document.getElementById("stock").value = "";
  document.getElementById("description").value = "";
  document.getElementById("category").value = "Accessories";
  setProductSellingOptions({
    allow_layaway: 0,
    allow_installment: 0,
    layaway_downpayment_type: "percentage",
    layaway_downpayment_value: 20,
    layaway_duration_months: 5,
    layaway_max_quantity: 1
  });
  resetImageState();
  document.getElementById("variantContainer").innerHTML = "";
}

function addVariant(variant = {}) {
  const container = document.getElementById("variantContainer");
  const row = document.createElement("div");
  row.className = "variant-row";
  row.innerHTML = `
    <div class="row g-2 align-items-end">
      <div class="col-md-5">
        <label class="form-label">Variant Name</label>
        <input class="form-control variant-name" placeholder="Example: Black 128GB" value="${escapeHtml(variant.name || "")}">
      </div>
      <div class="col-md-3">
        <label class="form-label">Stock</label>
        <input type="number" min="0" class="form-control variant-stock" placeholder="Stock" value="${variant.stock ?? ""}">
      </div>
      <div class="col-md-3">
        <label class="form-label">Price</label>
        <input type="number" min="0" step="0.01" class="form-control variant-price" placeholder="Price" value="${variant.price ?? ""}">
      </div>
      <div class="col-md-1">
        <button type="button" class="btn btn-outline-dark w-100" aria-label="Remove variant" title="Remove variant" onclick="this.closest('.variant-row').remove()">${adminIcon("trash-2")}</button>
      </div>
    </div>
  `;
  container.appendChild(row);
  window.lucide?.createIcons();
}

function buildVariants(price, stock) {
  const variants = [];
  const names = document.querySelectorAll(".variant-name");
  const stocks = document.querySelectorAll(".variant-stock");
  const prices = document.querySelectorAll(".variant-price");

  for (let i = 0; i < names.length; i++) {
    const name = names[i].value.trim();
    const variantStock = stocks[i].value.trim();
    const variantPrice = prices[i].value.trim();

    if (name || variantStock || variantPrice) {
      variants.push({
        name: name || "Default",
        stock: Number(variantStock || stock),
        price: Number(variantPrice || price)
      });
    }
  }

  return variants.length ? variants : [{ name: "Default", stock: Number(stock), price: Number(price) }];
}

async function saveProduct() {
  if (productSaveInProgress) return;
  if (!requireAdminAction("Only admin can save product changes.")) return;
  const id = document.getElementById("productId").value;
  const name = document.getElementById("name").value.trim();
  const price = document.getElementById("price").value;
  const stock = document.getElementById("stock").value;
  const category = document.getElementById("category").value;
  const description = document.getElementById("description").value.trim();
  const existingImage = JSON.stringify(retainedImages);

  if (!name || price === "" || stock === "") {
    productFormError("Complete product name, price, and stock.", !name ? "name" : price === "" ? "price" : "stock");
    return;
  }

  if (!Number.isFinite(Number(price)) || Number(price) < 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    productFormError("Price must be non-negative and stock must be a whole, non-negative quantity.", Number(price) < 0 ? "price" : "stock");
    return;
  }
  const warrantyEligible = document.getElementById("warrantyEligible").checked;
  const duration = Number(document.getElementById("warrantyDuration").value);
  const warrantyMonths = warrantyEligible ? duration * (document.getElementById("warrantyUnit").value === "years" ? 12 : 1) : 0;
  if (warrantyEligible && (!Number.isInteger(duration) || warrantyMonths < 1 || warrantyMonths > 120)) {
    productFormError("Enter a whole warranty duration from 1 to 120 months, or 1 to 10 years.", "warrantyDuration");
    return;
  }
  const variants = buildVariants(price, stock);
  if (variants.some(variant => !Number.isInteger(variant.stock) || variant.stock < 0 || !Number.isFinite(variant.price) || variant.price < 0)) {
    showProductEditorTab("variants");
    productFormError("Variant stock and prices must be valid non-negative values.");
    return;
  }
  productFormError("");

  const formData = new FormData();
  formData.append("name", name);
  formData.append("price", price);
  formData.append("stock", stock);
  formData.append("category", category);
  formData.append("description", description);
  formData.append("variants", JSON.stringify(variants));
  formData.append("warranty_eligible", warrantyEligible ? "1" : "0");
  formData.append("warranty_duration_months", warrantyMonths);
  formData.append("warranty_coverage", warrantyEligible ? document.getElementById("warrantyCoverage").value.trim() : "");
  formData.append("warranty_exclusions", warrantyEligible ? document.getElementById("warrantyExclusions").value.trim() : "");
  formData.append("existingImages", existingImage || "[]");
  formData.append("allow_layaway", document.getElementById("allowLayaway")?.checked ? "1" : "0");
  formData.append("allow_installment", document.getElementById("allowInstallment")?.checked ? "1" : "0");
  formData.append("layaway_downpayment_type", document.getElementById("layawayDownpaymentType")?.value || "percentage");
  formData.append("layaway_downpayment_value", document.getElementById("layawayDownpaymentValue")?.value || "20");
  formData.append("layaway_duration_months", document.getElementById("layawayDurationMonths")?.value || "5");
  formData.append("layaway_max_quantity", document.getElementById("layawayMaxQuantity")?.value || "1");
  Object.entries(actorPayload()).forEach(([key, value]) => formData.append(key, value || ""));

  if (totalSelectedImages() > 20) {
    alert("Maximum of 20 images only.");
    return;
  }

  stagedImageFiles.forEach(file => formData.append("images", file));

  const button = document.getElementById("saveProductButton");
  productSaveInProgress = true;
  button.disabled = true;
  button.querySelector("span").textContent = "Saving...";
  try {
    const res = await fetch(id ? `/products/${id}` : "/products", {
      method: id ? "PUT" : "POST",
      body: formData
    });
    const data = await res.json();

    if (!res.ok) {
      productFormError(data.message || "Failed to save product.");
      return;
    }

    productModal.hide();
    await loadProducts();
  } catch (error) {
    productFormError("Unable to save product. Please try again.");
  } finally {
    productSaveInProgress = false;
    button.disabled = false;
    button.querySelector("span").textContent = "Save Product";
  }
}

async function updateProductStock(product, stock, reason = '', variants = null) {
  const formData = new FormData();
  formData.append("name", product.name || "");
  formData.append("price", product.price || 0);
  formData.append("stock", stock);
  formData.append("category", productCategory(product));
  formData.append("description", product.description || "");
  formData.append("variants", variants ? JSON.stringify(variants) : product.variants || JSON.stringify(productVariants(product)));
  formData.append("existingImages", JSON.stringify(productImages(product)));
  const settings = productLayawaySettings(product);
  formData.append("allow_layaway", productLayawayEnabled(product) ? "1" : "0");
  formData.append("allow_installment", productInstallmentEnabled(product) ? "1" : "0");
  formData.append("layaway_downpayment_type", settings.type);
  formData.append("layaway_downpayment_value", settings.value);
  formData.append("layaway_duration_months", settings.duration);
  formData.append("layaway_max_quantity", settings.maxQuantity);
  formData.append("inventory_update", "1");
  formData.append('stock_reason', reason);
  Object.entries(actorPayload()).forEach(([key, value]) => formData.append(key, value || ""));

  return fetch(`/products/${product.id}`, {
    method: "PUT",
    body: formData
  });
}

async function restockProduct(id, suggestedStock = null) {
  const product = allProducts.find(item => item.id === id);
  if (!product) return;

  const currentStock = Number(product.stock || 0);
  const defaultStock = suggestedStock === null || suggestedStock === undefined ? currentStock : Number(suggestedStock);
  const staffVariants = isStaffUser() ? productVariants(product) : [];
  const values = await AppDialog.form({
    eyebrow: "Inventory adjustment",
    title: "Update product stock",
    message: staffVariants.length ? '' : suggestedStock === null || suggestedStock === undefined
      ? "Enter the new available stock quantity."
      : `The suggested target stock is ${defaultStock}. Confirm or adjust it below.`,
    details: [
      { label: "Product", value: product.name },
      { label: "Current stock", value: currentStock }
    ],
    fields: [...(staffVariants.length ? staffVariants.map((variant,index) => ({ name: `variantStock${index}`, label: variant.name || `Variant ${index + 1}`, type: 'number', required: true, min: '0', step: '1', defaultValue: Number(variant.stock || 0) })) : [{ name: "stock", label: "New stock quantity", type: "number", required: true, min: "0", step: "1", defaultValue: defaultStock }]),
      ...(isStaffUser() ? [{ name: 'reason', label: 'Adjustment reason', type: 'textarea', required: true, maxLength: 500 }] : [])],
    submitText: "Update Stock"
  });
  if (!values) return;
  const updatedVariants = staffVariants.length ? staffVariants.map((variant,index) => ({ ...variant, stock: Number(values[`variantStock${index}`]) })) : null;
  const newStock = updatedVariants ? updatedVariants.reduce((sum, variant) => sum + variant.stock, 0) : Number(values.stock);
  if (!Number.isInteger(newStock) || newStock < 0) return;

  const res = await updateProductStock(product, newStock, values.reason || '', updatedVariants);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.message || "Failed to update stock.");
    return;
  }

  await loadProducts();
  await loadInventoryMovements();
  renderInventory();
  renderPosProducts();
  renderLayawayProductOptions();
  setLayawayDefaultDeadline();
  updateLayawayEstimate();
}
async function deleteProduct(id) {
  if (!requireAdminAction("Only admin can delete products.")) return;
  const product = allProducts.find(item => item.id === id);
  const confirmed = await AppDialog.confirm({
    title: "Delete product?",
    message: "This removes the product from the shop and cannot be undone.",
    details: [{ label: "Product", value: product?.name || `Product #${id}` }],
    confirmText: "Delete Product",
    tone: "danger"
  });
  if (!confirmed) return;

  const res = await fetch(`/products/${id}?${actorQueryString()}`, { method: "DELETE" });
  if (!res.ok) {
    alert("Failed to delete product.");
    return;
  }

  await loadProducts();
}

function cartItemKey(productId, variantIndex = "") {
  return `${productId}:${variantIndex === null || variantIndex === undefined ? "" : variantIndex}`;
}

function addToCart(id, variantIndex = "") {
  const product = allProducts.find(item => Number(item.id) === Number(id));
  if (!product) return;

  const variants = productVariants(product);
  const hasVariant = variantIndex !== "" && variantIndex !== null && variantIndex !== undefined;
  const variant = hasVariant ? variants[Number(variantIndex)] : null;
  const stock = Number(variant ? variant.stock : product.stock || 0);
  const price = Number(variant ? variant.price : product.price || 0);

  if (stock <= 0) {
    alert("This item is out of stock.");
    return;
  }

  const key = cartItemKey(product.id, hasVariant ? String(variantIndex) : "");
  const existing = cart.find(item => item.key === key);
  if (existing) {
    if (existing.quantity >= stock) {
      alert("Not enough stock for this item.");
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({
      key,
      id: product.id,
      name: product.name,
      variant_index: hasVariant ? String(variantIndex) : "",
      variant_name: variant ? variant.name || "Selected Variant" : "Default",
      price,
      stock,
      quantity: 1
    });
  }

  renderCart();
}

function updateCartQty(key, quantity) {
  const item = cart.find(cartItem => cartItem.key === String(key));
  if (!item) return;

  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) {
    cart = cart.filter(cartItem => cartItem.key !== String(key));
  } else {
    item.quantity = Math.min(qty, item.stock);
  }

  renderCart();
}

function renderCart() {
  const list = document.getElementById("cartList");
  const hint = document.getElementById("posCartHint");
  if (!list) return;

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  if (!cart.length) {
    list.innerHTML = "No items selected.";
    if (hint) hint.innerText = "No active sale yet.";
  } else {
    if (hint) hint.innerText = `${itemCount} item${itemCount === 1 ? "" : "s"} selected`;
    list.innerHTML = cart.map(item => `
      <div class="cart-row">
        <div class="pos-cart-main">
          <div class="pos-cart-info">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.variant_name || "Default")} - ${money(item.price)} each</span>
          </div>
          <button class="btn btn-sm btn-outline-dark pos-cart-remove" onclick="updateCartQty('${item.key}', 0)">Remove</button>
        </div>
        <div class="pos-cart-controls">
          <label>Qty</label>
          <input type="number" min="1" max="${item.stock}" value="${item.quantity}" class="form-control form-control-sm" onchange="updateCartQty('${item.key}', this.value)">
          <strong>${money(item.price * item.quantity)}</strong>
        </div>
      </div>
    `).join("");
  }

  document.getElementById("cartTotal").innerText = money(total);
}

function isPOSOrder(order) {
  return String(order.payment_provider || "").toLowerCase() === "pos" ||
    String(order.delivery_contact || "").toUpperCase() === "POS" ||
    String(order.recipient_name || "").toLowerCase() === "walk-in customer";
}

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function renderPOSDashboard() {
  renderPOSSummary();
  renderRecentPOSReceipts();
}

function renderPOSSummary() {
  const cashier = document.getElementById("posCashierName");
  if (cashier) cashier.innerText = currentAdminUser?.name || currentAdminUser?.email || "Staff";

  const today = localDateKey();
  const posOrders = allOrders.filter(isPOSOrder);
  const todayOrders = posOrders.filter(order => localDateKey(order.created_at) === today);
  const cashOrders = todayOrders.filter(order => ["cod", "cash"].includes(String(order.payment_method || "cod").toLowerCase()));
  const digitalOrders = todayOrders.filter(order => paymentMethodLabel(order.payment_method) === "GCash");
  const sumOrders = orders => orders.reduce((sum, order) => sum + Number(order.total_price || 0), 0);

  const todaySales = document.getElementById("posTodaySales");
  const todayCount = document.getElementById("posTodayCount");
  const cashSales = document.getElementById("posCashSales");
  const digitalSales = document.getElementById("posDigitalSales");

  if (todaySales) todaySales.innerText = money(sumOrders(todayOrders));
  if (todayCount) todayCount.innerText = `${todayOrders.length} transaction${todayOrders.length === 1 ? "" : "s"}`;
  if (cashSales) cashSales.innerText = money(sumOrders(cashOrders));
  if (digitalSales) digitalSales.innerText = money(sumOrders(digitalOrders));
}

function receiptFromOrder(order) {
  const items = normalizedOrderItems(order).map(item => ({
    product_name: item.product_name || "Product",
    variant_name: item.variant_name || "Default",
    quantity: Number(item.quantity || 1),
    unit_price: Number(item.unit_price || item.subtotal || 0),
    subtotal: Number(item.subtotal || 0)
  })).map(item => ({
    ...item,
    unit_price: item.unit_price || (item.quantity ? item.subtotal / item.quantity : item.subtotal)
  }));

  return {
    order_id: order.id,
    reference: `POS-${orderReference(order)}`,
    date: orderDate(order.created_at),
    cashier: order.customer_name || currentAdminUser?.name || currentAdminUser?.email || "POS Staff",
    payment_method: order.payment_method || "cod",
    total: Number(order.total_price || 0),
    items
  };
}

function renderRecentPOSReceipts() {
  const container = document.getElementById("posRecentReceipts");
  if (!container) return;

  recentPOSReceipts = allOrders
    .filter(isPOSOrder)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!recentPOSReceipts.length) {
    container.innerHTML = `<div class="text-muted">No POS receipts yet.</div>`;
    return;
  }

  container.innerHTML = recentPOSReceipts.slice(0, 6).map(order => `
    <div class="pos-receipt-row">
      <div>
        <strong>POS-${orderReference(order)}</strong>
        <span>${orderDate(order.created_at)} · ${escapeHtml(paymentMethodLabel(order.payment_method))}</span>
      </div>
      <div class="text-end">
        <strong>${money(order.total_price)}</strong>
        <div class="d-flex gap-1 justify-content-end flex-wrap mt-1">
          <button class="btn btn-sm btn-outline-dark" onclick="showPOSReceiptFromOrder(${order.id})">Receipt</button>
          <button class="btn btn-sm btn-dark" onclick="viewOrder(${order.id})">Open</button>
        </div>
      </div>
    </div>
  `).join("");
}

function showPOSReceiptFromOrder(orderId) {
  const order = allOrders.find(item => Number(item.id) === Number(orderId));
  if (!order) return;
  lastReceipt = receiptFromOrder(order);
  renderPOSReceipt(lastReceipt);
  document.getElementById("posReceipt")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function exportTodayPOSCsv() {
  const today = localDateKey();
  const rows = allOrders
    .filter(order => isPOSOrder(order) && localDateKey(order.created_at) === today)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (!rows.length) {
    alert("No POS sales for today yet.");
    return;
  }

  const csvRows = [
    ["Receipt", "Date", "Cashier", "Payment", "Items", "Total"],
    ...rows.map(order => [
      `POS-${orderReference(order)}`,
      orderDate(order.created_at),
      order.customer_name || "POS Staff",
      paymentMethodLabel(order.payment_method),
      orderItemsCsvText(order),
      Number(order.total_price || 0).toFixed(2)
    ])
  ];
  csvRows.push([]);
  csvRows.push(["Total", "", "", "", "", rows.reduce((sum, order) => sum + Number(order.total_price || 0), 0).toFixed(2)]);

  const csv = csvRows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pos-daily-sales-${today}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function paymentMethodLabel(method) {
  const value = String(method || "").toLowerCase();
  const labels = {
    cod: "Cash on Delivery",
    cash: "Cash",
    gcash: "GCash",
    installment: "Installment"
  };
  return labels[value] || (isGCashMethod(value) ? "GCash" : String(method || "Cash").toUpperCase());
}

function receiptReference(receipt) {
  return receipt.reference || `POS-${orderReference(receipt.order_id)}`;
}

function buildReceiptText(receipt) {
  const lines = [
    "Sheena's Gadgets & Accessories Shop",
    "POS Official Receipt",
    `Receipt No: ${receiptReference(receipt)}`,
    `Date: ${receipt.date}`,
    `Cashier: ${receipt.cashier || currentAdminUser?.name || "POS Staff"}`,
    `Payment: ${paymentMethodLabel(receipt.payment_method)}`,
    "",
    "Items:"
  ];

  receipt.items.forEach(item => {
    const variant = item.variant_name && item.variant_name !== "Default" ? ` (${item.variant_name})` : "";
    lines.push(`${item.product_name}${variant} x${item.quantity} @ ${money(item.unit_price)} = ${money(item.subtotal)}`);
  });

  lines.push("", `Total: ${money(receipt.total)}`, "", "Thank you for your purchase.");
  return lines.join("\n");
}

function renderPOSReceipt(receipt) {
  const box = document.getElementById("posReceipt");
  if (!box) return;

  box.classList.remove("d-none");
  box.innerHTML = `
    <div class="receipt-head">
      <div>
        <strong>Receipt #${escapeHtml(receiptReference(receipt))}</strong>
        <span>${escapeHtml(receipt.date)} · ${escapeHtml(receipt.cashier || "POS Staff")}</span>
      </div>
      <div class="d-flex gap-1 flex-wrap justify-content-end">
        <button class="btn btn-sm btn-outline-dark" onclick="printPOSReceipt()">Print</button>
        <button class="btn btn-sm btn-outline-dark" onclick="downloadPOSReceipt()">Download</button>
      </div>
    </div>
    <div class="receipt-lines">
      ${receipt.items.map(item => `
        <div class="receipt-line">
          <span>${escapeHtml(item.product_name)}${item.variant_name && item.variant_name !== "Default" ? ` · ${escapeHtml(item.variant_name)}` : ""} x${item.quantity}</span>
          <strong>${money(item.subtotal)}</strong>
        </div>
      `).join("")}
    </div>
    <div class="receipt-total">
      <span>${escapeHtml(paymentMethodLabel(receipt.payment_method))}</span>
      <strong>${money(receipt.total)}</strong>
    </div>
  `;
}

function downloadPOSReceipt() {
  if (!lastReceipt) return alert("No receipt available yet.");
  const blob = new Blob([buildReceiptText(lastReceipt)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `receipt-${receiptReference(lastReceipt)}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function printPOSReceipt() {
  if (!lastReceipt) return alert("No receipt available yet.");
  const popup = window.open("", "_blank", "width=420,height=640");
  if (!popup) return alert("Allow popups to print the receipt.");
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(receiptReference(lastReceipt))}</title><style>body{font-family:Arial,sans-serif;padding:18px;color:#080808}pre{white-space:pre-wrap;font-size:13px;line-height:1.5}button{display:none}@media print{body{padding:0}}</style></head><body><pre>${escapeHtml(buildReceiptText(lastReceipt))}</pre><script>window.onload=function(){window.print();}<\/script></body></html>`);
  popup.document.close();
}

async function checkoutPOS() {
  if (!cart.length) {
    alert("Cart is empty.");
    return;
  }

  const button = document.getElementById("posCheckoutButton");
  if (button) {
    button.disabled = true;
    button.innerText = "Completing...";
  }

  const paymentMethod = document.getElementById("posPaymentMethod").value;
  const saleItems = cart.map(item => ({ ...item }));

  try {
    const res = await fetch("/orders/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "pos",
        items: saleItems.map(item => ({
          product_id: item.id,
          quantity: item.quantity,
          variant_index: item.variant_index === "" ? null : item.variant_index
        })),
        payment_method: paymentMethod,
        user_id: currentAdminUser?.id || 1,
        ...actorPayload()
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.message || "Failed to complete POS sale.");
      return;
    }

    lastReceipt = {
      order_id: data.order_id,
      reference: `POS-${orderReference(data.order_id)}`,
      date: new Date().toLocaleString(),
      cashier: currentAdminUser?.name || currentAdminUser?.email || "POS Staff",
      payment_method: paymentMethod,
      total: data.total,
      items: data.items || saleItems.map(item => ({
        product_name: item.name,
        variant_name: item.variant_name || "Default",
        quantity: item.quantity,
        unit_price: item.price,
        subtotal: item.price * item.quantity
      }))
    };

    renderPOSReceipt(lastReceipt);
    alert("Sale completed. Receipt generated.");
    clearCart(false);
    await loadProducts();
    await loadOrders();
    renderPosProducts();
    renderPOSDashboard();
  } finally {
    if (button) {
      button.disabled = false;
      button.innerText = "Complete Sale";
    }
  }
}
function clearCart(hideReceipt = true) {
  cart = [];
  renderCart();
  if (hideReceipt) document.getElementById("posReceipt")?.classList.add("d-none");
}

function collectionStatusLabel(status) {
  const labels = {
    overdue: "Overdue",
    due_today: "Due Today",
    due_soon: "Due Soon",
    partial: "Partial",
    current: "Current",
    paid: "Paid"
  };
  return labels[status] || status || "Current";
}

function collectionBadgeClass(status) {
  if (status === "overdue") return "cancelled";
  if (["due_today", "due_soon", "partial"].includes(status)) return "processing";
  if (status === "paid") return "delivered";
  return "pending";
}

function collectionCustomerName(item) {
  return item.full_name || item.customer_name || "Customer";
}

function collectionDueText(item) {
  const status = item.collection_status || "current";
  const daysOverdue = Number(item.days_overdue || 0);
  const daysUntilDue = Number(item.days_until_due || 0);
  if (status === "overdue") return `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`;
  if (status === "due_today") return "Due today";
  if (status === "due_soon") return `Due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`;
  return "On schedule";
}

function renderCollectionSummary() {
  const summary = collectionSummary || {};
  const values = {
    collectionTotalBalance: money(summary.total_balance || 0),
    collectionOverdueCount: summary.overdue_count || 0,
    collectionOverdueAmount: money(summary.overdue_amount || 0),
    collectionDueTodayCount: summary.due_today_count || 0,
    collectionDueTodayAmount: money(summary.due_today_amount || 0),
    collectionDueSoonCount: summary.due_soon_count || 0,
    collectionDueSoonAmount: money(summary.due_soon_amount || 0)
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
  setNavBadge("navCollectionsBadge", Number(summary.overdue_count || 0) + Number(summary.due_today_count || 0));
}

function collectionSearchText(item) {
  return [
    item.id,
    item.order_reference,
    orderReference(item.order_id),
    collectionCustomerName(item),
    item.customer_email,
    item.phone,
    item.product_name,
    item.installment_no,
    item.collection_status_label,
    item.reminder_message
  ].join(" ").toLowerCase();
}

function getFilteredCollections() {
  const search = document.getElementById("collectionSearch")?.value.toLowerCase() || "";
  const status = document.getElementById("collectionStatusFilter")?.value || "all";
  const sort = document.getElementById("collectionSort")?.value || "due_asc";
  const rows = collectionItems.filter(item => {
    const matchesSearch = collectionSearchText(item).includes(search);
    const itemStatus = item.collection_status || "current";
    const matchesStatus = status === "all" || itemStatus === status;
    return matchesSearch && matchesStatus;
  });

  rows.sort((a, b) => {
    if (sort === "balance_desc") return Number(b.balance || 0) - Number(a.balance || 0);
    if (sort === "customer_asc") return collectionCustomerName(a).localeCompare(collectionCustomerName(b));
    return String(a.due_date || "").localeCompare(String(b.due_date || ""));
  });
  return rows;
}

function renderCollections() {
  renderCollectionSummary();
  const table = document.getElementById("collectionsTable");
  if (!table) return;
  const rows = getFilteredCollections();

  if (!collectionItems.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No collectible installment balances right now.</td></tr>`;
    return;
  }
  if (!rows.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No collections match the current filters.</td></tr>`;
    return;
  }

  table.innerHTML = rows.map(item => {
    const status = item.collection_status || "current";
    const remaining = Number(item.balance || 0);
    return `
      <tr>
        <td><strong>${escapeHtml(formatDate(item.due_date))}</strong><br><small class="text-muted">${escapeHtml(collectionDueText(item))}</small></td>
        <td><strong>${escapeHtml(collectionCustomerName(item))}</strong><br><small class="text-muted">${escapeHtml(item.customer_email || "No email")}</small><br><small class="text-muted">${escapeHtml(item.phone || "No phone")}</small></td>
        <td>${orderLabel(item.order_id)}<br><small class="text-muted">${escapeHtml(item.product_name || "Installment order")}</small></td>
        <td>#${escapeHtml(item.installment_no || "-")}<br><small class="text-muted">Due ${money(item.amount_due)} | Paid ${money(item.amount_paid)}</small></td>
        <td><strong>${money(remaining)}</strong><br><small class="text-muted">${escapeHtml(item.reminder_title || "Reminder ready")}</small></td>
        <td><span class="status-badge ${collectionBadgeClass(status)}">${escapeHtml(collectionStatusLabel(status))}</span></td>
        <td>
          <div class="collection-actions">
            <button class="btn btn-sm btn-dark" onclick="notifyCollectionCustomer(${item.id})">Notify Customer</button>
            <button class="btn btn-sm btn-outline-dark" onclick="recordInstallmentPayment(${item.id}, ${remaining})">Record Payment</button>
            <button class="btn btn-sm btn-outline-dark" onclick="viewInstallmentStatement(${item.order_id})">View SOA</button>
            <button class="btn btn-sm btn-outline-dark" onclick="openCollectionOrder(${item.order_id})">Open Order</button>
            ${item.payment_checkout_id ? `<button class="btn btn-sm btn-outline-dark" onclick="refreshInstallmentSchedulePayment(${item.id})">Check Review</button>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadCollections() {
  if (!isAdminUser()) return;
  const table = document.getElementById("collectionsTable");
  if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Loading collections...</td></tr>`;
  try {
    const res = await fetch(`/admin/collections?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load collections.");
    collectionItems = Array.isArray(data.items) ? data.items : [];
    collectionSummary = data.summary || {};
    renderCollections();
  } catch (error) {
    collectionItems = [];
    collectionSummary = {};
    renderCollectionSummary();
    if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Unable to load collections.</td></tr>`;
  }
}

function clearCollectionFilters() {
  const fields = {
    collectionSearch: "",
    collectionStatusFilter: "all",
    collectionSort: "due_asc"
  };
  Object.entries(fields).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });
  renderCollections();
}

function layawayStatusValue(item) {
  return String(item?.status_label || item?.status || "active").toLowerCase();
}

function layawayStatusLabel(status) {
  const key = String(status || "active").toLowerCase();
  if (LAYAWAY_STATUS_LABELS[key]) return LAYAWAY_STATUS_LABELS[key];
  return key.replace(/_/g, " ").split(" ").filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ") || "Active";
}

function layawayBadgeClass(status) {
  if (["overdue", "cancelled", "payment_failed"].includes(status)) return "cancelled";
  if (["ready_for_release", "released", "delivered"].includes(status)) return "delivered";
  return "processing";
}

function layawayCustomerName(item) {
  return item.customer_name || item.account_name || "Customer";
}

function layawayProductText(item) {
  return `${item.product_name || "Product"}${item.variant_name ? ` / ${item.variant_name}` : ""}`;
}

function layawayDefaultDeadlineDate() {
  const date = new Date();
  const targetDay = date.getDate();
  date.setMonth(date.getMonth() + LAYAWAY_TERM_MONTHS);
  if (date.getDate() < targetDay) date.setDate(0);
  return date.toISOString().slice(0, 10);
}

function setLayawayDefaultDeadline() {
  const input = document.getElementById("layawayDueDate");
  if (input) input.value = layawayDefaultDeadlineDate();
}

function layawayDeadlineText(item) {
  const status = layawayStatusValue(item);
  if (status === "cancelled") return item.cancel_reason || "Cancelled";
  if (status === "released") return "Released";
  if (status === "ready_for_release") return "Fully paid, ready to release";
  if (status === "pending_downpayment") return "Waiting for GCash downpayment";
  if (status === "payment_failed") return "Downpayment not completed";
  const days = Number(item.days_left);
  if (!Number.isFinite(days)) return "5-month deadline";
  if (days <= 0) return "Last day to complete";
  if (days <= 14) return `${days} day${days === 1 ? "" : "s"} left`;
  const months = Math.ceil(days / 30);
  return `${months} month${months === 1 ? "" : "s"} left`;
}
function renderLayawaySummary() {
  const summary = layawaySummary || {};
  const values = {
    layawayActiveCount: summary.active_count || 0,
    layawayOutstandingBalance: money(summary.outstanding_balance || 0),
    layawayOverdueCount: summary.deadline_soon_count || 0,
    layawayReadyReleaseCount: summary.ready_release_count || 0
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
  setNavBadge("navLayawayBadge", Number(summary.deadline_soon_count || 0) + Number(summary.ready_release_count || 0));
}

function layawaySearchText(item) {
  return [
    item.id,
    layawayCustomerName(item),
    item.customer_phone,
    item.customer_email || item.account_email,
    layawayProductText(item),
    item.payment_method,
    item.payment_reference,
    layawayStatusLabel(layawayStatusValue(item)),
    item.note
  ].join(" ").toLowerCase();
}

function getFilteredLayaways() {
  const search = document.getElementById("layawaySearch")?.value.toLowerCase() || "";
  const status = document.getElementById("layawayStatusFilter")?.value || "all";
  return layawayItems.filter(item => {
    const itemStatus = layawayStatusValue(item);
    return (status === "all" || itemStatus === status) && layawaySearchText(item).includes(search);
  });
}

function renderLayaways() {
  renderLayawaySummary();
  const table = document.getElementById("layawayTable");
  if (!table) return;
  const rows = getFilteredLayaways();

  if (!layawayItems.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No layaway reservations yet.</td></tr>`;
    return;
  }
  if (!rows.length) {
    table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No layaways match the current filters.</td></tr>`;
    return;
  }

  table.innerHTML = rows.map(item => {
    const status = layawayStatusValue(item);
    const balance = Number(item.balance || 0);
    const paid = Number(item.amount_paid || 0);
    const actions = [];
    if (["active", "overdue"].includes(status)) {
      actions.push(`<button class="btn btn-sm btn-dark" onclick="recordLayawayPayment(${item.id}, ${balance})">Record Payment</button>`);
      actions.push(`<button class="btn btn-sm btn-outline-dark" onclick="cancelLayaway(${item.id})">Cancel</button>`);
    }
    if (status === "ready_for_release") {
      actions.push(`<button class="btn btn-sm btn-dark" onclick="releaseLayaway(${item.id})">Release Item</button>`);
      actions.push(`<button class="btn btn-sm btn-outline-dark" onclick="cancelLayaway(${item.id})">Cancel</button>`);
    }
    if (status === "pending_downpayment" && usableCheckoutUrl(item)) {
      actions.push(`<a class="btn btn-sm btn-dark" href="${escapeHtml(usableCheckoutUrl(item))}" target="_blank">Open GCash Proof</a>`);
      actions.push(`<button class="btn btn-sm btn-outline-dark" onclick="cancelLayaway(${item.id})">Cancel</button>`);
    }

    const latestPayment = Array.isArray(item.payments) && item.payments.length ? item.payments[0] : null;
    const paymentLine = latestPayment ? `Latest: ${money(latestPayment.amount)} ${latestPayment.payment_method || ""}` : "No payment history yet";
    const deadlineText = layawayDeadlineText(item);
    const statusText = item.deadline_soon && status === "active" ? "Deadline Soon" : layawayStatusLabel(status);
    const statusClass = item.deadline_soon && status === "active" ? "processing" : layawayBadgeClass(status);

    return `
      <tr>
        <td><strong>${escapeHtml(layawayCustomerName(item))}</strong><br><small class="text-muted">${escapeHtml(item.customer_phone || "No phone")}</small><br><small class="text-muted">${escapeHtml(item.customer_email || item.account_email || "No email")}</small></td>
        <td><strong>${escapeHtml(layawayProductText(item))}</strong><br><small class="text-muted">Qty ${Number(item.quantity || 1)} at ${money(item.unit_price)}</small></td>
        <td><strong>${money(item.total_amount)}</strong><br><small class="text-muted">Balance ${money(balance)}</small></td>
        <td><strong>${money(paid)}</strong><br><small class="text-muted">${escapeHtml(paymentLine)}</small></td>
        <td>${item.due_date ? `<strong>${escapeHtml(formatDate(item.due_date))}</strong>` : "<span class='text-muted'>5-month deadline</span>"}<br><small class="text-muted">${escapeHtml(deadlineText)}</small></td>
        <td><span class="status-badge ${statusClass}">${escapeHtml(statusText)}</span></td>
        <td><div class="collection-actions">${actions.length ? actions.join("") : "<span class='text-muted small'>Closed</span>"}</div></td>
      </tr>
    `;
  }).join("");
}

async function loadLayaways() {
  if (!isAdminUser()) return;
  const table = document.getElementById("layawayTable");
  if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Loading layaways...</td></tr>`;
  try {
    const res = await fetch(`/admin/layaways?${actorQueryString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to load layaways.");
    layawayItems = Array.isArray(data.items) ? data.items : [];
    layawaySummary = data.summary || {};
    renderLayaways();
  } catch (error) {
    layawayItems = [];
    layawaySummary = {};
    renderLayawaySummary();
    if (table) table.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Unable to load layaways.</td></tr>`;
  }
}

function clearLayawayFilters() {
  const search = document.getElementById("layawaySearch");
  const status = document.getElementById("layawayStatusFilter");
  if (search) search.value = "";
  if (status) status.value = "all";
  renderLayaways();
}

function renderLayawayCustomerOptions() {
  const select = document.getElementById("layawayCustomerId");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Walk-in / manual customer</option>` + allCustomers.map(customer => `<option value="${customer.id}">${escapeHtml(customer.name || customer.email || `Customer #${customer.id}`)}</option>`).join("");
  select.value = current;
}

function syncLayawayCustomerFields() {
  const id = Number(document.getElementById("layawayCustomerId")?.value || 0);
  const customer = allCustomers.find(item => Number(item.id) === id);
  if (!customer) return;
  const fields = {
    layawayCustomerName: customer.name || "",
    layawayCustomerPhone: customer.phone || "",
    layawayCustomerEmail: customer.email || ""
  };
  Object.entries(fields).forEach(([fieldId, value]) => {
    const element = document.getElementById(fieldId);
    if (element) element.value = value;
  });
}

function renderLayawayProductOptions() {
  const select = document.getElementById("layawayProductId");
  if (!select) return;
  const current = select.value;
  const eligibleProducts = allProducts.filter(productLayawayEnabled);
  select.innerHTML = `<option value="">Select layaway product</option>` + eligibleProducts.map(product => {
    const settings = productLayawaySettings(product);
    return `<option value="${product.id}">${escapeHtml(product.name)} - ${money(product.price)} (${Number(product.stock || 0)} stock, max ${settings.maxQuantity})</option>`;
  }).join("");
  select.value = eligibleProducts.some(product => String(product.id) === String(current)) ? current : "";
  renderLayawayVariantOptions();
}

function selectedLayawayProduct() {
  const productId = Number(document.getElementById("layawayProductId")?.value || 0);
  return allProducts.find(product => Number(product.id) === productId) || null;
}

function selectedLayawayVariant() {
  const product = selectedLayawayProduct();
  if (!product) return null;
  const variants = productVariants(product);
  const rawIndex = document.getElementById("layawayVariantIndex")?.value;
  if (rawIndex === "" || rawIndex === undefined) return null;
  const index = Number(rawIndex);
  return Number.isInteger(index) && variants[index] ? { ...variants[index], index } : null;
}

function renderLayawayVariantOptions() {
  const select = document.getElementById("layawayVariantIndex");
  if (!select) return;
  const product = selectedLayawayProduct();
  const variants = product ? productVariants(product) : [];
  const current = select.value;
  if (!variants.length) {
    select.innerHTML = `<option value="">Default</option>`;
    select.value = "";
    return;
  }
  select.innerHTML = `<option value="">Select variant</option>` + variants.map((variant, index) => {
    const stock = Number(variant.stock || 0);
    const disabled = stock <= 0 ? "disabled" : "";
    return `<option value="${index}" ${disabled}>${escapeHtml(variant.name || `Variant ${index + 1}`)} - ${money(variant.price)} (${stock} stock)</option>`;
  }).join("");
  select.value = Array.from(select.options).some(option => option.value === current && !option.disabled) ? current : "";
}

function updateLayawayEstimate() {
  const product = selectedLayawayProduct();
  const variant = selectedLayawayVariant();
  const settings = product ? productLayawaySettings(product) : { maxQuantity: 1 };
  const quantityInput = document.getElementById("layawayQuantity");
  if (quantityInput && product) quantityInput.max = settings.maxQuantity;
  let quantity = Math.max(Number(quantityInput?.value || 1), 1);
  if (product && quantity > settings.maxQuantity) {
    quantity = settings.maxQuantity;
    if (quantityInput) quantityInput.value = settings.maxQuantity;
  }
  const downpayment = Math.max(Number(document.getElementById("layawayDownpayment")?.value || 0), 0);
  const unitPrice = product ? Number(variant ? variant.price : product.price || 0) : 0;
  const total = unitPrice * quantity;
  const balance = Math.max(total - downpayment, 0);
  const values = {
    layawayUnitPriceText: money(unitPrice),
    layawayTotalText: money(total),
    layawayBalanceText: money(balance)
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.innerText = value;
  });
}

function clearLayawayForm() {
  ["layawayCustomerName", "layawayCustomerPhone", "layawayCustomerEmail", "layawayPaymentReference", "layawayNote", "layawayDueDate"].forEach(id => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });
  const defaults = {
    layawayCustomerId: "",
    layawayProductId: "",
    layawayVariantIndex: "",
    layawayQuantity: "1",
    layawayDownpayment: "0",
    layawayPaymentMethod: "cash"
  };
  Object.entries(defaults).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });
  renderLayawayVariantOptions();
  setLayawayDefaultDeadline();
  updateLayawayEstimate();
  const message = document.getElementById("layawayFormMessage");
  if (message) message.innerText = "";
}

function layawayPayload() {
  const product = selectedLayawayProduct();
  if (!product) throw new Error("Select a product for this layaway.");
  if (!productLayawayEnabled(product)) throw new Error("This product is not enabled for layaway.");
  const settings = productLayawaySettings(product);
  const variants = productVariants(product);
  const variantIndex = document.getElementById("layawayVariantIndex")?.value || "";
  if (variants.length && variantIndex === "") throw new Error("Select a variant for this layaway.");
  const quantity = Math.max(Number(document.getElementById("layawayQuantity")?.value || 1), 1);
  if (quantity > settings.maxQuantity) throw new Error(`Layaway for this product is limited to ${settings.maxQuantity} item(s).`);
  const downpayment = Math.max(Number(document.getElementById("layawayDownpayment")?.value || 0), 0);
  return {
    customer_id: document.getElementById("layawayCustomerId")?.value || null,
    customer_name: document.getElementById("layawayCustomerName")?.value || "",
    customer_phone: document.getElementById("layawayCustomerPhone")?.value || "",
    customer_email: document.getElementById("layawayCustomerEmail")?.value || "",
    product_id: product.id,
    variant_index: variantIndex,
    quantity,
    downpayment_amount: downpayment,
    due_date: document.getElementById("layawayDueDate")?.value || null,
    payment_method: document.getElementById("layawayPaymentMethod")?.value || "cash",
    payment_reference: document.getElementById("layawayPaymentReference")?.value || "",
    note: document.getElementById("layawayNote")?.value || ""
  };
}

async function createLayaway() {
  if (!requireAdminAction("Only admin can create layaway reservations.")) return;
  const message = document.getElementById("layawayFormMessage");
  try {
    const payload = layawayPayload();
    if (message) message.innerText = "Creating layaway...";
    const res = await fetch("/admin/layaways", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, ...actorPayload() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Unable to create layaway.");
    const successText = `Layaway created. 5-month deadline: ${data.due_date || "set"}. Balance: ${money(data.balance)}`;
    clearLayawayForm();
    if (message) message.innerText = successText;
    await loadProducts();
    await loadLayaways();
    await loadInventoryMovements();
    await loadAuditLogs();
  } catch (error) {
    if (message) message.innerText = error.message || "Unable to create layaway.";
    else alert(error.message || "Unable to create layaway.");
  }
}

async function recordLayawayPayment(id, balance) {
  if (!requireAdminAction("Only admin can record layaway payments.")) return;
  const values = await AppDialog.form({
    eyebrow: "Layaway collection",
    title: "Record layaway payment",
    message: "Enter the payment details exactly as shown on the receipt or transaction record.",
    details: [
      { label: "Layaway", value: `#${id}` },
      { label: "Remaining balance", value: money(balance) }
    ],
    fields: [
      { name: "amount", label: "Payment amount", type: "number", required: true, min: "0.01", max: Number(balance || 0), step: "0.01", defaultValue: Number(balance || 0).toFixed(2) },
      { name: "method", label: "Payment method", type: "select", required: true, options: [{ value: "cash", label: "Cash" }, { value: "gcash", label: "GCash" }] },
      { name: "reference", label: "Receipt / reference number", type: "text", placeholder: "Optional for cash payments" }
    ],
    submitText: "Record Payment"
  });
  if (!values) return;
  const amount = Number(values.amount);
  const method = values.method;
  const reference = values.reference.trim();
  try {
    const res = await fetch(`/admin/layaways/${id}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, payment_method: method, payment_reference: reference, ...actorPayload() })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Unable to record payment.");
    alert(`${data.message || "Payment recorded."} Balance: ${money(data.balance)}`);
    await loadLayaways();
    await loadAuditLogs();
  } catch (error) {
    alert(error.message || "Unable to record payment.");
  }
}

async function releaseLayaway(id) {
  if (!requireAdminAction("Only admin can release layaway items.")) return;
  const confirmed = await AppDialog.confirm({
    eyebrow: "Layaway release",
    title: "Release reserved item?",
    message: "Confirm that the layaway is fully paid and the item is ready to be released to the customer.",
    details: [{ label: "Layaway", value: `#${id}` }],
    confirmText: "Release Item"
  });
  if (!confirmed) return;
  try {
    const res = await fetch(`/admin/layaways/${id}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorPayload())
    });
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Unable to release layaway.");
    alert(data.message || "Layaway released.");
    await loadLayaways();
    await loadAuditLogs();
  } catch (error) {
    alert(error.message || "Unable to release layaway.");
  }
}

async function cancelLayaway(id) {
  if (!requireAdminAction("Only admin can cancel layaways.")) return;
  const values = await AppDialog.form({
    eyebrow: "Layaway cancellation",
    title: "Cancel layaway?",
    message: "Reserved stock will be restored after the cancellation is completed.",
    details: [{ label: "Layaway", value: `#${id}` }],
    fields: [{ name: "reason", label: "Cancellation reason", type: "textarea", required: true, defaultValue: "Customer cancelled / reservation expired" }],
    submitText: "Cancel Layaway",
    tone: "danger"
  });
  if (!values) return;
  const reason = values.reason.trim();
  try {
    const res = await fetch(`/admin/layaways/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, ...actorPayload() })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Unable to cancel layaway.");
    alert(`${data.message || "Layaway cancelled."} Restored: ${data.restored_quantity || 0}`);
    await loadProducts();
    await loadLayaways();
    await loadInventoryMovements();
    await loadAuditLogs();
  } catch (error) {
    alert(error.message || "Unable to cancel layaway.");
  }
}

function exportLayawaysCsv() {
  const rows = getFilteredLayaways();
  if (!rows.length) {
    alert("No layaways to export.");
    return;
  }
  const csvRows = [
    ["Layaway ID", "Customer", "Phone", "Email", "Product", "Variant", "Quantity", "Unit Price", "Total", "Paid", "Balance", "Due Date", "Status", "Created By"],
    ...rows.map(item => [
      item.id || "",
      layawayCustomerName(item),
      item.customer_phone || "",
      item.customer_email || item.account_email || "",
      item.product_name || "",
      item.variant_name || "",
      item.quantity || 1,
      Number(item.unit_price || 0).toFixed(2),
      Number(item.total_amount || 0).toFixed(2),
      Number(item.amount_paid || 0).toFixed(2),
      Number(item.balance || 0).toFixed(2),
      item.due_date ? String(item.due_date).slice(0, 10) : "",
      layawayStatusLabel(layawayStatusValue(item)),
      item.created_by_name || ""
    ])
  ];
  const csv = csvRows.map(row => row.map(csvCell).join(",")).join(String.fromCharCode(10));
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `layaway-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function prepareLayawayForm() {
  renderLayawayCustomerOptions();
  renderLayawayProductOptions();
  setLayawayDefaultDeadline();
  updateLayawayEstimate();
}
async function notifyCollectionCustomer(scheduleId) {
  if (!requireAdminAction("Only admin can send installment reminders.")) return;
  const item = collectionItems.find(row => Number(row.id) === Number(scheduleId));
  const label = item ? `${collectionCustomerName(item)} for ${orderLabel(item.order_id)}` : "this customer";
  const confirmed = await AppDialog.confirm({
    eyebrow: "Customer reminder",
    title: "Send installment reminder?",
    message: "The customer will receive a notification about the payment schedule.",
    details: [{ label: "Recipient", value: label }],
    confirmText: "Send Reminder"
  });
  if (!confirmed) return;
  try {
    const res = await fetch(`/admin/collections/schedules/${scheduleId}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(actorPayload())
    });
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Unable to send reminder.");
    alert(data.message || (data.duplicate ? "Reminder already sent today." : "Reminder sent."));
    await loadCollections();
    await loadLayaways();
    await loadAdminAlerts();
  } catch (error) {
    alert(error.message || "Unable to send reminder.");
  }
}

async function sendBulkCollectionReminders(status = "actionable") {
  if (!requireAdminAction("Only admin can send bulk installment reminders.")) return;
  const confirmed = await AppDialog.confirm({
    eyebrow: "Bulk notification",
    title: "Send all payment reminders?",
    message: "Notifications will be sent to customers with due, due soon, and overdue installment schedules.",
    details: [{ label: "Reminder group", value: status === "actionable" ? "Due, due soon, and overdue" : status }],
    confirmText: "Send All Reminders"
  });
  if (!confirmed) return;
  try {
    const res = await fetch("/admin/collections/notify-due", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, ...actorPayload() })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.message || "Unable to send reminders.");
    alert(`Reminder run complete. Sent: ${data.sent || 0}. Skipped today: ${data.skipped || 0}. Failed: ${data.failed || 0}.`);
    await loadCollections();
    await loadLayaways();
    await loadAdminAlerts();
  } catch (error) {
    alert(error.message || "Unable to send reminders.");
  }
}

async function openCollectionOrder(orderId) {
  await showSection("orders");
  viewOrder(Number(orderId));
}

function exportCollectionsCsv() {
  const rows = getFilteredCollections();
  if (!rows.length) {
    alert("No collections to export.");
    return;
  }
  const csvRows = [
    ["Schedule ID", "Order ID", "Customer", "Email", "Phone", "Product", "Installment", "Due Date", "Amount Due", "Amount Paid", "Balance", "Status", "Reminder Message"],
    ...rows.map(item => [
      item.id || "",
      orderReference(item.order_id),
      collectionCustomerName(item),
      item.customer_email || "",
      item.phone || "",
      item.product_name || "",
      item.installment_no || "",
      item.due_date ? String(item.due_date).slice(0, 10) : "",
      Number(item.amount_due || 0).toFixed(2),
      Number(item.amount_paid || 0).toFixed(2),
      Number(item.balance || 0).toFixed(2),
      collectionStatusLabel(item.collection_status),
      item.reminder_message || ""
    ])
  ];
  const csv = csvRows.map(row => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `collections-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
async function getFinanceData() {
  const res = await fetch(`/admin/finance?${actorQueryString()}`);
  const result = await res.json();
  if (!res.ok) throw new Error(result.message || "Unable to load finance data.");
  return result.data || {};
}

async function exportFinanceCsv() {
  try {
    const data = await getFinanceData();
    const rows = [
      ["Metric", "Value"],
      ["Users", data.total_users || 0],
      ["Orders", data.total_orders || 0],
      ["Paid Sales", Number(data.paid_sales || 0).toFixed(2)],
      ["Pending GCash Verification", Number(data.pending_online_amount || 0).toFixed(2)],
      ["COD To Collect", Number(data.cod_to_collect_amount || 0).toFixed(2)],
      ["Overdue Count", data.overdue_count || 0],
      ["Overdue Amount", Number(data.overdue_amount || 0).toFixed(2)],
      ["Installment Active Amount", Number(data.installment_active_amount || 0).toFixed(2)],
      ["Installment Unpaid Amount", Number(data.installment_unpaid_amount || 0).toFixed(2)],
      ["Installment Due This Month", data.installment_due_this_month || 0],
      ["Installment Overdue Amount", Number(data.installment_overdue_amount || 0).toFixed(2)],
      ["Payment Failed Count", data.payment_failed_count || 0]
    ];
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finance-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message || "Unable to export finance report.");
  }
}
async function loadFinance() {
  try {
    const res = await fetch(`/admin/finance?${actorQueryString()}`);
    const result = await res.json();
    const data = result.data || {};

    document.getElementById("financeUsers").innerText = data.total_users || 0;
    document.getElementById("financeOrders").innerText = data.total_orders || 0;
    document.getElementById("financeOverdue").innerText = data.overdue_count || 0;
    document.getElementById("financeOverdueAmount").innerText = money(data.overdue_amount || 0);
    document.getElementById("financePaidSales").innerText = money(data.paid_sales || 0);
    document.getElementById("financePendingOnline").innerText = money(data.pending_online_amount || 0);
    document.getElementById("financeCodCollect").innerText = money(data.cod_to_collect_amount || 0);
    document.getElementById("financeInstallmentActive").innerText = money(data.installment_active_amount || 0);
    document.getElementById("financeInstallmentUnpaid").innerText = money(data.installment_unpaid_amount || 0);
    document.getElementById("financeInstallmentDue").innerText = data.installment_due_this_month || 0;
    document.getElementById("financeInstallmentOverdue").innerText = money(data.installment_overdue_amount || 0);
    document.getElementById("financePaymentFailed").innerText = data.payment_failed_count || 0;
  } catch (error) {
    document.getElementById("financeOverdueAmount").innerText = "₱0.00";
    document.getElementById("financePaidSales").innerText = "₱0.00";
    document.getElementById("financePendingOnline").innerText = "₱0.00";
    document.getElementById("financeCodCollect").innerText = "₱0.00";
    document.getElementById("financeInstallmentActive").innerText = "₱0.00";
    document.getElementById("financeInstallmentUnpaid").innerText = "₱0.00";
    document.getElementById("financeInstallmentDue").innerText = "0";
    document.getElementById("financeInstallmentOverdue").innerText = "₱0.00";
    document.getElementById("financePaymentFailed").innerText = "0";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initializeModals();
  if (!await window.AdminSecurity.ready()) return;
  if (!applyRoleAccess()) return;
  const todayLabel = document.getElementById("overviewTodayLabel");
  if (todayLabel) todayLabel.innerText = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  document.getElementById("image").addEventListener("change", handleImageSelection);
  refreshAll();
  renderCart();
});
