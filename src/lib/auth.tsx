import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile, Role } from '@/types';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  profileLoading: boolean;
  needsApproval: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, role?: 'candidate' | 'worker') => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);

  const fetchProfile = useCallback(async (uid: string) => {
    setProfileLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, role, status, permissions, created_at, last_login, email_verified')
      .eq('id', uid)
      .maybeSingle();

    if (error) {
      setProfileLoading(false);
      return;
    }
    if (data) {
      let finalProf = data as Profile;
      try {
        const { data: uData } = await supabase.auth.getUser();
        const userMeta = uData?.user?.user_metadata;
        const isWorker =
          finalProf.role === 'worker' ||
          (finalProf.permissions || []).includes('worker') ||
          userMeta?.role === 'worker' ||
          userMeta?.is_worker === true;

        if (isWorker && finalProf.role !== 'worker') {
          const workerPerms = Array.from(new Set([...(finalProf.permissions || []), 'worker']));
          finalProf = { ...finalProf, role: 'worker', permissions: workerPerms };
          try {
            const { error: updErr } = await supabase.from('profiles').update({ role: 'worker', permissions: workerPerms }).eq('id', uid);
            if (updErr) {
              await supabase.from('profiles').update({ permissions: workerPerms }).eq('id', uid);
            }
          } catch {
            await supabase.from('profiles').update({ permissions: workerPerms }).eq('id', uid);
          }
        }
      } catch {}
      setProfile(finalProf);
      setProfileLoading(false);
    } else {
      setTimeout(async () => {
        const { data: retry } = await supabase
          .from('profiles')
          .select('id, name, role, status, permissions, created_at, last_login, email_verified')
          .eq('id', uid)
          .maybeSingle();
        if (retry) {
          let finalRetry = retry as Profile;
          try {
            const { data: uData } = await supabase.auth.getUser();
            const userMeta = uData?.user?.user_metadata;
            const isWorker =
              finalRetry.role === 'worker' ||
              (finalRetry.permissions || []).includes('worker') ||
              userMeta?.role === 'worker' ||
              userMeta?.is_worker === true;

            if (isWorker && finalRetry.role !== 'worker') {
              const workerPerms = Array.from(new Set([...(finalRetry.permissions || []), 'worker']));
              finalRetry = { ...finalRetry, role: 'worker', permissions: workerPerms };
              try {
                const { error: updErr } = await supabase.from('profiles').update({ role: 'worker', permissions: workerPerms }).eq('id', uid);
                if (updErr) {
                  await supabase.from('profiles').update({ permissions: workerPerms }).eq('id', uid);
                }
              } catch {
                await supabase.from('profiles').update({ permissions: workerPerms }).eq('id', uid);
              }
            }
          } catch {}
          setProfile(finalRetry);
        }
        setProfileLoading(false);
      }, 500);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        await fetchProfile(s.user.id);
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      (async () => {
        if (!mounted) return;
        setSession(s);
        setUser(s?.user ?? null);
        if (s?.user) {
          await fetchProfile(s.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, name: string, role: 'candidate' | 'worker' = 'candidate') => {
    let registeredViaApi = false;

    // Primary: Register via admin-api edge function with service_role key to guarantee target role is saved in profiles
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email, password, name, role }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        registeredViaApi = true;
        // Sign in immediately to create session
        const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
        if (signInErr) throw signInErr;
        return;
      }
      if (!res.ok && data.error && !data.error.includes('FunctionsFetchError')) {
        // Validation or duplicate user error from API
        throw new Error(data.error);
      }
    } catch (apiErr) {
      if (apiErr instanceof Error && (apiErr.message.includes('already exists') || apiErr.message.includes('already registered'))) {
        throw apiErr;
      }
      // If network failure or edge function not yet deployed, continue to client fallback
    }

    if (!registeredViaApi) {
      const { data: authData, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name,
            role,
            is_worker: role === 'worker',
          },
        },
      });
      if (error) throw error;

      // Immediately sign in to establish an active authenticated session
      try {
        const { data: signInData } = await supabase.auth.signInWithPassword({ email, password });
        const targetId = signInData?.user?.id || authData?.user?.id;
        if (targetId) {
          const perms = role === 'worker' ? ['worker'] : [];
          try {
            const { error: err1 } = await supabase
              .from('profiles')
              .update({ role, name, permissions: perms })
              .eq('id', targetId);
            if (err1) {
              await supabase
                .from('profiles')
                .update({ name, permissions: perms })
                .eq('id', targetId);
            }
          } catch {
            await supabase
              .from('profiles')
              .update({ name, permissions: perms })
              .eq('id', targetId);
          }
        }
      } catch {
        // Fallback if sign in fails (e.g. requires email confirmation)
        if (authData?.user) {
          const perms = role === 'worker' ? ['worker'] : [];
          try {
            const { error: err2 } = await supabase
              .from('profiles')
              .update({ role, name, permissions: perms })
              .eq('id', authData.user.id);
            if (err2) {
              await supabase
                .from('profiles')
                .update({ name, permissions: perms })
                .eq('id', authData.user.id);
            }
          } catch {}
        }
      }
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const needsApproval = !!user && !!profile && (profile.role === 'candidate' || profile.role === 'worker') && profile.status === 'pending';

  return (
    <AuthContext.Provider
      value={{ user, profile, session, loading, profileLoading, needsApproval, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRole(): Role | null {
  const { profile } = useAuth();
  return profile?.role ?? null;
}
