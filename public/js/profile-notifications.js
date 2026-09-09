(function () {
  window.notificationFilter = window.notificationFilter ? window.notificationFilter : "all"

  window.notificationBucket = function (item) {
    var type = String(item.type ? item.type : "info").toLowerCase()
    var title = item.title ? item.title : ""
    var message = item.message ? item.message : ""
    var text = String(title + " " + message).toLowerCase()
    if (type.includes("installment")) return "installment"
    if (text.includes("installment")) return "installment"
    if (type.includes("repair")) return "repair"
    if (text.includes("repair")) return "repair"
    if (text.includes("warranty")) return "repair"
    if (type.includes("payment")) return "payment"
    if (text.includes("payment")) return "payment"
    if (text.includes("paymongo")) return "payment"
    if (text.includes("paid")) return "payment"
    if (type.includes("order")) return "order"
    if (text.includes("order #") || text.includes("order id")) return "order"
    return "info"
  }

  window.notificationTypeLabel = function (item) {
    var bucket = window.notificationBucket(item)
    var labels = {
      order: "Order",
      payment: "Payment",
      installment: "Installment",
      repair: "Repair",
      info: "Update"
    }
    return labels[bucket] ? labels[bucket] : "Update"
  }

  window.filteredNotifications = function () {
    var filter = window.notificationFilter ? window.notificationFilter : "all"
    if (filter === "unread") {
      return notifications.filter(function (item) {
        return !Number(item.is_read)
      })
    }
    if (filter === "all") return notifications
    return notifications.filter(function (item) {
      return window.notificationBucket(item) === filter
    })
  }

  window.setNotificationFilter = function (filter) {
    window.notificationFilter = filter
    document.querySelectorAll("[data-notification-filter]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.notificationFilter === filter)
    })
    renderNotifications()
  }

  window.renderNotificationSummary = function () {
    var unread = notifications.filter(function (item) {
      return !Number(item.is_read)
    }).length
    var badge = document.getElementById("notificationUnreadBadge")
    var summary = document.getElementById("notificationSummaryText")
    if (badge) badge.innerText = unread
    var sideBadge = document.getElementById("notificationCount")
    var sideButton = document.getElementById("notificationButton")
    if (sideBadge) {
      sideBadge.innerText = unread
      sideBadge.classList.toggle("d-none", unread === 0)
    }
    if (sideButton) sideButton.classList.toggle("has-unread", unread > 0)
    if (summary) summary.innerText = unread ? unread + " unread update" + (unread === 1 ? "" : "s") : "No unread updates"
  }
  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild)
  }

  function emptyState(text) {
    var empty = document.createElement("div")
    empty.className = "empty-state"
    empty.innerText = text
    return empty
  }


  function normalizeNotificationUrl(rawUrl) {
    if (!rawUrl) return ""
    try {
      var url = new URL(rawUrl, window.location.origin)
      var orderId = url.searchParams.get("order_id") || url.searchParams.get("order")
      if (orderId && (url.pathname.indexOf("/customer/profile.html") >= 0 || url.pathname.indexOf("/customer/order.html") >= 0)) {
        return "/customer/order.html?order_id=" + encodeURIComponent(orderId)
      }
      if (url.origin === window.location.origin) return url.pathname + url.search + url.hash
      return url.toString()
    } catch (error) {
      return rawUrl
    }
  }

  function notificationActionLabel(item) {
    var url = normalizeNotificationUrl(item.action_url ? item.action_url : "")
    var bucket = window.notificationBucket(item)
    if (url.indexOf("/customer/order.html") >= 0 || ["order", "payment", "installment", "repair"].indexOf(bucket) >= 0) return "View Order"
    return "Open"
  }
  function smallButton(label, className, handler) {
    var button = document.createElement("button")
    button.className = className
    button.type = "button"
    button.innerText = label
    button.addEventListener("click", handler)
    return button
  }

  window.renderNotifications = function () {
    var container = document.getElementById("profileNotifications")
    window.renderNotificationSummary()
    if (!container) return
    clearElement(container)

    if (!notifications.length) {
      container.appendChild(emptyState("No notifications yet."))
      return
    }

    var visible = window.filteredNotifications()
    if (!visible.length) {
      container.appendChild(emptyState("No notifications for this filter."))
      return
    }

    visible.forEach(function (item) {
      var unread = !Number(item.is_read)
      var card = document.createElement("div")
      card.className = "notification-card" + (unread ? " unread" : "")

      var content = document.createElement("div")
      content.className = "notification-content"

      var meta = document.createElement("div")
      meta.className = "notification-meta"

      var type = document.createElement("span")
      type.className = "notification-type"
      type.innerText = window.notificationTypeLabel(item)

      var date = document.createElement("span")
      date.innerText = orderDate(item.created_at)

      var readState = document.createElement("span")
      readState.innerText = unread ? "Unread" : "Read"

      meta.appendChild(type)
      meta.appendChild(date)
      meta.appendChild(readState)

      var title = document.createElement("strong")
      title.innerText = item.title ? item.title : "Notification"

      var message = document.createElement("p")
      message.className = "notification-message"
      message.innerText = item.message ? item.message : ""

      content.appendChild(meta)
      content.appendChild(title)
      content.appendChild(message)

      var actions = document.createElement("div")
      actions.className = "notification-card-actions"

      if (item.action_url) {
        actions.appendChild(smallButton(notificationActionLabel(item), "btn btn-dark", function () {
          openNotification(item.id, encodeURIComponent(normalizeNotificationUrl(item.action_url)))
        }))
      }

      if (unread) {
        actions.appendChild(smallButton("Mark Read", "btn btn-outline-dark", function () {
          markNotificationRead(item.id)
        }))
      }

      actions.appendChild(smallButton("Delete", "btn btn-outline-dark", function () {
        deleteNotification(item.id)
      }))

      card.appendChild(content)
      card.appendChild(actions)
      container.appendChild(card)
    })
  }
  window.openNotification = async function (id, encodedUrl) {
    await markNotificationRead(id, false)
    window.location.href = decodeURIComponent(encodedUrl)
  }

  window.markNotificationRead = async function (id, refresh) {
    var shouldRefresh = refresh === false ? false : true
    await fetch("/notifications/" + id + "/read", { method: "PUT" })
    if (shouldRefresh) await loadNotifications()
  }

  window.markAllNotificationsRead = async function () {
    await fetch("/notifications/customer/" + currentUser.id + "/read-all", { method: "PUT" })
    await loadNotifications()
  }

  window.deleteNotification = async function (id) {
    await fetch("/notifications/" + id, { method: "DELETE" })
    await loadNotifications()
  }

  window.clearReadNotifications = async function () {
    await fetch("/notifications/customer/" + currentUser.id + "/read", { method: "DELETE" })
    await loadNotifications()
  }
})()