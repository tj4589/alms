import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Globe2,
  MailCheck,
  PencilLine,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User as FirebaseUser,
} from 'firebase/auth';
import Logo from './Logo';
import { createFirebaseSession } from '../lib/firebaseAuth';
import { firebaseAuth, firebaseConfigError, googleProvider } from '../lib/firebase';
import { forgotPasswordErrorMessage, PASSWORD_RESET_GENERIC_MESSAGE } from '../lib/authErrors';

type AuthProps = {
  onLogin: (token: string) => void | Promise<void>;
  onBackToLanding?: () => void;
  onPublicFeedback?: () => void;
  initialMode?: 'login' | 'register';
};

type PendingProfile = { email: string; name: string; username: string };

const ALLOWED_SCHOOL_DOMAINS = new Set(['stu.cu.edu.ng', 'covenantuniversity.edu.ng']);
const PENDING_PROFILE_KEY = 'exammind-pending-firebase-profile';
const VERIFICATION_COOLDOWN_SECONDS = 60;
const VERIFICATION_RESEND_KEY_PREFIX = 'exammind-verification-resend:';

function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isAllowedSchoolEmail(value: string): boolean {
  const email = normaliseEmail(value);
  const separator = email.lastIndexOf('@');
  return separator > 0 && ALLOWED_SCHOOL_DOMAINS.has(email.slice(separator + 1));
}

function authErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code || '');
  }
  return '';
}

function friendlyAuthError(error: unknown, fallback: string): string {
  const code = authErrorCode(error);
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'That email or password is not recognised.';
    case 'auth/email-already-in-use':
      return 'That email already has an account. Try signing in instead.';
    case 'auth/weak-password':
      return 'Choose a password with at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment, then try again.';
    case 'auth/popup-closed-by-user':
      return 'The Google sign-in window was closed before sign-in finished.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow popups and try again.';
    case 'auth/cancelled-popup-request':
      return 'Google sign-in was cancelled. Try again when you are ready.';
    case 'auth/network-request-failed':
      return 'The authentication service could not be reached. Check your connection and try again.';
    case 'auth/invalid-api-key':
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not configured for this build.';
    default:
      return error instanceof Error && error.message ? error.message : fallback;
  }
}

function readPendingProfile(email: string): PendingProfile | null {
  try {
    const stored = window.sessionStorage.getItem(PENDING_PROFILE_KEY);
    if (!stored) return null;
    const profile = JSON.parse(stored) as Partial<PendingProfile>;
    return profile.email === email && profile.name && profile.username
      ? { email: profile.email, name: profile.name, username: profile.username }
      : null;
  } catch {
    return null;
  }
}

function savePendingProfile(profile: PendingProfile): void {
  try {
    window.sessionStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage is helpful for a reload during verification, not a requirement.
  }
}

function clearPendingProfile(): void {
  try {
    window.sessionStorage.removeItem(PENDING_PROFILE_KEY);
  } catch {
    // Ignore blocked storage; it is not required for authentication.
  }
}

function verificationCooldownKey(email: string): string {
  return `${VERIFICATION_RESEND_KEY_PREFIX}${normaliseEmail(email)}`;
}

function readVerificationCooldown(email: string): number {
  const normalizedEmail = normaliseEmail(email);
  if (!normalizedEmail) return 0;

  try {
    const key = verificationCooldownKey(normalizedEmail);
    const rawValue = window.localStorage.getItem(key);
    const storedAt = Number(rawValue);
    if (!rawValue || !Number.isFinite(storedAt) || storedAt <= 0) {
      if (rawValue !== null) window.localStorage.removeItem(key);
      return 0;
    }

    const remaining = Math.ceil((storedAt + VERIFICATION_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
    if (remaining <= 0) {
      window.localStorage.removeItem(key);
      return 0;
    }
    return remaining;
  } catch {
    return 0;
  }
}

function saveVerificationCooldown(email: string): void {
  const normalizedEmail = normaliseEmail(email);
  if (!normalizedEmail) return;
  try {
    window.localStorage.setItem(verificationCooldownKey(normalizedEmail), String(Date.now()));
  } catch {
    // localStorage may be disabled; Firebase still enforces its own limits.
  }
}

function pruneVerificationCooldowns(): void {
  try {
    const now = Date.now();
    const obsoleteKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(VERIFICATION_RESEND_KEY_PREFIX)) continue;
      const storedAt = Number(window.localStorage.getItem(key));
      if (!Number.isFinite(storedAt) || storedAt <= 0 || storedAt + VERIFICATION_COOLDOWN_SECONDS * 1000 <= now) {
        obsoleteKeys.push(key);
      }
    }
    obsoleteKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // localStorage may be unavailable in a private browsing mode.
  }
}

export const Auth = ({ onLogin, onBackToLanding, onPublicFeedback, initialMode = 'register' }: AuthProps) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [verificationNotice, setVerificationNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const googleTokenRef = useRef<string | undefined>(undefined);
  const exchangeInFlight = useRef(false);

  const completeFirebaseSession = useCallback(async (
    user: FirebaseUser,
    provider: 'password' | 'google',
    googleIdToken?: string,
  ) => {
    if (!user.emailVerified) {
      setFirebaseUser(user);
      setVerificationOpen(true);
      return;
    }
    if (provider === 'google' && !googleIdToken) {
      setVerificationOpen(false);
      setError('For security, sign in with Google again to finish restoring this session.');
      return;
    }
    if (exchangeInFlight.current) return;

    const verifiedEmail = normaliseEmail(user.email || email);
    if (!isAllowedSchoolEmail(verifiedEmail)) {
      setError('ExamMind is currently available to Covenant University students only.');
      return;
    }

    exchangeInFlight.current = true;
    setLoading(true);
    setError('');
    try {
      const firebaseIdToken = await user.getIdToken(true);
      const pendingProfile = readPendingProfile(verifiedEmail);
      const response = await createFirebaseSession({
        firebase_id_token: firebaseIdToken,
        ...(googleIdToken ? { google_id_token: googleIdToken } : {}),
        provider,
        ...(pendingProfile ? { name: pendingProfile.name, username: pendingProfile.username } : {}),
      });
      if (!response.access_token) {
        throw new Error('Sign-in completed, but ExamMind could not start your workspace.');
      }
      clearPendingProfile();
      await onLogin(response.access_token);
    } catch (err) {
      setError(friendlyAuthError(err, 'We could not complete sign-in. Please try again.'));
    } finally {
      exchangeInFlight.current = false;
      setLoading(false);
    }
  }, [email, onLogin]);

  useEffect(() => {
    if (!firebaseAuth) return undefined;
    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setFirebaseUser(nextUser);
      if (!nextUser) {
        setVerificationOpen(false);
        return;
      }

      const nextEmail = normaliseEmail(nextUser.email || '');
      if (nextEmail) setEmail(nextEmail);
      if (!nextUser.emailVerified) {
        setCooldown(readVerificationCooldown(nextEmail));
        setVerificationOpen(true);
        return;
      }

      const isGoogleUser = nextUser.providerData.some((item) => item.providerId === 'google.com');
      if (isGoogleUser && !googleTokenRef.current) {
        setVerificationOpen(false);
        setError('Your Google account is remembered. Sign in with Google again to restore access securely.');
        return;
      }
      void completeFirebaseSession(nextUser, isGoogleUser ? 'google' : 'password', googleTokenRef.current);
    });
  }, [completeFirebaseSession]);

  useEffect(() => {
    pruneVerificationCooldowns();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (verificationOpen && email) setCooldown(readVerificationCooldown(email));
  }, [email, verificationOpen]);

  const ensureFirebase = () => {
    if (firebaseAuth && !firebaseConfigError) return true;
    setError(firebaseConfigError || 'Firebase Authentication is not configured for this build.');
    return false;
  };

  const handleSubmit = async () => {
    if (!ensureFirebase()) return;
    const schoolEmail = normaliseEmail(email);
    if (!isAllowedSchoolEmail(schoolEmail)) {
      setError('Use your Covenant University email (@stu.cu.edu.ng or @covenantuniversity.edu.ng).');
      return;
    }
    if (!isLogin) {
      if (password.length < 8) {
        setError('Choose a password with at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (name.trim().length < 2) {
        setError('Enter your full name.');
        return;
      }
      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        setError('Username must be 3-24 lowercase letters, numbers, or underscores.');
        return;
      }
    }

    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        const credential = await signInWithEmailAndPassword(firebaseAuth!, schoolEmail, password);
        setFirebaseUser(credential.user);
        if (!credential.user.emailVerified) {
          setVerificationOpen(true);
          setVerificationNotice('We sent a verification link when you created this account.');
          return;
        }
        await completeFirebaseSession(credential.user, 'password');
        return;
      }

      savePendingProfile({ email: schoolEmail, name: name.trim(), username });
      const credential = await createUserWithEmailAndPassword(firebaseAuth!, schoolEmail, password);
      await updateProfile(credential.user, { displayName: name.trim() });
      await sendEmailVerification(credential.user);
      setFirebaseUser(credential.user);
      setVerificationOpen(true);
      setVerificationNotice('A verification link is on its way. Check your school inbox before entering your workspace.');
      saveVerificationCooldown(schoolEmail);
      setCooldown(VERIFICATION_COOLDOWN_SECONDS);
    } catch (err) {
      setError(friendlyAuthError(err, 'We could not create that account. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!ensureFirebase() || !googleProvider) return;
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(firebaseAuth!, googleProvider);
      const signedInUser = result.user;
      const signedInEmail = normaliseEmail(signedInUser.email || '');
      if (!isAllowedSchoolEmail(signedInEmail)) {
        await signOut(firebaseAuth!);
        throw new Error('Use a Covenant University Google account to continue.');
      }
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleIdToken = credential?.idToken;
      if (!googleIdToken) {
        await signOut(firebaseAuth!);
        throw new Error('Google did not provide a verification token. Please try again.');
      }
      googleTokenRef.current = googleIdToken;
      setFirebaseUser(signedInUser);
      await completeFirebaseSession(signedInUser, 'google', googleIdToken);
    } catch (err) {
      setError(friendlyAuthError(err, 'Google sign-in could not be completed.'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!ensureFirebase()) return;
    const schoolEmail = normaliseEmail(email);
    if (!isAllowedSchoolEmail(schoolEmail)) {
      setError('Enter your Covenant University email first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await sendPasswordResetEmail(firebaseAuth!, schoolEmail);
      setVerificationNotice(PASSWORD_RESET_GENERIC_MESSAGE);
    } catch (err) {
      setError(forgotPasswordErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!firebaseUser || cooldown > 0) return;
    setLoading(true);
    setError('');
    try {
      await sendEmailVerification(firebaseUser);
      saveVerificationCooldown(firebaseUser.email || email);
      setCooldown(VERIFICATION_COOLDOWN_SECONDS);
      setVerificationNotice('Another verification link has been sent. Check your school inbox.');
    } catch (err) {
      setError(friendlyAuthError(err, 'We could not resend the verification email.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCheckVerification = async () => {
    if (!firebaseUser || !firebaseAuth) return;
    setLoading(true);
    setError('');
    try {
      await reload(firebaseUser);
      const refreshedUser = firebaseAuth.currentUser || firebaseUser;
      setFirebaseUser(refreshedUser);
      if (!refreshedUser.emailVerified) {
        setVerificationNotice('Your email is not verified yet. Open the latest link, then check again.');
        return;
      }
      const isGoogleUser = refreshedUser.providerData.some((item) => item.providerId === 'google.com');
      await completeFirebaseSession(refreshedUser, isGoogleUser ? 'google' : 'password', googleTokenRef.current);
    } catch (err) {
      setError(friendlyAuthError(err, 'We could not check verification yet. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (firebaseAuth) await signOut(firebaseAuth).catch(() => undefined);
    googleTokenRef.current = undefined;
    clearPendingProfile();
    setFirebaseUser(null);
    setVerificationOpen(false);
    setVerificationNotice('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setIsLogin(false);
  };

  const switchMode = () => {
    setIsLogin((current) => !current);
    setVerificationOpen(false);
    setError('');
    setVerificationNotice('');
    setConfirmPassword('');
  };

  return (
    <div className="auth-page">
      <div className="auth-grain" aria-hidden="true" />
      <header className="auth-topbar">
        <button className="auth-back" onClick={onBackToLanding} type="button"><ArrowLeft aria-hidden="true" size={18} />Back to overview</button>
        <button className="auth-top-brand" onClick={onBackToLanding} type="button" aria-label="Return to ExamMind home"><span className="auth-top-brand-mark" aria-hidden="true"><Logo size={24} /></span><span>Exam<span>Mind.</span></span></button>
        <span className="auth-top-note">Student workspace</span>
      </header>
      <section className="auth-shell">
        <div className="auth-panel">
          <div className="auth-kicker"><span className="auth-kicker-dot" aria-hidden="true" />A clearer way to study</div>
          <h1>{isLogin ? <>Good to see you <em>again.</em></> : <>Make room for your next <em>breakthrough.</em></>}</h1>
          <p>{isLogin ? 'Pick up where you left off. Your notes, questions, and next study session are waiting.' : 'Bring your course material together, then study with more context and less hunting.'}</p>
          <div className="auth-proof-list"><span><Search aria-hidden="true" size={15} />Search your notes</span><span><Users aria-hidden="true" size={15} />Study with your people</span><span><Sparkles aria-hidden="true" size={15} />Practice with purpose</span></div>
          <div className="auth-visual" aria-label="Students collaborating in a reading room">
            <img src="/images/landing/reading-room-study.jpg" alt="Two students studying together with a laptop and open books" width="1600" height="1067" />
            <div className="auth-visual-overlay" />
            <div className="auth-visual-caption"><span>A small study circle</span><strong>One question.<br /><em>A shared discovery.</em></strong><div><i>A</i><i>T</i><i>Z</i><small>3 classmates in a reading room</small></div></div>
          </div>
        </div>

        <div className="auth-card">
          {verificationOpen ? (
            <div className="auth-verification">
              <div className="auth-verification-icon" aria-hidden="true"><MailCheck size={24} /></div>
              <span className="auth-card-eyebrow">One small step</span>
              <h2>Verify your email.</h2>
              <p>We sent a secure link to <strong>{firebaseUser?.email || email}</strong>. Verify it before you enter your ExamMind workspace.</p>
              {verificationNotice && <div className="auth-verification-note" role="status">{verificationNotice}</div>}
              {error && <div className="upload-alert auth-error" role="alert">{error}</div>}
              <button type="button" className="auth-submit" onClick={() => void handleCheckVerification()} disabled={loading}><RefreshCw size={17} aria-hidden="true" />{loading ? 'Checking...' : 'I verified - check again'}</button>
              <button type="button" className="auth-secondary-action" onClick={() => void handleResendVerification()} disabled={loading || cooldown > 0}>{cooldown > 0 ? `Resend available in ${cooldown}s` : 'Resend verification email'}</button>
              <button type="button" className="auth-text-action" onClick={() => void handleChangeEmail()} disabled={loading}><PencilLine size={15} aria-hidden="true" /> Change email</button>
              <p className="auth-verification-help">Already verified in another tab? Refresh this screen and check again.</p>
            </div>
          ) : (
            <>
              <div className="auth-card-heading"><span className="auth-card-eyebrow">{isLogin ? 'Welcome back' : 'Start with your material'}</span><h2>{isLogin ? 'Sign in to your desk.' : 'Create your workspace.'}</h2><p>{isLogin ? 'Your archive and study groups are right where you left them.' : 'A private place for your notes, questions, and next breakthrough.'}</p></div>
              <div className="auth-switch" role="tablist" aria-label="Account access"><button className={isLogin ? 'on' : ''} role="tab" aria-selected={isLogin} type="button" onClick={() => setIsLogin(true)}>Sign in</button><button className={!isLogin ? 'on' : ''} role="tab" aria-selected={!isLogin} type="button" onClick={() => setIsLogin(false)}>Create account</button></div>
              {error && <div className="upload-alert auth-error" role="alert">{error}</div>}
              {verificationNotice && <div className="auth-verification-note" role="status">{verificationNotice}</div>}
              <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
                {!isLogin && <><label className="auth-field"><span>Full Name</span><input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your full name" autoComplete="name" required minLength={2} /></label><label className="auth-field"><span>Username</span><input type="text" value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} placeholder="e.g. vera_csc301" autoComplete="username" required minLength={3} maxLength={24} /><small>3-24 characters - lowercase letters, numbers, underscores</small></label></>}
                <label className="auth-field"><span>{isLogin ? 'Email Address' : 'School Email'}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={isLogin ? 'your@email.com' : 'yourname@stu.cu.edu.ng'} autoComplete="email" required />{!isLogin && <small>Use your Covenant University email. ExamMind is currently available to Covenant University students.</small>}</label>
                <label className="auth-field"><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isLogin ? 'Your password' : 'Minimum 8 characters'} autoComplete={isLogin ? 'current-password' : 'new-password'} required minLength={8} /></label>
                {!isLogin && <label className="auth-field"><span>Confirm Password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" autoComplete="new-password" required minLength={8} /></label>}
                {isLogin && <button type="button" className="auth-forgot" onClick={() => void handleForgotPassword()} disabled={loading}>Forgot password?</button>}
                <button type="submit" className="auth-submit" disabled={loading}>{loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}</button>
              </form>
              <div className="auth-divider"><span>or</span></div>
              <button type="button" className="auth-google" onClick={() => void handleGoogleSignIn()} disabled={loading}><Globe2 size={17} aria-hidden="true" /> Continue with Google</button>
              <p className="auth-provider-note">Use your Covenant University Google account. Personal Gmail accounts are not accepted.</p>
              <div className="auth-footnote">{isLogin ? "Don't have an account? " : 'Already have an account? '}<button type="button" onClick={switchMode}>{isLogin ? 'Sign up' : 'Sign in'}</button></div>
            </>
          )}
          {onPublicFeedback && <button type="button" className="auth-feedback-link" onClick={onPublicFeedback}>Having trouble signing in? <span>Send feedback</span></button>}
        </div>
      </section>
    </div>
  );
};
