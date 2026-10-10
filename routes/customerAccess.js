const { requireRole } = require('./roleGuard');
const { query } = require('./chatSession');

const customerSession = requireRole(['customer']);
const orderSession = requireRole(['customer', 'admin', 'staff']);

function customerIdentity(param = 'user_id') {
  return (req, res, next) => {
    const id = req.actorUser.id;
    const supplied = [req.params[param], req.body?.user_id, req.body?.customer_id, req.query.user_id, req.query.customer_id];
    if (supplied.some(value => value !== undefined && Number(value) !== Number(id))) {
      return res.status(403).json({ message: 'You can only access your own customer account.' });
    }
    req.body ||= {};
    req.body.user_id = id;
    req.body.customer_id = id;
    next();
  };
}

function ownedOrder(param = 'order_id') {
  return async (req, res, next) => {
    const id = Number(req.params[param]);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ message: 'Valid order id is required.' });
    try {
      const rows = await query(req.db, 'SELECT user_id FROM orders WHERE id=? LIMIT 1', [id]);
      if (!rows.length) return res.status(404).json({ message: 'Order not found.' });
      if (req.actorUser.role === 'customer' && Number(rows[0].user_id) !== Number(req.actorUser.id)) {
        return res.status(403).json({ message: 'You can only access your own order.' });
      }
      next();
    } catch { res.status(503).json({ message: 'Unable to verify order access.' }); }
  };
}

module.exports = { customerSession, orderSession, customerIdentity, ownedOrder };
