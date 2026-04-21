import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = "AZN"): string {
  return new Intl.NumberFormat("az-AZ", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat("az-AZ", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date))
}
