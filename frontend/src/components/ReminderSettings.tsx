import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiGet, apiPost } from '../lib/api';

type ChannelState = {
  subscribed: boolean;
  status: string;
  consented_at?: string | null;
  unsubscribed_at?: string | null;
};

type Delivery = {
  id: number;
  channel: string;
  status: string;
  sent_at?: string | null;
  failure_code?: string | null;
};

type ReminderState = {
  enabled: boolean;
  channels: {
    email: ChannelState;
    browser_push: ChannelState;
  };
  delivery: Delivery[];
  dispatch: {
    enabled: boolean;
    cadence: string | null;
    scheduled_worker_required: boolean;
  };
};

const vapidPublicKey = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim();

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function decodeBase64Url(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export default function ReminderSettings() {
  const [state, setState] = useState<ReminderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<'email' | 'push' | 'unsubscribe' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await apiGet('/reminders') as ReminderState);
    } catch (loadError) {
      setError(errorText(loadError, 'Reminder settings could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const subscribeEmail = async () => {
    setWorking('email');
    setError('');
    setMessage('');
    try {
      await apiPost('/reminders/subscriptions', { channel: 'email' });
      setMessage('Email reminders are on. You can turn them off here at any time.');
      await load();
    } catch (requestError) {
      setError(errorText(requestError, 'Email reminders could not be enabled.'));
    } finally {
      setWorking(null);
    }
  };

  const subscribePush = async () => {
    setWorking('push');
    setError('');
    setMessage('');
    try {
      if (!vapidPublicKey) throw new Error('Browser reminders are not configured for this environment yet.');
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('This browser does not support browser reminders.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Browser reminder permission was not granted.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(vapidPublicKey),
      });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error('This browser returned an incomplete reminder subscription.');
      }
      await apiPost('/reminders/subscriptions', {
        channel: 'browser_push',
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      });
      setMessage('Browser reminders are on for this device.');
      await load();
    } catch (requestError) {
      setError(errorText(requestError, 'Browser reminders could not be enabled.'));
    } finally {
      setWorking(null);
    }
  };

  const unsubscribe = async (channel: 'email' | 'browser_push') => {
    setWorking(channel === 'email' ? 'email' : 'push');
    setError('');
    setMessage('');
    try {
      await apiDelete(`/reminders/subscriptions/${channel}`);
      if (channel === 'browser_push' && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        const subscription = await registration?.pushManager.getSubscription();
        await subscription?.unsubscribe();
      }
      setMessage(channel === 'email' ? 'Email reminders are off.' : 'Browser reminders are off for this device.');
      await load();
    } catch (requestError) {
      setError(errorText(requestError, 'The reminder subscription could not be changed.'));
    } finally {
      setWorking(null);
    }
  };

  const unsubscribeAll = async () => {
    setWorking('unsubscribe');
    setError('');
    setMessage('');
    try {
      await apiPost('/reminders/unsubscribe', {});
      setMessage('All study reminders are off.');
      await load();
    } catch (requestError) {
      setError(errorText(requestError, 'Reminders could not be turned off.'));
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="setting-block" aria-labelledby="settings-reminders-title">
      <p className="notes-label">Study reminders</p>
      <h2 className="notes-title" id="settings-reminders-title">Choose how ExamMind can check in</h2>
      <p className="setting-note">Reminders are optional, private to your account and easy to unsubscribe from. ExamMind never enables a channel without your consent.</p>
      {loading ? <p className="setting-note" role="status">Loading reminder settings...</p> : state && <>
        <div className="setting-row">
          <div className="setting-row-text"><span className="setting-row-title">Email reminders</span><span className="setting-row-body">Use your verified ExamMind email for occasional study activity reminders.</span></div>
          {state.channels.email.subscribed
            ? <button type="button" className="onboarding-back" onClick={() => void unsubscribe('email')} disabled={working !== null}>Turn off email</button>
            : <button type="button" className="account-link" onClick={() => void subscribeEmail()} disabled={working !== null}>Turn on email &rarr;</button>}
        </div>
        <div className="setting-row">
          <div className="setting-row-text"><span className="setting-row-title">Browser reminders</span><span className="setting-row-body">Allow this browser to show a reminder. Browser permission is requested only when you choose this.</span></div>
          {state.channels.browser_push.subscribed
            ? <button type="button" className="onboarding-back" onClick={() => void unsubscribe('browser_push')} disabled={working !== null}>Turn off browser</button>
            : <button type="button" className="account-link" onClick={() => void subscribePush()} disabled={working !== null}>Turn on browser &rarr;</button>}
        </div>
        {state.enabled && <button type="button" className="account-link" onClick={() => void unsubscribeAll()} disabled={working !== null}>Turn off all reminders &rarr;</button>}
        {state.delivery.length > 0 && <div className="setting-note" aria-label="Recent reminder delivery status"><strong>Recent delivery</strong><br />{state.delivery.slice(0, 3).map(item => <span key={item.id} style={{ display: 'block' }}>{item.channel.replace('_', ' ')} · {item.status}{item.failure_code ? ` (${item.failure_code})` : ''}</span>)}</div>}
        {!state.dispatch.enabled && <p className="setting-note">Delivery is being prepared. No messages are sent until the reminder schedule, provider and worker are configured.</p>}
      </>}
      {message && <p className="setting-note" role="status">{message}</p>}
      {error && <p className="onboarding-error" role="alert">{error}</p>}
    </section>
  );
}
