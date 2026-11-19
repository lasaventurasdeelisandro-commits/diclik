import type { IncomingMessage, ServerResponse } from "node:http";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", "http://localhost");
  const route = url.searchParams.get("__diclik_api_path");
  url.searchParams.delete("__diclik_api_path");

  if (url.pathname === "/api/index" && route) {
    url.pathname = `/api/${route}`;
  }
  req.url = url.pathname + url.search;

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL && !process.env.SQL_HOST) {
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "degraded", database: "not_configured" }));
    return;
  }

  try {
    const { db } = await import("../src/server/db/index.ts");
    await db.init();
  } catch (error) {
    console.error("DICLIK PostgreSQL initialization:", error);
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "degraded", database: "error" }));
    return;
  }

  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret.length < 32 || secret.includes("REPLACE_WITH")) {
    res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ status: "degraded", database: "connected", authentication: "not_configured" }));
    return;
  }

  const { default: app } = await import("../server.ts");
  app(req, res);
}
