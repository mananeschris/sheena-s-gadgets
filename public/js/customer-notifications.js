(function () {
  var notifications = [];
  var refreshTimer = null;
  var activeFilter = "all";

  function initializeNotificationPanel() {
    var panel = document.getElementById("notificationPanel");
    if (!panel) return;
    panel.innerHTML = '<div class="notification-head"><div class="notification-heading"><span class="notification-kicker">CUSTOMER ACCOUNT</span><h2>Notifications</h2><span id="notificationSummary" class="notification-summary">Loading updates...</span></div>' +
      '<button type="button" class="notification-close" aria-label="Close notifications" title="Close notifications" onclick="closeCustomerNotifications()"><i data-lucide="x" aria-hidden="true"></i></button>' +
      '<div class="notification-actions"><button id="markAllNotificationsButton" type="button" onclick="markAllNotificationsRead()"><i data-lucide="check-check" aria-hidden="true"></i><span>Mark all read</span></button>' +
      '<button id="clearReadNotificationsButton" type="button" onclick="clearReadNotifications()"><i data-lucide="trash-2" aria-hidden="true"></i><span>Clear read</span></button></div></div>' +
      '<div class="notification-filters" role="group" aria-label="Filter notifications"><button type="button" class="active" data-notification-filter="all" aria-pressed="true" onclick="setNotificationFilter(\'all\')">All <span id="notificationAllCount">0</span></button>' +
      '<button type="button" data-notification-filter="unread" aria-pressed="false" onclick="setNotificationFilter(\'unread\')">Unread <span id="notificationUnreadCount">0</span></button></div>' +
      '<div id="notificationList" class="notification-list" aria-live="polite">Loading notifications...</div>';
    var button = document.getElementById("notificationButton");
    if (button) {
      button.setAttribute("aria-controls", "notificationPanel");
      button.setAttribute("aria-expanded", "false");
    }
    if (window.lucide) window.lucide.createIcons();
  }

  window.closeCustomerNotifications = function (restoreFocus) {
    var panel = document.getElementById("notificationPanel");
    if (!panel || panel.classList.contains("d-none")) return;
    panel.classList.add("d-none");
    var button = document.getElementById("notificationButton");
    if (button) {
      button.setAttribute("aria-expanded", "false");
      if (restoreFocus !== false) button.focus();
    }
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function currentCustomer() {
    try {
      var user = JSON.parse(localStorage.getItem("currentUser") || "null");
      if (!user) return null;
      user.role = String(user.role || "customer").toLowerCase();
      return user.role === "customer" ? user : null;
    } catch (error) {
      localStorage.removeItem("currentUser");
      return null;
    }
  }

  function formatDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function normalizeNotificationUrl(rawUrl) {
    if (!rawUrl) return "";
    try {
      var url = new URL(rawUrl, window.location.origin);
      var orderId = url.searchParams.get("order_id") || url.searchParams.get("order");
      if (orderId && (url.pathname.indexOf("/customer/profile.html") >= 0 || url.pathname.indexOf("/customer/order.html") >= 0)) {
        return "/customer/order.html?order_id=" + encodeURIComponent(orderId);
      }
      if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
      return url.toString();
    } catch (error) {
      return rawUrl;
    }
  }

  function notificationBucket(item) {
    var type = String(item.type || "info").toLowerCase();
    var text = String((item.title || "") + " " + (item.message || "")).toLowerCase();
    if (type.indexOf("installment") >= 0 || text.indexOf("installment") >= 0) return "Installment";
    if (type.indexOf("repair") >= 0 || text.indexOf("repair") >= 0 || text.indexOf("warranty") >= 0) return "Repair";
    if (type.indexOf("payment") >= 0 || text.indexOf("payment") >= 0 || text.indexOf("gcash") >= 0 || text.indexOf("paid") >= 0) return "Payment";
    if (type.indexOf("order") >= 0 || text.indexOf("order id") >= 0) return "Order";
    return "Update";
  }

  function notificationIcon(item) {
    var icons = {
      order: "package-check",
      payment: "wallet-cards",
      installment: "calendar-clock",
      repair: "wrench",
      update: "bell-ring"
    };
    return icons[notificationBucket(item).toLowerCase()] || "bell";
  }

  function notificationActionLabel(item) {
    var bucket = notificationBucket(item);
    var url = normalizeNotificationUrl(item.action_url || "");
    if (url.indexOf("/customer/order.html") >= 0 || ["Order", "Payment", "Installment", "Repair"].indexOf(bucket) >= 0) return "View Order";
    return "Open update";
  }

  function customerNotificationText(value, item) {
    var text = String(value || "");
    if (!item.order_product_name) return text;
    return text.replace(/\b(?:Order\s*(?:ID|#|number)?\s*[:#-]?|ORD[-#])\s*\d{1,10}\b/gi, function () { return item.order_product_name; });
  }

  function notificationEventTitle(item) {
    var title = customerNotificationText(item.title || "Notification", item);
    var productName = String(item.order_product_name || "");
    if (productName && title.toLowerCase().indexOf(productName.toLowerCase()) === 0) {
      title = title.slice(productName.length).replace(/^[\s:|\-]+/, "");
    }
    return title || "Order update";
  }

  function setBadge(unread) {
    var count = document.getElementById("notificationCount");
    var button = document.getElementById("notificationButton");
    if (count) {
      count.innerText = unread;
      count.classList.toggle("d-none", unread === 0);
    }
    if (button) {
      button.classList.toggle("has-unread", unread > 0);
      button.setAttribute("aria-label", unread ? unread + " unread notifications" : "No unread notifications");
    }
  }

  function renderNotifications() {
    var list = document.getElementById("notificationList");
    var summary = document.getElementById("notificationSummary");
    var allCount = document.getElementById("notificationAllCount");
    var unreadCount = document.getElementById("notificationUnreadCount");
    var markAllButton = document.getElementById("markAllNotificationsButton");
    var clearReadButton = document.getElementById("clearReadNotificationsButton");
    var unread = notifications.filter(function (item) { return !Number(item.is_read); }).length;
    var visible = activeFilter === "unread"
      ? notifications.filter(function (item) { return !Number(item.is_read); })
      : notifications;

    setBadge(unread);
    if (!list) return;

    if (summary) summary.innerText = unread ? unread + " unread of " + notifications.length : "You are all caught up";
    if (allCount) allCount.innerText = notifications.length;
    if (unreadCount) unreadCount.innerText = unread;
    if (markAllButton) markAllButton.disabled = unread === 0;
    if (clearReadButton) clearReadButton.disabled = notifications.length === unread;
    document.querySelectorAll("[data-notification-filter]").forEach(function (button) {
      var active = button.dataset.notificationFilter === activeFilter;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (!notifications.length) {
      list.innerHTML = '<div class="notification-empty"><i data-lucide="bell-off" aria-hidden="true"></i><strong>You are all caught up</strong><span>Order and payment updates will appear here.</span></div>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (!visible.length) {
      list.innerHTML = '<div class="notification-empty"><i data-lucide="check-check" aria-hidden="true"></i><strong>No unread notifications</strong><span>You have read all your latest updates.</span></div>';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    list.innerHTML = visible.map(function (item) {
      var unreadClass = Number(item.is_read) ? "" : " unread";
      var actionUrl = normalizeNotificationUrl(item.action_url || "");
      var encodedUrl = encodeURIComponent(actionUrl);
      var action = actionUrl
        ? '<button type="button" class="notification-action" onclick="openCustomerNotification(' + Number(item.id) + ', \'' + encodedUrl + '\')"><i data-lucide="arrow-up-right" aria-hidden="true"></i><span>' + escapeHtml(notificationActionLabel(item)) + '</span></button>'
        : "";
      var markRead = Number(item.is_read)
        ? ""
        : '<button type="button" class="notification-mark-read" onclick="markNotificationRead(' + Number(item.id) + ')"><i data-lucide="check" aria-hidden="true"></i><span>Mark read</span></button>';
      var cardClick = actionUrl ? ' onclick="openCustomerNotification(' + Number(item.id) + ', \'' + encodedUrl + '\')"' : "";
      var unreadDot = Number(item.is_read) ? "" : '<span class="notification-unread-dot" aria-label="Unread"></span>';
      var createdAt = item.created_at || "";

      return '<article class="notification-item customer-notification-item notification-' + notificationBucket(item).toLowerCase() + unreadClass + (actionUrl ? ' clickable' : '') + '"' + cardClick + '>' +
        (item.order_product_image
          ? '<img class="notification-product-image" src="' + escapeHtml(item.order_product_image) + '" alt="' + escapeHtml(item.order_product_name || "Ordered product") + '" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">' +
            '<span class="notification-icon" hidden><i data-lucide="' + notificationIcon(item) + '" aria-hidden="true"></i></span>'
          : '<span class="notification-icon"><i data-lucide="' + notificationIcon(item) + '" aria-hidden="true"></i></span>') +
        '<div class="notification-content">' +
          '<div class="notification-meta"><span class="notification-type">' + escapeHtml(notificationBucket(item)) + '</span><time datetime="' + escapeHtml(createdAt) + '">' + escapeHtml(formatDate(createdAt)) + '</time>' + unreadDot + '</div>' +
          (item.order_product_name ? '<strong class="notification-product-name">' + escapeHtml(item.order_product_name) + '</strong>' : '') +
          '<strong>' + escapeHtml(notificationEventTitle(item)) + '</strong>' +
          '<p>' + escapeHtml(customerNotificationText(item.message || "There is an update to your account.", item)) + '</p>' +
          '<div class="notification-row-actions" onclick="event.stopPropagation()">' + action + markRead + '</div>' +
        '</div>' +
      '</article>';
    }).join("");

    if (window.lucide) window.lucide.createIcons();
  }

  window.setNotificationFilter = function (filter) {
    activeFilter = filter === "unread" ? "unread" : "all";
    renderNotifications();
  };

  async function loadCustomerNotifications() {
    var user = currentCustomer();
    if (!user) {
      notifications = [];
      setBadge(0);
      renderNotifications();
      return;
    }
    try {
      var res = await fetch("/notifications/customer/" + user.id);
      if (!res.ok) throw new Error("Notifications could not be loaded.");
      var data = await res.json();
      notifications = Array.isArray(data) ? data : [];
      renderNotifications();
    } catch (error) {
      var list = document.getElementById("notificationList");
      if (list) list.innerHTML = '<div class="notification-empty"><strong>Could not load notifications</strong><button type="button" onclick="loadCustomerNotifications()">Try again</button></div>';
    }
  }

  window.toggleNotifications = function () {
    var panel = document.getElementById("notificationPanel");
    if (!panel) return;
    if (!panel.classList.contains("d-none")) {
      window.closeCustomerNotifications();
      return;
    }
    if (!currentCustomer()) return;
    if (window.closeCart) window.closeCart(false);
    panel.classList.remove("d-none");
    document.getElementById("notificationButton")?.setAttribute("aria-expanded", "true");
    panel.querySelector(".notification-close")?.focus();
    loadCustomerNotifications();
  };

  window.openCustomerNotification = async function (id, encodedUrl) {
    await fetch("/notifications/" + id + "/read", { method: "PUT" });
    var url = decodeURIComponent(encodedUrl || "");
    if (url) window.location.href = url;
  };

  window.markNotificationRead = async function (id) {
    await fetch("/notifications/" + id + "/read", { method: "PUT" });
    await loadCustomerNotifications();
  };

  window.markAllNotificationsRead = async function () {
    var user = currentCustomer();
    if (!user) return;
    await fetch("/notifications/customer/" + user.id + "/read-all", { method: "PUT" });
    await loadCustomerNotifications();
  };

  window.clearReadNotifications = async function () {
    var user = currentCustomer();
    if (!user) return;
    await fetch("/notifications/customer/" + user.id + "/read", { method: "DELETE" });
    await loadCustomerNotifications();
  };

  window.loadCustomerNotifications = loadCustomerNotifications;

  document.addEventListener("DOMContentLoaded", function () {
    initializeNotificationPanel();
    var user = currentCustomer();
    var button = document.getElementById("notificationButton");
    if (!button) return;
    if (!user) {
      button.classList.add("d-none");
      setBadge(0);
      return;
    }
    button.classList.remove("d-none");
    loadCustomerNotifications();
    if (!refreshTimer) refreshTimer = setInterval(loadCustomerNotifications, 30000);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") window.closeCustomerNotifications();
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest("#notificationPanel, #notificationButton")) window.closeCustomerNotifications(false);
  }, true);
})();
