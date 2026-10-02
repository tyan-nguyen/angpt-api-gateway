import { dbService } from '../db/database.js';
import { config } from '../config.js';

/**
 * Middleware xác thực API Key từ Client/Web Chat
 */
export function apiKeyAuth(req, res, next) {
  let rawKey = null;

  // Hỗ trợ cả Authorization header (Bearer sk-...) và x-api-key
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7).trim();
  } else if (req.headers['x-api-key']) {
    rawKey = req.headers['x-api-key'].trim();
  }

  if (!rawKey) {
    return res.status(401).json({
      error: {
        message: 'Thiếu API Key truy cập. Vui lòng cung cấp Header: Authorization: Bearer <api-key> hoặc x-api-key.',
        type: 'authentication_error',
        code: 'missing_api_key'
      }
    });
  }

  // Cho phép master admin key gọi thẳng API nếu cần
  if (rawKey === config.masterAdminKey) {
    req.apiKeyInfo = {
      id: 'master-admin',
      name: 'Master Admin Superuser',
      allowed_models: ['*'],
      allow_vision: 1,
      rate_limit_rpm: 1000
    };
    return next();
  }

  const keyRecord = dbService.validateKey(rawKey);

  if (!keyRecord) {
    return res.status(401).json({
      error: {
        message: 'API Key không hợp lệ, đã bị thu hồi hoặc đã hết hạn.',
        type: 'authentication_error',
        code: 'invalid_api_key'
      }
    });
  }

  req.apiKeyInfo = keyRecord;
  next();
}

/**
 * Middleware kiểm tra quyền Quản trị viên (Admin) cho việc cấp/thu hồi Key
 */
export function adminAuth(req, res, next) {
  const adminSecret = req.headers['x-admin-key'] || (req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].slice(7).trim() : null);

  if (!adminSecret || adminSecret !== config.masterAdminKey) {
    return res.status(403).json({
      error: {
        message: 'Từ chối truy cập. Bạn cần cung cấp x-admin-key hợp lệ của hệ thống.',
        type: 'permission_denied',
        code: 'invalid_admin_secret'
      }
    });
  }

  next();
}
