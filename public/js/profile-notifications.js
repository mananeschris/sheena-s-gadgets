(function () {
  var loading = false
  var loadError = false
  var changing = false
  var latestRequest = 0
  window.notificationFilter = "all"

  window.notificationBucket = function (item) {
    var type = String(item.type || "info").toLowerCase()
    var text = String((item.title || "") + " " + (item.message || "")).toLowerCase()
    if (type.includes("installment") || text.includes("installment")) return "installment"
    if (type.includes("repair") || text.includes("repair") || text.includes("warranty")) return "repair"
    if (type.includes("payment") || text.includes("payment") || text.includes("gcash") || text.includes("paid")) return "payment"
    if (type.includes("order") || text.includes("order #") || text.includes("order id")) return "order"
    return "info"
  }

  window.notificationTypeLabel = function (item) {
    return { order: "Order", payment: "Payment", installment: "Installment", repair: "Repair", info: "Update" }[notificationBucket(item)]
  }

  function icon(name) {
    var element = document.createElement("i")
    element.setAttribute("data-lucide", name)
    element.setAttribute("aria-hidden", "true")
    return element
  }

  function createIcons() { window.lucide?.createIcons() }

  function notificationText(value, item) { return customerNotificationText(value, item) }

  function eventTitle(item) {
    var title = notificationText(item.title || "Notification", item)
    var productName = String(item.order_product_name || "")
    if (productName && title.toLowerCase().startsWith(productName.toLowerCase())) {
      title = title.slice(productName.length).replace(/^[\s:|\-]+/, "")
    }
    return title || "Order update"
  }

  window.filteredNotifications = function () {
    var search = document.getElementById("profileNotificationSearch").value.trim().toLowerCase()
    return notifications.filter(function (item) {
      var matchesFilter = notificationFilter === "all" || (notificationFilter === "unread" ? !Number(item.is_read) : notificationBucket(item) === notificationFilter)
      var text = [item.order_product_name, eventTitle(item), notificationText(item.message, item), notificationTypeLabel(item)].join(" ").toLowerCase()
      return matchesFilter && (!search || text.includes(search))
    }).sort(function (a, b) { return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || Number(b.id) - Number(a.id) })
  }

  window.setNotificationFilter = function (filter) {
    window.notificationFilter = filter
    renderNotifications()
  }

  window.clearProfileNotificationSearch = function () {
    document.getElementById("profileNotificationSearch").value = ""
    renderNotifications()
  }

  window.renderNotificationSummary = function () {
    var unread = notifications.filter(function (item) { return !Number(item.is_read) }).length
    document.getElementById("notificationUnreadBadge").textContent = unread
    document.getElementById("notificationSummaryText").textContent = loading ? "Loading updates..." : loadError ? "Updates unavailable" : unread ? unread + " unread / " + notifications.length + " updates" : "All caught up / " + notifications.length + " updates"
    document.getElementById("profileNotificationMarkAll").disabled = loading || loadError || changing || !unread
    document.getElementById("profileNotificationClearRead").disabled = loading || loadError || changing || notifications.length === unread
    document.getElementById("profileNotificationRefresh").disabled = loading || changing
    document.querySelectorAll("#profileNotifications [data-notification-mutation]").forEach(function (button) { button.disabled = changing || loading })
    document.querySelectorAll("#notificationsSection [data-notification-filter]").forEach(function (button) {
      var filter = button.dataset.notificationFilter
      var count = filter === "all" ? notifications.length : filter === "unread" ? unread : notifications.filter(function (item) { return notificationBucket(item) === filter }).length
      button.querySelector(".profile-notification-filter-count").textContent = count
      button.classList.toggle("active", filter === notificationFilter)
      button.setAttribute("aria-pressed", String(filter === notificationFilter))
    })
    var sideBadge = document.getElementById("notificationCount")
    if (sideBadge) {
      sideBadge.textContent = unread
      sideBadge.classList.toggle("d-none", unread === 0)
    }
    document.getElementById("notificationButton")?.classList.toggle("has-unread", unread > 0)
  }

  function button(label, name, handler, text) {
    var element = document.createElement("button")
    element.type = "button"
    element.className = "profile-notification-icon-button"
    element.setAttribute("aria-label", label)
    element.title = label
    element.dataset.notificationMutation = ""
    element.appendChild(icon(name))
    if (text) {
      element.className = "profile-notification-command"
      element.appendChild(document.createTextNode(text))
    }
    element.addEventListener("click", handler)
    return element
  }

  function emptyState(title, message, name, retry) {
    var state = document.createElement("div")
    state.className = "profile-notification-empty"
    state.setAttribute("role", loadError ? "alert" : "status")
    state.appendChild(icon(name))
    var heading = document.createElement("h3")
    heading.textContent = title
    state.appendChild(heading)
    if (message) {
      var description = document.createElement("p")
      description.textContent = message
      state.appendChild(description)
    }
    if (retry) state.appendChild(button("Try again", "refresh-cw", loadNotifications, "Try Again"))
    return state
  }

  function normalizeNotificationUrl(rawUrl) {
    if (!rawUrl) return ""
    try {
      var url = new URL(rawUrl, location.origin)
      if (!["http:", "https:"].includes(url.protocol)) return ""
      if (url.origin !== location.origin) return url.toString()
      var orderId = url.searchParams.get("order_id") || url.searchParams.get("order")
      if (orderId && ["/customer/profile.html", "/customer/order.html"].includes(url.pathname)) return "/customer/order.html?order_id=" + encodeURIComponent(orderId)
      return url.pathname + url.search + url.hash
    } catch (_) { return "" }
  }

  function dayLabel(value) {
    var date = new Date(value)
    if (!value || !Number.isFinite(date.getTime())) return "Earlier updates"
    var today = new Date()
    today.setHours(0, 0, 0, 0)
    var yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    date.setHours(0, 0, 0, 0)
    if (date.getTime() === today.getTime()) return "Today"
    if (date.getTime() === yesterday.getTime()) return "Yesterday"
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
  }

  function notificationCard(item) {
    var unread = !Number(item.is_read)
    var bucket = notificationBucket(item)
    var card = document.createElement("article")
    card.className = "notification-card profile-notification-card" + (unread ? " unread" : "")
    card.dataset.notificationId = item.id
    var visual = document.createElement("span")
    visual.className = "profile-notification-visual"
    var fallback = icon({ order: "package-check", payment: "wallet-cards", installment: "calendar-clock", repair: "wrench", info: "bell-ring" }[bucket])
    visual.appendChild(fallback)
    if (item.order_product_image) {
      var image = document.createElement("img")
      image.className = "notification-product-image"
      image.src = item.order_product_image
      image.alt = item.order_product_name || "Ordered product"
      image.loading = "lazy"
      fallback.hidden = true
      image.addEventListener("error", function () { image.hidden = true; visual.querySelector("svg, i").removeAttribute("hidden") })
      visual.appendChild(image)
    }
    card.appendChild(visual)
    var content = document.createElement("div")
    content.className = "notification-content"
    var meta = document.createElement("div")
    meta.className = "notification-meta"
    var type = document.createElement("span")
    type.className = "notification-type"
    type.textContent = notificationTypeLabel(item)
    meta.appendChild(type)
    var date = document.createElement("time")
    var created = new Date(item.created_at)
    if (item.created_at && Number.isFinite(created.getTime())) {
      date.dateTime = created.toISOString()
      date.textContent = created.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      date.title = orderDate(item.created_at)
    }
    meta.appendChild(date)
    if (unread) {
      var dot = document.createElement("span")
      dot.className = "profile-notification-unread-dot"
      dot.setAttribute("role", "img")
      dot.setAttribute("aria-label", "Unread")
      dot.title = "Unread"
      meta.appendChild(dot)
    }
    content.appendChild(meta)
    var heading = document.createElement("h3")
    heading.className = "notification-product-name"
    heading.textContent = item.order_product_name || eventTitle(item)
    content.appendChild(heading)
    if (item.order_product_name) {
      var event = document.createElement("p")
      event.className = "profile-notification-event"
      event.textContent = eventTitle(item)
      content.appendChild(event)
    }
    var message = document.createElement("p")
    message.className = "notification-message"
    message.textContent = notificationText(item.message || "", item)
    content.appendChild(message)
    var actions = document.createElement("div")
    actions.className = "notification-card-actions"
    var url = normalizeNotificationUrl(item.action_url)
    if (url) {
      var link = document.createElement("a")
      link.className = "profile-notification-open"
      link.href = url
      link.appendChild(icon("arrow-up-right"))
      link.appendChild(document.createTextNode(url.includes("/customer/order.html") ? "View Order" : "Open Update"))
      link.addEventListener("click", function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        openNotification(item.id, encodeURIComponent(url))
      })
      actions.appendChild(link)
    }
    var utilities = document.createElement("div")
    utilities.className = "profile-notification-utilities"
    if (unread) utilities.appendChild(button("Mark notification read", "check", function () { markNotificationRead(item.id) }))
    utilities.appendChild(button("Delete notification", "trash-2", function () { deleteNotification(item.id) }))
    actions.appendChild(utilities)
    content.appendChild(actions)
    card.appendChild(content)
    return card
  }

  window.renderNotifications = function () {
    var container = document.getElementById("profileNotifications")
    container.replaceChildren()
    container.setAttribute("aria-busy", String(loading))
    document.getElementById("profileNotificationResultCount").textContent = ""
    if (loading) container.appendChild(emptyState("Loading updates...", "", "bell"))
    else if (loadError) container.appendChild(emptyState("Unable to load notifications", "Please try again.", "cloud-off", true))
    else if (!notifications.length) container.appendChild(emptyState("No notifications yet", "Your order and payment updates will appear here.", "bell-off"))
    else {
      var visible = filteredNotifications()
      document.getElementById("profileNotificationResultCount").textContent = "Showing " + visible.length + " of " + notifications.length
      if (!visible.length) {
        var search = document.getElementById("profileNotificationSearch").value.trim()
        container.appendChild(emptyState(search ? "No matching updates" : notificationFilter === "unread" ? "All caught up" : "No updates here", search ? "Try a different product or keyword." : "", search ? "search" : "check-check"))
      }
      var groups = new Map()
      visible.forEach(function (item) {
        var label = dayLabel(item.created_at)
        if (!groups.has(label)) {
          var section = document.createElement("section")
          section.className = "profile-notification-day"
          var heading = document.createElement("h3")
          heading.className = "profile-notification-day-title"
          heading.textContent = label
          section.appendChild(heading)
          groups.set(label, section)
          container.appendChild(section)
        }
        groups.get(label).appendChild(notificationCard(item))
      })
    }
    renderNotificationSummary()
    createIcons()
  }

  function feedback(message) {
    var element = document.getElementById("profileNotificationFeedback")
    element.textContent = message
    element.hidden = !message
  }

  window.loadNotifications = async function () {
    if (!currentUser) return
    var request = ++latestRequest
    loading = true
    loadError = false
    feedback("")
    renderNotifications()
    try {
      var response = await fetch("/notifications/customer/" + currentUser.id)
      if (!response.ok) throw new Error("Unable to load notifications.")
      var data = await response.json()
      if (!Array.isArray(data)) throw new Error("Invalid notification response.")
      if (request !== latestRequest) return
      notifications = data
    } catch (_) {
      if (request !== latestRequest) return
      loadError = true
    }
    loading = false
    renderNotifications()
  }

  async function changeNotification(url, method) {
    if (changing || loading) return false
    changing = true
    feedback("")
    renderNotificationSummary()
    try {
      var response = await fetch(url, { method: method })
      if (!response.ok) throw new Error("Unable to update notifications. Please try again.")
      await loadNotifications()
      return true
    } catch (error) {
      feedback(error.message || "Unable to update notifications. Please try again.")
      return false
    } finally {
      changing = false
      renderNotificationSummary()
    }
  }

  window.markNotificationRead = async function (id) {
    return changeNotification("/notifications/" + id + "/read", "PUT")
  }

  window.openNotification = async function (id, encodedUrl) {
    if (changing || loading) return
    var url = normalizeNotificationUrl(decodeURIComponent(encodedUrl))
    if (!url) return
    var item = notifications.find(function (item) { return Number(item.id) === Number(id) })
    if (item && !Number(item.is_read) && !await markNotificationRead(id)) return
    window.location.href = url
  }

  window.markAllNotificationsRead = async function () {
    await changeNotification("/notifications/customer/" + currentUser.id + "/read-all", "PUT")
  }

  window.deleteNotification = async function (id) {
    if (changing || loading) return
    var confirmed = await AppDialog.confirm({ title: "Delete notification?", message: "This notification will be permanently removed from your account.", confirmText: "Delete", tone: "danger" })
    if (confirmed) await changeNotification("/notifications/" + id, "DELETE")
  }

  window.clearReadNotifications = async function () {
    if (changing || loading) return
    var readCount = notifications.filter(function (item) { return Number(item.is_read) }).length
    if (!readCount) return
    var confirmed = await AppDialog.confirm({ title: "Clear read notifications?", message: "Unread updates will stay in your account.", details: [{ label: "Notifications to remove", value: readCount }], confirmText: "Clear Read", tone: "danger" })
    if (confirmed) await changeNotification("/notifications/customer/" + currentUser.id + "/read", "DELETE")
  }
})()
