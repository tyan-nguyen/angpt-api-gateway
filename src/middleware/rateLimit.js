// Bộ nhớ tạm lưu vết request theo từng Key
const keyRequestBuckets = new Map();

// Dọn dẹp bộ nhớ mỗi 5 phút
setInterval(() => {
  const oneMinuteAgo = Date.now() - 60000;
  for (const [keyId, timestamps] of keyRequestBuckets.entries()) {
    const fresh = timestamps.filter(t => t > oneMinuteAgo);
    if (fresh.length === 0) {
      keyRequestBuckets.delete(keyId);
    } else {
      keyRequestBuckets.set(keyId, fresh);
    }
  }
}, 300000);

export function keyRateLimiter(req, res, next) {
  // Lấy keyId từ middleware auth đã gán, hoặc lấy IP
  const keyId = req.apiKeyInfo?.id || req.ip;
  const maxRpm = req.apiKeyInfo?.rate_limit_rpm || 60;

  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  let timestamps = keyRequestBuckets.get(keyId) || [];
  // Lọc chỉ giữ các request trong 60 giây gần nhất
  timestamps = timestamps.filter(t => t > oneMinuteAgo);

  if (timestamps.length >= maxRpm) {
    return res.status(429).json({
      error: {
        message: `Đã vượt quá giới hạn tần suất yêu cầu (${maxRpm} requests/phút). Vui lòng thử lại sau giây lát.`,
        type: 'rate_limit_exceeded',
        code: 'rate_limit_rpm'
      }
    });
  }

  timestamps.push(now);
  keyRequestBuckets.set(keyId, timestamps);

  // Thêm header thông tin rate limit
  res.setHeader('X-RateLimit-Limit', maxRpm);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRpm - timestamps.length));

  next();
}
