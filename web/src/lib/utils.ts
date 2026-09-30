import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const r = await fetch(path, init);
  let body: T;
  try {
    body = (await r.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: r.status, body };
}
