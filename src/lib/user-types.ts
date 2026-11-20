// ── User Types ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  playerNumber: string; // 6-digit numeric player ID e.g. "482917"
  email: string;
  displayName: string;
  passwordHash?: string;
  googleId?: string;
  avatarUrl?: string;
  createdAt: string;   // ISO 8601
  emailVerified: boolean;
  frozen?: boolean;
  /** Set when the owner adds a player with a temporary password; cleared when they set their own. */
  mustChangePassword?: boolean;
}

export interface UserSession {
  userId: string;
  createdAt: string;   // ISO 8601
}
