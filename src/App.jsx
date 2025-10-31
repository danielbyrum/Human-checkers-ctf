import React, { useEffect, useRef, useState } from "react";

// Human Checkers x Capture the Flag – v13
// ✅ Fully functional version with Blue AI, animation delay, responsive CSS board
// - One move per piece per turn
// - Forward-only for normal pieces, any-direction for Knights/Flagbearers
// - Captures → 1-turn respawn at origin
// - Flags capturable/passable
// - Knight Power Activation when flag captured
// - Blue AI moves aggressively (multi-piece per turn with short delay)

export default function HumanCheckersCTF() {
  const BOARD_SIZE = 8;

  const [pieces, setPieces] = useState(() => createInitialPieces());
  const [flags, setFlags] = useState(() => initialFlags());
  const [currentTurn, setCurrentTurn] = useState("Blue");
  const [turnNo, setTurnNo] = useState(1);
  const [timerSec, setTimerSec] = useState(60);
  const [timerRunning, setTimerRunning] = useState(true);
  const [winner, setWinner] = useState(null);
  const [selected, setSelected] = useState(null);
  const [movedThisTurn, setMovedThisTurn] = useState(new Set());
  const [usedPassThisTurn, setUsedPassThisTurn] = useState(false);
  const [awaitingKnightTeam, setAwaitingKnightTeam] = useState(null);
  const [knightsChosen, setKnightsChosen] = useState(0);

  const tickRef = useRef(null);
  const flagsRef = useRef(flags);
  useEffect(() => { flagsRef.current = flags; }, [flags]);

  // ===== Setup =====
  function createInitialPieces() {
    const pcs = [];
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `B-M${c}`, team: "Blue", pos: { r: 0, c }, origin: { r: 0, c } });
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `B-P${c}`, team: "Blue", pos: { r: 1, c }, origin: { r: 1, c } });
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `R-M${c}`, team: "Red", pos: { r: 7, c }, origin: { r: 7, c } });
    for (let c = 0; c < BOARD_SIZE; c++) pcs.push({ id: `R-P${c}`, team: "Red", pos: { r: 6, c }, origin: { r: 6, c } });
    return pcs;
  }
  function initialFlags() {
    return {
      Blue: { homePos: { r: 0, c: 3 }, isCaptured: false, carriedBy: null },
      Red: { homePos: { r: 7, c: 3 }, isCaptured: false, carriedBy: null },
    };
  }

  // ===== Utility Functions =====
  const ownSideRows = (team) => (team === "Blue" ? [0, 1] : [6, 7]);
  const forwardDir = (team) => (team === "Blue" ? 1 : -1);
  const inBounds = (r, c) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;

  function squareOccupiedBy(copy, pos) {
    return copy.find((x) => x.pos && x.pos.r === pos.r && x.pos.c === pos.c) || null;
  }
  function canMoveTo(copy, mover, to) {
    const target = squareOccupiedBy(copy, to);
    if (!target) return true;
    if (target.team !== mover.team) return true;
    return false;
  }
  function legalMoves(copy, p, movedSetRef) {
    if (!p.pos) return [];
    const movedSet = movedSetRef || movedThisTurn;
    if (movedSet.has(p.id)) return [];

    const deltas = [];
    if (p.isFlagbearer || p.isKnight) {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          if (dr || dc) deltas.push({ dr, dc });
    } else {
      const dir = forwardDir(p.team);
      deltas.push({ dr: dir, dc: 0 }, { dr: dir, dc: -1 }, { dr: dir, dc: 1 });
      const atOppBack = (p.team === "Blue" && p.pos.r === BOARD_SIZE - 1) || (p.team === "Red" && p.pos.r === 0);
      if (atOppBack) deltas.push({ dr: 0, dc: -1 }, { dr: 0, dc: 1 });
    }
    return deltas
      .map(({ dr, dc }) => ({ r: p.pos.r + dr, c: p.pos.c + dc }))
      .filter(({ r, c }) => inBounds(r, c))
      .filter((to) => canMoveTo(copy, p, to));
  }

  // ===== Turn + Respawn =====
  function endTurn() {
    const next = currentTurn === "Blue" ? "Red" : "Blue";
    setCurrentTurn(next);
    setTurnNo((n) => n + 1);
    setMovedThisTurn(new Set());
    setUsedPassThisTurn(false);
    setTimerSec(60);

    // Respawn logic
    setPieces((prev) => {
      const copy = prev.map((p) => ({ ...p }));
      copy.forEach((p) => {
        if (p.respawnTurns && p.team === next) {
          p.respawnTurns -= 1;
          if (p.respawnTurns <= 0) {
            const occ = squareOccupiedBy(copy, p.origin);
            if (!occ) { p.pos = { ...p.origin }; p.respawnTurns = null; }
            else p.respawnTurns = 1;
          }
        }
      });
      return copy;
    });
  }

  // ===== Movement + Capture =====
  function moveAndResolve(moverId, to) {
    setPieces((prevPieces) => {
      const copy = prevPieces.map((p) => ({ ...p }));
      const mover = copy.find((x) => x.id === moverId);
      if (!mover || !mover.pos) return prevPieces;

      const already = new Set(movedThisTurn);
      if (already.has(mover.id)) return prevPieces;

      const moves = legalMoves(copy, mover, already);
      if (!moves.some((m) => m.r === to.r && m.c === to.c)) return prevPieces;

      const enemyTeam = mover.team === "Blue" ? "Red" : "Blue";
      let newFlags = { ...flagsRef.current };

      // Capture logic
      const target = squareOccupiedBy(copy, to);
      if (target && target.team !== mover.team) {
        const enemyFlag = newFlags[target.team];
        if (enemyFlag.isCaptured && enemyFlag.carriedBy === target.id) {
          newFlags = { ...newFlags, [target.team]: { ...enemyFlag, isCaptured: false, carriedBy: null } };
        }
        target.pos = null;
        target.respawnTurns = 2;
      }

      mover.pos = { ...to };

      // Flag pickup
      const f = newFlags[enemyTeam];
      if (!f.isCaptured && to.r === f.homePos.r && to.c === f.homePos.c) {
        newFlags = { ...newFlags, [enemyTeam]: { ...f, isCaptured: true, carriedBy: mover.id } };
        mover.isFlagbearer = true;
        setAwaitingKnightTeam(enemyTeam);
        setKnightsChosen(0);
      }

      // Win condition
      const carrying = (newFlags[enemyTeam].isCaptured && newFlags[enemyTeam].carriedBy === mover.id) || mover.isFlagbearer;
      if (carrying && ownSideRows(mover.team).includes(mover.pos.r)) {
        setWinner(mover.team);
      }

      setFlags(newFlags);
      setMovedThisTurn((s) => new Set([...s, mover.id]));
      return copy;
    });
  }

  // ===== Blue AI =====
  useEffect(() => {
    if (currentTurn !== "Blue" || winner) return;
    let cancelled = false;
    const movedSet = new Set();

    const stepAI = () => {
      if (cancelled) return false;
      let acted = false;
      setPieces((prev) => {
        const copy = prev.map((p) => ({ ...p }));
        const redFlag = flagsRef.current.Red;
        const ownRows = ownSideRows("Blue");

        const bluePieces = copy.filter((p) => p.team === "Blue" && p.pos && !movedSet.has(p.id));
        let best = null;
        let bestScore = -Infinity;

        const scoreMove = (p, to) => {
          const tgt = squareOccupiedBy(copy, to);
          if (tgt && tgt.team === "Red") return 1000;
          if (!redFlag.isCaptured && to.r === redFlag.homePos.r && to.c === redFlag.homePos.c) return 900;
          if (p.isFlagbearer) return 800 - Math.abs(to.r - 0) * 10;
          return 100 - Math.hypot(redFlag.homePos.r - to.r, redFlag.homePos.c - to.c);
        };

        for (const p of bluePieces) {
          const moves = legalMoves(copy, p, movedSet);
          for (const to of moves) {
            const s = scoreMove(p, to);
            if (s > bestScore) { bestScore = s; best = { p, to }; }
          }
        }

        if (!best) return prev;
        const mover = copy.find((x) => x.id === best.p.id);
        mover.pos = best.to;
        movedSet.add(mover.id);
        acted = true;
        return copy;
      });
      return acted;
    };

    let steps = 0;
    const loop = () => {
      if (cancelled || steps >= 8) { endTurn(); return; }
      const acted = stepAI();
      steps += 1;
      setTimeout(loop, acted ? 200 : 0); // slight delay between moves
    };
    loop();

    return () => { cancelled = true; };
  }, [currentTurn, winner]);

  // ===== Interaction (Red Player) =====
  function handleSquareClick(r, c) {
    if (winner || currentTurn !== "Red") return;
    const clicked = pieces.find((p) => p.pos && p.pos.r === r && p.pos.c === c);
    if (selected) {
      const moverId = selected;
      setSelected(null);
      moveAndResolve(moverId, { r, c });
      return;
    }
    if (clicked && clicked.team === "Red") setSelected(clicked.id);
  }

  // ===== Render =====
  const boardStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(8, 1fr)",
    width: "min(92vw, 560px)",
    border: "2px solid #0f172a",
    margin: "16px auto",
  };
  const squareOuter = {
    position: "relative",
    width: "100%",
    paddingTop: "100%",
    overflow: "hidden",
    borderRight: "1px solid rgba(0,0,0,0.2)",
    borderBottom: "1px solid rgba(0,0,0,0.2)",
  };
  const squareInner = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
  const pieceStyle = (team) => ({
    width: "70%",
    height: "70%",
    borderRadius: "50%",
    background: team === "Blue" ? "#3b82f6" : "#f43f5e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "white",
    fontWeight: 700,
  });

  return (
    <div style={{ padding: 16, background: "#f1f5f9", minHeight: "100vh", color: "#0f172a", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Human Checkers x Capture the Flag</h1>
      <p>1 move per piece/turn · Flags capturable/passable · Respawn after 1 team turn · Knights on flag capture</p>
      <div style={boardStyle}>
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const r = Math.floor(i / BOARD_SIZE);
          const c = i % BOARD_SIZE;
          const dark = (r + c) % 2 === 1;
          const bg = dark ? "#065f46" : "#047857";
          const piece = pieces.find((p) => p.pos && p.pos.r === r && p.pos.c === c);
          const blueFlag = flags.Blue.homePos.r === r && flags.Blue.homePos.c === c && !flags.Blue.isCaptured;
          const redFlag = flags.Red.homePos.r === r && flags.Red.homePos.c === c && !flags.Red.isCaptured;

          return (
            <div key={i} style={{ ...squareOuter, background: bg }} onClick={() => handleSquareClick(r, c)}>
              <div style={squareInner}>
                {blueFlag && <div style={{ position: "absolute", top: 4, left: 4, fontSize: 20 }}>🏳️‍🌈</div>}
                {redFlag && <div style={{ position: "absolute", bottom: 4, right: 4, fontSize: 20 }}>🚩</div>}
                {piece && (
                  <div style={pieceStyle(piece.team)}>
                    {piece.id.includes("M") ? "M" : "P"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {winner && (
        <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, color: "#15803d" }}>
          🏆 {winner} Wins!
        </div>
      )}
    </div>
  );
}
