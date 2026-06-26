import { BrowserRouter, Route, Routes } from "react-router-dom";

import { DisplayNamePrompt } from "./components/DisplayNamePrompt";
import { PendingRunFlusher } from "./components/PendingRunFlusher";
import { Account } from "./pages/Account";
import { Faq } from "./pages/Faq";
import { Hub } from "./pages/Hub";
import { Leaderboard } from "./pages/Leaderboard";
import { Lobby } from "./pages/Lobby";
import { Login } from "./pages/Login";
import { Marathon } from "./pages/Marathon";
import { Result } from "./pages/Result";

// Classic mode is deferred — v1 ships Marathon only (Classic.tsx kept for later).
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/play/:mode" element={<Lobby />} />
        <Route path="/marathon" element={<Marathon />} />
        <Route path="/account" element={<Account />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/faq" element={<Faq />} />
        <Route path="/login" element={<Login />} />
        <Route path="/r/:id" element={<Result />} />
      </Routes>
      <DisplayNamePrompt />
      <PendingRunFlusher />
    </BrowserRouter>
  );
}
