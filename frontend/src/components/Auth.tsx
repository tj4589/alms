import React, { useState } from 'react';
import { apiFormPost, apiPost } from '../lib/api';

export const Auth = ({ onLogin }: { onLogin: (token: string) => void }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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

      await apiPost('/auth/register', { name, email, password, role: 'student' });

      setIsLogin(true);
      setPassword('');
      setName('');
      setSuccess('Account created. Sign in with your new details.');
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
    <div className="container animate-fade-in" style={{ padding: '4rem 1.5rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div className="glass-panel" style={{ padding: '3rem', maxWidth: '450px', width: '100%' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '2rem', color: 'var(--accent-primary)' }}>
          {isLogin ? 'Welcome Back' : 'Create Account'}
        </h2>

        {error && <div style={{ marginBottom: '1rem', color: 'var(--coral)', fontSize: '0.9rem', textAlign: 'center' }}>{error}</div>}
        {success && <div style={{ marginBottom: '1rem', color: 'var(--teal)', fontSize: '0.9rem', textAlign: 'center' }}>{success}</div>}
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!isLogin && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Full Name</label>
              <input 
                type="text" 
                value={name} 
                onChange={(e) => setName(e.target.value)}
                style={{
                  padding: '0.75rem', 
                  borderRadius: 'var(--radius-md)', 
                  border: '1px solid var(--border-color)',
                  background: 'var(--surface-color)',
                  color: 'var(--text-primary)'
                }}
                required
              />
            </div>
          )}
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)}
              style={{
                padding: '0.75rem', 
                borderRadius: 'var(--radius-md)', 
                border: '1px solid var(--border-color)',
                background: 'var(--surface-color)',
                color: 'var(--text-primary)'
              }}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)}
              style={{
                padding: '0.75rem', 
                borderRadius: 'var(--radius-md)', 
                border: '1px solid var(--border-color)',
                background: 'var(--surface-color)',
                color: 'var(--text-primary)'
              }}
              required
            />
          </div>

          <button type="submit" className="btn-primary" style={{ marginTop: '1rem', width: '100%' }} disabled={loading}>
            {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Sign Up'}
          </button>
        </form>

        <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button 
            onClick={switchMode}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'var(--accent-primary)', 
              cursor: 'pointer',
              fontWeight: '500'
            }}>
            {isLogin ? 'Sign up here' : 'Sign in here'}
          </button>
        </div>
      </div>
    </div>
  );
};
