import { createNeonAuth } from "@neondatabase/auth/next/server";

export type AuthErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_ORIGIN";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export interface VerifiedSession {
  user: AuthUser;
  session: { id: string; expiresAt: string };
}

type NeonAuth = ReturnType<typeof createNeonAuth>;
let authInstance: NeonAuth | undefined;
let authConfigurationKey: string | undefined;

function readConfiguration() {
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret || secret.length < 32) {
    throw new AuthError(
      "AUTH_NOT_CONFIGURED",
      "Sign-in is unavailable until Neon Auth is configured. Public starter data remains available.",
      503,
    );
  }
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  } catch {
    throw new AuthError("AUTH_NOT_CONFIGURED", "The Neon Auth configuration is invalid.", 503);
  }
  return { baseUrl, secret };
}

export function isAuthConfigured(): boolean {
  try {
    readConfiguration();
    return true;
  } catch {
    return false;
  }
}

export function getNeonAuth(): NeonAuth {
  const configuration = readConfiguration();
  const key = `${configuration.baseUrl}\u0000${configuration.secret}`;
  if (!authInstance || authConfigurationKey !== key) {
    authInstance = createNeonAuth({
      baseUrl: configuration.baseUrl,
      cookies: { secret: configuration.secret, sessionDataTtl: 60 },
      logLevel: "silent",
    });
    authConfigurationKey = key;
  }
  return authInstance;
}

/** Every protected request revalidates with Neon, including session revocation. */
export async function getSession(): Promise<VerifiedSession | null> {
  if (!isAuthConfigured()) return null;
  let response: Awaited<ReturnType<NeonAuth["getSession"]>>;
  try {
    // The SDK's server adapter explicitly recognizes the HTTP query string "true"
    // to bypass its signed session_data cache, rather than a boolean value.
    const options = { query: { disableCookieCache: "true" } } as unknown as Parameters<
      NeonAuth["getSession"]
    >[0];
    response = await getNeonAuth().getSession(options);
  } catch {
    throw new AuthError("AUTH_UNAVAILABLE", "The sign-in service is temporarily unavailable.", 503);
  }
  if (response.error) {
    if (response.error.status === 401 || response.error.status === 403) return null;
    throw new AuthError("AUTH_UNAVAILABLE", "The sign-in service is temporarily unavailable.", 503);
  }
  const data = response.data;
  if (!data?.user || !data.session) return null;
  const expiresAt = new Date(data.session.expiresAt);
  if (
    typeof data.user.id !== "string" ||
    !data.user.id ||
    typeof data.user.email !== "string" ||
    !data.user.email ||
    typeof data.session.id !== "string" ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= Date.now()
  ) return null;
  return {
    user: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name ?? null,
      emailVerified: data.user.emailVerified === true,
    },
    session: { id: data.session.id, expiresAt: expiresAt.toISOString() },
  };
}

export function assertSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return;
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new AuthError("INVALID_ORIGIN", "This request must come from the LEXRENT app.", 403);
  }
}

export async function requireUser(request?: Request): Promise<AuthUser> {
  // Distinguish unavailable configuration from an ordinary signed-out session.
  readConfiguration();
  if (request) assertSameOrigin(request);
  const session = await getSession();
  if (!session) throw new AuthError("UNAUTHENTICATED", "Sign in to save or change your data.", 401);
  return session.user;
}

export function isAdmin(user: AuthUser | null | undefined): boolean {
  if (!user?.emailVerified) return false;
  const allowed = (process.env.LEXRENT_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(user.email.trim().toLowerCase());
}

export async function requireAdmin(request?: Request): Promise<AuthUser> {
  const user = await requireUser(request);
  if (!isAdmin(user)) {
    throw new AuthError("FORBIDDEN", "A verified administrator account is required.", 403);
  }
  return user;
}

export function authErrorResponse(error: unknown): Response {
  const accessError = error instanceof AuthError
    ? error
    : new AuthError("AUTH_UNAVAILABLE", "The sign-in service is temporarily unavailable.", 503);
  return Response.json(
    { code: accessError.code, message: accessError.message, error: { code: accessError.code, message: accessError.message } },
    { status: accessError.status, headers: { "Cache-Control": "no-store" } },
  );
}
