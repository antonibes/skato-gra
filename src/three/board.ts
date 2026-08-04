import * as THREE from "three";
import { BOARD_SIZE, BOARD_HALF, BOARD_FRAME_THICKNESS, COLOR } from "./config";

function createGridTexture(): THREE.CanvasTexture {
  const resolution = 96;
  const size = resolution * BOARD_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  // Walnut base wood
  ctx.fillStyle = "#5c3d26";
  ctx.fillRect(0, 0, size, size);

  // Vertical wood planks
  const plankWidth = size / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255, 235, 205, 0.03)" : "rgba(20, 10, 5, 0.05)";
    ctx.fillRect(i * plankWidth, 0, plankWidth, size);
    // Subtle plank seam
    ctx.strokeStyle = "rgba(20, 10, 5, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(i * plankWidth, 0);
    ctx.lineTo(i * plankWidth, size);
    ctx.stroke();
  }

  // Wood grain lines
  for (let i = 0; i < 180; i++) {
    const y = Math.random() * size;
    const amplitude = Math.random() * 16 - 8;
    ctx.strokeStyle = Math.random() > 0.5 ? "rgba(25, 12, 5, 0.28)" : "rgba(240, 200, 150, 0.12)";
    ctx.lineWidth = Math.random() * 1.5 + 0.3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(size / 2, y + amplitude, size, y - amplitude * 0.4);
    ctx.stroke();
  }

  // Draw 8x8 cells with beveled edges and distinct shading
  const cellSize = resolution;
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const x = c * cellSize;
      const y = r * cellSize;

      // Subtle checkering to easily see the cells
      ctx.fillStyle = (c + r) % 2 === 0 ? "rgba(255, 240, 220, 0.04)" : "rgba(0, 0, 0, 0.06)";
      ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);

      // Engraved look: shadow on bottom and right, highlight on top and left
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)"; // top/left highlight
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + cellSize - 2, y + 2);
      ctx.lineTo(x + 2, y + 2);
      ctx.lineTo(x + 2, y + cellSize - 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)"; // bottom/right shadow
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + cellSize - 2);
      ctx.lineTo(x + cellSize - 2, y + cellSize - 2);
      ctx.lineTo(x + cellSize - 2, y + 2);
      ctx.stroke();
    }
  }

  // Solid dark lines between cells to outline them clearly
  ctx.strokeStyle = "rgba(35, 20, 10, 0.85)";
  ctx.lineWidth = 2.5;
  for (let i = 0; i <= BOARD_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * resolution, 0);
    ctx.lineTo(i * resolution, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * resolution);
    ctx.lineTo(size, i * resolution);
    ctx.stroke();
  }

  // Gold outer frame border on the texture
  ctx.strokeStyle = "rgba(201, 162, 75, 0.85)";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);

  // Star points at cell intersections
  ctx.fillStyle = "rgba(201, 162, 75, 0.85)";
  const starPoints = [
    [2, 2],
    [2, BOARD_SIZE - 2],
    [BOARD_SIZE - 2, 2],
    [BOARD_SIZE - 2, BOARD_SIZE - 2],
    [BOARD_SIZE / 2, BOARD_SIZE / 2],
  ];
  for (const [col, row] of starPoints) {
    ctx.beginPath();
    ctx.arc(col * resolution, row * resolution, resolution * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vignette effect to darken edges
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  return texture;
}

export function createBoard(): THREE.Group {
  const group = new THREE.Group();
  group.name = "board";

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE),
    new THREE.MeshStandardMaterial({ map: createGridTexture(), roughness: 0.8 })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.name = "board-surface";
  surface.receiveShadow = true;
  group.add(surface);

  const frameThickness = BOARD_FRAME_THICKNESS;
  const frameHeight = 0.24;
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: COLOR.wood,
    roughness: 0.55,
    metalness: 0.06,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: COLOR.gold,
    roughness: 0.35,
    metalness: 0.6,
    emissive: COLOR.gold,
    emissiveIntensity: 0.06,
  });

  // A single seamless ring (outer square with an inner square hole cut out) instead of four
  // separate boxes butted together — abutting boxes meet at an exact floating-point boundary,
  // which is a classic z-fighting setup (flickering/jagged seams, worst at grazing view angles).
  const outerHalf = BOARD_HALF + frameThickness;
  const ringShape = new THREE.Shape();
  ringShape.moveTo(-outerHalf, -outerHalf);
  ringShape.lineTo(outerHalf, -outerHalf);
  ringShape.lineTo(outerHalf, outerHalf);
  ringShape.lineTo(-outerHalf, outerHalf);
  ringShape.lineTo(-outerHalf, -outerHalf);

  const ringHole = new THREE.Path();
  ringHole.moveTo(-BOARD_HALF, -BOARD_HALF);
  ringHole.lineTo(-BOARD_HALF, BOARD_HALF);
  ringHole.lineTo(BOARD_HALF, BOARD_HALF);
  ringHole.lineTo(BOARD_HALF, -BOARD_HALF);
  ringHole.lineTo(-BOARD_HALF, -BOARD_HALF);
  ringShape.holes.push(ringHole);

  const frameGeometry = new THREE.ExtrudeGeometry(ringShape, { depth: frameHeight, bevelEnabled: false });
  const frameMesh = new THREE.Mesh(frameGeometry, frameMaterial);
  frameMesh.rotation.x = -Math.PI / 2;
  frameMesh.position.y = -frameHeight;
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);

  const trimGeometry = new THREE.ShapeGeometry(ringShape);
  const trimMesh = new THREE.Mesh(trimGeometry, trimMaterial);
  trimMesh.rotation.x = -Math.PI / 2;
  trimMesh.position.y = 0.006;
  trimMesh.castShadow = true;
  trimMesh.receiveShadow = true;
  group.add(trimMesh);

  return group;
}
