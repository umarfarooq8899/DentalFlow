import React from 'react';
import { useAuth } from '../context/AuthContext';

export function PermissionGate({ permission, children, fallback = null }) {
  const { hasPermission } = useAuth();

  if (!hasPermission(permission)) {
    return fallback;
  }

  return children;
}
