import * as THREE from "three";
import { COLOR } from "./config";

export interface SceneRig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export function createSceneRig(canvas: HTMLCanvasElement): SceneRig {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    precision: "mediump"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR.graphite900);
  scene.fog = new THREE.Fog(COLOR.graphite900, 45, 95);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 100);

  // Soft ambient light for general base visibility
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);

  // Warm, powerful key light casting high-quality soft shadows
  const keyLight = new THREE.DirectionalLight(0xffeed9, 1.45);
  keyLight.position.set(5, 12, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 25;
  const d = 8;
  keyLight.shadow.camera.left = -d;
  keyLight.shadow.camera.right = d;
  keyLight.shadow.camera.top = d;
  keyLight.shadow.camera.bottom = -d;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;

  // Cool fill light to create depth and contrast
  const fillLight = new THREE.DirectionalLight(0xdbe9ff, 0.45);
  fillLight.position.set(-6, 8, -4);

  scene.add(ambient, keyLight, fillLight);

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
