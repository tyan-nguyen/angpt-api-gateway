import { Router } from 'express';
import { apiKeyAuth, adminAuth } from '../middleware/auth.js';
import { keyRateLimiter } from '../middleware/rateLimit.js';
import { proxyController } from '../controllers/proxyController.js';
import { keysController } from '../controllers/keysController.js';

export const apiRouter = Router();

// Health check công khai
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Local AI API Gateway'
  });
});

// Endpoint kiểm tra kết nối đến Local LLM (yêu cầu API Key hoặc Admin Key)
apiRouter.get('/ping-llm', apiKeyAuth, keysController.pingBackend);

// Các endpoint chuẩn OpenAI (Proxy vào Local LLM với kiểm tra quyền & Rate Limiting)
apiRouter.post('/chat/completions', apiKeyAuth, keyRateLimiter, proxyController.chatCompletions);
apiRouter.get('/models', apiKeyAuth, proxyController.getModels);

// Các endpoint Quản trị viên (Admin - Quản lý API Key)
apiRouter.get('/admin/keys', adminAuth, keysController.list);
apiRouter.post('/admin/keys', adminAuth, keysController.create);
apiRouter.post('/admin/keys/:id/revoke', adminAuth, keysController.revoke);
apiRouter.delete('/admin/keys/:id', adminAuth, keysController.remove);
apiRouter.get('/admin/stats', adminAuth, keysController.stats);
