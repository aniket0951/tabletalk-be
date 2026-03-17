import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";
import { Server } from "socket.io";
import { setIO } from "./lib/socket";
import type { Env } from "./types";

import { authRoutes } from "./routes/auth";
import { restaurantRoutes } from "./routes/restaurant";
import { menuRoutes } from "./routes/menu";
import { tablesRoutes } from "./routes/tables";
import { staffRoutes } from "./routes/staff";
import { staffAuthRoutes } from "./routes/staff-auth";
import { ordersRoutes } from "./routes/orders";
import { staffOrdersRoutes } from "./routes/staff-orders";
import { customersRoutes } from "./routes/customers";
import { dashboardRoutes } from "./routes/dashboard";
import { billingRoutes } from "./routes/billing";
import { userRoutes } from "./routes/user";
import { publicRoutes } from "./routes/public";
import { campaignRoutes } from "./routes/campaigns";
// Debug: log env vars at startup
console.log("[env] DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");
console.log("[env] JWT_SECRET:", process.env.JWT_SECRET ? "SET" : "NOT SET");
console.log("[env] PORT:", process.env.PORT);

const app = new Hono<Env>();

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const allowedOrigins = [
  FRONTEND_URL,
  "http://localhost:3000",
  "http://192.168.1.102:3000",
  "http://192.168.1.105:3000",
].filter(Boolean);

app.use("*", logger());

// Global error handler — adds debug field to all error responses
app.onError((err, c) => {
  console.error(`[${c.req.method} ${c.req.path}] error:`, err);
  return c.json({
    error: "Server error",
    debug: err.message || String(err),
  }, 500);
});

app.use(
  "*",
  cors({
    origin: "*",
    credentials: false,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  })
);

app.get("/health", (c) => c.json({
  status: "ok",
  dbUrl: process.env.DATABASE_URL || "NOT SET",
}));

// Mount routes
app.route("/auth", authRoutes);
app.route("/restaurant", restaurantRoutes);
app.route("/menu", menuRoutes);
app.route("/tables", tablesRoutes);
app.route("/staff/auth", staffAuthRoutes);
app.route("/staff/orders", staffOrdersRoutes);
app.route("/staff", staffRoutes);
app.route("/orders", ordersRoutes);
app.route("/customers", customersRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/billing", billingRoutes);
app.route("/user", userRoutes);
app.route("/public", publicRoutes);
app.route("/campaigns", campaignRoutes);

const PORT = parseInt(process.env.PORT || "3004", 10);

const server = serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`[api] Hono server running on http://0.0.0.0:${info.port}`);
});

// Attach Socket.IO to the same HTTP server
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith(".vercel.app"))) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

setIO(io);

io.on("connection", (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`[socket] client disconnected: ${socket.id}`);
  });
});
