import { useEffect, useState, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { LatLon, WeatherData } from "./types";
import type { NwsHourlyPeriod } from "./api";
import {
  detectCoordinates,
  fetchNwsPoint,
  fetchNwsForecast,
  fetchCurrentConditions,
  fetchNwsAlerts,
  fetchNwsHourlyForecast,
  getNearestRadar,
} from "./api";
import { CurrentConditions } from "./components/CurrentConditions";
import { Forecast, getUniqueDays } from "./components/Forecast";
import type { ForecastHandle } from "./components/Forecast";
import { Radar } from "./components/Radar";
import { Alerts } from "./components/Alerts";

export function App({ initialLatLon }: { initialLatLon?: LatLon }) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const latLonRef = useRef<LatLon | undefined>(initialLatLon);
  useEffect(() => {
    latLonRef.current = initialLatLon;
  }, [initialLatLon]);

  const refreshMs = Number(process.env.ISOBOARD_REFRESH_INTERVAL || 300) * 1000;

  const loadData = useCallback(async (latLon?: LatLon) => {
    setLoading(true);
    setError(null);
    try {
      const coords = latLon ?? latLonRef.current ?? (await detectCoordinates());
      const point = await fetchNwsPoint(coords.lat, coords.lon);
      
      let forecast: any[] = [];
      if (point.properties.forecast && point.properties.forecast.trim()) {
        const forecastUrl = point.properties.forecast;
        forecast = await fetchNwsForecast(forecastUrl);
      }

      let current: any = {
        temperatureF: null,
        humidity: null,
        windSpeedMph: null,
        windDirection: null,
        weather: "N/A",
        isDaytime: true,
      };
      const gridDataUrl = point.properties.forecastGridData;
      if (gridDataUrl && gridDataUrl.trim()) {
        current = await fetchCurrentConditions(gridDataUrl, coords.lat, coords.lon);
      }
      
      const radarInfo = getNearestRadar(coords.lat, coords.lon, Date.now().toString());
      const radar = radarInfo;

      let alerts: any[] = [];
      try {
        alerts = await fetchNwsAlerts(coords.lat, coords.lon);
      } catch {
        alerts = [];
      }

      setData({
        location: {
          city: point.properties.relativeLocation.properties.city,
          state: point.properties.relativeLocation.properties.state,
          lat: coords.lat,
          lon: coords.lon,
        },
        current,
        forecast,
        radar,
        alerts,
        forecastHourlyUrl: point.properties.forecastHourly || undefined,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const startAutoRefresh = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
    }
    intervalRef.current = setInterval(() => {
      loadData(latLonRef.current);
    }, refreshMs);
  }, [loadData, refreshMs]);

  useEffect(() => {
    latLonRef.current = initialLatLon;
    loadData(initialLatLon);
    startAutoRefresh();

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [loadData, startAutoRefresh]);

  const [selectedAlertIdx, setSelectedAlertIdx] = useState(0);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const alertIdxRef = useRef(0);
  alertIdxRef.current = selectedAlertIdx;

  const [focusedPanel, setFocusedPanel] = useState<"alerts" | "forecast">("forecast");
  const [selectedForecastIdx, setSelectedForecastIdx] = useState(0);
  const [showHourly, setShowHourly] = useState(false);
  const [hourlyPeriods, setHourlyPeriods] = useState<NwsHourlyPeriod[] | null>(null);
  const [forecastHourlyUrl, setForecastHourlyUrl] = useState<string | undefined>(undefined);
  const forecastScrollRef = useRef<ForecastHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadHourly() {
      if (!forecastHourlyUrl || selectedForecastIdx < 0 || !showHourly) {
        setHourlyPeriods(null);
        return;
      }
      try {
        const periods = await fetchNwsHourlyForecast(forecastHourlyUrl);
        if (cancelled) return;
        setHourlyPeriods(periods);
      } catch {
        if (!cancelled) setHourlyPeriods(null);
      }
    }
    loadHourly();
    return () => { cancelled = true; };
  }, [forecastHourlyUrl, selectedForecastIdx, showHourly]);

  useEffect(() => {
    setForecastHourlyUrl(data?.forecastHourlyUrl);
  }, [data?.forecastHourlyUrl]);

  useEffect(() => {
    if (!showHourly) {
      forecastScrollRef.current?.scrollToTop();
    }
  }, [showHourly]);

  useKeyboard((key) => {
    if (key.name === "r" && !key.ctrl && !key.meta) {
      loadData(latLonRef.current);
      startAutoRefresh();
    }
    if (key.name === "q" && !key.ctrl && !key.meta) {
      try {
        const maybe = (globalThis as Record<string, unknown>).__wfRenderer;
        if (maybe && typeof maybe === "object" && maybe !== null && typeof (maybe as { destroy?: unknown }).destroy === "function") {
          (maybe as { destroy: () => void }).destroy();
        }
      } catch {
        // ignore
      }
      process.exit(0);
    }
    if (key.name === "h" || key.name === "ArrowLeft") {
      setFocusedPanel("alerts");
    } else if (key.name === "l" || key.name === "ArrowRight") {
      setFocusedPanel("forecast");
    } else     if (key.name === "j" || key.name === "ArrowDown") {
      if (focusedPanel === "alerts") {
        setSelectedAlertIdx((i) => Math.min(i + 1, (data?.alerts.length ?? 1) - 1));
      } else if (!showHourly) {
        setSelectedForecastIdx((i) => {
          const next = Math.min(i + 1, data ? Math.max(0, getUniqueDays(data.forecast).length - 1) : 0);
          const targetLine = next * 2;
          forecastScrollRef.current?.scrollToLine(targetLine);
          return next;
        });
      }
    } else if (key.name === "k" || key.name === "ArrowUp") {
      if (focusedPanel === "alerts") {
        setSelectedAlertIdx((i) => Math.max(i - 1, 0));
      } else if (!showHourly) {
        setSelectedForecastIdx((i) => {
          const next = Math.max(i - 1, 0);
          const targetLine = next * 2;
          forecastScrollRef.current?.scrollToLine(targetLine);
          return next;
        });
      }
    } else if (key.name === "return" || key.name === "space") {
      if (focusedPanel === "alerts") {
        if (data) {
          const current = data.alerts[alertIdxRef.current];
          if (current) {
            setExpandedAlertId((prev) => (prev === current.id ? null : current.id));
          }
        }
      } else {
        setShowHourly((prev) => !prev);
      }
    }
  });

  const refreshLabel =
    refreshMs >= 60000
      ? `${refreshMs / 60000} min`
      : `${refreshMs / 1000} sec`;

  return (
    <box style={{ flexDirection: "column", padding: 1, gap: 1, width: "100%", height: "100%" }}>
      <box style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <text fg="yellow">IsoBoard</text>
        {data && (
          <text fg="gray">
            {data.location.city}, {data.location.state} ({data.location.lat.toFixed(2)}, {data.location.lon.toFixed(2)})
          </text>
        )}
        <text fg="gray">
          Press <span fg="white">r</span> refresh | <span fg="white">q</span> quit | <span fg="white">h/l</span> or <span fg="white">arrows</span> switch panels | Panel: <span fg="white">{focusedPanel === "alerts" ? "Alerts" : "Forecast"}</span> | In Forecast: <span fg="white">j/k</span> or arrows scroll days, <span fg="white">Enter</span> open hourly | Auto: {refreshLabel}
        </text>
      </box>

        <box style={{ flexDirection: "row", gap: 1, width: "100%", flexGrow: 1 }}>
          <box style={{ flexDirection: "column", gap: 1, width: 35, flexShrink: 0, ...(focusedPanel === "alerts" ? { border: true } : {}) }}>
            {loading && <text fg="gray">Loading current conditions...</text>}
            {error && <text fg="red">Error: {error}</text>}
            {data && (
              <CurrentConditions conditions={data.current} city={data.location.city} state={data.location.state} isDaytime={data.current.isDaytime} />
            )}
            {data && data.alerts.length > 0 && <Alerts alerts={data.alerts} selectedIdx={selectedAlertIdx} expandedId={expandedAlertId} onExpand={(id) => setExpandedAlertId((prev) => (prev === id ? null : id))} />}
          </box>

          <box style={{ flexDirection: "column", gap: 1, flexGrow: 1, flexShrink: 1, minWidth: 1, ...(focusedPanel === "forecast" ? { border: true } : {}) }}>
            <Forecast
              periods={data?.forecast ?? []}
              selectedForecastIdx={selectedForecastIdx}
              onSelectForecastIdx={setSelectedForecastIdx}
              showHourly={showHourly}
              hourlyPeriods={hourlyPeriods}
              uniqueDays={data ? getUniqueDays(data.forecast) : []}
              onScrollboxReady={(handle) => { forecastScrollRef.current = handle; }}
              focusedPanel={focusedPanel}
            />
            {data && data.radar?.url?.trim() && <Radar radarUrl={data.radar.url} />}
          </box>
        </box>
    </box>
  );
}
