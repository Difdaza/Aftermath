import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { CONTRACT_ADDRESS } from "./chain";

type Hex = `0x${string}`;
const TIMEOUT_MS = 240_000;

export type Verdict = "COVERED" | "NOT_COVERED" | "";

export interface ClaimCaseView {
  claimant: string;
  protocolName: string;
  onchainTrace: string;
  postmortem: string;
  payout: string;
  damageUnits: string;
  covered: boolean;
  status: number; // 0 FILED, 1 RULED, 2 SETTLED
  verdict: Verdict;
  rationale: string;
  coverage: string;
}
export interface ClaimRow extends ClaimCaseView { id: number; }

function readClient() { return createClient({ chain: studionet, account: createAccount() }); }
function writeClient(account: Hex) { return createClient({ chain: studionet, account }); }

async function waitAccepted(client: any, hash: Hex) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Transaction timed out")), TIMEOUT_MS); });
  try { await Promise.race([client.waitForTransactionReceipt({ hash: hash as never, status: TransactionStatus.ACCEPTED, interval: 5000, retries: 64 }), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}
function pick(obj: any, key: string, idx: number): any {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) return obj[idx];
  if (typeof obj === "object" && key in obj) return obj[key];
  return undefined;
}

export async function fundPool(account: Hex, amountWei: bigint): Promise<void> {
  if (amountWei <= 0n) throw new Error("Amount must be > 0");
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "fund_pool", args: [], value: amountWei })) as Hex;
  await waitAccepted(wc, h);
}
export async function fileClaim(account: Hex, f: { protocolName: string; onchainTrace: string; postmortem: string; coverageWei: bigint }): Promise<number> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "file_claim", args: [f.protocolName.trim(), f.onchainTrace.trim(), f.postmortem.trim(), f.coverageWei], value: 0n })) as Hex;
  await waitAccepted(wc, h);
  const c = await getCounts();
  return c.next - 1;
}
export async function adjudicate(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "adjudicate", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function settleClaim(account: Hex, caseId: number): Promise<void> {
  const wc = writeClient(account);
  const h = (await wc.writeContract({ address: CONTRACT_ADDRESS as Hex, functionName: "settle_claim", args: [caseId], value: 0n })) as Hex;
  await waitAccepted(wc, h);
}
export async function getCase(caseId: number): Promise<ClaimCaseView> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_case", args: [caseId] });
  return {
    claimant: String(pick(r, "claimant", 0) ?? ""),
    protocolName: String(pick(r, "protocol_name", 1) ?? ""),
    onchainTrace: String(pick(r, "onchain_trace", 2) ?? ""),
    postmortem: String(pick(r, "postmortem", 3) ?? ""),
    payout: String(pick(r, "payout", 4) ?? "0"),
    damageUnits: String(pick(r, "damage_units", 5) ?? "0"),
    covered: Boolean(pick(r, "covered", 6) ?? false),
    status: Number(pick(r, "status", 7) ?? 0),
    verdict: String(pick(r, "verdict", 8) ?? "") as Verdict,
    rationale: String(pick(r, "rationale", 9) ?? ""),
    coverage: String(pick(r, "coverage", 10) ?? "0"),
  };
}
export async function getCounts(): Promise<{ next: number; ruled: number; covered: number }> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_counts", args: [] });
  const parts = String(r).split("||").map((x) => Number(x) || 0);
  return { next: parts[0] || 0, ruled: parts[1] || 0, covered: parts[2] || 0 };
}
export async function getPoolBalance(): Promise<string> {
  const r: any = await readClient().readContract({ address: CONTRACT_ADDRESS as Hex, functionName: "get_pool_balance", args: [] });
  return String(r ?? "0");
}
export async function listAll(maxRows = 50): Promise<ClaimRow[]> {
  const { next } = await getCounts();
  if (next === 0) return [];
  const ids: number[] = [];
  for (let i = next - 1; i >= 0 && i >= next - maxRows; i--) ids.push(i);
  const rows = await Promise.all(ids.map(async (id) => { try { const c = await getCase(id); return { id, ...c }; } catch { return null; } }));
  return rows.filter((r): r is ClaimRow => r !== null);
}

// Heuristic: extract URLs from postmortem text for the ledger linkout.
export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0] : null;
}
