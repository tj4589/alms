import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Clock3, Link2, LoaderCircle, Users } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import './GroupInvite.css';

type InvitePreview = {
  invite: { expires_at: string | null; remaining_uses: number | null };
  group: {
    id: number;
    name: string;
    description: string | null;
    topic: string | null;
    visibility: string;
    member_count: number;
    course: { code: string; name: string } | null;
  };
};

export default function GroupInvite({
  token,
  authenticated,
  onBack,
  onSignIn,
  onOpenGroups,
}: {
  token: string;
  authenticated: boolean;
  onBack: () => void;
  onSignIn: () => void;
  onOpenGroups: () => void;
}) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet(`/community/group-invites/${encodeURIComponent(token)}`)
      .then((data) => { if (!cancelled) setPreview(data as InvitePreview); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'This invitation is no longer available.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    if (joining) return;
    setJoining(true);
    setError('');
    try {
      await apiPost(`/community/group-invites/${encodeURIComponent(token)}/accept`, {});
      setJoined(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not join this group. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <main className="group-invite-page">
      <div className="group-invite-shell">
        <button type="button" className="group-invite-back" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> Back to ExamMind</button>
        <div className="group-invite-mark"><Link2 size={18} aria-hidden="true" /> Secure group invitation</div>
        {loading && <div className="group-invite-state"><LoaderCircle className="group-invite-spin" size={22} /><p>Opening the invitation…</p></div>}
        {!loading && error && <div className="group-invite-state is-error"><h1>This invitation is unavailable.</h1><p>{error}</p><button type="button" className="group-invite-button group-invite-button--quiet" onClick={onBack}>Return home</button></div>}
        {!loading && !error && preview && !joined && (
          <section className="group-invite-card" aria-labelledby="group-invite-title">
            <div className="group-invite-icon"><Users size={25} aria-hidden="true" /></div>
            <p className="group-invite-eyebrow">You’re invited to study together</p>
            <h1 id="group-invite-title">{preview.group.name}</h1>
            {preview.group.course && <p className="group-invite-course">{preview.group.course.code} · {preview.group.course.name}</p>}
            {preview.group.topic && <span className="group-invite-topic">{preview.group.topic}</span>}
            <p className="group-invite-description">{preview.group.description || 'A focused ExamMind space for questions, materials, and showing up together.'}</p>
            <div className="group-invite-meta"><span><Users size={15} aria-hidden="true" /> {preview.group.member_count} member{preview.group.member_count === 1 ? '' : 's'}</span><span><Clock3 size={15} aria-hidden="true" /> Secure invite</span></div>
            {authenticated ? <button type="button" className="group-invite-button" onClick={() => void accept()} disabled={joining}>{joining ? <><LoaderCircle className="group-invite-spin" size={17} /> Joining…</> : <>Join this group <ArrowRight size={17} aria-hidden="true" /></>}</button> : <button type="button" className="group-invite-button" onClick={onSignIn}>Sign in to join <ArrowRight size={17} aria-hidden="true" /></button>}
            <p className="group-invite-note">Only authenticated students can see the group workspace.</p>
          </section>
        )}
        {!loading && !error && joined && <div className="group-invite-state is-success"><div className="group-invite-icon"><Users size={25} aria-hidden="true" /></div><p className="group-invite-eyebrow">You’re in</p><h1>Welcome to {preview?.group.name}.</h1><p>Your group is ready. Open Study Groups when you’re ready to get started.</p><button type="button" className="group-invite-button" onClick={onOpenGroups}>Open Study Groups <ArrowRight size={17} aria-hidden="true" /></button></div>}
      </div>
    </main>
  );
}
