import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import Popis from "./pages/Popis";
import Dogadjaj from "./pages/Dogadjaj";
import Kupnja from "./pages/Kupnja";
import Narudzba from "./pages/Narudzba";
import Skener from "./pages/Skener";
import Organizator from "./pages/Organizator";
import { Privatnost, Uvjeti } from "./pages/Pravno";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Popis />} />
        <Route path="/dogadjaj/:slug" element={<Dogadjaj />} />
        <Route path="/dogadjaj/:slug/kupnja" element={<Kupnja />} />
        <Route path="/ulaznice/:orderId" element={<Narudzba />} />
        {/* Skener i pregled traže prijavu; autorizacija je server-side pri
            svakom pozivu, ruta je samo ulaz. */}
        <Route path="/skener" element={<Skener />} />
        <Route path="/organizator" element={<Organizator />} />
        <Route path="/uvjeti" element={<Uvjeti />} />
        <Route path="/privatnost" element={<Privatnost />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
