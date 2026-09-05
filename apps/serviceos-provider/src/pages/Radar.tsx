import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getProviderId, setProviderId, type JobView, type Provider } from "../lib/api";

function secondsLeft(iso?: string | null) {
  if (!iso) return 30;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

export function RadarPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [offer, setOffer] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  async function refreshMe(id: string) {
    const me = await api<{ provider: Provider }>("/v1/provider/me", { headers: { "x-provider-id": id } });
    setProvider(me.provider);
  }

  useEffect(() => {
    void api<{ providers: Provider[] }>("/v1/providers").then((r) => {
      setProviders(r.providers);
      const existing = getProviderId();
      const pick = r.providers.find((x) => x.id === existing) ?? r.providers[0];
      if (pick) {
        setProviderId(pick.id);
        void refreshMe(pick.id);
      }
    });
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!provider) return;
    const poll = async () => {
      try {
        const res = await api<{ offer: JobView | null }>("/v1/provider/offer");
        setOffer(res.offer);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [provider?.id]);

  const online = provider?.status === "AVAILABLE" || provider?.status === "BUSY";
  const remaining = useMemo(() => secondsLeft(offer?.offerExpiresAt), [offer?.offerExpiresAt, now]);

  async function toggleDuty() {
    if (!provider) return;
    const next = await api<{ provider: Provider }>("/v1/provider/duty", {
      method: "POST",
      body: JSON.stringify({ online: !online, providerId: provider.id }),
    });
    setProvider(next.provider);
  }

  async function accept() {
    if (!offer || !provider) return;
    await api(`/v1/jobs/${offer.jobId}/accept`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id }),
    });
    setOffer(null);
    navigate("/job");
  }

  async function decline() {
    if (!offer || !provider) return;
    await api(`/v1/jobs/${offer.jobId}/decline`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id }),
    });
    setOffer(null);
  }

  return (
    <>
      <div className="card duty">
        <div>
          <p className="brand">Duty</p>
          <h2>{online ? "Online" : "Offline"}</h2>
          <p className="muted small">{provider ? `${provider.displayName} · ${provider.skill}` : "Select a provider"}</p>
        </div>
        <button className={`toggle ${online ? "on" : ""}`} onClick={() => void toggleDuty()} aria-label="Toggle duty">
          <span />
        </button>
      </div>

      <div className="card">
        <p className="brand">Studio identity</p>
        <select
          value={provider?.id ?? ""}
          onChange={(e) => {
            setProviderId(e.target.value);
            void refreshMe(e.target.value);
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="card">
        <p className="brand">Job radar</p>
        <h2>{offer ? "Incoming visit" : "Waiting for jobs"}</h2>
        <p className="muted">
          {online ? "Stay in the zone. Offers expire in 30 seconds." : "Go online to receive nearby at-home jobs."}
        </p>
      </div>
      {error ? <p className="error small">{error}</p> : null}

      {offer ? (
        <div className="modal-scrim">
          <div className="modal">
            <p className="brand">New job · {offer.category ?? "service"}</p>
            <h2>
              Accept within <span className="timer">{remaining}s</span>
            </h2>
            <p className="muted">
              Est. earnings {offer.earningsFormatted ?? `₦${Math.round((offer.providerPayoutMinor ?? 0) / 100)}`}
            </p>
            <p className="small">
              {offer.distanceKm.toFixed(1)} km · {offer.customer.addressLine1}, {offer.customer.city}
            </p>
            <div style={{ display: "grid", gap: "0.55rem", marginTop: "1rem" }}>
              <button className="btn" onClick={() => void accept()}>
                Accept job
              </button>
              <button className="btn ghost" onClick={() => void decline()}>
                Decline
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
