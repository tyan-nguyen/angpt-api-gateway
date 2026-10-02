import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';

const app = express();

// Cấu hình CORS linh hoạt
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-admin-key']
}));

// Hỗ trợ payload lớn cho Vision (ảnh base64 nhiều ảnh cùng lúc)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging mọi request qua Gateway
app.use((req, res, next) => {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${req.method} ${req.originalUrl}`);
  next();
});

// Mount các tuyến đường API
app.use('/api/v1', apiRouter);
app.use('/v1', apiRouter); // Alias cho tương thích chuẩn OpenAI

// Xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error('[Gateway Error]:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Lỗi máy chủ nội bộ',
      type: 'internal_server_error'
    }
  });
});

app.listen(config.port, config.host, () => {
  console.log('================================================================');
  console.log(` 🛡️  AI API GATEWAY & SECURITY PROXY ĐÃ KHỞI CHẠY THÀNH CÔNG!`);
  console.log(` 🚀 Địa chỉ Gateway: http://${config.host}:${config.port}/api/v1`);
  console.log(` 🎯 Local LLM Backend: ${config.llmBackendUrl}`);
  console.log(` 🔑 Master Admin Key: ${config.masterAdminKey}`);
  console.log(` 🤖 Model mặc định: ${config.defaultModel}`);
  console.log('================================================================');
});
