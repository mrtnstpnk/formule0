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
    findNearestIntersection, pointInPolygon, dist
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

function passOpponent(api) {
  assert.equal(api.game.currentPlayer, 1);
  const start = api.track.centerline[4];
  begin(api, start);
  end(api, start);
  assert.equal(api.game.currentPlayer, 0);
}

function crashFromStart(api, side) {
  const start = api.track.centerline[4];
  const wall = api.track[side][4];
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
      const wall = midpoint(api.track[side][40], api.track[side][41]);
      const center = midpoint(api.track.centerline[40], api.track.centerline[41]);
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
      const wall = midpoint(api.track[side][40], api.track[side][41]);
      const center = midpoint(api.track.centerline[40], api.track.centerline[41]);
      api.game.positions[0] = wall;
      begin(api, wall);
      move(api, interpolate(wall, center, 3));
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) > 10);
    });

    test(`${label}: roundoff at a wall does not permit outward movement or block recovery`, () => {
      for (const rounding of [-1e-10, 1e-10]) {
        const api = loadGame(width, height);
        const wall = midpoint(api.track[side][40], api.track[side][41]);
        const center = midpoint(api.track.centerline[40], api.track.centerline[41]);
        const origin = { x: wall.x + rounding, y: wall.y + rounding };
        const outward = api.findNearestIntersection(origin, interpolate(center, wall, 1.1), api.track.collisionSegments, api.track.roadPolygon);
        assert.equal(outward.type, "wall");
        assert.equal(outward.t, 0);
        assert.equal(api.findNearestIntersection(origin, center, api.track.collisionSegments, api.track.roadPolygon), null);
      }
    });
  }

  test(`${width}x${height}: slow subpixel movement still crashes`, () => {
    const api = loadGame(width, height);
    const wall = midpoint(api.track.left[40], api.track.left[41]);
    const center = midpoint(api.track.centerline[40], api.track.centerline[41]);
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
    begin(api, api.track.centerline[4]);
    for (let i = 5; i < api.track.centerline.length - 1; i++) {
      move(api, api.track.centerline[i]);
      assert.equal(api.game.state, api.STATE.DRAWING);
    }
    end(api, api.track.centerline.at(-2));
    assert.equal(api.game.strokes.at(-1).crashed, false);
  });

  test(`${width}x${height}: a shortcut that leaves and reenters the road crashes at its first exit`, () => {
    const api = loadGame(width, height);
    const origin = api.track.left[2];
    const destination = api.track.centerline[33];
    assert(api.pointInPolygon(destination, api.track.roadPolygon));
    assert(api.pointInPolygon(interpolate(origin, destination, 0.1), api.track.roadPolygon));
    assert.equal(api.pointInPolygon(interpolate(origin, destination, 0.74), api.track.roadPolygon), false);
    api.game.positions[0] = origin;
    begin(api, origin);
    move(api, destination);
    assert.equal(api.game.strokes.at(-1).crashed, true);
    assert(api.dist(api.game.positions[0], origin) > 10);
    assert(api.dist(api.game.positions[0], destination) > 10);
  });

  test(`${width}x${height}: a finish crossing one pixel from the origin wins`, () => {
    const api = loadGame(width, height);
    const finish = api.track.centerline.at(-1);
    const prev = api.track.centerline.at(-2);
    const inside = interpolate(finish, prev, 1 / api.dist(finish, prev));
    const outside = interpolate(finish, prev, -5 / api.dist(finish, prev));
    api.game.positions[0] = inside;
    begin(api, inside);
    move(api, outside);
    assert.equal(api.game.state, api.STATE.GAME_OVER);
    assert.equal(api.game.winner, 0);
  });

  test(`${width}x${height}: the start boundary cannot be used to drive around the walls`, () => {
    const api = loadGame(width, height);
    const start = api.track.centerline[0];
    const inside = api.track.centerline[4];
    begin(api, inside);
    move(api, interpolate(inside, start, 1.5));
    assert.equal(api.game.strokes.at(-1).crashed, true);
    assert(api.dist(api.game.positions[0], start) < 1e-7);
    const crashPoint = api.game.positions[0];
    passOpponent(api);
    begin(api, crashPoint);
    move(api, inside);
    assert.equal(api.game.state, api.STATE.DRAWING);
  });
}
