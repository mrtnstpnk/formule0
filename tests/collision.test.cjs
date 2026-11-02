const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Run the real inline game code with a canvas stub; no production test hooks.
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\}\)\(\);\s*$/, `
  globalThis.testGame = {
    game, track, STATE, onPointerDown, onPointerMove, onPointerUp,
    findNearestIntersection, pointInPolygon, pointInRoad, pointOnSegment,
    segIntersect, generateTrack, resetGame, dist
  };
})();`);

function loadGame(width, height) {
  const context = new Proxy({}, { get: () => () => {} });
  const makeElement = () => ({
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener() {}, setPointerCapture() {},
    style: {}, classList: { add() {}, remove() {} },
  });
  const elements = new Map();
  const sandbox = {
    ClipperLib: require("../vendor/clipper.js"),
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
      createElement: makeElement, addEventListener() {},
    },
    window: { devicePixelRatio: 1, addEventListener() {} },
    navigator: {}, performance: { now: () => 0 }, requestAnimationFrame() {},
  };
  vm.runInNewContext(source, sandbox);
  const api = sandbox.testGame;
  api.game.hintDismissed = true;
  return api;
}

const pointer = point => ({ clientX: point.x, clientY: point.y, pointerId: 1 });
const interpolate = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const midpoint = (a, b) => interpolate(a, b, 0.5);

function move(api, point) { api.onPointerMove(pointer(point)); }
function begin(api, point) { api.onPointerDown(pointer(point)); }
function end(api, point) { api.onPointerUp(pointer(point)); }

function wallSection(api, side, index = 40) {
  const target = api.track[side][index];
  const segment = api.track.wallSegments.find(seg => api.pointOnSegment(target, seg.p1, seg.p2));
  assert(segment, "cross-section must land on an actual wall");
  return { wall: midpoint(segment.p1, segment.p2), center: api.track.centerline[index] };
}

function passOpponent(api) {
  assert.equal(api.game.currentPlayer, 1);
  const start = api.track.startPoint;
  begin(api, start);
  end(api, start);
  assert.equal(api.game.currentPlayer, 0);
}

function crashFromStart(api, side) {
  const start = api.track.startPoint;
  const wall = api.track[side][api.track.centerline.length - 8];
  const outside = interpolate(start, wall, 1.1);
  begin(api, start);
  move(api, outside);
  assert.equal(api.game.strokes[0].crashed, true);
  const crashPoint = api.game.positions[0];
  passOpponent(api);
  return { start, outside, crashPoint };
}

for (const [width, height] of [[390, 788], [1024, 712]]) {
  for (const side of ["left", "right"]) {
    const label = `${width}x${height}, ${side} wall`;

    test(`${label}: next turn cannot leave the road after a crash`, () => {
      const api = loadGame(width, height);
      const { outside, crashPoint } = crashFromStart(api, side);
      begin(api, crashPoint);
      move(api, outside);
      assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], crashPoint) < 1e-7);
    });

    test(`${label}: next turn can return inside, including after a stationary event`, () => {
      const api = loadGame(width, height);
      const { start, crashPoint } = crashFromStart(api, side);
      begin(api, crashPoint);
      move(api, crashPoint);
      move(api, start);
      assert.equal(api.game.state, api.STATE.DRAWING);
      end(api, start);
      assert.equal(api.game.strokes.at(-1).crashed, false);
      assert(api.dist(api.game.positions[0], start) < 1e-7);
    });

    test(`${label}: first segment detects a wall only one pixel away`, () => {
      const api = loadGame(width, height);
      const { wall, center } = wallSection(api, side);
      const inside = interpolate(wall, center, 1 / api.dist(wall, center));
      const outside = interpolate(center, wall, 1.1);
      api.game.positions[0] = inside;
      begin(api, inside);
      move(api, outside);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) < 1e-7);
    });

    test(`${label}: leaving a wall inward still crashes at the opposite wall`, () => {
      const api = loadGame(width, height);
      const { wall, center } = wallSection(api, side);
      api.game.positions[0] = wall;
      begin(api, wall);
      move(api, interpolate(wall, center, 100));
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) > 10);
    });

    test(`${label}: roundoff at a wall does not permit outward movement or block recovery`, () => {
      for (const rounding of [-1e-10, 1e-10]) {
        const api = loadGame(width, height);
        const { wall, center } = wallSection(api, side);
        const origin = { x: wall.x + rounding, y: wall.y + rounding };
        const outward = api.findNearestIntersection(origin, interpolate(center, wall, 1.1), api.track.collisionSegments, api.track);
        assert.equal(outward.type, "wall");
        assert.equal(outward.t, 0);
        assert.equal(api.findNearestIntersection(origin, center, api.track.collisionSegments, api.track), null);
      }
    });
  }

  test(`${width}x${height}: slow subpixel movement still crashes`, () => {
    const api = loadGame(width, height);
    const { wall, center } = wallSection(api, "left");
    const distance = api.dist(wall, center);
    const inside = interpolate(wall, center, 2 / distance);
    api.game.positions[0] = inside;
    begin(api, inside);
    for (let step = 1; step <= 12 && api.game.state === api.STATE.DRAWING; step++) {
      move(api, interpolate(wall, center, (2 - step * 0.3) / distance));
    }
    assert.equal(api.game.strokes.at(-1).crashed, true);
    assert(api.dist(api.game.positions[0], wall) < 1e-7);
  });

  test(`${width}x${height}: valid movement along the track remains playable`, () => {
    const api = loadGame(width, height);
    begin(api, api.track.startPoint);
    // Cross the start line, then drive almost the whole lap.
    for (let i = api.track.centerline.length - 7; i < api.track.centerline.length * 2 - 2; i++) {
      move(api, api.track.centerline[i % api.track.centerline.length]);
      assert.equal(api.game.state, api.STATE.DRAWING);
    }
    end(api, api.track.centerline.at(-2));
    assert.equal(api.game.strokes.at(-1).crashed, false);
  });

  test(`${width}x${height}: a shortcut that leaves and reenters the road crashes at its first exit`, () => {
    const api = loadGame(width, height);
    const origin = api.track.centerline[40];
    const destination = api.track.centerline[240];
    assert(api.pointInRoad(destination, api.track));
    assert.equal(api.pointInRoad(interpolate(origin, destination, 0.5), api.track), false);
    api.game.positions[0] = origin;
    begin(api, origin);
    move(api, destination);
    assert.equal(api.game.strokes.at(-1).crashed, true);
    assert(api.dist(api.game.positions[0], origin) > 10);
    assert(api.dist(api.game.positions[0], destination) > 10);
  });

  test(`${width}x${height}: a finish crossing one pixel from the origin wins only after all checkpoints`, () => {
    const api = loadGame(width, height);
    const finish = api.track.centerline[0];
    const prev = api.track.centerline.at(-2);
    const inside = interpolate(finish, prev, 1 / api.dist(finish, prev));
    const outside = interpolate(finish, prev, -5 / api.dist(finish, prev));
    api.game.positions[0] = inside;
    api.game.nextCheckpoint[0] = api.track.checkpoints.length;
    begin(api, inside);
    move(api, outside);
    assert.equal(api.game.state, api.STATE.GAME_OVER);
    assert.equal(api.game.winner, 0);
  });

  test(`${width}x${height}: crossing the start line initially does not win or crash`, () => {
    const api = loadGame(width, height);
    begin(api, api.track.startPoint);
    move(api, api.track.centerline[2]);
    assert.equal(api.game.state, api.STATE.DRAWING);
    assert.equal(api.game.winner, null);
    assert.equal(api.game.nextCheckpoint[0], 0);
  });

  test(`${width}x${height}: driving one complete clockwise lap wins`, () => {
    const api = loadGame(width, height);
    const len = api.track.centerline.length;
    begin(api, api.track.startPoint);
    for (let i = len - 7; i <= len * 2; i++) {
      move(api, api.track.centerline[i % len]);
      assert.equal(api.game.state, i === len * 2 ? api.STATE.GAME_OVER : api.STATE.DRAWING);
    }
    assert.equal(api.game.winner, 0);
  });

  test(`${width}x${height}: driving backwards and crossing the finish cannot win`, () => {
    const api = loadGame(width, height);
    const len = api.track.centerline.length;
    begin(api, api.track.startPoint);
    for (let i = len - 9; i >= 0; i--) move(api, api.track.centerline[i]);
    move(api, api.track.centerline[len - 1]);
    move(api, api.track.centerline[0]);
    assert.equal(api.game.state, api.STATE.DRAWING);
    assert.equal(api.game.winner, null);
    assert.equal(api.game.nextCheckpoint[0], 0);
  });

  test(`${width}x${height}: returning backwards across a checkpoint clears lap progress`, () => {
    const api = loadGame(width, height);
    api.game.positions[0] = api.track.centerline[88];
    begin(api, api.game.positions[0]);
    move(api, api.track.centerline[92]);
    assert.equal(api.game.nextCheckpoint[0], 1);
    move(api, api.track.centerline[88]);
    assert.equal(api.game.nextCheckpoint[0], 0);
  });

  test(`${width}x${height}: lap progress belongs to each player and survives turns`, () => {
    const api = loadGame(width, height);
    api.game.positions[0] = api.track.centerline[88];
    begin(api, api.game.positions[0]);
    move(api, api.track.centerline[92]);
    end(api, api.track.centerline[92]);
    assert.equal(api.game.nextCheckpoint[0], 1);
    assert.equal(api.game.nextCheckpoint[1], 0);
    passOpponent(api);
    assert.equal(api.game.nextCheckpoint[0], 1);
    api.resetGame();
    assert.equal(api.game.nextCheckpoint[0], 0);
    assert.equal(api.game.nextCheckpoint[1], 0);
  });

  test(`${width}x${height}: stopping exactly on a checkpoint counts it once`, () => {
    const api = loadGame(width, height);
    api.game.positions[0] = api.track.centerline[89];
    begin(api, api.game.positions[0]);
    move(api, api.track.centerline[90]);
    assert.equal(api.game.nextCheckpoint[0], 1);
    move(api, api.track.centerline[91]);
    assert.equal(api.game.nextCheckpoint[0], 1);
  });

  test(`${width}x${height}: both walls close at the seam and remain inside the canvas`, () => {
    const api = loadGame(width, height);
    const { track } = api;
    assert.equal(track.wallSegments.length, track.boundaryPolygons.reduce((sum, polygon) => sum + polygon.length, 0));
    for (const side of track.boundaryPolygons) {
      assert(track.wallSegments.some(seg => seg.p1 === side.at(-1) && seg.p2 === side[0]));
      for (const p of side) assert(p.x > 0 && p.x < width && p.y > 0 && p.y < height);
    }
    assert.equal(api.pointInRoad({ x: width / 2, y: height / 2 }, track), false);
    for (const p of track.centerline) assert(api.pointInRoad(p, track));
    assert(api.pointInPolygon(track.startPoint, track.startZonePolygon));
  });

  test(`${width}x${height}: the fitted road is at least twice the previous width everywhere`, () => {
    const api = loadGame(width, height);
    const previous = api.generateTrack(width, height, 28);
    const minimumWidth = previous.centerline[0].w * 4;
    for (let i = 0; i < api.track.centerline.length; i++) {
      assert(api.dist(api.track.left[i], api.track.right[i]) >= minimumWidth - 0.001,
        `cross-section ${i} must remain twice as wide after viewport fitting`);
    }
  });

  test(`${width}x${height}: each lap gate crosses the centerline only once`, () => {
    const api = loadGame(width, height);
    const line = api.track.centerline;
    for (const gate of api.track.lapGates) {
      let crossings = 0;
      for (let i = 0; i < line.length; i++) {
        const hit = api.segIntersect(line[i], line[(i + 1) % line.length], gate.p1, gate.p2);
        if (hit && api.dist(line[i], hit) > 1e-7) crossings++;
      }
      assert.equal(crossings, 1, "a gate must not also intersect an approaching bend");
    }
  });

  test(`${width}x${height}: walls never intersect themselves or each other`, () => {
    const api = loadGame(width, height);
    const walls = api.track.wallSegments;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const a = walls[i], b = walls[j];
        if (a.p1 === b.p2 || a.p2 === b.p1) continue;
        assert.equal(api.segIntersect(a.p1, a.p2, b.p1, b.p2), null, `wall segments ${i} and ${j} intersect`);
      }
    }
  });
}
