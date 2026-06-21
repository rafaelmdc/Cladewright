import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Account } from "./pages/Account";
import { Hub } from "./pages/Hub";
import { Login } from "./pages/Login";
import { Marathon } from "./pages/Marathon";

// Classic mode is deferred — v1 ships Marathon only (Classic.tsx kept for later).
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/marathon" element={<Marathon />} />
        <Route path="/account" element={<Account />} />
        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}
