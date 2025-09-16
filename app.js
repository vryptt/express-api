import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import slowDown from "express-slow-down";
import { createRequire } from "module";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import { RouterPlugin } from "./lib/handler.js";
import { logger } from "./lib/logger.js";
import { validateEnv } from "./lib/config.js";
import { gracefulShutdown } from "./lib/graceful-shutdown.js";
import { healthCheck } from "./middlewares/health.js";
import { requestId } from "./middlewares/requestId.js";
import { security } from "./middlewares/security.js";
import { metrics } from "./middlewares/metrics.js";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config()
validateEnv();

async function createApp() {
  const app = express();
  
  app.set("trust proxy", process.env.TRUST_PROXY || 1);
  app.disable("x-powered-by");

  const plugin = new RouterPlugin({
    title: process.env.API_TITLE || "Advanced Modular API",
    version: process.env.API_VERSION || "1.0.0",
    description: process.env.API_DESCRIPTION || "Production-ready API with modular plugin-based architecture",
    servers: [
      { 
        url: process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`, 
        description: process.env.NODE_ENV === "production" ? "Production server" : "Development server"
      }
    ],
    contact: {
      name: process.env.API_CONTACT_NAME || "API Support",
      email: process.env.API_CONTACT_EMAIL || "support@example.com",
      url: process.env.API_CONTACT_URL || "https://example.com/support"
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT"
    }
  });

  try {
    await plugin.loadRoutesFromDir(path.join(__dirname, "plugins"));
    logger.info(`Loaded ${plugin.getRoutesCount()} routes from plugins`);
  } catch (error) {
    logger.error("Failed to load routes:", error);
    throw error;
  }

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  app.use(security);
  app.use(requestId);
  app.use(metrics);

  const corsOptions = {
    origin: function (origin, callback) {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',') || ['*'];
      
      if (!origin && process.env.NODE_ENV === 'development') return callback(null, true);
      
      if (allowedOrigins.includes('*') || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Origin',
      'X-Requested-With',
      'Content-Type',
      'Accept',
      'Authorization',
      'X-Request-ID',
      'X-API-Key'
    ],
    exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']
  };

  app.use(cors(corsOptions));

  morgan.token('id', (req) => req.id);
  morgan.token('user-agent', (req) => req.get('User-Agent'));
  
  const logFormat = process.env.NODE_ENV === 'production'
    ? ':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'
    : ':id :method :url :status :response-time ms - :res[content-length]';

  app.use(morgan(logFormat, {
    stream: {
      write: (message) => logger.info(message.trim())
    }
  }));

  app.use(express.json({ 
    limit: process.env.JSON_LIMIT || "10mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));
  
  app.use(express.urlencoded({ 
    extended: true, 
    limit: process.env.URL_ENCODED_LIMIT || "10mb" 
  }));

  app.use(cookieParser(process.env.COOKIE_SECRET));

  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    },
    level: parseInt(process.env.COMPRESSION_LEVEL) || 6,
    threshold: 1024
  }));

  const createRateLimit = (windowMs, max, skipSuccessfulRequests = false) => 
    rateLimit({
      windowMs,
      max,
      skipSuccessfulRequests,
      message: { 
        error: "Too many requests from this IP, please try again later.",
        retryAfter: Math.ceil(windowMs / 1000)
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req, res) => {
        return req.user?.id || ipKeyGenerator(req, res);
      },
      skip: (req) => {
        return req.path === '/health';
      }
    });

  const generalLimiter = createRateLimit(15 * 60 * 1000, 100);
  const strictLimiter = createRateLimit(15 * 60 * 1000, 20);
  const authLimiter = createRateLimit(15 * 60 * 1000, 5);

  const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: 50,
    delayMs: (used, req) => {
      const delayAfter = req.slowDown.limit;
      return (used - delayAfter) * 500;
    }
  });

  app.use("/api", speedLimiter);
  app.use("/api", generalLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/admin", strictLimiter);

  app.use("/health", healthCheck);
  app.get("/", (req, res) => {
    res.json({
      message: "API is running",
      version: process.env.API_VERSION || "1.0.0",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development"
    });
  });

  app.get("/openapi.json", (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json(plugin.getSpec());
  });

  app.get("/docs", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>API Documentation</title>
          <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui.css" />
        </head>
        <body>
          <div id="swagger-ui"></div>
          <script src="https://unpkg.com/swagger-ui-dist@3.52.5/swagger-ui-bundle.js"></script>
          <script>
            SwaggerUIBundle({
              url: '/openapi.json',
              dom_id: '#swagger-ui',
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIBundle.presets.standalone
              ]
            });
          </script>
        </body>
      </html>
    `);
  });

  app.use("/api", plugin.getRouter());

  if (process.env.SERVE_STATIC === 'true') {
    app.use("/static", express.static(path.join(__dirname, "public"), {
      maxAge: process.env.STATIC_MAX_AGE || '1d',
      setHeaders: (res, path) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
      }
    }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  gracefulShutdown();
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

export default createApp;