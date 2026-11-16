#!/usr/bin/env node
/**
 * Derive the twin's C922 prop from the full camera + folded-stand mesh.
 *
 * The source is a binary STL in millimetres with 33 disconnected shells. The
 * camera body starts at z ≈ 58.8 mm while the stand reaches down to z = 0, so
 * keeping only connected components whose lowest vertex is above 55 mm removes
 * the stand without clipping the body. Vertex clustering then trades the
 * perforated grille's sub-millimetre detail for a much smaller download.
 *
 * Usage:
 *   node scripts/split-camera-body.mjs [--cell 0.4] [--min-z 55]
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(
  root,
  'public/models/mg400/logitech-c922-accurate.stl',
);
const target = path.join(root, 'public/models/mg400/logitech-c922-body.stl');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= args.length) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
};
const cell = Math.max(0.05, option('cell', 0.4));
const minZ = option('min-z', 55);

function readStl(file) {
  const buffer = fs.readFileSync(file);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return new STLLoader().parse(arrayBuffer);
}

function unionFind(count) {
  const parent = new Int32Array(count);
  for (let index = 0; index < count; index += 1) parent[index] = index;
  const find = (start) => {
    let root = start;
    while (parent[root] !== root) root = parent[root];
    let current = start;
    while (parent[current] !== current) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  return { find, union };
}

function componentMinZ(geometry) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('Expected an indexed STL geometry');
  const { find, union } = unionFind(position.count);
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const a = index.getX(triangle);
    const b = index.getX(triangle + 1);
    const c = index.getX(triangle + 2);
    union(a, b);
    union(b, c);
  }
  const minimum = new Float64Array(position.count).fill(
    Number.POSITIVE_INFINITY,
  );
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const root = find(vertex);
    minimum[root] = Math.min(minimum[root], position.getZ(vertex));
  }
  return { find, minimum };
}

function bodyTriangles(geometry, minimum, find, cutoff) {
  const index = geometry.getIndex();
  const selected = [];
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const root = find(index.getX(triangle));
    if (minimum[root] > cutoff) selected.push(triangle);
  }
  return selected;
}

function clusterBody(geometry, triangles, size) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const clusterOf = new Int32Array(position.count).fill(-1);
  const byKey = new Map();
  const sums = [];
  const counts = [];
  const cluster = (vertex) => {
    const existing = clusterOf[vertex];
    if (existing !== -1) return existing;
    const x = position.getX(vertex);
    const y = position.getY(vertex);
    const z = position.getZ(vertex);
    const key = `${Math.round(x / size)},${Math.round(y / size)},${Math.round(z / size)}`;
    let id = byKey.get(key);
    if (id === undefined) {
      id = sums.length;
      byKey.set(key, id);
      sums.push([0, 0, 0]);
      counts.push(0);
    }
    sums[id][0] += x;
    sums[id][1] += y;
    sums[id][2] += z;
    counts[id] += 1;
    clusterOf[vertex] = id;
    return id;
  };
  for (const triangle of triangles) {
    cluster(index.getX(triangle));
    cluster(index.getX(triangle + 1));
    cluster(index.getX(triangle + 2));
  }
  const averaged = sums.map(([x, y, z], id) => [
    x / counts[id],
    y / counts[id],
    z / counts[id],
  ]);
  const faces = [];
  const seen = new Set();
  for (const triangle of triangles) {
    const a = clusterOf[index.getX(triangle)];
    const b = clusterOf[index.getX(triangle + 1)];
    const c = clusterOf[index.getX(triangle + 2)];
    if (a === b || b === c || c === a) continue;
    const key = [a, b, c].sort((left, right) => left - right).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push([averaged[a], averaged[b], averaged[c]]);
  }
  return faces;
}

function writeBinaryStl(faces, output) {
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.write('C922 body, no stand, vertex-clustered', 0, 'ascii');
  buffer.writeUInt32LE(faces.length, 80);
  let offset = 84;
  const normal = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (const face of faces) {
    a.fromArray(face[0]);
    b.fromArray(face[1]);
    c.fromArray(face[2]);
    normal.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const value of [normal.x, normal.y, normal.z]) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
    for (const point of [a, b, c]) {
      for (const value of [point.x, point.y, point.z]) {
        buffer.writeFloatLE(value, offset);
        offset += 4;
      }
    }
    buffer.writeUInt16LE(0, offset);
    offset += 2;
  }
  fs.writeFileSync(output, buffer);
  return buffer.length;
}

const raw = readStl(source);
const sourceTriangles = raw.attributes.position.count / 3;
const sourceBytes = fs.statSync(source).size;
const welded = mergeVertices(raw, 0.01);
raw.dispose();
const { find, minimum } = componentMinZ(welded);
const triangles = bodyTriangles(welded, minimum, find, minZ);
const faces = clusterBody(welded, triangles, cell);
const bytes = writeBinaryStl(faces, target);

console.log(
  `source ${(sourceBytes / 1024 / 1024).toFixed(2)} MiB, ` +
    `${sourceTriangles} triangles`,
);
console.log(
  `body ${(bytes / 1024 / 1024).toFixed(2)} MiB, ${faces.length} triangles, ` +
    `cell ${cell} mm, z > ${minZ} mm`,
);
console.log(`wrote ${path.relative(root, target)}`);
