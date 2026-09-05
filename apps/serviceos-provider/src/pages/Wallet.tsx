import { useEffect, useState } from "react";
import { api, type WalletSummary } from "../lib/api";

export function WalletPage() {
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [amount, setAmount] = useState("50000");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const res = await api<{ wallet: WalletSummary }>("/v1/provider/wallet");
    setWallet(res.wallet);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, []);

  async function withdraw() {
    setMessage(null);
    try {
      const res = await api<{ wallet: WalletSummary; withdrawal: { withdrawalId: string; status: string } }>(
        "/v1/provider/wallet/withdraw",
        { method: "POST", body: JSON.stringify({ amount: Number(amount) }) },
      );
      setWallet(res.wallet);
      setMessage(`Withdrawal ${res.withdrawal.status}.`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <div className="card">
      <p className="brand">FundzMan wallet</p>
      <h2>Earnings</h2>
      <p className="balance">{wallet?.formattedAvailable ?? "₦0"}</p>
      <p className="muted small">Live balance from FundzMan. Service settlement credits this wallet instantly.</p>
      <label className="small muted" style={{ display: "block", marginTop: "1rem" }}>
        Withdraw amount (minor units)
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" />
      </label>
      <button className="btn" style={{ marginTop: "0.8rem" }} onClick={() => void withdraw()}>
        Withdraw
      </button>
      {message ? <p className="small">{message}</p> : null}
    </div>
  );
}
