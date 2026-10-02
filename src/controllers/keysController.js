import { dbService } from '../db/database.js';
import { config } from '../config.js';

export const keysController = {
  // Liệt kê danh sách API Keys
  list(req, res) {
    try {
      const keys = dbService.listApiKeys();
      res.json({ data: keys });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  },

  // Tạo API Key mới
  create(req, res) {
    try {
      const { name, allowed_models, allow_vision, rate_limit_rpm, expires_at } = req.body;
      const newKey = dbService.createApiKey({
        name,
        allowed_models: allowed_models || ['*'],
        allow_vision: allow_vision !== undefined ? allow_vision : 1,
        rate_limit_rpm: rate_limit_rpm || config.defaultRateLimitRpm,
        expires_at: expires_at || null
      });

      res.status(201).json({
        message: 'Tạo API Key thành công! Hãy lưu lại chuỗi Key vì nó sẽ không hiển thị lại toàn bộ.',
        data: newKey
      });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  },

  // Thu hồi API Key
  revoke(req, res) {
    try {
      const { id } = req.params;
      dbService.revokeApiKey(id);
      res.json({ message: 'Đã thu hồi API Key thành công.' });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  },

  // Xóa API Key
  remove(req, res) {
    try {
      const { id } = req.params;
      dbService.deleteApiKey(id);
      res.json({ message: 'Đã xóa API Key thành công.' });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  },

  // Thống kê sử dụng
  stats(req, res) {
    try {
      const stats = dbService.getStats();
      res.json({ data: stats });
    } catch (err) {
      res.status(500).json({ error: { message: err.message } });
    }
  },

  // Kiểm tra kết nối đến Local LLM
  async pingBackend(req, res) {
    const startTime = Date.now();
    const targetUrl = `${config.llmBackendUrl}/models`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(targetUrl, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return res.json({
          status: 'online',
          latencyMs,
          backendUrl: config.llmBackendUrl,
          models: data.data || []
        });
      } else {
        return res.status(502).json({
          status: 'error',
          statusCode: response.status,
          latencyMs,
          message: `Local LLM trả về mã lỗi HTTP ${response.status}`,
          backendUrl: config.llmBackendUrl
        });
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return res.status(503).json({
        status: 'offline',
        latencyMs,
        message: `Không thể kết nối đến máy chủ Local LLM tại ${config.llmBackendUrl}. Chi tiết: ${err.message}`,
        backendUrl: config.llmBackendUrl
      });
    }
  }
};
