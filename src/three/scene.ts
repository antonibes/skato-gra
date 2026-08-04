import * as THREE from "three";
import { COLOR } from "./config";

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createSceneRig(canvas: HTMLCanvasElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR.graphite900);
  scene.fog = new THREE.Fog(COLOR.graphite900, 24, 46);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);

  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  const key = new THREE.DirectionalLight(0xfff2d9, 0.9);
  key.position.set(0, 8, 4);
  scene.add(ambient, key);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  return { renderer, scene, camera };
}
