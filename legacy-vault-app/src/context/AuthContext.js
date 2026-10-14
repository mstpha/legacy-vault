import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { setAuthHandlers } from "../api/client";
import { getItem, setItem, deleteItem, STORAGE_KEYS } from "../utils/storage";
import * as authApi from "../api/auth.api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  // Held only in memory for the duration of a login -> MFA-code step; never persisted.
  const [pendingCredentials, setPendingCredentials] = useState(null);

  const clearSession = useCallback(async () => {
    setUser(null);
    setAccessToken(null);
    setPendingCredentials(null);
    await deleteItem(STORAGE_KEYS.ACCESS_TOKEN);
    await deleteItem(STORAGE_KEYS.REFRESH_TOKEN);
  }, []);

  const refreshTokens = useCallback(async () => {
    const storedRefresh = await getItem(STORAGE_KEYS.REFRESH_TOKEN);
    if (!storedRefresh) throw new Error("No refresh token available");
    const { accessToken: newAccess, refreshToken: newRefresh } = await authApi.refreshRequest(storedRefresh);
    setAccessToken(newAccess);
    await setItem(STORAGE_KEYS.ACCESS_TOKEN, newAccess);
    await setItem(STORAGE_KEYS.REFRESH_TOKEN, newRefresh);
    return newAccess;
  }, []);

  // Keep the axios interceptors pointed at the latest token/refresh/logout logic.
  useEffect(() => {
    setAuthHandlers({
      getAccessToken: async () => accessToken || (await getItem(STORAGE_KEYS.ACCESS_TOKEN)),
      refreshTokens,
      onAuthFailure: () => {
        clearSession();
      },
    });
  }, [accessToken, refreshTokens, clearSession]);

  const completeLogin = useCallback(async (result) => {
    setAccessToken(result.accessToken);
    setUser(result.user);
    await setItem(STORAGE_KEYS.ACCESS_TOKEN, result.accessToken);
    await setItem(STORAGE_KEYS.REFRESH_TOKEN, result.refreshToken);
  }, []);

  // Bootstrap: try to resume a session from stored tokens on app start.

useEffect(() => {
  let active = true;

  async function bootstrap() {
    try {
      const storedRefresh = await getItem(STORAGE_KEYS.REFRESH_TOKEN);

      if (!storedRefresh) return;

      const newAccess = await refreshTokens();

      if (!active) return;

      setAccessToken(newAccess);

      const me = await authApi.meRequest();

      if (active) {
        setUser(me);
      }
    } catch (err) {
      if (active) {
        await clearSession();
      }
    } finally {
      if (active) {
        setIsLoading(false);
      }
    }
  }

  bootstrap();

  return () => {
    active = false;
  };
}, [refreshTokens, clearSession]);


  const register = useCallback(({ email, password, fullName }) => {
    return authApi.registerRequest({ email, password, fullName });
  }, []);

  // Step 1 of login. Returns { mfaRequired: true } if a TOTP code is needed next,
  // otherwise the session is already established when this resolves.
  const login = useCallback(
    async ({ email, password }) => {
      const result = await authApi.loginRequest({ email, password });
      if (result.mfaRequired) {
        setPendingCredentials({ email, password });
        return { mfaRequired: true };
      }
      await completeLogin(result);
      return { mfaRequired: false };
    },
    [completeLogin]
  );

  const submitMfaCode = useCallback(
    async (mfaToken) => {
      if (!pendingCredentials) throw new Error("No login in progress.");
      const result = await authApi.loginRequest({ ...pendingCredentials, mfaToken });
      setPendingCredentials(null);
      await completeLogin(result);
    },
    [pendingCredentials, completeLogin]
  );

  const cancelMfaLogin = useCallback(() => setPendingCredentials(null), []);

const verifyEmail = useCallback(
  ({ email, code }) => authApi.verifyEmailRequest({ email, code }),
  []
);

const logout = useCallback(async () => {
  // Read the refresh token before deleting locally stored credentials.
  const refreshTokenPromise = getItem(STORAGE_KEYS.REFRESH_TOKEN).catch(
    () => null
  );

  // Immediately update React state so the authenticated UI can disappear.
  setUser(null);
  setAccessToken(null);
  setPendingCredentials(null);

  // Clear local credentials without waiting for the server.
  await Promise.all([
    deleteItem(STORAGE_KEYS.ACCESS_TOKEN).catch(() => {}),
    deleteItem(STORAGE_KEYS.REFRESH_TOKEN).catch(() => {}),
  ]);

  const storedRefresh = await refreshTokenPromise;

  // Server-side revocation is best-effort and must not block the UI.
  if (storedRefresh) {
    authApi.logoutRequest(storedRefresh).catch(() => {
      // The local session is already cleared.
    });
  }
}, []);


  const refreshMe = useCallback(async () => {
    const me = await authApi.meRequest();
    setUser(me);
    return me;
  }, []);

  // Lets a screen (e.g. after confirming MFA enrollment) install a freshly-issued
  // access token immediately, instead of waiting for the next 401-triggered refresh.
  const applyAccessToken = useCallback(async (newAccessToken) => {
    setAccessToken(newAccessToken);
    await setItem(STORAGE_KEYS.ACCESS_TOKEN, newAccessToken);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!accessToken && !!user,
      mfaPendingEmail: pendingCredentials?.email || null,
      register,
      login,
      submitMfaCode,
      cancelMfaLogin,
      verifyEmail,
      logout,
      refreshMe,
      applyAccessToken,
    }),
    [
      user,
      isLoading,
      accessToken,
      pendingCredentials,
      register,
      login,
      submitMfaCode,
      cancelMfaLogin,
      verifyEmail,
      logout,
      refreshMe,
      applyAccessToken,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}