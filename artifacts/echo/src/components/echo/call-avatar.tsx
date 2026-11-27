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

export function CallAvatar({ look, speaking, mouthCue, reference }: { look: CallAvatarLook; speaking: boolean; mouthCue: string; reference?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ look, speaking, mouthCue });
  current.current = { look, speaking, mouthCue };

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
    const patches = [
      { parent: head, center: [0, 0.23, 0], radius: [0.65, 0.82, 0.55], sourceY: 0, sourceHeight: 0.69 },
      { parent: scene, center: [0, -1.16, 0], radius: [0.91, 0.68, 0.45], sourceY: 0.69, sourceHeight: 0.31 },
    ].map(({ parent, center, radius, sourceY, sourceHeight }) => {
      const patchGeometry = new THREE.PlaneGeometry(radius[0] * 1.96, radius[1] * 1.96, 24, 24);
      const positions = patchGeometry.attributes.position;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = positions.getX(vertex);
        const y = positions.getY(vertex);
        const depth = Math.sqrt(Math.max(0, 1 - (x / radius[0]) ** 2 - (y / radius[1]) ** 2));
        positions.setXYZ(vertex, x + center[0], y + center[1], depth * radius[2] + center[2] + 0.009);
      }
      const surface = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(patchGeometry, surface);
      mesh.visible = false;
      parent.add(mesh);
      return { mesh, surface, sourceY, sourceHeight };
    });

    let cancelled = false;
    if (reference) {
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        for (const { mesh, surface, sourceY, sourceHeight } of patches) {
          const layer = document.createElement('canvas');
          layer.width = layer.height = 384;
          const context = layer.getContext('2d');
          if (!context) continue;
          const width = Math.min(image.naturalWidth, image.naturalHeight * 0.78);
          context.drawImage(image, (image.naturalWidth - width) / 2, image.naturalHeight * sourceY,
            width, image.naturalHeight * sourceHeight, 0, 0, 384, 384);
          context.globalCompositeOperation = 'destination-in';
          context.save();
          context.translate(192, 192);
          context.scale(1, 1.04);
          const mask = context.createRadialGradient(0, 0, 127, 0, 0, 183);
          mask.addColorStop(0, 'white');
          mask.addColorStop(1, 'transparent');
          context.fillStyle = mask;
          context.fillRect(-192, -192, 384, 384);
          context.restore();
          const texture = new THREE.CanvasTexture(layer);
          texture.colorSpace = THREE.SRGBColorSpace;
          surface.map = texture;
          surface.needsUpdate = true;
          mesh.visible = true;
        }
      };
      image.src = reference;
    }

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
      const { look, speaking, mouthCue } = current.current;
      const smile = look.expression === 'smile';
      const surprised = look.expression === 'surprised';
      const blink = !reduceMotion.matches && time % 4.7 > 4.57;
      for (const name of Object.keys(callHair) as Array<keyof typeof callHair>) styles[name].visible = name === look.hair;
      fabric.color.setHex(colors[look.clothes]);
      hood.visible = look.clothes === 'burgundy';
      collar.visible = look.clothes !== 'black';
      torso.scale.x = hood.visible ? 0.99 : 0.91;
      head.rotation.y = reduceMotion.matches ? 0 : Math.sin(time * 0.85) * 0.085;
      const referenceLoaded = patches[0].mesh.visible;
      for (const part of [...eyes, ...brows]) part.visible = !referenceLoaded;
      mouth.position.z = referenceLoaded ? 0.51 : 0.483;
      for (const part of eyes) part.scale.y = blink ? 0.007 : surprised ? 0.072 : 0.045;
      for (const brow of brows) brow.position.y = surprised ? 0.52 : 0.47;
      mouth.position.y = smile ? -0.16 : -0.19;
      const vowel = mouthCue.match(/[aeiouáéíóú]/i)?.[0]?.toLowerCase();
      const rounded = vowel && 'ouóú'.includes(vowel);
      const wide = vowel && 'eiéí'.includes(vowel);
      mouth.scale.x = speaking ? (rounded ? 0.085 : wide ? 0.16 : 0.13) : smile ? 0.18 : surprised ? 0.092 : 0.13;
      mouth.scale.y = speaking ? 0.025 + Math.abs(Math.sin(time * 15)) * (wide ? 0.042 : 0.08) : surprised ? 0.071 : 0.025;
      renderer.render(scene, camera);
    });

    return () => {
      cancelled = true;
      for (const { mesh, surface } of patches) {
        mesh.geometry.dispose();
        surface.map?.dispose();
        surface.dispose();
      }
      observer.disconnect();
      renderer.setAnimationLoop(null);
      geometry.dispose();
      [skin, hair, fabric, eye, lip].forEach(surface => surface.dispose());
      renderer.dispose();
    };
  }, [reference]);

  return <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
