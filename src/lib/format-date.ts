export const TIME_ZONE = "Europe/Prague";

export function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale === "en" ? "en-US" : "cs-CZ", {
    timeZone: TIME_ZONE,
  });
}

export function formatDateTime(date: Date, locale: string): string {
  return date.toLocaleString(locale === "en" ? "en-US" : "cs-CZ", {
    timeZone: TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDigestDay(date: Date): string {
  return date.toLocaleDateString("cs-CZ", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  });
}
