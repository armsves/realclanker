import { Suspense } from "react";
import { Dashboard } from "./components/Dashboard";

export default function Page() {
  return (
    <Suspense fallback={<main className="boot">Opening the gate…</main>}>
      <Dashboard />
    </Suspense>
  );
}
