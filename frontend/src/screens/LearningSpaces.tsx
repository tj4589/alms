import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react';
import { apiPost } from '../lib/api';
import type { LearningSpace, LearningSpacesResponse } from '../types';
import './LearningSpaces.css';

type Props = {
  spaces: LearningSpacesResponse | null;
  onBack?: () => void;
  onOpenFeedback: () => void;
  onRefresh: () => Promise<LearningSpacesResponse | null>;
  onKsaVerified: (onboardingRequired: boolean, space: LearningSpace) => void;
  onLogout?: () => void;
  entryMode?: 'manage' | 'first_access' | 'selection';
};

function spaceTypeLabel(space: LearningSpace): string {
  return space.type === 'academy' ? 'Academy' : space.type === 'university' ? 'University' : 'Learning space';
}

export default function LearningSpaces({ spaces, onBack, onOpenFeedback, onRefresh, onKsaVerified, onLogout, entryMode = 'manage' }: Props) {
  const [ksaId, setKsaId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [earlyAccess, setEarlyAccess] = useState(false);
  const [firstAccessStage, setFirstAccessStage] = useState<'decision' | 'claim' | 'early_access'>('decision');

  const ksaMembership = spaces?.memberships.find(({ space }) => space.slug === 'ksa')?.space;
  const ksaSpace = ksaMembership || spaces?.available_spaces.find(space => space.slug === 'ksa') || null;
  const memberships = spaces?.memberships || [];
  const isFirstAccess = entryMode === 'first_access';
  const isSelection = entryMode === 'selection';

  const activate = async (slug: string) => {
    setBusy(slug);
    setError('');
    try {
      await apiPost('/learning-spaces/' + encodeURIComponent(slug) + '/activate', {});
      await onRefresh();
      onBack?.();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : 'That learning space could not be opened.');
    } finally {
      setBusy('');
    }
  };

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

  const showEarlyAccess = isFirstAccess ? firstAccessStage === 'early_access' : earlyAccess;

  if (isFirstAccess && firstAccessStage === 'decision') {
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
        <button type="button" className="space-back" onClick={() => isFirstAccess ? setFirstAccessStage('decision') : setEarlyAccess(false)}><ArrowLeft size={16} aria-hidden="true" /> {isFirstAccess ? 'Back to access options' : 'Back to learning spaces'}</button>
        <section className="space-early-access" aria-labelledby="early-access-title">
          <div className="space-icon"><MessageCircle size={22} aria-hidden="true" /></div>
          <p className="space-kicker">ExamMind early access</p>
          <h1 id="early-access-title">Your learning space is not open yet.</h1>
          <p>ExamMind is currently available to selected learning communities. If you are a KSA intern or have been invited, contact support and we can help with access.</p>
          <div className="space-actions">
            <button type="button" className="space-primary" onClick={onOpenFeedback}>Contact support <ArrowRight size={17} aria-hidden="true" /></button>
            <button type="button" className="space-secondary" onClick={() => isFirstAccess ? setFirstAccessStage('claim') : setEarlyAccess(false)}>I have a KSA ID</button>
          </div>
          {onLogout && <button type="button" className="space-signout" onClick={onLogout}>Sign out</button>}
        </section>
      </main>
    );
  }

  return (
    <main className="page space-page" aria-labelledby="spaces-title">
      {!isSelection && <button type="button" className="space-back" onClick={() => isFirstAccess ? setFirstAccessStage('decision') : onBack?.()}><ArrowLeft size={16} aria-hidden="true" /> {isFirstAccess ? 'Back to access options' : 'Back to my desk'}</button>}
      <header className="space-heading">
        <div>
          <p className="space-kicker">ExamMind platform</p>
          <h1 id="spaces-title">{isSelection ? 'Choose where to continue' : isFirstAccess ? 'Verify your KSA access' : 'Where do you want to learn?'}</h1>
          <p>{isSelection ? 'Choose one of your verified learning spaces. Your memberships stay intact when you switch.' : isFirstAccess ? 'Enter the academy ID provided to you. Your claim is checked before any learning space opens.' : 'Each learning space keeps its people, context and materials organised around the work you are doing there.'}</p>
        </div>
        <ShieldCheck size={36} strokeWidth={1.4} aria-hidden="true" />
      </header>

      {error && <div className="space-error" role="alert"><CircleAlert size={17} aria-hidden="true" /><span>{error}</span></div>}

      <section className="space-list" aria-label="Your learning spaces">
        {memberships.map(({ space }) => (
          <article className={'space-card' + (space.slug === spaces?.active_space?.slug ? ' is-active' : '')} key={space.slug}>
            <div className="space-card-top"><span className="space-card-type">{spaceTypeLabel(space)}</span>{space.slug === spaces?.active_space?.slug && <span className="space-active"><CheckCircle2 size={15} aria-hidden="true" /> Active</span>}</div>
            <h2>{space.name}</h2>
            <p>{space.description}</p>
            <button type="button" className="space-card-action" onClick={() => void activate(space.slug)} disabled={Boolean(busy)}>
              {busy === space.slug ? <LoaderCircle size={16} className="space-spin" aria-hidden="true" /> : null}
              {space.slug === spaces?.active_space?.slug ? 'Continue here' : 'Open this space'} <ArrowRight size={16} aria-hidden="true" />
            </button>
          </article>
        ))}
      </section>

      {ksaSpace && !ksaMembership && !isSelection && (
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
          <button type="button" className="space-early-link" onClick={() => isFirstAccess ? setFirstAccessStage('early_access') : setEarlyAccess(true)}>I am not a KSA intern / request early access</button>
        </section>
      )}
      {onLogout && isSelection && <button type="button" className="space-signout space-selection-signout" onClick={onLogout}>Sign out</button>}
    </main>
  );
}
