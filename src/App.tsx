import { useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { parseEther, formatEther } from "viem";
import * as d3 from "d3";
import { ShieldCheck, ArrowUpRight, ArrowRight } from "@phosphor-icons/react";
import RhythmicRipplesBackground from "./components/ui/rhythmic-ripples-background";
import {
  fundPool, fileClaim, adjudicate, settleClaim,
  getCase, getCounts, getPoolBalance, listAll,
  extractFirstUrl,
  ClaimCaseView, ClaimRow,
} from "./contractService";

type Hex = `0x${string}`;
const STATUS_LABEL = ["filed", "ruled", "settled"];
const PREFERS_REDUCED = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;

function fmt(units: string): string {
  // damage_units stored as u256-like string; show with thin separators.
  if (!units) return "0";
  return units.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1\u202f");
}
function gen(wei: string): string {
  if (!wei || wei === "0") return "0";
  try {
    const v = formatEther(BigInt(wei));
    const n = Number(v);
    return Number.isFinite(n) && n >= 1 ? (Math.round(n * 1000) / 1000).toString() : v;
  } catch {
    return "0";
  }
}

// variant: area chart of damage_units (for COVERED claims) over time.
function DamageArea({ rows }: { rows: ClaimRow[] }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const ruled = useMemo(() => rows.filter((r) => r.verdict).slice().reverse(), [rows]);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const W = 720, H = 240;
    const PAD = { l: 50, r: 18, t: 14, b: 22 };

    if (ruled.length === 0) {
      svg.append("text").attr("x", W / 2).attr("y", H / 2).attr("class", "empty").attr("text-anchor", "middle").text("No claims ruled yet. File the first exploit aftermath.");
      return;
    }

    const damages = ruled.map((r) => Number(r.damageUnits) || 0);
    const maxD = Math.max(1, d3.max(damages) || 1);
    const xs = d3.scaleLinear().domain([0, Math.max(1, ruled.length - 1)]).range([PAD.l, W - PAD.r]);
    const ys = d3.scaleLinear().domain([0, maxD * 1.1]).range([H - PAD.b, PAD.t]);

    const g = svg.append("g").attr("class", "grid");
    [0, Math.round(maxD / 2), maxD].forEach((v) => {
      g.append("line").attr("x1", PAD.l).attr("x2", W - PAD.r).attr("y1", ys(v)).attr("y2", ys(v)).attr("class", "g");
      g.append("text").attr("x", 6).attr("y", ys(v)).attr("dy", "0.35em").attr("class", "gl").text(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toString());
    });

    const pts = ruled.map((r, i) => ({ x: xs(i), y: ys(damages[i]), r }));
    const a = d3.area<typeof pts[0]>().x((d) => d.x).y0(H - PAD.b).y1((d) => d.y).curve(d3.curveCatmullRom);
    const lp = d3.line<typeof pts[0]>().x((d) => d.x).y((d) => d.y).curve(d3.curveCatmullRom);
    svg.append("path").attr("d", a(pts) as string).attr("class", "ar-damage");
    const p = svg.append("path").attr("d", lp(pts) as string).attr("class", "ar-line");
    const len = (p.node() as SVGPathElement).getTotalLength();
    if (PREFERS_REDUCED) {
      p.attr("stroke-dashoffset", 0);
    } else {
      p.attr("stroke-dasharray", `${len} ${len}`).attr("stroke-dashoffset", len)
        .transition().duration(900).ease(d3.easeCubicOut).attr("stroke-dashoffset", 0);
    }

    svg.append("g").selectAll("circle").data(pts).join("circle")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", 4)
      .attr("class", (d) => `dot v-${d.r.verdict}`);
  }, [ruled]);
  return <svg ref={ref} className="area" viewBox="0 0 720 240" preserveAspectRatio="xMidYMid meet" />;
}

function Spark({ values }: { values: number[] }) {
  const ref = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    if (values.length === 0) return;
    const W = 88, H = 22;
    const xs = d3.scaleLinear().domain([0, Math.max(1, values.length - 1)]).range([0, W]);
    const ys = d3.scaleLinear().domain([0, Math.max(1, d3.max(values) || 1)]).range([H - 1, 1]);
    svg.append("path").attr("d", d3.area<number>().x((_, i) => xs(i)).y0(H).y1((d) => ys(d)).curve(d3.curveMonotoneX)(values) as string).attr("class", "sp-a");
    svg.append("path").attr("d", d3.line<number>().x((_, i) => xs(i)).y((d) => ys(d)).curve(d3.curveMonotoneX)(values) as string).attr("class", "sp-l");
  }, [values]);
  return <svg ref={ref} className="spark" viewBox="0 0 88 22" preserveAspectRatio="none" />;
}

function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (PREFERS_REDUCED) { setN(value); prev.current = value; return; }
    const from = prev.current, to = value, dur = 650, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setN(Math.round(from + (to - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}

export function App() {
  const { address, isConnected } = useAccount();
  const acct = address as Hex | undefined;

  const [protocolName, setProtocolName] = useState("");
  const [onchainTrace, setOnchainTrace] = useState("");
  const [postmortem, setPostmortem] = useState("");
  const [coverage, setCoverage] = useState("");
  const [fundAmt, setFundAmt] = useState("");
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ next: 0, ruled: 0, covered: 0 });
  const [pool, setPool] = useState("0");
  const [selId, setSelId] = useState<number | null>(null);
  const [sel, setSel] = useState<ClaimCaseView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [netErr, setNetErr] = useState(false);

  async function refreshAll() {
    if (typeof document !== "undefined" && document.hidden) return; // pause when tab hidden
    try {
      const [c, p, list] = await Promise.all([getCounts(), getPoolBalance(), listAll(50)]);
      setCounts(c); setPool(p.split("||")[0] || "0"); setRows(list);
      if (selId != null) { try { setSel(await getCase(selId)); } catch { /* keep */ } }
      setNetErr(false);
    } catch { setNetErr(true); /* surfaced, not silent */ }
    finally { setLoading(false); }
  }
  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 12000);
    const onVis = () => { if (!document.hidden) refreshAll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  async function pick(id: number) {
    setSelId(id);
    try { setSel(await getCase(id)); } catch { setSel(null); }
  }
  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setNote("");
    try { return await fn(); } catch (e) { setNote(String((e as Error).message || e).slice(0, 220)); return undefined; }
    finally { setBusy(null); refreshAll(); }
  }

  async function onFile() {
    if (!acct) return;
    if (protocolName.trim().length < 2) return setNote("Protocol name is required.");
    if (onchainTrace.trim().length < 25) return setNote("On-chain trace must include at least 25 chars.");
    if (postmortem.trim().length < 25) return setNote("Postmortem must include at least 25 chars (URLs welcome).");
    if (!(Number(coverage) > 0)) return setNote("Coverage (sum insured) in GEN is required, e.g. 2.");
    const id = await run("Filing the exploit claim", () => fileClaim(acct, { protocolName, onchainTrace, postmortem, coverageWei: parseEther(coverage.trim()) }));
    if (id != null) { setSelId(id); setCoverage(""); setNote(`Claim #${id} filed. Run adjudication to read the trace.`); }
  }
  async function onFund() { if (!acct) return; if (!fundAmt.trim() || !(Number(fundAmt) > 0)) return setNote("Enter an amount in GEN."); await run("Funding the insurance pool", () => fundPool(acct, parseEther(fundAmt))); setFundAmt(""); }
  async function onAdjudicate() { if (!acct || selId == null) return; await run("Validators reading the trace", () => adjudicate(acct, selId)); }
  async function onSettle() { if (!acct || selId == null) return; await run("Settling the claim payout", () => settleClaim(acct, selId)); }

  const sparkRuled = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.verdict ? 1 : 0)); }, [rows]);
  const sparkCovered = useMemo(() => { let acc = 0; return rows.slice().reverse().map((r) => (acc += r.verdict === "COVERED" ? 1 : 0)); }, [rows]);
  const sparkDamage = useMemo(() => rows.filter((r) => r.verdict).slice().reverse().map((r) => Number(r.damageUnits) || 0), [rows]);
  const sparkPayout = useMemo(() => rows.filter((r) => r.status === 2).slice().reverse().map((r) => Number(r.payout) || 0), [rows]);
  const totalDamage = useMemo(() => rows.reduce((a, r) => a + (Number(r.damageUnits) || 0), 0), [rows]);
  const maxDmg = useMemo(() => Math.max(1, ...rows.map((r) => Number(r.damageUnits) || 0)), [rows]);

  return (
    <RhythmicRipplesBackground rippleColor="rgba(99, 91, 255, 0.72)" rippleCount={34} rippleSpeed={0.44}>
    <div className="page">
      <header className="bar">
        <div className="brand">
          <ShieldCheck weight="duotone" className="brand-ic" />
          <span className="wm">Aftermath</span>
          <em className="tag">exploit claim system</em>
        </div>
        <div className="bar-r">
          <span className="chip"><i className="dot" /> GenLayer / studionet / {netErr ? "reconnecting..." : "live"}</span>
          <ConnectButton.Custom>
            {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
              const connected = mounted && account && chain;
              return (
                <div className="wallet-slot" aria-hidden={!mounted}>
                  {connected ? (
                    chain.unsupported ? (
                      <button type="button" className="wallet-btn" onClick={openChainModal}>Wrong network</button>
                    ) : (
                      <button type="button" className="wallet-btn" onClick={openAccountModal}>{account.displayName}</button>
                    )
                  ) : (
                    <button type="button" className="wallet-btn" onClick={openConnectModal}>Connecter le portefeuille</button>
                  )}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </header>

      <section className="hero">
        <div className="hcopy">
          <p className="kicker">Aftermath / on-chain exploit insurance</p>
          <h1>Exploit claims,<br />forged clean.</h1>
          <p className="lede">
            Aftermath pools capital against smart-contract exploits. File a claim with the on-chain trace and the public
            post-mortem. A panel of GenLayer validators audits the evidence and rules the <em>eligible damage in
            covered units</em>. Only proven exploits are paid; arbitrage and operator error are not.
          </p>
          <div className="cta-row">
            <a className="cta" href="#desk">Open the claims desk <ArrowRight weight="bold" /></a>
            <a className="cta-ghost" href="#how">How it works</a>
          </div>
          <div className="meta">
            <span>verdicts</span><code>COVERED / NOT_COVERED</code>
          </div>
          <p className="prov">Source: on-chain trace plus submitted post-mortem, judged by GenLayer validators via <code>gl.nondet.exec_prompt</code> with 20% damage consensus.</p>
        </div>
        <div className="hviz">
          <div className="hviz-h">
            <span>Damage claimed by ruling</span>
            <span className="muted">eligible units, ruling-by-ruling</span>
          </div>
          <DamageArea rows={rows} />
        </div>
      </section>

      <section className="stats">
        <div className="stat"><span className="lbl">Claims filed</span><span className="num"><CountUp value={counts.next} /></span><Spark values={Array.from({ length: counts.next + 1 }, (_, i) => i)} /></div>
        <div className="stat"><span className="lbl">Adjudicated</span><span className="num"><CountUp value={counts.ruled} /></span><Spark values={sparkRuled} /></div>
        <div className="stat"><span className="lbl">Covered</span><span className="num"><CountUp value={counts.covered} /></span><Spark values={sparkCovered} /></div>
        <div className="stat"><span className="lbl">Total damage</span><span className="num">{fmt(totalDamage.toString())}</span><Spark values={sparkDamage} /></div>
        <div className="stat"><span className="lbl">Insurance pool</span><span className="num">{gen(pool)} GEN</span><Spark values={sparkPayout} /></div>
      </section>

      <section className="how" id="how">
        <div className="how-h">
          <p className="kicker">How Aftermath works</p>
          <h2>From breach to payout, entirely on-chain.</h2>
        </div>
        <div className="how-steps">
          <article className="step">
            <span className="step-n">01</span>
            <h3>Underwrite the pool</h3>
            <p>Backers deposit GEN into a shared insurance pool. It is the capital every covered claim is paid from: transparent and on-chain.</p>
          </article>
          <article className="step">
            <span className="step-n">02</span>
            <h3>File the claim</h3>
            <p>A policyholder submits the protocol name, the on-chain trace (tx hashes, asset flows) and the public post-mortem. URLs are welcome as evidence.</p>
          </article>
          <article className="step">
            <span className="step-n">03</span>
            <h3>Validators adjudicate</h3>
            <p>GenLayer validators read the trace against the post-mortem, agree on the eligible damage within 20%, and rule <strong>COVERED</strong> or <strong>NOT_COVERED</strong>.</p>
          </article>
          <article className="step">
            <span className="step-n">04</span>
            <h3>Settle the payout</h3>
            <p>A covered exploit is paid its eligible damage from the pool. Arbitrage, market loss and operator error are ruled out: no payout.</p>
          </article>
        </div>
      </section>

      <section className="work" id="desk">
        <div className="ledger">
          <div className="ledger-h">
            <h2>Claim ledger</h2>
            <span className="muted">{rows.length} on-chain / post-mortem linked per row</span>
          </div>
          {loading ? (
            <div className="skel-feed">{[0, 1, 2, 3].map((i) => (<div key={i} className="skel-row" />))}</div>
          ) : rows.length === 0 ? (<p className="empty-row">No claims yet. File the first exploit aftermath.</p>) : (
              <div className="claim-cards">
                {rows.map((r, i) => {
                  const url = extractFirstUrl(r.postmortem);
                  const pct = r.verdict ? Math.max(4, Math.round(((Number(r.damageUnits) || 0) / maxDmg) * 100)) : 0;
                  return (
                    <article
                      key={r.id}
                      className={`claim-card v-${r.verdict || "none"} ${selId === r.id ? "sel" : ""}`}
                      style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Claim ${r.id}, ${r.protocolName || "protocol"}, ${r.verdict || "pending"}`}
                      onClick={() => pick(r.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(r.id); } }}
                    >
                      <div className="cc-top">
                        <code className="cc-id">#{r.id}</code>
                        <span className={`vd v-${r.verdict || "none"}`}>{r.verdict || "pending"}</span>
                      </div>
                      <h3 className="cc-title">{r.protocolName || "Untitled protocol"}</h3>
                      <div className="cc-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                      <div className="cc-meta">
                        <span className="cc-status">{STATUS_LABEL[r.status] || r.status}</span>
                        <span className="cc-dmg">damage <strong>{fmt(r.damageUnits)}</strong>{r.status === 2 ? <> {"\u00b7"} paid <strong>{gen(r.payout)} GEN</strong></> : null}</span>
                        {url && (<a className="link" href={url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>postmortem <ArrowUpRight weight="bold" size={11} /></a>)}
                      </div>
                    </article>
                  );
                })}
              </div>
          )}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>File an exploit claim</h3>
            <label>Protocol name</label>
            <input value={protocolName} onChange={(e) => setProtocolName(e.target.value)} placeholder="e.g. Acme Lending Protocol" />
            <label>On-chain trace</label>
            <textarea value={onchainTrace} onChange={(e) => setOnchainTrace(e.target.value)} placeholder="Tx hashes, function signatures, attacker address, asset flows..." />
            <label>Post-mortem narrative (URLs welcome)</label>
            <textarea value={postmortem} onChange={(e) => setPostmortem(e.target.value)} placeholder="Public summary, blog post, Twitter thread, reproduction... include https:// URLs." />
            <label>Coverage / sum insured (GEN)</label>
            <input value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="e.g. 2" inputMode="decimal" />
            <button className="go" disabled={!isConnected || !!busy || protocolName.trim().length < 2 || onchainTrace.trim().length < 25 || postmortem.trim().length < 25} onClick={onFile}>
              {isConnected ? "File the exploit claim" : "Connect a wallet to file"}
            </button>
          </div>

          <div className="panel">
            <h3>Fund the pool</h3>
            <div className="row2">
              <div><label>Amount (GEN)</label><input value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} placeholder="e.g. 100" inputMode="decimal" /></div>
              <div className="alignend"><button className="ghost" disabled={!isConnected || !!busy || !fundAmt.trim() || !(Number(fundAmt) > 0)} onClick={onFund}>Top up</button></div>
            </div>
          </div>

          {sel && selId != null && (
            <div className="panel selpanel">
              <h3>Selected / claim <code>#{selId}</code></h3>
              <div className="kv"><span>protocol</span><code>{sel.protocolName}</code></div>
              <div className="kv"><span>status</span><b>{STATUS_LABEL[sel.status] || sel.status}</b></div>
              {sel.verdict ? (
                <>
                  <div className={`verdict v-${sel.verdict}`}>{sel.verdict.replace("_", " ")}</div>
                  <div className="kv"><span>damage</span><code>{fmt(sel.damageUnits)}</code></div>
                  <div className="kv"><span>payout</span><code>{gen(sel.payout)} GEN</code></div>
                  {sel.rationale && <p className="rationale">{sel.rationale}</p>}
                </>
              ) : (<p className="muted">Awaiting trace audit.</p>)}
              {sel.status === 0 && (<button className="go" disabled={!isConnected || !!busy} onClick={onAdjudicate}>Audit trace &amp; rule</button>)}
              {sel.status === 1 && sel.verdict === "COVERED" && (<button className="go" disabled={!isConnected || !!busy} onClick={onSettle}>Settle payout</button>)}
              {sel.status === 1 && sel.verdict === "NOT_COVERED" && (<p className="muted">Not covered: likely arbitrage rather than exploit.</p>)}
              {sel.status === 2 && (<p className="muted">Settled. Payout released.</p>)}
            </div>
          )}
        </aside>
      </section>

      {(busy || note) && <div className="toast">{busy ? `${busy}...` : note}</div>}

      <footer className="foot">
        <span>insurance pool {gen(pool)} GEN / {counts.covered} covered</span>
        <span>claim verdicts reproduced by independent GenLayer validators on studionet</span>
      </footer>
    </div>
    </RhythmicRipplesBackground>
  );
}
