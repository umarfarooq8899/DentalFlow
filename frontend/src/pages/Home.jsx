import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Users, Activity, Lock, Database, ArrowRight } from 'lucide-react';

export function Home() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="max-w-4xl text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-950/60 border border-brand-800 text-brand-400 text-xs font-semibold mb-6">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Production-Ready Multi-Tenant Architecture</span>
        </div>

        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white mb-6 leading-tight">
          Next-Generation SaaS for <br className="hidden sm:inline" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-sky-300 to-indigo-400">
            Modern Dental Clinics
          </span>
        </h1>

        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Comprehensive practice management with strict tenant data isolation, granular role-based access control, and enterprise-grade security.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            to="/register"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium shadow-lg shadow-brand-500/25 transition"
          >
            <span>Register Your Clinic</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/login"
            className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium border border-slate-700 transition"
          >
            Sign In to Clinic
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mt-24 w-full">
        <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
          <div className="h-10 w-10 rounded-lg bg-brand-950 border border-brand-800 flex items-center justify-center mb-4 text-brand-400">
            <Database className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Automated Multi-Tenancy</h2>
          <p className="text-sm text-slate-400">
            Guaranteed query isolation via ambient async context and Mongoose lifecycle hooks. Zero cross-tenant data leaks.
          </p>
        </div>

        <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
          <div className="h-10 w-10 rounded-lg bg-brand-950 border border-brand-800 flex items-center justify-center mb-4 text-brand-400">
            <Lock className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Granular RBAC</h2>
          <p className="text-sm text-slate-400">
            Built-in roles (Clinic Owner, Dentist, Hygienist, Receptionist, Billing) with exact permission verification at both API and UI layers.
          </p>
        </div>

        <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
          <div className="h-10 w-10 rounded-lg bg-brand-950 border border-brand-800 flex items-center justify-center mb-4 text-brand-400">
            <Users className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-white mb-2">Token Family Rotation</h2>
          <p className="text-sm text-slate-400">
            Short-lived access tokens with automatic refresh token rotation and replay attack detection to keep clinic data safe.
          </p>
        </div>
      </div>
    </div>
  );
}
