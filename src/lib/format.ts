export function formatPrice(value: number, currency = "USD") {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : 4;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency === "INR" ? "INR" : currency,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return value.toFixed(digits);
  }
}

export function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
