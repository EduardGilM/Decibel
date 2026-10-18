"use client"

import { needsSessionToken, profileServerBase, saveSessionToken, sessionHeaders } from "./session-token.ts"

/** Base URL of the Decibel server (profiles, sessions). Same origin unless configured. */
export function serverBase(): string {
  return profileServerBase()
}

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Cookie sessions for the web plus server-bound Bearer tokens for native clients. */
export async function api<T>(path: string, { method = "GET", body, signal }: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response
  const base = serverBase()
  const authorization = sessionHeaders(base)
  const timeout = AbortSignal.timeout(10_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  let data
  try {
    response = await fetch(base + path, {
      method,
      credentials: "include",
      cache: "no-store",
      signal: requestSignal,
      headers: { ...authorization, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    try { data = await response.json() } catch (error) {
      if (requestSignal.aborted) throw requestSignal.reason ?? error
      data = null
    }
  } catch (error) {
    if (path === "/api/auth/logout") saveSessionToken(base)
    if (signal?.aborted) throw signal.reason ?? error
    throw new ApiError("No se puede conectar con el servidor.", 0)
  }
  if (path === "/api/auth/logout") saveSessionToken(base)
  if (response.ok && path === "/api/auth/login" && typeof data?.token === "string") saveSessionToken(base, needsSessionToken(base) ? data.token : undefined)
  if (response.status === 401 && path !== "/api/auth/login" && sessionHeaders(base).Authorization === authorization.Authorization) saveSessionToken(base)
  if (!response.ok) throw new ApiError(data?.error ?? `Error ${response.status}`, response.status)
  return data as T
}
