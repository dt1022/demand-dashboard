const request = require("supertest");
const app = require("./app");

test("health check", async () => {
  const res = await request(app).get("/api/health");
  expect(res.status).toBe(200);
});

test("rejects a non-numeric product id", async () => {
  const res = await request(app).get("/api/forecast?product=abc");
  expect(res.status).toBe(400);
});

test("returns 404 for unknown product", async () => {
  const res = await request(app).get("/api/inventory-plan?product=9999");
  expect(res.status).toBe(404);
});

test("reorder point is never below safety stock", async () => {
  const res = await request(app).get("/api/inventory-plan?product=1");
  expect(res.body.reorderPoint).toBeGreaterThanOrEqual(res.body.safetyStock);
});