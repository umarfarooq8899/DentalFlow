import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../lib/apiClient';
import { PermissionGate } from '../components/PermissionGate';
import { Plus, Shield, Building2, User, FileText, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';

export function Dashboard() {
  const { user, clinic } = useAuth();
  const [records, setRecords] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchRecords = async () => {
    try {
      const res = await apiClient.get('/test-records');
      setRecords(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const handleCreateRecord = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await apiClient.post('/test-records', { title, content });
      setTitle('');
      setContent('');
      await fetchRecords();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRecord = async (id) => {
    if (!window.confirm('Are you sure you want to delete this test record?')) return;
    try {
      await apiClient.delete(`/test-records/${id}`);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Clinic Header Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 shadow-xl mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-400 text-sm font-semibold mb-1">
            <Building2 className="h-4 w-4" />
            <span>Active Clinic Tenant</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white">{clinic?.name}</h1>
          <p className="text-sm text-slate-400 font-mono mt-1">
            Tenant ID: <span className="text-slate-200">{clinic?.id}</span> • Slug: <span className="text-brand-300">/{clinic?.slug}</span>
          </p>
        </div>

        <div className="flex items-center gap-3 bg-slate-950/80 p-3 rounded-xl border border-slate-800">
          <div className="h-10 w-10 rounded-full bg-brand-950 border border-brand-800 flex items-center justify-center text-brand-400">
            <User className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium text-white">
              {user?.firstName} {user?.lastName}
            </div>
            <div className="text-xs text-brand-400 capitalize">{user?.role}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Create Record form */}
        <div className="lg:col-span-1">
          <div className="p-6 rounded-xl bg-slate-900/60 border border-slate-800 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
              <Plus className="h-5 w-5 text-brand-400" />
              <span>Create Tenant Record</span>
            </div>

            <PermissionGate
              permission="test_records:write"
              fallback={
                <div className="p-4 rounded-lg bg-amber-950/30 border border-amber-900 text-amber-300 text-sm flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5 text-amber-400" />
                  <span>Your role ({user?.role}) does not have permission to create records.</span>
                </div>
              }
            >
              <form onSubmit={handleCreateRecord} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-800 text-rose-300 text-xs">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Record Title
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Clinical Note"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Content
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Isolated patient records or operational data..."
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2 px-4 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-sm transition disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Record'}
                </button>
              </form>
            </PermissionGate>
          </div>
        </div>

        {/* Right Column: Records list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-400" />
              <span>Clinic Records (Tenant Scoped)</span>
            </h2>
            <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full font-mono">
              {records.length} records
            </span>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-slate-400">Loading records...</div>
          ) : records.length === 0 ? (
            <div className="p-8 rounded-xl bg-slate-900/40 border border-dashed border-slate-800 text-center">
              <Shield className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-slate-400 text-sm">
                No records yet for <span className="text-white font-medium">{clinic?.name}</span>.
              </p>
              <p className="text-slate-500 text-xs mt-1">
                Records created here are completely isolated from all other dental clinics.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {records.map((record) => (
                <div
                  key={record.id}
                  className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 hover:border-slate-700 transition flex items-start justify-between gap-4"
                >
                  <div>
                    <h3 className="text-base font-semibold text-white">{record.title}</h3>
                    <p className="text-sm text-slate-300 mt-1">{record.content}</p>
                    <div className="flex items-center gap-3 mt-3 text-xs text-slate-500 font-mono">
                      <span>ID: {record.id.slice(-6)}</span>
                      <span>Clinic: {record.clinicId.slice(-6)}</span>
                      <span>Created: {new Date(record.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <PermissionGate permission="test_records:delete">
                    <button
                      onClick={() => handleDeleteRecord(record.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition"
                      title="Delete record"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </PermissionGate>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
