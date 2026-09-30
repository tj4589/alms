import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, MessageCircle, ShieldCheck } from 'lucide-react';
import { apiPost } from '../lib/api';
import type { LearningSpace, LearningSpacesResponse } from '../types';
import './LearningSpaces.css';

type Props = {
  spaces: LearningSpacesResponse | null;
  onBack: () => void;
  onOpenFeedback: () => void;
  onRefresh: () => Promise<LearningSpacesResponse | null>;
  onKsaVerified: (onboardingRequired: boolean, space: LearningSpace) => void;
};

function spaceTypeLabel(space: LearningSpace): string {
  return space.type === 'academy' ? 'Academy' : space.type === 'university' ? 'University' : 'Learning space';
}

export default function LearningSpaces({ spaces, onBack, onOpenFeedback, onRefresh, onKsaVerified }: Props) {
  const [ksaId, setKsaId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [earlyAccess, setEarlyAccess] = useState(false);

  const ksaMembership = spaces?.memberships.find(({ space }) => space.slug === 'ksa')?.space;
  const ksaSpace = ksaMembership || spaces?.available_spaces.find(space => space.slug === 'ksa') || null;
  const memberships = spaces?.memberships || [];

  const activate = async (slug: string) => {
    setBusy(slug);
    setError('');
    try {
      await apiPost('/learning-spaces/' + encodeURIComponent(slug) + '/activate', {});
      await onRefresh();
      onBack();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : 'That learning space could not be opened.');
    } finally {
      setBusy('');
    }
  };

  const verifyKsa = async () => {
    setBusy('ksa');
    setError('');
    try {
      const response = await apiPost('/learning-spaces/ksa/verify', { ksa_id: ksaId.trim() }) as { onboarding_required?: boolean };
      await onRefresh();
      onKsaVerified(Boolean(response.onboarding_required), ksaSpace || { id: 0, slug: 'ksa', name: 'Kora Sales Academy', type: 'academy', status: 'active' });
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'That KSA ID could not be verified.');
    } finally {
      setBusy('');
    }
  };

  if (earlyAccess) {
    return (
      <main className="page space-page">
        <button type="button" className="space-back" onClick={() => setEarlyAccess(false)}><ArrowLeft size={16} aria-hidden="true" /> Back to learning spaces</button>
        <section className="space-early-access" aria-labelledby="early-access-title">
          <div className="space-icon"><MessageCircle size={22} aria-hidden="true" /></div>
          <p className="space-kicker">Kora Sales Academy</p>
          <h1 id="early-access-title">KSA access is opening carefully.</h1>
          <p>ExamMind is verifying each KSA member before opening the academy space. If you are an intern or have been invited, contact support and we can help with access.</p>
          <div className="space-actions">
            <button type="button" className="space-primary" onClick={onOpenFeedback}>Contact support <ArrowRight size={17} aria-hidden="true" /></button>
            <button type="button" className="space-secondary" onClick={() => setEarlyAccess(false)}>I have a KSA ID</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page space-page" aria-labelledby="spaces-title">
      <button type="button" className="space-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back to my desk</button>
      <header className="space-heading">
        <div>
          <p className="space-kicker">ExamMind platform</p>
          <h1 id="spaces-title">Where do you want to learn?</h1>
          <p>Each learning space keeps its people, context and materials organised around the work you are doing there.</p>
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

      {ksaSpace && !ksaMembership && (
        <section className="space-join" aria-labelledby="join-ksa-title">
          <div>
            <p className="space-kicker">Kora Sales Academy</p>
            <h2 id="join-ksa-title">Are you a KSA intern?</h2>
            <p>Enter the academy ID provided to you. Each valid ID can be claimed by one ExamMind account.</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void verifyKsa(); }}>
            <label htmlFor="ksa-id">KSA ID</label>
            <div className="space-input-row"><input id="ksa-id" value={ksaId} onChange={(event) => setKsaId(event.target.value)} placeholder="Enter your academy ID" autoComplete="off" required /><button type="submit" className="space-primary" disabled={busy === 'ksa' || !ksaId.trim()}>{busy === 'ksa' ? <LoaderCircle size={16} className="space-spin" aria-hidden="true" /> : 'Claim KSA access'} <ArrowRight size={16} aria-hidden="true" /></button></div>
            <small>Use the KSA-## format. The claim is unique and does not prove official academy identity.</small>
          </form>
          <button type="button" className="space-early-link" onClick={() => setEarlyAccess(true)}>I am not a KSA intern / request early access</button>
        </section>
      )}
    </main>
  );
}
