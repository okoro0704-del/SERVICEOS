# ServiceOS Architecture

ServiceOS is the LifeOS vertical for **on-demand, on-location professional services**.
It does not ship packages. It dispatches verified humans to a customer's doorstep.

```text
LifeOS Shell (customer)
        │
        ▼
  ServiceOS API          owns catalog, providers, bookings, service session
        │
        ├── TransportationOS     live matching, travel ETA, location telemetry
        └── 6 Phase F primitives
              trust-id · elfcom · sovereign-drive
              platform-jobs · master-distributor · fundzman
```

## Service boundaries

| System | Owns | Does not own |
|--------|------|----------------|
| **ServiceOS** | Catalog, provider profiles/skills, booking ledger, in-home session (arrive → in-service → complete), proof of service | Identity credentials, wallet ledger, last-mile courier jobs |
| **TransportationOS** | Movement of the professional (match by proximity, live GPS, ETA) | Service catalog, skill verification, service OTP completion |
| **TrustID** | Identity, session, completion OTP | Bookings |
| **ElfCom** | SMS + job chat | Business state |
| **Sovereign Drive** | Proof-of-service photos, portfolios | Job status |
| **Platform Jobs** | Offer expiry, ETA recalc queues | Domain rules |
| **Master Distributor** | Tenant provision / deploy | Runtime jobs |
| **FundzMan** | Escrow hold + split payout | Catalog pricing |

ServiceOS **consumes** TransportationOS as a telemetry pipeline (`TRANSPORTATION_MODE=local|remote`).
Local mode runs the same haversine matching + ETA algorithms in-process so the vertical can boot without a sibling TransportationOS process. Remote mode posts travel legs to `POST /internal/transportation/dispatch`.

## Job pipeline

`UNASSIGNED → OFFERED → ACCEPTED → EN_ROUTE → ARRIVED → IN_SERVICE → COMPLETED`

Matching is **skill + proximity**, not vehicle type. The customer's pin is the destination; the provider's last GPS ping is the travel origin.

## Apps

| App | Port | Role |
|-----|------|------|
| `apps/serviceos-api` | 8920 | Fastify + Prisma domain API |
| `apps/serviceos-provider` | 5194 | Mobile Provider PWA (radar, job, wallet) |
