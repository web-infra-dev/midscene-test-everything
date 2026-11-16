import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type {
  TwinSceneSnapshot,
  TwinScreenSnapshot,
} from '../../server/twin-types.js';

const DEG = Math.PI / 180;
const GLASS_COLOR = 0x8ef6ff;
const DARK_BG = 0x0b0e14;

/** Base millimetres, Z-up → three.js metres, Y-up. */
function toWorld(point: { x: number; y: number; z: number }) {
  return new THREE.Vector3(point.x / 1000, point.z / 1000, -point.y / 1000);
}

/** Same rotation as toWorld, for a direction rather than a point. */
function toWorldDirection(direction: THREE.Vector3) {
  return new THREE.Vector3(direction.x, direction.z, -direction.y).normalize();
}

function screenCenter(screen: TwinScreenSnapshot) {
  return toWorld({
    x:
      screen.originMm.x +
      screen.xAxis.x * (screen.physicalWidthMm / 2) +
      screen.yAxis.x * (screen.physicalHeightMm / 2),
    y:
      screen.originMm.y +
      screen.xAxis.y * (screen.physicalWidthMm / 2) +
      screen.yAxis.y * (screen.physicalHeightMm / 2),
    z:
      screen.originMm.z +
      screen.xAxis.z * (screen.physicalWidthMm / 2) +
      screen.yAxis.z * (screen.physicalHeightMm / 2),
  });
}

/** Display frame: +Y is screen-up and +Z points at the robot. */
function screenMatrix(screen: TwinScreenSnapshot) {
  const x = toWorld(screen.xAxis).normalize();
  const y = toWorld(screen.yAxis).normalize().negate();
  const z = toWorld(screen.inward).normalize().negate();
  const center = screenCenter(screen);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(center);
}

function roundedRect(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.absarc(x + width - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + width, y + height - r);
  shape.absarc(x + width - r, y + height - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + height);
  shape.absarc(x + r, y + height - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function hullMaterial(resolution: THREE.Vector2) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(0xf4f1ea) },
      uWidth: { value: 1.5 },
      uResolution: { value: resolution },
    },
    vertexShader: `
      uniform float uWidth;
      uniform vec2 uResolution;
      void main() {
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec3 viewNormal = normalize(normalMatrix * normal);
        float len = length(viewNormal.xy);
        if (len > 0.18) clip.xy += (viewNormal.xy / len) * uWidth * clip.w * 2.0 / uResolution;
        gl_Position = clip;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 0.82); }
    `,
  });
}

export interface TwinStageOptions {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  scene: TwinSceneSnapshot;
  screenCanvases: Record<string, HTMLCanvasElement>;
  onProgress?: (loaded: number, total: number) => void;
}

export type TwinViewPreset = 'default' | 'camera' | 'screen';

export interface TwinStage {
  setJoints: (values: number[]) => void;
  /** Align the visual tool tip to the controller's measured flange pose. */
  alignToPose: (
    positionMm: { x: number; y: number; z: number },
    quaternion: { x: number; y: number; z: number; w: number },
  ) => void;
  setViewPreset: (preset: TwinViewPreset) => void;
  markScreenTexture: (id: string) => void;
  setActive: (active: boolean) => void;
  resetView: () => void;
  dispose: () => void;
}

export async function mountTwinStage(
  options: TwinStageOptions,
): Promise<TwinStage> {
  const { container, canvas, scene: snapshot, screenCanvases } = options;
  const visual = snapshot.robot?.visual;
  if (!visual) throw new Error('Robot visual model is unavailable');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(DARK_BG, 1);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.35;
  controls.maxDistance = 2.6;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  const centers = snapshot.screens.map(screenCenter);
  const target = centers.length
    ? centers
        .reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .multiplyScalar(1 / centers.length)
    : new THREE.Vector3(0.16, -0.16, 0);
  // The screens sit to one side of the base; bias the orbit target toward the
  // arm so a narrow split column still frames the whole group.
  target.lerp(new THREE.Vector3(0.04, -0.04, 0), 0.45);
  const defaultPosition = target
    .clone()
    .add(new THREE.Vector3(0.42, 0.46, 0.52));
  const defaultTarget = target.clone();
  const fittedPosition = defaultPosition.clone();
  camera.position.copy(defaultPosition);
  controls.target.copy(defaultTarget);
  controls.update();

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
  keyLight.position.set(0.7, 1.1, 0.8);
  scene.add(keyLight);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  const resolution = new THREE.Vector2(1, 1);
  const lineMaterial = new LineMaterial({
    color: 0xd8f8ff,
    linewidth: 1.2,
    transparent: true,
    opacity: 0.8,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  lineMaterial.polygonOffset = true;
  lineMaterial.polygonOffsetFactor = -4;
  lineMaterial.polygonOffsetUnits = -4;

  const glass = new THREE.MeshBasicMaterial({
    color: GLASS_COLOR,
    transparent: true,
    opacity: 0.18,
    depthWrite: true,
    toneMapped: false,
  });
  const outline = hullMaterial(resolution);
  const cameraMaterials: THREE.Material[] = [];

  const robotRoot = new THREE.Group();
  robotRoot.rotation.x = -Math.PI / 2;
  scene.add(robotRoot);

  const groups = new Map<string, THREE.Group>();
  const screenGroups: THREE.Group[] = [];
  let cameraPropRoot: THREE.Group | undefined;
  const loader = new STLLoader();
  const cameraProp = snapshot.camera;
  const total =
    visual.links.filter((link) => link.mesh).length + (cameraProp ? 1 : 0);
  let loaded = 0;
  for (const link of visual.links) {
    const group = new THREE.Group();
    group.position.set(
      link.originMm[0] / 1000,
      link.originMm[1] / 1000,
      link.originMm[2] / 1000,
    );
    if (link.axis) group.userData.axis = new THREE.Vector3(...link.axis);
    const parent = link.parent ? groups.get(link.parent) : robotRoot;
    (parent ?? robotRoot).add(group);
    groups.set(link.name, group);
    if (!link.mesh) continue;
    const raw = await loader.loadAsync(`${visual.assetBaseUrl}${link.mesh}`);
    const geometry = mergeVertices(raw, 1e-5);
    raw.dispose();
    geometry.computeVertexNormals();
    const body = new THREE.Mesh(geometry, glass);
    group.add(body);
    const hull = new THREE.Mesh(geometry, outline);
    hull.renderOrder = 1;
    group.add(hull);
    const edges = new THREE.EdgesGeometry(geometry, 42);
    const positions = edges.attributes.position.array as Float32Array;
    edges.dispose();
    if (positions.length >= 6) {
      const lineGeometry = new LineSegmentsGeometry();
      lineGeometry.setPositions(Array.from(positions));
      const line = new LineSegments2(lineGeometry, lineMaterial);
      line.renderOrder = 2;
      group.add(line);
    }
    loaded += 1;
    options.onProgress?.(loaded, total);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  // The tool is three independent parts: the flange is fixed to the wrist, the
  // connector is fixed under it, and the pen slides inside the connector. The
  // pen's tip is driven by the tool profile, so adjusting the real pen changes
  // the slide, never the STL length.
  const mount = groups.get(visual.toolMountLink) ?? groups.get('link5');
  const tool = snapshot.tool;
  const mountOffsetMm = visual.toolMountOffsetMm ?? [0, 0, 0];
  if (mount) {
    const addToolPart = (
      part: THREE.BufferGeometry,
      parent: THREE.Object3D,
    ) => {
      parent.add(new THREE.Mesh(part, glass));
      const hull = new THREE.Mesh(part, outline);
      hull.renderOrder = 1;
      parent.add(hull);
      const edgeGeometry = new THREE.EdgesGeometry(part, 30);
      const edgePositions = edgeGeometry.getAttribute('position')
        .array as Float32Array;
      edgeGeometry.dispose();
      if (edgePositions.length < 6) return;
      const lineGeometry = new LineSegmentsGeometry();
      lineGeometry.setPositions(Array.from(edgePositions));
      const line = new LineSegments2(lineGeometry, lineMaterial);
      line.renderOrder = 2;
      parent.add(line);
    };
    const loadPart = async (name: string) => {
      const raw = await loader.loadAsync(
        `${visual.assetBaseUrl}${encodeURIComponent(name)}`,
      );
      const geometry = mergeVertices(raw, 1e-5);
      raw.dispose();
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) throw new Error(`Empty tool part: ${name}`);
      geometry.translate(
        -(box.min.x + box.max.x) / 2,
        0,
        -(box.min.z + box.max.z) / 2,
      );
      return geometry;
    };
    try {
      const mountZ = mountOffsetMm[2] / 1000;

      const flange = await loadPart('MG400_End_Flange_3D.stp.STL');
      // Flange: 20 mm-wide disc on the outer side, 11 mm collar toward the
      // wrist. Its lower face is the outer surface; the machine's thin cylinder
      // ends flush with it, and the collar wraps the cylinder above.
      flange.rotateX(-Math.PI / 2);
      flange.translate(0, 0, mountZ);
      addToolPart(flange, mount);

      const connector = await loadPart('MG400末端连接件.STL');
      // Connector: 39 mm top flange seats on the flange outer face, with the
      // sleeve extending down to receive the pen.
      connector.rotateX(Math.PI / 2);
      connector.computeBoundingBox();
      const connectorBox = connector.boundingBox;
      if (!connectorBox) throw new Error('Empty connector');
      connector.translate(0, 0, mountZ - connectorBox.max.z);
      addToolPart(connector, mount);

      const pen = await loadPart('MG400末端触控笔.STL');
      // Pen: rigid; its upper end stays inside the connector and its nib is
      // placed at the profile's flange→tip point.
      pen.rotateX(-Math.PI / 2);
      pen.computeBoundingBox();
      const penBox = pen.boundingBox;
      if (!penBox) throw new Error('Empty pen');
      const penLength = penBox.max.z - penBox.min.z;
      pen.translate(0, 0, -penBox.max.z); // top at 0, nib at -penLength
      const offsetZ = Math.abs(tool?.offsetMm.z ?? 0) / 1000;
      const tipZ = mountZ - (offsetZ > 0.02 ? offsetZ : 0.115);
      const penGroup = new THREE.Group();
      penGroup.position.z = tipZ + penLength;
      addToolPart(pen, penGroup);
      mount.add(penGroup);
    } catch (error) {
      // The twin must still render if an optional tool asset is absent.
      console.warn('Twin tool asset could not be loaded', error);
    }
  }

  // Screens: one slab per calibrated screen, textured with its corrected stream.
  const screenTextures = new Map<string, THREE.CanvasTexture>();
  for (const screen of snapshot.screens) {
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.matrix.copy(screenMatrix(screen));
    group.matrixWorldNeedsUpdate = true;
    scene.add(group);
    screenGroups.push(group);

    const width = screen.physicalWidthMm / 1000;
    const height = screen.physicalHeightMm / 1000;
    const bezel = 0.0015;
    const thickness = 0.008;
    const bodyWidth = width + bezel * 2;
    const bodyHeight = height + bezel * 2;
    const shape = roundedRect(
      bodyWidth,
      bodyHeight,
      Math.min(bodyWidth, bodyHeight) * 0.06,
    );
    const bodyGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 24,
    });
    bodyGeometry.translate(0, 0, -thickness);
    const body = new THREE.Mesh(
      bodyGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x15181e,
        metalness: 0.35,
        roughness: 0.55,
      }),
    );
    group.add(body);

    const canvas = screenCanvases[screen.id];
    if (canvas) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy(),
      );
      const display = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
      );
      display.position.z = 0.0003;
      group.add(display);
      screenTextures.set(screen.id, texture);
    }

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(bodyGeometry),
      new THREE.LineBasicMaterial({
        color: 0x8ef6ff,
        transparent: true,
        opacity: 0.45,
        toneMapped: false,
      }),
    );
    group.add(border);
  }

  // Static camera prop: the pose is estimated from the screen quads, and the
  // body-only asset drops the folded stand that is not part of the real mount.
  if (cameraProp) {
    try {
      const raw = await loader.loadAsync(cameraProp.modelUrl);
      // This STL is in millimetres; the arm links are in metres. Weld at
      // 0.01 mm rather than the arm's 1e-5 m tolerance.
      const geometry = mergeVertices(raw, 0.01);
      raw.dispose();
      geometry.computeVertexNormals();

      const bodyMaterial = new THREE.MeshStandardMaterial({
        color: 0x3a424e,
        metalness: 0.45,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: 0x9fd8e4,
        transparent: true,
        opacity: 0.35,
        toneMapped: false,
      });
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x8ef6ff,
        transparent: true,
        opacity: 0.95,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: 0x8ef6ff,
        transparent: true,
        opacity: 0.28,
        toneMapped: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      cameraMaterials.push(
        bodyMaterial,
        edgeMaterial,
        ringMaterial,
        haloMaterial,
      );

      const body = new THREE.Mesh(geometry, bodyMaterial);
      body.scale.setScalar(cameraProp.assetUnits === 'mm' ? 0.001 : 1);
      // The group origin is the lens centre, so shift the source mesh by the
      // lens point measured in the STL's own coordinates.
      body.position.set(
        -cameraProp.lensOffsetMm.x / 1000,
        -cameraProp.lensOffsetMm.y / 1000,
        -cameraProp.lensOffsetMm.z / 1000,
      );
      const edges = new THREE.EdgesGeometry(geometry, 65);
      body.add(new THREE.LineSegments(edges, edgeMaterial));

      const pose = new THREE.Group();
      pose.position.set(
        cameraProp.positionMm.x / 1000,
        cameraProp.positionMm.y / 1000,
        cameraProp.positionMm.z / 1000,
      );
      pose.quaternion.set(
        cameraProp.quaternion.x,
        cameraProp.quaternion.y,
        cameraProp.quaternion.z,
        cameraProp.quaternion.w,
      );
      // Keep the lens face towards the default orbit; the estimated optical
      // axis stays in the snapshot and this is a presentation-only flip.
      pose.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          Math.PI,
        ),
      );
      pose.add(body);

      // A small lens face makes the body read as a camera in the dark glass
      // scene; the mesh alone is mostly hood and perforated grille.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.0105, 0.012, 48),
        ringMaterial,
      );
      ring.rotation.x = -Math.PI / 2;
      // Float the halo clear of the lens bezel; at the lens plane the body
      // shell occludes most of it from the default orbit.
      ring.position.y = 0.0085;
      pose.add(ring);
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.012, 0.0132, 48),
        haloMaterial,
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.0087;
      pose.add(halo);

      const baseRoot = new THREE.Group();
      baseRoot.rotation.x = -Math.PI / 2;
      baseRoot.add(pose);
      scene.add(baseRoot);
      cameraPropRoot = baseRoot;
    } catch (error) {
      // The camera is a presentation prop; arm and screens must still render.
      console.warn('Twin camera asset could not be loaded', error);
    }
    loaded += 1;
    options.onProgress?.(loaded, total);
  }

  const gridY = (centers[0]?.y ?? -0.2) - 0.03;
  const grid = new THREE.GridHelper(1.2, 24, 0x2b3a4a, 0x18222c);
  grid.position.y = gridY;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  scene.add(grid);

  const DEFAULT_FOV = 34;
  // The C922 fit uses a 1500 px focal at 1920 wide, so its horizontal FOV is
  // about 65°. Keep that horizontal framing and derive the vertical FOV from
  // the split column's aspect instead of stretching the camera image.
  const CAMERA_HORIZONTAL_FOV = 2 * Math.atan(960 / 1500);
  let cameraMode = false;
  const screenUp = snapshot.screens.length
    ? toWorld(snapshot.screens[0].yAxis).normalize().negate()
    : new THREE.Vector3(0, 0, -1);
  const applyCameraViewFov = () => {
    const aspect = camera.aspect || 1;
    camera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(Math.tan(CAMERA_HORIZONTAL_FOV / 2) / aspect),
    );
    camera.updateProjectionMatrix();
  };

  const home = visual.homeJointDegrees ?? new Array(6).fill(0);
  const targetJoints = home.map((value) => value * DEG);
  const currentJoints = [...targetJoints];
  let active = true;
  let aligned = false;

  const resolveAngle = (name: string, visited = new Set<string>()): number => {
    if (visited.has(name)) return 0;
    visited.add(name);
    const link = visual.links.find((item) => item.name === name);
    if (!link) return 0;
    if (link.jointIndex) {
      const value = currentJoints[link.jointIndex - 1] ?? 0;
      return value * (link.jointSign ?? 1) + (link.jointOffsetDeg ?? 0) * DEG;
    }
    if (link.mimic) {
      return (
        resolveAngle(link.mimic.link, visited) * link.mimic.multiplier +
        (link.mimic.offsetDeg ?? 0) * DEG
      );
    }
    return 0;
  };

  const applyJoints = () => {
    for (const link of visual.links) {
      const group = groups.get(link.name);
      const axis = group?.userData.axis as THREE.Vector3 | undefined;
      if (!group || !axis) continue;
      group.quaternion.setFromAxisAngle(
        axis,
        link.jointIndex || link.mimic ? resolveAngle(link.name) : 0,
      );
    }
    robotRoot.updateMatrixWorld(true);
  };
  applyJoints();

  // Frame the arm, the screens and the camera prop together. The camera sits
  // above the desk, so a screen-only centre would crop it out of the default
  // view.
  {
    const bounds = new THREE.Box3();
    bounds.expandByObject(robotRoot);
    for (const group of screenGroups) bounds.expandByObject(group);
    if (cameraPropRoot) bounds.expandByObject(cameraPropRoot);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(0.28, size.length() / 2);
    const direction = new THREE.Vector3(0.42, 0.46, 0.52).normalize();
    const distance =
      (radius / Math.sin(THREE.MathUtils.degToRad(DEFAULT_FOV / 2))) * 1.15;
    defaultTarget.copy(center);
    defaultPosition.copy(center).addScaledVector(direction, distance);
    fittedPosition.copy(defaultPosition);
    camera.position.copy(fittedPosition);
    controls.target.copy(defaultTarget);
    controls.update();
  }

  let fitted = false;
  const resize = () => {
    const width = container.clientWidth || 640;
    const height = container.clientHeight || 420;
    if (width < 2 || height < 2) return;
    camera.aspect = width / height;
    if (cameraMode) applyCameraViewFov();
    else camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (!fitted && width > 240 && height > 260) {
      // A split column is narrower than a full-width stage; pull back once so
      // the base and both slabs fit without the operator having to zoom out.
      const aspect = width / height;
      const scale = aspect >= 1.6 ? 1 : aspect >= 1.15 ? 1.12 : 1.35;
      fittedPosition
        .copy(defaultPosition)
        .sub(defaultTarget)
        .multiplyScalar(scale)
        .add(defaultTarget);
      camera.position.copy(fittedPosition);
      controls.update();
      fitted = true;
    }
    const buffer = new THREE.Vector2(
      renderer.domElement.width,
      renderer.domElement.height,
    );
    resolution.copy(buffer);
    lineMaterial.resolution.copy(buffer);
    outline.uniforms.uResolution.value.copy(buffer);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let last = performance.now();
  let viewGoal: { position: THREE.Vector3; target: THREE.Vector3 } | undefined;
  const resolveView = (preset: TwinViewPreset) => {
    if (preset === 'screen' && centers.length) {
      const target = centers
        .reduce((sum, point) => sum.add(point), new THREE.Vector3())
        .multiplyScalar(1 / centers.length);
      return {
        target,
        position: target.clone().add(new THREE.Vector3(0, 0.45, 0.02)),
      };
    }
    return {
      target: defaultTarget.clone(),
      position: fittedPosition.clone(),
    };
  };

  const applyViewPreset = (preset: TwinViewPreset) => {
    if (preset === 'camera' && cameraProp) {
      cameraMode = true;
      viewGoal = undefined;
      controls.enabled = false;
      grid.visible = false;
      if (cameraPropRoot) cameraPropRoot.visible = false;
      const quaternion = new THREE.Quaternion(
        cameraProp.quaternion.x,
        cameraProp.quaternion.y,
        cameraProp.quaternion.z,
        cameraProp.quaternion.w,
      );
      // The body asset's lens is on its -Y side; the prop is flipped 180° about
      // its up axis so the lens faces the scene. Use the same flipped frame for
      // the optical view, otherwise the camera looks away from the screens.
      quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          Math.PI,
        ),
      );
      const forward = toWorldDirection(
        new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion),
      );
      const up = toWorldDirection(
        new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion),
      );
      camera.position.copy(toWorld(cameraProp.positionMm));
      camera.up.copy(up);
      camera.lookAt(camera.position.clone().add(forward));
      applyCameraViewFov();
      return;
    }
    cameraMode = false;
    controls.enabled = true;
    camera.fov = DEFAULT_FOV;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    grid.visible = true;
    if (cameraPropRoot) cameraPropRoot.visible = preset === 'default';
    if (preset === 'screen') camera.up.copy(screenUp);
    viewGoal = resolveView(preset);
  };
  renderer.setAnimationLoop(() => {
    if (!active) return;
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const ease = 1 - Math.exp(-dt * 18);
    for (let index = 0; index < currentJoints.length; index += 1) {
      const goal = targetJoints[index] ?? 0;
      currentJoints[index] += (goal - currentJoints[index]) * ease;
    }
    applyJoints();
    if (viewGoal) {
      camera.position.lerp(viewGoal.position, 0.18);
      controls.target.lerp(viewGoal.target, 0.18);
      if (
        camera.position.distanceTo(viewGoal.position) < 0.0015 &&
        controls.target.distanceTo(viewGoal.target) < 0.0015
      )
        viewGoal = undefined;
    }
    if (!cameraMode) controls.update();
    renderer.render(scene, camera);
  });

  const onLost = (event: Event) => {
    event.preventDefault();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    setJoints(values) {
      for (let index = 0; index < targetJoints.length; index += 1) {
        const value = values[index];
        if (Number.isFinite(value)) targetJoints[index] = value * DEG;
      }
    },
    alignToPose(positionMm, quaternion) {
      const mount = groups.get(visual.toolMountLink);
      if (!mount) return;
      const offset = snapshot.tool?.offsetMm ?? { x: 0, y: 0, z: 0 };
      const orientation = new THREE.Quaternion(
        quaternion.x,
        quaternion.y,
        quaternion.z,
        quaternion.w,
      );
      const tipOffset = new THREE.Vector3(
        offset.x,
        offset.y,
        offset.z,
      ).applyQuaternion(orientation);
      const measured = toWorld({
        x: positionMm.x + tipOffset.x,
        y: positionMm.y + tipOffset.y,
        z: positionMm.z + tipOffset.z,
      });
      const current = mount.localToWorld(
        new THREE.Vector3(
          (offset.x + mountOffsetMm[0]) / 1000,
          (offset.y + mountOffsetMm[1]) / 1000,
          (offset.z + mountOffsetMm[2]) / 1000,
        ),
      );
      const delta = measured.sub(current);
      if (!Number.isFinite(delta.length()) || delta.length() > 0.6) return;
      // The URDF base frame and the controller's Base frame differ by a constant
      // mount offset. Align once from an idle measured pose; re-applying the
      // correction while the arm moves would make the base chase the tool.
      if (aligned) return;
      robotRoot.position.add(delta);
      robotRoot.updateMatrixWorld(true);
      // The measured base is the table; keep the reference grid on it rather
      // than on the calibrated screen plane.
      grid.position.y = robotRoot.position.y;
      // The base sits below the screens after the offset; recenter vertically so
      // the arm does not hug the top edge of a tall split column.
      if (!cameraMode) {
        const pan = 0.04 - controls.target.y;
        if (Number.isFinite(pan) && Math.abs(pan) < 0.35) {
          controls.target.y += pan;
          camera.position.y += pan;
          controls.update();
        }
      }
      // A preset picked before the measured base arrived must not undo this pan.
      viewGoal = undefined;
      aligned = true;
    },
    setViewPreset(preset) {
      applyViewPreset(preset);
    },
    markScreenTexture(id) {
      const texture = screenTextures.get(id);
      if (texture) texture.needsUpdate = true;
    },
    setActive(next) {
      active = next;
      if (next) {
        last = performance.now();
        resize();
      }
    },
    resetView() {
      applyViewPreset('default');
    },
    dispose() {
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      renderer.setAnimationLoop(null);
      controls.dispose();
      for (const texture of screenTextures.values()) texture.dispose();
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
      });
      glass.dispose();
      outline.dispose();
      lineMaterial.dispose();
      for (const material of cameraMaterials) material.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
