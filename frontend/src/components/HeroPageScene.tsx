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
 *
 * The ramp is deliberately not linear. A linear 4-step map bottoms out at 0,
 * which crushes the darkest band to black and reads as muddy rather than
 * illustrated; lifting the floor keeps all four steps as distinct mid-tones.
 */
const TOON_RAMP = [72, 132, 192, 255];

function makeGradientMap(tones: number[]): THREE.DataTexture {
  const steps = tones.length;
  const data = new Uint8Array(tones);
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
      defaultThickness: 0.009,
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

type ToonMaterials = {
  paper: THREE.MeshToonMaterial;
  ink: THREE.MeshToonMaterial;
  accent: THREE.MeshToonMaterial;
  fold: THREE.MeshToonMaterial;
  blue: THREE.MeshToonMaterial;
};

/** One shared gradient map and material set for every mesh in the scene. */
function useToonMaterials(): ToonMaterials {
  const gradientMap = useMemo(() => makeGradientMap(TOON_RAMP), []);

  const materials = useMemo<ToonMaterials>(() => ({
    paper: new THREE.MeshToonMaterial({ color: PAPER, gradientMap }),
    ink: new THREE.MeshToonMaterial({ color: INK, gradientMap }),
    accent: new THREE.MeshToonMaterial({ color: ACCENT, gradientMap }),
    fold: new THREE.MeshToonMaterial({ color: FOLD, gradientMap }),
    blue: new THREE.MeshToonMaterial({ color: INK_BLUE, gradientMap }),
  }), [gradientMap]);

  useEffect(() => () => {
    gradientMap.dispose();
    Object.values(materials).forEach((m) => m.dispose());
  }, [gradientMap, materials]);

  return materials;
}

/**
 * Loose sheets drifting behind the notebook, each nudged independently by the
 * pointer at its own rate — the same presence the page's parallax implies,
 * felt on the paper around it.
 */
const LOOSE_SHEETS = [
  { position: [-1.62, 0.28, -0.9] as const, rotation: [0.05, 0.22, 0.36] as const, scale: 0.86, tone: 'fold' as const, drift: 0.30, lerp: 0.030 },
  { position: [1.68, -0.12, -1.15] as const, rotation: [-0.04, -0.26, -0.3] as const, scale: 0.78, tone: 'paper' as const, drift: 0.42, lerp: 0.024 },
  { position: [-1.12, -1.12, -1.5] as const, rotation: [0.08, 0.14, -0.5] as const, scale: 0.64, tone: 'paper' as const, drift: 0.22, lerp: 0.036 },
  { position: [1.22, 1.05, -1.7] as const, rotation: [-0.1, -0.18, 0.44] as const, scale: 0.6, tone: 'fold' as const, drift: 0.5, lerp: 0.020 },
  { position: [0.18, 1.42, -2.0] as const, rotation: [0.06, 0.1, -0.16] as const, scale: 0.52, tone: 'paper' as const, drift: 0.34, lerp: 0.028 },
];

function LoosePapers({ reducedMotion, materials }: { reducedMotion: boolean; materials: ToonMaterials }) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const { pointer } = useThree();

  const sheetGeo = useMemo(() => {
    const geo = new THREE.ExtrudeGeometry(roundedRectShape(1.25, 1.7, 0.07), {
      depth: 0.012,
      bevelEnabled: false,
      curveSegments: 8,
    });
    geo.center();
    return geo;
  }, []);

  useEffect(() => () => { sheetGeo.dispose(); }, [sheetGeo]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    LOOSE_SHEETS.forEach((sheet, i) => {
      const group = groups.current[i];
      if (!group) return;

      if (reducedMotion) {
        group.position.set(sheet.position[0], sheet.position[1], sheet.position[2]);
        group.rotation.set(sheet.rotation[0], sheet.rotation[1], sheet.rotation[2]);
        return;
      }

      const targetX = sheet.position[0] + pointer.x * sheet.drift * 0.45;
      const targetY = sheet.position[1] - pointer.y * sheet.drift * 0.3 + Math.sin(t * 0.24 + i) * 0.05;
      group.position.x = THREE.MathUtils.lerp(group.position.x, targetX, sheet.lerp);
      group.position.y = THREE.MathUtils.lerp(group.position.y, targetY, sheet.lerp);
      group.rotation.z = THREE.MathUtils.lerp(group.rotation.z, sheet.rotation[2] + pointer.x * sheet.drift * 0.18, sheet.lerp);
      group.rotation.y = THREE.MathUtils.lerp(group.rotation.y, sheet.rotation[1] + pointer.x * sheet.drift * 0.12, sheet.lerp);
    });
  });

  return (
    <group>
      {LOOSE_SHEETS.map((sheet, i) => (
        <group
          key={`sheet-${i}`}
          ref={(el) => { groups.current[i] = el; }}
          position={sheet.position}
          rotation={sheet.rotation}
        >
          <mesh geometry={sheetGeo} material={materials[sheet.tone]} scale={sheet.scale} />
        </group>
      ))}
    </group>
  );
}

function HighlightedPage({ reducedMotion, materials }: { reducedMotion: boolean; materials: ToonMaterials }) {
  const rig = useRef<THREE.Group>(null);
  const { pointer } = useThree();

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
      bevelThickness: 0.007,
      bevelSize: 0.007,
      bevelSegments: 1,
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
  }, [pageGeo, foldGeo]);

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

      {/* Highlighter mid-stroke: nib landed on the right end of the highlighted
          line (x 0.44, y -0.2), barrel angled down-right past the page edge.
          Local +X is the nib, so the group is offset back along that heading. */}
      <group position={[0.804, -0.41, pageFrontZ + 0.085]} rotation={[0, 0, 2.618]}>
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

/** Builds the shared material set, then the loose paper behind and the page in front. */
function SceneContents({ reducedMotion }: { reducedMotion: boolean }) {
  const materials = useToonMaterials();
  return (
    <>
      <LoosePapers reducedMotion={reducedMotion} materials={materials} />
      <HighlightedPage reducedMotion={reducedMotion} materials={materials} />
    </>
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
      <ambientLight color="#fff2df" intensity={0.34} />
      <directionalLight color="#fff0d6" intensity={1.45} position={[-2.4, 3, 2.6]} />
      <directionalLight color="#dfe7ea" intensity={0.32} position={[2.6, -1, 1.8]} />
      <SceneContents reducedMotion={reducedMotion} />
      <OutlinePass />
    </Canvas>
  );
}
