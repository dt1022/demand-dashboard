import { useEffect, useState } from "react";
import {
  ComposedChart, BarChart, Bar, Line, Area, XAxis, YAxis,
  Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from "recharts";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const NAV = ["Overview", "Forecast", "Inventory", "Reports", "Settings"];
const TITLES = {
  Overview: "Demand Forecast Overview",
  Forecast: "Detailed Forecast",
  Inventory: "Inventory Status",
  Reports: "Reports",
  Settings: "Settings",
};

async function getJSON(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

const tooltipStyle = {
  background: "rgba(255,255,255,0.85)",
  border: "1px solid #fff",
  borderRadius: 12,
};

// turns the inventory table into a CSV file and downloads it
function downloadCSV(products) {
  const cols = ["item", "onHand", "leadTimeWeeks", "safetyStock", "reorderPoint", "reorderNow", "stockoutWeek", "orderQty"];
  const lines = products.map((p) => cols.map((c) => p[c] ?? "").join(","));
  const blob = new Blob([[cols.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "inventory-plan.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function Kpi({ label, value, note, tint, warn }) {
  return (
    <div className={`glass kpi ${tint}`}>
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${warn ? "warn" : ""}`}>{value}</div>
      {note && <div className="kpi-note">{note}</div>}
    </div>
  );
}

function ForecastChart({ chart, loading, height }) {
  if (loading) return <p>Loading…</p>;
  return (
    <div className="chart-box" style={height ? { height } : undefined}>
      <ResponsiveContainer>
        <ComposedChart data={chart}>
          <defs>
            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#8aa8ff" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#8aa8ff" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(120,130,170,0.15)" vertical={false} />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} minTickGap={30} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend />
          <Area dataKey="band" name="80% range" stroke="none" fill="url(#bandFill)" />
          <Line type="monotone" dataKey="actual" name="Actual" stroke="#6f9bf5" strokeWidth={2.5} dot={false} />
          <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#f59e7b" strokeWidth={2.5} strokeDasharray="5 4" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function App() {
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [product, setProduct] = useState(1);
  const [chart, setChart] = useState([]);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [nav, setNav] = useState("Overview");
  const [search, setSearch] = useState("");
  const [onlyReorder, setOnlyReorder] = useState(false);

  // settings, remembered between visits
  const [blur, setBlur] = useState(() => Number(localStorage.getItem("blur")) || 16);
  const [alpha, setAlpha] = useState(() => Number(localStorage.getItem("alpha")) || 45);

  useEffect(() => {
    document.documentElement.style.setProperty("--blur", `${blur}px`);
    document.documentElement.style.setProperty("--glass-alpha", alpha / 100);
    localStorage.setItem("blur", blur);
    localStorage.setItem("alpha", alpha);
  }, [blur, alpha]);

  useEffect(() => {
    Promise.all([getJSON("/api/summary"), getJSON("/api/products")])
      .then(([s, p]) => {
        setSummary(s);
        setProducts(p);
        if (p.length) setProduct(p[0].item);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getJSON(`/api/forecast?product=${product}`),
      getJSON(`/api/inventory-plan?product=${product}`),
    ])
      .then(([f, p]) => {
        const rows = f.actuals.map((a) => ({ week: a.week, actual: a.sales }));
        rows[rows.length - 1].forecast = rows[rows.length - 1].actual;
        f.forecast.forEach((r) =>
          rows.push({
            week: r.week,
            forecast: Math.round(r.yhat),
            band: [Math.round(r.lower), Math.round(r.upper)],
          })
        );
        setChart(rows);
        setPlan(p);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [product]);

  if (error) return <div className="glass panel" style={{ margin: 24 }}>Something went wrong: {error}</div>;

  const reorderList = products.filter((p) => p.reorderNow);
  const forecastRows = chart.filter((r) => r.band);

  const visibleProducts = products
    .filter((p) => (onlyReorder ? p.reorderNow : true))
    .filter((p) => String(p.item).includes(search.trim()));

  const improvement =
    summary && summary.maeBaseline > 0
      ? Math.round(((summary.maeBaseline - summary.maeModel) / summary.maeBaseline) * 100)
      : 0;

  return (
    <div className="shell">
      {/* ---------- sidebar ---------- */}
      <aside className="glass sidebar">
        <div className="brand">Demand AI</div>
        {NAV.map((n) => (
          <div key={n} className={`nav-item ${nav === n ? "active" : ""}`} onClick={() => setNav(n)}>
            {n}
          </div>
        ))}
      </aside>

      <main className="main">
        {/* ---------- top bar ---------- */}
        <div className="glass topbar">
          <h1>{TITLES[nav]}</h1>
          {(nav === "Overview" || nav === "Forecast") && (
            <select className="select" value={product} onChange={(e) => setProduct(Number(e.target.value))}>
              {products.map((p) => (
                <option key={p.item} value={p.item}>Item {p.item}</option>
              ))}
            </select>
          )}
        </div>

        {/* ================= OVERVIEW ================= */}
        {nav === "Overview" && (
          <>
            {summary && (
              <div className="kpi-grid">
                <Kpi tint="tint-blue" label="Forecast error (MAPE)" value={`${summary.mape}%`} note="lower is better" />
                <Kpi tint="tint-green" label="Model MAE" value={summary.maeModel} note={`baseline: ${summary.maeBaseline}`} />
                <Kpi tint="tint-pink" label="Products tracked" value={summary.products} />
                <Kpi tint="tint-amber" label="Need reorder now" value={summary.atRisk} warn={summary.atRisk > 0} />
              </div>
            )}

            <div className="grid-2">
              <div className="glass panel">
                <h3>Demand forecast: Item {product}</h3>
                <ForecastChart chart={chart} loading={loading} />
              </div>
              <div className="glass panel">
                <h3>Next 8 weeks (units)</h3>
                <div className="chart-box">
                  <ResponsiveContainer>
                    <BarChart data={forecastRows}>
                      <CartesianGrid stroke="rgba(120,130,170,0.15)" vertical={false} />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(d) => d.slice(5)} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="forecast" name="Forecast" fill="#a9c1ff" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {plan && (
              <div className="kpi-grid">
                <Kpi tint="tint-blue" label="On hand" value={plan.onHand} />
                <Kpi tint="tint-green" label="Reorder point" value={plan.reorderPoint} />
                <Kpi tint="tint-pink" label="Safety stock" value={plan.safetyStock} />
                <Kpi tint="tint-amber" label="Stockout week" value={plan.stockoutWeek ?? "None in 8 wks"} warn={!!plan.stockoutWeek} />
              </div>
            )}

            <div className="glass panel">
              <h3>Reorder now</h3>
              {reorderList.length === 0 ? (
                <p>All products are above their reorder point.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      {["Item", "On hand", "Reorder point", "Lead time (wks)", "Suggested order"].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reorderList.map((p) => (
                      <tr key={p.item}>
                        <td>Item {p.item}</td>
                        <td>{p.onHand}</td>
                        <td>{p.reorderPoint}</td>
                        <td>{p.leadTimeWeeks}</td>
                        <td><span className="pill">Order {p.orderQty}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* ================= FORECAST ================= */}
        {nav === "Forecast" && (
          <>
            <div className="glass panel">
              <h3>Item {product}: last 52 weeks and next 8</h3>
              <ForecastChart chart={chart} loading={loading} height={380} />
            </div>

            <div className="glass panel">
              <h3>Week-by-week forecast</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Week ending</th>
                    <th>Forecast (units)</th>
                    <th>Low (80%)</th>
                    <th>High (80%)</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastRows.map((r) => (
                    <tr key={r.week}>
                      <td>{r.week}</td>
                      <td><b>{r.forecast}</b></td>
                      <td>{r.band[0]}</td>
                      <td>{r.band[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ================= INVENTORY ================= */}
        {nav === "Inventory" && (
          <div className="glass panel">
            <div className="toolbar">
              <input
                className="select"
                placeholder="Search item number…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className={`btn ${!onlyReorder ? "active" : ""}`} onClick={() => setOnlyReorder(false)}>
                All ({products.length})
              </button>
              <button className={`btn ${onlyReorder ? "active" : ""}`} onClick={() => setOnlyReorder(true)}>
                Needs reorder ({reorderList.length})
              </button>
            </div>

            {visibleProducts.length === 0 ? (
              <p>No products match.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    {["Item", "On hand", "Reorder point", "Safety stock", "Stockout week", "Status"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((p) => (
                    <tr key={p.item}>
                      <td>Item {p.item}</td>
                      <td>{p.onHand}</td>
                      <td>{p.reorderPoint}</td>
                      <td>{p.safetyStock}</td>
                      <td>{p.stockoutWeek ?? "None"}</td>
                      <td>
                        <span className={`status ${p.reorderNow ? "bad" : "ok"}`}>
                          {p.reorderNow ? "Reorder" : "OK"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ================= REPORTS ================= */}
        {nav === "Reports" && summary && (
          <>
            <div className="kpi-grid">
              <Kpi tint="tint-blue" label="Forecast error (MAPE)" value={`${summary.mape}%`} />
              <Kpi tint="tint-green" label="Better than baseline" value={`${improvement}%`} note="lower MAE vs seasonal naive" />
              <Kpi tint="tint-amber" label="Items needing reorder" value={summary.atRisk} warn={summary.atRisk > 0} />
            </div>

            <div className="glass panel">
              <h3>Model vs baseline (mean absolute error, lower is better)</h3>
              <div className="chart-box">
                <ResponsiveContainer>
                  <BarChart
                    data={[
                      { name: "Baseline", mae: summary.maeBaseline },
                      { name: "XGBoost model", mae: summary.maeModel },
                    ]}
                  >
                    <CartesianGrid stroke="rgba(120,130,170,0.15)" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="mae" name="MAE" fill="#a9c1ff" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass panel">
              <h3>Export</h3>
              <p>Download the full inventory plan for all products as a spreadsheet-friendly CSV.</p>
              <button className="btn active" onClick={() => downloadCSV(products)}>
                Download CSV
              </button>
            </div>
          </>
        )}

        {/* ================= SETTINGS ================= */}
        {nav === "Settings" && (
          <div className="glass panel">
            <h3>Appearance</h3>
            <div className="slider-row">
              <label>Glass blur: {blur}px</label>
              <input type="range" min="0" max="40" value={blur} onChange={(e) => setBlur(Number(e.target.value))} />
            </div>
            <div className="slider-row">
              <label>Transparency: {alpha}%</label>
              <input type="range" min="10" max="90" value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} />
            </div>
            <button
              className="btn"
              onClick={() => {
                setBlur(16);
                setAlpha(45);
              }}
            >
              Reset to default
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
