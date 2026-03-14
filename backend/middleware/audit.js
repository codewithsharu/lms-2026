const supabase = require('../config/supabase');

const logAction = async (req, actionType, resourceType, resourceId, changes = null) => {
  try {
    const logEntry = {
      user_id: req.user?.id || null,
      user_email: req.user?.email || 'anonymous',
      user_role: req.user?.role || 'anonymous',
      action_type: actionType,
      resource_type: resourceType,
      resource_id: resourceId,
      api_endpoint: req.originalUrl,
      http_method: req.method,
      request_body: sanitizeRequestBody(req.body),
      ip_address: req.ip || req.connection?.remoteAddress,
      user_agent: req.get('User-Agent'),
      changes: changes
    };

    await supabase.from('audit_logs').insert(logEntry);
  } catch (error) {
    console.error('Audit log error:', error);
    // Don't throw - audit logging should not break main functionality
  }
};

// Remove sensitive fields from request body before logging
const sanitizeRequestBody = (body) => {
  if (!body) return null;
  
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'password_hash', 'token', 'secret'];
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
};

// Middleware to automatically log all requests
const auditMiddleware = (req, res, next) => {
  const originalSend = res.send;
  
  res.send = function(data) {
    res.responseBody = data;
    res.responseStatus = res.statusCode;
    return originalSend.apply(res, arguments);
  };
  
  res.on('finish', () => {
    // Only log mutating requests automatically
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const resourceType = extractResourceType(req.originalUrl);
      logAction(req, req.method, resourceType, null, null);
    }
  });
  
  next();
};

const extractResourceType = (url) => {
  const parts = url.split('/').filter(p => p && p !== 'api');
  return parts[0] || 'unknown';
};

module.exports = {
  logAction,
  auditMiddleware
};
