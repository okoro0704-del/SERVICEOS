import { useEffect, useState } from "react";
import { api, type JobView } from "../lib/api";

const PIPELINE = [
  { id: "ACCEPTED", label: "Accept", action: null },
  { id: "EN_ROUTE", label: "Start navigation", action: "start_navigation" },
  { id: "ARRIVED", label: "Arrive at customer", action: "arrive" },
  { id: "IN_SERVICE", label: "Start service", action: "start_service" },
] as const;

const ORDER = PIPELINE.map((s) => s.id);

export function ActiveJobPage() {
  const [job, setJob] = useState<JobView | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoB64, setPhotoB64] = useState<string | null>(null);

  async function load() {
    const res = await api<{ job: (JobView & { navUrl?: string }) | null }>("/v1/provider/active-job");
    setJob(res.job);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, []);

  async function advance(action: string) {
    if (!job) return;
    setBusy(true);
    try {
      await api(`/v1/jobs/${job.jobId}/advance`, { method: "POST", body: JSON.stringify({ action }) });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!job || otp.length !== 4) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(`/v1/jobs/${job.jobId}/complete`, {
        method: "POST",
        body: JSON.stringify({ otpCode: otp, posImageBase64: photoB64 ?? undefined }),
      });
      setMessage("Completed. Payout settled to your FundzMan wallet.");
      setJob(null);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoName(file.name);
    const reader = new FileReader();
    reader.onload = () => setPhotoB64(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  }

  const idx = job ? ORDER.indexOf(job.status as (typeof ORDER)[number]) : -1;
  const next = job ? PIPELINE.find((s) => ORDER.indexOf(s.id) === idx + 1) : null;
  const inService = job?.status === "IN_SERVICE";
  const dest = job ? `${job.customer.lat},${job.customer.lng}` : "";

  if (!job) {
    return (
      <div className="card">
        <p className="brand">Active job</p>
        <h2>No live visit</h2>
        <p className="muted">Accepted at-home jobs appear here as a step-by-step pipeline.</p>
        {message ? <p className="small">{message}</p> : null}
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <p className="brand">Active job · {job.category ?? "service"}</p>
        <h2>{job.status.replaceAll("_", " ")}</h2>
        <p className="muted small">{job.customer.addressLine1}</p>
        <p className="small">
          ETA ~{job.etaMinutes ?? "—"} mins · {job.distanceKm.toFixed(1)} km
        </p>
        <a className="btn" style={{ marginTop: "0.9rem" }} href={`https://maps.google.com/?daddr=${dest}`} target="_blank" rel="noreferrer">
          Start native navigation
        </a>
        <a className="btn ghost" style={{ marginTop: "0.55rem" }} href={`#chat`}>
          ElfCom chat with customer
        </a>
      </div>

      <div className="card">
        <p className="brand">Pipeline</p>
        <div className="steps">
          {PIPELINE.map((step, i) => (
            <div key={step.id} className={`step ${i < idx ? "done" : ""} ${i === idx ? "current" : ""}`}>
              <span className="dot" />
              <div>
                <strong>{step.label}</strong>
                <p className="muted small" style={{ margin: 0 }}>
                  {step.id.replaceAll("_", " ")}
                </p>
              </div>
            </div>
          ))}
        </div>
        {next?.action && !inService ? (
          <button className="btn" style={{ marginTop: "0.9rem" }} disabled={busy} onClick={() => void advance(next.action!)}>
            {next.label}
          </button>
        ) : null}
      </div>

      {inService || idx >= 2 ? (
        <div className="card">
          <p className="brand">Service PIN</p>
          <h2>Enter customer OTP</h2>
          <div className="otp">
            {[0, 1, 2, 3].map((i) => (
              <span key={i}>{otp[i] ?? ""}</span>
            ))}
          </div>
          <div className="pin-grid">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
              <button
                key={k}
                onClick={() => {
                  if (k === "C") setOtp("");
                  else if (k === "⌫") setOtp((v) => v.slice(0, -1));
                  else if (otp.length < 4) setOtp((v) => v + k);
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <label className="small muted" style={{ display: "block", marginTop: "0.9rem" }}>
            Proof of service photo
            <input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} />
          </label>
          {photoName ? <p className="small">Queued: {photoName}</p> : null}
          <button className="btn" style={{ marginTop: "0.8rem" }} disabled={busy || otp.length !== 4} onClick={() => void complete()}>
            Complete service
          </button>
          {message ? <p className="small">{message}</p> : null}
        </div>
      ) : null}

      <div className="card" id="chat">
        <p className="brand">ElfCom</p>
        <h2>Customer chat</h2>
        <ChatBox jobId={job.jobId} />
      </div>
    </>
  );
}

function ChatBox({ jobId }: { jobId: string }) {
  const [body, setBody] = useState("");
  const [messages, setMessages] = useState<Array<{ messageId: string; body: string; ownerTrustId: string }>>([]);

  async function load() {
    const res = await api<{ messages: Array<{ messageId: string; body: string; ownerTrustId: string }> }>(
      `/v1/jobs/${jobId}/chat`,
    );
    setMessages(res.messages);
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  }, [jobId]);

  return (
    <>
      <div className="muted small" style={{ minHeight: "3rem" }}>
        {messages.length === 0 ? "No messages yet." : messages.map((m) => <p key={m.messageId}>{m.body}</p>)}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          void api(`/v1/jobs/${jobId}/chat`, {
            method: "POST",
            body: JSON.stringify({ from: "provider", body }),
          }).then(() => {
            setBody("");
            void load();
          });
        }}
      >
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message the customer"
          style={{
            width: "100%",
            margin: "0.5rem 0",
            padding: "0.7rem",
            borderRadius: 12,
            border: "1px solid var(--line)",
            background: "#12352f",
            color: "inherit",
          }}
        />
        <button className="btn ghost" type="submit">
          Send via ElfCom
        </button>
      </form>
    </>
  );
}
