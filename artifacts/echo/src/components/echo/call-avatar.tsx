import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const callHair = { swept: 'Peinado hacia atrás', fringe: 'Flequillo', long: 'Largo suelto' };
export const callClothes = { black: 'Remera negra', burgundy: 'Buzo bordó', cream: 'Suéter crema' };
export const callExpressions = { neutral: 'Neutral', smile: 'Sonrisa', surprised: 'Sorpresa' };

export interface CallAvatarLook {
  hair: keyof typeof callHair;
  clothes: keyof typeof callClothes;
  expression: keyof typeof callExpressions;
}

export function CallAvatar({ look, speaking }: { look: CallAvatarLook; speaking: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ look, speaking });
  current.current = { look, speaking };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: element, alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0.1, 6.5);
    const ambient = new THREE.HemisphereLight(0xffeee5, 0x8880ab, 2.2);
    const keyLight = new THREE.DirectionalLight(0xffeadf, 2);
    keyLight.position.set(-2, 3, 4);
    scene.add(ambient, keyLight);

    const geometry = new THREE.SphereGeometry(1, 24, 16);
    const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.84 });
    const skin = material(0xe8ad94);
    const hair = material(0x201821);
    const fabric = material(0x25232d);
    const eye = material(0x302027);
    const lip = material(0x884854);
    const colors = { black: 0x25232d, burgundy: 0x74263b, cream: 0xd6c5aa };

    function shape(parent: THREE.Object3D, surface: THREE.Material, position: [number, number, number], size: [number, number, number]) {
      const mesh = new THREE.Mesh(geometry, surface);
      mesh.position.set(...position);
      mesh.scale.set(...size);
      parent.add(mesh);
      return mesh;
    }

    const torso = shape(scene, fabric, [0, -1.16, 0], [0.91, 0.68, 0.45]);
    const hood = shape(scene, fabric, [0, -0.53, -0.18], [0.55, 0.42, 0.35]);
    const collar = shape(scene, fabric, [0, -0.69, 0.08], [0.34, 0.16, 0.31]);
    shape(scene, skin, [0, -0.68, 0], [0.24, 0.37, 0.23]);
    const head = new THREE.Group();
    scene.add(head);
    shape(head, skin, [0, 0.22, 0], [0.65, 0.82, 0.55]);
    shape(head, skin, [0, 0.16, 0.53], [0.105, 0.15, 0.11]);
    shape(head, hair, [0, 0.69, -0.12], [0.69, 0.48, 0.57]);
    const eyes = [-1, 1].map(side => shape(head, eye, [side * 0.23, 0.34, 0.51], [0.066, 0.045, 0.026]));
    const brows = [-1, 1].map(side => shape(head, hair, [side * 0.23, 0.47, 0.49], [0.105, 0.024, 0.035]));
    const mouth = shape(head, lip, [0, -0.19, 0.483], [0.13, 0.035, 0.03]);
    const styles = Object.fromEntries(Object.keys(callHair).map(name => [name, new THREE.Group()])) as Record<CallAvatarLook['hair'], THREE.Group>;
    head.add(...Object.values(styles));
    shape(styles.swept, hair, [-0.2, 0.86, 0.27], [0.5, 0.22, 0.36]).rotation.z = 0.25;
    for (const side of [-1, 1]) {
      shape(styles.long, hair, [side * 0.56, 0.01, 0.04], [0.21, 0.99, 0.35]).rotation.z = side * 0.12;
    }
    for (const offset of [-0.34, -0.13, 0.1, 0.32]) {
      shape(styles.fringe, hair, [offset, 0.61, 0.43], [0.16, 0.21, 0.17]).rotation.z = -0.35;
    }

    const observer = new ResizeObserver(() => {
      const { clientWidth: width, clientHeight: height } = element;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    observer.observe(element);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    renderer.setAnimationLoop(milliseconds => {
      const time = milliseconds / 1000;
      const { look, speaking } = current.current;
      const smile = look.expression === 'smile';
      const surprised = look.expression === 'surprised';
      const blink = !reduceMotion.matches && time % 4.7 > 4.57;
      for (const name of Object.keys(callHair) as Array<keyof typeof callHair>) styles[name].visible = name === look.hair;
      fabric.color.setHex(colors[look.clothes]);
      hood.visible = look.clothes === 'burgundy';
      collar.visible = look.clothes !== 'black';
      torso.scale.x = hood.visible ? 0.99 : 0.91;
      head.rotation.y = reduceMotion.matches ? 0 : Math.sin(time * 0.85) * 0.085;
      for (const part of eyes) part.scale.y = blink ? 0.007 : surprised ? 0.072 : 0.045;
      for (const brow of brows) brow.position.y = surprised ? 0.52 : 0.47;
      mouth.position.y = smile ? -0.16 : -0.19;
      mouth.scale.x = smile ? 0.18 : surprised ? 0.092 : 0.13;
      mouth.scale.y = speaking ? 0.027 + Math.abs(Math.sin(time * 17)) * 0.072 : surprised ? 0.071 : 0.025;
      renderer.render(scene, camera);
    });

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      geometry.dispose();
      [skin, hair, fabric, eye, lip].forEach(surface => surface.dispose());
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
