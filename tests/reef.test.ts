import { describe, expect, it } from 'vitest';
import { createReef } from '../src/world/reef';
import { Heightmap, ISLAND_CONFIG } from '../src/world/heightmap';
import { createLayout } from '../src/world/layout';
import { createNoise2D } from '../src/core/noise';
import { createRng } from '../src/core/rng';
import { sharedUniforms } from '../src/core/uniforms';
import type { CausticsUniforms } from '../src/world/patchMaterial';
import * as THREE from 'three';

const SEED = 20261017;
const hm = new Heightmap(ISLAND_CONFIG, createNoise2D(createRng(SEED)));
const layout = createLayout(hm, createRng(SEED + 1));
const caustics: CausticsUniforms = {
  uCaustics: { value: null },
  uCausticsSize: { value: 200 },
  uCausticsOn: { value: 0 },
  uSunColor: sharedUniforms.uSunColor,
  uSunDir: sharedUniforms.uSunDir,
};
const reef = createReef(hm, SEED + 14, sharedUniforms, caustics, Math.atan2(layout.house.z, layout.house.x));

describe('reef', () => {
  it('has reef rocks, corals of every kind, seagrass, seaweed and fish', () => {
    for (const k of ['bommie', 'brain', 'staghorn', 'table', 'fan', 'tube', 'anemone', 'soft', 'star', 'urchin', 'seagrass', 'seaweed', 'rubble', 'fish']) {
      expect(reef.counts[k], k).toBeGreaterThan(30);
    }
  });

  it('corals sit on the seabed or the reef rocks, under at least 1.2 m of water', () => {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    reef.group.traverse((o) => {
      if (!(o instanceof THREE.InstancedMesh) || o.name === 'reef-bommie') return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        expect(p.y).toBeLessThan(-1.15);
        expect(Math.abs(p.y - reef.floorAt(p.x, p.z)), o.name).toBeLessThan(0.2);
      }
    });
  });

  it('fish schools swim above the seabed all the way round, under the surface', () => {
    const fish = reef.group.getObjectByName('reef-fish') as THREE.Mesh;
    const c = fish.geometry.getAttribute('iCenter');
    const sw = fish.geometry.getAttribute('iSwim');
    for (let i = 0; i < c.count; i++) {
      expect(c.getY(i)).toBeLessThan(-0.85);
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const g = hm.heightAt(c.getX(i) + Math.cos(a) * sw.getX(i), c.getZ(i) + Math.sin(a) * sw.getX(i));
        expect(c.getY(i) - g, `school ${i}`).toBeGreaterThan(0.4);
      }
    }
  });
});
