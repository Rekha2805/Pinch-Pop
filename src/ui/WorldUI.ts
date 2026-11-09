import { RayInteractable } from '@iwsdk/core';

import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three';

const COLORS = {
  panel: '#171025',
  border: '#9B55C7',
  purple: '#70428F',
  coral: '#FF779A',
  white: '#FFFFFF',
};

// ---------------- TEXTURE HELPER ----------------

function createTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas context unavailable');
  }

  draw(ctx);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

// ---------------- ROUNDED RECTANGLE ----------------

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

// ---------------- MAIN PANEL ----------------

export function addPanel(
  world: any,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number
) {
  const texture = createTexture(1024, 1024, (ctx) => {
    ctx.clearRect(0, 0, 1024, 1024);

    roundedRect(ctx, 12, 12, 1000, 1000, 65);

    ctx.fillStyle = COLORS.panel;
    ctx.fill();

    ctx.lineWidth = 9;
    ctx.strokeStyle = COLORS.border;
    ctx.stroke();

    roundedRect(ctx, 30, 30, 964, 964, 45);

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();

    // Small decorative accent
    ctx.fillStyle = COLORS.coral;
    roundedRect(ctx, 390, 55, 244, 12, 6);
    ctx.fill();
  });

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });

  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    material
  );

  mesh.position.set(x, y, z);
  mesh.renderOrder = 1;

  world.scene.add(mesh);

  return () => {
    world.scene.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
  };
}

// ---------------- TEXT DRAWING ----------------

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  color: string,
  fontSize: number
) {
  ctx.clearRect(0, 0, 2048, 512);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Higher resolution for sharper VR text
  ctx.font = `bold ${fontSize * 4}px Arial`;

  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  ctx.fillText(text, 1024, 256, 1950);

  ctx.shadowBlur = 0;
}

// ---------------- STATIC LABEL ----------------

export function addLabel(
  world: any,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color = COLORS.white,
  fontSize = 32
) {
  const texture = createTexture(
    2048,
    512,
    (ctx) => drawText(ctx, text, color, fontSize)
  );

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new Sprite(material);

  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 5;

  world.scene.add(sprite);

  return () => {
    world.scene.remove(sprite);
    material.dispose();
    texture.dispose();
  };
}

// ---------------- INTERACTIVE BUTTON ----------------

export function addButton(
  world: any,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  onClick: () => void,
  color = COLORS.purple
) {
  const texture = createTexture(
    2048,
    640,
    (ctx) => {
      ctx.clearRect(0, 0, 2048, 640);

      roundedRect(ctx, 12, 12, 2024, 616, 75);

      const gradient = ctx.createLinearGradient(
        0, 0, 2048, 640
      );

      gradient.addColorStop(0, color);
      gradient.addColorStop(1, '#70428F');

      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 120px Arial';

      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#FFFFFF';
      ctx.shadowBlur = 10;

      ctx.fillText(text, 1024, 320, 1900);

      ctx.shadowBlur = 0;
    }
  );

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
  });

  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    material
  );

  mesh.position.set(x, y, z);
  mesh.renderOrder = 4;

  const entity = world.createTransformEntity(mesh);

  entity.addComponent(RayInteractable);

  const handleClick = () => {
    onClick();
  };

  mesh.addEventListener('pointerdown', handleClick);

  return () => {
    mesh.removeEventListener('pointerdown', handleClick);

    entity.dispose();

    mesh.geometry.dispose();
    material.dispose();
    texture.dispose();
  };
}

// ---------------- DYNAMIC LABEL ----------------

export function addDynamicLabel(
  world: any,
  text: string,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  color = COLORS.white,
  fontSize = 32
) {
  const texture = createTexture(
    2048,
    512,
    (ctx) => drawText(ctx, text, color, fontSize)
  );

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new Sprite(material);

  sprite.position.set(x, y, z);
  sprite.scale.set(width, height, 1);
  sprite.renderOrder = 5;

  world.scene.add(sprite);

  return {
    update(newText: string) {
      const ctx = texture.image.getContext('2d');

      if (!ctx) return;

      drawText(ctx, newText, color, fontSize);
      texture.needsUpdate = true;
    },

    dispose() {
      world.scene.remove(sprite);
      material.dispose();
      texture.dispose();
    },
  };
}