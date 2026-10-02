import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// Đảm bảo thư mục data/ tồn tại
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(config.dbPath);

// Khởi tạo bảng dữ liệu
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    allowed_models TEXT NOT NULL DEFAULT '["*"]',
    allow_vision INTEGER NOT NULL DEFAULT 1,
    rate_limit_rpm INTEGER NOT NULL DEFAULT 60,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    last_used_at TEXT,
    total_requests INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id TEXT,
    endpoint TEXT NOT NULL,
    model TEXT,
    has_images INTEGER DEFAULT 0,
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

export function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey() {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  return `sk-local-${randomBytes}`;
}

export const dbService = {
  // Tìm API Key theo chuỗi thô
  validateKey(rawKey) {
    if (!rawKey) return null;
    const hash = hashKey(rawKey);
    const stmt = db.prepare(`SELECT * FROM api_keys WHERE key_hash = ? AND status = 'active' LIMIT 1`);
    const key = stmt.get(hash);
    if (!key) return null;

    // Kiểm tra hạn sử dụng nếu có
    if (key.expires_at) {
      const expDate = new Date(key.expires_at);
      if (expDate < new Date()) {
        return null;
      }
    }

    try {
      key.allowed_models = JSON.parse(key.allowed_models);
    } catch {
      key.allowed_models = ['*'];
    }

    return key;
  },

  // Cập nhật thống kê sau khi gọi thành công
  recordKeyUsage(keyId) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE api_keys 
      SET total_requests = total_requests + 1, last_used_at = ?
      WHERE id = ?
    `);
    stmt.run(now, keyId);
  },

  // Tạo API Key mới
  createApiKey({ name, allowed_models = ['*'], allow_vision = 1, rate_limit_rpm = 60, expires_at = null }) {
    const rawKey = generateApiKey();
    const hash = hashKey(rawKey);
    const id = crypto.randomUUID();
    const prefix = `${rawKey.slice(0, 14)}...${rawKey.slice(-4)}`;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO api_keys (
        id, key_hash, key_prefix, name, status, allowed_models, allow_vision, rate_limit_rpm, created_at, expires_at, total_requests
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, 0)
    `);

    stmt.run(
      id,
      hash,
      prefix,
      name || 'Default Key',
      JSON.stringify(allowed_models),
      allow_vision ? 1 : 0,
      rate_limit_rpm || 60,
      now,
      expires_at || null
    );

    return {
      id,
      apiKey: rawKey,
      keyPrefix: prefix,
      name,
      allowed_models,
      allow_vision,
      rate_limit_rpm,
      created_at: now
    };
  },

  // Liệt kê danh sách Keys (không trả về hash/secret)
  listApiKeys() {
    const stmt = db.prepare(`
      SELECT id, key_prefix, name, status, allowed_models, allow_vision, rate_limit_rpm, created_at, expires_at, last_used_at, total_requests 
      FROM api_keys 
      ORDER BY created_at DESC
    `);
    const rows = stmt.all();
    return rows.map(r => ({
      ...r,
      allowed_models: JSON.parse(r.allowed_models || '["*"]')
    }));
  },

  // Thu hồi / Vô hiệu hóa Key
  revokeApiKey(id) {
    const stmt = db.prepare(`UPDATE api_keys SET status = 'revoked' WHERE id = ?`);
    return stmt.run(id);
  },

  // Xóa Key
  deleteApiKey(id) {
    const stmt = db.prepare(`DELETE FROM api_keys WHERE id = ?`);
    return stmt.run(id);
  },

  // Ghi log kiểm tra
  logAudit({ key_id, endpoint, model, has_images = 0, status_code, latency_ms }) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO audit_logs (key_id, endpoint, model, has_images, status_code, latency_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(key_id || null, endpoint, model || null, has_images ? 1 : 0, status_code, latency_ms, now);
  },

  // Thống kê nhanh
  getStats() {
    const totalKeys = db.prepare(`SELECT COUNT(*) as count FROM api_keys`).get().count;
    const activeKeys = db.prepare(`SELECT COUNT(*) as count FROM api_keys WHERE status = 'active'`).get().count;
    const totalRequests = db.prepare(`SELECT COUNT(*) as count FROM audit_logs`).get().count;
    const recentLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 10`).all();

    return {
      totalKeys,
      activeKeys,
      totalRequests,
      recentLogs
    };
  }
};

// Tự động khởi tạo Key mặc định nếu DB chưa có key nào
function initDefaultKey() {
  const count = db.prepare(`SELECT COUNT(*) as count FROM api_keys`).get().count;
  if (count === 0) {
    const initialKey = dbService.createApiKey({
      name: 'Khóa Khởi Tạo Hệ Thống (Default Master Key)',
      allowed_models: ['*'],
      allow_vision: 1,
      rate_limit_rpm: 120
    });
    console.log('===============================================================');
    console.log(' [AI GATEWAY] ĐÃ TẠO API KEY MẶC ĐỊNH LẦN ĐẦU TIÊN:');
    console.log(` API KEY: ${initialKey.apiKey}`);
    console.log(' Hãy sao chép key trên để sử dụng trong Web Chat hoặc ứng dụng!');
    console.log('===============================================================');
  }
}

initDefaultKey();
