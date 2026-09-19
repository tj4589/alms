import { useState } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Search, Sparkles, Users } from 'lucide-react';
import Logo from './Logo';
import { apiFormPost, apiPost } from '../lib/api';
import {
  DEV_AUTH_ENABLED,
  DEV_AUTH_TOKEN,
  validateDevAuthPass,
} from '../lib/devAuth';

type AuthProps = {
  onLogin: (token: string) => void | Promise<void>;
  onBackToLanding?: () => void;
  initialMode?: 'login' | 'register';
};

export const Auth = ({ onLogin, onBackToLanding, initialMode = 'register' }: AuthProps) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [devPass, setDevPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [devError, setDevError] = useState('');

  const handleSubmit = async () => {
    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError('');
    setDevError('');

    try {
      if (isLogin) {
        const body = new URLSearchParams();
        body.set('username', email);
        body.set('password', password);

        const data = await apiFormPost('/auth/login', body);
        if (!data.access_token) {
          throw new Error('Login response did not include an access token.');
        }

        await onLogin(data.access_token);
        return;
      }

      await apiPost('/auth/register', { name, username: username.toLowerCase(), email, password });

      const body = new URLSearchParams();
      body.set('username', email);
      body.set('password', password);

      const data = await apiFormPost('/auth/login', body);
      if (!data.access_token) {
        throw new Error('Account created, but automatic sign-in failed. Please sign in with your new details.');
      }

      await onLogin(data.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDevAccess = async () => {
    setDevError('');

    if (!validateDevAuthPass(devPass)) {
      setDevError('The development pass is incorrect.');
      return;
    }

    setLoading(true);
    try {
      await onLogin(DEV_AUTH_TOKEN);
    } catch {
      setDevError('Developer access could not be started.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin((current) => !current);
    setError('');
    setDevError('');
    setDevPass('');
    setConfirmPassword('');
  };

  return (
    <div className="auth-page">
      <div className="auth-grain" aria-hidden="true" />
      <header className="auth-topbar">
        <button className="auth-back" onClick={onBackToLanding} type="button">
          <ArrowLeft aria-hidden="true" size={18} />
          Back to overview
        </button>
        <button className="auth-top-brand" onClick={onBackToLanding} type="button" aria-label="Return to ExamMind home">
          <span className="auth-top-brand-mark" aria-hidden="true"><Logo size={24} /></span>
          <span>Exam<span>Mind.</span></span>
        </button>
        <span className="auth-top-note">Student workspace</span>
      </header>
      <section className="auth-shell">
        <div className="auth-panel">
          <div className="auth-kicker"><span className="auth-kicker-dot" aria-hidden="true" />A clearer way to study</div>
          <h1>{isLogin ? <>Good to see you <em>again.</em></> : <>Make room for your next <em>breakthrough.</em></>}</h1>
          <p>{isLogin ? 'Pick up where you left off. Your notes, questions, and next study session are waiting.' : 'Bring your course material together, then study with more context and less hunting.'}</p>
          <div className="auth-proof-list">
            <span><Search aria-hidden="true" size={15} />Search your notes</span>
            <span><Users aria-hidden="true" size={15} />Study with your people</span>
            <span><Sparkles aria-hidden="true" size={15} />Practice with purpose</span>
          </div>
          <div className="auth-visual" aria-label="Students collaborating in a reading room">
            <img src="/images/landing/reading-room-study.jpg" alt="Two students studying together with a laptop and open books" width="1600" height="1067" />
            <div className="auth-visual-overlay" />
            <div className="auth-visual-caption">
              <span>A small study circle</span>
              <strong>One question.<br /><em>A shared discovery.</em></strong>
              <div><i>A</i><i>T</i><i>Z</i><small>3 classmates in a reading room</small></div>
            </div>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-card-heading">
            <span className="auth-card-eyebrow">{isLogin ? 'Welcome back' : 'Start with your material'}</span>
            <h2>{isLogin ? 'Sign in to your desk.' : 'Create your workspace.'}</h2>
            <p>{isLogin ? 'Your archive and study groups are right where you left them.' : 'A private place for your notes, questions, and next breakthrough.'}</p>
          </div>

          <div className="auth-switch" role="tablist" aria-label="Account access">
            <button className={isLogin ? 'on' : ''} role="tab" aria-selected={isLogin} type="button" onClick={() => setIsLogin(true)}>Sign in</button>
            <button className={!isLogin ? 'on' : ''} role="tab" aria-selected={!isLogin} type="button" onClick={() => setIsLogin(false)}>Create account</button>
          </div>

        {error && (
          <div className="upload-alert auth-error" role="alert">{error}</div>
        )}

        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}>
          {!isLogin && (
            <>
              <label className="auth-field">
                <span>Full Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  autoComplete="name"
                  required
                  minLength={2}
                />
              </label>

              <label className="auth-field">
                <span>Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="e.g. vera_csc301"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={24}
                />
                <small>
                  3-24 characters - lowercase letters, numbers, underscores
                </small>
              </label>
            </>
          )}

          <label className="auth-field">
            <span>{isLogin ? 'Email Address' : 'School Email'}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isLogin ? 'your@email.com' : 'yourname@stu.cu.edu.ng'}
              autoComplete="email"
              required
            />
            {!isLogin && (
              <small>
                Use your school email. ExamMind is currently available for Covenant University students.
              </small>
            )}
          </label>

          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isLogin ? 'Your password' : 'Minimum 8 characters'}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              required
              minLength={8}
            />
          </label>

          {!isLogin && (
            <label className="auth-field">
              <span>Confirm Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
                minLength={8}
              />
            </label>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={loading}
          >
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-footnote">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={switchMode}
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </div>

        {DEV_AUTH_ENABLED && (
          <div className="auth-dev-access">
            <div className="auth-dev-heading">
              <label htmlFor="development-pass">
                <span>Developer access</span>
                <small>Local environment only</small>
              </label>
              <span className="auth-dev-mode">DEV</span>
            </div>
            {devError && (
              <div className="auth-dev-error" role="alert">{devError}</div>
            )}
            <form
              className="auth-dev-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handleDevAccess();
              }}
            >
              <KeyRound aria-hidden="true" />
              <input
                id="development-pass"
                type="password"
                value={devPass}
                onChange={(event) => setDevPass(event.target.value)}
                placeholder="Development pass"
                autoComplete="off"
                required
              />
              <button
                type="submit"
                aria-label="Enter developer workspace"
                title="Enter developer workspace"
                disabled={loading}
              >
                <ArrowRight aria-hidden="true" />
              </button>
            </form>
          </div>
        )}
      </div>
      </section>
    </div>
  );
};
