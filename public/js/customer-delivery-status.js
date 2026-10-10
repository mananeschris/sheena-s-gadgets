(function () {
  function status(order) {
    const value = String(order.status || 'pending').toLowerCase();
    if (value !== 'shipped') return value;
    const delivery = String(order.delivery_status || '').toLowerCase();
    return delivery === 'out_for_delivery' || (delivery === 'failed_attempt' && order.out_for_delivery_at)
      ? 'out_for_delivery' : value;
  }
  window.CustomerDeliveryStatus = { status };
})();
