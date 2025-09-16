const metrics = {
  requests: 0,
  responses: { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 },
  averageResponseTime: 0,
  totalResponseTime: 0
};

export function metricsMiddleware(req, res, next) {
  const startTime = Date.now();
  
  metrics.requests++;
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    
    metrics.responses[statusClass] = (metrics.responses[statusClass] || 0) + 1;
    metrics.totalResponseTime += responseTime;
    metrics.averageResponseTime = metrics.totalResponseTime / metrics.requests;
  });
  
  next();
}

export function getMetrics() {
  return metrics;
}

export { metricsMiddleware as metrics };