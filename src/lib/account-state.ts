"use client";

import { useEffect, useSyncExternalStore } from "react";

export interface AccountUser {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
}
export interface AccountState {
  user: AccountUser | null;
  auth_configured: boolean | null;
  is_admin: boolean;
  pending: boolean;
  error: boolean;
}

const initialState: AccountState = { user: null, auth_configured: null, is_admin: false, pending: true, error: false };
let state = initialState;
let pendingRequest: Promise<AccountState> | null = null;
const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function update(next: AccountState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Account labels and controls always use the same server-verified session. No tokens are stored here. */
export function refreshAccount(broadcast = false, force = false): Promise<AccountState> {
  // A focus check begun before cookies changed cannot confirm a later sign-in/sign-out.
  if (pendingRequest) return broadcast || force ? pendingRequest.then(() => refreshAccount(broadcast, true)) : pendingRequest;
  pendingRequest = (async () => {
    try {
      const response = await fetch("/api/me", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Account unavailable");
      const data = await response.json();
      update({ user: data.user ?? null, auth_configured: data.auth_configured === true, is_admin: data.is_admin === true, pending: false, error: false });
    } catch {
      update({ ...state, user: null, is_admin: false, pending: false, error: true });
    }
    if (broadcast) channel?.postMessage("account-changed");
    return state;
  })().finally(() => { pendingRequest = null; });
  return pendingRequest;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("pageshow", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("lexrent-account");
      channel.onmessage = event => { if (event.data === "account-changed") void refreshAccount(false, true); };
    }
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("pageshow", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
      channel?.close();
      channel = null;
    }
  };
}
function refreshOnFocus() { void refreshAccount(); }
function refreshOnVisibility() { if (document.visibilityState === "visible") void refreshAccount(); }

export function useAccount(pathname?: string): AccountState {
  const account = useSyncExternalStore(subscribe, () => state, () => initialState);
  useEffect(() => { void refreshAccount(); }, [pathname]);
  return account;
}

export function accountDisplayName(user: Pick<AccountUser, "name" | "email">): string {
  return user.name?.trim() || user.email;
}

export function getAccountSnapshot(): AccountState { return state; }
