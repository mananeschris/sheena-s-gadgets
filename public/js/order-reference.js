(function () {
  function extractOrderId(value) {
    if (value && typeof value === "object") {
      if (value.id !== undefined) return value.id
      if (value.order_id !== undefined) return value.order_id
      if (value.orderId !== undefined) return value.orderId
    }
    return value
  }

  window.orderReference = function (value) {
    var id = extractOrderId(value)
    var numeric = Number(id)
    if (Number.isFinite(numeric) && numeric > 0) {
      return String(Math.trunc(numeric)).padStart(6, "0")
    }
    return "000000"
  }

  window.orderLabel = function (value) {
    return "Order ID " + window.orderReference(value)
  }
})()