export const Analytics = () => {
  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <h2 style={{ color: 'var(--accent-primary)', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        Performance Analytics
      </h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '3rem' }}>
        <div style={{ padding: '1.5rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <h4 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Questions Practiced</h4>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>128</div>
        </div>
        <div style={{ padding: '1.5rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <h4 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Mastery Score</h4>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#10b981' }}>76%</div>
        </div>
        <div style={{ padding: '1.5rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', textAlign: 'center' }}>
          <h4 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Study Hours</h4>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#8b5cf6' }}>14.5</div>
        </div>
      </div>

      <h3 style={{ marginBottom: '1rem' }}>Topic Heatmap</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '150px', fontSize: '0.9rem' }}>Data Structures</div>
          <div style={{ flex: 1, height: '12px', background: 'var(--surface-color)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
            <div style={{ width: '85%', height: '100%', background: '#10b981' }}></div>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>85%</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '150px', fontSize: '0.9rem' }}>Algorithms</div>
          <div style={{ flex: 1, height: '12px', background: 'var(--surface-color)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
            <div style={{ width: '60%', height: '100%', background: '#f59e0b' }}></div>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>60%</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ width: '150px', fontSize: '0.9rem' }}>System Design</div>
          <div style={{ flex: 1, height: '12px', background: 'var(--surface-color)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
            <div style={{ width: '40%', height: '100%', background: '#ef4444' }}></div>
          </div>
          <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>40%</div>
        </div>
      </div>
    </div>
  );
};
