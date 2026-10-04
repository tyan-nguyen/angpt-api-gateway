import { config } from '../config.js';
import { dbService } from '../db/database.js';

export const proxyController = {
  // Chuyển tiếp Chat Completions (hỗ trợ SSE Streaming mượt mà)
  async chatCompletions(req, res) {
    const startTime = Date.now();
    const apiKeyInfo = req.apiKeyInfo;
    const { model, messages, stream = false } = req.body;

    const requestedModel = model || config.defaultModel;

    // 1. Kiểm tra quyền truy cập model
    if (apiKeyInfo && apiKeyInfo.allowed_models && !apiKeyInfo.allowed_models.includes('*')) {
      if (!apiKeyInfo.allowed_models.includes(requestedModel)) {
        return res.status(403).json({
          error: {
            message: `API Key này không có quyền truy cập model '${requestedModel}'. Các model được phép: ${apiKeyInfo.allowed_models.join(', ')}`,
            type: 'permission_denied',
            code: 'model_not_allowed'
          }
        });
      }
    }

    // 2. Kiểm tra xem payload có chứa ảnh (Vision) không
    let hasImages = false;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part && (part.type === 'image_url' || part.type === 'image')) {
              hasImages = true;
              break;
            }
          }
        }
        if (hasImages) break;
      }
    }

    // 3. Nếu có ảnh, kiểm tra quyền Vision của Key
    if (hasImages && apiKeyInfo && apiKeyInfo.allow_vision === 0) {
      return res.status(403).json({
        error: {
          message: 'API Key này không được cấp quyền gửi dữ liệu hình ảnh (Vision).',
          type: 'permission_denied',
          code: 'vision_disabled'
        }
      });
    }

    const targetUrl = `${config.llmBackendUrl}/chat/completions`;
    const abortController = new AbortController();

    // Hủy request đến LLM CHỈ KHI client thực sự ngắt kết nối (res.on('close'))
    res.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    // Timeout 5 phút nếu không nhận được phản hồi từ Local LLM (phù hợp với tác vụ suy luận GPU/CPU)
    let timedOut = false;
    const connectTimeout = setTimeout(() => {
      timedOut = true;
      abortController.abort(new Error('TIMEOUT_LLM'));
    }, 300000);

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...req.body,
          model: requestedModel
        }),
        signal: abortController.signal
      });
      clearTimeout(connectTimeout);

      if (!response.ok) {
        const errorText = await response.text();
        const latencyMs = Date.now() - startTime;
        dbService.logAudit({
          key_id: apiKeyInfo?.id,
          endpoint: '/chat/completions',
          model: requestedModel,
          has_images: hasImages,
          status_code: response.status,
          latency_ms: latencyMs
        });

        let errorJson;
        try {
          errorJson = JSON.parse(errorText);
        } catch {
          errorJson = { error: { message: errorText || `Local LLM returned ${response.status}` } };
        }
        return res.status(response.status).json(errorJson);
      }

      // Xử lý chế độ Streaming (SSE)
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // Tắt buffering trên Nginx/Proxy nếu có

        if (res.flushHeaders) {
          res.flushHeaders();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
          }
        } catch (streamErr) {
          if (streamErr.name !== 'AbortError') {
            console.error('Lỗi khi streaming dữ liệu từ LLM:', streamErr);
          }
        } finally {
          res.end();
          const latencyMs = Date.now() - startTime;
          dbService.recordKeyUsage(apiKeyInfo?.id);
          dbService.logAudit({
            key_id: apiKeyInfo?.id,
            endpoint: '/chat/completions',
            model: requestedModel,
            has_images: hasImages,
            status_code: 200,
            latency_ms: latencyMs
          });
        }
      } else {
        // Chế độ phản hồi thông thường (Non-streaming)
        const data = await response.json();
        const latencyMs = Date.now() - startTime;
        dbService.recordKeyUsage(apiKeyInfo?.id);
        dbService.logAudit({
          key_id: apiKeyInfo?.id,
          endpoint: '/chat/completions',
          model: requestedModel,
          has_images: hasImages,
          status_code: 200,
          latency_ms: latencyMs
        });
        return res.json(data);
      }
    } catch (err) {
      clearTimeout(connectTimeout);
      const latencyMs = Date.now() - startTime;
      dbService.logAudit({
        key_id: apiKeyInfo?.id,
        endpoint: '/chat/completions',
        model: requestedModel,
        has_images: hasImages,
        status_code: timedOut ? 504 : 502,
        latency_ms: latencyMs
      });

      // Nếu client tự ngắt kết nối (đóng tab trình duyệt)
      if (res.writableEnded || (err.name === 'AbortError' && !timedOut)) {
        return;
      }

      console.error('Lỗi kết nối Local LLM:', err.message);
      if (!res.headersSent) {
        return res.status(timedOut ? 504 : 502).json({
          error: {
            message: timedOut
              ? `Local LLM (${config.llmBackendUrl}) không kịp phản hồi trong 5 phút.`
              : `Không thể kết nối hoặc nhận phản hồi từ Local LLM (${config.llmBackendUrl}): ${err.message}`,
            type: timedOut ? 'gateway_timeout' : 'backend_connection_error',
            code: timedOut ? 'timeout' : 'bad_gateway'
          }
        });
      } else {
        res.end();
      }
    }
  },

  // Lấy danh sách các model khả dụng từ Local LLM
  async getModels(req, res) {
    const targetUrl = `${config.llmBackendUrl}/models`;
    const apiKeyInfo = req.apiKeyInfo;

    try {
      const response = await fetch(targetUrl, {
        method: 'GET'
      });

      if (!response.ok) {
        // Nếu backend chưa chạy hoặc không có endpoint /models, trả về model mặc định
        return res.json({
          object: 'list',
          data: [{ id: config.defaultModel, object: 'model', owned_by: 'local' }]
        });
      }

      const data = await response.json();
      let models = data.data || [];

      // Lọc danh sách model theo quyền của Key
      if (apiKeyInfo && apiKeyInfo.allowed_models && !apiKeyInfo.allowed_models.includes('*')) {
        models = models.filter(m => apiKeyInfo.allowed_models.includes(m.id));
      }

      // Đảm bảo defaultModel luôn có mặt
      if (!models.some(m => m.id === config.defaultModel)) {
        models.unshift({ id: config.defaultModel, object: 'model', owned_by: 'local' });
      }

      res.json({ object: 'list', data: models });
    } catch (err) {
      // Fallback an toàn nếu LLM backend chưa khởi động
      res.json({
        object: 'list',
        data: [{ id: config.defaultModel, object: 'model', owned_by: 'local' }]
      });
    }
  }
};
