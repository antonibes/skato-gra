import * as THREE from "three";
import { TABLE_WIDTH, TABLE_DEPTH, COLOR } from "./config";

function createOakTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#c19565";
  ctx.fillRect(0, 0, size, size);

  const plankCount = 5;
  const plankWidth = size / plankCount;
  for (let i = 0; i < plankCount; i++) {
    ctx.fillStyle = i % 2 === 0 ? "rgba(255, 235, 205, 0.05)" : "rgba(60, 34, 12, 0.06)";
    ctx.fillRect(i * plankWidth, 0, plankWidth, size);
    ctx.strokeStyle = "rgba(60, 34, 12, 0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(i * plankWidth, 0);
    ctx.lineTo(i * plankWidth, size);
    ctx.stroke();
  }

  for (let i = 0; i < 90; i++) {
    const y = Math.random() * size;
    const amplitude = Math.random() * 14 - 7;
    ctx.strokeStyle = Math.random() > 0.5 ? "rgba(90, 55, 24, 0.16)" : "rgba(230, 195, 150, 0.14)";
    ctx.lineWidth = Math.random() * 1.4 + 0.3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(size / 2, y + amplitude, size, y - amplitude * 0.6);
    ctx.stroke();
  }

  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.75);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(35, 18, 8, 0.25)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(TABLE_WIDTH / 4, TABLE_DEPTH / 4);
  return texture;
}

export function createTable(): THREE.Group {
  const group = new THREE.Group();
  group.name = "table";

  const top = new THREE.Mesh(
    new THREE.PlaneGeometry(TABLE_WIDTH, TABLE_DEPTH),
    new THREE.MeshStandardMaterial({ map: createOakTexture(), roughness: 0.75 })
  );
  top.rotation.x = -Math.PI / 2;
  top.position.y = -0.42;
  group.add(top);

  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_WIDTH, 0.3, TABLE_DEPTH),
    new THREE.MeshStandardMaterial({ color: COLOR.woodDark, roughness: 0.7 })
  );
  edge.position.y = -0.58;
  group.add(edge);

  return group;
}
