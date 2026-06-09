import { useState } from 'react';
import { apiFormPost, apiPost } from '../lib/api';

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r)',
  padding: '10px 12px',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color .2s',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '.5px',
};

export const Auth = ({ onLogin }: { onLogin: (token: string) => void }) => {
  const [isLogin, setIsLogin] = useState(false);
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

      await apiPost('/auth/register', { name, username: username.toLowerCase(), email, password, role: 'student' });

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
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--rlg)',
        padding: '36px 32px',
      }}>

        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 42,
            height: 42,
            background: 'var(--gold)',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--serif)',
            fontSize: 24,
            color: '#0c0d11',
            fontStyle: 'italic',
            margin: '0 auto 12px',
          }}>E</div>
          <div style={{ fontFamily: 'var(--serif)', fontSize: 22, letterSpacing: '-.2px' }}>
            Exam<span style={{ color: 'var(--gold)' }}>Mind</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 4 }}>
            {isLogin ? 'Sign in to your account' : 'Create your upload account'}
          </div>
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

        <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isLogin && (
            <>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>Full Name</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={inputStyle}
                  placeholder="Your full name"
                  required
                  minLength={2}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  style={inputStyle}
                  placeholder="e.g. vera_csc301"
                  required
                  minLength={3}
                  maxLength={24}
                />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  3-24 characters - lowercase letters, numbers, underscores
                </span>
              </label>
            </>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={labelStyle}>{isLogin ? 'Email Address' : 'School Email'}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder={isLogin ? 'your@email.com' : 'yourname@stu.cu.edu.ng'}
              required
            />
            {!isLogin && (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                Use your school email. ExamMind is currently available for Covenant University students.
              </span>
            )}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={labelStyle}>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
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
            {loading ? 'Please wait...' : isLogin ? 'Sign In ->' : 'Create Account ->'}
          </button>
        </form>

        <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={switchMode}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--gold)',
              cursor: 'pointer',
              fontWeight: 600,
              fontFamily: 'var(--font)',
              fontSize: 13,
              padding: 0,
            }}
          >
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
};
