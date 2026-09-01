import type { Id } from "../convex/_generated/dataModel";
import { EnsureSignedIn } from "./auth";
import { ErrorBoundary, Logo } from "./components/ui";
import { match, useRoute } from "./lib/router";
import { ToastProvider } from "./lib/toast";
import { Admin } from "./pages/Admin";
import { CaseRoom } from "./pages/CaseRoom";
import { Flyer } from "./pages/Flyer";
import { Landing } from "./pages/Landing";
import { NewCase } from "./pages/NewCase";

function Shell() {
  const { path, navigate } = useRoute();

  // Public flyer: no sign-in needed, no chrome (it prints).
  const flyer = match("/p/:slug", path);
  if (flyer) {
    return (
      <ErrorBoundary fallback={<NotFound navigate={navigate} />}>
        <Flyer slug={flyer.slug} navigate={navigate} />
      </ErrorBoundary>
    );
  }

  const caseRoute = match("/case/:id", path);
  return (
    <EnsureSignedIn>
      <header className="sticky top-0 z-[900] border-b border-cream-200/80 bg-cream-50/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 md:px-6">
          <button onClick={() => navigate("/")} aria-label="Beacon home"><Logo /></button>
          <nav className="flex items-center gap-1 text-sm">
            <button onClick={() => navigate("/")} className={`rounded-full px-3 py-1.5 font-medium ${path === "/" ? "bg-cream-200" : "hover:bg-cream-100"}`}>Home</button>
            <button onClick={() => navigate("/new")} className="rounded-full bg-ember-600 px-3.5 py-1.5 font-semibold text-white hover:bg-ember-700">Report a lost pet</button>
          </nav>
        </div>
      </header>
      <main>
        <ErrorBoundary fallback={<NotFound navigate={navigate} />}>
          {path === "/" && <Landing navigate={navigate} />}
          {path === "/new" && <NewCase navigate={navigate} />}
          {path === "/admin" && <Admin navigate={navigate} />}
          {caseRoute && <CaseRoom key={caseRoute.id} caseId={caseRoute.id as Id<"cases">} navigate={navigate} />}
          {path !== "/" && path !== "/new" && path !== "/admin" && !caseRoute && <NotFound navigate={navigate} />}
        </ErrorBoundary>
      </main>
    </EnsureSignedIn>
  );
}

function NotFound({ navigate }: { navigate: (to: string) => void }) {
  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <p className="text-5xl">🐾</p>
      <p className="mt-4 font-display text-3xl font-semibold">Nothing here</p>
      <button className="mt-6 rounded-full bg-ember-600 px-5 py-2.5 font-semibold text-white" onClick={() => navigate("/")}>Back to Beacon</button>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
