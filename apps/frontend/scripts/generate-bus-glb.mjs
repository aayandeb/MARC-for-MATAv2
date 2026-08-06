/**
 * Generates a simple stylized bus GLB for MapLibre 3D markers.
 * Run: node scripts/generate-bus-glb.mjs
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../public/models/bus.glb");

function box(sx, sy, sz, ox = 0, oy = 0, oz = 0) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  // Y-up, bus length along +Z (nose toward +Z)
  const positions = [
    // +X
    hx, -hy, -hz, hx, -hy, hz, hx, hy, hz, hx, hy, -hz,
    // -X
    -hx, -hy, hz, -hx, -hy, -hz, -hx, hy, -hz, -hx, hy, hz,
    // +Y
    -hx, hy, -hz, hx, hy, -hz, hx, hy, hz, -hx, hy, hz,
    // -Y
    -hx, -hy, hz, hx, -hy, hz, hx, -hy, -hz, -hx, -hy, -hz,
    // +Z (nose)
    -hx, -hy, hz, -hx, hy, hz, hx, hy, hz, hx, -hy, hz,
    // -Z (rear)
    hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz, -hx, -hy, -hz,
  ].map((v, i) => {
    const axis = i % 3;
    if (axis === 0) return v + ox;
    if (axis === 1) return v + oy;
    return v + oz;
  });

  const normals = [
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
  ];

  const indices = [];
  for (let f = 0; f < 6; f++) {
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }

  return { positions, normals, indices };
}

function appendMesh(doc, name, material, part) {
  const { positions, normals, indices } = part;
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const pos = doc
    .createAccessor(`${name}_pos`)
    .setType("VEC3")
    .setArray(new Float32Array(positions))
    .setBuffer(buffer);
  const norm = doc
    .createAccessor(`${name}_norm`)
    .setType("VEC3")
    .setArray(new Float32Array(normals))
    .setBuffer(buffer);
  const idx = doc
    .createAccessor(`${name}_idx`)
    .setType("SCALAR")
    .setArray(new Uint16Array(indices))
    .setBuffer(buffer);

  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", pos)
    .setAttribute("NORMAL", norm)
    .setIndices(idx)
    .setMaterial(material);

  return doc.createMesh(name).addPrimitive(prim);
}

async function main() {
  const doc = new Document();
  doc.createBuffer();

  const bodyMat = doc
    .createMaterial("BusBody")
    .setBaseColorFactor([0.15, 0.45, 0.9, 1])
    .setMetallicFactor(0.15)
    .setRoughnessFactor(0.55);
  const darkMat = doc
    .createMaterial("BusDark")
    .setBaseColorFactor([0.12, 0.16, 0.22, 1])
    .setMetallicFactor(0.2)
    .setRoughnessFactor(0.4);
  const glassMat = doc
    .createMaterial("BusGlass")
    .setBaseColorFactor([0.15, 0.2, 0.28, 0.85])
    .setMetallicFactor(0.05)
    .setRoughnessFactor(0.15)
    .setAlphaMode("BLEND");
  const wheelMat = doc
    .createMaterial("BusWheel")
    .setBaseColorFactor([0.08, 0.08, 0.1, 1])
    .setMetallicFactor(0.1)
    .setRoughnessFactor(0.85);

  // Dimensions in meters: ~2.4m wide, 3.2m tall, 10m long
  const body = appendMesh(doc, "body", bodyMat, box(2.4, 2.6, 10.0, 0, 1.7, 0));
  const roof = appendMesh(doc, "roof", bodyMat, box(2.1, 0.25, 9.2, 0, 3.1, 0));
  const windshield = appendMesh(doc, "windshield", glassMat, box(2.0, 1.0, 0.15, 0, 2.3, 4.7));
  const rearWindow = appendMesh(doc, "rearWindow", glassMat, box(2.0, 0.8, 0.12, 0, 2.3, -4.6));
  const cabinStripe = appendMesh(doc, "stripe", darkMat, box(2.42, 0.35, 9.6, 0, 2.5, 0));
  const mirrorL = appendMesh(doc, "mirrorL", darkMat, box(0.15, 0.35, 0.4, -1.35, 2.4, 3.8));
  const mirrorR = appendMesh(doc, "mirrorR", darkMat, box(0.15, 0.35, 0.4, 1.35, 2.4, 3.8));

  const wheels = [
    [-1.1, 0.45, 3.2],
    [1.1, 0.45, 3.2],
    [-1.1, 0.45, -3.2],
    [1.1, 0.45, -3.2],
  ].map(([x, y, z], i) =>
    appendMesh(doc, `wheel${i}`, wheelMat, box(0.35, 0.9, 0.9, x, y, z))
  );

  const root = doc.createNode("Bus").setTranslation([0, 0, 0]);
  for (const mesh of [body, roof, windshield, rearWindow, cabinStripe, mirrorL, mirrorR, ...wheels]) {
    root.addChild(doc.createNode(mesh.getName()).setMesh(mesh));
  }

  doc.createScene("BusScene").addChild(root);

  mkdirSync(dirname(outPath), { recursive: true });
  const io = new NodeIO();
  await io.write(outPath, doc);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
