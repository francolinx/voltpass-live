import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useVoltPass, activeTrip, featureVehicle } from "../hooks";
import { reserveVehicle, startReturn, seedDemoData } from "../store";
import {
  ConnectionPill,
  StatePill,
  VehicleStatus,
  Timeline,
  AiCard,
  DebugStrip,
  Flash,
} from "../components";

const RENTER = "Franco";

/** Static fallback shown when SpacetimeDB vehicles table is empty. */
const DEMO_FALLBACK = {
  id: BigInt(1),
  model: "Tesla Model 3",
  battery: 87,
  location: "Stall B-4, Microsoft Apartments",
  status: "Available",
  source: "simulator",
  locationConfirmed: false,
  lockStatus: "locked",
} as const;

export default function ResidentPage() {
  const snap = useVoltPass();
  const trip = activeTrip(snap);

  // Auto-seed once when connected and vehicles table is empty.
  useEffect(() => {
    if (snap.connected && snap.vehicles.length === 0) {
      seedDemoData();
    }
  }, [snap.connected, snap.vehicles.length]);

  const vehicle = featureVehicle(snap);

  // Prefer a real SpacetimeDB vehicle; fall back to static demo card so the
  // fleet section is never blank for a judge.
  const displayVehicle = vehicle ?? (snap.connected ? DEMO_FALLBACK : null);
  const isFallback = displayVehicle === DEMO_FALLBACK;

  const canReserve =
    !!displayVehicle &&
    displayVehicle.status === "Available" &&
    (!trip || trip.state === "CLOSED");
  const canReturn = !!trip && trip.state === "TRIP_ACTIVE";
  const isLive = vehicle?.source === "smartcar_live";

  const tripEvents = trip ? snap.events.filter((e) => e.tripId === trip.id) : [];
  const tripRecs = trip ? snap.recs.filter((r) => r.tripId === trip.id) : [];
  const closeout = tripRecs.find((r) => r.kind === "closeout");

  return (
    <div className="page resident">
      <header className="topbar">
        <div className="brand">
          &#x26A1; VoltPass <span className="role role-resident">Resident</span>
        </div>
        <div className="top-right">
          <ConnectionPill snap={snap} />
          <Link className="switch-link" to="/owner">
            owner view &rarr;
          </Link>
        </div>
      </header>

      <DebugStrip trip={trip} />

      <section className="card fleet-card">
        <h2>
          Your Community Fleet
          <span className="sub">Microsoft Apartments &middot; resident-only</span>
        </h2>

        {displayVehicle && (
          <Flash snap={snap} flashKey={`vehicle-${displayVehicle.id}`}>
            <div className="vehicle-row">
              <div className="vehicle-icon">&#x1F699;&#x26A1;</div>
              <div className="vehicle-info">
                <strong>
                  {displayVehicle.model}
                  {isLive && <span className="live-badge">&nbsp;&bull; Smartcar live</span>}
                  {isFallback && (
                    <span
                      style={{ fontSize: "0.75em", opacity: 0.65, marginLeft: 8 }}
                    >
                      demo
                    </span>
                  )}
                </strong>
                <div>
                  &#x1F50B; {displayVehicle.battery}%
                  {isLive ? " (live SOC)" : ""} &nbsp;&middot;&nbsp;
                  &#x1F4CD; {displayVehicle.location}
                </div>
                <VehicleStatus status={displayVehicle.status} />
              </div>
              <div className="vehicle-actions">
                <button
                  className="btn btn-primary"
                  disabled={!canReserve}
                  onClick={() =>
                    vehicle
                      ? reserveVehicle(vehicle.id, RENTER)
                      : seedDemoData()
                  }
                >
                  {isFallback ? "Seed & Reserve" : "Reserve"}
                </button>
                {!isFallback && (
                  <p className="hint">Reserves as {RENTER} (VoltScore 91)</p>
                )}
                {isFallback && (
                  <p className="hint">
                    Seeding demo data&hellip; vehicle will appear shortly.
                  </p>
                )}
              </div>
            </div>
          </Flash>
        )}
      </section>

      <section className="card">
        <h2>
          Trip Room
          <span className="sub">
            <StatePill snap={snap} trip={trip} />
          </span>
        </h2>
        {!trip && (
          <p className="muted">Reserve the Model 3 to open a Trip Room.</p>
        )}
        {trip && (
          <div>
            <p>Renter &nbsp;<strong>{trip.renter}</strong></p>
            <p>Trip &nbsp;<strong>#{trip.id.toString()}</strong></p>
            {canReturn && (
              <button className="btn" onClick={() => startReturn(trip.id)}>
                Start Return
              </button>
            )}
            {trip.state === "CLOSED" && (
              <p className="muted">Trip closed &#x2705;</p>
            )}
            {(trip.state === "VEHICLE_VERIFIED" ||
              trip.state === "RESERVED" ||
              trip.state === "CHECK_IN_STARTED") && (
              <p className="muted">Waiting for owner to approve unlock&hellip;</p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          AI Trust Agent
          <span className="sub">
            writes structured recommendations into SpacetimeDB
          </span>
        </h2>
        {tripRecs.length === 0 && (
          <p className="muted">
            The AI Trust Agent will post here during check-in.
          </p>
        )}
        {tripRecs.map((r) => (
          <AiCard key={r.id.toString()} snap={snap} rec={r} />
        ))}
      </section>

      <section className="card">
        <h2>
          Trip Timeline
          <span className="sub">live from trip_events</span>
        </h2>
        {closeout && (
          <h3>
            Closeout Report
            <span className="sub">generated from telemetry</span>
          </h3>
        )}
        <Timeline snap={snap} events={tripEvents} />
      </section>

      <div className="actions">
        <button className="btn btn-ghost" onClick={() => seedDemoData()}>
          &#x21BA; Reset demo
        </button>
      </div>
    </div>
  );
}
