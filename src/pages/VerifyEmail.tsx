import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { navigate } from '@/lib/router';
import { Button, Input, Label, Spinner } from '@/components/ui';
import { ShieldCheck, Mail, ArrowLeft, AlertCircle, RefreshCw } from 'lucide-react';

export function VerifyEmailPage() {
  const { user, profile, sendVerificationCode, verifyCode, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const sentRef = useRef(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (profile?.email_verified) {
      if (profile.role === 'candidate' && profile.status === 'pending') navigate('/pending-approval');
      else if (profile.role === 'candidate') navigate('/candidate');
      else navigate('/admin/dashboard');
      return;
    }
    if (sentRef.current) return;
    sentRef.current = true;
    sendCode();
  }, [user, profile]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendCode = async () => {
    setSending(true);
    setError('');
    setInfo('');
    try {
      await sendVerificationCode();
      setInfo('A verification code has been sent to your email.');
      setResendCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code');
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const ok = await verifyCode(code.trim());
      if (!ok) {
        setError('Invalid or expired code. Please check and try again.');
        setLoading(false);
        return;
      }
      // verifyCode triggers fetchProfile which updates profile state.
      // The useEffect above will redirect based on role + status.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <div className="w-full max-w-md">
        <button
          onClick={async () => { await signOut(); navigate('/'); }}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft size={16} /> Back to home
        </button>

        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 animate-fade-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-700 flex items-center justify-center text-white mb-3 shadow-lg shadow-blue-700/20">
              <Mail size={28} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 font-serif">Verify Your Email</h1>
            <p className="text-sm text-slate-500 mt-1 text-center">
              We sent a 6-digit code to<br />
              <span className="font-medium text-slate-700">{user?.email}</span>
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 animate-fade-in">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {info && !error && (
            <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700 animate-fade-in">
              <ShieldCheck size={18} className="shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <Label>Verification Code</Label>
              <Input
                type="text"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="text-center text-2xl tracking-[0.5em] font-mono"
                minLength={6}
                maxLength={6}
              />
            </div>

            <Button type="submit" disabled={loading || code.length !== 6} className="w-full" size="lg">
              {loading ? <Spinner /> : 'Verify Email'}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={sendCode}
              disabled={resendCooldown > 0 || sending}
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50 transition-colors"
            >
              {sending ? <Spinner size={14} /> : <RefreshCw size={14} />}
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
