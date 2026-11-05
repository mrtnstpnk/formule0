const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

// Run the real inline game code with a canvas stub; no production test hooks.
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\}\)\(\);\s*$/, `
  globalThis.testGame = {
    game, get track() { return track; }, STATE, onPointerDown, onPointerMove, onPointerUp,
    findNearestIntersection, pointInPolygon, pointInRoad, segIntersect, resetGame, dist, loop,
    app, settings, startRace, showScreen, resize, scheduleResize,
    get layoutPending() { return layoutPending; }
  };
})();`);

function loadGame(width, height, { start = true, savedSettings = null } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const context = new Proxy({}, { get: () => () => {} });
  const makeElement = () => ({
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener() {}, setPointerCapture() {}, focus() {}, setAttribute() {},
    children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
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
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  if (savedSettings !== null) sandbox.localStorage = { getItem: () => savedSettings };
  vm.runInNewContext(source, sandbox);
  const api = sandbox.testGame;
  api.element = id => elements.get(id);
  api.elapse = ms => { now += ms; api.loop(); };
  api.setViewport = (nextWidth, nextHeight, nextDpr = sandbox.window.devicePixelRatio) => {
    width = nextWidth; height = nextHeight; sandbox.window.devicePixelRatio = nextDpr;
  };
  api.resizeTo = (...args) => { api.setViewport(...args); api.resize(); };
  api.flushResize = () => {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(callback => callback());
  };
  if (start) {
    api.startRace();
    api.game.hintDismissed = true;
  }
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

function finalApproach(count = 2, first = 0, turn = 3) {
  const api = loadGame(390, 788, { savedSettings: JSON.stringify({ playerCount: count }) });
  api.game.currentPlayer = first;
  api.game.turnsTaken = Array.from({ length: count }, (_, player) => player < first ? turn : turn - 1);
  api.game.positions = Array.from({ length: count }, () => ({ ...api.track.centerline.at(-2) }));
  api.game.nextCheckpoint = Array(count).fill(api.track.checkpoints.length);
  return api;
}

function finishAt(api, index) {
  begin(api, api.game.positions[api.game.currentPlayer]);
  move(api, api.track.centerline[index]);
  assert.equal(api.game.state, api.STATE.DRAWING, "the stroke must continue beyond the finish");
  end(api, api.track.centerline[index]);
}

function stopBeforeFinish(api) {
  const position = api.game.positions[api.game.currentPlayer];
  begin(api, position);
  end(api, position);
}

test("the second starter wins without an extra turn for the first starter after finishing first", () => {
  const api = finalApproach(2, 1);
  finishAt(api, 4);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 1);
  assert.deepEqual([...api.game.turnsTaken], [3, 3]);
});

test("the first starter must wait for the second player's final turn", () => {
  const api = finalApproach();
  finishAt(api, 4);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.winner, null);
  assert.equal(api.game.finalTurn, 3);
  assert.equal(api.game.currentPlayer, 1);
  assert.equal(api.element("raceStatus").textContent, "Vyrovnávací tah");
  stopBeforeFinish(api);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 0);
  assert.deepEqual([...api.game.turnsTaken], [3, 3]);
});

for (const [firstDistance, secondDistance, winner] of [[4, 10, 1], [10, 4, 0]]) {
  test(`equal-turn finishers at sections ${firstDistance} and ${secondDistance} choose the further endpoint`, () => {
    const api = finalApproach();
    finishAt(api, firstDistance);
    finishAt(api, secondDistance);
    assert.equal(api.game.state, api.STATE.GAME_OVER);
    assert.equal(api.game.winner, winner);
    assert.equal(api.game.finishes[0].turns, 3);
    assert.equal(api.game.finishes[1].turns, 3);
    assert(api.game.finishes[winner].distance > api.game.finishes[1 - winner].distance);
  });
}

test("crossing the line keeps the pointer active and records the whole stroke after the finish", () => {
  const api = finalApproach();
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[1]);
  const near = api.game.finishes[0].distance;
  assert.equal(api.game.activePointerId, 1);
  assert.equal(api.game.winner, null);
  assert.equal(api.element("raceStatus").textContent, "Dojezd za cíl");
  move(api, api.track.centerline[10]);
  assert(api.game.finishes[0].distance > near);
  end(api, api.track.centerline[10]);
  assert(api.dist(api.game.positions[0], api.track.centerline[10]) < 1e-7);
});

test("exactly equal finish distances are a draw instead of favoring the first starter", () => {
  const api = finalApproach();
  finishAt(api, 6);
  finishAt(api, 6);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, null);
  assert.deepEqual([...api.game.winners], [0, 1]);
  assert.equal(api.element("victoryText").textContent, "Remíza!");
});

test("sideways movement after the finish does not increase the final distance", () => {
  const api = finalApproach();
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[4]);
  const distance = api.game.finishes[0].distance;
  for (let i = 0; i < 3; i++) {
    move(api, interpolate(api.track.left[4], api.track.right[4], 0.2));
    move(api, interpolate(api.track.left[4], api.track.right[4], 0.8));
    move(api, api.track.centerline[4]);
  }
  assert(Math.abs(api.game.finishes[0].distance - distance) < 1e-7);
  end(api, api.track.centerline[4]);
  finishAt(api, 8);
  assert.equal(api.game.winner, 1);
});

test("reversing after crossing the finish reduces the distance", () => {
  const api = finalApproach();
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[12]);
  move(api, api.track.centerline[4]);
  end(api, api.track.centerline[4]);
  finishAt(api, 8);
  assert.equal(api.game.winner, 1);
});

test("reversing behind the finish records a negative distance rather than almost a whole extra lap", () => {
  const api = finalApproach();
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[4]);
  move(api, api.track.centerline.at(-2));
  end(api, api.track.centerline.at(-2));
  assert(api.game.finishes[0].distance < 0);
  finishAt(api, 0);
  assert.equal(api.game.winner, 1);
});

test("time expiry ends each final stroke and then resolves the race", () => {
  const api = finalApproach();
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[4]);
  api.elapse(501);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.currentPlayer, 1);
  begin(api, api.game.positions[1]);
  move(api, api.track.centerline[10]);
  api.elapse(501);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 1);
});

test("a collision after the finish clips the final distance and still gives the opponent a turn", () => {
  const api = finalApproach();
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[6]);
  move(api, interpolate(api.track.centerline[6], api.track.left[6], 1.2));
  assert.equal(api.game.strokes.at(-1).crashed, true);
  assert.equal(api.game.currentPlayer, 1);
  assert(api.game.finishes[0]);
  assert(api.dist(api.game.positions[0], api.track.left[6]) < 1e-7);
  finishAt(api, 10);
  assert.equal(api.game.winner, 1);
});

test("crossing the line before all checkpoints does not start the final round", () => {
  const api = finalApproach();
  api.game.nextCheckpoint[0] = 1;
  begin(api, api.game.positions[0]);
  move(api, api.track.centerline[4]);
  end(api, api.track.centerline[4]);
  assert.equal(api.game.finishes[0], null);
  assert.equal(api.game.finalTurn, null);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
});

for (const count of [3, 4]) {
  for (let first = 0; first < count; first++) {
    test(`${count} players, first finisher ${first + 1}: equalize turns, then race on for lower places`, () => {
      const api = finalApproach(count, first);
      finishAt(api, 4);
      for (let player = first + 1; player < count; player++) {
        assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
        assert.equal(api.game.currentPlayer, player);
        stopBeforeFinish(api);
      }
      assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
      assert.equal(api.game.finalTurn, null);
      assert.equal(api.game.currentPlayer, first === 0 ? 1 : 0);
      assert.deepEqual([...api.game.turnsTaken], Array(count).fill(3));
      for (let remaining = 0; remaining < count - 1; remaining++) finishAt(api, 4);
      assert.equal(api.game.state, api.STATE.GAME_OVER);
      assert.equal(api.game.winner, first);
      assert.equal(api.game.standings.length, count);
    });
  }
}

test("the third player may win a four-player final round but must wait for the fourth", () => {
  const api = finalApproach(4);
  finishAt(api, 4);
  stopBeforeFinish(api);
  finishAt(api, 12);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.currentPlayer, 3);
  finishAt(api, 8);
  assert.equal(api.game.winner, 2);
  assert.deepEqual([...api.game.turnsTaken], [3, 3, 3, 3]);
});

test("rotation in the final round preserves counters and distances in circuit units", () => {
  const api = finalApproach();
  finishAt(api, 4);
  const distance = api.game.finishes[0].distance;
  api.showScreen("home");
  api.resizeTo(1024, 712);
  assert.equal(api.game.finalTurn, 3);
  assert.equal(api.game.finishes[0].distance, distance);
  assert.deepEqual([...api.game.turnsTaken], [3, 2]);
  api.showScreen("race");
  finishAt(api, 8);
  assert.equal(api.game.winner, 1);
});

test("a new race clears all final-round records and turn counters", () => {
  const api = finalApproach();
  finishAt(api, 4);
  api.startRace();
  assert.equal(api.game.finalTurn, null);
  assert.deepEqual([...api.game.turnsTaken], [0, 0]);
  assert.deepEqual([...api.game.finishes], [null, null]);
  assert.deepEqual([...api.game.winners], []);
  assert.deepEqual([...api.game.standings], []);
  assert.equal(api.element("raceStatus").hidden, true);
});

test("four players continue for second and third place, then the only unfinished player is last", () => {
  const api = finalApproach(4);
  finishAt(api, 4);
  const firstPosition = api.game.positions[0];
  const firstDistance = api.game.finishes[0].distance;
  for (let i = 0; i < 3; i++) stopBeforeFinish(api);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.currentPlayer, 1);
  assert.equal(api.game.finalTurn, null);
  assert.equal(api.element("raceStatus").textContent, "Závod o další místa");
  assert.equal(api.game.standings.length, 0);
  finishAt(api, 12);
  stopBeforeFinish(api);
  stopBeforeFinish(api);
  assert.equal(api.game.currentPlayer, 2);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  finishAt(api, 6);
  assert.equal(api.game.currentPlayer, 3);
  stopBeforeFinish(api);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.positions[0], firstPosition);
  assert.equal(api.game.finishes[0].distance, firstDistance);
  assert.deepEqual([...api.game.turnsTaken], [3, 4, 5, 5]);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place, entry.finished]),
    [[0, 1, true], [1, 2, true], [2, 3, true], [3, 4, false]]);
  assert.equal(api.game.finishes[3], null);
  assert.equal(api.element("raceStandings").children.length, 4);
});

test("the last unfinished player can still win during its equal-turn chance", () => {
  const api = finalApproach(3);
  finishAt(api, 4);
  finishAt(api, 8);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.currentPlayer, 2);
  finishAt(api, 12);
  assert.equal(api.game.winner, 2);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place]), [[2, 1], [1, 2], [0, 3]]);
  assert(api.game.standings.every(entry => entry.finished));
});

test("an unfinished last place is assigned only after its equal-turn chance is used", () => {
  const api = finalApproach(3);
  finishAt(api, 4);
  finishAt(api, 8);
  const position = api.game.positions[2];
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  stopBeforeFinish(api);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert(api.dist(api.game.positions[2], position) < 1e-7);
  assert.deepEqual([...api.game.turnsTaken], [3, 3, 3]);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place, entry.finished]),
    [[1, 1, true], [0, 2, true], [2, 3, false]]);
});

test("fewer turns outrank a longer finish distance on a later turn", () => {
  const api = finalApproach(3, 2);
  finishAt(api, 1);
  assert.equal(api.game.currentPlayer, 0);
  finishAt(api, 12);
  stopBeforeFinish(api);
  assert.equal(api.game.winner, 2);
  assert(api.game.finishes[0].distance > api.game.finishes[2].distance);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place, entry.turns]),
    [[2, 1, 3], [0, 2, 4], [1, 3, 4]]);
});

test("shared first place still lets two remaining players race for third and fourth", () => {
  const api = finalApproach(4);
  finishAt(api, 6);
  finishAt(api, 6);
  stopBeforeFinish(api);
  stopBeforeFinish(api);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.currentPlayer, 2);
  finishAt(api, 4);
  stopBeforeFinish(api);
  assert.deepEqual([...api.game.winners], [0, 1]);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place]), [[0, 1], [1, 1], [2, 3], [3, 4]]);
});

test("shared second place is displayed independently of the winner", () => {
  const api = finalApproach(4);
  finishAt(api, 4);
  for (let i = 0; i < 3; i++) stopBeforeFinish(api);
  finishAt(api, 6);
  finishAt(api, 6);
  stopBeforeFinish(api);
  assert.equal(api.game.winner, 0);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place]), [[0, 1], [1, 2], [2, 2], [3, 4]]);
});

test("all four same-turn finishers are sorted by their final distances", () => {
  const api = finalApproach(4);
  for (const index of [4, 10, 7, 12]) finishAt(api, index);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place]), [[3, 1], [1, 2], [2, 3], [0, 4]]);
  assert(api.game.standings.every(entry => entry.finished));
});

test("four exactly equal finishes share first place without an arbitrary lower rank", () => {
  const api = finalApproach(4);
  for (let player = 0; player < 4; player++) finishAt(api, 6);
  assert.deepEqual([...api.game.winners], [0, 1, 2, 3]);
  assert.deepEqual(Array.from(api.game.standings, entry => entry.place), [1, 1, 1, 1]);
});

test("solo mode must finish the lap and cannot be automatically classified last", () => {
  const api = finalApproach(1);
  stopBeforeFinish(api);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.standings.length, 0);
  finishAt(api, 4);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place, entry.finished]), [[0, 1, true]]);
});

test("menu and rotation preserve confirmed finishes while remaining players race on", () => {
  const api = finalApproach(4);
  finishAt(api, 4);
  for (let i = 0; i < 3; i++) stopBeforeFinish(api);
  const planPosition = api.track.toPlan(api.game.positions[0]);
  const firstDistance = api.game.finishes[0].distance;
  api.showScreen("home");
  api.resizeTo(1024, 712);
  api.showScreen("race");
  assert.equal(api.game.finishes[0].distance, firstDistance);
  assert(api.dist(api.track.toPlan(api.game.positions[0]), planPosition) < 1e-7);
  assert.equal(api.game.currentPlayer, 1);
  finishAt(api, 8);
  stopBeforeFinish(api);
  finishAt(api, 10);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place]), [[0, 1], [3, 2], [1, 3], [2, 4]]);
});

test("a timeout and collision can settle lower places without requiring the last player to finish", () => {
  const api = finalApproach(3);
  finishAt(api, 4);
  stopBeforeFinish(api);
  stopBeforeFinish(api);
  begin(api, api.game.positions[1]);
  move(api, api.track.centerline[10]);
  api.elapse(501);
  assert.equal(api.game.currentPlayer, 2);
  begin(api, api.game.positions[2]);
  move(api, interpolate(api.game.positions[2], api.track.left.at(-2), 1.2));
  assert.equal(api.game.strokes.at(-1).crashed, true);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.deepEqual(Array.from(api.game.standings, entry => [entry.player, entry.place, entry.finished]), [[0, 1, true], [1, 2, true], [2, 3, false]]);
});

test("a rematch clears the overall classification after a completed race", () => {
  const api = finalApproach(3);
  for (const index of [4, 8, 12]) finishAt(api, index);
  assert.equal(api.game.standings.length, 3);
  api.startRace();
  assert.deepEqual([...api.game.standings], []);
  assert.deepEqual([...api.game.winners], []);
  assert.deepEqual([...api.game.finishes], [null, null, null]);
  assert.deepEqual([...api.game.turnsTaken], [0, 0, 0]);
  assert.equal(api.game.currentPlayer, 0);
});

test("home, settings and about screens cannot accidentally start a racing turn", () => {
  const api = loadGame(390, 788, { start: false });
  assert.equal(api.app.screen, "home");
  assert.equal(api.app.raceStarted, false);
  assert.equal(api.element("resumeBtn").hidden, true);
  api.game.hintDismissed = true;
  for (const screen of ["home", "settings", "about"]) {
    api.showScreen(screen);
    begin(api, api.track.startPoint);
    assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
    assert.equal(api.game.currentStroke, null);
    assert.equal(api.game.currentPlayer, 0);
  }
});

test("opening the menu commits an active stroke and resuming preserves the race", () => {
  const api = loadGame(390, 788);
  begin(api, api.track.startPoint);
  move(api, api.track.centerline.at(-7));
  api.showScreen("home");
  assert.equal(api.game.currentStroke, null);
  assert.equal(api.game.currentPlayer, 1);
  assert.equal(api.element("resumeBtn").hidden, false);
  const position = api.game.positions[0];
  api.elapse(2000);
  assert.equal(api.game.strokes.length, 1);
  api.showScreen("settings");
  api.showScreen("about");
  api.showScreen("race");
  assert.equal(api.game.positions[0], position);
  assert.equal(api.game.currentPlayer, 1);
});

for (const duration of [300, 500, 800]) {
  test(`selected ${duration} ms duration ends the turn at its deadline and is fixed for that stroke`, () => {
    const api = loadGame(390, 788);
    api.settings.strokeDurationMs = duration;
    begin(api, api.track.startPoint);
    assert.equal(api.game.strokeDurationMs, duration);
    api.settings.strokeDurationMs = duration === 800 ? 300 : 800;
    api.elapse(duration - 1);
    assert.equal(api.game.state, api.STATE.DRAWING);
    api.elapse(1);
    assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
    assert.equal(api.game.currentPlayer, 1);
    assert.equal(api.game.strokes[0].crashed, false);
  });
}

test("a new race clears progress and uses the chosen hint preference", () => {
  const api = loadGame(390, 788);
  begin(api, api.track.startPoint);
  end(api, api.track.startPoint);
  api.game.nextCheckpoint[0] = 2;
  api.settings.showHint = false;
  api.settings.strokeDurationMs = 800;
  api.startRace();
  assert.equal(api.game.currentPlayer, 0);
  assert.equal(api.game.positions[0], null);
  assert.equal(api.game.strokes.length, 0);
  assert.equal(api.game.nextCheckpoint[0], 0);
  assert.equal(api.settings.strokeDurationMs, 800);
  assert.equal(api.game.hintDismissed, true);
  api.settings.showHint = true;
  api.startRace();
  assert.equal(api.game.hintDismissed, false);
});

test("malformed or unsupported saved settings fall back to valid defaults", () => {
  for (const savedSettings of ["{bad json", "null", '{"strokeDurationMs":1000}', '{"strokeDurationMs":1,"showHint":"false","vibration":0}']) {
    const api = loadGame(390, 788, { start: false, savedSettings });
    assert.equal(api.settings.strokeDurationMs, 500);
    assert.equal(api.settings.showHint, true);
    assert.equal(api.settings.playerCount, 2);
  }
  const api = loadGame(390, 788, { start: false, savedSettings: '{"strokeDurationMs":800,"playerCount":4,"showHint":false,"vibration":false,"showTimer":false}' });
  assert.equal(api.settings.strokeDurationMs, 800);
  assert.equal(api.settings.showHint, false);
  assert.equal(api.settings.playerCount, 4);
  assert.equal("vibration" in api.settings, false);
  assert.equal(api.settings.showTimer, false);
});

test("a finished race offers a new start instead of continuing the finished race", () => {
  const api = loadGame(390, 788);
  api.game.state = api.STATE.GAME_OVER;
  api.showScreen("home");
  assert.equal(api.element("resumeBtn").hidden, true);
});

for (const count of [1, 2, 3, 4]) {
  test(`${count} player race cycles through exactly the selected players`, () => {
    const api = loadGame(390, 788, { savedSettings: JSON.stringify({ playerCount: count }) });
    assert.equal(api.game.playerCount, count);
    assert.equal(api.game.positions.length, count);
    assert.equal(api.game.nextCheckpoint.length, count);
    for (let turn = 0; turn < count * 2; turn++) {
      const player = turn % count;
      assert.equal(api.game.currentPlayer, player);
      const position = api.game.positions[player] || api.track.startPoint;
      begin(api, position);
      assert.equal(api.game.state, api.STATE.DRAWING);
      end(api, position);
      assert.equal(api.game.strokes.at(-1).player, player);
      assert.equal(api.game.currentPlayer, (player + 1) % count);
    }
  });
}

test("invalid player counts fall back to two and old settings remain usable", () => {
  for (const playerCount of [0, 5, -1, 1.5, "3", null]) {
    const api = loadGame(390, 788, { savedSettings: JSON.stringify({ playerCount }) });
    assert.equal(api.game.playerCount, 2);
    assert.equal(api.settings.playerCount, 2);
  }
  const api = loadGame(390, 788, { savedSettings: '{"strokeDurationMs":800,"vibration":false}' });
  assert.equal(api.game.playerCount, 2);
  assert.equal(api.settings.strokeDurationMs, 800);
  assert.equal("vibration" in api.settings, false);
});

test("changing player count preserves an existing race and applies to the next new race", () => {
  const api = loadGame(390, 788);
  begin(api, api.track.startPoint);
  end(api, api.track.startPoint);
  const position = api.game.positions[0];
  api.settings.playerCount = 4;
  api.showScreen("home");
  api.showScreen("race");
  assert.equal(api.game.playerCount, 2);
  assert.equal(api.game.currentPlayer, 1);
  assert.equal(api.game.positions[0], position);
  api.startRace();
  assert.equal(api.game.playerCount, 4);
  assert.equal(api.game.positions.length, 4);
  assert.equal(api.game.strokes.length, 0);
  assert.deepEqual([...api.game.nextCheckpoint], [0, 0, 0, 0]);
});

test("all four players keep separate checkpoint progress and positions", () => {
  const api = loadGame(390, 788, { savedSettings: '{"playerCount":4}' });
  const index = api.track.checkpoints[0].index;
  for (let player = 0; player < 4; player++) {
    api.game.positions[player] = api.track.centerline[index - 2];
    begin(api, api.game.positions[player]);
    move(api, api.track.centerline[index + 2]);
    end(api, api.track.centerline[index + 2]);
    assert.equal(api.game.nextCheckpoint[player], 1);
    assert.equal(api.game.positions[player], api.game.strokes.at(-1).points.at(-1));
    for (let other = player + 1; other < 4; other++) assert.equal(api.game.nextCheckpoint[other], 0);
  }
  assert.equal(api.game.currentPlayer, 0);
  assert.deepEqual([...api.game.nextCheckpoint], [1, 1, 1, 1]);
});

test("player four can finish and has a named victory screen", () => {
  const api = loadGame(390, 788, { savedSettings: '{"playerCount":4}' });
  const finish = api.track.centerline[0], prev = api.track.centerline.at(-2);
  const origin = interpolate(finish, prev, 1 / api.dist(finish, prev));
  api.game.currentPlayer = 3;
  api.game.turnsTaken = [1, 1, 1, 0];
  api.game.positions[3] = origin;
  api.game.nextCheckpoint[3] = api.track.checkpoints.length;
  for (let player = 0; player < 3; player++) {
    api.game.positions[player] = { ...origin };
    api.game.nextCheckpoint[player] = api.track.checkpoints.length;
  }
  begin(api, origin);
  const destination = interpolate(finish, prev, -5 / api.dist(finish, prev));
  move(api, destination);
  assert.equal(api.game.state, api.STATE.DRAWING);
  end(api, destination);
  for (let player = 0; player < 3; player++) finishAt(api, 4);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 3);
  assert.equal(api.element("victoryText").textContent, "Hráč 4 vítězí!");
});

test("solo mode can complete a lap over multiple turns without an opponent", () => {
  const api = loadGame(390, 788, { savedSettings: '{"playerCount":1}' });
  const len = api.track.centerline.length;
  const halfway = Math.floor(len / 2);
  begin(api, api.track.startPoint);
  for (let i = len - 7; i <= len + halfway; i++) move(api, api.track.centerline[i % len]);
  end(api, api.track.centerline[halfway]);
  assert.equal(api.game.currentPlayer, 0);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  begin(api, api.game.positions[0]);
  for (let i = halfway + 1; i <= len; i++) move(api, api.track.centerline[i % len]);
  end(api, api.track.centerline[0]);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 0);
});

test("rotation preserves the positions and lap progress of all four players", () => {
  const api = loadGame(820, 1124, { savedSettings: '{"playerCount":4}' });
  const indices = [30, 150, 450, 700];
  for (let player = 0; player < 4; player++) {
    api.game.positions[player] = api.track.centerline[indices[player]];
    api.game.strokes.push({ player, points: [api.game.positions[player]], crashed: false });
    api.game.nextCheckpoint[player] = player;
  }
  api.resizeTo(1180, 764);
  assert.equal(api.game.playerCount, 4);
  for (let player = 0; player < 4; player++) {
    assert(api.dist(api.game.positions[player], api.track.centerline[indices[player]]) < 1e-7);
    assert.equal(api.game.positions[player], api.game.strokes[player].points[0]);
    assert.equal(api.game.nextCheckpoint[player], player);
  }
});

test("tablet rotation preserves both cars, complete stroke history, endpoints and lap progress", () => {
  const api = loadGame(820, 1124);
  const len = api.track.centerline.length;
  const index = api.track.checkpoints[0].index + 4;
  begin(api, api.track.startPoint);
  for (let i = len - 7; i <= len + index; i++) move(api, api.track.centerline[i % len]);
  end(api, api.track.centerline[index]);
  assert.equal(api.game.nextCheckpoint[0], 1);
  begin(api, api.track.startPoint);
  move(api, interpolate(api.track.startPoint, api.track.left[len - 8], 1.1));
  assert.equal(api.game.strokes[1].crashed, true);
  const original = api.game.strokes.map(s => s.points.map(p => ({ x: p.x, y: p.y })));
  const checkpoint = [...api.game.nextCheckpoint];
  api.resizeTo(1180, 764);
  assert.equal(api.game.currentPlayer, 0);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.deepEqual([...api.game.nextCheckpoint], checkpoint);
  assert.equal(api.game.strokes.length, 2);
  assert.equal(api.game.strokes[1].crashed, true);
  assert(api.dist(api.game.positions[0], api.track.centerline[index]) < 1e-7);
  assert(api.dist(api.game.positions[1], api.track.left[len - 8]) < 1e-7);
  assert.equal(api.game.positions[0], api.game.strokes[0].points.at(-1));
  assert.equal(api.game.positions[1], api.game.strokes[1].points.at(-1));
  for (let rotation = 0; rotation < 10; rotation++) {
    api.resizeTo(820, 1124);
    for (let s = 0; s < original.length; s++) {
      for (let p = 0; p < original[s].length; p++) assert(api.dist(api.game.strokes[s].points[p], original[s][p]) < 1e-7);
    }
    api.resizeTo(1180, 764);
  }
});

for (const side of ["left", "right"]) {
  test(`tablet rotation preserves recovery from the ${side} wall`, () => {
    const api = loadGame(820, 1124);
    crashFromStart(api, side);
    api.resizeTo(1180, 764);
    const position = api.game.positions[0];
    begin(api, position);
    assert(api.game.currentStroke.startCircle);
    const destination = interpolate(position, api.track.startPoint, 1.2);
    move(api, destination);
    assert.equal(api.game.state, api.STATE.DRAWING);
    assert.equal(api.game.currentStroke.startCircle, null);
    end(api, destination);
    assert.equal(api.game.strokes.at(-1).crashed, false);
    assert(api.dist(api.game.positions[0], destination) < 1e-7);
  });
}

test("an in-progress stroke ends once at its valid endpoint when the tablet rotates", () => {
  const api = loadGame(820, 1124);
  begin(api, api.track.startPoint);
  move(api, api.track.centerline.at(-7));
  api.resizeTo(1180, 764);
  assert.equal(api.game.state, api.STATE.WAITING_FOR_TOUCH);
  assert.equal(api.game.currentStroke, null);
  assert.equal(api.game.activePointerId, null);
  assert.equal(api.game.strokes.length, 1);
  assert.equal(api.game.currentPlayer, 1);
  assert(api.dist(api.game.positions[0], api.track.centerline.at(-7)) < 1e-7);
  end(api, api.track.startPoint);
  api.elapse(2000);
  assert.equal(api.game.strokes.length, 1);
  assert.equal(api.game.currentPlayer, 1);
});

test("duplicate and zero-size resize events do not consume a turn or erase progress", () => {
  const api = loadGame(820, 1124);
  begin(api, api.track.startPoint);
  move(api, api.track.centerline.at(-7));
  const track = api.track;
  const stroke = api.game.currentStroke;
  api.resizeTo(820, 1124);
  api.scheduleResize();
  assert.equal(api.game.currentStroke, stroke);
  assert.equal(api.layoutPending, false);
  api.resizeTo(0, 0);
  assert.equal(api.game.currentStroke, stroke);
  assert.equal(api.track, track);
  api.resizeTo(1180, 764);
  assert.equal(api.game.strokes.length, 1);
});

test("new touches are ignored until a debounced orientation change has finished", () => {
  const api = loadGame(820, 1124);
  begin(api, api.track.startPoint);
  move(api, api.track.centerline.at(-7));
  api.setViewport(1180, 764);
  api.scheduleResize();
  api.scheduleResize();
  assert.equal(api.layoutPending, true);
  assert.equal(api.game.strokes.length, 1);
  begin(api, api.track.startPoint);
  assert.equal(api.game.currentStroke, null);
  api.flushResize();
  assert.equal(api.layoutPending, false);
  assert.equal(api.track.width, 1180);
  begin(api, api.track.startPoint);
  assert.equal(api.game.state, api.STATE.DRAWING);
  assert.equal(api.game.currentPlayer, 1);
});

test("same-orientation resizing and pixel density changes preserve the race behind menus", () => {
  const api = loadGame(1024, 712);
  begin(api, api.track.startPoint);
  end(api, api.track.startPoint);
  api.settings.strokeDurationMs = 800;
  api.showScreen("settings");
  api.resizeTo(1400, 900, 2);
  assert.equal(api.app.screen, "settings");
  assert.equal(api.app.raceStarted, true);
  assert.equal(api.game.strokes.length, 1);
  assert.equal(api.game.currentPlayer, 1);
  assert.equal(api.game.hintDismissed, true);
  assert.equal(api.settings.strokeDurationMs, 800);
  assert(api.dist(api.game.positions[0], api.track.startPoint) < 1e-7);
});

test("lap progress survives rotation, the lap can finish, and a later resize preserves the win", () => {
  const api = loadGame(820, 1124);
  const len = api.track.centerline.length;
  const index = api.track.checkpoints[0].index + 4;
  begin(api, api.track.startPoint);
  for (let i = len - 7; i <= len + index; i++) move(api, api.track.centerline[i % len]);
  end(api, api.track.centerline[index]);
  passOpponent(api);
  api.resizeTo(1180, 764);
  begin(api, api.game.positions[0]);
  for (let i = index + 1; i <= len; i++) move(api, api.track.centerline[i % len]);
  end(api, api.track.centerline[0]);
  passOpponent(api);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 0);
  const strokes = api.game.strokes.length;
  api.resizeTo(820, 1124);
  assert.equal(api.game.state, api.STATE.GAME_OVER);
  assert.equal(api.game.winner, 0);
  assert.equal(api.game.strokes.length, strokes);
  assert(api.dist(api.game.positions[0], api.track.centerline[0]) < 1e-7);
});

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
        if (reason === "timeout") api.elapse(501);
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
    assert.equal(api.game.state, api.STATE.DRAWING);
    end(api, outside);
    passOpponent(api);
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
      assert.equal(api.game.state, api.STATE.DRAWING);
    }
    end(api, api.track.centerline[0]);
    passOpponent(api);
    assert.equal(api.game.state, api.STATE.GAME_OVER);
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
