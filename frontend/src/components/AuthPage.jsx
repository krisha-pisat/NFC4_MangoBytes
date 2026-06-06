import React, { useState } from 'react';
import axios from 'axios';
import './AuthPage.css';

const AuthPage = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!form.username.trim()) return setError('Username is required.');
      if (form.password !== form.confirm) return setError('Passwords do not match.');
    }

    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload  = mode === 'login'
        ? { email: form.email, password: form.password }
        : { email: form.email, username: form.username, password: form.password };

      const res = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}${endpoint}`,
        payload
      );

      onAuthSuccess({
        token:    res.data.token,
        username: res.data.username,
        email:    res.data.email,
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setForm({ username: '', email: '', password: '', confirm: '' });
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">📚</span>
          <h1 className="auth-app-name">Document Intelligence Hub</h1>
          <p className="auth-tagline">Analyze documents. Ask questions. Get answers.</p>
        </div>

        <div className="auth-tabs">
          <button
            className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
            type="button"
          >
            Log In
          </button>
          <button
            className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
            type="button"
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="auth-field">
              <label>Username</label>
              <input
                type="text"
                name="username"
                placeholder="Your display name"
                value={form.username}
                onChange={handleChange}
                required
                autoComplete="username"
              />
            </div>
          )}

          <div className="auth-field">
            <label>Email</label>
            <input
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <label>Password</label>
            <input
              type="password"
              name="password"
              placeholder={mode === 'register' ? 'At least 6 characters' : 'Your password'}
              value={form.password}
              onChange={handleChange}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>

          {mode === 'register' && (
            <div className="auth-field">
              <label>Confirm Password</label>
              <input
                type="password"
                name="confirm"
                placeholder="Repeat your password"
                value={form.confirm}
                onChange={handleChange}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? (
              <span className="auth-spinner"></span>
            ) : (
              mode === 'login' ? 'Log In' : 'Create Account'
            )}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" className="auth-switch-btn" onClick={switchMode}>
            {mode === 'login' ? 'Register' : 'Log In'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default AuthPage;
