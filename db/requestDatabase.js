const { AsyncLocalStorage } = require('node:async_hooks');

// Transactions must have their own connection, even when requests overlap.
function requestDatabase(pool) {
  const contexts = new AsyncLocalStorage();
  const db = {
    config: pool.config.connectionConfig,
    query(...args) {
      const context = contexts.getStore();
      const callback = args.at(-1);
      if (context && typeof callback === 'function') args[args.length - 1] = (...values) => contexts.run(context, () => callback(...values));
      return (context?.connection || pool).query(...args);
    },
    beginTransaction(callback) {
      const context = contexts.getStore();
      if (!context) return callback(new Error('A request context is required for transactions.'));
      if (context.connection || context.starting) return callback(new Error('Transaction already active.'));
      context.starting = true;
      pool.getConnection((error, connection) => {
        if (error) { context.starting = false; return callback(error); }
        connection.beginTransaction(error => {
          context.starting = false;
          if (error) { connection.release(); return callback(error); }
          if (context.closed) return connection.rollback(() => { connection.release(); callback(new Error('Request closed.')); });
          context.connection = connection;
          contexts.run(context, () => callback());
        });
      });
    },
    commit(callback) { finish('commit', callback); },
    rollback(callback) { finish('rollback', callback); },
    end(callback) { pool.end(callback); },
    middleware(req, res, next) {
      const context = { connection: null, closed: false };
      res.once('close', () => {
        context.closed = true;
        if (context.connection && !context.finishing) {
          const connection = context.connection;
          context.connection = null;
          connection.rollback(() => connection.release());
        }
      });
      contexts.run(context, next);
    }
  };
  function finish(method, callback = () => {}) {
    const context = contexts.getStore();
    const connection = context?.connection;
    if (!connection) return callback(method === 'commit' ? new Error('No active transaction.') : null);
    if (context.finishing) return callback(new Error('Transaction is already finishing.'));
    context.finishing = true;
    connection[method](error => {
      context.finishing = false;
      if (error && method === 'commit' && !context.closed) return contexts.run(context, () => callback(error));
      if (error && method === 'commit') return connection.rollback(() => {
        context.connection = null;
        connection.release();
        contexts.run(context, () => callback(error));
      });
      context.connection = null;
      connection.release();
      contexts.run(context, () => callback(error));
    });
  }
  return db;
}
module.exports = { requestDatabase };
