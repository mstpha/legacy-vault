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
    (async () => {
      const storedRefresh = await getItem(STORAGE_KEYS.REFRESH_TOKEN);
      if (!storedRefresh) {
        setIsLoading(false);
        return;
      }
      try {
        const newAccess = await refreshTokens();
        setAccessToken(newAccess);
        const me = await authApi.meRequest();
        setUser(me);
      } catch (err) {
        await clearSession();
      } finally {
        setIsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const logout = useCallback(async () => {
    try {
      const storedRefresh = await getItem(STORAGE_KEYS.REFRESH_TOKEN);
      if (storedRefresh) await authApi.logoutRequest(storedRefresh);
    } catch (err) {
      // Best-effort server-side revoke — clear the local session regardless.
    } finally {
      await clearSession();
    }
  }, [clearSession]);

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