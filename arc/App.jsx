import React, { useEffect, useRef, useState } from "react";

// Human Checkers x Capture the Flag – v12 (Hotfix)
// - FIX: Define moveAndResolve (was missing) and wire Blue AI multi-move aggressive turn
// - Rules enforced: one move per piece per turn; forward-only for normals; any-direction for Knights/Flagbearers
// - Captures -> 1-turn respawn at origin; flags capturable; passing allowed (passer frozen)
// - Knight Power Activation on flag capture (defending picks 2 Knights; Blue auto-picks if needed)
// - No overlapping squares except during capture
// - Added lightweight dev self-tests (console asserts) for movement and overlap

export default function HumanCheckersCTF() {
  const BOARD_SIZE = 8;

  // ===== State =====
  const [pieces, setPieces] = useState(() => createInitialPieces());
  const [flags, setFlags] = useState(() => initialFlags());
  const [currentTurn, setCurrentTurn] = useState("Blue"); // Blue starts (AI)
  const [turnNo, setTurnNo] = useState(1);
  const [timerSec, setTimerSec] = useState(60);
  const [turnLength, setTurnLength] = useState(60);
  const [timerRunning, setTimerRunning] = useState(true);
  const [movedThisTurn, setMovedThisTurn] = useState(new Set());
  const [winner, setWinner] = useState(null);
  const [selected, setSelected] = useState(null); // Red selection
  const [awaitingKnightTeam, setAwaitingKnightTeam] = useState(null);
  const [knightsChosen, setKnightsChosen] = useState(0);
  const [usedPassThisTurn, setUsedPassThisTurn] = useState(false);

  const tickRef = useRef(null);
  const flagsRef = useRef(flags);
  useEffect(() => { flagsRef.current = flags; }, [flags]);

  // ===== Setup =====
  function createInitialPieces() {
    const pcs = [];
    // Blue: majors row 0, pawns row 1
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `B-M${c}`, team: "Blue", pos: { r: 0, c }, origin: { r: 0, c } });
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `B-P${c}`, team: "Blue", pos: { r: 1, c }, origin: { r: 1, c } });
    // Red: majors row 7, pawns row 6
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `R-M${c}`, team: "Red", pos: { r: 7, c }, origin: { r: 7, c } });
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `R-P${c}`, team: "Red", pos: { r: 6, c }, origin: { r: 6, c } });
    return pcs;
  }
  function initialFlags() {
    return {
      Blue: { homePos: { r: 0, c: 3 }, isCaptured: false, carriedBy: null },
      Red:  { homePos: { r: 7, c: 3 }, isCaptured: false, carriedBy: null },
    };
  }

  // ===== Utilities =====
  const ownSideRows = (team) => (team === "Blue" ? [0, 1] : [6, 7]);
  const forwardDir = (team) => (team === "Blue" ? 1 : -1);
  const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

  function squareOccupiedBy(copy, pos) {
    return copy.find((x) => x.pos && x.pos.r === pos.r && x.pos.c === pos.c) || null;
  }
  function canMoveTo(copy, mover, to) {
    const target = squareOccupiedBy(copy, to);
    if (!target) return true; // free square
    if (target.team !== mover.team) return true; // capture allowed
    return false; // block same-team overlap
  }
  function legalMoves(copy, p, movedSetRef) {
    if (!p.pos) return [];
    const movedSet = movedSetRef || movedThisTurn;
    if (movedSet.has(p.id)) return [];

    const deltas = [];
    if (p.isFlagbearer || p.isKnight) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) deltas.push({ dr, dc });
    } else {
      const dir = forwardDir(p.team);
      // forward and forward diagonals
      deltas.push({ dr: dir, dc: 0 }, { dr: dir, dc: -1 }, { dr: dir, dc: 1 });
      // NEW: if on opponent's back rank, allow sideways (left/right)
      const atOppBack = (p.team === "Blue" && p.pos.r === BOARD_SIZE - 1) || (p.team === "Red" && p.pos.r === 0);
      if (atOppBack) {
        deltas.push({ dr: 0, dc: -1 }, { dr: 0, dc: 1 });
      }
    }
    return deltas
      .map(({ dr, dc }) => ({ r: p.pos.r + dr, c: p.pos.c + dc }))
      .filter(({ r, c }) => inBounds(r, c))
      .filter((to) => canMoveTo(copy, p, to));
  }

  // ===== Timer / Turns =====
  useEffect(() => {
    if (!timerRunning || winner) return;
    if (timerSec <= 0) { endTurn(); return; }
    tickRef.current = setTimeout(() => setTimerSec((s) => s - 1), 1000);
    return () => clearTimeout(tickRef.current);
  }, [timerSec, timerRunning, winner]);

  function endTurn() {
    const next = currentTurn === "Blue" ? "Red" : "Blue";
    setCurrentTurn(next);
    setTurnNo((n) => n + 1);
    setMovedThisTurn(new Set());
    setUsedPassThisTurn(false);
    setTimerSec(turnLength);

    // Process respawns at the start of the team's turn
    setPieces((prev) => {
      const copy = prev.map((p) => ({ ...p }));
      copy.forEach((p) => {
        if (p.respawnTurns && p.team === next) {
          p.respawnTurns -= 1;
          if (p.respawnTurns <= 0) {
            const occ = squareOccupiedBy(copy, p.origin);
            if (!occ) { p.pos = { ...p.origin }; p.respawnTurns = null; }
            else { p.respawnTurns = 1; }
          }
        }
      });
      return copy;
    });
  }

  // ===== Move + Resolve (captures, flags, win) =====
  function moveAndResolve(moverId, to) {
    setPieces((prevPieces) => {
      const copy = prevPieces.map((p) => ({ ...p }));
      const mover = copy.find((x) => x.id === moverId);
      if (!mover || !mover.pos) return prevPieces;

      // one move per piece per turn
      const already = new Set(movedThisTurn);
      if (already.has(mover.id)) return prevPieces;

      const moves = legalMoves(copy, mover, already);
      if (!moves.some((m) => m.r === to.r && m.c === to.c)) return prevPieces;

      const enemyTeam = mover.team === "Blue" ? "Red" : "Blue";
      let newFlags = { ...flagsRef.current };

      // capture if enemy on target
      const target = squareOccupiedBy(copy, to);
      if (target && target.team !== mover.team) {
        // If target was carrying target's own flag (i.e., enemy flag), return it home
        const enemyFlag = newFlags[target.team];
        if (enemyFlag.isCaptured && enemyFlag.carriedBy === target.id) {
          newFlags = { ...newFlags, [target.team]: { ...enemyFlag, isCaptured: false, carriedBy: null } };
        }
        target.pos = null;
        target.respawnTurns = 2; // must miss one FULL own-team turn before respawn
      }

      // move piece
      mover.pos = { ...to };

      // flag pickup if stepping onto enemy flag home square
      const f = newFlags[enemyTeam];
      if (!f.isCaptured && to.r === f.homePos.r && to.c === f.homePos.c) {
        newFlags = { ...newFlags, [enemyTeam]: { ...f, isCaptured: true, carriedBy: mover.id } };
        mover.isFlagbearer = true;
        // Knight Power activation
        setAwaitingKnightTeam(enemyTeam);
        setKnightsChosen(0);
      }

      // win condition: flagbearer reaches own side rows
      const carrying = (newFlags[enemyTeam].isCaptured && newFlags[enemyTeam].carriedBy === mover.id) || mover.isFlagbearer;
      if (carrying && ownSideRows(mover.team).includes(mover.pos.r)) {
        setWinner(mover.team);
        setTimerRunning(false);
      }

      // commit flags & moved set
      setFlags(newFlags);
      setMovedThisTurn((s) => new Set([...s, mover.id]));
      return copy;
    });
  }

  // ===== Blue AI (aggressive, multi-piece per turn; passing & knights) =====
  useEffect(() => {
    if (currentTurn !== "Blue" || winner) return;

    let cancelled = false;
    const movedSet = new Set();

    // Auto-pick Knights for Blue if required
    if (awaitingKnightTeam === "Blue" && knightsChosen < 2) {
      setPieces((prev) => {
        const copy = prev.map((p) => ({ ...p }));
        const candidates = copy.filter((p) => p.team === "Blue" && p.pos && !p.isKnight);
        const targetPos = flagsRef.current.Red.homePos;
        candidates.sort((a, b) =>
          Math.hypot(targetPos.r - a.pos.r, targetPos.c - a.pos.c) -
          Math.hypot(targetPos.r - b.pos.r, targetPos.c - b.pos.c)
        );
        const chosen = candidates.slice(0, 2);
        chosen.forEach((p) => (p.isKnight = true));
        return copy;
      });
      setKnightsChosen(2);
      setAwaitingKnightTeam(null);
    }

    const stepOnce = () => {
      if (cancelled) return false;
      let acted = false;

      setPieces((prev) => {
        const copy = prev.map((p) => ({ ...p }));
        const redFlag = flagsRef.current.Red;
        const ownRows = ownSideRows("Blue");

        // Attempt pass if Blue has a carrier and passing helps
        const carrier = copy.find((p) => p.team === "Blue" && p.isFlagbearer && p.pos && !movedSet.has(p.id));
        if (carrier && !usedPassThisTurn) {
          const adjAllies = copy.filter(
            (q) => q.team === "Blue" && q.pos && q.id !== carrier.id && Math.abs(q.pos.r - carrier.pos.r) <= 1 && Math.abs(q.pos.c - carrier.pos.c) <= 1
          );
          const distToOwn = (pos) => Math.min(...ownRows.map((r) => Math.abs(r - pos.r)));
          const better = adjAllies.sort((a, b) => distToOwn(a.pos) - distToOwn(b.pos))[0];
          if (better && distToOwn(better.pos) < distToOwn(carrier.pos)) {
            // perform pass
            const newCopy = copy.map((p) => {
              if (p.id === carrier.id) return { ...p, isFlagbearer: false };
              if (p.id === better.id) return { ...p, isFlagbearer: true };
              return p;
            });
            setFlags((prevF) => ({ ...prevF, Red: { ...prevF.Red, carriedBy: better.id } }));
            movedSet.add(carrier.id);
            setMovedThisTurn((s) => new Set([...s, carrier.id]));
            setUsedPassThisTurn(true);
            acted = true;
            return newCopy;
          }
        }

        // Choose the best scoring move across all Blue pieces that haven't moved
        const bluePieces = copy.filter((p) => p.team === "Blue" && p.pos && !movedSet.has(p.id));
        let best = null;
        let bestScore = -Infinity;
        const scoreMove = (p, to) => {
          const tgt = squareOccupiedBy(copy, to);
          if (tgt && tgt.team === "Red") return 1000; // capture priority
          if (!redFlag.isCaptured && to.r === redFlag.homePos.r && to.c === redFlag.homePos.c) return 900; // take flag
          if (p.isFlagbearer) {
            const d = Math.min(...ownRows.map((r) => Math.abs(r - to.r)));
            return 800 - d * 10; // move toward home
          }
          const d = Math.hypot(redFlag.homePos.r - to.r, redFlag.homePos.c - to.c);
          return 100 - d; // advance
        };

        for (const p of bluePieces) {
          const moves = legalMoves(copy, p, movedSet);
          for (const to of moves) {
            const s = scoreMove(p, to);
            if (s > bestScore) { bestScore = s; best = { p, to }; }
          }
        }
        if (!best) return prev; // nothing to do

        // Apply the chosen move + capture/flag logic directly to copy
        const mover = copy.find((x) => x.id === best.p.id);
        const target = squareOccupiedBy(copy, best.to);
        let newFlags = { ...flagsRef.current };
        if (target && target.team === "Red") {
          const enemyFlag = newFlags[target.team];
          if (enemyFlag.isCaptured && enemyFlag.carriedBy === target.id) {
            newFlags = { ...newFlags, [target.team]: { ...enemyFlag, isCaptured: false, carriedBy: null } };
          }
          target.pos = null; target.respawnTurns = 2;
        }
        mover.pos = { ...best.to };
        // pick up flag if on it
        if (!newFlags.Red.isCaptured && best.to.r === newFlags.Red.homePos.r && best.to.c === newFlags.Red.homePos.c) {
          newFlags = { ...newFlags, Red: { ...newFlags.Red, isCaptured: true, carriedBy: mover.id } };
          mover.isFlagbearer = true;
          setAwaitingKnightTeam("Red"); setKnightsChosen(0);
        }
        // win check for carrier
        const carrierNow = (newFlags.Red.isCaptured && newFlags.Red.carriedBy === mover.id) || mover.isFlagbearer;
        if (carrierNow && ownRows.includes(mover.pos.r)) { setWinner("Blue"); setTimerRunning(false); }

        setFlags(newFlags);
        movedSet.add(mover.id);
        setMovedThisTurn((s) => new Set([...s, mover.id]));
        acted = true;
        return copy;
      });

      return acted;
    };

    // Run up to 16 mini-steps this turn with small delays for readability
    let steps = 0;
    const loop = () => {
      if (cancelled || steps >= 16) { endTurn(); return; }
      const didAct = stepOnce();
      steps += 1;
      setTimeout(loop, didAct ? 120 : 0); // if no action, fast-forward
    };
    setTimeout(loop, 100);

    return () => { cancelled = true; };
  }, [currentTurn, winner, awaitingKnightTeam, knightsChosen, usedPassThisTurn]);

  // ===== Interaction (Red player) =====
  function handleSquareClick(r, c) {
    if (winner) return;

    // Knight selection prompt (defending team chooses two)
    if (awaitingKnightTeam) {
      const p = pieces.find((x) => x.pos && x.pos.r === r && x.pos.c === c && x.team === awaitingKnightTeam && !x.isKnight);
      if (p) {
        setPieces((prev) => prev.map((q) => (q.id === p.id ? { ...q, isKnight: true } : q)));
        setKnightsChosen((n) => n + 1);
        if (knightsChosen + 1 >= 2) setAwaitingKnightTeam(null);
      }
      return;
    }

    if (currentTurn !== "Red") return;

    const clicked = pieces.find((p) => p.pos && p.pos.r === r && p.pos.c === c);

    // Passing: if selected is a Red flagbearer and clicked an adjacent Red teammate
    if (selected) {
      const mover = pieces.find((x) => x.id === selected);
      if (mover && mover.isFlagbearer && clicked && clicked.team === "Red" && clicked.id !== mover.id) {
        const adj = Math.abs(clicked.pos.r - mover.pos.r) <= 1 && Math.abs(clicked.pos.c - mover.pos.c) <= 1;
        if (adj && !usedPassThisTurn) {
          setPieces((prev) => prev.map((p) => {
            if (p.id === mover.id) return { ...p, isFlagbearer: false };
            if (p.id === clicked.id) return { ...p, isFlagbearer: true };
            return p;
          }));
          setFlags((prevF) => ({ ...prevF, Blue: prevF.Blue, Red: { ...prevF.Red, carriedBy: clicked.id } }));
          setMovedThisTurn((s) => new Set([...s, mover.id])); // passer frozen
          setUsedPassThisTurn(true);
          return;
        }
      }
      // otherwise attempt a move
      const moverId = selected; setSelected(null);
      moveAndResolve(moverId, { r, c });
      return;
    }

    if (clicked && clicked.team === "Red") setSelected(clicked.id);
  }

  // ===== Render =====
  function renderBoard() {
    return (
      <div className="grid grid-cols-8 w-max mx-auto border">
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const r = Math.floor(i / BOARD_SIZE);
          const c = i % BOARD_SIZE;
          const squareColor = (r + c) % 2 === 0 ? "bg-emerald-600" : "bg-emerald-700";
          const piece = pieces.find((p) => p.pos && p.pos.r === r && p.pos.c === c);
          const blueFlagHome = flags.Blue.homePos.r === r && flags.Blue.homePos.c === c;
          const redFlagHome  = flags.Red.homePos.r === r && flags.Red.homePos.c === c;
          const showBlueFlag = blueFlagHome && !flags.Blue.isCaptured;
          const showRedFlag  = redFlagHome && !flags.Red.isCaptured;

          const legalHighlight = selected && (() => {
            const mover = pieces.find((x) => x.id === selected);
            if (!mover) return false;
            const copy = pieces.map((p) => ({ ...p }));
            return legalMoves(copy, mover).some((m) => m.r === r && m.c === c);
          })();

          return (
            <div
              key={i}
              onClick={() => handleSquareClick(r, c)}
              className={`relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center border ${squareColor} ${legalHighlight ? "ring-2 ring-yellow-300" : ""}`}
            >
              {showBlueFlag && <div className="absolute text-lg">🏳️‍🌈</div>}
              {showRedFlag  && <div className="absolute text-lg">🚩</div>}
              {piece && (
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold ${piece.team === "Blue" ? "bg-blue-500" : "bg-rose-500"}`}
                  title={piece.isFlagbearer ? "Flagbearer" : piece.isKnight ? "Knight" : ""}
                >
                  {piece.isFlagbearer ? "⭐" : piece.isKnight ? "♞" : piece.id.includes("M") ? "M" : "P"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ===== Dev self-tests (run once in dev) =====
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') return;
    if (window.__HCCTF_TESTED__) return; window.__HCCTF_TESTED__ = true;
    // Test: normal piece forward-only
    (function testForwardOnly() {
      const P = { id: 'R-P0', team: 'Red', pos: { r: 6, c: 3 } };
      const copy = [ { ...P } ];
      const moves = legalMoves(copy, P, new Set());
      const hasBackward = moves.some(m => m.r > 6); // Red should move up (r-1)
      console.assert(!hasBackward, 'Normal piece should not have backward moves');
    })();
    // Test: no overlap same team
    (function testNoOverlap() {
      const A = { id: 'B-P0', team: 'Blue', pos: { r: 2, c: 2 } };
      const B = { id: 'B-P1', team: 'Blue', pos: { r: 3, c: 2 } };
      const copy = [A, B];
      const can = canMoveTo(copy, A, { r: 3, c: 2 });
      console.assert(!can, 'Should not be able to move onto same-team square');
    })();
    // Test: knight/flagbearer can move any direction
    (function testAnyDir() {
      const K = { id: 'B-M0', team: 'Blue', pos: { r: 2, c: 2 }, isKnight: true };
      const copy = [K];
      const moves = legalMoves(copy, K, new Set());
      console.assert(moves.length >= 7, 'Knight should have many adjacent options');
    })();
    console.log('[HCxCTF] Dev tests executed.');
  }, []);

  // ===== UI Root =====
  return (
    <div className="p-4 bg-slate-100 min-h-screen text-slate-900">
      <h1 className="text-xl font-bold mb-2">Human Checkers x Capture the Flag</h1>
      <p className="mb-2">1 move per piece/turn · Flags capturable/passable · Respawn at origin after 1 turn · Knights on flag capture</p>
      <div className="flex gap-4 items-start">
        {renderBoard()}
        <div className="min-w-[180px]">
          <div className="mb-3">
            <h2 className="font-semibold text-blue-700 mb-1">Blue Bench</h2>
            <Bench team="Blue" pieces={pieces} />
          </div>
          <div>
            <h2 className="font-semibold text-rose-700 mb-1">Red Bench</h2>
            <Bench team="Red" pieces={pieces} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button className="px-3 py-1 bg-slate-800 text-white rounded" onClick={() => setTimerRunning((r) => !r)}>
          {timerRunning ? "Pause" : "Resume"}
        </button>
        <button className="px-3 py-1 bg-slate-700 text-white rounded" onClick={endTurn}>End Turn</button>
      </div>
      <p className="mt-2 text-sm text-slate-600">Turn {turnNo}: {currentTurn} · Timer {timerSec}s</p>
      {awaitingKnightTeam && (
        <div className="mt-2 text-amber-700 font-medium">{awaitingKnightTeam} team: select <span className="font-bold">{2 - knightsChosen}</span> Knight(s) by clicking your pieces.</div>
      )}
      {winner && <div className="mt-4 text-lg font-bold text-green-700">🏆 {winner} Wins!</div>}
    </div>
  );
}

// --- Bench Component ---
function Bench({ team, pieces }) {
  const benched = pieces.filter((p) => p.team === team && !p.pos && p.respawnTurns);
  if (benched.length === 0) return <div className="text-xs text-slate-500">Empty</div>;
  return (
    <div className="grid grid-cols-3 gap-1">
      {benched.map((p) => (
        <div key={p.id} className={`flex items-center justify-center text-white text-xs rounded h-8 ${team === 'Blue' ? 'bg-blue-500' : 'bg-rose-500'}`} title={p.id}>
          <span>{p.id.includes('M') ? 'M' : 'P'}</span>
          <span className="ml-1 bg-black/30 px-1 rounded">{p.respawnTurns}</span>
        </div>
      ))}
    </div>
  );
}
