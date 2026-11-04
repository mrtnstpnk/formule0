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
    findNearestIntersection, pointInPolygon, pointInRoad, segIntersect, resetGame, dist, loop
  };
})();`);

function loadGame(width, height) {
  let now = 0;
  const context = new Proxy({}, { get: () => () => {} });
  const makeElement = () => ({
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener() {}, setPointerCapture() {},
    style: {}, classList: { add() {}, remove() {} },
  });
  const elements = new Map();
  const sandbox = {
    BrnoCircuit: require("../track/brno-circuit.js"),
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, makeElement());
        return elements.get(id);
      },
      createElement: makeElement, addEventListener() {},
    },
    window: { devicePixelRatio: 1, addEventListener() {} },
    navigator: {}, performance: { now: () => now }, requestAnimationFrame() {},
  };
  vm.runInNewContext(source, sandbox);
  const api = sandbox.testGame;
  api.elapse = ms => { now += ms; api.loop(); };
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

function wallStart(api, side, index = 40) {
  const wall = midpoint(api.track[side][index], api.track[side][index + 1]);
  const center = midpoint(api.track.centerline[index], api.track.centerline[index + 1]);
  api.game.positions[0] = wall;
  // Signed CSS-pixel distance from the wall, positive toward the road.
  const at = distance => interpolate(wall, center, distance / api.dist(wall, center));
  return { wall, center, at };
}

for (const [width, height] of [[390, 788], [1024, 712]]) {
  for (const side of ["left", "right"]) {
    const label = `${width}x${height}, ${side} wall`;

    test(`${label}: next turn cannot leave the road after a crash`, () => {
      const api = loadGame(width, height);
      const { outside, crashPoint } = crashFromStart(api, side);
      begin(api, crashPoint);
      const radius = api.game.currentStroke.startCircle.radius;
      move(api, interpolate(crashPoint, outside, (radius + 5) / api.dist(crashPoint, outside)));
      assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], crashPoint) < 1e-7);
    });

    test(`${label}: next turn can return inside, including after a stationary event`, () => {
      const api = loadGame(width, height);
      const { start, crashPoint } = crashFromStart(api, side);
      begin(api, crashPoint);
      move(api, crashPoint);
      // Move beyond the recovery circle but stay short of the opposite wall.
      const radius = api.game.currentStroke.startCircle.radius;
      const destination = interpolate(crashPoint, start, (radius + 1) / api.dist(crashPoint, start));
      move(api, destination);
      assert.equal(api.game.state, api.STATE.DRAWING);
      end(api, destination);
      assert.equal(api.game.strokes.at(-1).crashed, false);
      assert(api.dist(api.game.positions[0], destination) < 1e-7);
    });

    test(`${label}: an off-road touch and jitter recover only after leaving the circle into the road`, () => {
      const api = loadGame(width, height);
      const { wall, at } = wallStart(api, side);
      begin(api, at(-8));
      const radius = api.game.currentStroke.startCircle.radius;
      assert(Math.abs(radius * 2 - api.dist(api.track.left[40], api.track.right[40])) < 1e-7);
      for (const offset of [-8, -10, 2, -4, radius - 0.1]) {
        move(api, at(offset));
        assert.equal(api.game.state, api.STATE.DRAWING);
        assert.equal(api.game.currentStroke.points.length, 1);
        assert(api.dist(api.game.positions[0], wall) < 1e-7);
      }
      const destination = at(radius + 1);
      assert(api.pointInRoad(destination, api.track));
      move(api, destination);
      assert.equal(api.game.state, api.STATE.DRAWING);
      assert.equal(api.game.currentStroke.startCircle, null);
      end(api, destination);
      assert.equal(api.game.strokes.at(-1).crashed, false);
      assert(api.dist(api.game.positions[0], destination) < 1e-7);
    });

    test(`${label}: a touch at the outside rim can cross the entire circle in one event`, () => {
      const api = loadGame(width, height);
      const { wall, at } = wallStart(api, side);
      begin(api, wall);
      const radius = api.game.currentStroke.startCircle.radius;
      api.resetGame();
      api.game.positions[0] = wall;
      begin(api, at(-radius + 1e-6));
      assert.equal(api.game.state, api.STATE.DRAWING);
      move(api, at(radius + 1));
      assert.equal(api.game.state, api.STATE.DRAWING);
      end(api, at(radius + 1));
      assert.equal(api.game.strokes.at(-1).crashed, false);
    });

    test(`${label}: touching beyond the circle does not consume the turn`, () => {
      const api = loadGame(width, height);
      const { wall, at } = wallStart(api, side);
      begin(api, wall);
      const radius = api.game.currentStroke.startCircle.radius;
      api.resetGame();
      api.game.positions[0] = wall;
      begin(api, at(-radius - 1));
      assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
      assert.equal(api.game.currentPlayer, 0);
      assert.equal(api.game.strokes.length, 0);
    });

    test(`${label}: slow outward movement is tolerated inside, then rejected at the first exit`, () => {
      const api = loadGame(width, height);
      const { wall, at } = wallStart(api, side);
      begin(api, at(-3));
      const radius = api.game.currentStroke.startCircle.radius;
      for (let offset = 4; offset < radius; offset += 0.3) {
        move(api, at(-offset));
        assert.equal(api.game.state, api.STATE.DRAWING);
      }
      move(api, at(-radius - 0.1));
      assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) < 1e-7);
    });

    test(`${label}: release, cancel and timeout inside the circle keep the car on the wall`, () => {
      for (const reason of ["release", "cancel", "timeout"]) {
        const api = loadGame(width, height);
        const { wall, at } = wallStart(api, side);
        begin(api, at(-3));
        move(api, at(-10));
        if (reason === "timeout") api.elapse(801);
        else api.onPointerUp({ ...pointer(at(-10)), type: reason === "cancel" ? "pointercancel" : "pointerup" });
        assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
        assert.equal(api.game.currentPlayer, 1);
        assert.equal(api.game.strokes.at(-1).crashed, false);
        assert(api.dist(api.game.positions[0], wall) < 1e-7);
        assert.equal(api.game.nextCheckpoint[0], 0);
        passOpponent(api);
        begin(api, at(-3));
        assert(api.game.currentStroke.startCircle);
      }
    });

    test(`${label}: pointerup validates a final movement out of the circle`, () => {
      for (const direction of [-1, 1]) {
        const api = loadGame(width, height);
        const { wall, at } = wallStart(api, side);
        begin(api, at(-3));
        const destination = at(direction * (api.game.currentStroke.startCircle.radius + 1));
        end(api, destination);
        assert.equal(api.game.strokes.at(-1).crashed, direction < 0);
        assert(api.dist(api.game.positions[0], direction < 0 ? wall : destination) < 1e-7);
      }
    });

    test(`${label}: returning to the circle after a valid exit does not restore tolerance`, () => {
      const api = loadGame(width, height);
      const { wall, at } = wallStart(api, side);
      begin(api, at(-3));
      move(api, at(api.game.currentStroke.startCircle.radius + 1));
      move(api, at(5));
      assert.equal(api.game.state, api.STATE.DRAWING);
      move(api, at(-1));
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) < 1e-7);
    });

    test(`${label}: a legal endpoint cannot hide an off-road first exit`, () => {
      const api = loadGame(width, height);
      begin(api, wallStart(api, side).wall);
      const radius = api.game.currentStroke.startCircle.radius;
      api.resetGame();
      let wall, destination;
      for (let index = 0; index < api.track.centerline.length; index += 12) {
        wall = wallStart(api, side, index).wall;
        destination = api.track.centerline.find(p => api.dist(wall, p) > radius * 2 &&
          !api.pointInRoad(interpolate(wall, p, radius / api.dist(wall, p)), api.track));
        if (destination) break;
      }
      assert(destination, "fixture must cross outside before reentering the road");
      begin(api, wall);
      move(api, destination);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) < 1e-7);
    });

    test(`${label}: a long recovery still detects a later wall before a legal endpoint`, () => {
      const api = loadGame(width, height);
      begin(api, wallStart(api, side).wall);
      const radius = api.game.currentStroke.startCircle.radius;
      api.resetGame();
      let wall, destination, expected;
      for (let index = 0; index < api.track.centerline.length; index += 12) {
        wall = wallStart(api, side, index).wall;
        destination = api.track.centerline.find(p => {
          if (api.dist(wall, p) <= radius * 2) return false;
          const exit = interpolate(wall, p, radius / api.dist(wall, p));
          if (!api.pointInRoad(exit, api.track)) return false;
          expected = api.findNearestIntersection(exit, p, api.track.collisionSegments, api.track);
          return expected && api.dist(expected, exit) > 1;
        });
        if (destination) break;
      }
      assert(destination, "fixture must exit into the road and hit a wall later");
      begin(api, wall);
      move(api, destination);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], expected) < 1e-7);
    });

    test(`${label}: the circle exit follows the actual offset finger path`, () => {
      const api = loadGame(width, height);
      const { wall, at } = wallStart(api, side, 0);
      begin(api, wall);
      const radius = api.game.currentStroke.startCircle.radius;
      api.resetGame();
      api.game.positions[0] = wall;
      const a = api.track[side][0], b = api.track[side][1];
      const length = api.dist(a, b);
      const touch = at(-radius * 0.8);
      const destination = {
        x: at(2).x + (b.x - a.x) / length * radius * 2,
        y: at(2).y + (b.y - a.y) / length * radius * 2,
      };
      const outside = midpoint(touch, destination);
      assert(api.pointInRoad(destination, api.track));
      assert(api.dist(outside, wall) > radius);
      assert.equal(api.pointInRoad(outside, api.track), false);
      begin(api, touch);
      move(api, destination);
      assert.equal(api.game.strokes.at(-1).crashed, true);
      assert(api.dist(api.game.positions[0], wall) < 1e-7);
    });

    test(`${label}: a corner vertex allows recovery despite tiny rounding errors`, () => {
      for (const rounding of [-1e-10, 1e-10]) {
        const api = loadGame(width, height);
        const index = api.track.turnIndices[0];
        const vertex = api.track[side][index];
        const center = api.track.centerline[index];
        const origin = { x: vertex.x + rounding, y: vertex.y + rounding };
        api.game.positions[0] = origin;
        begin(api, origin);
        const radius = api.game.currentStroke.startCircle.radius;
        move(api, interpolate(vertex, center, -5 / api.dist(vertex, center)));
        assert.equal(api.game.state, api.STATE.DRAWING);
        move(api, interpolate(vertex, center, (radius + 1) / api.dist(vertex, center)));
        assert.equal(api.game.state, api.STATE.DRAWING);
        assert.equal(api.game.currentStroke.startCircle, null);
      }
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
        const outward = api.findNearestIntersection(origin, interpolate(center, wall, 1.1), api.track.collisionSegments, api.track);
        assert.equal(outward.type, "wall");
        assert.equal(outward.t, 0);
        assert.equal(api.findNearestIntersection(origin, center, api.track.collisionSegments, api.track), null);
      }
    });
  }

  test(`${width}x${height}: moving across a lap gate inside the circle grants no progress or win`, () => {
    for (const gate of [api => api.track.finishSegment, api => api.track.checkpoints[0]]) {
      const api = loadGame(width, height);
      const index = gate(api).index;
      const { wall } = wallStart(api, "left", (index + api.track.centerline.length - 2) % api.track.centerline.length);
      api.game.nextCheckpoint[0] = api.track.checkpoints.length;
      begin(api, wall);
      const target = interpolate(api.track.left[index + 1], api.track.centerline[index + 1], 0.1);
      assert(api.dist(target, wall) < api.game.currentStroke.startCircle.radius);
      move(api, target);
      assert.equal(api.game.winner, null);
      assert.equal(api.game.nextCheckpoint[0], api.track.checkpoints.length);
      end(api, target);
      assert(api.dist(api.game.positions[0], wall) < 1e-7);
    }
  });

  test(`${width}x${height}: recovery ignores extra fingers and is cleared by reset`, () => {
    const api = loadGame(width, height);
    const { wall, at } = wallStart(api, "left");
    begin(api, at(-3));
    const radius = api.game.currentStroke.startCircle.radius;
    api.onPointerMove({ ...pointer(at(-radius - 1)), pointerId: 2 });
    api.onPointerUp({ ...pointer(at(-radius - 1)), pointerId: 2 });
    assert.equal(api.game.state, api.STATE.DRAWING);
    assert(api.game.currentStroke.startCircle);
    assert(api.dist(api.game.positions[0], wall) < 1e-7);
    api.resetGame();
    assert.equal(api.game.currentStroke, null);
    begin(api, api.track.startPoint);
    assert.equal(api.game.currentStroke.startCircle, null);
  });

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
    const origin = api.track.centerline[api.track.turnIndices[1]];
    const destination = api.track.centerline[api.track.turnIndices[10]];
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
    const index = api.track.checkpoints[0].index;
    api.game.positions[0] = api.track.centerline[index - 2];
    begin(api, api.game.positions[0]);
    move(api, api.track.centerline[index + 2]);
    assert.equal(api.game.nextCheckpoint[0], 1);
    move(api, api.track.centerline[index - 2]);
    assert.equal(api.game.nextCheckpoint[0], 0);
  });

  test(`${width}x${height}: lap progress belongs to each player and survives turns`, () => {
    const api = loadGame(width, height);
    const index = api.track.checkpoints[0].index;
    api.game.positions[0] = api.track.centerline[index - 2];
    begin(api, api.game.positions[0]);
    move(api, api.track.centerline[index + 2]);
    end(api, api.track.centerline[index + 2]);
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
    const index = api.track.checkpoints[0].index;
    api.game.positions[0] = api.track.centerline[index - 1];
    begin(api, api.game.positions[0]);
    move(api, api.track.centerline[index]);
    assert.equal(api.game.nextCheckpoint[0], 1);
    move(api, api.track.centerline[index + 1]);
    assert.equal(api.game.nextCheckpoint[0], 1);
  });

  test(`${width}x${height}: both walls close at the seam and remain inside the canvas`, () => {
    const api = loadGame(width, height);
    const { track } = api;
    assert.equal(track.wallSegments.length, track.centerline.length * 2);
    for (const side of [track.left, track.right]) {
      assert(track.wallSegments.some(seg => seg.p1 === side.at(-1) && seg.p2 === side[0]));
      for (const p of side) assert(p.x > 0 && p.x < width && p.y > 0 && p.y < height);
    }
    assert.equal(api.pointInRoad({ x: width / 2, y: height / 2 }, track), false);
    for (const p of track.centerline) assert(api.pointInRoad(p, track));
    assert(api.pointInPolygon(track.startPoint, track.startZonePolygon));
  });

  test(`${width}x${height}: playable walls match the approved preview after scaling and rotation`, () => {
    const api = loadGame(width, height);
    const plan = require("../track/brno-circuit.js").buildGeometry();
    const { track } = api;
    assert.equal(track.centerline.length, plan.sections.length);
    assert.equal(track.turnIndices.length, 14);
    const orient = p => height >= width ? { x: -p.y, y: p.x } : p;
    const anchor = orient(plan.sections[12].left);
    const offset = { x: track.left[0].x - anchor.x * track.scale, y: track.left[0].y - anchor.y * track.scale };
    for (let i = 0; i < plan.sections.length; i++) {
      for (const side of ["left", "right"]) {
        const p = orient(plan.sections[(i + 12) % plan.sections.length][side]);
        const expected = { x: p.x * track.scale + offset.x, y: p.y * track.scale + offset.y };
        assert(api.dist(track[side][i], expected) < 1e-7);
      }
      assert(Math.abs(api.dist(track.left[i], track.right[i]) - 80 * track.scale) < 1e-7);
    }
  });

  test(`${width}x${height}: lap gates cannot be crossed from another part of the circuit`, () => {
    const api = loadGame(width, height);
    const line = api.track.centerline;
    for (const gate of api.track.lapGates) {
      let crossings = 0;
      for (let i = 0; i < line.length; i++) {
        const hit = api.segIntersect(line[i], line[(i + 1) % line.length], gate.p1, gate.p2);
        if (hit && api.dist(line[i], hit) > 1e-7) crossings++;
      }
      assert.equal(crossings, 1);
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
