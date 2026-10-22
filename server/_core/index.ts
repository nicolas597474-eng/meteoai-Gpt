import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { validateRequiredEnv } from "./env";
import { registerOAuthRoutes } from "./oauth";
import { registerNetatmoOAuthRoutes } from "../netatmoOAuthRoutes";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { rateLimiter, securityHeaders, corsMiddleware, isRateLimitedApiPath } from "./security";
import { weatherHttpCompression } from "./httpCompression";

async function startServer() {
  // Validate environment configuration
  validateRequiredEnv();

  const app = express();
  const server = createServer(app);

  // =============================================================================
  // SECURITY MIDDLEWARE (Order matters!)
  // =============================================================================
  
  // 1. CORS - Must be first to handle preflight requests
  app.use(corsMiddleware);
  
  // 2. Security headers
  app.use(securityHeaders);
  app.use(weatherHttpCompression);
  
  // 3. Limit API traffic, not the JavaScript/CSS needed to render the application.
  app.use((req, res, next) => {
    if (!isRateLimitedApiPath(req.path)) {
      return next();
    }
    return rateLimiter(req, res, next);
  });

  // =============================================================================
  // BODY PARSING
  // =============================================================================
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // =============================================================================
  // ROUTES
  // =============================================================================
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: process.env.VITE_APP_ID || 'unknown'
    });
  });
  
  // Storage proxy
  registerStorageProxy(app);
  
  // OAuth routes
  registerOAuthRoutes(app);
  registerNetatmoOAuthRoutes(app);

  // Scheduled handlers (heartbeat cron callbacks)
  const { collectForecastsHandler, collectObservationsHandler, collectFavoritesForecastsHandler, collectPhysicalObservationSnapshotsHandler } = await import("../scheduledHandlers");
  app.post("/api/scheduled/collect-forecasts", collectForecastsHandler);
  app.post("/api/scheduled/collect-observations", collectObservationsHandler);
  app.post("/api/scheduled/collect-favorites-forecasts", collectFavoritesForecastsHandler);
  app.post("/api/scheduled/collect-physical-observation-snapshots", collectPhysicalObservationSnapshotsHandler);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // =============================================================================
  // STATIC FILES / VITE
  // =============================================================================
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // =============================================================================
  // ERROR HANDLING
  // =============================================================================
  
  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Route ${req.method} ${req.path} not found`
    });
  });

  // Global error handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Error]', err);
    res.status(500).json({
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
    });
  });

  const port = parseInt(process.env.PORT || "3000");

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Rate Limit: ${process.env.RATE_LIMIT_MAX_REQUESTS || 100} requests/minute`);
  });
}

startServer().catch(console.error);
