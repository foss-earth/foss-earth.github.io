import type {
  BuiltInParameterUnit,
  NumberRange,
  ParameterBounds,
  ParameterChoice,
  ParameterSpec,
  ParameterUnit,
  ParameterValue,
} from "./types";

export function isNumberRange(value: unknown): value is NumberRange {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as NumberRange).min === "number" && typeof (value as NumberRange).max === "number"
    && Object.keys(value).length === 2;
}

export function sameValue(a: ParameterValue | undefined, b: ParameterValue | undefined): boolean {
  if (a === b) return true;
  if (isNumberRange(a) && isNumberRange(b)) return a.min === b.min && a.max === b.max;
  return false;
}

export function copyValue<T extends ParameterValue>(value: T): T {
  return (isNumberRange(value) ? { min: value.min, max: value.max } : value) as T;
}

/**
 * Why a value is not acceptable for a spec, or null when it is. Values are
 * checked, never repaired: an out-of-bounds number is refused, not clamped.
 */
export function validateValue(
  spec: ParameterSpec,
  value: unknown,
  bounds: ParameterBounds | null,
  choices: readonly ParameterChoice[],
): string | null {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean" ? null : "Expected on or off.";
    case "text":
      return typeof value === "string" ? null : "Expected text.";
    case "choice":
      if (typeof value !== "string") return "Expected one of the choices.";
      if (choices.some(choice => choice.id === value)) return null;
      return `"${value}" is not one of ${choices.map(choice => choice.label).join(", ") || "the choices"}.`;
    case "number": {
      if (typeof value === "string") {
        return spec.named?.some(named => named.id === value) ? null : `"${value}" is not a number or a named value.`;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) return "Expected a number.";
      if (bounds && (value < bounds.min || value > bounds.max)) {
        return `${formatQuantity(spec.unit, value)} is outside ${formatQuantity(spec.unit, bounds.min)} to ${formatQuantity(spec.unit, bounds.max)}.`;
      }
      return null;
    }
    case "range": {
      if (!isNumberRange(value) || !Number.isFinite(value.min) || !Number.isFinite(value.max)) return "Expected a range with two ends.";
      if (value.min > value.max) return "The range's ends are reversed.";
      if (bounds && (value.min < bounds.min || value.max > bounds.max)) {
        return `${formatQuantity(spec.unit, value.min)} to ${formatQuantity(spec.unit, value.max)} is outside ${formatQuantity(spec.unit, bounds.min)} to ${formatQuantity(spec.unit, bounds.max)}.`;
      }
      return null;
    }
  }
}

/**
 * Reads a value written as text, as in a URL: numbers, named values,
 * `min..max` or `min,max` ranges, and on/off, true/false, 1/0.
 */
export function parseValue(spec: ParameterSpec, text: string): ParameterValue | null {
  const raw = text.trim();
  switch (spec.kind) {
    case "boolean": {
      const lower = raw.toLowerCase();
      if (["1", "true", "on", "yes"].includes(lower)) return true;
      if (["0", "false", "off", "no"].includes(lower)) return false;
      return null;
    }
    case "text":
    case "choice":
      return raw;
    case "number": {
      if (spec.named?.some(named => named.id === raw)) return raw;
      if (raw === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }
    case "range": {
      const parts = raw.includes("..") ? raw.split("..") : raw.split(",");
      if (parts.length !== 2 || parts.some(part => part.trim() === "")) return null;
      const [min, max] = parts.map(part => Number(part));
      return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
    }
  }
}

/** The value as it goes into a URL: the inverse of parseValue. */
export function stringifyValue(value: ParameterValue): string {
  if (isNumberRange(value)) return `${value.min}..${value.max}`;
  return String(value);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  const rounded = magnitude >= 100 ? Math.round(value) : magnitude >= 1 ? Math.round(value * 100) / 100 : Math.round(value * 1000) / 1000;
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

const UNIT_TEXT: Record<BuiltInParameterUnit, string> = {
  MiB: "MiB",
  px: "px",
  ms: "ms",
  s: "s",
  m: "m",
  Hz: "Hz",
  count: "",
  levels: "levels",
  ratio: "×",
  fraction: "%",
  deg: "°",
  "deg/px": "°/px",
  "deg/s": "°/s",
  fps: "fps",
  samples: "samples",
  "per-frame": "per frame",
  "per-notch": "per notch",
  "per-px": "per px",
  "per-s": "per s",
  none: "",
};

export function unitId(unit: ParameterUnit): string {
  return typeof unit === "string" ? unit : unit.id;
}

export function unitSuffix(unit: ParameterUnit): string {
  const text = typeof unit === "string" ? UNIT_TEXT[unit] : unit.text;
  if (text === "") return "";
  return text === "°" || text === "×" || text === "%" ? text : ` ${text}`;
}

/** A number in its unit for display; a fraction shows as a percentage. */
export function formatQuantity(unit: ParameterUnit, value: number): string {
  if (unit === "fraction") return `${formatNumber(value * 100)}%`;
  return `${formatNumber(value)}${unitSuffix(unit)}`;
}

/** A value for display: "256 MiB", "on", "4 to 64 px", "8%", or a choice's label. */
export function formatValue(spec: ParameterSpec, value: ParameterValue, choices: readonly ParameterChoice[] = spec.choices ?? []): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (isNumberRange(value)) {
    return spec.unit === "fraction"
      ? `${formatQuantity(spec.unit, value.min)} to ${formatQuantity(spec.unit, value.max)}`
      : `${formatNumber(value.min)} to ${formatNumber(value.max)}${unitSuffix(spec.unit)}`;
  }
  if (typeof value === "number") return formatQuantity(spec.unit, value);
  if (spec.kind === "choice") return choices.find(choice => choice.id === value)?.label ?? value;
  if (spec.kind === "number") return spec.named?.find(named => named.id === value)?.label ?? value;
  if (spec.sensitive) return value ? "set" : "not set";
  return value === "" ? "empty" : value;
}
