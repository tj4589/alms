import type { ScreenType, User } from '../types';

type SettingsProps = {
  go: (s: ScreenType) => void;
  user: User | null;
};

const panelStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 14,
};

const infoRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  padding: '12px 0',
  borderBottom: '1px solid var(--border)',
};

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoRowStyle}>
      <div style={{ color: 'var(--text3)', fontSize: 12 }}>{label}</div>
      <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{value}</div>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          className="ni-ico"
          style={{
            width: 34,
            height: 34,
            borderColor: 'rgba(232,162,58,0.35)',
            color: 'var(--gold)',
            flex: '0 0 auto',
          }}
        >
          {icon}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{title}</div>
          <div style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.65 }}>{body}</div>
        </div>
      </div>
    </div>
  );
}

export default function Settings({ go, user }: SettingsProps) {
  const username = user?.username ? `@${user.username}` : 'Not set';

  return (
    <div className="page" id="s-settings">
      <div className="pg-head">
        <div>
          <div className="pg-title">Student <em>Settings</em></div>
          <div className="pg-sub">Account details, authenticated access, and privacy notes for your ExamMind study workspace.</div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Student account</div>
            <span className="tag tag-e">Student</span>
          </div>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 10 }}>
            <div className="ava" style={{ width: 54, height: 54, fontSize: 18 }}>
              {(user?.name || 'Student').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{user?.name || 'Student account'}</div>
              <div style={{ color: 'var(--text3)', fontSize: 12 }}>{username}</div>
            </div>
          </div>
          <FieldRow label="Name" value={user?.name || 'Loading...'} />
          <FieldRow label="Username" value={username} />
          <FieldRow label="Email" value={user?.email || 'Loading...'} />
          <FieldRow label="Account type" value="Student" />
        </div>

        <div className="card">
          <div className="card-hd">
            <div className="card-ttl">Privacy summary</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="offline-item">
              <div>
                <div className="offline-item-title">Protected pages require login</div>
                <div className="offline-item-meta">ExamMind uses JWT-based authenticated access for student features.</div>
              </div>
              <span className="tag tag-e">Active</span>
            </div>
            <div className="offline-item">
              <div>
                <div className="offline-item-title">Progress belongs to your account</div>
                <div className="offline-item-meta">Practice attempts and readiness views are scoped to the logged-in student.</div>
              </div>
              <span className="tag">Student data</span>
            </div>
            <div className="offline-item">
              <div>
                <div className="offline-item-title">Raw OCR stays out of main views</div>
                <div className="offline-item-meta">Extracted text previews use cleaned academic content where available.</div>
              </div>
              <span className="tag tag-m">Preview safe</span>
            </div>
          </div>
        </div>
      </div>

      <div style={panelStyle}>
        <InfoCard
          icon="J"
          title="Authenticated access"
          body="ExamMind protects student-facing pages with JWT-based login. Uploads, search, AI assistance, practice, progress, study groups, and reading rooms require an authenticated student session."
        />
        <InfoCard
          icon="P"
          title="Student data privacy"
          body="Student analytics and practice progress are tied to the logged-in account. The progress screen requests your own student record and does not expose another student's private progress in the interface."
        />
        <InfoCard
          icon="D"
          title="Uploaded materials notice"
          body="Uploaded academic PDFs are processed for text extraction, OCR cleanup, metadata detection, semantic search, and AI retrieval. Raw extracted text is kept for traceability and is not shown as the main student preview."
        />
      </div>

      <div className="success-card" style={{ marginTop: 18 }}>
        <div className="success-label">Chapter Four Screenshot</div>
        <div className="success-title">Figure 4.17: Student Settings and Privacy Interface</div>
        <div className="success-body">
          This screen documents student account identity, secure authenticated access, student progress privacy, and how uploaded materials are processed for ExamMind retrieval.
        </div>
        <div className="empty-actions">
          <button className="cta" onClick={() => go('upload')}>Review uploads</button>
          <button className="cta cta-ghost" onClick={() => go('progress')}>View progress</button>
        </div>
      </div>
    </div>
  );
}
