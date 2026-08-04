import * as THREE from "three";
import {
  PIECE_HEIGHT,
  PIECE_SIZE,
  TRAY_RADIUS,
  TRAY_WALL_HEIGHT,
  TRAY_FLOOR_Y,
  TRAY_PIECES_PER_LAYER,
  COLOR,
} from "./config";

function createRoundedBoxGeometry(width: number, height: number, depth: number, radius: number, steps: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const w = width / 2 - radius;
  const d = depth / 2 - radius;
  const r = radius;

  shape.moveTo(-w, -d - r);
  shape.lineTo(w, -d - r);
  shape.quadraticCurveTo(w + r, -d - r, w + r, -d);
  shape.lineTo(w + r, d);
  shape.quadraticCurveTo(w + r, d + r, w, d + r);
  shape.lineTo(-w, d + r);
  shape.quadraticCurveTo(-w - r, d + r, -w - r, d);
  shape.lineTo(-w - r, -d);
  shape.quadraticCurveTo(-w - r, -d - r, -w, -d - r);

  const extrudeSettings = {
    steps: 1,
    depth: height - radius * 2,
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelOffset: 0,
    bevelSegments: steps,
  };

  const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geom.center();
  geom.rotateX(Math.PI / 2);
  return geom;
}

const pieceGeometry = createRoundedBoxGeometry(PIECE_SIZE, PIECE_HEIGHT, PIECE_SIZE, 0.035, 4);

const materialCache = new Map<number, THREE.MeshStandardMaterial>();
function materialFor(color: number): THREE.MeshStandardMaterial {
  const cached = materialCache.get(color);
  if (cached) return cached;

  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.12,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transmission: 0.15,
    thickness: 0.3,
    ior: 1.52,
  });
  materialCache.set(color, material);
  return material;
}

export type PieceOwner = "green" | "blue";

export interface Piece {
  mesh: THREE.Mesh;
  owner: PieceOwner;
  placed: boolean;
}

export function createPiece(owner: PieceOwner, color: number): Piece {
  const mesh = new THREE.Mesh(pieceGeometry, materialFor(color));
  mesh.userData.owner = owner;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, owner, placed: false };
}

/** A piece with its own (non-shared) transparent material, so it can fade out independently —
 *  used for the decorative menu-background board, which is cleared away when a real game starts. */
export function createDemoPiece(color: number): THREE.Mesh {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.12,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    transmission: 0.15,
    thickness: 0.3,
    ior: 1.52,
    transparent: true,
    opacity: 1,
  });
  const mesh = new THREE.Mesh(pieceGeometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createWeaveTexture(): THREE.CanvasTexture {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#7c4f2c";
  ctx.fillRect(0, 0, size, size);

  const strand = 14;
  for (let y = 0; y < size; y += strand) {
    const shade = Math.floor(y / strand) % 2 === 0 ? "rgba(50, 28, 12, 0.4)" : "rgba(196, 152, 100, 0.32)";
    ctx.fillStyle = shade;
    ctx.fillRect(0, y, size, strand * 0.6);
  }
  for (let x = 0; x < size; x += strand) {
    const shade = Math.floor(x / strand) % 2 === 0 ? "rgba(34, 18, 8, 0.22)" : "rgba(214, 172, 118, 0.2)";
    ctx.fillStyle = shade;
    ctx.fillRect(x, 0, strand * 0.6, size);
  }

  ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
  ctx.lineWidth = 1;
  for (let d = -size; d < size * 2; d += strand) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + size, size);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(12, 3);
  return texture;
}

const basketMaterial = new THREE.MeshStandardMaterial({
  map: createWeaveTexture(),
  roughness: 0.85,
  side: THREE.DoubleSide,
});
const basketFloorMaterial = new THREE.MeshStandardMaterial({ color: COLOR.basket, roughness: 0.9 });
const basketRimMaterial = new THREE.MeshStandardMaterial({ color: COLOR.woodDark, roughness: 0.5, metalness: 0.1 });
const basketBandMaterial = new THREE.MeshStandardMaterial({
  color: COLOR.gold,
  roughness: 0.35,
  metalness: 0.55,
  emissive: COLOR.gold,
  emissiveIntensity: 0.05,
});

const FLOOR_RADIUS_FACTOR = 0.86;

export function createTrayMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallH = TRAY_WALL_HEIGHT;
  const bottomRadius = TRAY_RADIUS * FLOOR_RADIUS_FACTOR;

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(TRAY_RADIUS, bottomRadius, wallH, 28, 1, true),
    basketMaterial
  );
  wall.position.y = TRAY_FLOOR_Y + wallH / 2;
  wall.name = "tray-basket";
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(TRAY_RADIUS, wallH * 0.13, 10, 32), basketRimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = TRAY_FLOOR_Y + wallH;
  rim.castShadow = true;
  rim.receiveShadow = true;
  group.add(rim);

  const band = new THREE.Mesh(
    new THREE.TorusGeometry(TRAY_RADIUS * 0.92, wallH * 0.045, 8, 32),
    basketBandMaterial
  );
  band.rotation.x = Math.PI / 2;
  band.position.y = TRAY_FLOOR_Y + wallH * 0.22;
  band.castShadow = true;
  band.receiveShadow = true;
  group.add(band);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(bottomRadius, 28), basketFloorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = TRAY_FLOOR_Y + 0.004;
  floor.receiveShadow = true;
  group.add(floor);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(TRAY_RADIUS * 1.35, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -0.01;
  group.add(shadow);

  return group;
}

/** Random resting spot inside a tray's circular basin, for scattering tiles. */
export function randomTraySpot(origin: { x: number; z: number }, layer: number): { x: number; y: number; z: number } {
  const maxRadius = TRAY_RADIUS * FLOOR_RADIUS_FACTOR - PIECE_SIZE / 2;
  const radius = maxRadius * Math.sqrt(Math.random());
  const angle = Math.random() * Math.PI * 2;
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: TRAY_FLOOR_Y + layer * PIECE_HEIGHT * 0.85 + PIECE_HEIGHT / 2,
    z: origin.z + Math.sin(angle) * radius,
  };
}

export function createScatteredPieces(
  owner: PieceOwner,
  color: number,
  count: number,
  origin: { x: number; z: number }
): Piece[] {
  const pieces: Piece[] = [];
  for (let i = 0; i < count; i++) {
    const piece = createPiece(owner, color);
    const layer = Math.floor(i / TRAY_PIECES_PER_LAYER);
    const spot = randomTraySpot(origin, layer);
    piece.mesh.position.set(spot.x, spot.y, spot.z);
    piece.mesh.rotation.y = Math.random() * Math.PI * 2;
    pieces.push(piece);
  }
  return pieces;
}
