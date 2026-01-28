/**
 * AAS Portal - Server-side Auth0 JWT Verification
 * For use in Netlify Functions
 */

import { createRemoteJWKSet, jwtVerify, errors, type JWTPayload } from "jose";

// Auth0 Configuration
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'dev-sug5bhfoekw1qquv.us.auth0.com';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://api.aas-portal.com';
const AUTH0_ISSUER = `https://${AUTH0_DOMAIN}/`;
const NAMESPACE = 'https://aas-portal.com';

// Extended JWT payload with Auth0 claims
export interface Auth0TokenPayload extends JWTPayload {
  sub: string;
  permissions?: string[];
  [key: string]: unknown;
}

// Custom error class for auth errors
export class AuthError extends Error {
  constructor(message: string, public statusCode: number = 401) {
    super(message);
    this.name = "AuthError";
  }
}

// JWKS endpoint (cached by jose)
let JWKS: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!JWKS) {
    JWKS = createRemoteJWKSet(
      new URL('.well-known/jwks.json', AUTH0_ISSUER),
      { cacheMaxAge: 600_000 } // 10 minute cache
    );
  }
  return JWKS;
}

// Extract Bearer token from Authorization header
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization") ?? "";
  const [type, token] = auth.trim().split(" ");
  return type === "Bearer" && token ? token : null;
}

// Verify JWT token
export async function verifyToken(request: Request): Promise<Auth0TokenPayload> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new AuthError("Missing Authorization header", 401);
  }

  try {
    const { payload } = await jwtVerify<Auth0TokenPayload>(token, getJWKS(), {
      issuer: AUTH0_ISSUER,
      audience: AUTH0_AUDIENCE,
      algorithms: ["RS256"],
    });
    return payload;
  } catch (error) {
    if (error instanceof errors.JWTExpired) {
      throw new AuthError("Token expired", 401);
    }
    if (error instanceof errors.JWTClaimValidationFailed) {
      throw new AuthError("Invalid token claims", 401);
    }
    throw new AuthError("Invalid token", 401);
  }
}

// Get roles from token payload
export function getRoles(payload: Auth0TokenPayload): string[] {
  return (payload[`${NAMESPACE}/roles`] as string[]) || [];
}

// Check if user has required role
export function hasRole(payload: Auth0TokenPayload, requiredRoles: string | string[]): boolean {
  const userRoles = getRoles(payload);
  const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
  return roles.some(role => userRoles.includes(role));
}

// Check if user has required permission
export function hasPermission(payload: Auth0TokenPayload, permission: string): boolean {
  return (payload.permissions ?? []).includes(permission);
}

// Response helpers
export function unauthorizedResponse(message: string = "Unauthorized"): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized", message }),
    { 
      status: 401, 
      headers: { "Content-Type": "application/json" } 
    }
  );
}

export function forbiddenResponse(message: string = "Forbidden"): Response {
  return new Response(
    JSON.stringify({ error: "Forbidden", message }),
    { 
      status: 403, 
      headers: { "Content-Type": "application/json" } 
    }
  );
}

// Middleware wrapper for protected routes
type HandlerWithAuth = (
  request: Request, 
  context: unknown, 
  auth: { payload: Auth0TokenPayload; roles: string[] }
) => Promise<Response>;

interface ProtectOptions {
  allowedRoles?: string[];
  requireAuth?: boolean;
}

export function withAuth(handler: HandlerWithAuth, options: ProtectOptions = {}) {
  const { allowedRoles = [], requireAuth = true } = options;
  
  return async (request: Request, context: unknown): Promise<Response> => {
    try {
      // Verify token
      const payload = await verifyToken(request);
      const roles = getRoles(payload);
      
      // Check role authorization if roles are specified
      if (allowedRoles.length > 0 && !hasRole(payload, allowedRoles)) {
        return forbiddenResponse(`Requires one of: ${allowedRoles.join(', ')}`);
      }
      
      // Call the handler with auth context
      return handler(request, context, { payload, roles });
      
    } catch (error) {
      if (error instanceof AuthError) {
        return unauthorizedResponse(error.message);
      }
      
      // If auth not required, allow through without auth context
      if (!requireAuth) {
        return handler(request, context, { payload: {} as Auth0TokenPayload, roles: [] });
      }
      
      console.error('[Auth] Unexpected error:', error);
      return new Response(
        JSON.stringify({ error: "Internal Server Error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  };
}

// Export all utilities
export default {
  verifyToken,
  extractBearerToken,
  getRoles,
  hasRole,
  hasPermission,
  unauthorizedResponse,
  forbiddenResponse,
  withAuth,
  AuthError
};
