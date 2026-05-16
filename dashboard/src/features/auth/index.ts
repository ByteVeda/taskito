export { AuthGate } from "./components/auth-gate";
export { LoginForm } from "./components/login-form";
export { SetupForm } from "./components/setup-form";
export { UserMenu } from "./components/user-menu";
export {
  authStatusQuery,
  useAuthStatus,
  useChangePassword,
  useLogin,
  useLogout,
  useSetup,
  useWhoami,
  whoamiQuery,
} from "./hooks";
export type {
  AuthSession,
  AuthStatus,
  AuthUser,
  LoginResponse,
  SetupResponse,
  WhoamiResponse,
} from "./types";
