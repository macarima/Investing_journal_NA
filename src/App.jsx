import { useState, useEffect, useCallback, useRef } from "react";

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
      if (!h[tx.ticker]) h[tx.ticker] = { shares: 0, totalCost: 0, avgPrice: 0 };
      const s = h[tx.ticker];
      s.totalCost += tx.quantity * tx.price;
      s.shares += tx.quantity;
      s.avgPrice = s.shares > 0 ? s.totalCost / s.shares : 0;
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
      s.totalCost -= s.avgPrice * qty;
      s.shares -= qty;
      if (s.shares <= 0.0001) { s.shares = 0; s.totalCost = 0; s.avgPrice = 0; }
    }
  }
  return { total };
}

function calcTotalDividends(tx) { return tx.filter((t) => t.type === "dividend").reduce((s, t) => s + t.amount, 0); }
function calcSeedDeposits(tx) { return tx.filter((t) => t.type === "deposit" && t.subType === "seed").reduce((s, t) => s + t.amount, 0); }
function calcProfitDeposits(tx) { return tx.filter((t) => t.type === "deposit" && t.subType === "profit").reduce((s, t) => s + t.amount, 0); }
function calcWithdrawals(tx) { return tx.filter((t) => t.type === "withdrawal").reduce((s, t) => s + t.amount, 0); }
function getYears(tx) { const y = new Set(); tx.forEach((t) => { if (t.date) y.add(t.date.slice(0, 4)); }); return [...y].sort(); }

const VIEWS = [
  { id: "holdings", label: "보유종목" }, { id: "add", label: "거래입력" }, { id: "history", label: "거래내역" },
  { id: "annual", label: "연간요약" }, { id: "performance", label: "성과비교" }, { id: "settings", label: "설정" },
];
const TX_TYPES = [
  { id: "buy", label: "매수" }, { id: "sell", label: "매도" }, { id: "dividend", label: "배당" },
  { id: "deposit", label: "입금" }, { id: "withdrawal", label: "출금" },
];
const DEPOSIT_SUBTYPES = [{ id: "seed", label: "시드머니" }, { id: "profit", label: "수익 입금" }];

const S = {
  bg: "#0f1729", card: "#1a2342", border: "#2a3a5c", accent: "#3b82f6",
  text: "#e2e8f0", dim: "#64748b", green: "#22c55e", red: "#ef4444",
  font: "'DM Sans', sans-serif", mono: "'JetBrains Mono', 'SF Mono', monospace",
};
const cardStyle = { background: S.card, borderRadius: 10, border: `1px solid ${S.border}`, padding: "14px 18px" };
const inputBase = { background: "#0f1729", border: `1px solid ${S.border}`, borderRadius: 6, padding: "8px 12px", color: S.text, fontFamily: S.mono, fontSize: 13, width: "100%" };
const btnSm = { padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600 };
const labelSt = { fontSize: 11, color: S.dim, marginBottom: 4, display: "block", fontWeight: 600 };

// ─── Modal Components ───
function ModalOverlay({ children, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: 12, padding: 24, minWidth: 320, maxWidth: 420 }}>
        {children}
      </div>
    </div>
  );
}
function PromptModal({ title, defaultValue, onConfirm, onCancel, placeholder }) {
  const [val, setVal] = useState(defaultValue || "");
  const ref = useRef(null);
  useEffect(() => { setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 50); }, []);
  const submit = () => { if (val.trim()) onConfirm(val.trim()); };
  return (
    <ModalOverlay onClose={onCancel}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: S.text }}>{title}</div>
      <input ref={ref} value={val} onChange={(e) => setVal(e.target.value)} placeholder={placeholder || ""}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
        style={{ ...inputBase, marginBottom: 14 }} />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ ...btnSm, background: S.border, color: S.text }}>취소</button>
        <button onClick={submit} style={{ ...btnSm, background: S.accent, color: "#fff" }}>확인</button>
      </div>
    </ModalOverlay>
  );
}
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <ModalOverlay onClose={onCancel}>
      <div style={{ fontSize: 14, color: S.text, marginBottom: 18, lineHeight: 1.5 }}>{message}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ ...btnSm, background: S.border, color: S.text }}>취소</button>
        <button onClick={onConfirm} style={{ ...btnSm, background: S.red, color: "#fff" }}>확인</button>
      </div>
    </ModalOverlay>
  );
}
function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: S.accent,
      color: "#fff", padding: "10px 24px", borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
      {message}
    </div>
  );
}

// ─── CORS fetch ───
const corsFetch = async (url) => {
  try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) { console.error('Fetch failed:', url, e); }
  return null;
};

// ═══════════════════════════════════ App ═══════════════════════════════════
export default function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("holdings");
  const [loading, setLoading] = useState(true);
  const [fetchStatus, setFetchStatus] = useState("");
  const [aggTabs, setAggTabs] = useState([]);
  const [ndxYtd, setNdxYtd] = useState("");
  const [spxYtd, setSpxYtd] = useState("");
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const showToast = useCallback((m) => setToast(m), []);

  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get(STORAGE_KEY); if (r?.value) setData({ ...defaultData, ...JSON.parse(r.value) }); else setData({ ...defaultData }); }
      catch { setData({ ...defaultData }); }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!data || loading) return;
    (async () => { try { await window.storage.set(STORAGE_KEY, JSON.stringify(data)); } catch (e) { console.error(e); } })();
  }, [data, loading]);

  const save = useCallback((fn) => setData((prev) => {
    const next = { ...prev, tabs: [...prev.tabs], transactions: { ...prev.transactions }, currentPrices: { ...prev.currentPrices }, manualAvgPrices: { ...(prev.manualAvgPrices || {}) } };
    fn(next); return next;
  }), []);

  const addTab = () => {
    setModal({ type: "prompt", title: "새 탭 이름을 입력하세요", placeholder: "예: 배당주, 성장주...",
      onConfirm: (name) => { const id = "tab_" + genId(); save((d) => { d.tabs = [...d.tabs, { id, name }]; d.transactions = { ...d.transactions, [id]: [] }; d.activeTabId = id; }); setModal(null); } });
  };
  const removeTab = (id) => {
    setModal({ type: "confirm", message: "이 탭을 삭제하시겠습니까? 모든 데이터가 삭제됩니다.",
      onConfirm: () => { save((d) => { d.tabs = d.tabs.filter((t) => t.id !== id); const tx = { ...d.transactions }; delete tx[id]; d.transactions = tx; if (d.activeTabId === id) d.activeTabId = d.tabs[0]?.id || ""; }); setModal(null); } });
  };
  const renameTab = (id) => {
    const cur = data.tabs.find((t) => t.id === id)?.name || "";
    setModal({ type: "prompt", title: "탭 이름 변경", defaultValue: cur,
      onConfirm: (name) => { save((d) => { d.tabs = d.tabs.map((t) => (t.id === id ? { ...t, name } : t)); }); setModal(null); } });
  };

  const addTransaction = (tx) => {
    save((d) => { const arr = d.transactions[d.activeTabId] || []; d.transactions = { ...d.transactions, [d.activeTabId]: [...arr, { ...tx, id: genId(), createdAt: Date.now() }] }; });
    showToast("거래가 추가되었습니다.");
  };
  const deleteTransaction = (txId) => {
    setModal({ type: "confirm", message: "이 거래를 삭제하시겠습니까?",
      onConfirm: () => { save((d) => { d.transactions = { ...d.transactions, [d.activeTabId]: (d.transactions[d.activeTabId] || []).filter((t) => t.id !== txId) }; }); setModal(null); } });
  };

  const setCurrentPrice = (tk, p) => save((d) => { d.currentPrices[tk] = p; });
  const setExRate = (r) => save((d) => { d.currentExchangeRate = r; });
  const setManualAvg = (tab, tk, p) => save((d) => { if (!d.manualAvgPrices[tab]) d.manualAvgPrices[tab] = {}; d.manualAvgPrices[tab][tk] = p; });
  const clearManualAvg = (tab, tk) => save((d) => { if (d.manualAvgPrices?.[tab]?.[tk] != null) delete d.manualAvgPrices[tab][tk]; });

  const fetchPrice = async (tk) => {
    setFetchStatus(`${tk} 가격 조회 중...`);
    const j = await corsFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?range=1d&interval=1d`);
    const p = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (p) { setCurrentPrice(tk, p); setFetchStatus(`${tk}: $${fmt(p)} 조회 완료`); }
    else setFetchStatus(`${tk} 자동 조회 실패 — 수동 입력해주세요.`);
  };
  const fetchExRate = async () => {
    setFetchStatus("환율 조회 중...");
    const apis = [
      { url: "https://open.er-api.com/v6/latest/USD", ex: (j) => j?.rates?.KRW },
      { url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", ex: (j) => j?.usd?.krw },
      { url: "https://latest.currency-api.pages.dev/v1/currencies/usd.json", ex: (j) => j?.usd?.krw },
    ];
    for (const a of apis) { try { const r = await fetch(a.url); if (r.ok) { const j = await r.json(); const k = a.ex(j); if (k) { setExRate(k); setFetchStatus(`환율: ₩${fmt(k, 2)} 조회 완료`); return; } } } catch {} }
    // All APIs tried directly above
    const j = null;
    const k = j?.rates?.KRW;
    if (k) { setExRate(k); setFetchStatus(`환율: ₩${fmt(k, 2)} 조회 완료`); }
    else setFetchStatus("환율 자동 조회 실패 — 수동 입력해주세요.");
  };

  if (loading || !data) return <div style={{ background: S.bg, color: S.text, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: S.font }}>로딩 중...</div>;

  const activeTab = data.activeTabId;
  const txs = data.transactions[activeTab] || [];
  const holdings = calcHoldings(txs, data.manualAvgPrices?.[activeTab]);
  const cash = calcCash(txs);
  const { total: realizedPL } = calcRealizedPL(txs);
  const totalDiv = calcTotalDividends(txs);
  let stockValue = 0, unrealizedPL = 0;
  Object.entries(holdings).forEach(([tk, h]) => { if (h.shares > 0) { const cp = data.currentPrices[tk] || h.avgPrice; stockValue += cp * h.shares; unrealizedPL += (cp - h.avgPrice) * h.shares; } });
  const totalValue = stockValue + cash;
  const exRate = data.currentExchangeRate || 1380;

  const getAggData = () => {
    const ids = aggTabs.length > 0 ? aggTabs : [activeTab];
    let all = []; ids.forEach((id) => { all = all.concat(data.transactions[id] || []); });
    const ah = calcHoldings(all); const ac = calcCash(all); const ar = calcRealizedPL(all).total;
    const ad = calcTotalDividends(all); const as2 = calcSeedDeposits(all); const ap = calcProfitDeposits(all); const aw = calcWithdrawals(all);
    let sv = 0, up = 0;
    Object.entries(ah).forEach(([tk, h]) => { if (h.shares > 0) { const cp = data.currentPrices[tk] || h.avgPrice; sv += cp * h.shares; up += (cp - h.avgPrice) * h.shares; } });
    return { aggCash: ac, aggRealizedPL: ar, aggDiv: ad, aggSeed: as2, aggProfit: ap, aggWith: aw, aggStockVal: sv, aggUnPL: up, totalValue: sv + ac };
  };

  return (
    <div style={{ background: S.bg, color: S.text, minHeight: "100vh", fontFamily: S.font, fontSize: 14 }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      {modal?.type === "prompt" && <PromptModal title={modal.title} defaultValue={modal.defaultValue} placeholder={modal.placeholder} onConfirm={modal.onConfirm} onCancel={() => setModal(null)} />}
      {modal?.type === "confirm" && <ConfirmModal message={modal.message} onConfirm={modal.onConfirm} onCancel={() => setModal(null)} />}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}

      <div style={{ padding: "16px 20px 0", borderBottom: `1px solid ${S.border}` }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>💹 Investing Portfolio Manager</div>
        <div style={{ display: "flex", gap: 4, alignItems: "end", flexWrap: "wrap" }}>
          {data.tabs.map((tab) => (
            <div key={tab.id} onClick={() => save((d) => { d.activeTabId = tab.id; })}
              style={{ padding: "8px 16px", borderRadius: "8px 8px 0 0", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: tab.id === activeTab ? S.card : "transparent", color: tab.id === activeTab ? S.text : S.dim,
                border: tab.id === activeTab ? `1px solid ${S.border}` : "1px solid transparent",
                borderBottom: tab.id === activeTab ? `1px solid ${S.card}` : "none",
                position: "relative", bottom: -1, display: "flex", gap: 6, alignItems: "center" }}>
              <span>{tab.name}</span>
              {tab.id === activeTab && <span onClick={(e) => { e.stopPropagation(); renameTab(tab.id); }} style={{ fontSize: 11, color: S.dim, cursor: "pointer", opacity: 0.6 }} title="이름 변경">✎</span>}
              {data.tabs.length > 1 && <span onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }} style={{ fontSize: 11, color: S.dim, cursor: "pointer", opacity: 0.6 }} title="삭제">✕</span>}
            </div>
          ))}
          <div onClick={addTab} style={{ padding: "8px 14px", borderRadius: "8px 8px 0 0", cursor: "pointer", fontSize: 13, color: S.accent, fontWeight: 600 }}>+ 탭 추가</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 2, padding: "10px 20px", borderBottom: `1px solid ${S.border}`, background: S.card }}>
        {VIEWS.map((v) => (<button key={v.id} onClick={() => setView(v.id)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: view === v.id ? S.accent : "transparent", color: view === v.id ? "#fff" : S.dim }}>{v.label}</button>))}
      </div>

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

      {fetchStatus && <div style={{ padding: "0 20px 8px" }}><div style={{ fontSize: 12, color: S.accent, fontFamily: S.mono }}>{fetchStatus}</div></div>}

      <div style={{ padding: "0 20px 20px" }}>
        {view === "holdings" && <HoldingsView holdings={holdings} prices={data.currentPrices} exRate={exRate} fetchPrice={fetchPrice} fetchExRate={fetchExRate} setCurrentPrice={setCurrentPrice} setExRate={setExRate} setManualAvg={(t, p) => setManualAvg(activeTab, t, p)} clearManualAvg={(t) => clearManualAvg(activeTab, t)} manualAvg={data.manualAvgPrices?.[activeTab] || {}} />}
        {view === "add" && <AddTransaction addTransaction={addTransaction} />}
        {view === "history" && <TransactionHistory txs={txs} deleteTransaction={deleteTransaction} />}
        {view === "annual" && <AnnualSummary txs={txs} exRate={exRate} />}
        {view === "performance" && <PerformanceView data={data} activeTab={activeTab} getAggData={getAggData} aggTabs={aggTabs} setAggTabs={setAggTabs} ndxYtd={ndxYtd} setNdxYtd={setNdxYtd} spxYtd={spxYtd} setSpxYtd={setSpxYtd} exRate={exRate} setFetchStatus={setFetchStatus} />}
        {view === "settings" && <SettingsView data={data} save={save} fetchExRate={fetchExRate} exRate={exRate} setExRate={setExRate} setModal={setModal} />}
      </div>
    </div>
  );
}

// ═══════ Holdings ═══════
function HoldingsView({ holdings, prices, exRate, fetchPrice, fetchExRate, setCurrentPrice, setExRate, setManualAvg, clearManualAvg, manualAvg }) {
  const [editTicker, setEditTicker] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [priceEdit, setPriceEdit] = useState({});
  const [rateEdit, setRateEdit] = useState("");
  const tickers = Object.keys(holdings).filter((t) => holdings[t].shares > 0);

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: S.dim }}>현재 환율:</span>
        <span style={{ fontFamily: S.mono, fontWeight: 600 }}>₩{fmt(exRate, 2)}</span>
        <button onClick={fetchExRate} style={{ ...btnSm, background: S.accent, color: "#fff" }}>자동 조회</button>
        <input placeholder="수동 입력" value={rateEdit} onChange={(e) => setRateEdit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && rateEdit) { setExRate(parseFloat(rateEdit)); setRateEdit(""); } }}
          style={{ ...inputBase, width: 90 }} />
        {rateEdit && <button onClick={() => { setExRate(parseFloat(rateEdit)); setRateEdit(""); }} style={{ ...btnSm, background: S.green, color: "#fff" }}>적용</button>}
      </div>
      {tickers.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: S.dim, padding: 40 }}>보유 종목이 없습니다. '거래입력'에서 매수를 추가해주세요.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: `2px solid ${S.border}` }}>
              {["종목", "수량", "평단가", "현재가", "평가금액", "미실현 손익", "수익률", ""].map((h, i) => (
                <th key={i} style={{ padding: "8px 10px", textAlign: i > 0 ? "right" : "left", color: S.dim, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {tickers.map((tk) => {
                const h = holdings[tk], cp = prices[tk] || h.avgPrice, mv = cp * h.shares;
                const upl = (cp - h.avgPrice) * h.shares, uplPct = h.avgPrice > 0 ? ((cp - h.avgPrice) / h.avgPrice) * 100 : 0;
                const isM = manualAvg[tk] != null;
                return (
                  <tr key={tk} style={{ borderBottom: `1px solid ${S.border}` }}>
                    <td style={{ padding: 10, fontWeight: 600 }}>{tk}{isM && <span style={{ fontSize: 9, color: S.accent, marginLeft: 4 }}>수동</span>}</td>
                    <td style={{ padding: 10, textAlign: "right", fontFamily: S.mono }}>{fmt4(h.shares)}</td>
                    <td style={{ padding: 10, textAlign: "right", fontFamily: S.mono }}>
                      {editTicker === tk ? (
                        <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                          <input value={editVal} onChange={(e) => setEditVal(e.target.value)} style={{ ...inputBase, width: 80 }} autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { setManualAvg(tk, parseFloat(editVal)); setEditTicker(null); } if (e.key === "Escape") setEditTicker(null); }} />
                          <button onClick={() => { setManualAvg(tk, parseFloat(editVal)); setEditTicker(null); }} style={{ ...btnSm, background: S.green, color: "#fff" }}>✓</button>
                        </div>
                      ) : (
                        <span onClick={() => { setEditTicker(tk); setEditVal(h.avgPrice.toFixed(4)); }} style={{ cursor: "pointer", borderBottom: `1px dashed ${S.dim}` }}>${fmt4(h.avgPrice)}</span>
                      )}
                      {isM && <button onClick={() => clearManualAvg(tk)} style={{ ...btnSm, background: "transparent", color: S.dim, fontSize: 9, marginLeft: 2 }}>초기화</button>}
                    </td>
                    <td style={{ padding: 10, textAlign: "right", fontFamily: S.mono }}>
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        {priceEdit[tk] != null ? (
                          <><input value={priceEdit[tk]} onChange={(e) => setPriceEdit((p) => ({ ...p, [tk]: e.target.value }))} style={{ ...inputBase, width: 80 }} autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { setCurrentPrice(tk, parseFloat(priceEdit[tk])); setPriceEdit((p) => { const n = { ...p }; delete n[tk]; return n; }); } }} />
                          <button onClick={() => { setCurrentPrice(tk, parseFloat(priceEdit[tk])); setPriceEdit((p) => { const n = { ...p }; delete n[tk]; return n; }); }} style={{ ...btnSm, background: S.green, color: "#fff" }}>✓</button></>
                        ) : (
                          <><span onClick={() => setPriceEdit((p) => ({ ...p, [tk]: cp.toFixed(2) }))} style={{ cursor: "pointer", borderBottom: `1px dashed ${S.dim}` }}>${fmt(cp)}</span>
                          <button onClick={() => fetchPrice(tk)} style={{ ...btnSm, background: S.accent, color: "#fff" }}>조회</button></>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: 10, textAlign: "right", fontFamily: S.mono }}>${fmt(mv)}<br /><span style={{ fontSize: 10, color: S.dim }}>{fmtKRW(mv, exRate)}</span></td>
                    <td style={{ padding: 10, textAlign: "right", fontFamily: S.mono, color: plColor(upl) }}>${fmt(upl)}<br /><span style={{ fontSize: 10 }}>{fmtKRW(upl, exRate)}</span></td>
                    <td style={{ padding: 10, textAlign: "right", fontFamily: S.mono, color: plColor(upl) }}>{pct(uplPct)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}><button onClick={() => fetchPrice(tk)} style={{ ...btnSm, background: "transparent", color: S.dim }}>🔄</button></td>
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

// ═══════ Add Transaction ═══════
function AddTransaction({ addTransaction }) {
  const [type, setType] = useState("buy");
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), ticker: "", quantity: "", price: "", amount: "", subType: "seed" });
  const [error, setError] = useState("");
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = () => {
    setError("");
    const tx = { type, date: form.date };
    if (type === "buy") { if (!form.ticker || !form.quantity || !form.price) { setError("모든 필드를 입력해주세요."); return; } tx.ticker = form.ticker.toUpperCase(); tx.quantity = parseFloat(form.quantity); tx.price = parseFloat(form.price); }
    else if (type === "sell") { if (!form.ticker || !form.quantity || !form.price) { setError("모든 필드를 입력해주세요."); return; } tx.ticker = form.ticker.toUpperCase(); tx.quantity = parseFloat(form.quantity); tx.price = parseFloat(form.price); }
    else if (type === "dividend") { if (!form.ticker || !form.amount) { setError("모든 필드를 입력해주세요."); return; } tx.ticker = form.ticker.toUpperCase(); tx.amount = parseFloat(form.amount); }
    else if (type === "deposit") { if (!form.amount) { setError("금액을 입력해주세요."); return; } tx.amount = parseFloat(form.amount); tx.subType = form.subType; }
    else if (type === "withdrawal") { if (!form.amount) { setError("금액을 입력해주세요."); return; } tx.amount = parseFloat(form.amount); }
    addTransaction(tx);
    setForm({ date: new Date().toISOString().slice(0, 10), ticker: "", quantity: "", price: "", amount: "", subType: "seed" });
  };

  return (
    <div style={{ ...cardStyle, maxWidth: 500 }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>거래 입력</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {TX_TYPES.map((t) => (<button key={t.id} onClick={() => { setType(t.id); setError(""); }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: type === t.id ? (t.id === "buy" ? S.green : t.id === "sell" ? S.red : S.accent) : "transparent", color: type === t.id ? "#fff" : S.dim }}>{t.label}</button>))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label style={labelSt}>날짜</label><input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} style={inputBase} /></div>
        {(type === "buy" || type === "sell" || type === "dividend") && <div><label style={labelSt}>종목 (티커)</label><input placeholder="AAPL" value={form.ticker} onChange={(e) => set("ticker", e.target.value)} style={inputBase} /></div>}
        {(type === "buy" || type === "sell") && <>
          <div><label style={labelSt}>수량 (주)</label><input type="number" step="0.0001" placeholder="10" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} style={inputBase} /></div>
          <div><label style={labelSt}>{type === "buy" ? "매수 단가" : "매도 단가"} (USD)</label><input type="number" step="0.01" placeholder="150.00" value={form.price} onChange={(e) => set("price", e.target.value)} style={inputBase} /></div>
        </>}
        {(type === "dividend" || type === "deposit" || type === "withdrawal") && <div><label style={labelSt}>금액 (USD)</label><input type="number" step="0.01" placeholder="100.00" value={form.amount} onChange={(e) => set("amount", e.target.value)} style={inputBase} /></div>}
        {type === "deposit" && <div><label style={labelSt}>입금 유형</label><div style={{ display: "flex", gap: 4 }}>{DEPOSIT_SUBTYPES.map((st) => (<button key={st.id} onClick={() => set("subType", st.id)} style={{ padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: form.subType === st.id ? S.accent : "#0f1729", color: form.subType === st.id ? "#fff" : S.dim }}>{st.label}</button>))}</div></div>}
        {(type === "buy" || type === "sell") && form.quantity && form.price && (
          <div style={{ fontSize: 12, color: S.dim, fontFamily: S.mono, padding: "8px 0", borderTop: `1px solid ${S.border}` }}>
            거래 금액: <span style={{ color: S.text, fontWeight: 600 }}>${fmt(parseFloat(form.quantity || 0) * parseFloat(form.price || 0))}</span>
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: S.red, fontWeight: 600 }}>{error}</div>}
        <button onClick={submit} style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, background: S.accent, color: "#fff", marginTop: 8 }}>
          {TX_TYPES.find((t) => t.id === type)?.label} 추가
        </button>
      </div>
    </div>
  );
}

// ═══════ History ═══════
function TransactionHistory({ txs, deleteTransaction }) {
  const tl = { buy: "매수", sell: "매도", dividend: "배당", deposit: "입금", withdrawal: "출금" };
  const tc = { buy: S.green, sell: S.red, dividend: "#a78bfa", deposit: S.accent, withdrawal: "#f59e0b" };
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  if (!sorted.length) return <div style={{ ...cardStyle, textAlign: "center", color: S.dim, padding: 40 }}>거래 내역이 없습니다.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr style={{ borderBottom: `2px solid ${S.border}` }}>{["날짜", "유형", "종목", "수량", "단가/금액", "거래금액", ""].map((h, i) => (<th key={i} style={{ padding: "8px 10px", textAlign: i > 2 ? "right" : "left", color: S.dim, fontSize: 11, fontWeight: 600 }}>{h}</th>))}</tr></thead>
        <tbody>{sorted.map((tx) => {
          const isTrade = tx.type === "buy" || tx.type === "sell";
          return (
            <tr key={tx.id} style={{ borderBottom: `1px solid ${S.border}` }}>
              <td style={{ padding: "8px 10px", fontFamily: S.mono, fontSize: 12 }}>{tx.date}</td>
              <td style={{ padding: "8px 10px" }}><span style={{ color: tc[tx.type], fontWeight: 600 }}>{tl[tx.type]}{tx.subType === "seed" ? " (시드)" : tx.subType === "profit" ? " (수익)" : ""}</span></td>
              <td style={{ padding: "8px 10px", fontWeight: 600 }}>{tx.ticker || "—"}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono }}>{tx.quantity ? fmt4(tx.quantity) : "—"}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono }}>${fmt(isTrade ? tx.price : tx.amount)}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", fontFamily: S.mono }}>${fmt(isTrade ? tx.quantity * tx.price : tx.amount)}</td>
              <td style={{ padding: "8px 10px", textAlign: "right" }}><button onClick={() => deleteTransaction(tx.id)} style={{ background: "transparent", border: "none", color: S.red, cursor: "pointer", fontSize: 12 }}>삭제</button></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

// ═══════ Annual ═══════
function AnnualSummary({ txs, exRate }) {
  const years = getYears(txs);
  if (!years.length) return <div style={{ ...cardStyle, textAlign: "center", color: S.dim, padding: 40 }}>데이터가 없습니다.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {years.map((yr) => {
        const yt = txs.filter((t) => t.date?.startsWith(yr));
        const buys = yt.filter((t) => t.type === "buy"), sells = yt.filter((t) => t.type === "sell");
        const divs = yt.filter((t) => t.type === "dividend"), deps = yt.filter((t) => t.type === "deposit"), withs = yt.filter((t) => t.type === "withdrawal");
        const h = {}; let yrPL = 0;
        for (const tx of txs.filter((t) => t.date <= `${yr}-12-31`).sort((a, b) => a.date.localeCompare(b.date))) {
          if (tx.type === "buy") { if (!h[tx.ticker]) h[tx.ticker] = { s: 0, c: 0, a: 0 }; h[tx.ticker].c += tx.quantity * tx.price; h[tx.ticker].s += tx.quantity; h[tx.ticker].a = h[tx.ticker].c / h[tx.ticker].s; }
          else if (tx.type === "sell" && h[tx.ticker]) { const q = Math.min(tx.quantity, h[tx.ticker].s); if (tx.date.startsWith(yr)) yrPL += (tx.price - h[tx.ticker].a) * q; h[tx.ticker].c -= h[tx.ticker].a * q; h[tx.ticker].s -= q; if (h[tx.ticker].s <= 0.0001) { h[tx.ticker].s = 0; h[tx.ticker].c = 0; h[tx.ticker].a = 0; } }
        }
        const rows = [
          { label: "총 매수", val: buys.reduce((s, t) => s + t.quantity * t.price, 0), count: `${buys.length}건` },
          { label: "총 매도", val: sells.reduce((s, t) => s + t.quantity * t.price, 0), count: `${sells.length}건` },
          { label: "실현 손익", val: yrPL, color: plColor(yrPL) },
          { label: "배당 수익", val: divs.reduce((s, t) => s + t.amount, 0), count: `${divs.length}건`, color: divs.length ? S.green : null },
          { label: "입금 (시드)", val: deps.filter((t) => t.subType === "seed").reduce((s, t) => s + t.amount, 0) },
          { label: "입금 (수익)", val: deps.filter((t) => t.subType === "profit").reduce((s, t) => s + t.amount, 0) },
          { label: "출금", val: withs.reduce((s, t) => s + t.amount, 0) },
        ];
        return (
          <div key={yr} style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{yr}년</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
              {rows.map((r, i) => (<div key={i} style={{ padding: "8px 10px", background: "#0f1729", borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: S.dim }}>{r.label} {r.count && <span style={{ color: S.accent }}>{r.count}</span>}</div>
                <div style={{ fontFamily: S.mono, fontWeight: 600, fontSize: 13, color: r.color || S.text, marginTop: 2 }}>${fmt(r.val)}</div>
                <div style={{ fontFamily: S.mono, fontSize: 10, color: S.dim }}>{fmtKRW(r.val, exRate)}</div>
              </div>))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════ Performance ═══════
function PerformanceView({ data, activeTab, getAggData, aggTabs, setAggTabs, ndxYtd, setNdxYtd, spxYtd, setSpxYtd, exRate, setFetchStatus }) {
  const [fi, setFi] = useState(false);
  const fetchIdx = async () => {
    setFi(true);
    try {
      const fy = async (sym) => { const j = await corsFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=ytd&interval=1d`); const r = j?.chart?.result?.[0]; if (r) { const o = r.indicators?.quote?.[0]?.open, c = r.indicators?.quote?.[0]?.close; if (o && c) { const f = o.find((v) => v != null), l = [...c].reverse().find((v) => v != null); if (f && l) return ((l - f) / f * 100).toFixed(2); } } return null; };
      const [n, s] = await Promise.all([fy("^NDX"), fy("^GSPC")]);
      if (n) setNdxYtd(n); if (s) setSpxYtd(s);
      if (!n && !s) setFetchStatus("지수 자동 조회 실패. 수동으로 입력해주세요.");
    } catch { setFetchStatus("지수 조회 실패"); }
    setFi(false);
  };

  const a = getAggData();
  const mb = a.aggSeed, mg = a.totalValue - a.aggSeed, mp = mb > 0 ? (mg / mb) * 100 : 0;
  const cb = a.aggStockVal - a.aggUnPL, pg = a.aggUnPL + a.aggRealizedPL + a.aggDiv, pp = cb > 0 ? (pg / cb) * 100 : 0;
  const nv = parseFloat(ndxYtd) || 0, sv = parseFloat(spxYtd) || 0;

  const PerfGrid = ({ items }) => (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
      {items.map((it, i) => (
        <div key={i} style={{ background: "#0f1729", borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: S.dim, marginBottom: 6 }}>{it.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: S.mono, color: plColor(it.value) }}>{pct(it.value)}</div>
          <div style={{ fontSize: 12, fontFamily: S.mono, color: plColor(it.amount), marginTop: 4 }}>${fmt(it.amount)}</div>
          <div style={{ fontSize: 10, fontFamily: S.mono, color: S.dim }}>{fmtKRW(it.amount, exRate)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>비교할 탭 선택</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {data.tabs.map((t) => { const sel = aggTabs.includes(t.id); return (<button key={t.id} onClick={() => setAggTabs((p) => sel ? p.filter((id) => id !== t.id) : [...p, t.id])} style={{ ...btnSm, background: sel ? S.accent : "#0f1729", color: sel ? "#fff" : S.dim, border: `1px solid ${sel ? S.accent : S.border}` }}>{t.name}</button>); })}
        </div>
        <div style={{ fontSize: 11, color: S.dim, marginTop: 6 }}>선택하지 않으면 현재 탭만 계산됩니다.</div>
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>NDX / SPX YTD 수익률</div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div><span style={{ fontSize: 11, color: S.dim, marginRight: 6 }}>NDX:</span><input value={ndxYtd} onChange={(e) => setNdxYtd(e.target.value)} placeholder="0.00" style={{ ...inputBase, width: 100 }} /><span style={{ fontSize: 11, color: S.dim, marginLeft: 4 }}>%</span></div>
          <div><span style={{ fontSize: 11, color: S.dim, marginRight: 6 }}>SPX:</span><input value={spxYtd} onChange={(e) => setSpxYtd(e.target.value)} placeholder="0.00" style={{ ...inputBase, width: 100 }} /><span style={{ fontSize: 11, color: S.dim, marginLeft: 4 }}>%</span></div>
          <button onClick={fetchIdx} disabled={fi} style={{ ...btnSm, background: S.accent, color: "#fff", opacity: fi ? 0.5 : 1 }}>{fi ? "조회 중..." : "자동 조회"}</button>
        </div>
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>📊 메인 지표 — 실질 계좌 성장</div>
        <div style={{ fontSize: 11, color: S.dim, marginBottom: 14 }}>시드머니 제외, 수익 입금·출금·투자 성과 모두 반영</div>
        <PerfGrid items={[{ label: "내 계좌", value: mp, amount: mg }, { label: "NDX YTD", value: nv, amount: mb * nv / 100 }, { label: "SPX YTD", value: sv, amount: mb * sv / 100 }]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          {[{ label: "계좌 총 가치", val: a.totalValue }, { label: "시드 자본", val: a.aggSeed }, { label: "수익 입금", val: a.aggProfit }, { label: "출금", val: a.aggWith }].map((r, i) => (<div key={i} style={{ padding: "6px 10px", background: "#0f1729", borderRadius: 6 }}><div style={{ fontSize: 10, color: S.dim }}>{r.label}</div><div style={{ fontFamily: S.mono, fontSize: 12, fontWeight: 600 }}>${fmt(r.val)}</div><div style={{ fontFamily: S.mono, fontSize: 10, color: S.dim }}>{fmtKRW(r.val, exRate)}</div></div>))}
        </div>
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🎯 보조 지표 — 순수 투자 수익률</div>
        <div style={{ fontSize: 11, color: S.dim, marginBottom: 14 }}>외부 입출금 제외, 미실현+실현 손익+배당만 계산</div>
        <PerfGrid items={[{ label: "내 투자", value: pp, amount: pg }, { label: "NDX YTD", value: nv, amount: cb * nv / 100 }, { label: "SPX YTD", value: sv, amount: cb * sv / 100 }]} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          {[{ label: "미실현 손익", val: a.aggUnPL, color: plColor(a.aggUnPL) }, { label: "실현 손익", val: a.aggRealizedPL, color: plColor(a.aggRealizedPL) }, { label: "배당 수익", val: a.aggDiv, color: a.aggDiv > 0 ? S.green : null }, { label: "투자 원금", val: cb }].map((r, i) => (<div key={i} style={{ padding: "6px 10px", background: "#0f1729", borderRadius: 6 }}><div style={{ fontSize: 10, color: S.dim }}>{r.label}</div><div style={{ fontFamily: S.mono, fontSize: 12, fontWeight: 600, color: r.color || S.text }}>${fmt(r.val)}</div><div style={{ fontFamily: S.mono, fontSize: 10, color: S.dim }}>{fmtKRW(r.val, exRate)}</div></div>))}
        </div>
      </div>
    </div>
  );
}

// ═══════ Settings ═══════
function SettingsView({ data, save, fetchExRate, exRate, setExRate, setModal }) {
  const [ri, setRi] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 500 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>환율 설정</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: S.dim }}>현재:</span><span style={{ fontFamily: S.mono, fontWeight: 600 }}>₩{fmt(exRate, 2)}</span>
          <button onClick={fetchExRate} style={{ ...btnSm, background: S.accent, color: "#fff" }}>자동 조회</button>
          <input placeholder="수동 입력" value={ri} onChange={(e) => setRi(e.target.value)} style={{ ...inputBase, width: 120 }} />
          {ri && <button onClick={() => { setExRate(parseFloat(ri)); setRi(""); }} style={{ ...btnSm, background: S.green, color: "#fff" }}>적용</button>}
        </div>
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>탭 관리</div>
        {data.tabs.map((tab) => (
          <div key={tab.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, padding: "8px 10px", background: "#0f1729", borderRadius: 6 }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{tab.name}</span>
            <button onClick={() => setModal({ type: "prompt", title: "탭 이름 변경", defaultValue: tab.name, onConfirm: (n) => { save((d) => { d.tabs = d.tabs.map((t) => t.id === tab.id ? { ...t, name: n } : t); }); setModal(null); } })} style={{ ...btnSm, background: S.accent, color: "#fff" }}>이름 변경</button>
            {data.tabs.length > 1 && <button onClick={() => setModal({ type: "confirm", message: `'${tab.name}' 탭을 삭제하시겠습니까?`, onConfirm: () => { save((d) => { d.tabs = d.tabs.filter((t) => t.id !== tab.id); const tx = { ...d.transactions }; delete tx[tab.id]; d.transactions = tx; if (d.activeTabId === tab.id) d.activeTabId = d.tabs[0]?.id || ""; }); setModal(null); } })} style={{ ...btnSm, background: S.red, color: "#fff" }}>삭제</button>}
          </div>
        ))}
      </div>
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>데이터 관리</div>
        <button onClick={() => setModal({ type: "confirm", message: "모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.", onConfirm: () => { save((d) => Object.assign(d, defaultData)); setModal(null); } })} style={{ ...btnSm, background: S.red, color: "#fff" }}>전체 데이터 초기화</button>
      </div>
    </div>
  );
}
