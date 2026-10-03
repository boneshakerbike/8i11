/**
 * Login page with GitHub OAuth and Guest PIN options
 */

'use client';

import { signIn } from 'next-auth/react';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { sign_in_error_message } from '@/lib/auth_errors';

function LoginForm() {
  const [pin, set_pin] = useState('');
  const [error, set_error] = useState('');
  const [loading, set_loading] = useState(false);
  const search_params = useSearchParams();
  const callback_url = search_params.get('callbackUrl') ?? '/';
  const oauth_error = search_params.get('error');
  const oauth_message = sign_in_error_message(oauth_error);
  const is_preview = process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';

  const handle_pin_submit = async (e: React.FormEvent) => {
    e.preventDefault();
    set_loading(true);
    set_error('');

    const result = await signIn('guest-pin', {
      pin,
      redirect: false,
      callbackUrl: callback_url,
    });

    if (result?.error) {
      set_error('Invalid PIN');
      set_loading(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  const handle_admin_pin = async () => {
    set_loading(true);
    set_error('');

    const result = await signIn('admin-pin', {
      pin,
      redirect: false,
      callbackUrl: callback_url,
    });

    if (result?.error) {
      set_error('Invalid Admin PIN');
      set_loading(false);
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  const handle_github = () => {
    set_loading(true);
    signIn('github', { callbackUrl: callback_url });
  };

  return (
    <div
      style={{
        backgroundColor: '#16213e',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center',
      }}
    >
      {is_preview && (
        <div
          style={{
            backgroundColor: '#ff9800',
            color: '#000',
            padding: '8px 12px',
            borderRadius: '6px',
            marginBottom: '20px',
            fontSize: '13px',
            fontWeight: '600',
          }}
        >
          Preview Environment - Admin PIN Available
        </div>
      )}
      <h1
        style={{
          color: '#e2e2e2',
          marginBottom: '8px',
          fontSize: '28px',
        }}
      >
        On This Day
      </h1>
      <p
        style={{
          color: '#bbb',
          marginBottom: oauth_error ? '16px' : '32px',
          fontSize: '14px',
        }}
      >
        Sign in to continue
      </p>

      {oauth_error && (
        <div
          style={{
            color: '#ff6b6b',
            fontSize: '13px',
            marginBottom: '24px',
            padding: '10px 16px',
            backgroundColor: 'rgba(255, 107, 107, 0.1)',
            borderRadius: '6px',
            textAlign: 'left',
          }}
        >
          <p style={{ margin: 0 }}>{oauth_message.text}</p>
          {oauth_message.retryable && (
            <p style={{ margin: '8px 0 0', color: '#bbb' }}>
              If it keeps failing, try opening{' '}
              <a href="https://8i11.vercel.app" style={{ color: '#00d9ff', textDecoration: 'none' }}>
                8i11.vercel.app
              </a>
              {' '}directly in your browser rather than an in-app one.
            </p>
          )}
          <p style={{ margin: '8px 0 0', color: '#888', fontSize: '11px' }}>
            Error code: <code>{oauth_error}</code>
          </p>
        </div>
      )}

      <button
        onClick={handle_github}
        disabled={loading}
        style={{
          width: '100%',
          padding: '12px 20px',
          fontSize: '16px',
          backgroundColor: '#24292e',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          opacity: loading ? 0.7 : 1,
        }}
      >
        <svg
          height="20"
          width="20"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        Sign in with GitHub
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          margin: '24px 0',
          color: '#aaa',
        }}
      >
        <div style={{ flex: 1, height: '1px', backgroundColor: '#333' }} />
        <span style={{ padding: '0 16px', fontSize: '14px' }}>or</span>
        <div style={{ flex: 1, height: '1px', backgroundColor: '#333' }} />
      </div>

      <form onSubmit={handle_pin_submit}>
        <div style={{ marginBottom: '16px' }}>
          <input
            type="password"
            value={pin}
            onChange={(e) => set_pin(e.target.value)}
            placeholder="Guest PIN"
            disabled={loading}
            style={{
              width: '100%',
              padding: '12px 16px',
              fontSize: '16px',
              backgroundColor: '#1a1a2e',
              color: '#e2e2e2',
              border: '1px solid #333',
              borderRadius: '6px',
              textAlign: 'center',
              letterSpacing: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <p
            style={{
              color: '#ff6b6b',
              fontSize: '14px',
              marginBottom: '16px',
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !pin}
          style={{
            width: '100%',
            padding: '12px 20px',
            fontSize: '16px',
            backgroundColor: '#0f3460',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: loading || !pin ? 'not-allowed' : 'pointer',
            opacity: loading || !pin ? 0.7 : 1,
          }}
        >
          Enter as Guest
        </button>

        {is_preview && (
          <button
            type="button"
            onClick={handle_admin_pin}
            disabled={loading || !pin}
            style={{
              width: '100%',
              padding: '12px 20px',
              fontSize: '16px',
              backgroundColor: '#ff9800',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              cursor: loading || !pin ? 'not-allowed' : 'pointer',
              opacity: loading || !pin ? 0.7 : 1,
              marginTop: '12px',
              fontWeight: '600',
            }}
          >
            Enter as Admin
          </button>
        )}
      </form>

      <p
        style={{
          marginTop: '24px',
          fontSize: '13px',
          color: '#aaa',
        }}
      >
        Just browsing?{' '}
        <a href="/creative/archive" style={{ color: '#00d9ff', textDecoration: 'none' }}>Stories</a>
        {' and '}
        <a href="/games/frogger" style={{ color: '#00d9ff', textDecoration: 'none' }}>Games</a>
        {' are free to explore.'}
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#1a1a2e',
        padding: '20px',
      }}
    >
      <Suspense fallback={<div style={{ color: '#bbb' }}>Loading...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
