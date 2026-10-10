function attachOrderDeliveryDetails(db, orders, callback) {
  if (!orders.length) return callback(null, orders);
  db.query(
    'SELECT order_id, status AS delivery_status, out_for_delivery_at FROM delivery_assignments WHERE order_id IN (?) ORDER BY id DESC',
    [orders.map(order => order.id)],
    (error, rows) => {
      if (error && error.code !== 'ER_NO_SUCH_TABLE') return callback(error);
      const assignments = new Map();
      for (const row of rows || []) {
        if (!assignments.has(Number(row.order_id))) assignments.set(Number(row.order_id), row);
      }
      callback(null, orders.map(order => ({
        ...order,
        delivery_status: assignments.get(Number(order.id))?.delivery_status || null,
        out_for_delivery_at: assignments.get(Number(order.id))?.out_for_delivery_at || null
      })));
    }
  );
}

module.exports = { attachOrderDeliveryDetails };
