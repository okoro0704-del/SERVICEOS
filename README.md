# ServiceOS

On-demand at-home professional services for the LifeOS ecosystem (home barbers, mobile makeup, stylists, house massage, private chefs, mobile technicians).

ServiceOS dispatches **verified humans** to a customer's doorstep using the TransportationOS live dispatch/telemetry pipeline and the **6 Phase F primitives**.

## Ports

| Service | Port |
|---------|------|
| ServiceOS API | 8920 |
| Provider PWA | 5194 |

## Setup

```bash
cd "c:\Users\Hp\Desktop\SERVICEOS"
copy .env.example .env
npm run setup
npm run db:seed
npm run dev
```

- API: http://localhost:8920
- Provider console: http://localhost:5194

## Tests

```bash
npm test
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
