(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const board = $("#game-board");
  const towers = [...document.querySelectorAll(".tower")];
  const countSelect = $("#disk-count");
  const moveCountEl = $("#move-count");
  const timerEl = $("#timer");
  const minimumEl = $("#minimum-moves");
  const bestScoreEl = $("#best-score");
  const messageEl = $("#game-message");
  const undoButton = $("#undo-button");
  const solveButton = $("#solve-button");
  const stopButton = $("#stop-button");
  const modal = $("#win-modal");
  const canvas = $("#confetti-canvas");
  const ctx = canvas.getContext("2d");
  const sound = { muted: false, context: null };
  const state = {
    diskCount: 5,
    pegs: [[], [], []],
    moves: 0,
    history: [],
    selectedPeg: null,
    busy: false,
    startedAt: null,
    elapsedBeforeStart: 0,
    timerId: null,
    won: false,
    solverActive: false,
    solverPaused: false,
    solverStop: false,
    solverId: 0,
    touchDrag: null,
    suppressClick: false,
    hintTimeout: null
  };
  let confettiFrame = null;
  let confettiPieces = [];

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };
  const elapsedSeconds = () => state.startedAt === null
    ? state.elapsedBeforeStart
    : state.elapsedBeforeStart + Math.floor((Date.now() - state.startedAt) / 1000);

  function setMessage(message) {
    messageEl.textContent = message;
  }

  function playTone(type) {
    if (sound.muted) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      sound.context ||= new AudioContext();
      const audio = sound.context;
      if (audio.state === "suspended") audio.resume();
      const now = audio.currentTime;
      const notes = type === "win" ? [523.25, 659.25, 783.99] : type === "invalid" ? [155] : [392];
      notes.forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const at = now + index * (type === "win" ? .13 : 0);
        oscillator.type = type === "invalid" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(type === "win" ? .075 : .045, at + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, at + (type === "win" ? .28 : .13));
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + (type === "win" ? .3 : .15));
      });
    } catch (error) {
      console.warn("Audio playback is unavailable.", error);
    }
  }

  function readBestScore() {
    try {
      const scores = JSON.parse(localStorage.getItem("hanoi-best-scores") || "{}");
      const score = scores[state.diskCount];
      bestScoreEl.textContent = score ? `${score.moves} · ${formatTime(score.time)}` : "—";
    } catch (error) {
      bestScoreEl.textContent = "—";
      setMessage("Saved scores are unavailable in this browser session.");
      console.warn("Could not read saved scores.", error);
    }
  }

  function saveBestScore() {
    try {
      const scores = JSON.parse(localStorage.getItem("hanoi-best-scores") || "{}");
      const previous = scores[state.diskCount];
      const time = elapsedSeconds();
      if (!previous || state.moves < previous.moves || (state.moves === previous.moves && time < previous.time)) {
        scores[state.diskCount] = { moves: state.moves, time };
        localStorage.setItem("hanoi-best-scores", JSON.stringify(scores));
      }
      readBestScore();
    } catch (error) {
      setMessage("You won, but your best score could not be saved.");
      console.warn("Could not save best score.", error);
    }
  }

  function render() {
    towers.forEach((tower, pegIndex) => {
      const stack = tower.querySelector(".disk-stack");
      stack.replaceChildren();
      state.pegs[pegIndex].forEach((size, index) => {
        const disk = document.createElement("div");
        disk.className = `disk disk-size-${size}`;
        disk.dataset.size = String(size);
        disk.dataset.peg = String(pegIndex);
        disk.setAttribute("role", "button");
        disk.setAttribute("aria-label", `Disk ${size}${index === state.pegs[pegIndex].length - 1 ? ", top disk, movable" : ""}`);
        disk.setAttribute("tabindex", index === state.pegs[pegIndex].length - 1 ? "0" : "-1");
        disk.draggable = index === state.pegs[pegIndex].length - 1;
        disk.style.width = `${Math.min(190, 62 + size * 15)}px`;
        if (index === state.pegs[pegIndex].length - 1) disk.classList.add("movable");
        if (state.selectedPeg === pegIndex && index === state.pegs[pegIndex].length - 1) disk.classList.add("selected");
        disk.textContent = String(size);
        stack.appendChild(disk);
      });
      tower.setAttribute("aria-label", `Tower ${pegIndex + 1}, ${state.pegs[pegIndex].length} ${state.pegs[pegIndex].length === 1 ? "disk" : "disks"}${pegIndex === 0 ? ", start tower" : pegIndex === 2 ? ", finish tower" : ", buffer tower"}`);
    });
    moveCountEl.textContent = String(state.moves);
    undoButton.disabled = state.history.length === 0 || state.busy || state.solverActive || state.won;
    countSelect.disabled = state.busy || state.solverActive || state.won;
    $("#reset-button").disabled = state.busy;
    $("#hint-button").disabled = state.busy || state.solverActive || state.won;
  }

  function updateTimer() {
    timerEl.textContent = formatTime(elapsedSeconds());
  }

  function startTimer() {
    if (state.startedAt !== null) return;
    state.startedAt = Date.now();
    state.timerId = window.setInterval(updateTimer, 250);
  }

  function stopTimer() {
    if (state.timerId !== null) window.clearInterval(state.timerId);
    state.timerId = null;
    if (state.startedAt !== null) state.elapsedBeforeStart += Math.floor((Date.now() - state.startedAt) / 1000);
    state.startedAt = null;
    updateTimer();
  }

  function resetGame(count = state.diskCount) {
    stopSolver();
    if (state.busy) return;
    stopTimer();
    state.diskCount = count;
    state.pegs = [Array.from({ length: count }, (_, i) => count - i), [], []];
    state.moves = 0;
    state.history = [];
    state.selectedPeg = null;
    state.elapsedBeforeStart = 0;
    state.won = false;
    countSelect.value = String(count);
    minimumEl.innerHTML = `${2 ** count - 1} <small>moves</small>`;
    clearHint();
    render();
    readBestScore();
    setMessage("Choose a tower to pick up its top disk.");
  }

  function invalidMove(pegIndex, message) {
    towers[pegIndex].classList.remove("shake");
    void towers[pegIndex].offsetWidth;
    towers[pegIndex].classList.add("shake");
    setMessage(message);
    playTone("invalid");
    window.setTimeout(() => towers[pegIndex].classList.remove("shake"), 450);
  }

  function isLegalMove(from, to) {
    const source = state.pegs[from];
    const destination = state.pegs[to];
    if (from === to || source.length === 0) return false;
    return destination.length === 0 || source[source.length - 1] < destination[destination.length - 1];
  }

  function animateMove(from, to, diskSize) {
    const source = towers[from].querySelector(`.disk[data-size="${diskSize}"]`);
    const sourceRect = source.getBoundingClientRect();
    const destinationTowerRect = towers[to].getBoundingClientRect();
    const baseRect = towers[to].querySelector(".platform").getBoundingClientRect();
    const diskHeight = sourceRect.height;
    const destinationIndex = state.pegs[to].length;
    const targetX = destinationTowerRect.left + destinationTowerRect.width / 2 - sourceRect.width / 2;
    const diskGap = parseFloat(getComputedStyle(source).marginTop);
    const targetY = baseRect.top - (destinationIndex + 1) * diskHeight - destinationIndex * diskGap;
    const flight = source.cloneNode(true);
    flight.classList.remove("selected", "movable");
    flight.classList.add("disk-flight");
    flight.style.left = `${sourceRect.left}px`;
    flight.style.top = `${sourceRect.top}px`;
    flight.style.width = `${sourceRect.width}px`;
    flight.style.height = `${sourceRect.height}px`;
    document.body.appendChild(flight);
    source.style.visibility = "hidden";
    const lift = Math.min(sourceRect.top, targetY) - Math.max(50, Math.min(115, window.innerHeight * .14));
    const x = targetX - sourceRect.left;
    const y = targetY - sourceRect.top;
    const animation = flight.animate([
      { transform: "translate(0, 0)" },
      { transform: `translate(0, ${lift - sourceRect.top}px)`, offset: .32 },
      { transform: `translate(${x}px, ${lift - sourceRect.top}px)`, offset: .72 },
      { transform: `translate(${x}px, ${y}px)` }
    ], { duration: 540, easing: "cubic-bezier(.22,.75,.22,1)", fill: "forwards" });
    return animation.finished.catch(() => {}).then(() => {
      flight.remove();
      source.style.visibility = "";
    });
  }

  async function makeMove(from, to, { automatic = false } = {}) {
    if (state.busy || state.won || (state.solverActive && !automatic)) return false;
    if (!isLegalMove(from, to)) {
      const top = state.pegs[from][state.pegs[from].length - 1];
      const destinationTop = state.pegs[to][state.pegs[to].length - 1];
      invalidMove(to, from === to
        ? "Choose a different tower for that disk."
        : !top ? "There isn't a disk to move from this tower."
          : destinationTop && top > destinationTop ? "A larger disk can't sit on a smaller one."
            : "That disk can't move there.");
      return false;
    }
    const diskSize = state.pegs[from][state.pegs[from].length - 1];
    state.busy = true;
    state.selectedPeg = null;
    clearHint();
    render();
    startTimer();
    await animateMove(from, to, diskSize);
    state.pegs[from].pop();
    state.pegs[to].push(diskSize);
    state.history.push({ from, to });
    state.moves += 1;
    state.busy = false;
    render();
    const landed = towers[to].querySelector(`.disk[data-size="${diskSize}"]`);
    if (landed) {
      landed.classList.add("landing");
      window.setTimeout(() => landed.classList.remove("landing"), 350);
    }
    playTone("move");
    setMessage(automatic ? "Auto solve is moving the disks…" : "Nice move. What’s your next step?");
    if (state.pegs[2].length === state.diskCount) finishGame();
    return true;
  }

  function handleTowerClick(pegIndex) {
    if (state.suppressClick) { state.suppressClick = false; return; }
    if (state.busy || state.won || state.solverActive) return;
    const peg = state.pegs[pegIndex];
    if (state.selectedPeg === null) {
      if (!peg.length) {
        setMessage("That tower is empty. Choose a tower with a disk.");
        return;
      }
      state.selectedPeg = pegIndex;
      render();
      setMessage(`Disk ${peg[peg.length - 1]} selected. Choose a tower to place it on.`);
      playTone("move");
      return;
    }
    const from = state.selectedPeg;
    if (from === pegIndex) {
      state.selectedPeg = null;
      render();
      setMessage("Selection cleared. Choose a tower to pick up its top disk.");
      return;
    }
    makeMove(from, pegIndex);
  }

  function undoMove() {
    if (state.busy || state.solverActive || !state.history.length || state.won) return;
    const last = state.history.pop();
    const disk = state.pegs[last.to].pop();
    state.pegs[last.from].push(disk);
    state.moves -= 1;
    state.selectedPeg = null;
    render();
    setMessage("Last move undone.");
  }

  function positionsFromPegs() {
    const positions = Array(state.diskCount).fill(0);
    state.pegs.forEach((peg, pegIndex) => peg.forEach((disk) => { positions[disk - 1] = pegIndex; }));
    return positions;
  }

  function findOptimalMove() {
    const start = positionsFromPegs();
    const encode = (positions) => positions.join("");
    const startKey = encode(start);
    const goalKey = "2".repeat(state.diskCount);
    if (startKey === goalKey) return null;
    const queue = [start];
    const parent = new Map([[startKey, null]]);
    const moves = new Map();
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const key = encode(current);
      if (key === goalKey) break;
      const top = [Infinity, Infinity, Infinity];
      for (let disk = 1; disk <= state.diskCount; disk += 1) {
        const peg = current[disk - 1];
        if (top[peg] === Infinity) top[peg] = disk;
      }
      for (let from = 0; from < 3; from += 1) {
        if (top[from] === Infinity) continue;
        for (let to = 0; to < 3; to += 1) {
          if (from === to || (top[to] !== Infinity && top[from] > top[to])) continue;
          const next = current.slice();
          next[top[from] - 1] = to;
          const nextKey = encode(next);
          if (parent.has(nextKey)) continue;
          parent.set(nextKey, key);
          moves.set(nextKey, { from, to, disk: top[from] });
          queue.push(next);
        }
      }
    }
    if (!parent.has(goalKey)) return null;
    let cursor = goalKey;
    while (parent.get(cursor) !== startKey) cursor = parent.get(cursor);
    return moves.get(cursor);
  }

  function clearHint() {
    if (state.hintTimeout !== null) window.clearTimeout(state.hintTimeout);
    state.hintTimeout = null;
    document.querySelectorAll(".hint-disk, .hint-target").forEach((element) => element.classList.remove("hint-disk", "hint-target"));
  }

  function showHint() {
    if (state.busy || state.solverActive || state.won) return;
    clearHint();
    const hint = findOptimalMove();
    if (!hint) {
      setMessage("You’ve already solved this puzzle!");
      return;
    }
    const disk = towers[hint.from].querySelector(`.disk[data-size="${hint.disk}"]`);
    disk?.classList.add("hint-disk");
    towers[hint.to].classList.add("hint-target");
    setMessage(`Optimal next move: disk ${hint.disk} from tower ${hint.from + 1} to tower ${hint.to + 1}.`);
    state.hintTimeout = window.setTimeout(clearHint, 2600);
  }

  function getSolution(count) {
    const solution = [];
    function moveStack(size, from, to, spare) {
      if (size === 0) return;
      moveStack(size - 1, from, spare, to);
      solution.push([from, to]);
      moveStack(size - 1, spare, to, from);
    }
    moveStack(count, 0, 2, 1);
    return solution;
  }

  function waitUntilResumed(runId) {
    return new Promise((resolve) => {
      const check = () => {
        if (runId !== state.solverId || state.solverStop) resolve(false);
        else if (!state.solverPaused) resolve(true);
        else window.setTimeout(check, 100);
      };
      check();
    });
  }

  async function runSolver(runId) {
    const solution = getSolution(state.diskCount);
    for (const [from, to] of solution) {
      if (runId !== state.solverId || state.solverStop) break;
      const resumed = await waitUntilResumed(runId);
      if (!resumed || runId !== state.solverId || state.solverStop) break;
      const moved = await makeMove(from, to, { automatic: true });
      if (!moved) break;
      if (state.won) break;
      const delay = Number($("#speed-slider").value);
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    if (runId === state.solverId) {
      state.solverActive = false;
      state.solverPaused = false;
      state.solverStop = false;
      solveButton.innerHTML = '<span aria-hidden="true">▶</span> Auto solve';
      stopButton.disabled = true;
      render();
      if (!state.won) setMessage("Auto solve stopped. You can continue playing.");
    }
  }

  function toggleSolver() {
    if (state.busy || state.won) return;
    if (state.solverActive) {
      state.solverPaused = !state.solverPaused;
      solveButton.innerHTML = state.solverPaused
        ? '<span aria-hidden="true">▶</span> Resume'
        : '<span aria-hidden="true">Ⅱ</span> Pause';
      setMessage(state.solverPaused ? "Auto solve paused." : "Auto solve is moving the disks…");
      return;
    }
    state.selectedPeg = null;
    state.solverActive = true;
    state.solverPaused = false;
    state.solverStop = false;
    state.solverId += 1;
    solveButton.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pause';
    stopButton.disabled = false;
    render();
    setMessage("Auto solve is moving the disks…");
    runSolver(state.solverId);
  }

  function stopSolver() {
    if (!state.solverActive) return;
    state.solverStop = true;
    state.solverPaused = false;
    state.solverId += 1;
    state.solverActive = false;
    solveButton.innerHTML = '<span aria-hidden="true">▶</span> Auto solve';
    stopButton.disabled = true;
    render();
    setMessage("Auto solve stopped. You can continue playing.");
  }

  function finishGame() {
    state.won = true;
    stopTimer();
    setMessage("Puzzle complete. Beautifully done!");
    undoButton.disabled = true;
    $("#hint-button").disabled = true;
    countSelect.disabled = true;
    const minimum = 2 ** state.diskCount - 1;
    const ratio = state.moves / minimum;
    const stars = ratio <= 1.1 ? 3 : ratio <= 1.5 ? 2 : 1;
    $("#win-stars").textContent = `${"★".repeat(stars)}${"☆".repeat(3 - stars)}`;
    $("#win-stars").setAttribute("aria-label", `${stars} out of 3 stars`);
    $("#win-summary").textContent = state.moves === minimum
      ? "A perfect solution — you matched the minimum moves."
      : `Minimum was ${minimum} moves. ${stars === 3 ? "So close to perfect!" : "Every puzzle is a little different."}`;
    $("#result-moves").textContent = String(state.moves);
    $("#result-time").textContent = formatTime(elapsedSeconds());
    modal.hidden = false;
    $("#close-modal").focus();
    saveBestScore();
    playTone("win");
    towers[2].querySelectorAll(".disk").forEach((disk, index) => {
      disk.style.animation = `hint-pulse .65s ease ${index * .08}s 2`;
    });
    launchConfetti();
    solveButton.disabled = true;
  }

  function closeModal() {
    modal.hidden = true;
    solveButton.disabled = false;
  }

  function resizeCanvas() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * ratio;
    canvas.height = window.innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function launchConfetti() {
    resizeCanvas();
    const colors = ["#b8a8ff", "#ffcf72", "#6fe0cc", "#ff8dbd", "#8bc4ff"];
    confettiPieces = Array.from({ length: 130 }, () => ({
      x: Math.random() * window.innerWidth,
      y: -Math.random() * window.innerHeight * .6,
      vx: (Math.random() - .5) * 3.8,
      vy: 2 + Math.random() * 4.5,
      size: 3 + Math.random() * 5,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .14,
      color: colors[Math.floor(Math.random() * colors.length)]
    }));
    if (confettiFrame !== null) cancelAnimationFrame(confettiFrame);
    const started = performance.now();
    const draw = (now) => {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      confettiPieces.forEach((piece) => {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        piece.vy += .025;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * .65);
        ctx.restore();
      });
      if (now - started < 4200) confettiFrame = requestAnimationFrame(draw);
      else {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        confettiFrame = null;
      }
    };
    confettiFrame = requestAnimationFrame(draw);
  }

  function handleDragStart(event) {
    const disk = event.target.closest(".disk");
    if (!disk || !disk.classList.contains("movable") || state.busy || state.solverActive || state.won) {
      event.preventDefault();
      return;
    }
    const from = Number(disk.dataset.peg);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(from));
    window.setTimeout(() => disk.classList.add("dragging"), 0);
  }

  function handleDrop(event) {
    event.preventDefault();
    const to = Number(event.currentTarget.dataset.peg);
    const from = Number(event.dataTransfer.getData("text/plain"));
    document.querySelector(".dragging")?.classList.remove("dragging");
    if (Number.isInteger(from) && from >= 0 && from < 3) makeMove(from, to);
  }

  function pointerDown(event) {
    if (event.pointerType !== "touch") return;
    const disk = event.target.closest(".disk");
    if (!disk || !disk.classList.contains("movable") || state.busy || state.solverActive || state.won) return;
    state.touchDrag = { from: Number(disk.dataset.peg), id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    disk.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    const drag = state.touchDrag;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 10) {
      drag.moved = true;
      const disk = towers[drag.from].querySelector(".disk.movable");
      disk?.classList.add("dragging");
    }
  }

  function pointerUp(event) {
    const drag = state.touchDrag;
    if (!drag || drag.id !== event.pointerId) return;
    state.touchDrag = null;
    if (!drag.moved) return;
    state.suppressClick = true;
    document.querySelector(".dragging")?.classList.remove("dragging");
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest(".tower");
    if (target) makeMove(drag.from, Number(target.dataset.peg));
    else setMessage("Drop the disk on one of the towers.");
    window.setTimeout(() => { state.suppressClick = false; }, 250);
  }

  towers.forEach((tower, pegIndex) => {
    tower.addEventListener("click", (event) => {
      if (!event.target.closest(".disk")) handleTowerClick(pegIndex);
    });
    tower.addEventListener("keydown", (event) => {
      if (event.target !== tower || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      handleTowerClick(pegIndex);
    });
    tower.addEventListener("dragover", (event) => event.preventDefault());
    tower.addEventListener("drop", handleDrop);
  });
  board.addEventListener("dragstart", handleDragStart);
  board.addEventListener("dragend", () => document.querySelector(".dragging")?.classList.remove("dragging"));
  board.addEventListener("pointerdown", pointerDown);
  board.addEventListener("pointermove", pointerMove);
  board.addEventListener("pointerup", pointerUp);
  board.addEventListener("click", (event) => {
    const disk = event.target.closest(".disk");
    if (!disk || state.suppressClick) return;
    event.stopPropagation();
    handleTowerClick(Number(disk.dataset.peg));
  });
  board.addEventListener("keydown", (event) => {
    const disk = event.target.closest(".disk");
    if (!disk || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    event.stopPropagation();
    handleTowerClick(Number(disk.dataset.peg));
  });
  countSelect.addEventListener("change", () => resetGame(Number(countSelect.value)));
  $("#reset-button").addEventListener("click", () => resetGame());
  undoButton.addEventListener("click", undoMove);
  $("#hint-button").addEventListener("click", showHint);
  solveButton.addEventListener("click", toggleSolver);
  stopButton.addEventListener("click", stopSolver);
  $("#close-modal").addEventListener("click", closeModal);
  $("#play-again").addEventListener("click", () => {
    closeModal();
    resetGame();
  });
  modal.addEventListener("click", (event) => { if (event.target === modal) closeModal(); });
  $("#theme-toggle").addEventListener("click", (event) => {
    const light = document.body.dataset.theme !== "light";
    document.body.dataset.theme = light ? "light" : "dark";
    event.currentTarget.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
  });
  $("#sound-toggle").addEventListener("click", (event) => {
    sound.muted = !sound.muted;
    event.currentTarget.setAttribute("aria-label", sound.muted ? "Unmute sounds" : "Mute sounds");
    event.currentTarget.querySelector("span").textContent = sound.muted ? "♪̸" : "♫";
    setMessage(sound.muted ? "Sounds muted." : "Sounds on.");
  });
  window.addEventListener("resize", () => { if (confettiFrame !== null) resizeCanvas(); });
  window.addEventListener("keydown", (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.matches("input, select, textarea")) return;
    if (event.key === "Escape" && !modal.hidden) { closeModal(); return; }
    if (!modal.hidden) return;
    if (/^[1-3]$/.test(event.key)) {
      handleTowerClick(Number(event.key) - 1);
    } else if (event.key.toLowerCase() === "u") {
      undoMove();
    } else if (event.key.toLowerCase() === "r") {
      resetGame();
    }
  });

  resetGame(5);
})();
