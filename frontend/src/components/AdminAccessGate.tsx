import { LockKeyhole } from 'lucide-react';
import Logo from './Logo';
import './AdminAccessGate.css';

type AdminAccessGateProps = {
  onReturnToWorkspace: () => void;
  onUseAnotherAccount: () => void;
};

export default function AdminAccessGate({ onReturnToWorkspace, onUseAnotherAccount }: AdminAccessGateProps) {
  return (
    <main className="admin-access-page" data-testid="admin-access-denied">
      <div className="admin-access-brand" aria-label="ExamMind">
        <Logo size={25} />
        <span>Exam<span>Mind.</span></span>
      </div>

      <section className="admin-access-card" aria-labelledby="admin-access-title">
        <span className="admin-access-icon" aria-hidden="true"><LockKeyhole size={26} strokeWidth={1.8} /></span>
        <h1 id="admin-access-title">Admins only</h1>
        <p>This account is not registered for the ExamMind admin portal. Sign in with an approved admin account to continue.</p>
        <div className="admin-access-actions">
          <button type="button" className="admin-access-primary" onClick={onUseAnotherAccount}>Use another account</button>
          <button type="button" className="admin-access-secondary" onClick={onReturnToWorkspace}>Return to my desk</button>
        </div>
      </section>
    </main>
  );
}
