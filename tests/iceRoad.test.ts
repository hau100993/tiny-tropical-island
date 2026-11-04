import { describe, expect, it } from 'vitest';
import { TrailRibbon } from '../src/world/creatures/trailRibbon';
import { ICE_HALF_WIDTH, ICE_LIFE, ICE_MELT, ICE_TOP, ICE_WIDTH, IceRoad, segmentDistance } from '../src/world/creatures/iceRoad';
import { sharedUniforms } from '../src/core/uniforms';

const FLAT = { verts: [[-1, 0], [1, 0]] as const, bands: [[0, 1]] as const };

describe('trail ribbon', () => {
  it('joins consecutive points of a strand with quads, not across a cut', () => {
    const r = new TrailRibbon(8, FLAT);
    for (let i = 0; i < 3; i++) r.push(i, 0, 0, 0, 1, 0);
    // 3 points → 2 quads → 12 indices.
    expect(r.geometry.drawRange.count).toBe(12);
    r.cut();
    r.push(10, 0, 0, 0, 1, 0);
    expect(r.geometry.drawRange.count).toBe(12);
    r.push(11, 0, 0, 0, 1, 0);
    expect(r.geometry.drawRange.count).toBe(18);
  });

  it('wrapping round the ring never joins the newest point to the oldest', () => {
    const r = new TrailRibbon(4, FLAT);
    for (let i = 0; i < 10; i++) r.push(i, 0, 0, 0, 1, 0);
    // Four points live, three joins between them.
    expect(r.geometry.drawRange.count).toBe(18);
    let joins = 0;
    for (let i = 0; i < r.max; i++) joins += r.linked[i];
    expect(joins).toBe(3);
  });
});

describe('ice road', () => {
  it('is solid along the breath line, within its width, until it melts', () => {
    const ice = new IceRoad(sharedUniforms);
    // A road along +x from 0 to 30, frozen at t = 0.
    for (let x = 0; x <= 30; x += 1.5) ice.add(x, 0, 0, 1, 0);
    expect(ice.floorAt(15, 0, 1)).toBe(ICE_TOP);
    // Solid within the narrowest the road gets; never beyond the widest.
    expect(ice.floorAt(15, ICE_HALF_WIDTH * ICE_WIDTH.min * 0.8, 1)).toBe(ICE_TOP);
    expect(ice.floorAt(15, ICE_HALF_WIDTH * ICE_WIDTH.max * 1.1, 1)).toBe(-Infinity);
    expect(ice.floorAt(40, 0, 1)).toBe(-Infinity);
    // Not frozen across yet the instant it's laid; gone half way through melting.
    expect(ice.floorAt(15, 0, 0.05)).toBe(-Infinity);
    expect(ice.floorAt(15, 0, ICE_LIFE + ICE_MELT)).toBe(-Infinity);
  });

  it('raises clusters of spikes along the edges and drops them at the end', () => {
    const ice = new IceRoad(sharedUniforms);
    for (let x = 0; x <= 60; x += 1.6) ice.add(x, 0, 0, 1, 0);
    const c = ice.crystals;
    let placed = 0;
    for (let i = 0; i < c.maxSpikes; i++) placed += c.crumbled[i] ? 0 : 1;
    // ~38 points × 2 sides × 45% × ~5 spikes.
    expect(placed).toBeGreaterThan(60);
    // Every spike leans out from the edge, clear of the part the manta glides on.
    for (let i = 0; i < c.maxSpikes; i++) if (!c.crumbled[i]) expect(Math.abs(c.tipZ[i])).toBeGreaterThan(ICE_HALF_WIDTH * ICE_WIDTH.min);
    ice.update(ICE_LIFE + ICE_MELT + 1);
    expect(c.spikes.visible).toBe(false);
  });

  it('distance to a segment', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(segmentDistance(-4, 3, 0, 0, 10, 0)).toBeCloseTo(5);
  });
});
