/**
 * Decode JWT token without verification (client-side only)
 * Note: This does NOT verify the token signature - verification happens on the server
 */
export function decodeJWT(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join(""),
    );
    return JSON.parse(jsonPayload);
  } catch (error) {
    console.error("Failed to decode JWT:", error);
    return null;
  }
}

/**
 * Check if JWT token is expired
 */
export function isTokenExpired(token) {
  const decoded = decodeJWT(token);
  if (!decoded || !decoded.exp) return true;

  // exp is in seconds, Date.now() is in milliseconds
  return decoded.exp * 1000 < Date.now();
}

/**
 * Get user info from JWT token
 */
export function getUserFromToken(token) {
  const decoded = decodeJWT(token);
  if (!decoded) return null;

  return {
    id: decoded.id,
    fullName: decoded.fullName,
    role: decoded.role,
  };
}
