"use client";

import { createAuthClient } from "@neondatabase/auth/next";

// Same-origin /api/auth proxy: no database credentials or Neon server secrets
// are exposed to the browser. The server returns a typed 503 while offline.
export const authClient = createAuthClient();

export const signUp = authClient.signUp;
export const signIn = authClient.signIn;
export const signOut = authClient.signOut;
export const useSession = authClient.useSession;
