const scenarioService = require("./scenarioService");
const crypto = require("crypto");

class CookieService {
  constructor() {
    // Store active sessions: scenarioId -> Map of sessionId -> { createdAt, lastAccessedAt }
    this.activeSessions = new Map();
  }

  // Check if scenario has cookie enabled
  async isCookieEnabled(scenarioId) {
    try {
      const scenario = await scenarioService.getScenarioById(scenarioId);
      return (
        scenario &&
        scenario.type === "HLS" &&
        scenario.playbackType === "Live" &&
        scenario.addCookie === "YES"
      );
    } catch (error) {
      console.error(`Error checking cookie status for ${scenarioId}:`, error);
      return false;
    }
  }

  // Check if cookie validation is enabled for a scenario
  async isCookieValidationEnabled(scenarioId) {
    try {
      const scenario = await scenarioService.getScenarioById(scenarioId);
      console.log(
        `[Cookie-${scenarioId}] Checking validation status. cookieValidationEnabled field:`,
        scenario?.cookieValidationEnabled,
      );
      // If cookieValidationEnabled is undefined, default to true for backward compatibility
      const isEnabled = scenario?.cookieValidationEnabled !== false;
      console.log(
        `[Cookie-${scenarioId}] Validation enabled result: ${isEnabled}`,
      );
      return isEnabled;
    } catch (error) {
      console.error(
        `Error checking cookie validation status for ${scenarioId}:`,
        error,
      );
      return true; // Default to enabled for safety
    }
  }

  // Generate a new unique session cookie for a user
  generateSessionCookie(scenarioId) {
    const sessionId = crypto.randomBytes(32).toString("hex");
    this.registerSession(scenarioId, sessionId);
    console.log(
      `[Cookie-${scenarioId}] Generated new session cookie: ${sessionId}`,
    );
    return sessionId;
  }

  // Register a new session
  registerSession(scenarioId, sessionId) {
    if (!this.activeSessions.has(scenarioId)) {
      this.activeSessions.set(scenarioId, new Map());
    }

    const sessions = this.activeSessions.get(scenarioId);
    sessions.set(sessionId, {
      createdAt: new Date(),
      lastAccessedAt: new Date(),
    });

    console.log(
      `[Cookie-${scenarioId}] Registered session ${sessionId} (Total sessions: ${sessions.size})`,
    );
  }

  // Validate session
  isValidSession(scenarioId, sessionId) {
    const sessions = this.activeSessions.get(scenarioId);
    if (!sessions || !sessions.has(sessionId)) {
      return false;
    }

    // Update last accessed time
    const sessionData = sessions.get(sessionId);
    sessionData.lastAccessedAt = new Date();

    return true;
  }

  // Parse cookie header to extract sessionId
  parseCookie(cookieHeader) {
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      const [name, value] = cookie.split("=");
      if (name === "sessionId") {
        return value;
      }
    }
    return null;
  }

  // Clear sessions for a scenario
  clearSessions(scenarioId) {
    this.activeSessions.delete(scenarioId);
    console.log(`[Cookie] Cleared all sessions for scenario ${scenarioId}`);
  }

  // Get session count for a scenario
  getSessionCount(scenarioId) {
    const sessions = this.activeSessions.get(scenarioId);
    return sessions ? sessions.size : 0;
  }

  // Get all active sessions for a scenario (for debugging/monitoring)
  getActiveSessions(scenarioId) {
    const sessions = this.activeSessions.get(scenarioId);
    if (!sessions) return [];

    return Array.from(sessions.entries()).map(([sessionId, data]) => ({
      sessionId,
      createdAt: data.createdAt,
      lastAccessedAt: data.lastAccessedAt,
    }));
  }

  // Clean up expired sessions (optional - can be called periodically)
  cleanupExpiredSessions(scenarioId, maxAgeMs = 3600000) {
    const sessions = this.activeSessions.get(scenarioId);
    if (!sessions) return 0;

    const now = new Date();
    let removedCount = 0;

    for (const [sessionId, data] of sessions.entries()) {
      const age = now - data.lastAccessedAt;
      if (age > maxAgeMs) {
        sessions.delete(sessionId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log(
        `[Cookie-${scenarioId}] Cleaned up ${removedCount} expired sessions`,
      );
    }

    return removedCount;
  }
}

module.exports = new CookieService();
