import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  host: process.env.HOST || '0.0.0.0',
  // Địa chỉ backend LLM nội bộ (vLLM / Ollama / SGLang / LMDeploy)
  llmBackendUrl: process.env.LLM_BACKEND_URL || 'http://127.0.0.1:8000/v1',
  // Master key dùng cho quản trị viên tạo/thu hồi API key
  masterAdminKey: process.env.MASTER_ADMIN_KEY || 'admin-secret-local-ai',
  // Model mặc định nếu client không gửi
  defaultModel: process.env.DEFAULT_MODEL || 'qwen2.5-vl-7b-instruct',
  // Giới hạn số request/phút mặc định
  defaultRateLimitRpm: parseInt(process.env.DEFAULT_RATE_LIMIT_RPM || '60', 10),
  // Cấu hình lưu trữ DB
  dbPath: path.resolve(__dirname, '../data/gateway.db')
};
