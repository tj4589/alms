import type { ScreenType } from '../types';

export default function Empty({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-empty">
      <div className="empty-state">
        <div className="empty-ico">◈</div>
        <div className="empty-title">Be the <em>first</em> to contribute</div>
        <div className="empty-body">No past questions or lecture notes have been uploaded for this course yet. Upload the first one and it becomes instantly available to every student in your department.</div>
        <div className="empty-actions">
          <button className="cta" onClick={() => go('upload')}>+ Upload past question</button>
          <button className="cta cta-ghost" onClick={() => go('upload')}>+ Upload lecture notes</button>
        </div>
      </div>
    </div>
  );
}
