import maplibregl, {
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MaplibreMap,
  type MapMouseEvent,
  type MercatorCoordinate,
} from "maplibre-gl";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const BUS_MODEL_URL = "/models/bus2.glb";
const SCENE_ORIGIN: [number, number] = [-90.049, 35.1495]; // Memphis [lng, lat]
/** Normalize imported GLB so its longest axis is this many meters. */
const TARGET_BUS_LENGTH_M = 10;
/**
 * Base visual scale at zoom 16 (after normalization ≈ 10m long).
 * Grows when zoomed out so buses stay readable at city overview.
 */
const BUS_SCALE_AT_Z16 = 8.5;
/** Tiny lift so wheels don't z-fight with the basemap. */
const GROUND_OFFSET_M = 0.35;
/**
 * bus2 nose vs GPS heading in the MapLibre scene. 0 = model +Z is forward.
 */
const MODEL_YAW_OFFSET_RAD = 0;
const LAYER_ID = "buses-3d";
const LABEL_NAME = "routeLabel";
/** Base pill size at zoom 16 (meters). Grows when zoomed out with the buses. */
const LABEL_BASE_W_M = 18;
const LABEL_BASE_H_M = 9;

/** Compass degrees (CW from north) → Three.js yaw for our scene (x=east,y=up,z=north). */
function headingToYawRad(headingDeg: number): number {
  return THREE.MathUtils.degToRad(headingDeg) + MODEL_YAW_OFFSET_RAD;
}

function scaleForZoom(zoom: number, highlighted: boolean): number {
  const zoomScale = Math.pow(2, (16 - zoom) * 0.7);
  const s = BUS_SCALE_AT_Z16 * THREE.MathUtils.clamp(zoomScale, 0.5, 22);
  return s * (highlighted ? 1.2 : 1);
}

/**
 * Align longest horizontal principal axis with +Z (nose/north at heading 0).
 * Sign prefers the +Z-ish half so we don't introduce a random 180° flip;
 * MODEL_YAW_OFFSET_RAD handles the known forward/back correction.
 */
function yawToAlignForwardWithPlusZ(object: THREE.Object3D): number {
  object.updateMatrixWorld(true);
  const world = new THREE.Vector3();
  let n = 0;
  let meanX = 0;
  let meanZ = 0;
  const xz: number[] = [];

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const attr = mesh.geometry?.attributes?.position;
    if (!attr) return;
    for (let i = 0; i < attr.count; i++) {
      world.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      xz.push(world.x, world.z);
      meanX += world.x;
      meanZ += world.z;
      n++;
    }
  });
  if (n < 8) return 0;

  meanX /= n;
  meanZ /= n;
  let xx = 0;
  let zz = 0;
  let xzCov = 0;
  for (let i = 0; i < n; i++) {
    const dx = xz[i * 2] - meanX;
    const dz = xz[i * 2 + 1] - meanZ;
    xx += dx * dx;
    zz += dz * dz;
    xzCov += dx * dz;
  }

  const angle = 0.5 * Math.atan2(2 * xzCov, xx - zz);
  let dx = Math.cos(angle);
  let dz = Math.sin(angle);
  const varAlong = xx * dx * dx + 2 * xzCov * dx * dz + zz * dz * dz;
  const varPerp = xx * dz * dz - 2 * xzCov * dx * dz + zz * dx * dx;
  if (varPerp > varAlong) {
    const t = dx;
    dx = -dz;
    dz = t;
  }
  if (dz < 0) {
    dx = -dx;
    dz = -dz;
  }
  return -Math.atan2(dx, dz);
}

export interface Bus3DVehicle {
  id: number;
  lat: number;
  lng: number;
  heading: number | null;
  status: string;
  route_short_name: string | null;
}

/** Soft multiply tints for the bus body — atlas features stay readable. */
function statusTintHex(status: string): number {
  let hex: number;
  if (status === "on-time") hex = 0xb8d2f5;
  else if (status === "delayed") hex = 0xf5bcbc;
  else if (status === "early") hex = 0xb8efc8;
  else hex = 0xf3dfb0;

  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l);
  return c.getHex();
}

/** Vivid RGB label colors by status. */
function statusLabelHex(status: string): number {
  if (status === "on-time") return 0x3b82f6; // blue
  if (status === "delayed") return 0xff3b30; // red
  if (status === "early") return 0x22c55e; // green
  return 0xf59e0b; // amber
}

function hexToCss(hex: number): string {
  return `#${new THREE.Color(hex).getHexString()}`;
}

/** Meters east/north from `from` → `to` in mercator space. */
function calculateDistanceMercatorToMeters(from: MercatorCoordinate, to: MercatorCoordinate) {
  const mercatorPerMeter = from.meterInMercatorCoordinateUnits();
  const dEastMeter = (to.x - from.x) / mercatorPerMeter;
  const dNorthMeter = (from.y - to.y) / mercatorPerMeter;
  return { dEastMeter, dNorthMeter };
}

/**
 * Multiply tint on body materials. Keeps baseColorTexture so windows / trim /
 * roof colors from the atlas remain; only shifts the overall hue slightly.
 */
function applyBodyTint(root: THREE.Object3D, tintHex: number) {
  const tint = new THREE.Color(tintHex);
  root.traverse((child) => {
    if (child.name === LABEL_NAME) return;
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!mat || !("color" in mat)) continue;
      const std = mat as THREE.MeshStandardMaterial;
      std.color.copy(tint);
      std.emissive.setRGB(0, 0, 0);
      std.emissiveIntensity = 0;
      if ("metalness" in std) std.metalness = Math.min(std.metalness ?? 0, 0.15);
      if ("roughness" in std) std.roughness = Math.max(std.roughness ?? 0.8, 0.65);
    }
  });
}

function cloneMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    if (child.name === LABEL_NAME) return;
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else if (mesh.material) {
      mesh.material = mesh.material.clone();
    }
  });
}

function drawRouteLabelCanvas(text: string, labelHex: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const label = text.trim() || "?";
  ctx.font = "bold 36px system-ui, -apple-system, sans-serif";
  const metrics = ctx.measureText(label);
  const padX = 16;
  const padY = 10;
  const w = Math.min(canvas.width - 8, Math.max(metrics.width + padX * 2, 52));
  const h = 36 + padY * 2;
  const x = (canvas.width - w) / 2;
  const y = (canvas.height - h) / 2;
  const r = h / 2;

  ctx.fillStyle = hexToCss(labelHex);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 1);
  return canvas;
}

function syncLabelScale(label: THREE.Sprite, busScale: number) {
  // Keep pills readable at city overview (~z13): grow strongly with bus exaggeration
  const worldW = LABEL_BASE_W_M * Math.max(1, busScale * 0.55);
  const worldH = LABEL_BASE_H_M * Math.max(1, busScale * 0.55);
  const inv = 1 / Math.max(busScale, 1e-6);
  label.scale.set(worldW * inv, worldH * inv, 1);
}

function createRouteLabel(text: string, labelHex: number, busHeightM: number): THREE.Sprite {
  const canvas = drawRouteLabelCanvas(text, labelHex);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.name = LABEL_NAME;
  sprite.scale.set(LABEL_BASE_W_M, LABEL_BASE_H_M, 1);
  sprite.position.set(0, busHeightM + 1.8, 0);
  sprite.renderOrder = 10;
  sprite.userData.routeText = text;
  sprite.userData.labelHex = labelHex;
  return sprite;
}

function updateRouteLabel(sprite: THREE.Sprite, text: string, labelHex: number) {
  if (sprite.userData.routeText === text && sprite.userData.labelHex === labelHex) return;
  const canvas = drawRouteLabelCanvas(text, labelHex);
  const mat = sprite.material as THREE.SpriteMaterial;
  const old = mat.map;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  mat.map = tex;
  mat.needsUpdate = true;
  old?.dispose();
  sprite.userData.routeText = text;
  sprite.userData.labelHex = labelHex;
}

interface BusInstance {
  root: THREE.Group;
  tint: number;
  heading: number;
  label: THREE.Sprite;
  routeName: string | null;
}

/**
 * MapLibre custom layer that renders live buses as Three.js GLB models.
 *
 * Scene axes (after onAdd setup) match MapLibre's terrain example:
 *   x = east, y = up, z = north
 */
export class Bus3DLayer implements CustomLayerInterface {
  id = LAYER_ID;
  type = "custom" as const;
  renderingMode = "3d" as const;

  private map: MaplibreMap | null = null;
  private camera = new THREE.Camera();
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer | null = null;
  private template: THREE.Group | null = null;
  private templateHeightM = 3.2;
  private loading: Promise<void> | null = null;
  private buses = new globalThis.Map<number, BusInstance>();
  private highlightRoutes = new Set<string>();
  private onBusClick: ((busId: number) => void) | null = null;
  private clickHandler: ((e: MapMouseEvent) => void) | null = null;

  setOnBusClick(cb: ((busId: number) => void) | null) {
    this.onBusClick = cb;
  }

  setHighlightRoutes(names: Set<string>) {
    this.highlightRoutes = names;
  }

  async setVehicles(vehicles: Bus3DVehicle[]) {
    if (!this.template) {
      await this.ensureModel();
    }
    if (!this.template || !this.map) return;

    const originMerc = maplibregl.MercatorCoordinate.fromLngLat(SCENE_ORIGIN, 0);
    const zoom = this.map.getZoom();
    const seen = new Set<number>();

    for (const v of vehicles) {
      seen.add(v.id);
      const tint = statusTintHex(v.status);
      const labelHex = statusLabelHex(v.status);
      const heading = v.heading ?? 0;
      const highlighted =
        v.route_short_name != null && this.highlightRoutes.has(v.route_short_name);
      const routeText = v.route_short_name?.trim() || "?";

      let inst = this.buses.get(v.id);
      if (!inst) {
        const root = this.template.clone(true);
        cloneMaterials(root);
        applyBodyTint(root, tint);
        root.rotation.order = "YXZ";
        const label = createRouteLabel(routeText, labelHex, this.templateHeightM);
        root.add(label);
        this.scene.add(root);
        inst = { root, tint, heading, label, routeName: v.route_short_name };
        this.buses.set(v.id, inst);
      } else {
        if (inst.tint !== tint) {
          applyBodyTint(inst.root, tint);
          inst.tint = tint;
        }
        if (inst.routeName !== v.route_short_name || inst.label.userData.labelHex !== labelHex) {
          updateRouteLabel(inst.label, routeText, labelHex);
          inst.routeName = v.route_short_name;
        }
      }

      const busMerc = maplibregl.MercatorCoordinate.fromLngLat([v.lng, v.lat], 0);
      const { dEastMeter, dNorthMeter } = calculateDistanceMercatorToMeters(originMerc, busMerc);

      const terrainUp =
        (this.map.queryTerrainElevation?.([v.lng, v.lat]) ?? 0) -
        (this.map.queryTerrainElevation?.(SCENE_ORIGIN) ?? 0);

      inst.root.position.set(dEastMeter, terrainUp + GROUND_OFFSET_M, dNorthMeter);
      inst.root.rotation.set(0, headingToYawRad(heading), 0);
      const busScale = scaleForZoom(zoom, highlighted);
      inst.root.scale.setScalar(busScale);
      syncLabelScale(inst.label, busScale);
      inst.heading = heading;
      inst.root.userData.lngLat = [v.lng, v.lat] as [number, number];
      inst.root.userData.highlighted = highlighted;
      inst.root.visible = true;
    }

    for (const [id, inst] of this.buses) {
      if (!seen.has(id)) {
        this.scene.remove(inst.root);
        inst.root.traverse((obj) => {
          if (obj.name === LABEL_NAME) {
            const sprite = obj as THREE.Sprite;
            const mat = sprite.material as THREE.SpriteMaterial;
            mat.map?.dispose();
            mat.dispose();
            return;
          }
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m?.dispose?.();
        });
        this.buses.delete(id);
      }
    }

    this.map.triggerRepaint();
  }

  private ensureModel(): Promise<void> {
    if (this.template) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = new Promise((resolve) => {
      const loader = new GLTFLoader();
      loader.load(
        BUS_MODEL_URL,
        (gltf) => {
          const root = new THREE.Group();
          root.add(gltf.scene);

          // bus2 is already length-along-Z; PCA still runs for any future drop-in.
          gltf.scene.rotation.y = yawToAlignForwardWithPlusZ(gltf.scene);
          gltf.scene.updateMatrixWorld(true);

          const rawBox = new THREE.Box3().setFromObject(root);
          const size = new THREE.Vector3();
          rawBox.getSize(size);
          const longest = Math.max(size.x, size.y, size.z, 1e-6);
          gltf.scene.scale.setScalar(TARGET_BUS_LENGTH_M / longest);

          const box = new THREE.Box3().setFromObject(root);
          const center = new THREE.Vector3();
          box.getCenter(center);
          gltf.scene.position.x -= center.x;
          gltf.scene.position.z -= center.z;
          gltf.scene.position.y -= box.min.y;

          const grounded = new THREE.Box3().setFromObject(root);
          this.templateHeightM = grounded.max.y - grounded.min.y;

          // Preserve atlas texture(s); only soft-tint per instance later.
          root.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
              const std = mat as THREE.MeshStandardMaterial;
              if (std.map) std.map.colorSpace = THREE.SRGBColorSpace;
            }
          });

          this.template = root;
          this.map?.triggerRepaint();
          resolve();
        },
        undefined,
        (err) => {
          console.error("Failed to load bus2.glb", err);
          this.template = this.createFallbackBus();
          this.templateHeightM = 3.2;
          this.map?.triggerRepaint();
          resolve();
        }
      );
    });

    return this.loading;
  }

  private createFallbackBus(): THREE.Group {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x7eb6d9,
      metalness: 0.05,
      roughness: 0.7,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, metalness: 0.1, roughness: 0.55 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.05,
      roughness: 0.2,
      transparent: true,
      opacity: 0.85,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 10), bodyMat);
    body.position.y = 1.7;
    body.name = "body";
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.25, 9.2), bodyMat.clone());
    roof.position.y = 3.1;
    roof.name = "roof";
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.15), glassMat);
    windshield.position.set(0, 2.3, 4.7);
    windshield.name = "windshield";
    const wheelGeo = new THREE.BoxGeometry(0.35, 0.9, 0.9);
    for (const [x, z] of [
      [-1.1, 3.2],
      [1.1, 3.2],
      [-1.1, -3.2],
      [1.1, -3.2],
    ] as const) {
      const w = new THREE.Mesh(wheelGeo, darkMat);
      w.position.set(x, 0.45, z);
      w.name = "wheel";
      g.add(w);
    }
    g.add(body, roof, windshield);
    return g;
  }

  onAdd = (map: MaplibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) => {
    this.map = map;
    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();

    // Align Three.js with MapLibre mercator (official terrain example):
    // after this, scene axes are x=east, y=up, z=north
    this.scene.rotateX(Math.PI / 2);
    this.scene.scale.multiply(new THREE.Vector3(1, 1, -1));

    // Softer lights so textured roofs don't blow out white by heading
    const ambient = new THREE.AmbientLight(0xffffff, 1.15);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(40, 80, 30).normalize();
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 0.45);
    fill.position.set(-50, 40, -20).normalize();
    this.scene.add(fill);

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    void this.ensureModel();

    this.clickHandler = (e) => {
      if (!this.onBusClick || this.buses.size === 0) return;
      let bestId: number | null = null;
      let bestDist = 42;
      for (const [id, inst] of this.buses) {
        const lngLat = inst.root.userData.lngLat as [number, number] | undefined;
        if (!lngLat) continue;
        const pt = map.project(lngLat);
        const d = Math.hypot(pt.x - e.point.x, pt.y - e.point.y);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
      if (bestId != null) {
        e.preventDefault();
        this.onBusClick(bestId);
      }
    };
    map.on("click", this.clickHandler);
  };

  onRemove = () => {
    if (this.map && this.clickHandler) {
      this.map.off("click", this.clickHandler);
    }
    for (const inst of this.buses.values()) {
      this.scene.remove(inst.root);
    }
    this.buses.clear();
    this.renderer?.dispose();
    this.renderer = null;
    this.map = null;
  };

  render = (_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) => {
    if (!this.renderer || !this.map) return;

    const zoom = this.map.getZoom();
    for (const inst of this.buses.values()) {
      const highlighted = Boolean(inst.root.userData.highlighted);
      const busScale = scaleForZoom(zoom, highlighted);
      inst.root.scale.setScalar(busScale);
      syncLabelScale(inst.label, busScale);
    }

    const elevation = this.map.queryTerrainElevation?.(SCENE_ORIGIN) ?? 0;
    const originMerc = maplibregl.MercatorCoordinate.fromLngLat(SCENE_ORIGIN, elevation);
    const scale = originMerc.meterInMercatorCoordinateUnits();

    const m = new THREE.Matrix4().fromArray(Array.from(args.defaultProjectionData.mainMatrix));
    const l = new THREE.Matrix4()
      .makeTranslation(originMerc.x, originMerc.y, originMerc.z)
      .scale(new THREE.Vector3(scale, -scale, scale));

    this.camera.projectionMatrix = m.multiply(l);
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  };

  attachLngLat(busId: number, lng: number, lat: number) {
    const inst = this.buses.get(busId);
    if (inst) inst.root.userData.lngLat = [lng, lat];
  }
}

export async function syncBus3DLayer(
  layer: Bus3DLayer,
  vehicles: Bus3DVehicle[],
  highlightRoutes: Set<string>
) {
  layer.setHighlightRoutes(highlightRoutes);
  await layer.setVehicles(vehicles);
  for (const v of vehicles) {
    layer.attachLngLat(v.id, v.lng, v.lat);
  }
}

export const BUS_3D_LAYER_ID = LAYER_ID;
