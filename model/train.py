import sqlite3
import numpy as np
import pandas as pd
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error

H = 8                      # forecast horizon (weeks)
TEST_WEEKS = 26            # holdout window
LAGS = (H, H + 1, H + 4, 52)
Z80 = 1.28                 # z-score for 80% interval

# ---------- 1. Load + clean ----------
df = pd.read_csv("train.csv", parse_dates=["date"])
print(df.isna().sum())
print(df["sales"].describe())

df = df.dropna()
df = df[df["sales"] >= 0]                      # negative sales = data error
df = df[(df["store"] <= 5) & (df["item"] <= 10)]   # subset to keep it fast

# ---------- 2. Weekly totals per product ----------
weekly = (
    df.groupby(["item", pd.Grouper(key="date", freq="W")])["sales"]
    .sum()
    .reset_index()
    .rename(columns={"date": "week"})
)
weekly = weekly[weekly["week"] > weekly["week"].min()]  # first week is partial
last_week = weekly["week"].max()

# ---------- 3. Add empty future rows ----------
future_weeks = pd.date_range(last_week + pd.Timedelta(weeks=1), periods=H, freq="W")
future = pd.DataFrame(
    [(i, w) for i in weekly["item"].unique() for w in future_weeks],
    columns=["item", "week"],
)
future["sales"] = np.nan
full = pd.concat([weekly, future], ignore_index=True)

# ---------- 4. Feature engineering ----------
FEATURES = ["item"] + [f"lag_{l}" for l in LAGS] + ["roll_mean_4", "woy", "month"]

def add_features(g):
    g = g.sort_values("week").copy()
    for lag in LAGS:
        g[f"lag_{lag}"] = g["sales"].shift(lag)
    g["roll_mean_4"] = g["sales"].shift(H).rolling(4).mean()
    g["woy"] = g["week"].dt.isocalendar().week.astype(int)
    g["month"] = g["week"].dt.month
    return g

full = pd.concat([add_features(g) for _, g in full.groupby("item")], ignore_index=True)

known = full[full["week"] <= last_week].dropna(subset=FEATURES + ["sales"])
future_rows = full[full["week"] > last_week].copy()

# ---------- 5. Time-based split ----------
cutoff = last_week - pd.Timedelta(weeks=TEST_WEEKS)
train = known[known["week"] <= cutoff]
test = known[known["week"] > cutoff]

params = dict(n_estimators=400, learning_rate=0.05, max_depth=4,
              subsample=0.8, random_state=42)
model = XGBRegressor(**params)
model.fit(train[FEATURES], train["sales"])

pred = model.predict(test[FEATURES])
baseline = test["lag_52"]                      # seasonal naive: same week last year

mae_model = mean_absolute_error(test["sales"], pred)
mae_base = mean_absolute_error(test["sales"], baseline)
mape = (np.abs(test["sales"] - pred) / test["sales"].clip(lower=1)).mean() * 100

print(f"Baseline MAE: {mae_base:.1f}")
print(f"Model MAE:    {mae_model:.1f}")
print(f"Model MAPE:   {mape:.1f}%")

# per-product error spread -> used for intervals and safety stock
sigma = (test["sales"] - pred).groupby(test["item"]).std()

# ---------- 6. Refit on all known data, forecast the future ----------
model = XGBRegressor(**params)
model.fit(known[FEATURES], known["sales"])

future_rows["yhat"] = model.predict(future_rows[FEATURES]).clip(min=0)
future_rows["sigma"] = future_rows["item"].map(sigma)
future_rows["lower"] = (future_rows["yhat"] - Z80 * future_rows["sigma"]).clip(lower=0)
future_rows["upper"] = future_rows["yhat"] + Z80 * future_rows["sigma"]

# ---------- 7. Fake-but-reasonable inventory data ----------
rng = np.random.default_rng(42)
avg = weekly.groupby("item")["sales"].mean()
inventory = pd.DataFrame({
    "item": avg.index,
    "on_hand": (avg.values * rng.uniform(1.5, 6, len(avg))).round().astype(int),
    "lead_time_weeks": rng.integers(1, 5, len(avg)),
})

# ---------- 8. Save everything to SQLite ----------
def fmt(d):
    d = d.copy()
    d["week"] = d["week"].dt.strftime("%Y-%m-%d")
    return d

con = sqlite3.connect("demand.db")
fmt(weekly)[["item", "week", "sales"]].to_sql("actuals", con, if_exists="replace", index=False)
fmt(future_rows)[["item", "week", "yhat", "lower", "upper", "sigma"]].to_sql(
    "forecasts", con, if_exists="replace", index=False)
inventory.to_sql("inventory", con, if_exists="replace", index=False)
pd.DataFrame([
    {"name": "mape", "value": mape},
    {"name": "mae_model", "value": mae_model},
    {"name": "mae_baseline", "value": mae_base},
]).to_sql("metrics", con, if_exists="replace", index=False)
con.close()
print("Saved demand.db")