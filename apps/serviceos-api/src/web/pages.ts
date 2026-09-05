import { formatMinor } from "@serviceos/shared";

const CSS = `
:root { --bg:#042f2e; --elev:#0f3d39; --ink:#ecfdf5; --muted:#99f6e4; --teal:#14b8a6; --line:rgba(236,253,245,.12); font-family:"IBM Plex Sans",system-ui,sans-serif; color:var(--ink); }
*{box-sizing:border-box} body{margin:0;background:radial-gradient(900px 480px at 10% -20%,#14b8a633,transparent 55%),var(--bg)}
.wrap{max-width:720px;margin:0 auto;padding:1.1rem 1.2rem 2rem}
.brand{color:var(--teal);letter-spacing:.16em;text-transform:uppercase;font-size:.75rem}
h1,h2{font-family:Barlow,sans-serif;margin:.2rem 0 .6rem}
.card{background:var(--elev);border:1px solid var(--line);border-radius:16px;padding:1rem;margin-top:.8rem}
.muted{color:var(--muted);line-height:1.45}.small{font-size:.85rem}
.row{display:flex;gap:.55rem;flex-wrap:wrap}
.chip,.btn{border:1px solid var(--line);background:#12352f;color:inherit;border-radius:999px;padding:.45rem .8rem;cursor:pointer}
.chip.is-on,.btn.primary{background:var(--teal);color:#042f2e;border:0;font-weight:700}
.btn{border-radius:12px;width:100%;padding:.85rem;margin-top:.6rem}
label,input,select,textarea{display:block;width:100%;margin-top:.35rem}
input,select,textarea{background:#12352f;border:1px solid var(--line);color:inherit;border-radius:10px;padding:.65rem}
.map{height:180px;border-radius:14px;border:1px solid var(--line);position:relative;overflow:hidden;background:linear-gradient(#0b3a36,#115e59);cursor:crosshair}
.pin{position:absolute;transform:translate(-50%,-100%);font-size:1.6rem;pointer-events:none}
.pinbox{display:flex;gap:.4rem;justify-content:center;margin:.7rem 0}
.pinbox span{width:48px;height:56px;border-radius:12px;border:1px solid var(--line);display:grid;place-items:center;font-size:1.4rem;font-weight:700;background:#12352f}
.eta{background:#14b8a61f;border:1px solid #14b8a655;border-radius:12px;padding:.7rem}
.chat{min-height:4rem}.offer{display:grid;gap:.45rem}
`;

export function htmlPage(title: string, body: string, extraScript = "") {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@600;700&family=IBM+Plex+Sans:wght@400;600&display=swap" rel="stylesheet"/>
  <style>${CSS}</style>
</head>
<body>
  ${body}
  <script>
    window.parent?.postMessage({ type: "lifeos.ready" }, "*");
    ${extraScript}
  </script>
</body>
</html>`;
}

export function catalogPageHtml(opts: { tenantId: string; preset: string }) {
  return htmlPage(
    "ServiceOS Catalog",
    `<div class="wrap" data-testid="service-catalog" data-preset="${opts.preset}" data-tenant="${opts.tenantId}">
      <p class="brand">ServiceOS · customer</p>
      <h1>Book an at-home visit</h1>
      <div class="card">
        <p class="brand">Category</p>
        <div class="row" id="cats"></div>
        <div class="offer" id="offerings"></div>
      </div>
      <div class="card">
        <p class="brand">Schedule</p>
        <div class="row">
          <button class="chip is-on" id="asap" type="button">ASAP Dispatch</button>
          <button class="chip" id="slot" type="button">Choose slot</button>
        </div>
        <input id="when" type="datetime-local" style="display:none"/>
      </div>
      <div class="card">
        <p class="brand">Address & access</p>
        <div class="map" id="map" data-testid="map-picker"><span class="pin" id="pin">📍</span></div>
        <label>Street <input id="addr" value="12 Marina"/></label>
        <label>City <input id="city" value="Lagos"/></label>
        <label>Gate code / notes <textarea id="notes" placeholder="Gate code, floor, dog, etc."></textarea></label>
        <p class="small muted">Lat <span id="lat">6.4541</span> · Lng <span id="lng">3.3947</span></p>
      </div>
      <div class="card">
        <p class="brand">Travel surcharge preview</p>
        <p data-testid="quote-base">Base fee: <strong id="base">—</strong></p>
        <p data-testid="quote-travel">Travel fee: <strong id="travel">—</strong></p>
        <p data-testid="quote-total">Total: <strong id="total">—</strong></p>
        <p class="small muted" id="duration">Duration —</p>
        <button class="btn primary" id="pay" type="button">One-tap FundzMan checkout</button>
        <p class="small" id="msg"></p>
      </div>
    </div>`,
    `const tenantId = ${JSON.stringify(opts.tenantId)};
let offerings=[], selected=null, mode="asap", lat=6.4541, lng=3.3947;
const map=document.getElementById("map"), pin=document.getElementById("pin");
function placePin(){ pin.style.left=((lng-3.30)/0.15*100)+"%"; pin.style.top=(100-(lat-6.40)/0.15*100)+"%"; }
placePin();
map.onclick=(e)=>{ const r=map.getBoundingClientRect(); lng=3.30+(e.clientX-r.left)/r.width*0.15; lat=6.55-(e.clientY-r.top)/r.height*0.15; document.getElementById("lat").textContent=lat.toFixed(4); document.getElementById("lng").textContent=lng.toFixed(4); placePin(); quote(); };
document.getElementById("asap").onclick=()=>{mode="asap";document.getElementById("when").style.display="none";document.getElementById("asap").classList.add("is-on");document.getElementById("slot").classList.remove("is-on")};
document.getElementById("slot").onclick=()=>{mode="slot";document.getElementById("when").style.display="block";document.getElementById("slot").classList.add("is-on");document.getElementById("asap").classList.remove("is-on")};
function naira(n){ return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(n/100); }
async function load(){
  const res=await fetch("/v1/catalog?tenantId="+encodeURIComponent(tenantId));
  const data=await res.json();
  offerings=data.offerings||[];
  const cats=[...new Set(offerings.map(o=>o.category))];
  document.getElementById("cats").innerHTML=cats.map(c=>'<button class="chip" data-cat="'+c+'">'+c+'</button>').join("");
  document.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>render(b.dataset.cat));
  render(cats[0]);
}
function render(cat){
  document.querySelectorAll("[data-cat]").forEach(b=>b.classList.toggle("is-on", b.dataset.cat===cat));
  const list=offerings.filter(o=>o.category===cat);
  selected=list[0]||null;
  document.getElementById("offerings").innerHTML=list.map(o=>'<button class="chip '+(selected&&selected.sku===o.sku?"is-on":"")+'" data-sku="'+o.sku+'">'+o.name+' · '+o.durationMinutes+' min</button>').join("");
  document.querySelectorAll("[data-sku]").forEach(b=>b.onclick=()=>{ selected=offerings.find(o=>o.sku===b.dataset.sku); render(cat); });
  quote();
}
async function quote(){
  if(!selected) return;
  const res=await fetch("/v1/bookings/quote",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tenantId, offeringSku:selected.sku, lat, lng})});
  const q=await res.json();
  document.getElementById("base").textContent=naira(q.baseFeeMinor);
  document.getElementById("travel").textContent=naira(q.travelFeeMinor);
  document.getElementById("total").textContent=naira(q.totalMinor);
  document.getElementById("duration").textContent="Duration "+q.offering.durationMinutes+" min · "+q.distanceKm.toFixed(1)+" km travel";
}
document.getElementById("pay").onclick=async()=>{
  const res=await fetch("/v1/bookings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    tenantId, offeringSku:selected.sku, scheduleMode:mode, scheduledAt: mode==="slot"?document.getElementById("when").value:null,
    customer:{ lat, lng, addressLine1:document.getElementById("addr").value, city:document.getElementById("city").value, accessNotes:document.getElementById("notes").value, gateCode:document.getElementById("notes").value },
    buyer:{ trustId:"TD-BUYER-1", name:"Ada Buyer", phone:"+2348011111111" }
  })});
  const body=await res.json();
  document.getElementById("msg").textContent = res.ok ? ("Booked. PIN "+body.otpCode+". Track "+body.trackingPath) : (body.message||"failed");
  if(res.ok) location.href=body.trackingPath;
};
load();`,
  );
}

export function appointmentsPageHtml(jobs: Array<{ id: string; status: string; category: string; customerAddressLine1: string }>) {
  const rows = jobs
    .map(
      (j) =>
        `<li data-testid="appointment-row"><strong>${j.category}</strong> · ${j.status.replaceAll("_", " ")} · ${j.customerAddressLine1}</li>`,
    )
    .join("");
  return htmlPage(
    "ServiceOS Appointments",
    `<div class="wrap" data-testid="service-appointments">
      <p class="brand">ServiceOS · merchant</p>
      <h1>Doorstep appointments</h1>
      <div class="card"><ul>${rows || "<li class='muted'>No appointments yet.</li>"}</ul></div>
    </div>`,
  );
}

export function trackPageHtml(job: {
  id: string;
  otpCode: string;
  etaMinutes: number | null;
  customerLat: number;
  customerLng: number;
  provider: { lat: number; lng: number; displayName: string } | null;
  messages: Array<{ messageId: string; body: string }>;
}) {
  const providerLat = job.provider?.lat ?? "";
  const providerLng = job.provider?.lng ?? "";
  const digits = job.otpCode.split("").map((d) => `<span>${d}</span>`).join("");
  const msgs = job.messages.map((m) => `<p>${m.body}</p>`).join("") || "<p class='muted'>ElfCom bridge ready.</p>";
  return htmlPage(
    "Track booking",
    `<div class="wrap" data-testid="live-tracking" data-booking-id="${job.id}">
      <p class="brand">ServiceOS live track</p>
      <h1>Your professional is on the way</h1>
      <div class="card eta" data-testid="eta-banner">Live ETA · TransportationOS telemetry · ~${job.etaMinutes ?? "—"} min</div>
      <div class="card">
        <div class="map" data-testid="track-map">
          <span class="pin" style="left:40%;top:35%">🧑‍🔧</span>
          <span class="pin" style="left:70%;top:60%">🏠</span>
        </div>
        <p class="small" data-testid="provider-coords" data-provider-lat="${providerLat}" data-provider-lng="${providerLng}" data-customer-lat="${job.customerLat}" data-customer-lng="${job.customerLng}">
          Provider ${job.provider?.displayName ?? "unassigned"} @ ${providerLat || "—"}, ${providerLng || "—"}
        </p>
      </div>
      <div class="card" data-testid="doorstep-pin">
        <p class="brand">Trust ID doorstep PIN</p>
        <div class="pinbox">${digits}</div>
        <p class="small muted">Share this 4-digit PIN with the provider on arrival.</p>
      </div>
      <div class="card" data-testid="elfcom-bridge" id="chat">
        <p class="brand">ElfCom</p>
        <h2>Chat with your practitioner</h2>
        <div class="chat">${msgs}</div>
        <form id="chat-form"><input name="body" placeholder="Message via ElfCom"/><button class="btn" type="submit">Send</button></form>
      </div>
    </div>`,
    `document.getElementById("chat-form").onsubmit=async(e)=>{
      e.preventDefault();
      const body=e.target.body.value; if(!body) return;
      await fetch("/v1/jobs/${job.id}/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({from:"customer",body})});
      location.reload();
    };`,
  );
}

export { formatMinor };
