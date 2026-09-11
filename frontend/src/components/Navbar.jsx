import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Activity, LogOut, LayoutDashboard, Shield, Building2 } from 'lucide-react';

export function Navbar() {
  const { user, clinic, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg text-brand-400">
          <Activity className="h-6 w-6 text-brand-400" />
          <span>DentalFlow</span>
        </Link>

        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <>
              <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-sm">
                <Building2 className="h-4 w-4 text-brand-400" />
                <span className="font-medium text-slate-200">{clinic?.name}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-brand-950 text-brand-300 border border-brand-800 font-mono">
                  {user?.role}
                </span>
              </div>

              <Link
                to="/dashboard"
                className="flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white transition"
              >
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>

              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 text-sm font-medium text-rose-400 hover:text-rose-300 transition ml-2"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-sm font-medium text-slate-300 hover:text-white px-3 py-1.5 rounded-md transition"
              >
                Sign In
              </Link>
              <Link
                to="/register"
                className="text-sm font-medium bg-brand-600 hover:bg-brand-500 text-white px-4 py-1.5 rounded-md shadow-sm transition shadow-brand-500/20"
              >
                Register Clinic
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
