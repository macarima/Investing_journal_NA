import { useState, useEffect, useCallback, useMemo } from "react";

const STORAGE_KEY = "investing-portfolio-v1";

const defaultData = {
  tabs: [{ id: "tab_1", name: "장기투자" }],
  activeTabId: "tab_1",
  transactions: { tab_1: [] },
  currentPrices: {},
  currentExchangeRate: 1380,
  manualAvgPrices: {},
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return "0.00";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmt4(n) { return fmt(n, 4); }

function fmtKRW(n, rate) {
  return "₩" + fmt(n * rate, 0);
}

function pct(n) {
  if (n == null || isNaN(n)) return "0.00%";
  return (n >= 0 ? "+" : "") + fmt(n, 2) + "%";
}

function plColor(v) {
  if (v > 0.001) return "#22c55e";
  if (v < -0.001) return "#ef4444";
  return "#94a3b8";
}

function calcHoldings(transactions, manualAvg = {}) {
  const h = {};
  const sorted = [...transactions]
    .filter((t) => t.type === "buy" || t.type === "sell")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  for (const tx of sorted) {
    if (tx.type === "buy") {
      if (!h[tx.ticker]) h[tx.ticker] = { shares: 0, totalCost: 0, avgPrice: 0, lastExRate: 1380 };
      const s = h[tx.ticker];
      s.totalCost += tx.quantity * tx.price;
      s.shares += tx.quantity;
      s.avgPrice = s.shares > 0 ? s.totalCost / s.shares : 0;
      if (tx.exchangeRate) s.lastExRate = tx.exchangeRate;
    } else if (tx.type === "sell") {
      if (h[tx.ticker]) {
        const s = h[tx.ticker];
        const sellShares = Math.min(tx.quantity, s.shares);
        s.totalCost -= s.avgPrice * sellShares;
        s.shares -= sellShares;
        if (s.shares <= 0.0001) { s.shares = 0; s.totalCost = 0; s.avgPrice = 0; }
        else { s.avgPrice = s.totalCost / s.shares; }
      }
    }
  }
  for (const ticker of Object.keys(manualAvg)) {
    if (h[ticker] && manualAvg[ticker] != null) h[ticker].avgPrice = manualAvg[ticker];
  }
  return h;
}

function calcCash(transactions) {
  let cash = 0;
  for (const tx of transactions) {
    switch (tx.type) {
      case "buy": cash -= tx.quantity * tx.price; break;
      case "sell": cash += tx.quantity * tx.price; break;
      case "dividend": cash += tx.amount; break;
      case "deposit": cash += tx.amount; break;
      case "withdrawal": cash -= tx.amount; break;
    }
  }
  return cash;
}

function calcRealizedPL(transactions) {
  const h = {};
  let total = 0;
  const details = [];
  const sorted = [...transactions]
    .filter((t) => t.type === "buy" || t.type === "sell")
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  for (const tx of sorted) {
    if (tx.type === "buy") {
      if (!h[tx.ticker]) h[tx.ticker] = { shares: 0, totalCost: 0, avgPrice: 0 };
      const s = h[tx.ticker];
      s.totalCost += tx.quantity * tx.price;
      s.shares += tx.quantity;
      s.avgPrice = s.totalCost / s.shares;
    } else if (tx.type === "sell" && h[tx.ticker]) {
      const s = h[tx.ticker];
      const qty = Math.min(tx.quantity, s.shares);
      const pl = (tx.price - s.avgPrice) * qty;
      total += pl;
      details.push({ date: tx.date, ticker: tx.ticker, qty, buyAvg: s.avgPrice, sellPrice: tx.price, pl });
      s.totalCost -= s.avgPrice * qty;
      s.shares -= qty;
      if (s.shares <= 0.0001) { s.shares = 0; s.totalCost = 0; s.avgPrice = 0; }
    }
  }
  return { total, details };
}

function calcTotalDividends(transactions) {
  return transactions.filter((t) => t.type === "dividend").reduce((s, t) => s + t.amount, 0);
}

function calcSeedDeposits(transactions) {
  return transactions.filter((t) => t.type === "deposit" && t.subType === "seed").reduce((s, t) => s + t.amount, 0);
}

function calcProfitDeposits(transactions) {
  return transactions.filter((t) => t.type === "deposit" && t.subType === "profit").reduce((s, t) => s + t.amount, 0);
}

function calcWithdrawals(transactions) {
  return transactions.filter((t) => t.type === "withdrawal").reduce((s, t) => s + t.amount, 0);
}

function getYears(transactions) {
  const yrs = new Set();
  transactions.forEach((t) => { if (t.date) yrs.add(t.date.slice(0, 4)); });
  return [...yrs].sort();
}

const VIEWS = [
  { id: "holdings", label: "보유종목" },
  { id: "add", label: "거래입력" },
  { id: "history", label: "거래내역" },
  { id: "annual", label: "연간요약" },
  { id: "performance", label: "성과비교" },
  { id: "settings", label: "설정" },
];

const TX_TYPES = [
  { id: "buy", label: "매수" },
  { id: "sell", label: "매도" },
  { id: "dividend", label: "배당" },
  { id: "deposit", label: "입금" },
  { id: "withdrawal", label: "출금" },
];

const DEPOSIT_SUBTYPES = [
  { id: "seed", label: "시드머니" },
  { id: "profit", label: "수익 입금" },
];

// ─── Fetch helper (Electron has no CORS restrictions) ───
const corsFetch = async (url) => {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.json();
  } catch (e) {
    console.error("Fetch failed:", url, e);
  }
  return null;
};

// ─── App ───
export default function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("holdings");
  const [loading, setLoading] = useState(true);
  const [fetchStatus, setFetchStatus] = useState("");
  const [aggTabs, setAggTabs] = useState([]);
  const [ndxYtd, setNdxYtd] = useState("");
  const [spxYtd, setSpxYtd] = useState("");

  // Load
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(STORAGE_KEY);
        if (r && r.value) {
          const parsed = JSON.parse(r.value);
          setData({ ...defaultData, ...parsed });
        } else {
          setData({ ...defaultData });
        }
      } catch {
        setData({ ...defaultData });
      }
      setLoading(false);
    })();
  }, []);

  // Save
  useEffect(() => {
    if (!data || loading) return;
    (async () => {
      try { await window.storage.set(STORAGE_KEY, JSON.stringify(data)); } catch (e) { console.error(e); }
    })();
  }, [data, loading]);

  const save = useCallback((fn) => setData((prev) => { const next = { ...prev }; fn(next); return { ...next }; }), []);

  // ─── Tab logic ───
  const addTab = () => {
    const name = prompt("새 탭 이름을 입력하세요:");
    if (!name || !name.trim()) return;
    const id = "tab_" + genId();
    save((d) => { d.tabs = [...d.tabs, { id, name: name.trim() }]; d.transactions[id] = []; d.activeTabId = id; });
  };
  const removeTab = (id) => {
    if (!confirm("이 탭을 삭제하시겠습니까? 모든 데이터가 삭제됩니다.")) return;
    save((d) => {
      d.tabs = d.tabs.filter((t) => t.id !== id);
      delete d.transactions[id];
      if (d.activeTabId === id) d.activeTabId = d.tabs[0]?.id || "";
    });
  };
  const renameTab = (id) => {
    const name = prompt("새 탭 이름:");
    if (!name || !name.trim()) return;
    save((d) => { d.tabs = d.tabs.map((t) => (t.id === id ? { ...t, name: name.trim() } : t)); });
  };

  // ─── Transaction logic ───
  const addTransaction = (tx) => {
    save((d) => {
      const tabTxs = d.transactions[d.activeTabId] || [];
      d.transactions[d.activeTabId] = [...tabTxs, { ...tx, id: genId(), createdAt: Date.now() }];
    });
  };
  const deleteTransaction = (txId) => {
    if (!confirm("이 거래를 삭제하시겠습니까?")) return;
    save((d) => {
      d.transactions[d.activeTabId] = (d.transactions[d.activeTabId] || []).filter((t) => t.id !== txId);
    });
  };

  const setCurrentPrice = (ticker, price) => {
    save((d) => { d.currentPrices = { ...d.currentPrices, [ticker]: price }; });
  };
  const setExRate = (rate) => {
    save((d) => { d.currentExchangeRate = rate; });
  };
  const setManualAvg = (tabId, ticker, price) => {
    save((d) => {
      if (!d.manualAvgPrices) d.manualAvgPrices = {};
      if (!d.manualAvgPrices[tabId]) d.manualAvgPrices[tabId] = {};
      d.manualAvgPrices[tabId][ticker] = price;
    });
  };
  const clearManualAvg = (tabId, ticker) => {
    save((d) => {
      if (d.manualAvgPrices?.[tabId]?.[ticker] != null) delete d.manualAvgPrices[tabId][ticker];
    });
  };

  // ─── Fetch functions ───
  const fetchPrice = async (ticker) => {
    setFetchStatus(`${ticker} 가격 조회 중...`);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const j = await corsFetch(yahooUrl);
    const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (price) {
      setCurrentPrice(ticker, price);
      setFetchStatus(`${ticker}: $${fmt(price)} 조회 완료`);
    } else {
      setFetchStatus(`${ticker} 자동 조회 실패 — 수동 입력해주세요.`);
    }
  };

  const fetchExRate = async () => {
    setFetchStatus("환율 조회 중...");
    const apis = [
      { url: "https://open.er-api.com/v6/latest/USD", extract: (j) => j?.rates?.KRW },
      { url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", extract: (j) => j?.usd?.krw },
      { url: "https://latest.currency-api.pages.dev/v1/currencies/usd.json", extract: (j) => j?.usd?.krw },
    ];
    for (const api of apis) {
      try {
        const res = await fetch(api.url);
        if (res.ok) {
          const j = await res.json();
          const krw = api.extract(j);
          if (krw) { setExRate(krw); setFetchStatus(`환율: ₩${fmt(krw, 2)} 조회 완료`); return; }
        }
      } catch {}
    }
    setFetchStatus("환율 자동 조회 실패 — 수동 입력해주세요.");
  };

  if (loading || !data) return <div style={{ background: "#0f1729", color: "#e2e8f0", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>로딩 중...</div>;

  const activeTab = data.activeTabId;
  const txs = data.transactions[activeTab] || [];
  const holdings = calcHoldings(txs, data.manualAvgPrices?.[activeTab]);
  const cash = calcCash(txs);
  const { total: realizedPL } = calcRealizedPL(txs);
  const totalDiv = calcTotalDividends(txs);
  const seedDep = calcSeedDeposits(txs);
  const profitDep = calcProfitDeposits(txs);
  const withdrawals = calcWithdrawals(txs);

  let stockValue = 0;
  let unrealizedPL = 0;
  Object.entries(holdings).forEach(([ticker, h]) => {
    if (h.shares > 0) {
      const cp = data.currentPrices[ticker] || h.avgPrice;
      stockValue += cp * h.shares;
      unrealizedPL += (cp - h.avgPrice) * h.shares;
    }
  });
  const totalValue = stockValue + cash;
  const exRate = data.currentExchangeRate || 1380;

  // ─── Aggregated calculations ───
  const getAggData = () => {
    const tabIds = aggTabs.length > 0 ? aggTabs : [activeTab];
    let allTxs = [];
    tabIds.forEach((id) => { allTxs = allTxs.concat(data.transactions[id] || []); });
    const aggHoldings = calcHoldings(allTxs);
    const aggCash = calcCash(allTxs);
    const aggRealizedPL = calcRealizedPL(allTxs).total;
    const aggDiv = calcTotalDividends(allTxs);
    const aggSeed = calcSeedDeposits(allTxs);
    const aggProfit = calcProfitDeposits(allTxs);
    const aggWith = calcWithdrawals(allTxs);
    let aggStockVal = 0, aggUnPL = 0;
    Object.entries(aggHoldings).forEach(([ticker, h]) => {
      if (h.shares > 0) {
        const cp = data.currentPrices[ticker] || h.avgPrice;
        aggStockVal += cp * h.shares;
        aggUnPL += (cp - h.avgPrice) * h.shares;
      }
    });
    return { allTxs, aggCash, aggRealizedPL, aggDiv, aggSeed, aggProfit, aggWith, aggStockVal, aggUnPL, totalValue: aggStockVal + aggCash };
  };

  // ─── Styles ───
  const S = {
    bg: "#0f1729", card: "#1a2342", border: "#2a3a5c", accent: "#3b82f6",
    text: "#e2e8f0", dim: "#64748b", green: "#22c55e", red: "#ef4444",
    font: "'DM Sans', sans-serif", mono: "'JetBrains Mono', 'SF Mono', monospace",
  };

  const cardStyle = { background: S.card, borderRadius: 10, border: `1px solid ${S.border}`, padding: "14px 18px" };

  return (
    <div style={{ background: S.bg, color: S.text, minHeight: "100vh", fontFamily: S.font, fontSize: 14 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <div style={{ padding: "16px 20px 0", borderBottom: `1px solid ${S.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, letterSpacing: "-0.02em" }}>
          📈 Investing Portfolio Manager
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, alignItems: "end", flexWrap: "wrap" }}>
          {data.tabs.map((tab) => (
            <div key={tab.id} onClick={() => save((d) => { d.activeTabId = tab.id; })}
              style={{
                padding: "8px 16px", borderRadius: "8px 8px 0 0", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: tab.id === activeTab ? S.card : "transparent",
                color: tab.id === activeTab ? S.text : S.dim,
                border: tab.id === activeTab ? `1px solid ${S.border}` : "1px solid transparent",
                borderBottom: tab.id === activeTab ? `1px solid ${S.card}` : "none",
                position: "relative", bottom: -1, display: "flex", gap: 8, alignItems: "center",
              }}>
              <span onDoubleClick={(e) => { e.stopPropagation(); renameTab(tab.id); }}>{tab.name}</span>
              {data.tabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                  style={{ fontSize: 11, color: S.dim, cursor: "pointer", marginLeft: 4 }}>✕</span>
              )}
            </div>
          ))}
          <div onClick={addTab}
            style={{ padding: "8px 14px", borderRadius: "8px 8px 0 0", cursor: "pointer", fontSize: 13, color: S.accent, fontWeight: 600 }}>
            + 탭 추가
          </div>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 2, padding: "10px 20px", borderBottom: `1px solid ${S.border}`, background: S.card }}>
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
              background: view === v.id ? S.accent : "transparent",
              color: view === v.id ? "#fff" : S.dim,
            }}>{v.label}</button>
        ))}
      </div>

      {/* Summary Cards */}
      <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        {[
          { label: "총 자산", val: `$${fmt4(totalValue)}`, sub: fmtKRW(totalValue, exRate) },
          { label: "주식 평가", val: `$${fmt4(stockValue)}`, sub: fmtKRW(stockValue, exRate) },
          { label: "현금", val: `$${fmt4(cash)}`, sub: fmtKRW(cash, exRate) },
          { label: "미실현 손익", val: `$${fmt(unrealizedPL)}`, sub: pct(stockValue > 0 ? (unrealizedPL / (stockValue - unrealizedPL)) * 100 : 0), color: plColor(unrealizedPL) },
          { label: "실현 손익", val: `$${fmt(realizedPL)}`, color: plColor(realizedPL) },
          { label: "배당 수익", val: `$${fmt(totalDiv)}`, color: S.green },
        ].map((c, i) => (
          <div key={i} style={cardStyle}>
            <div style={{ fontSize: 11, color: S.dim, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, fontFamily: S.mono, color: c.color || S.text }}>{c.val}</div>
            {c.sub && <div style={{ fontSize: 11, color: c.color || S.dim, fontFamily: S.mono, marginTop: 2 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Status */}
      {fetchStatus && (
        <div style={{ padding: "0 20px 8px" }}>
          <div style={{ fontSize: 12, color: S.accent, fontFamily: S.mono }}>{fetchStatus}</div>
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "0 20px 20px" }}>
        {view === "holdings" && (
          <HoldingsView holdings={holdings} prices={data.currentPrices} exRate={exRate} S={S} cardStyle={cardStyle}
            fetchPrice={fetchPrice} fetchExRate={fetchExRate} setCurrentPrice={setCurrentPrice}
            setExRate={setExRate} setManualAvg={(t, p) => setManualAvg(activeTab, t, p)}
            clearManualAvg={(t) => clearManualAvg(activeTab, t)} manualAvg={data.manualAvgPrices?.[activeTab] || {}} />
        )}
        {view === "add" && <AddTransaction S={S} cardStyle={cardStyle} addTransaction={addTransaction} exRate={exRate} />}
        {view === "history" && <TransactionHistory txs={txs} S={S} cardStyle={cardStyle} deleteTransaction={deleteTransaction} />}
        {view === "annual" && <AnnualSummary txs={txs} holdings={holdings} prices={data.currentPrices} exRate={exRate} S={S} cardStyle={cardStyle} />}
        {view === "performance" && (
          <PerformanceView data={data} activeTab={activeTab} S={S} cardStyle={cardStyle} getAggData={getAggData}
            aggTabs={aggTabs} setAggTabs={setAggTabs} ndxYtd={ndxYtd} setNdxYtd={setNdxYtd}
            spxYtd={spxYtd} setSpxYtd={setSpxYtd} exRate={exRate} />
        )}
        {view === "settings" && (
          <SettingsView data={data} save={save} S={S} cardStyle={cardStyle} fetchExRate={fetchExRate} exRate={exRate} setExRate={setExRate} />
        )}
      </div>
    </div>
  );
}

// ─── Holdings View ───
function HoldingsView({ holdings, prices, exRate, S, cardStyle, fetchPrice, fetchExRate, setCurrentPrice, setExRate, setManualAvg, clearManualAvg, manualAvg }) {
  const [editTicker, setEditTicker] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [priceEdit, setPriceEdit] = useState({});
  const [rateEdit, setRateEdit] = useState("");

  const tickers = Object.keys(holdings).filter((t) => holdings[t].shares > 0);
  const inputStyle = { background: "#0f1729", border: `1px solid ${S.border}`, borderRadius: 4, padding: "4px 8px", color: S.text, fontFamily: S.mono, fontSize: 12, width: 100 };
  const btnSm = { padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 };

  return (
    <div>
      {/* Exchange rate bar */}
      <div style={{ ...cardStyle, marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: S.dim }}>현재 환율 (USD/KRW):</span>
        <span style={{ fontFamily: S.mono, fontWeight: 600 }}>₩{fmt(exRate, 2)}</span>
        <button onClick={fetchExRate} style={{ ...btnSm, background: S.accent, color: "#fff" }}>자동 조회</button>
        <input placeholder="수동 입력" value={rateEdit} onChange={(e) => setRateEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && rateEdit) { setExRate(parseFloat(rateEdit)); setRateEdit(""); } }}
          style={{ ...inputStyle, width: 90 }} />
        {rateEdit && <button onClick={() => { setExRate(parseFloat(rateEdit)); setRateEdit(""); }} style={{ ...btnSm, background: S.green, color: "#fff" }}>적용</button>}
      </div>

      {tickers.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: S.dim, padding: 40 }}>보유 종목이 없습니다. '거래입력'에서 매수를 추가해주세요.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${S.border}` }}>
                {["종목", "수량", "평단가", "현재가", "평가금액", "미실현 손익", "수익률", ""].map((h, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: i > 0 ? "right" : "left", color: S.dim, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickers.map((ticker) => {
                const h = holdings[ticker];
                const cp = prices[ticker] || h.avgPrice;
                const mv = cp * h.shares;
                const upl = (cp - h.avgPrice) * h.shares;
                const uplPct = h.avgPrice > 0 ? ((cp - h.avgPrice) / h.avgPrice) * 100 : 0;
                const isManual = manualAvg[ticker] != null;
                return (
                  <tr key={ticker} style={{ borderBottom: `1px solid ${S.border}` }}>
                    <td style={{ padding: "10px", fontWeight: 600 }}>
                      {ticker}
                      {isManual && <span style={{ fontSize: 9, color: S.accent, marginLeft: 4 }}>수동</span>}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", fontFamily: S.mono }}>{fmt4(h.shares)}</td>
                    <td style={{ padding: "10px", textAlign: "right", fontFamily: S.mono }}>
                      {editTicker === ticker ? (
                        <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <input value={editVal} onChange={(e) => setEditVal(e.target.value)} style={{ ...inputStyle, width: 80 }} autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { setManualAvg(ticker, parseFloat(editVal)); setEditTicker(null); } if (e.key === "Escape") setEditTicker(null); }} />
                          <button onClick={() => { setManualAvg(ticker, parseFloat(editVal)); setEditTicker(null); }} style={{ ...btnSm, background: S.green, color: "#fff" }}>✓</button>
                        </div>
                      ) : (
                        <span onClick={() => { setEditTicker(ticker); setEditVal(h.avgPrice.toFixed(4)); }} style={{ cursor: "pointer", borderBottom: `1px dashed ${S.dim}` }}>
                          ${fmt4(h.avgPrice)}
                        </span>
                      )}
                      {isManual && <button onClick={() => clearManualAvg(ticker)} style={{ ...btnSm, background: "transparent", color: S.dim, fontSize: 9, marginLeft: 2 }}>초기화</button>}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", fontFamily: S.mono }}>
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        {priceEdit[ticker] != null ? (
                          <>
                            <input value={priceEdit[ticker]} onChange={(e) => setPriceEdit((p) => ({ ...p, [ticker]: e.target.value }))}
                              style={{ ...inputStyle, width: 80 }} autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") { setCurrentPrice(ticker, parseFloat(priceEdit[ticker])); setPriceEdit((p) => { const n = { ...p }; delete n[ticker]; return n; }); } }} />
                            <button onClick={() => { setCurrentPrice(ticker, parseFloat(priceEdit[ticker])); setPriceEdit((p) => { const n = { ...p }; delete n[ticker]; return n; }); }}
                              style={{ ...btnSm, background: S.green, color: "#fff" }}>✓</button>
                          </>
                        ) : (
                          <>
                            <span style={{ cursor: "pointer", borderBottom: `1px dashed ${S.dim}` }}
                              onClick={() => setPriceEdit((p) => ({ ...p, [ticker]: cp.toFixed(2) }))}>${fmt(cp)}</span>
                            <button onClick={() => fetchPrice(ticker)} style={{ ...btnSm, background: S.accent, color: "#fff" }}>조회</button>
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", fontFamily: S.mono }}>
                      ${fmt(mv)}<br /><span style={{ fontSize: 10, color: S.dim }}>{fmtKRW(mv, exRate)}</span>
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", fontFamily: S.mono, color: plColor(upl) }}>
                      ${fmt(upl)}<br /><span style={{ fontSize: 10 }}>{fmtKRW(upl, exRate)}</span>
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", fontFamily: S.mono, color: plColor(upl) }}>{pct(uplPct)}</td>
                    <td style={{ padding: "10px", textAlign: "right" }}>
                      <button onClick={() => fetchPrice(ticker)} style={{ ...btnSm, background: "transparent", color: S.dim }}>🔄</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Add Transaction ───
function AddTransaction({ S, cardStyle, addTransaction, exRate }) {
  const [type, setType] = useState("buy");
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), ticker: "", quantity: "", price: "", amount: "", exchangeRate: String(exRate), subType: "seed" });

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const inputStyle = { background: "#0f1729", border: `1px solid ${S.border}`, borderRadius: 6, padding: "8px 12px", color: S.text, fontFamily: S.mono, fontSize: 13, width: "100%" };
  const labelStyle = { fontSize: 11, color: S.dim, marginBottom: 4, display: "block", fontWeight: 600 };

  const submit = () => {
    const tx = { type, date: form.date };
    if (type === "buy") {
      if (!form.ticker || !form.quantity || !form.price) return alert("모든 필드를 입력해주세요.");
      tx.ticker = form.ticker.toUpperCase();
      tx.quantity = parseFloat(form.quantity);
      tx.price = parseFloat(form.price);
      tx.exchangeRate = parseFloat(form.exchangeRate) || exRate;
    } else if (type === "sell") {
      if (!form.ticker || !form.quantity || !form.price) return alert("모든 필드를 입력해주세요.");
      tx.ticker = form.ticker.toUpperCase();
      tx.quantity = parseFloat(form.quantity);
      tx.price = parseFloat(form.price);
    } else if (type === "dividend") {
      if (!form.ticker || !form.amount) return alert("모든 필드를 입력해주세요.");
      tx.ticker = form.ticker.toUpperCase();
      tx.amount = parseFloat(form.amount);
    } else if (type === "deposit") {
      if (!form.amount) return alert("금액을 입력해주세요.");
      tx.amount = parseFloat(form.amount);
      tx.subType = form.subType;
      tx.exchangeRate = parseFloat(form.exchangeRate) || exRate;
    } else if (type === "withdrawal") {
      if (!form.amount) return alert("금액을 입력해주세요.");
      tx.amount = parseFloat(form.amount);
    }
    addTransaction(tx);
    setForm({ date: new Date().toISOString().slice(0, 10), ticker: "", quantity: "", price: "", amount: "", exchangeRate: String(exRate), subType: "seed" });
    alert("거래가 추가되었습니다.");
  };

  return (
    <div style={{ ...cardStyle, maxWidth: 500 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>거래 입력</div>

      {/* Type selector */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {TX_TYPES.map((t) => (
          <button key={t.id} onClick={() => setType(t.id)}
            style={{
              padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
              background: type === t.id ? (t.id === "buy" ? S.green : t.id === "sell" ? S.red : S.accent) : "transparent",
              color: type === t.id ? "#fff" : S.dim,
            }}>{t.label}</button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={labelStyle}>날짜</label><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} style={inputStyle} /></div>

        {(type === "buy" || type === "sell" || type === "dividend") && (
          <div><label style={labelStyle}>종목 (티커)</label><input placeholder="AAPL" value={form.ticker} onChange={(e) => set("ticker", e.target.value)} style={inputStyle} /></div>
        )}

        {(type === "buy" || type === "sell") && (
          <>
            <div><label style={labelStyle}>수량 (주)</label><input type="number" step="0.0001" placeholder="10" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>{type === "buy" ? "매수 단가" : "매도 단가"} (USD)</label><input type="number" step="0.01" placeholder="150.00" value={form.price} onChange={(e) => set("price", e.target.value)} style={inputStyle} /></div>
          </>
        )}

        {(type === "dividend" || type === "deposit" || type === "withdrawal") && (
          <div><label style={labelStyle}>금액 (USD)</label><input type="number" step="0.01" placeholder="100.00" value={form.amount} onChange={(e) => set("amount", e.target.value)} style={inputStyle} /></div>
        )}

        {type === "deposit" && (
          <div>
            <label style={labelStyle}>입금 유형</label>
            <div style={{ display: "flex", gap: 4 }}>
              {DEPOSIT_SUBTYPES.map((st) => (
                <button key={st.id} onClick={() => set("subType", st.id)}
                  style={{
                    padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                    background: form.subType === st.id ? S.accent : "#0f1729", color: form.subType === st.id ? "#fff" : S.dim,
                  }}>{st.label}</button>
              ))}
            </div>
          </div>
        )}

        {(type === "buy" || type === "deposit") && (
          <div><label style={labelStyle}>원달러 환율</label><input type="number" step="0.01" value={form.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} style={inputStyle} /></div>
        )}

        {(type === "buy" || type === "sell") && form.quantity && form.price && (
          <div style={{ fontSize: 12, color: S.dim, fontFamily: S.mono, padding: "8px 0", borderTop: `1px solid ${S.border}` }}>
            거래 금액: <span style={{ color: S.text, fontWeight: 600 }}>${fmt(parseFloat(form.quantity || 0) * parseFloat(form.price || 0))}</span>
            {type === "buy" && form.exchangeRate && (
              <span> / {fmtKRW(parseFloat(form.quantity || 0) * parseFloat(form.price || 0), parseFloat(form.exchangeRate))}</span>
            )}
          </div>
        )}

        <button onClick={submit} style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: S.accent, color: "#fff", marginTop: 8 }}>
          {type === "buy" ? "매수 추가" : type === "sell" ? "매도 추가" : type === "dividend" ? "배당 추가" : type === "deposit" ? "입금 추가" : "출금 추가"}
        </button>
      </div>
    </div>
  );
}

// ─── Transaction History ───
function TransactionHistory({ txs, S, cardStyle, deleteTransaction }) {
  const typeLabels = { buy: "매수", sell: "매도", dividend: "배당", deposit: "입금", withdrawal: "출금" };
  const typeColors = { buy: S.green, sell: S.red, dividend: "#a78bfa", deposit: S.accent, withdrawal: "#f59e0b" };
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  return (
    <div>
      {sorted.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: S.dim, padding: 40 }}>거래 내역이 없습니다.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${S.border}` }}>
                {["날짜", "유형", "종목", "수량", "단가/금액", "거래금액", "환율", ""].map((h, i) => (
                  <th key={i} style={{ padding: "8px 10px", textAlign: i > 2 ? "right" : "left", color: S.dim, fontSize: 11, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((tx) => {
                let detail = "", total = "";
                if (tx.type === "buy" || tx.type === "sell") {
                  detail = `$${fmt(tx.price)}`;
                  total = `$${fmt(tx.quantity * tx.price)}`;
                } else {
                  detail = `$${fmt(tx.amount)}`;
                  total = `$${fmt(tx.amount)}`;
                }
                return (
                  <tr key={tx.id} style={{ borderBottom: `1px solid ${S.border}` }}>
                    <td style={{ padding: "8px 10px", fontFamily: S.mono, fontSize: 12 }}>{tx.date}</td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ color: typeColors[tx.type], fontWeight: 600 }}>
                        {typeLabels[tx.type]}{tx.subType === "seed" ? " (시드)" : tx.subType === "profit" ? " (수익)" : ""}
                      </span>
                    </td>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>{tx.ticker || "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono }}>{tx.quantity ? fmt4(tx.quantity) : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono }}>{detail}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono }}>{total}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono, fontSize: 11 }}>{tx.exchangeRate ? `₩${fmt(tx.exchangeRate, 0)}` : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      <button onClick={() => deleteTransaction(tx.id)} style={{ background: "transparent", border: "none", color: S.red, cursor: "pointer", fontSize: 12 }}>삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Annual Summary ───
function AnnualSummary({ txs, holdings, prices, exRate, S, cardStyle }) {
  const years = getYears(txs);
  if (years.length === 0) return <div style={{ ...cardStyle, textAlign: "center", color: S.dim, padding: 40 }}>데이터가 없습니다.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {years.map((yr) => {
        const yTxs = txs.filter((t) => t.date?.startsWith(yr));
        const buys = yTxs.filter((t) => t.type === "buy");
        const sells = yTxs.filter((t) => t.type === "sell");
        const divs = yTxs.filter((t) => t.type === "dividend");
        const deps = yTxs.filter((t) => t.type === "deposit");
        const withs = yTxs.filter((t) => t.type === "withdrawal");

        const totalBuy = buys.reduce((s, t) => s + t.quantity * t.price, 0);
        const totalSell = sells.reduce((s, t) => s + t.quantity * t.price, 0);
        const totalDiv = divs.reduce((s, t) => s + t.amount, 0);
        const totalDep = deps.reduce((s, t) => s + t.amount, 0);
        const seedDep = deps.filter((t) => t.subType === "seed").reduce((s, t) => s + t.amount, 0);
        const profitDep = deps.filter((t) => t.subType === "profit").reduce((s, t) => s + t.amount, 0);
        const totalWith = withs.reduce((s, t) => s + t.amount, 0);

        // Calculate realized PL for this year's sells
        const allTxsUpToYear = txs.filter((t) => t.date <= `${yr}-12-31`).sort((a, b) => a.date.localeCompare(b.date));
        const h = {};
        let yrRealizedPL = 0;
        for (const tx of allTxsUpToYear) {
          if (tx.type === "buy") {
            if (!h[tx.ticker]) h[tx.ticker] = { shares: 0, totalCost: 0, avgPrice: 0 };
            h[tx.ticker].totalCost += tx.quantity * tx.price;
            h[tx.ticker].shares += tx.quantity;
            h[tx.ticker].avgPrice = h[tx.ticker].totalCost / h[tx.ticker].shares;
          } else if (tx.type === "sell" && h[tx.ticker]) {
            const pl = (tx.price - h[tx.ticker].avgPrice) * Math.min(tx.quantity, h[tx.ticker].shares);
            if (tx.date.startsWith(yr)) yrRealizedPL += pl;
            const qty = Math.min(tx.quantity, h[tx.ticker].shares);
            h[tx.ticker].totalCost -= h[tx.ticker].avgPrice * qty;
            h[tx.ticker].shares -= qty;
            if (h[tx.ticker].shares <= 0.0001) { h[tx.ticker].shares = 0; h[tx.ticker].totalCost = 0; h[tx.ticker].avgPrice = 0; }
          }
        }

        const rows = [
          { label: "총 매수", val: totalBuy, count: `${buys.length}건` },
          { label: "총 매도", val: totalSell, count: `${sells.length}건` },
          { label: "실현 손익", val: yrRealizedPL, color: plColor(yrRealizedPL) },
          { label: "배당 수익", val: totalDiv, count: `${divs.length}건`, color: totalDiv > 0 ? S.green : null },
          { label: "입금 (시드)", val: seedDep },
          { label: "입금 (수익)", val: profitDep },
          { label: "출금", val: totalWith },
        ];

        return (
          <div key={yr} style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{yr}년</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              {rows.map((r, i) => (
                <div key={i} style={{ padding: "8px 10px", background: "#0f1729", borderRadius: 6 }}>
                  <div style={{ fontSize: 10, color: S.dim }}>{r.label} {r.count && <span style={{ color: S.accent }}>{r.count}</span>}</div>
                  <div style={{ fontFamily: S.mono, fontWeight: 600, fontSize: 13, color: r.color || S.text, marginTop: 2 }}>${fmt(r.val)}</div>
                  <div style={{ fontFamily: S.mono, fontSize: 10, color: S.dim }}>{fmtKRW(r.val, exRate)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Performance View ───
function PerformanceView({ data, activeTab, S, cardStyle, getAggData, aggTabs, setAggTabs, ndxYtd, setNdxYtd, spxYtd, setSpxYtd, exRate }) {
  const [fetchingIdx, setFetchingIdx] = useState(false);

  const fetchIndices = async () => {
    setFetchingIdx(true);
    try {
      const fetchYtd = async (symbol) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=ytd&interval=1d`;
        const j = await corsFetch(url);
        const r = j?.chart?.result?.[0];
        if (r) {
          const opens = r.indicators?.quote?.[0]?.open;
          const closes = r.indicators?.quote?.[0]?.close;
          if (opens && closes) {
            const firstClose = opens.find((v) => v != null);
            const lastClose = [...closes].reverse().find((v) => v != null);
            if (firstClose && lastClose) return ((lastClose - firstClose) / firstClose * 100).toFixed(2);
          }
        }
        return null;
      };
      const [ndx, spx] = await Promise.all([fetchYtd("^NDX"), fetchYtd("^GSPC")]);
      if (ndx) setNdxYtd(ndx);
      if (spx) setSpxYtd(spx);
      if (!ndx && !spx) alert("지수 자동 조회 실패. 수동으로 입력해주세요.");
    } catch { alert("지수 조회 실패"); }
    setFetchingIdx(false);
  };

  const agg = getAggData();
  const { aggSeed, aggProfit, aggWith, totalValue: aggTotal, aggRealizedPL, aggDiv, aggUnPL, aggStockVal, aggCash } = agg;

  // Main performance: (current value - seed) / seed, including profit deposits & withdrawals
  const mainBase = aggSeed;
  const mainGain = aggTotal - aggSeed;
  const mainPct = mainBase > 0 ? (mainGain / mainBase) * 100 : 0;

  // Sub performance: pure investment (unrealized PL + realized PL + dividends) / cost basis
  const costBasis = aggStockVal - aggUnPL; // total cost of current holdings
  const pureGain = aggUnPL + aggRealizedPL + aggDiv;
  const purePct = costBasis > 0 ? (pureGain / costBasis) * 100 : 0;

  const ndxV = parseFloat(ndxYtd) || 0;
  const spxV = parseFloat(spxYtd) || 0;
  const inputStyle = { background: "#0f1729", border: `1px solid ${S.border}`, borderRadius: 6, padding: "8px 12px", color: S.text, fontFamily: S.mono, fontSize: 13, width: 100 };
  const btnSm = { padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Tab selection for aggregation */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>비교할 탭 선택</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.tabs.map((tab) => {
            const selected = aggTabs.includes(tab.id);
            return (
              <button key={tab.id} onClick={() => {
                setAggTabs((prev) => selected ? prev.filter((id) => id !== tab.id) : [...prev, tab.id]);
              }} style={{
                ...btnSm,
                background: selected ? S.accent : "#0f1729",
                color: selected ? "#fff" : S.dim,
                border: `1px solid ${selected ? S.accent : S.border}`,
              }}>{tab.name}</button>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: S.dim, marginTop: 6 }}>선택하지 않으면 현재 탭만 계산됩니다.</div>
      </div>

      {/* NDX / SPX input */}
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>NDX / SPX YTD 수익률</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 11, color: S.dim, marginRight: 6 }}>NDX:</span>
            <input value={ndxYtd} onChange={(e) => setNdxYtd(e.target.value)} placeholder="0.00" style={inputStyle} />
            <span style={{ fontSize: 11, color: S.dim, marginLeft: 4 }}>%</span>
          </div>
          <div>
            <span style={{ fontSize: 11, color: S.dim, marginRight: 6 }}>SPX:</span>
            <input value={spxYtd} onChange={(e) => setSpxYtd(e.target.value)} placeholder="0.00" style={inputStyle} />
            <span style={{ fontSize: 11, color: S.dim, marginLeft: 4 }}>%</span>
          </div>
          <button onClick={fetchIndices} disabled={fetchingIdx}
            style={{ ...btnSm, background: S.accent, color: "#fff", opacity: fetchingIdx ? 0.5 : 1 }}>
            {fetchingIdx ? "조회 중..." : "자동 조회"}
          </button>
        </div>
      </div>

      {/* Main performance */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>📊 메인 지표 — 실질 계좌 성장</div>
        <div style={{ fontSize: 11, color: S.dim, marginBottom: 14 }}>시드머니 제외, 수익 입금·출금·투자 성과 모두 반영</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { label: "내 계좌", value: mainPct, amount: mainGain },
            { label: "NDX YTD", value: ndxV, amount: mainBase * ndxV / 100 },
            { label: "SPX YTD", value: spxV, amount: mainBase * spxV / 100 },
          ].map((item, i) => (
            <div key={i} style={{ background: "#0f1729", borderRadius: 8, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: S.mono, color: plColor(item.value) }}>{pct(item.value)}</div>
              <div style={{ fontSize: 12, fontFamily: S.mono, color: plColor(item.amount), marginTop: 4 }}>${fmt(item.amount)}</div>
              <div style={{ fontSize: 10, fontFamily: S.mono, color: S.dim }}>{fmtKRW(item.amount, exRate)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          {[
            { label: "계좌 총 가치", val: aggTotal },
            { label: "시드 자본", val: aggSeed },
            { label: "수익 입금", val: aggProfit },
            { label: "출금", val: aggWith },
          ].map((r, i) => (
            <div key={i} style={{ padding: "6px 10px", background: "#0f1729", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: S.dim }}>{r.label}</div>
              <div style={{ fontFamily: S.mono, fontSize: 12, fontWeight: 600 }}>${fmt(r.val)}</div>
              <div style={{ fontFamily: S.mono, fontSize: 10, color: S.dim }}>{fmtKRW(r.val, exRate)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sub performance */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🎯 보조 지표 — 순수 투자 수익률</div>
        <div style={{ fontSize: 11, color: S.dim, marginBottom: 14 }}>외부 입출금 제외, 미실현+실현 손익+배당만 계산</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
          {[
            { label: "내 투자", value: purePct, amount: pureGain },
            { label: "NDX YTD", value: ndxV, amount: costBasis * ndxV / 100 },
            { label: "SPX YTD", value: spxV, amount: costBasis * spxV / 100 },
          ].map((item, i) => (
            <div key={i} style={{ background: "#0f1729", borderRadius: 8, padding: 14, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: S.mono, color: plColor(item.value) }}>{pct(item.value)}</div>
              <div style={{ fontSize: 12, fontFamily: S.mono, color: plColor(item.amount), marginTop: 4 }}>${fmt(item.amount)}</div>
              <div style={{ fontSize: 10, fontFamily: S.mono, color: S.dim }}>{fmtKRW(item.amount, exRate)}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          {[
            { label: "미실현 손익", val: aggUnPL, color: plColor(aggUnPL) },
            { label: "실현 손익", val: aggRealizedPL, color: plColor(aggRealizedPL) },
            { label: "배당 수익", val: aggDiv, color: aggDiv > 0 ? S.green : null },
            { label: "투자 원금", val: costBasis },
          ].map((r, i) => (
            <div key={i} style={{ padding: "6px 10px", background: "#0f1729", borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: S.dim }}>{r.label}</div>
              <div style={{ fontFamily: S.mono, fontSize: 12, fontWeight: 600, color: r.color || S.text }}>${fmt(r.val)}</div>
              <div style={{ fontFamily: S.mono, fontSize: 10, color: S.dim }}>{fmtKRW(r.val, exRate)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Settings ───
function SettingsView({ data, save, S, cardStyle, fetchExRate, exRate, setExRate }) {
  const [rateInput, setRateInput] = useState("");
  const inputStyle = { background: "#0f1729", border: `1px solid ${S.border}`, borderRadius: 6, padding: "8px 12px", color: S.text, fontFamily: S.mono, fontSize: 13, width: 120 };
  const btnSm = { padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 };

  const resetAll = () => {
    if (!confirm("모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    save((d) => {
      Object.assign(d, defaultData);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 500 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>환율 설정</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: S.dim }}>현재:</span>
          <span style={{ fontFamily: S.mono, fontWeight: 600 }}>₩{fmt(exRate, 2)}</span>
          <button onClick={fetchExRate} style={{ ...btnSm, background: S.accent, color: "#fff" }}>자동 조회</button>
          <input placeholder="수동 입력" value={rateInput} onChange={(e) => setRateInput(e.target.value)} style={inputStyle} />
          {rateInput && <button onClick={() => { setExRate(parseFloat(rateInput)); setRateInput(""); }} style={{ ...btnSm, background: "#22c55e", color: "#fff" }}>적용</button>}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>탭 관리</div>
        {data.tabs.map((tab) => (
          <div key={tab.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, padding: "8px 10px", background: "#0f1729", borderRadius: 6 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{tab.name}</span>
            <button onClick={() => {
              const name = prompt("새 탭 이름:", tab.name);
              if (name && name.trim()) save((d) => { d.tabs = d.tabs.map((t) => t.id === tab.id ? { ...t, name: name.trim() } : t); });
            }} style={{ ...btnSm, background: S.accent, color: "#fff" }}>이름 변경</button>
            {data.tabs.length > 1 && (
              <button onClick={() => {
                if (confirm(`'${tab.name}' 탭을 삭제하시겠습니까?`)) {
                  save((d) => {
                    d.tabs = d.tabs.filter((t) => t.id !== tab.id);
                    delete d.transactions[tab.id];
                    if (d.activeTabId === tab.id) d.activeTabId = d.tabs[0]?.id || "";
                  });
                }
              }} style={{ ...btnSm, background: S.red, color: "#fff" }}>삭제</button>
            )}
          </div>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>데이터 관리</div>
        <button onClick={resetAll} style={{ ...btnSm, background: S.red, color: "#fff" }}>전체 데이터 초기화</button>
      </div>
    </div>
  );
}
