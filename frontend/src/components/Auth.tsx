import { Suspense, lazy, useState } from 'react';
import { apiFormPost, apiPost } from '../lib/api';

const AuthScene3D = lazy(() => import('./AuthScene3D'));

type AuthProps = {
  onLogin: (token: string) => void;
  onBackToLanding?: () => void;
  initialMode?: 'login' | 'register';
};

export const Auth = ({ onLogin, onBackToLanding, initialMode = 'register' }: AuthProps) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isLogin) {
        const body = new URLSearchParams();
        body.set('username', email);
        body.set('password', password);

        const data = await apiFormPost('/auth/login', body);
        if (!data.access_token) {
          throw new Error('Login response did not include an access token.');
        }

        onLogin(data.access_token);
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

      onLogin(data.access_token);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsLogin((current) => !current);
    setError('');
    setSuccess('');
  };

  return (
    <div className="auth-page">
      <Suspense fallback={<div className="auth-scene3d auth-scene-loading" aria-hidden="true" />}>
        <AuthScene3D />
      </Suspense>
      <button className="auth-back" onClick={onBackToLanding} type="button">
        Back to overview
      </button>
      <section className="auth-shell">
        <div className="auth-panel">
          <div className="auth-kicker">Authenticated student access</div>
          <h1>{isLogin ? 'Welcome back to ExamMind.' : 'Create your student workspace.'}</h1>
          <p>
            Upload academic materials, search your archive, ask grounded AI questions, and build
            practice sessions from the documents you add.
          </p>
          <div className="auth-proof-list">
            <span>Secure JWT login</span>
            <span>Student-focused dashboard</span>
            <span>Private progress tracking</span>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo">E</div>
            <div>
              <div className="auth-brand-name">Exam<span>Mind</span></div>
              <div className="auth-brand-sub">Academic Excellence</div>
            </div>
          </div>

          <div className="auth-switch">
            <button className={isLogin ? 'on' : ''} type="button" onClick={() => setIsLogin(true)}>Sign in</button>
            <button className={!isLogin ? 'on' : ''} type="button" onClick={() => setIsLogin(false)}>Create account</button>
          </div>

        {error && (
          <div className="upload-alert" style={{ marginBottom: 16 }}>{error}</div>
        )}
        {success && (
          <div style={{
            background: 'var(--teal2)',
            border: '1px solid rgba(62,207,178,0.25)',
            color: 'var(--teal)',
            borderRadius: 'var(--r)',
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 12.5,
          }}>{success}</div>
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
              required
              minLength={8}
            />
          </label>

          <button
            type="submit"
            className="cta"
            style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 13.5, marginTop: 4 }}
            disabled={loading}
          >
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="auth-footnote">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={switchMode}
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
      </section>
    </div>
  );
};
