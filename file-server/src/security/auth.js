import config from '../utils/config.js';
import logger from '../utils/logger.js';

/**
 * Token 认证中间件
 */
export function authMiddleware(req, res, next) {
  // 跳过不需要认证的路由
  if (req.path === '/health' || req.path === '/authorize') {
    return next();
  }

  const token = req.headers['x-auth-token'];
  const expectedToken = config.get('auth.token');

  if (!token) {
    logger.warn('Auth failed: No token provided', { ip: req.ip, path: req.path });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }

  if (token !== expectedToken) {
    logger.warn('Auth failed: Invalid token', { ip: req.ip, path: req.path });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token'
    });
  }

  next();
}
