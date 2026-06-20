import { BrowserRouter, Route, Routes } from "react-router-dom";

import { Classic } from "./pages/Classic";
import { Hub } from "./pages/Hub";
import { Marathon } from "./pages/Marathon";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/marathon" element={<Marathon />} />
        <Route path="/classic" element={<Classic />} />
      </Routes>
    </BrowserRouter>
  );
}
