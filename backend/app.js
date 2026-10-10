const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || "../model/demand.db";
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const Z_SERVICE = 1.65; // ~95% service level
const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));

const round = (n) => Math.round(n);

function parseProduct(req) {
  const id = Number.parseInt(req.query.product, 10);
  return Number.isInteger(id) ? id : null;
}

function planFor(item) {
  const inv = db.prepare("SELECT * FROM inventory WHERE item = ?").get(item);
  if (!inv) return null;
  const fc = db.prepare("SELECT * FROM forecasts WHERE item = ? ORDER BY week").all(item);

  const L = inv.lead_time_weeks;
  const demandDuringLead = fc.slice(0, L).reduce((s, r) => s + r.yhat, 0);
  const safetyStock = Z_SERVICE * fc[0].sigma * Math.sqrt(L);
  const reorderPoint = demandDuringLead + safetyStock;

  // when does current stock run out under the forecast?
  let stock = inv.on_hand;
  let stockoutWeek = null;
  for (const r of fc) {
    stock -= r.yhat;
    if (stock <= 0) { stockoutWeek = r.week; break; }
  }

  // order enough to cover lead time + 4 weeks, plus safety stock
  const target = fc.slice(0, L + 4).reduce((s, r) => s + r.yhat, 0) + safetyStock;
  const orderQty = Math.max(0, Math.ceil(target - inv.on_hand));

  return {
    item,
    onHand: inv.on_hand,
    leadTimeWeeks: L,
    safetyStock: round(safetyStock),
    reorderPoint: round(reorderPoint),
    reorderNow: inv.on_hand <= reorderPoint,
    stockoutWeek,
    orderQty,
  };
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

app.get("/api/products", (_req, res) => {
  const items = db.prepare("SELECT item FROM inventory ORDER BY item").all();
  res.json(items.map((r) => planFor(r.item)));
});

app.get("/api/forecast", (req, res) => {
  const item = parseProduct(req);
  if (item === null) return res.status(400).json({ error: "product must be an integer" });

  const forecast = db.prepare("SELECT week, yhat, lower, upper FROM forecasts WHERE item = ? ORDER BY week").all(item);
  if (!forecast.length) return res.status(404).json({ error: "product not found" });

  const actuals = db
    .prepare("SELECT week, sales FROM actuals WHERE item = ? ORDER BY week DESC LIMIT 52")
    .all(item)
    .reverse();
  res.json({ item, actuals, forecast });
});

app.get("/api/inventory-plan", (req, res) => {
  const item = parseProduct(req);
  if (item === null) return res.status(400).json({ error: "product must be an integer" });
  const plan = planFor(item);
  if (!plan) return res.status(404).json({ error: "product not found" });
  res.json(plan);
});

app.get("/api/summary", (_req, res) => {
  const m = Object.fromEntries(
    db.prepare("SELECT name, value FROM metrics").all().map((r) => [r.name, r.value])
  );
  const items = db.prepare("SELECT item FROM inventory").all();
  const atRisk = items.filter((r) => planFor(r.item).reorderNow).length;
  res.json({
    mape: Number(m.mape.toFixed(1)),
    maeModel: Number(m.mae_model.toFixed(1)),
    maeBaseline: Number(m.mae_baseline.toFixed(1)),
    products: items.length,
    atRisk,
  });
});

// error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

module.exports = app;