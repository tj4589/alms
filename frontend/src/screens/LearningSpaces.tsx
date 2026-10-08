import { useState } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react';
import { apiPost } from '../lib/api';
import type { LearningSpace, LearningSpacesResponse } from '../types';
import './LearningSpaces.css';

type Props = {
  spaces: LearningSpacesResponse | null;
  onOpenFeedback: () => void;
  onRefresh: () => Promise<LearningSpacesResponse | null>;
  onKsaVerified: (onboardingRequired: boolean, space: LearningSpace) => void;
  onLogout?: () => void;
  entryMode?: 'first_access';
};

export default function LearningSpaces({ spaces, onOpenFeedback, onRefresh, onKsaVerified, onLogout }: Props) {
  const [ksaId, setKsaId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [earlyAccessStatus, setEarlyAccessStatus] = useState<'idle' | 'saving' | 'requested'>('idle');
  const [firstAccessStage, setFirstAccessStage] = useState<'decision' | 'claim' | 'early_access'>('decision');

  const ksaSpace = spaces?.available_spaces.find(space => space.slug === 'ksa') || null;

  const verifyKsa = async () => {
    setBusy('ksa');
    setError('');
    const candidate = ksaId.trim();
    if (!/^KSA-\d{2}$/i.test(candidate)) {
      setError('Check your academy ID and try again.');
      setBusy('');
      return;
    }
    try {
      const response = await apiPost('/learning-spaces/ksa/verify', { ksa_id: candidate }) as { onboarding_required?: boolean };
      const refreshed = await onRefresh();
      const refreshedKsa = refreshed?.memberships.find(({ space }) => space.slug === 'ksa')?.space;
      if (!refreshed || !refreshedKsa) {
        setError('Your KSA access was saved, but we could not reload the learning space. Please try again.');
        return;
      }
      onKsaVerified(Boolean(refreshedKsa.membership?.onboarding_required ?? response.onboarding_required), refreshedKsa);
    } catch (verifyError) {
      const message = verifyError instanceof Error ? verifyError.message : '';
      const lowered = message.toLowerCase();
      if (lowered.includes('already configured')) {
        const refreshed = await onRefresh();
        const refreshedKsa = refreshed?.memberships.find(({ space }) => space.slug === 'ksa')?.space;
        if (refreshed && refreshedKsa) {
          onKsaVerified(Boolean(refreshedKsa.membership?.onboarding_required), refreshedKsa);
          return;
        }
      }
      if (lowered.includes('already in use')) {
        setError('This academy ID is already in use. Contact support if you believe it belongs to you.');
      } else if (lowered.includes('unprocessable') || lowered.includes('format') || lowered.includes('academy id')) {
        setError('Check your academy ID and try again.');
      } else {
        setError(message || 'We could not verify that ID right now. Please try again.');
      }
    } finally {
      setBusy('');
    }
  };

  const requestEarlyAccess = async () => {
    setBusy('early-access');
    setError('');
    try {
      await apiPost('/learning-spaces/early-access-requests', {});
      setEarlyAccessStatus('requested');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'We could not save your access request. Please try again.');
    } finally {
      setBusy('');
    }
  };

  const showEarlyAccess = firstAccessStage === 'early_access';

  if (firstAccessStage === 'decision') {
    return (
      <main className="page space-page access-gate" aria-labelledby="access-gate-title">
        <header className="space-heading access-gate-heading">
          <div>
            <p className="space-kicker">Welcome to ExamMind</p>
            <h1 id="access-gate-title">How will you learn with us?</h1>
            <p>ExamMind is opening its first learning spaces carefully. Tell us which path fits you so we can show the right next step.</p>
          </div>
          <ShieldCheck size={36} strokeWidth={1.4} aria-hidden="true" />
        </header>
        <section className="access-gate-choice" aria-labelledby="access-gate-question">
          <p className="space-kicker">One quick question</p>
          <h2 id="access-gate-question">Are you a Kora Sales Academy intern?</h2>
          <p>Yes takes you to a secure academy-ID check. No keeps your account in early access until another learning space is available.</p>
          <div className="space-actions">
            <button type="button" className="space-primary" onClick={() => { setError(''); setFirstAccessStage('claim'); }}>Yes, continue to KSA access <ArrowRight size={17} aria-hidden="true" /></button>
            <button type="button" className="space-secondary" onClick={() => { setError(''); setFirstAccessStage('early_access'); }}>No, request early access</button>
          </div>
          {onLogout && <button type="button" className="space-signout" onClick={onLogout}>Sign out</button>}
        </section>
      </main>
    );
  }

  if (showEarlyAccess) {
    return (
      <main className="page space-page">
        <button type="button" className="space-back" onClick={() => setFirstAccessStage('decision')}><ArrowLeft size={16} aria-hidden="true" /> Back to access options</button>
        <section className="space-early-access" aria-labelledby="early-access-title">
          <div className="space-icon"><MessageCircle size={22} aria-hidden="true" /></div>
          <p className="space-kicker">ExamMind early access</p>
          <h1 id="early-access-title">Your learning space is not open yet.</h1>
          <p>ExamMind is currently available to selected learning communities. If you are a KSA intern or have been invited, contact support and we can help with access.</p>
          {earlyAccessStatus === 'requested' ? <div className="space-success" role="status">Your early-access request was saved. We’ll review it and contact you through your account.</div> : <div className="space-actions">
            <button type="button" className="space-primary" onClick={() => void requestEarlyAccess()} disabled={busy === 'early-access'}>{busy === 'early-access' ? 'Saving request…' : 'Request early access'} <ArrowRight size={17} aria-hidden="true" /></button>
            <button type="button" className="space-secondary" onClick={onOpenFeedback}>Contact support</button>
            <button type="button" className="space-secondary" onClick={() => setFirstAccessStage('claim')}>I have a KSA ID</button>
          </div>}
          {onLogout && <button type="button" className="space-signout" onClick={onLogout}>Sign out</button>}
        </section>
      </main>
    );
  }

  return (
    <main className="page space-page" aria-labelledby="spaces-title">
      <button type="button" className="space-back" onClick={() => setFirstAccessStage('decision')}><ArrowLeft size={16} aria-hidden="true" /> Back to access options</button>
      <header className="space-heading">
        <div>
          <p className="space-kicker">ExamMind platform</p>
          <h1 id="spaces-title">Verify your KSA access</h1>
          <p>Enter the academy ID provided to you. Your claim is checked before any learning space opens.</p>
        </div>
        <ShieldCheck size={36} strokeWidth={1.4} aria-hidden="true" />
      </header>

      {error && <div className="space-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span></div>}

      {ksaSpace && (
        <section className="space-join" aria-labelledby="join-ksa-title">
          <div>
            <p className="space-kicker">Kora Sales Academy</p>
            <h2 id="join-ksa-title">Verify your KSA access</h2>
            <p>Enter the academy ID provided to you. Each valid ID can be claimed by one ExamMind account.</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void verifyKsa(); }}>
            <label htmlFor="ksa-id">KSA ID</label>
            <div className="space-input-row"><input id="ksa-id" value={ksaId} onChange={(event) => setKsaId(event.target.value)} placeholder="Enter your academy ID" autoComplete="off" required aria-invalid={Boolean(error)} /><button type="submit" className="space-primary" disabled={busy === 'ksa' || !ksaId.trim()}>{busy === 'ksa' ? <LoaderCircle size={16} className="space-spin" aria-hidden="true" /> : 'Claim KSA access'} <ArrowRight size={16} aria-hidden="true" /></button></div>
            <small>Use the KSA-## format. The claim is unique and does not prove official academy identity.</small>
          </form>
          <button type="button" className="space-early-link" onClick={() => setFirstAccessStage('early_access')}>I am not a KSA intern / request early access</button>
        </section>
      )}
      {onLogout && <button type="button" className="space-signout" onClick={onLogout}>Sign out</button>}
    </main>
  );
}
