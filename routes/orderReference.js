function orderReference(id) {
  const numeric = Number(id)
  if (Number.isFinite(numeric) && Math.sign(numeric) === 1) {
    return String(Math.trunc(numeric)).padStart(6, "0")
  }
  return "000000"
}

function orderLabel(id) {
  return "Order ID " + orderReference(id)
}

module.exports = { orderReference, orderLabel }
