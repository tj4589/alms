import type { ScreenType } from '../types';
import './Offline.css';

export default function Empty({ go }: { go: (s: ScreenType) => void }) {
  return (
    <div className="page" id="s-empty">
      <div className="empty-sheet">
        <span className="empty-marks" aria-hidden="true"><i /><i /><i /><i /></span>
        <p className="empty-kicker">Nothing filed for this course</p>
        <h1 className="empty-heading">Be the <em>first</em> to contribute</h1>
        <p className="empty-lede">
          No past questions or lecture notes have been added for this course yet.
          Add the first one and it becomes available to everyone studying it.
        </p>
        <div className="empty-buttons">
          <button onClick={() => go('upload')}>Add past questions</button>
          <button className="is-ghost" onClick={() => go('upload')}>Add lecture notes</button>
        </div>
      </div>
    </div>
  );
}
