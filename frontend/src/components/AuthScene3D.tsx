import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

type DocumentPanel = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  accent: string;
  opacity: number;
};

const DOCUMENTS: DocumentPanel[] = [
  { position: [-3.6, 0.2, -1.4], rotation: [0.08, 0.28, -0.26], scale: [1.65, 2.15, 1], accent: '#e8a23a', opacity: 0.24 },
  { position: [3.35, -0.3, -1.1], rotation: [-0.04, -0.34, 0.22], scale: [1.42, 1.92, 1], accent: '#3ecfb2', opacity: 0.2 },
  { position: [-1.2, 1.65, -2.35], rotation: [0.18, -0.2, 0.12], scale: [0.95, 1.25, 1], accent: '#e8a23a', opacity: 0.16 },
  { position: [1.55, 1.25, -2.7], rotation: [-0.12, 0.24, -0.1], scale: [0.82, 1.08, 1], accent: '#3ecfb2', opacity: 0.15 },
];

const NODE_POSITIONS: [number, number, number][] = [
  [-4.2, -1.6, -2.8],
  [-3.1, 1.75, -3.2],
  [-1.7, -2.0, -3.7],
  [-0.4, 2.25, -3.9],
  [1.1, -1.9, -3.4],
  [2.6, 1.8, -3.1],
  [4.1, -1.25, -3.0],
  [3.7, 0.2, -4.2],
];

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(media.matches);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function DocumentSheet({ panel, index }: { panel: DocumentPanel; index: number }) {
  const group = useRef<THREE.Group>(null);
  const lineWidths = useMemo(() => [0.72, 0.58, 0.78, 0.66, 0.48, 0.7, 0.54], []);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.getElapsedTime();
    group.current.position.y = panel.position[1] + Math.sin(t * 0.32 + index) * 0.08;
    group.current.rotation.z = panel.rotation[2] + Math.sin(t * 0.22 + index) * 0.025;
  });

  return (
    <group ref={group} position={panel.position} rotation={panel.rotation} scale={panel.scale}>
      <mesh>
        <boxGeometry args={[1.2, 1.55, 0.018]} />
        <meshStandardMaterial
          color="#151821"
          transparent
          opacity={panel.opacity}
          roughness={0.72}
          metalness={0.08}
          emissive={panel.accent}
          emissiveIntensity={0.075}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0, 0.018]}>
        <planeGeometry args={[1.08, 1.43]} />
        <meshBasicMaterial color={panel.accent} transparent opacity={0.04} side={THREE.DoubleSide} />
      </mesh>
      {lineWidths.map((width, lineIndex) => (
        <mesh
          key={`${index}-${lineIndex}`}
          position={[-0.16 + (width - 0.72) * 0.16, 0.48 - lineIndex * 0.17, 0.034]}
        >
          <planeGeometry args={[width, 0.012]} />
          <meshBasicMaterial color={panel.accent} transparent opacity={lineIndex === 0 ? 0.38 : 0.19} />
        </mesh>
      ))}
      <mesh position={[-0.35, 0.62, 0.036]}>
        <planeGeometry args={[0.22, 0.025]} />
        <meshBasicMaterial color={panel.accent} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function GraphEdge({
  start,
  end,
  color,
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
}) {
  const { midpoint, length, quaternion } = useMemo(() => {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const direction = b.clone().sub(a);
    const edgeLength = direction.length();
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return { midpoint: mid, length: edgeLength, quaternion: q };
  }, [start, end]);

  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[0.006, 0.006, length, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.13} />
    </mesh>
  );
}

function KnowledgeNodes() {
  return (
    <group>
      {NODE_POSITIONS.map((position, index) => (
        <mesh key={`node-${index}`} position={position}>
          <sphereGeometry args={[index % 3 === 0 ? 0.035 : 0.025, 12, 12]} />
          <meshBasicMaterial color={index % 2 === 0 ? '#e8a23a' : '#3ecfb2'} transparent opacity={0.68} />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <GraphEdge
          key={`edge-${index}`}
          start={NODE_POSITIONS[index]}
          end={NODE_POSITIONS[index + 2]}
          color={index % 2 === 0 ? '#e8a23a' : '#3ecfb2'}
        />
      ))}
    </group>
  );
}

function CentralGlow() {
  return (
    <group position={[0, 0, -2.15]}>
      <mesh>
        <sphereGeometry args={[1.55, 32, 32]} />
        <meshBasicMaterial color="#e8a23a" transparent opacity={0.045} />
      </mesh>
      <mesh scale={[1.55, 1.55, 1.55]}>
        <sphereGeometry args={[1.15, 32, 32]} />
        <meshBasicMaterial color="#3ecfb2" transparent opacity={0.026} />
      </mesh>
    </group>
  );
}

function SceneRig({ reducedMotion, isMobile }: { reducedMotion: boolean; isMobile: boolean }) {
  const root = useRef<THREE.Group>(null);
  const { pointer } = useThree();
  const panels = isMobile ? DOCUMENTS.slice(0, 3) : DOCUMENTS;

  useFrame(({ clock }) => {
    if (!root.current || reducedMotion) return;
    const t = clock.getElapsedTime();
    root.current.rotation.y = THREE.MathUtils.lerp(root.current.rotation.y, pointer.x * 0.045 + Math.sin(t * 0.1) * 0.02, 0.035);
    root.current.rotation.x = THREE.MathUtils.lerp(root.current.rotation.x, -pointer.y * 0.028, 0.035);
  });

  return (
    <group ref={root}>
      <CentralGlow />
      {panels.map((panel, index) => <DocumentSheet key={index} panel={panel} index={index} />)}
      {!isMobile && <KnowledgeNodes />}
      <ambientLight intensity={0.42} />
      <pointLight position={[-3, 2, 2]} intensity={0.62} color="#e8a23a" />
      <pointLight position={[3, -1, 1.5]} intensity={0.45} color="#3ecfb2" />
    </group>
  );
}

function AuthSceneFallback() {
  const lineWidths = ['92%', '84%', '76%', '88%', '68%', '80%', '58%', '72%'];
  return (
    <div className="auth-3d-stage auth-3d-fallback" aria-hidden="true">
      <div className="auth-3d-card auth-3d-card-one">
        <div className="auth-3d-card-lines">
          {lineWidths.map((width, index) => <span key={`fallback-left-${index}`} style={{ width }} />)}
        </div>
      </div>
      <div className="auth-3d-card auth-3d-card-two">
        <div className="auth-3d-card-lines">
          {lineWidths.slice().reverse().map((width, index) => <span key={`fallback-right-${index}`} style={{ width }} />)}
        </div>
      </div>
      <div className="auth-3d-ring"></div>
      <div className="auth-3d-glow"></div>
    </div>
  );
}

export default function AuthScene3D() {
  const [webglReady, setWebglReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    setWebglReady(supportsWebGL());
    const updateMobile = () => setIsMobile(window.matchMedia('(max-width: 720px)').matches);
    updateMobile();
    window.addEventListener('resize', updateMobile);
    return () => window.removeEventListener('resize', updateMobile);
  }, []);

  if (!webglReady || failed) return <AuthSceneFallback />;

  return (
    <div className="auth-scene3d" aria-hidden="true">
      <Canvas
        className="auth-scene3d-canvas"
        camera={{ position: [0, 0, isMobile ? 7.4 : 6.5], fov: isMobile ? 46 : 42 }}
        dpr={[1, 1.45]}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
        onError={() => setFailed(true)}
      >
        <SceneRig reducedMotion={reducedMotion} isMobile={isMobile} />
      </Canvas>
      <AuthSceneFallback />
    </div>
  );
}
