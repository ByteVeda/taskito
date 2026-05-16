export interface AuthUser {
  username: string;
  role: string;
  created_at: number;
  last_login_at: number | null;
}

export interface AuthSession {
  username: string;
  role: string;
  expires_at: number;
  csrf_token: string;
}

export interface LoginResponse {
  user: AuthUser;
  session: AuthSession;
}

export interface SetupResponse {
  user: AuthUser;
}

export interface AuthStatus {
  setup_required: boolean;
}

export interface WhoamiResponse {
  user: AuthUser;
  csrf_token: string;
  expires_at: number;
}
