import type { ReactNode } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { RadarPage } from "./pages/Radar";
import { ActiveJobPage } from "./pages/ActiveJob";
import { WalletPage } from "./pages/Wallet";

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="provider-app">
      <header className="topbar">
        <div>
          <p className="brand">ServiceOS</p>
          <h1 style={{ fontSize: "1.35rem" }}>Provider console</h1>
        </div>
      </header>
      <main className="main">{children}</main>
      <nav className="nav">
        <NavLink to="/" end>
          Radar
        </NavLink>
        <NavLink to="/job">Job</NavLink>
        <NavLink to="/wallet">Wallet</NavLink>
      </nav>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <Shell>
            <RadarPage />
          </Shell>
        }
      />
      <Route
        path="/job"
        element={
          <Shell>
            <ActiveJobPage />
          </Shell>
        }
      />
      <Route
        path="/wallet"
        element={
          <Shell>
            <WalletPage />
          </Shell>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
