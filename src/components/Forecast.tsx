import { useEffect, useRef } from "react";
import type { ForecastPeriod, NwsHourlyPeriod } from "../api";
import { getWeatherIcon } from "./WeatherIcon";

/** Format an hour using the forecast location's own clock (from the ISO offset), not the machine's timezone. */
function formatHour(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(dateStr);
  if (match?.[2] !== undefined && match[3] !== undefined) {
    const hour = Number(match[2]);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12} ${ampm}`;
  }
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  } catch {
    return "";
  }
}

/** Calendar date (YYYY-MM-DD) of a period's start, in the forecast location's local time. */
function getDayKey(period: ForecastPeriod): string {
  return period.startTime ? period.startTime.slice(0, 10) : period.name;
}

/**
 * Group forecast periods into one entry per calendar day.
 *
 * Period names cannot be used as the grouping key: on holidays the NWS names
 * the daytime period after the holiday ("Columbus Day") while the paired night
 * period keeps the weekday ("Monday Night"), so name-based grouping splits a
 * single day into two rows and renders the night low as if it were a high.
 */
export function groupPeriodsByDay(periods: ForecastPeriod[]): Map<string, ForecastPeriod[]> {
  const groups = new Map<string, ForecastPeriod[]>();
  for (const period of periods) {
    const key = getDayKey(period);
    const existing = groups.get(key);
    if (existing) {
      existing.push(period);
    } else {
      groups.set(key, [period]);
    }
  }
  return groups;
}

/** One entry per day; each value is the calendar date that day row represents. */
export function getUniqueDays(periods: ForecastPeriod[]): string[] {
  return [...groupPeriodsByDay(periods).keys()];
}

/**
 * Display-name overrides for NWS holiday period names.
 * The NWS labels the October holiday "Columbus Day"; we show "Indigenous People's Day".
 * Add other holidays here as needed.
 */
const DAY_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  "Columbus Day": "Indigenous People's Day",
};

/** Display label for a day row: the daytime period's name (e.g. "Columbus Day"). */
function getDayLabel(dayPeriods: ForecastPeriod[]): string {
  const primary = dayPeriods.find((p) => p.isDaytime) ?? dayPeriods[0];
  if (!primary) return "";
  const name = primary.name.replace(/ Night$/, "").trim();
  return DAY_LABEL_OVERRIDES[name] ?? name;
}

export interface ForecastHandle {
  scrollUp: () => void;
  scrollDown: () => void;
  scrollToTop: () => void;
  scrollToLine: (y: number) => void;
}

export function Forecast({
  periods,
  selectedForecastIdx,
  onSelectForecastIdx,
  showHourly,
  hourlyPeriods,
  uniqueDays,
  onScrollboxReady,
  focusedPanel,
}: {
  periods: ForecastPeriod[];
  selectedForecastIdx: number;
  onSelectForecastIdx: (idx: number) => void;
  showHourly: boolean;
  hourlyPeriods: NwsHourlyPeriod[] | null;
  uniqueDays: string[];
  onScrollboxReady?: (handle: ForecastHandle) => void;
  focusedPanel: "alerts" | "forecast";
}) {
  const groups = groupPeriodsByDay(periods);
  const selectedDayKey = uniqueDays[selectedForecastIdx] ?? null;
  const selectedDayPeriods = selectedDayKey ? groups.get(selectedDayKey) ?? [] : [];
  const selectedDayLabel = selectedDayPeriods.length > 0 ? getDayLabel(selectedDayPeriods) : null;

  const daysToShow = showHourly && selectedDayKey ? [selectedDayKey] : uniqueDays;

  const lines: string[] = [];
  const colors: string[] = [];
  const backgrounds: (string | undefined)[] = [];

  if (!showHourly) {
    lines.push("Press Enter or Space on a day to view its hourly forecast. Use j/k or arrows to scroll through days.");
    colors.push("gray");
    backgrounds.push(undefined);
  } else {
    lines.push(`Hourly forecast for ${selectedDayLabel ?? selectedDayKey ?? "this day"}. Press Enter or Space to close. Use j/k or arrows to scroll hourly entries.`);
    colors.push("gray");
    backgrounds.push(undefined);
  }

  daysToShow.forEach((dayKey, idx) => {
    const isSelected = showHourly ? true : idx === selectedForecastIdx;
    const dayPeriods = groups.get(dayKey) ?? [];
    const dayPeriod = dayPeriods.find((p) => p.isDaytime) ?? null;
    const nightPeriod = dayPeriods.find((p) => p.isDaytime === false) ?? null;
    const primary = dayPeriod ?? nightPeriod ?? dayPeriods[0] ?? null;
    const dayHourly = hourlyPeriods
      ? hourlyPeriods.filter((p) => p.startTime && p.startTime.slice(0, 10) === dayKey)
      : [];
    const showThisHourly = showHourly && dayKey === selectedDayKey;

    lines.push(dayPeriods.length > 0 ? getDayLabel(dayPeriods) : dayKey);
    colors.push(isSelected ? "white" : "cyan");
    backgrounds.push(isSelected ? "blue" : undefined);

    if (primary) {
      const precipSource = dayPeriod ?? primary;
      const precipText = precipSource.probabilityOfPrecipitation !== null && precipSource.probabilityOfPrecipitation !== undefined
        ? ` | ${precipSource.probabilityOfPrecipitation}% chance of precipitation`
        : "";
      const temps =
        dayPeriod && nightPeriod
          ? `High ${dayPeriod.temperature}${dayPeriod.temperatureUnit} / Low ${nightPeriod.temperature}${nightPeriod.temperatureUnit}`
          : dayPeriod
            ? `High ${dayPeriod.temperature}${dayPeriod.temperatureUnit}`
            : `Low ${primary.temperature}${primary.temperatureUnit}`;
      lines.push(`${getWeatherIcon(primary.shortForecast, primary.isDaytime)} ${temps}${precipText}`);
      colors.push(isSelected ? "white" : "gray");
      backgrounds.push(isSelected ? "blue" : undefined);
    }

    if (showThisHourly) {
      lines.push("------------------------");
      colors.push("gray");
      backgrounds.push(undefined);

      if (dayHourly.length === 0 && hourlyPeriods === null) {
        lines.push("Loading hourly forecast...");
        colors.push("gray");
        backgrounds.push(undefined);
      } else if (dayHourly.length === 0 && hourlyPeriods !== null) {
        lines.push("No hourly data available for this day.");
        colors.push("gray");
        backgrounds.push(undefined);
      } else {
        dayHourly.forEach((period) => {
          lines.push(`${formatHour(period.startTime)} - ${formatHour(period.endTime)}`);
          colors.push("cyan");
          backgrounds.push(undefined);
          lines.push(`${getWeatherIcon(period.shortForecast, period.isDaytime)} ${period.temperature}${period.temperatureUnit}`);
          colors.push("gray");
          backgrounds.push(undefined);
          const hPrecip = period.probabilityOfPrecipitation !== null && period.probabilityOfPrecipitation !== undefined
            ? ` | ${period.probabilityOfPrecipitation}% chance of precipitation`
            : "";
          lines.push(`${period.shortForecast}${hPrecip}`);
          colors.push("gray");
          backgrounds.push(undefined);
          lines.push(`Wind: ${period.windSpeed} ${period.windDirection}`);
          colors.push("gray");
          backgrounds.push(undefined);
        });
      }
    }
  });

  const scrollboxNodeRef = useRef<{ scrollBy: (delta: { x: number; y: number }) => void; scrollTo: (pos: { x: number; y: number }) => void } | null>(null);

  useEffect(() => {
    const node = scrollboxNodeRef.current;
    if (node && onScrollboxReady) {
      onScrollboxReady({
        scrollUp: () => { node.scrollBy({ x: 0, y: -1 }); },
        scrollDown: () => { node.scrollBy({ x: 0, y: 1 }); },
        scrollToTop: () => { node.scrollTo({ x: 0, y: 0 }); },
        scrollToLine: (y: number) => { node.scrollTo({ x: 0, y }); },
      });
    }
  }, [onScrollboxReady, lines.length, showHourly]);

  return (
    <box title="Forecast" style={{ flexDirection: "column", border: true, padding: 1, flexGrow: 1, flexShrink: 1, minWidth: 1 }}>
      <scrollbox
        viewportCulling={false}
        scrollY={true}
        scrollX={false}
        focused={focusedPanel === "forecast"}
        ref={scrollboxNodeRef as any}
        style={{ maxHeight: 40, maxWidth: "100%" }}
      >
        {lines.map((text, idx) => (
          <text key={`${selectedDayKey}-${idx}`} fg={colors[idx]} bg={backgrounds[idx]}>
            {text}
          </text>
        ))}
      </scrollbox>
    </box>
  );
}
