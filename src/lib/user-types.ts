// ── User Types ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  displayName: string;
  passwordHash?: string;
  googleId?: string;
  avatarUrl?: string;
  createdAt: string;   // ISO 8601
  emailVerified: boolean;
}

export interface UserSession {
  userId: string;
  createdAt: string;   // ISO 8601
}
