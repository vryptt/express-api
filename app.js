import express from "express";
import morgan from "morgan";
import compression from "compression";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import slowDown from "express-slow-down";
import { createRequire } from "module";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler.js";
import swaggerUi from "swagger-ui-express";
import {
  loadRoutesFromDir,
  getRouter,
  getSpec,
  config
} from "./lib/handler.js";
import { logger } from "./lib/logger.js";
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

dotenv.config();

async function initializeRoutes(app) {
  try {
    const routesDir = config.paths?.routesDirectory || "./plugins";
    logger.info(`Loading routes from: ${routesDir}`);
    await loadRoutesFromDir(routesDir);
    logger.info("Routes loaded successfully");
    app.use("/api", getRouter());
  } catch (error) {
    logger.error("Failed to load routes:", error);
  }
}

async function createApp() {
  const app = express();

  app.set("trust proxy", process.env.TRUST_PROXY || 1);
  app.disable("x-powered-by");

  app.use(security);
  app.use(requestId);
  app.use(metrics);

  morgan.token("id", (req) => req.id);
  morgan.token("user-agent", (req) => req.get("User-Agent"));

  const logFormat = ':id :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :response-time ms'

  app.use(
    morgan(logFormat, {
      stream: {
        write: (message) => logger.info(message.trim())
      }
    })
  );

  app.use(
    express.json({
      limit: "10mb",
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    })
  );

  app.use(
    express.urlencoded({
      extended: true,
      limit: "10mb"
    })
  );

  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
      level: 6,
      threshold: 1024
    })
  );

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
        return req.path === "/health";
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
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(getSpec());
  });
    
  app.use("/docs", swaggerUi.serve);
  app.get("/docs", swaggerUi.setup(getSpec(), {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: config.api?.title || "API Documentation"
    })
  );

  await initializeRoutes(app);

  app.use(
    "/static",
    express.static(path.join(__dirname, "public"), {
      maxAge: process.env.STATIC_MAX_AGE || "1d",
      setHeaders: (res, path) => {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("X-Frame-Options", "DENY");
      }
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  gracefulShutdown();
});
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown();
});

export default createApp;