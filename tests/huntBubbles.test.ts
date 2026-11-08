import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BubbleField } from '../src/activities/flight/bubbleField';
import type { SharedUniforms } from '../src/core/uniforms';
import { HuntBubbles } from '../src/world/creatures/huntBubbles';

describe('HuntBubbles.reset (the shader clock went back to 0)', () => {
  it('forgets droplets thrown on the old clock: no draw call afterwards', () => {
    const scene = new THREE.Scene();
    const shared = { uTime: { value: 0 }, uDayLight: { value: 1 } } as unknown as SharedUniforms;
    const b = new HuntBubbles(scene, shared, 4, 80);
    const field = new BubbleField(4);
    b.splash(0, 10, 0, 2, 0, 0, 1, 3000);
    b.reset();
    b.sync(field, false, 0.2);
    const drops = scene.children.find((o) => o instanceof THREE.Points) as THREE.Points;
    expect(drops.visible).toBe(false);
    const birth = drops.geometry.getAttribute('aBirth');
    for (let i = 0; i < birth.count; i++) expect(birth.getX(i)).toBe(-1);
  });
});
