import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

/**
 * "The Highlighted Page" — the landing hero centrepiece.
 *
 * One notebook page extruded from a real THREE.Shape whose binding holes are
 * punched through the geometry (not painted on), a highlighted ruled line, a
 * dog-eared corner, and a highlighter resting across the bottom-right edge.
 * Flat toon shading with a nearest-filtered gradient map plus an inverted-hull
 * outline pass, so it reads as illustration rather than a lighting test.
 */

const PAPER = '#fbfaf5';
const FOLD = '#e7e9e2';
const INK = '#090a0a';
const ACCENT = '#e9a13a';
/** The one supporting colour §3 allows the object (page chrome stays paper/ink/amber). */
const INK_BLUE = '#2f5d8f';

const PAGE_W = 1.5;
const PAGE_H = 2.0;
const PAGE_DEPTH = 0.09;
const HOLE_YS = [0.68, 0.34, 0, -0.34, -0.68];
const HOLE_X = -0.52;

/** Idle + parallax constants ported verbatim from the vanilla prototype. */
const BASE_ROT_X = -0.12;
const BASE_ROT_Y = -0.35;
const PARALLAX_X = 0.4;
const PARALLAX_Y = 0.22;
const LERP = 0.045;

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x, y + r);
  s.lineTo(x, y + h - r);
  s.quadraticCurveTo(x, y + h, x + r, y + h);
  s.lineTo(x + w - r, y + h);
  s.quadraticCurveTo(x + w, y + h, x + w, y + h - r);
  s.lineTo(x + w, y + r);
  s.quadraticCurveTo(x + w, y, x + w - r, y);
  s.lineTo(x + r, y);
  s.quadraticCurveTo(x, y, x, y + r);
  return s;
}

/**
 * Stepped gradient map with NearestFilter — the official three.js toon example
 * omits the filter, which interpolates the bands into a soft ramp. Setting it
 * explicitly is what produces flat, illustrated banding.
 */
function makeGradientMap(steps: number): THREE.DataTexture {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i += 1) data[i] = Math.round((i / (steps - 1)) * 255);
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Takes over rendering from R3F (priority >= 1) so the outline pass runs instead. */
function OutlinePass() {
  const { gl, scene, camera } = useThree();
  const effect = useMemo(
    () => new OutlineEffect(gl, {
      defaultThickness: 0.014,
      defaultColor: [0.02, 0.03, 0.03],
      defaultAlpha: 0.85,
    }),
    [gl],
  );

  useFrame(() => {
    effect.render(scene, camera);
  }, 1);

  return null;
}

function HighlightedPage({ reducedMotion }: { reducedMotion: boolean }) {
  const rig = useRef<THREE.Group>(null);
  const { pointer } = useThree();

  const gradientMap = useMemo(() => makeGradientMap(4), []);

  const materials = useMemo(() => ({
    paper: new THREE.MeshToonMaterial({ color: PAPER, gradientMap }),
    ink: new THREE.MeshToonMaterial({ color: INK, gradientMap }),
    accent: new THREE.MeshToonMaterial({ color: ACCENT, gradientMap }),
    fold: new THREE.MeshToonMaterial({ color: FOLD, gradientMap }),
    blue: new THREE.MeshToonMaterial({ color: INK_BLUE, gradientMap }),
  }), [gradientMap]);

  const pageGeo = useMemo(() => {
    const shape = roundedRectShape(PAGE_W, PAGE_H, 0.09);
    // Real punched-through binding holes: subtractive paths on the shape itself,
    // carried through the extrusion rather than faked with a decal.
    HOLE_YS.forEach((hy) => {
      const hole = new THREE.Path();
      hole.absarc(HOLE_X, hy, 0.05, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    });
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: PAGE_DEPTH,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.012,
      bevelSegments: 2,
      curveSegments: 16,
    });
    geo.center();
    return geo;
  }, []);

  const foldGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-0.22, 0);
    shape.lineTo(0, -0.22);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  }, []);

  useEffect(() => () => {
    pageGeo.dispose();
    foldGeo.dispose();
    gradientMap.dispose();
    Object.values(materials).forEach((m) => m.dispose());
  }, [pageGeo, foldGeo, gradientMap, materials]);

  useFrame(({ clock }) => {
    const group = rig.current;
    if (!group) return;

    if (reducedMotion) {
      group.rotation.set(BASE_ROT_X, BASE_ROT_Y, 0);
      return;
    }

    const t = clock.getElapsedTime();
    const targetY = BASE_ROT_Y + Math.sin(t * 0.2) * 0.08 + pointer.x * PARALLAX_X;
    const targetX = BASE_ROT_X + Math.sin(t * 0.15) * 0.03 - pointer.y * PARALLAX_Y;
    group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, targetY, LERP);
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, targetX, LERP);
  });

  const pageFrontZ = PAGE_DEPTH / 2 + 0.001;

  return (
    // Dropped below centre so the page clears the headline stack above it.
    <group ref={rig} position={[0, -0.42, 0]} rotation={[BASE_ROT_X, BASE_ROT_Y, 0]}>
      <mesh geometry={pageGeo} material={materials.paper} />

      {/* Ruled lines sitting flush on the front face. */}
      {([[0.62, 0.85, 0.05], [0.35, 0.85, 0.05], [0.08, 0.62, -0.02], [-0.48, 0.6, -0.03]] as const)
        .map(([y, width, xOffset]) => (
          <mesh key={`rule-${y}`} position={[xOffset, y, pageFrontZ]} material={materials.ink}>
            <boxGeometry args={[width, 0.032, 0.018]} />
          </mesh>
        ))}

      {/* The highlighted line — amber bar behind, ink rule in front of it. */}
      <mesh position={[0.05, -0.2, pageFrontZ - 0.002]} material={materials.accent}>
        <boxGeometry args={[0.85, 0.15, 0.014]} />
      </mesh>
      <mesh position={[0.05, -0.2, pageFrontZ + 0.004]} material={materials.ink}>
        <boxGeometry args={[0.85, 0.032, 0.02]} />
      </mesh>

      {/* Dog-eared top-right corner. */}
      <mesh
        geometry={foldGeo}
        material={materials.fold}
        position={[PAGE_W / 2 - 0.01, PAGE_H / 2 - 0.01, pageFrontZ]}
      />

      {/* Binding rings threaded through the punched holes. */}
      {HOLE_YS.map((hy) => (
        <mesh
          key={`ring-${hy}`}
          position={[HOLE_X, hy, pageFrontZ - PAGE_DEPTH / 2]}
          material={materials.blue}
        >
          <torusGeometry args={[0.055, 0.012, 8, 20]} />
        </mesh>
      ))}

      {/* Highlighter resting diagonally across the bottom-right edge, mid-stroke. */}
      <group position={[0.48, -0.78, pageFrontZ + 0.11]} rotation={[0, 0, 0.62]}>
        <mesh rotation={[0, 0, Math.PI / 2]} material={materials.accent}>
          <capsuleGeometry args={[0.095, 0.62, 4, 10]} />
        </mesh>
        <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.42, 0, 0]} material={materials.ink}>
          <coneGeometry args={[0.095, 0.2, 10]} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]} position={[0.29, 0, 0]} material={materials.blue}>
          <cylinderGeometry args={[0.1, 0.1, 0.06, 10]} />
        </mesh>
      </group>

      {/* Soft contact shadow. */}
      <mesh position={[0, -1.35, -0.3]}>
        <circleGeometry args={[1.05, 32]} />
        <meshBasicMaterial color={INK} transparent opacity={0.08} />
      </mesh>
    </group>
  );
}

export default function HeroPageScene({
  reducedMotion,
  paused,
  onReady,
}: {
  reducedMotion: boolean;
  paused: boolean;
  onReady: () => void;
}) {
  return (
    <Canvas
      className="em-hero-canvas"
      camera={{ position: [0.9, 0.55, 4.4], fov: 38, near: 0.1, far: 50 }}
      dpr={[1, 2]}
      frameloop={paused ? 'never' : 'always'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl, camera }) => {
        gl.setClearColor(0x000000, 0);
        camera.lookAt(0, -0.05, 0);
        onReady();
      }}
    >
      <ambientLight color="#fff2df" intensity={0.65} />
      <directionalLight color="#fff0d6" intensity={1.15} position={[-2.4, 3, 2.6]} />
      <directionalLight color="#dfe7ea" intensity={0.4} position={[2.6, -1, 1.8]} />
      <HighlightedPage reducedMotion={reducedMotion} />
      <OutlinePass />
    </Canvas>
  );
}
