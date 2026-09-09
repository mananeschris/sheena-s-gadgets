(function () {
  var latestFinanceData = {}
  var financeReportSummary = null

  function byId(id) {
    return document.getElementById(id)
  }

  function numberValue(value) {
    var number = Number(value)
    if (!Number.isFinite(number)) return 0
    return number
  }

  function safeText(value) {
    if (value === null) return ""
    if (value === undefined) return ""
    return String(value)
  }

  function setText(id, value) {
    var element = byId(id)
    if (element) element.innerText = value
  }

  function createElement(tag, className, text) {
    var element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.innerText = text
    return element
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild)
  }

  function reportRange() {
    var select = byId("financeReportRange")
    return select ? select.value : "30"
  }

  function reportRangeLabel() {
    var range = reportRange()
    var labels = {
      today: "Today",
      "7": "Last 7 days",
      "30": "Last 30 days",
      "90": "Last 90 days",
      month: "This month",
      all: "All time"
    }
    return labels[range] ? labels[range] : "Last 30 days"
  }

  function reportStartDate() {
    var range = reportRange()
    var now = new Date()
    if (range === "all") return null
    if (range === "today") {
      var today = new Date(now)
      today.setHours(0, 0, 0, 0)
      return today
    }
    if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
    var days = Number(range ? range : 30)
    var start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - Math.max(days - 1, 0))
    return start
  }

  function dateInRange(value) {
    var date = new Date(value)
    if (Number.isNaN(date.getTime())) return false
    var start = reportStartDate()
    if (!start) return true
    return Math.sign(date.getTime() - start.getTime()) !== -1
  }

  function orderItemsForReport(order) {
    if (typeof normalizedOrderItems === "function") return normalizedOrderItems(order)
    return [{
      product_name: order.product_name ? order.product_name : "Product",
      quantity: order.quantity ? order.quantity : 1,
      subtotal: order.total_price ? order.total_price : 0
    }]
  }
  function schedulePaymentInRange(schedule) {
    if (!schedule.paid_at) return false
    return dateInRange(schedule.paid_at)
  }

  function buildFinanceReportSummary() {
    var orders = allOrders.filter(function (order) {
      return dateInRange(order.created_at)
    })
    var schedules = Array.isArray(installmentSchedules) ? installmentSchedules : []
    var grossSales = 0
    var paidRevenue = 0
    var codToCollect = 0
    var pendingOnline = 0
    var installmentDownpayments = 0
    var installmentPaid = 0
    var installmentReceivables = 0
    var repairCount = 0
    var gatewayFailed = 0
    var paymentMap = new Map()
    var statusMap = new Map()
    var productMap = new Map()
    var trendMap = new Map()

    orders.forEach(function (order) {
      var total = numberValue(order.total_price)
      var payStatus = safeText(paymentStatus(order))
      var method = safeText(order.payment_method ? order.payment_method : "cod").toUpperCase()
      var statusLabel = ORDER_STATUS_LABELS[orderStatus(order)] ? ORDER_STATUS_LABELS[orderStatus(order)] : orderStatus(order)
      var date = new Date(order.created_at)
      var key = Number.isNaN(date.getTime()) ? "No date" : date.toISOString().slice(0, reportRange() === "all" ? 7 : 10)

      grossSales += total
      trendMap.set(key, numberValue(trendMap.get(key)) + total)

      if (payStatus === "paid") paidRevenue += total
      if (payStatus === "installment_completed") paidRevenue += total
      if (payStatus === "to_collect") codToCollect += total
      if (payStatus === "pending_verification") pendingOnline += total
      if (payStatus === "awaiting_gateway_setup") pendingOnline += total
      if (payStatus === "payment_setup_failed") gatewayFailed += 1
      if (payStatus === "installment_downpayment_failed") gatewayFailed += 1

      if (method === "INSTALLMENT") {
        if (payStatus === "installment_downpayment_paid") installmentDownpayments += numberValue(order.installment_downpayment)
        if (payStatus === "installment_active") installmentDownpayments += numberValue(order.installment_downpayment)
        if (payStatus === "installment_completed") installmentDownpayments += numberValue(order.installment_downpayment)
      }

      if (order.repair_request_status) repairCount += 1

      var paymentRow = paymentMap.get(method)
      if (!paymentRow) paymentRow = { label: method, count: 0, amount: 0 }
      paymentRow.count += 1
      paymentRow.amount += total
      paymentMap.set(method, paymentRow)

      statusMap.set(statusLabel, numberValue(statusMap.get(statusLabel)) + 1)

      orderItemsForReport(order).forEach(function (item) {
        var name = item.product_name ? item.product_name : "Product"
        var current = productMap.get(name)
        if (!current) current = { label: name, quantity: 0, amount: 0 }
        current.quantity += numberValue(item.quantity ? item.quantity : 1)
        current.amount += numberValue(item.subtotal)
        productMap.set(name, current)
      })
    })

    schedules.forEach(function (schedule) {
      var balance = Math.max(numberValue(schedule.amount_due) - numberValue(schedule.amount_paid), 0)
      if (safeText(schedule.status) !== "paid") installmentReceivables += balance
      if (schedulePaymentInRange(schedule)) installmentPaid += numberValue(schedule.amount_paid)
    })

    paidRevenue += installmentDownpayments + installmentPaid
    var receivables = installmentReceivables + codToCollect + pendingOnline

    var paymentRows = Array.from(paymentMap.values()).sort(function (a, b) {
      return b.amount - a.amount
    })
    var statusRows = Array.from(statusMap.entries()).map(function (entry) {
      return { label: entry[0], value: entry[1] }
    }).sort(function (a, b) {
      return b.value - a.value
    })
    var topProducts = Array.from(productMap.values()).sort(function (a, b) {
      return b.quantity - a.quantity
    }).slice(0, 5)
    var trendRows = Array.from(trendMap.entries()).sort(function (a, b) {
      return safeText(a[0]).localeCompare(safeText(b[0]))
    }).map(function (entry) {
      return {
        label: entry[0],
        shortLabel: entry[0].length === 10 ? entry[0].slice(5) : entry[0],
        value: entry[1]
      }
    })

    return {
      rangeLabel: reportRangeLabel(),
      generatedAt: new Date().toLocaleString(),
      orders: orders,
      grossSales: grossSales,
      paidRevenue: paidRevenue,
      codToCollect: codToCollect,
      pendingOnline: pendingOnline,
      receivables: receivables,
      installmentReceivables: installmentReceivables,
      repairCount: repairCount,
      gatewayFailed: gatewayFailed,
      paymentRows: paymentRows,
      statusRows: statusRows,
      topProducts: topProducts,
      trendRows: trendRows
    }
  }
  function makeMetric(label, id) {
    var box = createElement("div", "metric")
    box.appendChild(createElement("div", "metric-label", label))
    box.appendChild(createElement("div", "metric-value", "PHP 0"))
    box.lastChild.id = id
    return box
  }

  function makeButton(label, className, handler) {
    var button = createElement("button", className, label)
    button.type = "button"
    button.addEventListener("click", handler)
    return button
  }

  function addRangeOptions(select) {
    var options = [
      ["today", "Today"],
      ["7", "Last 7 days"],
      ["30", "Last 30 days"],
      ["90", "Last 90 days"],
      ["month", "This month"],
      ["all", "All time"]
    ]
    options.forEach(function (item) {
      var option = createElement("option", "", item[1])
      option.value = item[0]
      option.selected = item[0] === "30"
      select.appendChild(option)
    })
  }

  function makeAnalyticsCard(title, id, className) {
    var card = createElement("div", "analytics-card")
    card.appendChild(createElement("h6", "", title))
    var body = createElement("div", className)
    body.id = id
    body.appendChild(createElement("div", "text-muted", "Generate report to view data."))
    card.appendChild(body)
    return card
  }

  function installFinanceReportPanel() {
    if (byId("financeReportPanel")) return
    var section = byId("finance")
    if (!section) return
    var panel = section.querySelector(".panel")
    if (!panel) return

    var wrapper = createElement("div", "border rounded p-3 mt-4")
    wrapper.id = "financeReportPanel"

    var toolbar = createElement("div", "analytics-toolbar")
    var titleWrap = createElement("div")
    titleWrap.appendChild(createElement("h6", "", "Sales & Finance Report"))
    titleWrap.appendChild(createElement("div", "text-muted small", "Formal summary for revenue, receivables, payment mix, top products, and recent transactions."))

    var controls = createElement("div", "analytics-controls")
    var select = createElement("select", "form-select form-select-sm")
    select.id = "financeReportRange"
    addRangeOptions(select)
    select.addEventListener("change", function () {
      renderFinanceReport()
    })
    controls.appendChild(select)
    controls.appendChild(makeButton("Generate", "btn btn-sm btn-outline-dark", function () { renderFinanceReport() }))
    controls.appendChild(makeButton("Print Report", "btn btn-sm btn-outline-dark", function () { printFinanceReport() }))
    controls.appendChild(makeButton("Export Report CSV", "btn btn-sm btn-dark", function () { exportFinanceReportCsv() }))

    toolbar.appendChild(titleWrap)
    toolbar.appendChild(controls)
    wrapper.appendChild(toolbar)

    var metrics = createElement("div", "metric-grid")
    metrics.appendChild(makeMetric("Report Sales", "financeReportSales"))
    metrics.appendChild(makeMetric("Paid Revenue", "financeReportPaid"))
    metrics.appendChild(makeMetric("To Collect", "financeReportCollect"))
    metrics.appendChild(makeMetric("Receivables", "financeReportReceivables"))
    wrapper.appendChild(metrics)

    var grid = createElement("div", "analytics-grid mt-3")
    grid.appendChild(makeAnalyticsCard("Sales Trend", "financeReportTrend", "bar-chart"))
    grid.appendChild(makeAnalyticsCard("Payment Breakdown", "financeReportPayments", "mini-row-chart"))
    grid.appendChild(makeAnalyticsCard("Order Status", "financeReportStatuses", "mini-row-chart"))
    grid.appendChild(makeAnalyticsCard("Top Products", "financeReportTopProducts", "mini-row-chart"))
    wrapper.appendChild(grid)

    var row = createElement("div", "row g-3 mt-1")
    var left = createElement("div", "col-lg-5")
    var insights = createElement("div", "border rounded p-3 h-100")
    insights.id = "financeReportInsights"
    insights.appendChild(createElement("div", "text-muted", "Generate report to view finance insights."))
    left.appendChild(insights)

    var right = createElement("div", "col-lg-7")
    var responsive = createElement("div", "table-responsive")
    var table = createElement("table", "table table-bordered align-middle")
    var head = document.createElement("thead")
    var headRow = document.createElement("tr")
    ;["Order", "Date", "Payment", "Status", "Total"].forEach(function (label) {
      headRow.appendChild(createElement("th", "", label))
    })
    head.appendChild(headRow)
    table.appendChild(head)
    var body = document.createElement("tbody")
    body.id = "financeReportOrdersTable"
    table.appendChild(body)
    responsive.appendChild(table)
    right.appendChild(responsive)
    row.appendChild(left)
    row.appendChild(right)
    wrapper.appendChild(row)

    panel.appendChild(wrapper)
  }
  function renderInsights(summary) {
    var host = byId("financeReportInsights")
    if (!host) return
    clearElement(host)
    host.appendChild(createElement("h6", "fw-bold", "Report Insights"))
    var average = summary.orders.length ? summary.grossSales / summary.orders.length : 0
    var lines = [
      "Period: " + summary.rangeLabel,
      "Generated: " + summary.generatedAt,
      "Orders included: " + summary.orders.length,
      "Average order value: " + money(average),
      "Pending online amount: " + money(summary.pendingOnline),
      "Installment receivables: " + money(summary.installmentReceivables),
      "Gateway failed orders: " + summary.gatewayFailed,
      "Repair-related orders: " + summary.repairCount
    ]
    lines.forEach(function (line) {
      host.appendChild(createElement("div", "text-muted small mt-2", line))
    })
  }
  function renderRecentOrders(summary) {
    var body = byId("financeReportOrdersTable")
    if (!body) return
    clearElement(body)
    if (!summary.orders.length) {
      var emptyRow = document.createElement("tr")
      var emptyCell = createElement("td", "text-center text-muted py-4", "No orders in this report period.")
      emptyCell.colSpan = 5
      emptyRow.appendChild(emptyCell)
      body.appendChild(emptyRow)
      return
    }

    summary.orders.slice().sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }).slice(0, 10).forEach(function (order) {
      var row = document.createElement("tr")
      row.appendChild(createElement("td", "", orderReference(order)))
      row.appendChild(createElement("td", "", orderDate(order.created_at)))
      row.appendChild(createElement("td", "", safeText(order.payment_method ? order.payment_method : "cod").toUpperCase()))
      var statusLabel = PAYMENT_STATUS_LABELS[paymentStatus(order)] ? PAYMENT_STATUS_LABELS[paymentStatus(order)] : paymentStatus(order)
      row.appendChild(createElement("td", "", statusLabel))
      row.appendChild(createElement("td", "", money(order.total_price)))
      body.appendChild(row)
    })
  }
  function renderFinanceReportCharts(summary) {
    renderBarChart("financeReportTrend", summary.trendRows, function (value) {
      return money(value)
    })
    renderRowChart("financeReportPayments", summary.paymentRows.map(function (row) {
      return { label: row.label, value: row.amount }
    }), function (value) {
      return money(value)
    })
    renderRowChart("financeReportStatuses", summary.statusRows, function (value) {
      return String(value)
    })
    renderRowChart("financeReportTopProducts", summary.topProducts.map(function (row) {
      return { label: row.label, value: row.quantity }
    }), function (value) {
      return String(value) + " sold"
    })
  }

  window.renderFinanceReport = async function () {
    installFinanceReportPanel()
    if (!allOrders.length) await loadOrders()
    if (!installmentSchedules.length) await loadInstallmentSchedules()
    try {
      latestFinanceData = await getFinanceData()
    } catch (error) {
      latestFinanceData = {}
    }
    financeReportSummary = buildFinanceReportSummary()
    setText("financeReportSales", money(financeReportSummary.grossSales))
    setText("financeReportPaid", money(financeReportSummary.paidRevenue))
    setText("financeReportCollect", money(financeReportSummary.codToCollect + financeReportSummary.pendingOnline))
    setText("financeReportReceivables", money(financeReportSummary.receivables))
    renderFinanceReportCharts(financeReportSummary)
    renderInsights(financeReportSummary)
    renderRecentOrders(financeReportSummary)
  }
  function financeReportCsvRows(summary) {
    var rows = [
      ["Report", "Sales and Finance Report"],
      ["Period", summary.rangeLabel],
      ["Generated", summary.generatedAt],
      ["Orders", summary.orders.length],
      ["Report Sales", summary.grossSales.toFixed(2)],
      ["Paid Revenue", summary.paidRevenue.toFixed(2)],
      ["COD To Collect", summary.codToCollect.toFixed(2)],
      ["Pending Online", summary.pendingOnline.toFixed(2)],
      ["Receivables", summary.receivables.toFixed(2)],
      ["Installment Receivables", summary.installmentReceivables.toFixed(2)],
      ["Gateway Failed", summary.gatewayFailed],
      ["Repair Related Orders", summary.repairCount],
      [],
      ["Payment Method", "Amount", "Orders"]
    ]
    summary.paymentRows.forEach(function (row) {
      rows.push([row.label, row.amount.toFixed(2), row.count])
    })
    rows.push([])
    rows.push(["Order Status", "Count"])
    summary.statusRows.forEach(function (row) {
      rows.push([row.label, row.value])
    })
    rows.push([])
    rows.push(["Top Product", "Qty Sold", "Sales"])
    summary.topProducts.forEach(function (row) {
      rows.push([row.label, row.quantity, row.amount.toFixed(2)])
    })
    return rows
  }
  function addRecentOrdersToCsv(rows, summary) {
    rows.push([])
    rows.push(["Recent Order", "Date", "Payment", "Payment Status", "Total"])
    summary.orders.slice().sort(function (a, b) {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    }).slice(0, 20).forEach(function (order) {
      var statusLabel = PAYMENT_STATUS_LABELS[paymentStatus(order)] ? PAYMENT_STATUS_LABELS[paymentStatus(order)] : paymentStatus(order)
      rows.push([orderReference(order), orderDate(order.created_at), safeText(order.payment_method ? order.payment_method : "cod").toUpperCase(), statusLabel, numberValue(order.total_price).toFixed(2)])
    })
  }

  window.exportFinanceReportCsv = async function () {
    if (!financeReportSummary) await renderFinanceReport()
    var rows = financeReportCsvRows(financeReportSummary)
    addRecentOrdersToCsv(rows, financeReportSummary)
    var csv = rows.map(function (row) {
      return row.map(csvCell).join(",")
    }).join("\r\n")
    var blob = new Blob(["\ufeff" + csv], { type: "text/csv" })
    var url = URL.createObjectURL(blob)
    var link = document.createElement("a")
    link.href = url
    link.download = "sales-finance-report-" + new Date().toISOString().slice(0, 10) + ".csv"
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }
  function tag(name, body) {
    var lt = String.fromCharCode(60)
    var gt = String.fromCharCode(62)
    var closeName = name.split(" ")[0]
    return lt + name + gt + body + lt + "/" + closeName + gt
  }

  function printableFinanceReportHtml(summary) {
    var lt = String.fromCharCode(60)
    var gt = String.fromCharCode(62)
    var rows = financeReportCsvRows(summary).map(function (row) {
      if (!row.length) return tag("tr", tag("td", ""))
      var cells = row.map(function (cell) {
        return tag("td", safeText(cell))
      }).join("")
      return tag("tr", cells)
    }).join("")
    return lt + "!doctype html" + gt +
      tag("html", tag("head", tag("title", "Sales and Finance Report")) + tag("body", tag("h1", "Sheena's Gadgets & Accessories Shop") + tag("h2", "Sales and Finance Report") + tag("p", "Period: " + summary.rangeLabel) + tag("p", "Generated: " + summary.generatedAt) + tag("table border=1 cellspacing=0 cellpadding=8", rows)))
  }

  window.printFinanceReport = async function () {
    if (!financeReportSummary) await renderFinanceReport()
    var printWindow = window.open("", "_blank", "width=980,height=720")
    if (!printWindow) return alert("Please allow pop-ups to print this report.")
    printWindow.document.open()
    printWindow.document.write(printableFinanceReportHtml(financeReportSummary))
    printWindow.document.close()
    printWindow.focus()
    setTimeout(function () {
      printWindow.print()
    }, 300)
  }
  function wrapFinanceLoaders() {
    installFinanceReportPanel()
    var originalLoadFinance = window.loadFinance
    if (typeof originalLoadFinance === "function") {
      window.loadFinance = async function () {
        await originalLoadFinance.apply(this, arguments)
        await renderFinanceReport()
      }
    }
    var originalShowSection = window.showSection
    if (typeof originalShowSection === "function") {
      window.showSection = function (id) {
        originalShowSection.apply(this, arguments)
        if (id === "finance") renderFinanceReport()
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wrapFinanceLoaders)
  } else {
    wrapFinanceLoaders()
  }
})()