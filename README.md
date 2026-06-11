# VoltPass

### Dispute-ready evidence layer for EV rental hosts — built on SpacetimeDB.

VoltPass turns every shared-EV rental into a live **Trip Room**: one authoritative shared state on SpacetimeDB, shared by the renter, the fleet owner, the vehicle's telemetry stream, and an AI Trust Agent. It is not a Turo clone. It is the missing trust, telemetry, and evidence layer that EV rental hosts need — structured trip evidence, real-time shared state, and AI-powered closeout reports that are ready to resolve disputes before they start. Cars are the lab; resident-only apartment fleets are a later B2B2C wedge.

---

## For Judges (60-second version)

- **Live app:** https://voltpass-live.vercel.app  ·  **Repo:** https://github.com/francolinx/voltpass-live  ·  **SpacetimeDB:** database `voltpass` on Maincloud (`wss://maincloud.spacetimedb.com`)
- **Tracks:** Main Challenge · Best Web App · Best Use of LLMs · Best Student Team
- **Do this:** open `/resident` and `/owner` in two browser windows, side by side. In `/resident`, reserve the Tesla Model 3.
- **Watch this:** `/owner` updates **instantly, with no refresh** — that is a SpacetimeDB subscription firing on shared state. Then the trip walks the state machine (reserve → check-in → verify → unlock → active → return → AI review → closed), the AI Trust Agent writes structured recommendation rows into the *same* live stream, and the trip closes cleanly.
- **Why it wins:**
  - **Sponsor tech** — SpacetimeDB is the *only* backend. Reducers are the state transitions, tables are the trip ledger, subscriptions are the sync. There is no API server, no WebSocket server, and no client sync code. (Details below.)
  - **LLMs** — the AI Trust Agent writes auditable, structured rows into shared state and is gated by a trip-state transition. It is a participant in the workflow, not a chat box.
  - **Web App** — a full resident / owner / community / operations experience.
  - **Honest** — every live-vs-simulated boundary is labeled in a table below.

> The core SpacetimeDB demo requires **no Smartcar connection and no login**. The optional real-Tesla telemetry pull uses a Render-hosted backend that sleeps — if you want to see it, open `https://voltpass-smartcar.onrender.com/api/smartcar/health` first to wake it.



---

## Why VoltPass exists

Peer-to-peer EV sharing is not mainly a demand problem. It is a **trust and evidence problem**. Hosts worry about dents, late returns, battery abuse, unlocked vehicles, parking mistakes, and disputes they can't prove. Renters want fast access without the friction and fees of a traditional marketplace.

VoltPass builds the layer that marketplaces skip — real-time shared state, telemetry evidence, AI recommendations, and an auditable closeout trail that gives hosts dispute-ready evidence packets. The long-term dataset from structured trip closeouts is designed to eventually support underwriting and insurance workflows, but today the product focuses on evidence collection and trust. Resident-only apartment fleets are a natural later wedge: residents are known, repeat users who already share infrastructure like parking and chargers.

---

## The core idea: the Trip Room

A VoltPass rental is not a booking row. It is a real-time state machine that every actor watches at once.

```
AVAILABLE
  → RESERVED
  → CHECK_IN_STARTED
  → VEHICLE_VERIFIED
  → UNLOCK_REQUESTED
  → UNLOCK_GRANTED
  → TRIP_ACTIVE
  → RETURN_STARTED
  → AI_REVIEWING
  → CLOSED
```

Telemetry and AI are treated as **active participants** in this workflow, not side panels. That is what makes VoltPass feel less like "Turo with a dashboard" and more like a small multiplayer operations system for community fleets.

---

## Why SpacetimeDB is essential

SpacetimeDB is not a decorative database here. It is the core real-time backend, and it replaces an entire stack.

| A normal real-time stack needs | VoltPass on SpacetimeDB |
| --- | --- |
| Database | SpacetimeDB tables = the shared trip ledger |
| API server | SpacetimeDB reducers = authoritative state transitions |
| WebSocket server | SpacetimeDB subscriptions = instant renter/owner sync |
| State-sync layer | Subscriptions push every change automatically |
| Custom race-condition handling | Reducers are serialized; illegal transitions are rejected server-side |

The result is a live shared backend where every actor — renter, owner, telemetry, and AI — sees the same truth at the same moment.

### SpacetimeDB, concretely

**Module:** Rust, published to Maincloud as `voltpass` (source: `/server/src/lib.rs`). Client: React + Vite + TypeScript, bindings generated with `spacetime generate`.

**Tables (the shared state):** `communities`, `vehicles`, `residents`, `trips`, `trip_events`, `vehicle_snapshots`, `agent_recommendations`, `presence`.

**Reducers enforce the lifecycle — the frontend cannot mutate trip state directly.** Each transition reducer checks the current state and rejects illegal jumps, so two actors can never race the trip into an inconsistent state:

```rust
#[reducer]
pub fn approve_unlock(ctx: &ReducerContext, trip_id: u64) {
    let mut trip = Trips::filter_by_id(&trip_id).expect("trip exists");
    assert_eq!(trip.state, "UNLOCK_REQUESTED");      // illegal transitions rejected
    trip.state = "UNLOCK_GRANTED".to_string();
    Trips::update_by_id(&trip_id, trip);
    TripEvents::insert(TripEvents {                  // append to the audit trail
        id: 0,
        trip_id,
        kind: "approve_unlock".to_string(),
        payload_json: "{}".to_string(),
        ts: ctx.timestamp,
    });
}
```

**Reducer → transition map** (every meaningful action goes through SpacetimeDB):

| Reducer | Transition |
| --- | --- |
| `seed_demo_data` | seeds community, vehicles, residents (setup) |
| `reserve_vehicle` | `AVAILABLE` → `RESERVED` |
| `start_checkin` | `RESERVED` → `CHECK_IN_STARTED` |
| `ingest_vehicle_snapshot` / `verify_vehicle` | `CHECK_IN_STARTED` → `VEHICLE_VERIFIED` (+ snapshot row) |
| `request_unlock` | `VEHICLE_VERIFIED` → `UNLOCK_REQUESTED` |
| `approve_unlock` | `UNLOCK_REQUESTED` → `UNLOCK_GRANTED` |
| `start_trip` | `UNLOCK_GRANTED` → `TRIP_ACTIVE` |
| `push_telemetry` | adds telemetry + event during `TRIP_ACTIVE` (no state change) |
| `start_return` | `TRIP_ACTIVE` → `RETURN_STARTED` |
| `generate_closeout` | `RETURN_STARTED` → `AI_REVIEWING` (+ AI recommendation row) |
| `close_trip` | `AI_REVIEWING` → `CLOSED` |

**Subscriptions — what each client live-queries (this is the sync; no WebSocket code is written):**

```sql
-- /resident
SELECT * FROM trips WHERE renter = :resident_id
SELECT * FROM trip_events
SELECT * FROM agent_recommendations

-- /owner
SELECT * FROM trips
SELECT * FROM vehicles
SELECT * FROM vehicle_snapshots
SELECT * FROM agent_recommendations
```

When any reducer writes, every subscribed window updates with no polling and no manual sync. That is the entire reason SpacetimeDB replaces a DB + API + WebSocket + sync stack for this app.

---

## The AI Trust Agent

Most hackathon AI features are chat boxes. The VoltPass agent is part of the state machine.

**How it runs:** the AI Trust Agent is a **client** of SpacetimeDB, not a reducer (reducers are sandboxed and cannot make external calls). It subscribes to trip and telemetry state, and when a trip enters `AI_REVIEWING` it reads the actual `vehicle_snapshots` and `trip_events` rows, generates a closeout, and writes a structured row back into `agent_recommendations` via the `generate_closeout` reducer.

- **Closeout report** — generated by the AI Trust Agent, with a deterministic fallback so the demo never depends on an external model call.
- **Unlock recommendation** — deterministic templated output for speed.

Because the agent's output is a row in the same real-time stream as human and telemetry actions, it is **visible to both owner and resident, auditable, tied to a reducer-driven transition, and reusable** for dispute review and underwriting.

**Example artifacts**

Unlock recommendation:
> "Approve unlock. Franco is a verified resident with VoltScore 91. Vehicle snapshot captured at 82% battery in Garage B2. No active disputes. Unlock recommended."

Closeout report:
> "Trip closed cleanly. Battery moved from 82% to 61%, odometer increased 14.2 miles, one harsh braking event detected, geofence OK. Recommend clean closeout with minor battery adjustment."

**Implemented today:** unlock recommendation + closeout report.
**Roadmap:** battery-fairness note, behavior summary, underwriter summary.

---

## Smartcar: real telemetry, kept peripheral

SpacetimeDB is the center of the app. Smartcar is a **real-world input that flows into the shared state** — proof of domain depth, not the headline, and never required for the core demo.

VoltPass includes a Node/Express Smartcar connector that, in testing, authenticated to a real Tesla account and retrieved live telemetry from a primary **Model X** — state of charge, range, GPS, lock status, and odometer. For demo reliability the live Trip Room defaults to a **simulator-backed vehicle connector that mirrors Smartcar/Tesla telemetry events**, because vehicle APIs can rate-limit. The Render backend is deployed as a paid service, but Smartcar OAuth tokens are currently stored in memory — a redeploy or restart may require re-authentication.

**Backend:** `https://voltpass-smartcar.onrender.com` (hosted on Render)

**Backend routes:** `GET /api/smartcar/health`, `/auth-url`, `/callback`, `/vehicles`; `POST /api/smartcar/snapshot`, `/unlock`.

**Smartcar-connected fleet** (real Teslas, accessed via Smartcar API — separate from the SpacetimeDB seed vehicles shown in the demo):

| Vehicle | Role |
| --- | --- |
| Model X — Primary | Live demo Tesla |
| Darks8ar — Model S | Backup |
| Shadeywave | Repair / not used in demo |

> **Note:** The SpacetimeDB seed data (Model 3, Model Y, Model S in the `/resident` and `/owner` views) represents the demo community fleet and runs on the simulator by default. To inject real telemetry, connect a Smartcar-linked Tesla from the owner panel and pull a live snapshot.

Vehicle IDs and Smartcar secrets live in environment variables; no secret is committed.

---

## What is live vs simulated

| Layer | Status |
| --- | --- |
| Public frontend | **Live** on Vercel |
| SpacetimeDB backend | **Live** on Maincloud (`voltpass`) |
| Real-time renter/owner sync | **Live** through SpacetimeDB subscriptions |
| Trip state machine | **Live** through reducers |
| AI Trust Agent rows (unlock + closeout) | **Live** — written into `agent_recommendations` |
| Smartcar backend | **Deployed** on Render (paid); OAuth tokens in memory — restart requires re-auth |
| Real Tesla telemetry | **Verified in testing** with a real Model X; live pull available on request |
| Trip driving telemetry | **Simulated** for reliable demo flow |
| Vehicle unlock | Backend route exists; not required for the judging demo |
| Payments, insurance, DMV checks | Not implemented — roadmap |

---

## Architecture

```
                ┌──────────────────────────────┐
                │        Vercel Frontend        │
                │   React + Vite + TypeScript   │
                └───────────────┬───────────────┘
                                │  live subscriptions / reducers
                ┌───────────────▼───────────────┐
                │       SpacetimeDB Maincloud     │
                │   Real-time Trip Room ledger    │
                │   Tables · Reducers · Events    │
                └───────────────┬───────────────┘
                                │  shared trip state
        ┌───────────────────────┼───────────────────────┐
┌───────▼───────┐      ┌────────▼───────┐      ┌─────────▼────────┐
│ Resident View │      │ Owner Dashboard│      │  AI Trust Agent  │
│ reserve/return│      │ approve/monitor│      │  (STDB client)   │
└───────────────┘      └────────┬───────┘      └──────────────────┘
                                │  optional live connector
                ┌───────────────▼───────────────┐
                │      Render Smartcar Backend    │
                │      Node + Express + OAuth      │
                └───────────────┬───────────────┘
                ┌───────────────▼───────────────┐
                │    Smartcar / Tesla telemetry   │
                │     SOC · GPS · lock · odometer  │
                └──────────────────────────────┘
```

---

## 90-second demo script

> "VoltPass is a real-time trust OS for resident-only EV sharing. The core object is a Trip Room powered by SpacetimeDB — the renter, owner, vehicle telemetry, and an AI Trust Agent all update one shared state.
>
> Here are two windows, side by side. In `/resident` I reserve the Model 3. `/owner` updates **instantly, with no refresh**, because it is subscribed to SpacetimeDB. Reducers enforce the trip lifecycle from reservation through check-in, vehicle verification, owner-approved unlock, active trip, return, AI review, and closeout — the frontend can't skip a step.
>
> When the trip enters review, the AI Trust Agent reads the actual telemetry rows and writes a structured closeout **into the same live stream** — not a chat reply, an auditable row both sides can act on.
>
> This Smartcar panel connects to a real Tesla Model X for SOC, GPS, lock, and odometer. If the vehicle API sleeps or rate-limits, VoltPass falls back to simulator telemetry so the Trip Room never breaks.
>
> The long-term value is a structured trip-evidence dataset that hosts can use for dispute resolution today, and that can grow into underwriting and insurance workflows over time."

---

## Seed data (`seed_demo_data`)

**Community:** Microsoft Apartments — 3 Teslas — 14 verified residents — 2 EV chargers.

| Vehicle | Battery | Location | Status |
| --- | --- | --- | --- |
| Tesla Model 3 | 82% | Garage B2 | Available |
| Tesla Model Y | 64% | Garage B1 | Active Trip |
| Tesla Model S | 91% | — | Charging |

| Resident | Status | VoltScore |
| --- | --- | --- |
| Franco | Verified | 91 |
| Maya | Verified | 84 |
| Alex | Pending verification | — |

---

## Running locally

```bash
# 1. Install dependencies
npm install

# 2. Start SpacetimeDB locally
npm run spacetime:start

# 3. Publish the local module
npm run spacetime:publish:local

# 4. Generate client bindings if needed
npm run spacetime:generate

# 5. Start the frontend
npm run dev

# 6. (Optional) start the Smartcar backend
cd smartcar-server && npm install && node index.js
```

**`.env.local` (local only — never committed):**

```
VITE_SPACETIMEDB_HOST=ws://localhost:3000
VITE_SPACETIMEDB_DB_NAME=voltpass
VITE_SMARTCAR_API_URL=http://localhost:3001/api/smartcar
```

**Production frontend env (Vercel):**

```
VITE_SPACETIMEDB_HOST=wss://maincloud.spacetimedb.com
VITE_SPACETIMEDB_DB_NAME=voltpass
VITE_SMARTCAR_API_URL=https://voltpass-smartcar.onrender.com/api/smartcar
```

To demo the public Smartcar pull: open `/api/smartcar/health` to wake Render, and if `connected` is false, open `/api/smartcar/auth-url`, complete OAuth, return to `/owner`, and pull one snapshot. The Smartcar client secret lives only in the backend hosting environment and is never exposed to the browser.

---

## Security

- `.env.local` is gitignored; the Smartcar client secret is never committed and is never exposed through frontend env vars.
- Production Smartcar secrets live only in the backend hosting environment.
- For the demo, the backend stores OAuth tokens in memory; if Render restarts, reconnect Smartcar.
- The Smartcar secret should be regenerated after the hackathon.

---

## Team

Built by Franco / Francolinjo Plathottathil for the SpacetimeDB Launchpad Hackathon.

---

## Roadmap

Persist Smartcar tokens securely · real insurance/underwriting workflow · resident verification and driver-eligibility checks · geofence-based return validation · mobile unlock UX · charger-aware routing · owner dispute-packet export · property-manager dashboard for community fleets.

---

## Built during the hackathon

VoltPass was built during the SpacetimeDB Launchpad Hackathon to show how SpacetimeDB can power a live, multiplayer-style operational workflow outside of games. Commit history reflects the build window.
