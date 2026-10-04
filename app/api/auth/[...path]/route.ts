import { assertSameOrigin, authErrorResponse, getNeonAuth } from "../../../../src/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: AuthContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const handlers = getNeonAuth().handler();
    const method = request.method.toUpperCase() as keyof typeof handlers;
    const handler = handlers[method];
    if (!handler) return new Response(null, { status: 405 });
    return await handler(request, context);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
