const scenarioService = require("./scenarioService");

class CookieService {
  constructor() {
    // Store active sessions: scenarioId -> Set of sessionIds
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
      console.log(`[Cookie-${scenarioId}] Checking validation status. cookieValidationEnabled field:`, scenario?.cookieValidationEnabled);
      // If cookieValidationEnabled is undefined, default to true for backward compatibility
      const isEnabled = scenario?.cookieValidationEnabled !== false;
      console.log(`[Cookie-${scenarioId}] Validation enabled result: ${isEnabled}`);
      return isEnabled;
    } catch (error) {
      console.error(`Error checking cookie validation status for ${scenarioId}:`, error);
      return true; // Default to enabled for safety
    }
  }

  // Get the expected cookie value for a scenario
  async getExpectedCookieValue(scenarioId) {
    try {
      const scenario = await scenarioService.getScenarioById(scenarioId);
      return scenario?.cookieValue || null;
    } catch (error) {
      console.error(
        `Error getting cookie value for ${scenarioId}:`,
        error,
      );
      return null;
    }
  }

  // Register a new session
  registerSession(scenarioId, sessionId) {
    if (!this.activeSessions.has(scenarioId)) {
      this.activeSessions.set(scenarioId, new Set());
    }
    this.activeSessions.get(scenarioId).add(sessionId);
    console.log(
      `[Cookie] Registered session ${sessionId} for scenario ${scenarioId}`,
    );
  }

  // Validate session
  isValidSession(scenarioId, sessionId) {
    const sessions = this.activeSessions.get(scenarioId);
    return sessions && sessions.has(sessionId);
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
}

module.exports = new CookieService();
