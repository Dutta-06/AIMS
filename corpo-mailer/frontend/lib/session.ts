import { setToken } from "./auth";

/** A 401 means the token expired or is invalid: drop it so the shell sends us to /login. */
export function clearOnUnauthorized() {
  setToken(null);
}
