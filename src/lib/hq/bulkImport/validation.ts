import type { RowValidationError } from "./types";

export function asImportString(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeHttpUrl(raw: unknown): string {
  const value = asImportString(raw);
  if (!value) return "";
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    return url.toString();
  } catch {
    return value;
  }
}

export function isValidHttpUrl(raw: unknown): boolean {
  const value = asImportString(raw);
  if (!value) return true;
  const normalized = normalizeHttpUrl(value);
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeWholeNumber(
  raw: unknown,
  options: { currency?: boolean } = {},
): string {
  const value = asImportString(raw);
  if (!value) return "";
  const cleaned = value.replace(options.currency ? /[$,\s]/g : /[,\s]/g, "");
  const n = Number(cleaned);
  if (Number.isInteger(n) && n >= 0) return String(n);
  return value;
}

export function normalizeMoney(raw: unknown): string {
  const value = asImportString(raw);
  if (!value) return "";
  const cleaned = value.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isNaN(n) && n >= 0) return cleaned;
  return value;
}

export function isValidWholeNumber(
  raw: unknown,
  options: { currency?: boolean } = {},
): boolean {
  const value = asImportString(raw);
  if (!value) return true;
  const normalized = normalizeWholeNumber(value, options);
  const n = Number(normalized);
  return Number.isInteger(n) && n >= 0;
}

export function isValidMoney(raw: unknown): boolean {
  const value = asImportString(raw);
  if (!value) return true;
  const normalized = normalizeMoney(value);
  const n = Number(normalized);
  return !Number.isNaN(n) && n >= 0;
}

export function pushError(
  errors: RowValidationError[],
  row_index: number,
  column: string,
  message: string,
): void {
  errors.push({ row_index, column, message });
}
