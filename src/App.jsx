import React, { useEffect, useRef, useState } from "react";

/**
 * Human Checkers x Capture the Flag – v14 (Mobile + Controls + Benches)
 * - Blue AI: aggressive, multi-move per turn, ~200ms between moves
 * - One move per piece per turn; many pieces per turn
 * - Normal pieces: forward (straight/diag); sideways on opponent back rank
 * - Flagbearer & Knights: any direction, one square
 * - Capture removes target; target respawns at origin after skipping ONE full own-team turn
 * - Flags capturable; passing allowed (passer freezes for the turn)
 * - Knight Power: when a flag is captured, defending team crowns 2 Knights
 *   - Red (human) taps 2; Blue auto-selects closest 2 to their flag
 * - Timer: auto-end turn at 0; Pause/Resume; auto-pause on win
 * - Simple benches: small colored dots with remaining turns
 */

export default function HumanCheckersCTF() {
  const BOARD_SIZE = 8;

  // ===== State =====
  const [pieces, setPieces] = useState(() => createInitialPieces());
  const [flags, setFlags] = useState(() => initialFlags());
  const [currentTurn, setCurrentTurn] = useState("Blue"); // Blue starts (AI)
  const [turnNo, setTurnNo] = useState(1);
  const [timerSec, setTimerSec] = useState(60);
  const [timerRunning, setTimerRunning] = useState(true);
  const [winner, setWinner] = useState(null);
  const [selected, setSelected] = useState(null); // Red selection
  const [movedThisTurn, setMovedThisTurn] = useState(new Set());
  const [usedPassThisTurn, setUsedPassThisTurn] = useState(false);

  // Knight selection flow
  const [awaitingKnightTeam, setAwaitingKnightTeam] = useState(null);
  const [knightsChosen, setKnightsChosen] = useState(0);

  // Refs
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
  const forwardDir = (team) => (team === "Blue" ? 1 : -1);
  const ownSideRows = (team) => (team === "Blue" ? [0,1] : [6,7]);
  const inBounds = (r,c) => r>=0 && r<BOARD_SIZE && c>=0 && c<BOARD_SIZE;

  function squareOccupiedBy(copy, pos) {
    return copy.find(p => p.pos && p.pos.r===pos.r && p.pos.c===pos.c) || null;
  }
  function canMoveTo(copy, mover, to) {
    const target = squareOccupiedBy(copy, to);
    if (!target) return true;
    if (target.team !== mover.team) return true; // capture
    return false; // block own piece
  }
  function legalMoves(copy, p, movedSetRef) {
    if (!p.pos) return [];
    const movedSet = movedSetRef || movedThisTurn;
    if (movedSet.has(p.id)) return [];

    const deltas = [];
    if (p.isFlagbearer || p.isKnight) {
      for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) if (dr||dc) deltas.push({dr,dc});
    } else {
      const dir = forwardDir(p.team);
      deltas.push({ dr: dir, dc: 0 }, { dr: dir, dc: -1 }, { dr: dir, dc: 1 });
      // sideways allowed when on opponent's back rank
      const atOppBack = (p.team==="Blue" && p.pos.r===BOARD_SIZE-1) || (p.team==="Red" && p.pos.r===0);
      if (atOppBack) deltas.push({dr:0, dc:-1}, {dr:0, dc:1});
    }
    return deltas
      .map(({dr,dc}) => ({ r: p.pos.r+dr, c: p.pos.c+dc }))
      .filter(({r,c}) => inBounds(r,c))
      .filter(to => canMoveTo(copy, p, to));
  }

  // ===== Timer =====
  useEffect(() => {
    if (!timerRunning || winner) return;
    if (timerSec <= 0) { endTurn(); return; }
    const id = setTimeout(()=> setTimerSec(s=>s-1), 1000);
    return ()=> clearTimeout(id);
  }, [timerSec, timerRunning, winner]);

  // ===== Turn transitions + Respawns =====
  function endTurn() {
    const next = currentTurn === "Blue" ? "Red" : "Blue";
    setCurrentTurn(next);
    setTurnNo(n => n+1);
    setTimerSec(60);
    setMovedThisTurn(new Set());
    setUsedPassThisTurn(false);

    // process respawns at the START of each team's own turn
    setPieces(prev => {
      const copy = prev.map(p=>({...p}));
      copy.forEach(p => {
        if (p.respawnTurns && p.team===next) {
          p.respawnTurns -= 1;
          if (p.respawnTurns <= 0) {
            const occ = squareOccupiedBy(copy, p.origin);
            if (!occ) { p.pos = {...p.origin}; p.respawnTurns = null; }
            else { p.respawnTurns = 1; } // try next own turn if origin is blocked
          }
        }
      });
      return copy;
    });
  }

  // ===== Move & Resolve =====
  function moveAndResolve(moverId, to) {
    setPieces(prev => {
      const copy = prev.map(p=>({...p}));
      const mover = copy.find(x=>x.id===moverId);
      if (!mover || !mover.pos) return prev;

      const already = new Set(movedThisTurn);
      if (already.has(mover.id)) return prev;

      const moves = legalMoves(copy, mover, already);
      if (!moves.some(m => m.r===to.r && m.c===to.c)) return prev;

      const enemyTeam = mover.team==="Blue" ? "Red" : "Blue";
      let newFlags = { ...flagsRef.current };

      // capture
      const target = squareOccupiedBy(copy, to);
      if (target && target.team !== mover.team) {
        // if target carrying their team's flag, return it home
        const enemyFlag = newFlags[target.team];
        if (enemyFlag.isCaptured && enemyFlag.carriedBy === target.id) {
          newFlags = { ...newFlags, [target.team]: { ...enemyFlag, isCaptured:false, carriedBy:null } };
        }
        target.pos = null;
        target.respawnTurns = 2; // miss ONE full own-team turn before respawn
      }

      // move
      mover.pos = { ...to };

      // pick up enemy flag if on it
      const f = newFlags[enemyTeam];
      if (!f.isCaptured && to.r===f.homePos.r && to.c===f.homePos.c) {
        newFlags = { ...newFlags, [enemyTeam]: { ...f, isCaptured:true, carriedBy:mover.id } };
        mover.isFlagbearer = true;
        // Knight Power for the defending team
        const defending = enemyTeam;
        if (defending === "Blue") {
          // auto-pick two for Blue
          setPieces(cur => {
            const cc = cur.map(p=>({...p}));
            autoChooseKnights(cc, "Blue", newFlags.Blue.homePos);
            return cc;
          });
        } else {
          // Red must choose two
          setAwaitingKnightTeam("Red");
          setKnightsChosen(0);
        }
      }

      // win if carrier reaches own side
      const carrying = (newFlags[enemyTeam].isCaptured && newFlags[enemyTeam].carriedBy===mover.id) || mover.isFlagbearer;
      if (carrying && ownSideRows(mover.team).includes(mover.pos.r)) {
        setWinner(mover.team);
        setTimerRunning(false); // auto-pause on win
      }

      setFlags(newFlags);
      setMovedThisTurn(s => new Set([...s, mover.id]));
      return copy;
    });
  }

  function autoChooseKnights(copy, team, defendPos) {
    const candidates = copy.filter(p => p.team===team && p.pos && !p.isKnight);
    candidates.sort((a,b) =>
      Math.hypot(defendPos.r - a.pos.r, defendPos.c - a.pos.c) -
      Math.hypot(defendPos.r - b.pos.r, defendPos.c - b.pos.c)
    );
    candidates.slice(0,2).forEach(p => p.isKnight = true);
  }

  // ===== Blue AI =====
  useEffect(() => {
    if (currentTurn !== "Blue" || winner) return;

    // If Blue needs to choose knights (defending), auto-pick
    if (awaitingKnightTeam === "Blue" && knightsChosen < 2) {
      setPieces(prev => {
        const copy = prev.map(p=>({...p}));
        autoChooseKnights(copy, "Blue", flagsRef.current.Blue.homePos);
        return copy;
      });
      setKnightsChosen(2);
      setAwaitingKnightTeam(null);
    }

    let cancelled = false;
    const movedSet = new Set();

    const stepOnce = () => {
      if (cancelled) return false;
      let acted = false;

      setPieces(prev => {
        const copy = prev.map(p=>({...p}));
        const redFlag = flagsRef.current.Red;
        const ownRows = ownSideRows("Blue");

        // try pass if a Blue carrier has an adjacent ally closer to home rows
        const carrier = copy.find(p => p.team==="Blue" && p.isFlagbearer && p.pos && !movedSet.has(p.id));
        if (carrier && !usedPassThisTurn) {
          const dist = pos => Math.min(...ownRows.map(r => Math.abs(r - pos.r)));
          const allies = copy.filter(q => q.team==="Blue" && q.pos && q.id!==carrier.id &&
              Math.abs(q.pos.r-carrier.pos.r)<=1 && Math.abs(q.pos.c-carrier.pos.c)<=1);
          allies.sort((a,b)=> dist(a.pos) - dist(b.pos));
          const better = allies[0];
          if (better && dist(better.pos) < dist(carrier.pos)) {
            // pass flag
            const newCopy = copy.map(p=>{
              if (p.id===carrier.id) return { ...p, isFlagbearer:false };
              if (p.id===better.id)  return { ...p, isFlagbearer:true };
              return p;
            });
            // update flags
            const nf = { ...flagsRef.current, Red: { ...flagsRef.current.Red, carriedBy: better.id } };
            setFlags(nf);
            movedSet.add(carrier.id);
            setMovedThisTurn(s=> new Set([...s, carrier.id]));
            setUsedPassThisTurn(true);
            acted = true;
            return newCopy;
          }
        }

        const bluePieces = copy.filter(p => p.team==="Blue" && p.pos && !movedSet.has(p.id));
        let best = null, bestScore = -Infinity;

        const scoreMove = (p, to) => {
          const tgt = squareOccupiedBy(copy, to);
          if (tgt && tgt.team==="Red") return 1000; // capture
          if (!redFlag.isCaptured && to.r===redFlag.homePos.r && to.c===redFlag.homePos.c) return 900; // grab flag
          if (p.isFlagbearer) {
            const d = Math.min(...ownRows.map(r => Math.abs(r - to.r)));
            return 800 - d*10;
          }
          // push toward enemy flag
          const d = Math.hypot(redFlag.homePos.r - to.r, redFlag.homePos.c - to.c);
          return 100 - d;
        };

        for (const p of bluePieces) {
          const moves = legalMoves(copy, p, movedSet);
          for (const to of moves) {
            const s = scoreMove(p, to);
            if (s > bestScore) { bestScore = s; best = { p, to }; }
          }
        }

        if (!best) return prev;

        // apply chosen move (with capture + flag pickup + win checks)
        const mover = copy.find(x=>x.id===best.p.id);
        const target = squareOccupiedBy(copy, best.to);
        let f = { ...flagsRef.current };

        if (target && target.team==="Red") {
          const enemyFlag = f[target.team];
          if (enemyFlag.isCaptured && enemyFlag.carriedBy===target.id) {
            f = { ...f, [target.team]: { ...enemyFlag, isCaptured:false, carriedBy:null } };
          }
          target.pos = null;
          target.respawnTurns = 2;
        }
        mover.pos = { ...best.to };

        if (!f.Red.isCaptured && best.to.r===f.Red.homePos.r && best.to.c===f.Red.homePos.c) {
          f = { ...f, Red: { ...f.Red, isCaptured:true, carriedBy:mover.id } };
          mover.isFlagbearer = true;
          // Red must choose two knights
          setAwaitingKnightTeam("Red");
          setKnightsChosen(0);
        }

        const carrying = (f.Red.isCaptured && f.Red.carriedBy===mover.id) || mover.isFlagbearer;
        if (carrying && ownSideRows("Blue").includes(mover.pos.r)) {
          setWinner("Blue");
          setTimerRunning(false);
        }

        setFlags(f);
        movedSet.add(mover.id);
        setMovedThisTurn(s=> new Set([...s, mover.id]));
        acted = true;
        return copy;
      });

      return acted;
    };

    // up to 14 actions with ~200ms delay each
    let steps = 0;
    const loop = () => {
      if (cancelled || steps>=14) { endTurn(); return; }
      const acted = stepOnce();
      steps += 1;
      setTimeout(loop, acted ? 200 : 0);
    };
    setTimeout(loop, 120);

    return ()=> { cancelled = true; };
  }, [currentTurn, winner, awaitingKnightTeam, knightsChosen, usedPassThisTurn]);

  // ===== Interaction (Red) =====
  function handleSquareClick(r,c) {
    if (winner) return;

    // Knight selection for Red (defending)
    if (awaitingKnightTeam === "Red") {
      const p = pieces.find(x => x.pos && x.pos.r===r && x.pos.c===c && x.team==="Red" && !x.isKnight);
      if (p) {
        setPieces(prev => prev.map(q => q.id===p.id ? { ...q, isKnight:true } : q));
        setKnightsChosen(n => {
          const k = n+1;
          if (k>=2) setAwaitingKnightTeam(null);
          return k;
        });
      }
      return;
    }

    if (currentTurn !== "Red") return;
    const clicked = pieces.find(p => p.pos && p.pos.r===r && p.pos.c===c);

    // Passing: if selected is a Red flagbearer and clicked an adjacent Red teammate
    if (selected) {
      const mover = pieces.find(x => x.id===selected);
      if (mover && mover.isFlagbearer && clicked && clicked.team==="Red" && clicked.id !== mover.id) {
        const adj = Math.abs(clicked.pos.r - mover.pos.r) <= 1 && Math.abs(clicked.pos.c - mover.pos.c) <= 1;
        if (adj && !usedPassThisTurn) {
          setPieces(prev => prev.map(p => {
            if (p.id===mover.id) return { ...p, isFlagbearer:false };
            if (p.id===clicked.id) return { ...p, isFlagbearer:true };
            return p;
          }));
          setFlags(prevF => ({ ...prevF, Blue: prevF.Blue, Red: { ...prevF.Red, carriedBy: clicked.id } }));
          setMovedThisTurn(s => new Set([...s, mover.id])); // passer frozen
          setUsedPassThisTurn(true);
          setSelected(null);
          return;
        }
      }
      // else attempt move
      const moverId = selected;
      setSelected(null);
      moveAndResolve(moverId, { r, c });
      return;
    }

    if (clicked && clicked.team==="Red") setSelected(clicked.id);
  }

  // ===== Styles =====
  const container = { padding: 16, background:"#f1f5f9", minHeight:"100vh", color:"#0f172a", fontFamily:"system-ui, sans-serif" };
  const h1 = { fontSize: 22, fontWeight: 800, marginBottom: 8, textAlign:"center" };
  const board = { display:"grid", gridTemplateColumns:"repeat(8, 1fr)", width:"min(92vw, 560px)", border:"2px solid #0f172a", margin:"12px auto" };
  const sqOuter = { position:"relative", width:"100%", paddingTop:"100%", overflow:"hidden", borderRight:"1px solid rgba(0,0,0,0.2)", borderBottom:"1px solid rgba(0,0,0,0.2)" };
  const sqInner = { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" };
  const pieceStyle = (team, selectedId, id) => ({
    width:"70%", height:"70%", borderRadius:"50%",
    background: team==="Blue" ? "#3b82f6" : "#f43f5e",
    display:"flex", alignItems:"center", justifyContent:"center",
    color:"white", fontWeight:700,
    outline: selectedId===id ? "3px solid #fde047" : "none"
  });
  const controls = { display:"flex", flexWrap:"wrap", justifyContent:"center", gap:8, margin:"10px 0" };
  const btn = (bg="#0f172a") => ({ padding:"8px 12px", background:bg, color:"#fff", border:0, borderRadius:8 });
  const benchesWrap = { display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, width:"min(92vw, 560px)", margin:"0 auto" };
  const benchTitle = (color) => ({ fontWeight:700, color, marginBottom:6, textAlign:"center" });
  const benchGrid = { display:"grid", gridTemplateColumns:"repeat(8, 1fr)", gap:6 };
  const benchDot = (team) => ({
    width:20, height:20, borderRadius:"50%",
    background: team==="Blue" ? "#3b82f6" : "#f43f5e",
    display:"flex", alignItems:"center", justifyContent:"center",
    color:"#fff", fontSize:12, fontWeight:700
  });
  const subline = { textAlign:"center", fontSize:14, color:"#475569", marginTop:6 };

  // ===== Render =====
  return (
    <div style={container}>
      <h1 style={h1}>Human Checkers x Capture the Flag</h1>

      {/* Board */}
      <div style={board}>
        {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, i) => {
          const r = Math.floor(i / BOARD_SIZE);
          const c = i % BOARD_SIZE;
          const dark = (r + c) % 2 === 1;
          const bg = dark ? "#065f46" : "#047857";
          const piece = pieces.find(p => p.pos && p.pos.r===r && p.pos.c===c);
          const blueFlag = flags.Blue.homePos.r===r && flags.Blue.homePos.c===c && !flags.Blue.isCaptured;
          const redFlag  = flags.Red.homePos.r===r && flags.Red.homePos.c===c && !flags.Red.isCaptured;

          return (
            <div key={i} style={{ ...sqOuter, background:bg }} onClick={() => handleSquareClick(r,c)}>
              <div style={sqInner}>
                {blueFlag && <div style={{ position:"absolute", top:4, left:4, fontSize:18 }}>🏳️‍🌈</div>}
                {redFlag  && <div style={{ position:"absolute", bottom:4, right:4, fontSize:18 }}>🚩</div>}
                {piece && (
                  <div style={pieceStyle(piece.team, selected, piece.id)} title={piece.isFlagbearer ? "Flagbearer" : piece.isKnight ? "Knight" : ""}>
                    {piece.isFlagbearer ? "⭐" : piece.isKnight ? "♞" : piece.id.includes("M") ? "M" : "P"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Controls */}
      <div style={controls}>
        <button style={btn("#0f172a")} onClick={()=> setTimerRunning(r=>!r)}>{timerRunning ? "Pause" : "Resume"}</button>
        <button style={btn("#334155")} onClick={endTurn}>End Turn</button>
      </div>
      <div style={subline}>
        Turn {turnNo}: <b>{currentTurn}</b> · Timer {timerSec}s
        {awaitingKnightTeam && (
          <div style={{ color:"#b45309", marginTop:6 }}>
            {awaitingKnightTeam} team: select <b>{Math.max(0, 2 - knightsChosen)}</b> Knight(s).
          </div>
        )}
        {winner && <div style={{ color:"#15803d", fontWeight:700, marginTop:6 }}>🏆 {winner} Wins!</div>}
      </div>

      {/* Benches */}
      <div style={benchesWrap}>
        <div>
          <div style={benchTitle("#1d4ed8")}>Blue Bench</div>
          <BenchSimple team="Blue" pieces={pieces} />
        </div>
        <div>
          <div style={benchTitle("#be123c")}>Red Bench</div>
          <BenchSimple team="Red" pieces={pieces} />
        </div>
      </div>
    </div>
  );
}

// ===== Simple Benches (colored dots with countdown) =====
function BenchSimple({ team, pieces }) {
  const benched = pieces.filter(p => p.team===team && !p.pos && p.respawnTurns);
  const benchGrid = { display:"grid", gridTemplateColumns:"repeat(8, 1fr)", gap:6 };
  const dot = {
    width:20, height:20, borderRadius:"50%",
    display:"flex", alignItems:"center", justifyContent:"center",
    color:"#fff", fontSize:12, fontWeight:700
  };
  return (
    <div style={benchGrid}>
      {benched.length===0 ? (
        <div style={{ gridColumn:"1 / -1", textAlign:"center", fontSize:12, color:"#64748b" }}>None</div>
      ) : (
        benched.map(p => (
          <div key={p.id} style={{
            ...dot, background: team==="Blue" ? "#3b82f6" : "#f43f5e"
          }}>{p.respawnTurns}</div>
        ))
      )}
    </div>
  );
}
