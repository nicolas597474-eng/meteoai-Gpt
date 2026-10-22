import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Route, Switch, Link, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { FavoriteWeatherPreloader } from "./components/FavoriteWeatherPreloader";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ProvenanceDisplayProvider } from "./contexts/ProvenanceDisplayContext";
import { getSwipeNavigationTarget, isQualifiedPageSwipe, MAIN_PAGE_PATHS, PAGE_SWIPE_IGNORE_SELECTOR } from "./lib/pageNavigation";
import { useDetailedForecastPrefetch } from "./hooks/useDetailedForecastPrefetch";
import { PageReadinessProvider, usePageReady, useRouteLoading } from "./contexts/PageReadinessContext";
import { WeatherAILoader } from "./components/weather/WeatherAILoader";
import { AtmosphericSky } from './components/weather/AtmosphericSky';
import {
  LayoutDashboard,
  Trophy,
  FileText,
  Activity,
  FlaskConical,
  ChartNoAxesCombined,
} from "lucide-react";

const loadDashboard = () => import("./pages/Dashboard");
const Dashboard = lazy(loadDashboard);
const loadRanking = () => import("./pages/Ranking");
const loadHistory = () => import("./pages/History");
const loadWeatherAILab = () => import("./pages/WeatherAILab");
const loadWeatherDetails = () => import("./pages/WeatherDetails");
const loadReliabilityLaboratory = () => import("./pages/ReliabilityLaboratory");
const Ranking = lazy(loadRanking);
const History = lazy(loadHistory);
const Report = lazy(() => import("./pages/Report"));
const WeatherAILab = lazy(loadWeatherAILab);
const FavoriteSettings = lazy(() => import("./pages/FavoriteSettings"));
const WeatherDetails = lazy(loadWeatherDetails);
const WeightComparison = lazy(() => import("./pages/WeightComparison"));
const ReliabilityLaboratory = lazy(loadReliabilityLaboratory);
const NetatmoConnection = lazy(() => import('./pages/NetatmoConnection'));
const NetatmoStations = lazy(() => import('./pages/NetatmoStations'));
const NotFound = lazy(() => import("./pages/NotFound"));

const mainPagePreloaders: Record<string, () => Promise<unknown>> = {
  "/": loadDashboard,
  "/details": loadWeatherDetails,
  "/laboratoire": loadReliabilityLaboratory,
  "/ranking": loadRanking,
  "/ai-lab": loadWeatherAILab,
};

function preloadMainPage(path: string) {
  const preload = mainPagePreloaders[path];
  if (preload) void preload().catch(() => undefined);
}

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/details", label: "Prévisions", icon: FileText },
  { path: "/laboratoire", label: "Fiabilité", icon: ChartNoAxesCombined },
  { path: "/ranking", label: "Stations", icon: Trophy },
  { path: "/ai-lab", label: "AI Lab", icon: FlaskConical },
];

function shouldIgnorePageSwipe(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest(PAGE_SWIPE_IGNORE_SELECTOR));
}

// Keep favorite-cache warming, but only after the initial page is ready.
// Once mounted, leave it mounted so its own requests cannot create a restart loop.
function DeferredFavoritePreloader() {
  const ready = usePageReady();
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    if (ready && !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "")) {
      setEnabled(true);
    }
  }, [ready]);
  return enabled ? <FavoriteWeatherPreloader /> : null;
}

function PageSwipeNavigator({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const gestureRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const previousLocationRef = useRef(location);
  const pendingDirectionRef = useRef<"forward" | "backward" | null>(null);
  const [transition, setTransition] = useState<{ location: string; direction: "forward" | "backward" } | null>(null);

  useEffect(() => {
    const onPopState = () => {
      // Android's system back button and the browser back action both emit popstate.
      pendingDirectionRef.current = "backward";
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (previousLocationRef.current === location) return;
    const previousIndex = MAIN_PAGE_PATHS.indexOf(previousLocationRef.current as (typeof MAIN_PAGE_PATHS)[number]);
    const nextIndex = MAIN_PAGE_PATHS.indexOf(location as (typeof MAIN_PAGE_PATHS)[number]);
    const inferredDirection = previousIndex >= 0 && nextIndex >= 0 && nextIndex < previousIndex ? "backward" : "forward";
    const direction = pendingDirectionRef.current ?? inferredDirection;
    pendingDirectionRef.current = null;
    previousLocationRef.current = location;
    setTransition({ location, direction });
  }, [location]);

  useEffect(() => {
    if (transition?.location !== location) return;
    const timer = window.setTimeout(() => setTransition(null), 240);
    return () => window.clearTimeout(timer);
  }, [location, transition]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch" || shouldIgnorePageSwipe(event.target)) {
      gestureRef.current = null;
      return;
    }
    gestureRef.current = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || event.pointerType !== "touch") return;

    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    const elapsed = event.timeStamp - gesture.time;
    if (!isQualifiedPageSwipe(deltaX, deltaY, elapsed)) return;

    const target = getSwipeNavigationTarget(location, deltaX);
    if (target) {
      const direction = deltaX < 0 ? "forward" : "backward";
      pendingDirectionRef.current = direction;
      setTransition({ location: target, direction });
      setLocation(target);
    }
  };

  const onPointerCancel = () => { gestureRef.current = null; };

  const transitionClass = transition?.location === location
    ? `page-swipe-transition page-swipe-transition--${transition.direction}`
    : "";

  return <div className="touch-auto" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}><div key={location} className={transitionClass}>{children}</div></div>;
}

function TopNav() {
  const [location] = useLocation();
  const prefetchDetailedForecast = useDetailedForecastPrefetch();
  const activateNavItem = (path: string) => {
    preloadMainPage(path);
    if (path === "/details") prefetchDetailedForecast();
  };
  return (
    <nav className="sticky top-0 z-50 hidden border-b border-border bg-background sm:block">
      <div className="max-w-2xl mx-auto px-3 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2">
            <div className="weather-icon-bare h-7 w-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <span className="font-bold text-base tracking-tight">MeteoAI</span>
          </Link>
          {/* Desktop nav links (hidden on mobile — use bottom bar) */}
          <div className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  onPointerEnter={() => activateNavItem(item.path)}
                  onFocus={() => activateNavItem(item.path)}
                  onPointerDown={() => activateNavItem(item.path)}
                >
                  <item.icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}

function BottomNav() {
  const [location] = useLocation();
  const prefetchDetailedForecast = useDetailedForecastPrefetch();
  const activateNavItem = (path: string) => {
    preloadMainPage(path);
    if (path === "/details") prefetchDetailedForecast();
  };
  return (
    <nav aria-label="Navigation principale" className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background text-foreground sm:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex h-16 items-center justify-around px-2">
        {navItems.map((item) => {
          const isActive = location === item.path;
          return (
            <Link
              key={item.path}
              href={item.path}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors min-w-0 flex-1 ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
              onPointerEnter={() => activateNavItem(item.path)}
              onFocus={() => activateNavItem(item.path)}
              onPointerDown={() => activateNavItem(item.path)}
            >
              <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
              <span className={`text-xs font-medium truncate ${isActive ? "text-primary" : ""}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function ScrollToTopOnRouteChange() {
  const [location] = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);

    // Keep the current MeteoAI section on the browser history entry. Android's
    // system back button then traverses the section the user visited just before.
    const currentState = window.history.state && typeof window.history.state === "object"
      ? window.history.state
      : {};
    if (currentState.meteoAiSection !== location) {
      window.history.replaceState({ ...currentState, meteoAiSection: location }, "", location);
    }
  }, [location]);

  return null;
}

function RouteLoadingFallback() {
  useRouteLoading();
  return (
    <div className="mx-auto min-h-[60vh] max-w-2xl" role="status" aria-live="polite" aria-label="Chargement de la page">
      <WeatherAILoader loading={true} message="Chargement de la page" variant="full" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
          <Route path="/connexion-netatmo" component={NetatmoConnection} />
          <Route path="/stations-netatmo" component={NetatmoStations} />
      <Route path="/" component={Dashboard} />
      <Route path="/ranking" component={Ranking} />
      <Route path="/reliability" component={ReliabilityLaboratory} />
      <Route path="/laboratoire" component={ReliabilityLaboratory} />
      <Route path="/lab" component={ReliabilityLaboratory} />
      <Route path="/history" component={History} />
      <Route path="/report" component={Report} />
      <Route path="/ai-lab" component={WeatherAILab} />
      <Route path="/stations" component={Ranking} />
      <Route path="/details" component={WeatherDetails} />
      <Route path="/weight-comparison" component={WeightComparison} />
      <Route path="/favorites" component={FavoriteSettings} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <ProvenanceDisplayProvider>
          <TooltipProvider>
            <Toaster />
            <PageReadinessProvider>
              <AtmosphericSky />
              <DeferredFavoritePreloader />
              <TopNav />
              <ScrollToTopOnRouteChange />
              <PageSwipeNavigator>
                <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
                  <Suspense fallback={<RouteLoadingFallback />}>
                    <div className="page-content-enter"><Router /></div>
                  </Suspense>
                </div>
              </PageSwipeNavigator>
              <BottomNav />
            </PageReadinessProvider>
          </TooltipProvider>
        </ProvenanceDisplayProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
