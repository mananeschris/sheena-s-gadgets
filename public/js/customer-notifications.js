(function () {
  var notifications = [];
  var refreshTimer = null;

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
    if (type.indexOf("payment") >= 0 || text.indexOf("payment") >= 0 || text.indexOf("paymongo") >= 0 || text.indexOf("paid") >= 0) return "Payment";
    if (type.indexOf("order") >= 0 || text.indexOf("order id") >= 0) return "Order";
    return "Update";
  }

  function notificationActionLabel(item) {
    var bucket = notificationBucket(item);
    var url = normalizeNotificationUrl(item.action_url || "");
    if (url.indexOf("/customer/order.html") >= 0 || ["Order", "Payment", "Installment", "Repair"].indexOf(bucket) >= 0) return "View Order";
    return "Open";
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
    var unread = notifications.filter(function (item) { return !Number(item.is_read); }).length;
    setBadge(unread);
    if (!list) return;

    if (!notifications.length) {
      list.innerHTML = '<div class="notification-empty">No notifications yet.</div>';
      return;
    }

    list.innerHTML = notifications.map(function (item) {
      var unreadClass = Number(item.is_read) ? "" : " unread";
      var actionUrl = normalizeNotificationUrl(item.action_url || "");
      var encodedUrl = encodeURIComponent(actionUrl);
      var action = actionUrl
        ? '<button type="button" class="btn btn-sm btn-dark" onclick="openCustomerNotification(' + Number(item.id) + ', \'' + encodedUrl + '\')">' + escapeHtml(notificationActionLabel(item)) + '</button>'
        : '';
      var markRead = Number(item.is_read) ? '' : '<button type="button" class="btn btn-sm btn-outline-dark" onclick="markNotificationRead(' + Number(item.id) + ')">Mark read</button>';
      var cardClick = actionUrl ? ' onclick="openCustomerNotification(' + Number(item.id) + ', \'' + encodedUrl + '\')"' : '';
      return '<article class="notification-item customer-notification-item' + unreadClass + (actionUrl ? ' clickable' : '') + '"' + cardClick + '>' +
        '<div class="notification-meta"><span class="notification-type">' + escapeHtml(notificationBucket(item)) + '</span><span>' + escapeHtml(formatDate(item.created_at)) + '</span><span>' + (Number(item.is_read) ? 'Read' : 'Unread') + '</span></div>' +
        '<strong>' + escapeHtml(item.title || 'Notification') + '</strong>' +
        '<p>' + escapeHtml(item.message || '') + '</p>' +
        '<div class="notification-row-actions" onclick="event.stopPropagation()">' + action + markRead + '</div>' +
      '</article>';
    }).join("");
  }

  async function loadCustomerNotifications() {
    var user = currentCustomer();
    if (!user) {
      setBadge(0);
      return;
    }
    try {
      var res = await fetch("/notifications/customer/" + user.id);
      var data = await res.json();
      notifications = Array.isArray(data) ? data : [];
      renderNotifications();
    } catch (error) {
      renderNotifications();
    }
  }

  window.toggleNotifications = function () {
    var panel = document.getElementById("notificationPanel");
    if (!panel) return;
    panel.classList.toggle("d-none");
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
})();
