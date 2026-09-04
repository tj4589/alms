import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

type LandingScene3DProps = {
  onReady?: () => void;
};

function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
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
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  ));

  useEffect(() => {
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  return visible;
}

const LINE_WIDTHS = [0.68, 0.52, 0.76, 0.61, 0.46, 0.7, 0.56];

function PageLines({ side }: { side: 'left' | 'right' }) {
  const tint = side === 'left' ? '#a9874c' : '#817c6f';
  return (
    <group position={[side === 'left' ? -0.74 : 0.74, 0, 0.09]} rotation={[0, 0, side === 'left' ? 0.035 : -0.035]}>
      {LINE_WIDTHS.map((width, index) => (
        <mesh key={`${side}-line-${index}`} position={[(width - 0.62) * 0.12, 0.61 - index * 0.18, 0]}>
          <planeGeometry args={[width, 0.018]} />
          <meshBasicMaterial color={tint} transparent opacity={index === 0 ? 0.46 : 0.24} />
        </mesh>
      ))}
      <mesh position={[-0.29, 0.74, 0]}>
        <planeGeometry args={[0.2, 0.035]} />
        <meshBasicMaterial color="#e9a13a" transparent opacity={0.8} />
      </mesh>
    </group>
  );
}

function NotebookObject() {
  const highlighter = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>(null);
  const pages = useRef<THREE.Group>(null);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    if (pages.current) {
      pages.current.position.y = Math.sin(t * 0.55) * 0.035;
      pages.current.rotation.z = Math.sin(t * 0.31) * 0.008;
    }
    if (highlighter.current) {
      const progress = (t * 0.12) % 1;
      const x = THREE.MathUtils.lerp(-0.34, 0.34, progress);
      highlighter.current.position.x = x;
      highlighter.current.material.opacity = 0.18 + Math.sin(progress * Math.PI) * 0.2;
      highlighter.current.rotation.z = THREE.MathUtils.damp(highlighter.current.rotation.z, -0.045, 4, delta);
    }
  });

  return (
    <group ref={pages} rotation={[0.1, -0.12, -0.02]}>
      <mesh position={[0, -0.05, -0.1]} rotation={[0, 0, 0.02]}>
        <boxGeometry args={[2.65, 2.28, 0.09]} />
        <meshStandardMaterial color="#d7c8a5" roughness={0.86} metalness={0.02} />
      </mesh>
      <mesh position={[0, 0.03, -0.02]} rotation={[0, 0, 0.02]}>
        <boxGeometry args={[2.48, 2.15, 0.08]} />
        <meshStandardMaterial color="#f8f3e7" roughness={0.9} metalness={0.01} />
      </mesh>
      <mesh position={[-0.69, 0.08, 0.035]} rotation={[0, 0, 0.035]}>
        <boxGeometry args={[1.22, 1.98, 0.04]} />
        <meshStandardMaterial color="#fdfaf2" roughness={0.88} metalness={0.01} />
      </mesh>
      <mesh position={[0.69, 0.08, 0.035]} rotation={[0, 0, -0.035]}>
        <boxGeometry args={[1.22, 1.98, 0.04]} />
        <meshStandardMaterial color="#fdfaf2" roughness={0.88} metalness={0.01} />
      </mesh>
      <mesh position={[0, 0.07, 0.075]}>
        <boxGeometry args={[0.06, 2.05, 0.035]} />
        <meshStandardMaterial color="#b69b6d" roughness={0.8} metalness={0.03} />
      </mesh>
      <PageLines side="left" />
      <PageLines side="right" />
      <mesh ref={highlighter} position={[-0.34, -0.12, 0.14]} rotation={[0, 0, -0.045]}>
        <planeGeometry args={[0.6, 0.075]} />
        <meshBasicMaterial color="#e9a13a" transparent opacity={0.22} />
      </mesh>
      <mesh position={[0.1, -0.72, 0.12]} rotation={[0, 0, -0.02]}>
        <planeGeometry args={[0.7, 0.018]} />
        <meshBasicMaterial color="#c1493b" transparent opacity={0.62} />
      </mesh>
    </group>
  );
}

function PaperCard({ position, rotation, scale, color }: {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  color: string;
}) {
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh>
        <boxGeometry args={[1.18, 1.62, 0.045]} />
        <meshStandardMaterial color={color} roughness={0.88} metalness={0.01} />
      </mesh>
      <mesh position={[0, 0, 0.035]}>
        <planeGeometry args={[0.9, 0.018]} />
        <meshBasicMaterial color="#a9874c" transparent opacity={0.34} />
      </mesh>
    </group>
  );
}

function SceneRig({ reducedMotion }: { reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const { pointer } = useThree();
  const startedAt = useRef<number | null>(null);

  useFrame(({ clock }, delta) => {
    if (!root.current || reducedMotion) return;
    const elapsed = clock.getElapsedTime();
    if (startedAt.current === null) startedAt.current = elapsed;

    const entrance = THREE.MathUtils.clamp((elapsed - startedAt.current) / 0.95, 0, 1);
    const easeOut = 1 - ((1 - entrance) ** 4);
    root.current.scale.setScalar(THREE.MathUtils.lerp(0.82, 1, easeOut));
    root.current.position.y = THREE.MathUtils.lerp(-0.26, 0, easeOut) + Math.sin(elapsed * 0.34) * 0.035;
    root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, pointer.x * 0.12 + Math.sin(elapsed * 0.16) * 0.025, 3.4, delta);
    root.current.rotation.x = THREE.MathUtils.damp(root.current.rotation.x, -pointer.y * 0.08 + Math.sin(elapsed * 0.13) * 0.012, 3.4, delta);
    root.current.rotation.z = THREE.MathUtils.damp(root.current.rotation.z, -0.018 + Math.sin(elapsed * 0.2) * 0.012, 3.4, delta);
  });

  return (
    <group ref={root} rotation={[0.1, -0.08, -0.018]}>
      <PaperCard position={[-0.18, 0.18, -0.45]} rotation={[0.08, 0.14, -0.16]} scale={1.08} color="#e9e0cc" />
      <PaperCard position={[0.23, 0.08, -0.28]} rotation={[-0.06, -0.1, 0.11]} scale={1.03} color="#eee5d4" />
      <NotebookObject />
      <ambientLight intensity={1.05} />
      <directionalLight position={[-3, 4, 5]} intensity={1.4} color="#fff7e6" />
      <pointLight position={[2.2, 0.8, 2.2]} intensity={0.35} color="#e9a13a" />
    </group>
  );
}

function SceneFallback() {
  return (
    <div className="em-hero-scene-fallback" aria-hidden="true">
      <span className="em-fallback-sheet em-fallback-sheet-back" />
      <span className="em-fallback-sheet em-fallback-sheet-front"><i /><i /><i /><i /></span>
      <span className="em-fallback-highlight" />
    </div>
  );
}

export default function LandingScene3D({ onReady }: LandingScene3DProps) {
  const [mounted, setMounted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [webglReady] = useState(() => supportsWebGL());
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches
  ));
  const reducedMotion = useReducedMotion();
  const visible = useDocumentVisible();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const updateMobile = () => setIsMobile(window.matchMedia('(max-width: 720px)').matches);
    window.addEventListener('resize', updateMobile);
    return () => window.removeEventListener('resize', updateMobile);
  }, []);

  useEffect(() => {
    if (!mounted || webglReady || sceneReady) return undefined;
    const frame = window.requestAnimationFrame(() => {
      setSceneReady(true);
      onReady?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mounted, onReady, sceneReady, webglReady]);

  const handleReady = () => {
    if (sceneReady) return;
    setSceneReady(true);
    onReady?.();
  };

  return (
    <div className={`em-hero-scene ${sceneReady ? 'is-ready' : ''}`} aria-hidden="true">
      <SceneFallback />
      {mounted && webglReady && (
        <Canvas
          className="em-hero-scene-canvas"
          camera={{ position: [0, 0, isMobile ? 6.5 : 5.8], fov: isMobile ? 42 : 36 }}
          dpr={[1, 1.35]}
          frameloop={visible && !reducedMotion ? 'always' : 'never'}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
            handleReady();
          }}
          onError={handleReady}
        >
          <SceneRig reducedMotion={reducedMotion} />
        </Canvas>
      )}
    </div>
  );
}
