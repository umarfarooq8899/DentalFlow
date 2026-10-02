import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../lib/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [clinic, setClinic] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Restore session from token on mount
  useEffect(() => {
    async function restoreSession() {
      const token = apiClient.getAccessToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const res = await apiClient.get('/auth/me');
        setUser(res.data.user);
        setClinic(res.data.clinic);
      } catch (err) {
        console.warn('Session restoration failed:', err.message);
        apiClient.clearTokens();
        setUser(null);
        setClinic(null);
      } finally {
        setIsLoading(false);
      }
    }

    restoreSession();

    const handleUnauthorized = () => {
      setUser(null);
      setClinic(null);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = async (credentials) => {
    const res = await apiClient.post('/auth/login', credentials);
    const { user: userData, clinic: clinicData } = res.data || {};
    const accessToken = res.data?.tokens?.accessToken || res.data?.accessToken;
    const refreshToken = res.data?.tokens?.refreshToken || res.data?.refreshToken;

    if (accessToken && refreshToken) {
      apiClient.setTokens(accessToken, refreshToken);
    }
    setUser(userData);
    setClinic(clinicData);
    return res.data;
  };

  const register = async (payload) => {
    const res = await apiClient.post('/auth/register', payload);
    const { user: userData, clinic: clinicData } = res.data || {};
    const accessToken = res.data?.tokens?.accessToken || res.data?.accessToken;
    const refreshToken = res.data?.tokens?.refreshToken || res.data?.refreshToken;

    if (accessToken && refreshToken) {
      apiClient.setTokens(accessToken, refreshToken);
    }
    setUser(userData);
    setClinic(clinicData);
    return res.data;
  };

  const logout = async () => {
    try {
      const refreshToken = apiClient.getRefreshToken();
      await apiClient.post('/auth/logout', { refreshToken });
    } catch {
      // Ignore network errors on logout
    } finally {
      apiClient.clearTokens();
      setUser(null);
      setClinic(null);
    }
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    const adminRoles = ['superadmin', 'super_admin', 'clinic_admin', 'clinic_owner'];
    if (adminRoles.includes(user.role)) return true;

    const userPerms = user.effectivePermissions || user.permissions || [];
    if (userPerms.includes('*') || userPerms.includes(permission)) return true;

    return false;
  };

  const value = {
    user,
    clinic,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
    hasPermission,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
