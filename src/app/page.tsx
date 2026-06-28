'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameEngine } from '@/game/engine';
import {
  UNIT_STATS, BUILDING_STATS, AGE_INFO, AGE_ORDER,
  UnitType, BuildingType, Age, ResourceType,
} from '@/game/constants';

interface SelectionState {
  unitIds: number[];
  buildingId: number | null;
}

interface ResourcesState {
  wood: number;
  food: number;
  gold: number;
  pop: number;
  popCap: number;
  age: Age;
  advancing: { from: Age; to: Age; progress: number; total: number } | null;
}

interface EnemyInfoState {
  age: Age;
  pop: number;
  popCap: number;
}

export default function Home() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [selection, setSelection] = useState<SelectionState>({ unitIds: [], buildingId: null });
  const [resources, setResources] = useState<ResourcesState>({
    wood: 200, food: 200, gold: 100, pop: 0, popCap: 5, age: 'dark', advancing: null,
  });
  const [enemyInfo, setEnemyInfo] = useState<EnemyInfoState>({ age: 'dark', pop: 0, popCap: 5 });
  const [placingBuilding, setPlacingBuilding] = useState<BuildingType | null>(null);
  const [gameOver, setGameOver] = useState<{ winner: 'player' | 'enemy' } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [dragBox, setDragBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [selectedBuildingData, setSelectedBuildingData] = useState<{
    type: BuildingType; hp: number; maxHp: number; queue: { unit: UnitType; progress: number }[];
    underConstruction: boolean; buildProgress: number;
  } | null>(null);
  const [selectedUnitsData, setSelectedUnitsData] = useState<{
    types: UnitType[]; count: number;
  } | null>(null);
  const [minimapTick, setMinimapTick] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showBuildPanel, setShowBuildPanel] = useState(false);
  const [unitIcons, setUnitIcons] = useState<Record<string, string>>({});
  const [buildingIcons, setBuildingIcons] = useState<Record<string, string>>({});

  // Detect mobile / small screen
  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      setIsMobile(mobile);
      if (engineRef.current) engineRef.current.isMobile = mobile;
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Toast / log helper
  const log = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-4), `[${new Date().toLocaleTimeString().slice(0, 8)}] ${msg}`]);
  }, []);

  // Initialize engine
  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new GameEngine(mountRef.current, {
      onSelectionChange: (sel) => {
        setSelection(sel);
        if (sel.buildingId !== null) {
          const b = engine.getSelectedBuilding();
          if (b) {
            setSelectedBuildingData({
              type: b.type,
              hp: b.hp,
              maxHp: b.maxHp,
              queue: b.queue.map(q => ({ unit: q.unit, progress: q.progress })),
              underConstruction: b.underConstruction,
              buildProgress: b.buildProgress,
            });
            setSelectedUnitsData(null);
          }
        } else if (sel.unitIds.length > 0) {
          const units = engine.getSelectedUnits();
          setSelectedUnitsData({
            types: units.map(u => u.type),
            count: units.length,
          });
          setSelectedBuildingData(null);
        } else {
          setSelectedUnitsData(null);
          setSelectedBuildingData(null);
        }
      },
      onResourcesChange: (player, enemy) => {
        setResources({
          wood: player.resources.wood,
          food: player.resources.food,
          gold: player.resources.gold,
          pop: player.pop,
          popCap: player.popCap,
          age: player.age,
          advancing: player.advancing,
        });
        setEnemyInfo({ age: enemy.age, pop: enemy.pop, popCap: enemy.popCap });
      },
      onGameOver: (winner) => {
        setGameOver({ winner });
      },
      onBuildingPlace: (active, type) => {
        setPlacingBuilding(active ? type : null);
      },
      onLog: (msg) => log(msg),
    });
    engine.init();
    engine.start();
    engine.isMobile = window.innerWidth < 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    engineRef.current = engine;

    // Load preview icons for all unit/building types (deferred to next tick
    // so it doesn't block the first paint and avoids the set-state-in-effect lint)
    const uIcons: Record<string, string> = {};
    const bIcons: Record<string, string> = {};
    (['villager', 'militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman',
      'archer', 'crossbowman', 'arbalester',
      'scout', 'knight', 'cavalier', 'ram'] as UnitType[]).forEach(t => {
      uIcons[t] = engine.getUnitIconURL(t);
    });
    (['town_center', 'house', 'barracks', 'archery_range', 'stable',
      'siege_workshop', 'storage', 'tower', 'wall'] as BuildingType[]).forEach(t => {
      bIcons[t] = engine.getBuildingIconURL(t);
    });
    // Use a microtask to defer the state update out of the effect body
    Promise.resolve().then(() => {
      setUnitIcons(uIcons);
      setBuildingIcons(bIcons);
    });

    // Periodic HUD refresh (for queue progress, HP changes, minimap)
    const interval = setInterval(() => {
      const e = engineRef.current;
      if (!e) return;
      if (e.isGameOver()) return;
      // Refresh selected building queue
      const b = e.getSelectedBuilding();
      if (b) {
        setSelectedBuildingData({
          type: b.type,
          hp: b.hp,
          maxHp: b.maxHp,
          queue: b.queue.map(q => ({ unit: q.unit, progress: q.progress })),
          underConstruction: b.underConstruction,
          buildProgress: b.buildProgress,
        });
      }
      // Refresh minimap (re-render)
      setMinimapTick(t => (t + 1) % 1000000);
      // Refresh drag box visual
      const db = e.getDragBox();
      setDragBox(db);
      // Resources update (for resource growth display)
      const p = e.getPlayer();
      const en = e.getEnemy();
      setResources({
        wood: Math.floor(p.resources.wood),
        food: Math.floor(p.resources.food),
        gold: Math.floor(p.resources.gold),
        pop: p.pop,
        popCap: p.popCap,
        age: p.age,
        advancing: p.advancing,
      });
      setEnemyInfo({ age: en.age, pop: en.pop, popCap: en.popCap });
    }, 100);

    // ESC to cancel building placement
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (engineRef.current) {
          engineRef.current.cancelBuildingPlacement();
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Delete selected units
        const sel = engineRef.current?.getSelectedUnits() || [];
        // (deletion not implemented in engine; placeholder)
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', onKey);
      engine.dispose();
      engineRef.current = null;
    };
  }, [log]);

  // Build buttons available based on age, grouped by category
  const ageIdx = AGE_ORDER.indexOf(resources.age);
  const buildingCategories: { label: string; icon: string; buildings: BuildingType[] }[] = ([
    { label: 'Economy', icon: '⚖', buildings: ['town_center', 'house', 'storage'] as BuildingType[] },
    { label: 'Military', icon: '⚔', buildings: ['barracks', 'archery_range', 'stable', 'siege_workshop'] as BuildingType[] },
    { label: 'Defense', icon: '🛡', buildings: ['tower', 'wall'] as BuildingType[] },
  ] as const).map(cat => ({
    ...cat,
    buildings: cat.buildings.filter(t => {
      const s = BUILDING_STATS[t];
      return AGE_ORDER.indexOf(s.age) <= ageIdx;
    }),
  })).filter(cat => cat.buildings.length > 0);
  // Flat list for mobile (no categories)
  const availableBuildings: BuildingType[] = buildingCategories.flatMap(c => c.buildings);

  // Trainable units from selected building
  const selectedBuildingStats = selectedBuildingData ? BUILDING_STATS[selectedBuildingData.type] : null;
  const trainableUnits: UnitType[] = selectedBuildingStats?.produces || [];

  const handleBuildClick = (type: BuildingType) => {
    engineRef.current?.startBuildingPlacement(type);
  };

  const handleTrainClick = (unit: UnitType) => {
    engineRef.current?.trainFromSelected(unit);
  };

  const handleCancelTrain = (slot: number) => {
    engineRef.current?.cancelTrainFromSelected(slot);
  };

  const handleAdvanceAge = () => {
    engineRef.current?.advanceAge();
  };

  const handleRestart = () => {
    window.location.reload();
  };

  // Minimap rendering
  const minimapRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const engine = engineRef.current;
    if (!engine) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    // Background — sample terrain heights for a quick preview
    ctx.fillStyle = '#1a2530';
    ctx.fillRect(0, 0, W, H);
    // Water / grass approx via terrain heights
    const data = engine.getMinimapData();
    const MAP_SIZE = 360;
    const toMx = (x: number) => ((x + MAP_SIZE / 2) / MAP_SIZE) * W;
    const toMz = (z: number) => ((z + MAP_SIZE / 2) / MAP_SIZE) * H;

    // Draw a simple background pattern (terrain colors by approximating)
    // We'll sample heights from the engine's terrain (cheap: just draw colored tiles)
    // For perf, only redraw every few frames — use minimapTick
    void minimapTick; // dependency

    // Draw resources (small dots)
    ctx.fillStyle = '#4a7a37'; // trees = green
    for (const r of data.resources) {
      if (r.type === 'wood') {
        ctx.fillStyle = '#2e5a2a';
        ctx.fillRect(toMx(r.x) - 1, toMz(r.z) - 1, 2, 2);
      } else if (r.type === 'gold') {
        ctx.fillStyle = '#ffcc33';
        ctx.fillRect(toMx(r.x) - 1, toMz(r.z) - 1, 3, 3);
      } else {
        ctx.fillStyle = '#c0392b';
        ctx.fillRect(toMx(r.x) - 1, toMz(r.z) - 1, 2, 2);
      }
    }

    // Draw buildings (squares)
    for (const b of data.buildings) {
      const color = b.team === 'player' ? '#4f8cff' : '#c0392b';
      ctx.fillStyle = color;
      const size = b.type === 'town_center' ? 5 : 3;
      ctx.fillRect(toMx(b.x) - size / 2, toMz(b.z) - size / 2, size, size);
    }

    // Draw units (dots)
    for (const u of data.units) {
      ctx.fillStyle = u.team === 'player' ? '#88ccff' : '#ff6666';
      ctx.fillRect(toMx(u.x) - 1, toMz(u.z) - 1, 2, 2);
    }

    // Draw camera viewport rectangle
    if (data.cameraView.length === 4) {
      ctx.strokeStyle = '#ffff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toMx(data.cameraView[0].x), toMz(data.cameraView[0].z));
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(toMx(data.cameraView[i].x), toMz(data.cameraView[i].z));
      }
      ctx.closePath();
      ctx.stroke();
    }
  }, [minimapTick]);

  const handleMinimapClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = minimapRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const mz = (e.clientY - rect.top) / rect.height;
    const MAP_SIZE = 360;
    const wx = mx * MAP_SIZE - MAP_SIZE / 2;
    const wz = mz * MAP_SIZE - MAP_SIZE / 2;
    engineRef.current?.panToMinimapPoint(wx, wz);
  };

  // Render a single building button (used by both mobile flat list and desktop categories)
  const renderBuildingButton = (type: BuildingType) => {
    const stats = BUILDING_STATS[type];
    const canAfford =
      (stats.cost.wood || 0) <= resources.wood &&
      (stats.cost.food || 0) <= resources.food &&
      (stats.cost.gold || 0) <= resources.gold;
    const ageOk = AGE_ORDER.indexOf(stats.age) <= AGE_ORDER.indexOf(resources.age);
    const disabled = !canAfford || !ageOk;
    const isPlacing = placingBuilding === type;
    return (
      <button
        key={type}
        onClick={() => handleBuildClick(type)}
        disabled={disabled}
        title={`${stats.label}\nCost: ${stats.cost.wood || 0}w ${stats.cost.food || 0}f ${stats.cost.gold || 0}g\nHP: ${stats.hp}\nRequires: ${AGE_INFO[stats.age].label}${stats.popProvided ? `\n+${stats.popProvided} pop` : ''}`}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: isMobile ? '0.3rem 0.3rem' : '0.35rem 0.4rem',
          background: isPlacing ? '#4f8cff' : (disabled ? '#1a2530' : '#2c4060'),
          color: disabled ? '#5a6878' : '#fff',
          border: `1px solid ${isPlacing ? '#88ccff' : (disabled ? '#2a3848' : '#4f8cff')}`,
          borderRadius: '4px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          minWidth: isMobile ? '56px' : '76px',
          minHeight: isMobile ? '56px' : 'auto',
          fontSize: isMobile ? '9px' : '10px',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {buildingIcons[type] ? (
          <img
            src={buildingIcons[type]}
            alt={stats.label}
            style={{
              width: isMobile ? 36 : 42,
              height: isMobile ? 36 : 42,
              objectFit: 'contain',
              filter: disabled ? 'grayscale(80%) brightness(0.6)' : 'none',
              imageRendering: 'auto',
            }}
          />
        ) : (
          <div style={{ width: 42, height: 42, background: '#1a2530', borderRadius: '2px' }} />
        )}
        <div style={{ fontSize: '9px', marginTop: '0.1rem', color: '#9ad7ff', fontWeight: 600 }}>
          {stats.cost.wood ? `${stats.cost.wood}w ` : ''}
          {stats.cost.food ? `${stats.cost.food}f ` : ''}
          {stats.cost.gold ? `${stats.cost.gold}g` : ''}
        </div>
        {stats.popProvided > 0 && (
          <div style={{ fontSize: '8px', color: '#c39bd3', marginTop: '0.05rem' }}>
            +{stats.popProvided} pop
          </div>
        )}
      </button>
    );
  };

  // Drag box overlay
  const renderDragBox = () => {
    if (!dragBox) return null;
    const x = Math.min(dragBox.x0, dragBox.x1);
    const y = Math.min(dragBox.y0, dragBox.y1);
    const w = Math.abs(dragBox.x1 - dragBox.x0);
    const h = Math.abs(dragBox.y1 - dragBox.y0);
    if (w < 5 && h < 5) return null;
    return (
      <div
        style={{
          position: 'fixed',
          left: x,
          top: y,
          width: w,
          height: h,
          border: '1.5px solid #88ff88',
          background: 'rgba(80, 255, 80, 0.12)',
          pointerEvents: 'none',
          zIndex: 50,
        }}
      />
    );
  };

  const ageIdxNext = AGE_ORDER.indexOf(resources.age) + 1;
  const canAdvance = ageIdxNext < AGE_ORDER.length;
  const nextAge = canAdvance ? AGE_ORDER[ageIdxNext] : null;
  const nextAgeInfo = nextAge ? AGE_INFO[nextAge] : null;

  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: '#000', fontFamily: 'system-ui, sans-serif', userSelect: 'none' }}>
      {/* 3D canvas mount */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Drag box */}
      {renderDragBox()}

      {/* === TOP BAR: Resources (responsive) === */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', gap: isMobile ? '0.6rem' : '1.5rem',
        padding: isMobile ? '0.35rem 0.5rem' : '0.5rem 1rem',
        background: 'linear-gradient(180deg, rgba(20, 28, 40, 0.95) 0%, rgba(20, 28, 40, 0.7) 100%)',
        borderBottom: '2px solid #4f8cff',
        color: '#e8eef5',
        fontSize: isMobile ? '11px' : '14px',
        zIndex: 20,
        pointerEvents: 'auto',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
          <span style={{ color: '#7ec050' }}>&#9728;</span>
          <span>{isMobile ? '' : 'Wood: '}{resources.wood}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
          <span style={{ color: '#e67e22' }}>&#9774;</span>
          <span>{isMobile ? '' : 'Food: '}{resources.food}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
          <span style={{ color: '#f1c40f' }}>&#9733;</span>
          <span>{isMobile ? '' : 'Gold: '}{resources.gold}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}>
          <span style={{ color: '#9b59b6' }}>&#9794;</span>
          <span>{resources.pop}/{resources.popCap}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          padding: '0.3rem 0.8rem',
          background: AGE_INFO[resources.age].color,
          color: '#1a1a1a',
          borderRadius: '4px',
          fontWeight: 700,
          fontSize: '13px',
        }}>
          {AGE_INFO[resources.age].label}
        </div>
        {resources.advancing ? (
          <div style={{
            padding: '0.3rem 0.8rem',
            background: '#2c3e50',
            color: '#f5e6a8',
            borderRadius: '4px',
            fontWeight: 600,
            fontSize: '12px',
            border: '1px solid #f5e6a8',
          }}>
            Advancing to {AGE_INFO[resources.advancing.to].label}: {Math.floor(resources.advancing.progress / resources.advancing.total * 100)}%
          </div>
        ) : canAdvance && nextAgeInfo ? (
          <button
            onClick={handleAdvanceAge}
            style={{
              padding: '0.3rem 0.8rem',
              background: nextAgeInfo.color,
              color: '#1a1a1a',
              border: 'none',
              borderRadius: '4px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '12px',
            }}
            title={`Cost: ${nextAgeInfo.advanceCost.food || 0} food, ${nextAgeInfo.advanceCost.gold || 0} gold`}
          >
            Advance to {nextAgeInfo.label} ({nextAgeInfo.advanceCost.food || 0}f{nextAgeInfo.advanceCost.gold ? `, ${nextAgeInfo.advanceCost.gold}g` : ''})
          </button>
        ) : null}
        <button
          onClick={() => setShowHelp(s => !s)}
          style={{
            padding: '0.3rem 0.6rem',
            background: '#34495e',
            color: '#fff',
            border: '1px solid #5a6c7d',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          ?
        </button>
      </div>

      {/* === MINIMAP (bottom-right, responsive) === */}
      <div style={{
        position: 'absolute',
        bottom: isMobile ? '3.5rem' : '0.5rem',
        right: '0.5rem',
        width: isMobile ? '120px' : '220px',
        height: isMobile ? '120px' : '220px',
        border: '2px solid #4f8cff',
        background: '#0a1018',
        zIndex: 20,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}>
        <canvas
          ref={minimapRef}
          width={isMobile ? 120 : 220}
          height={isMobile ? 120 : 220}
          onClick={handleMinimapClick}
          onTouchStart={(e) => {
            const t = e.touches[0];
            const rect = e.currentTarget.getBoundingClientRect();
            const mx = (t.clientX - rect.left) / rect.width;
            const mz = (t.clientY - rect.top) / rect.height;
            const MAP_SIZE = 360;
            const wx = mx * MAP_SIZE - MAP_SIZE / 2;
            const wz = mz * MAP_SIZE - MAP_SIZE / 2;
            engineRef.current?.panToMinimapPoint(wx, wz);
          }}
          style={{ width: '100%', height: '100%', cursor: 'pointer', display: 'block' }}
        />
      </div>

      {/* === SELECTION PANEL (bottom-left, responsive) === */}
      <div style={{
        position: 'absolute',
        bottom: isMobile ? '3.5rem' : '0.5rem',
        left: '0.5rem',
        minWidth: isMobile ? '140px' : '220px',
        maxWidth: isMobile ? '200px' : '300px',
        background: 'rgba(20, 28, 40, 0.92)',
        border: '2px solid #4f8cff',
        borderRadius: '6px',
        padding: isMobile ? '0.4rem 0.5rem' : '0.6rem 0.8rem',
        color: '#e8eef5',
        fontSize: isMobile ? '10px' : '13px',
        zIndex: 20,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
        maxHeight: isMobile ? '40vh' : '50vh',
        overflowY: 'auto',
      }}>
        {selectedUnitsData ? (
          <div>
            <div style={{ fontWeight: 700, marginBottom: '0.3rem', color: '#88ccff' }}>
              {selectedUnitsData.count} unit{selectedUnitsData.count !== 1 ? 's' : ''} selected
            </div>
            {/* Group by type, showing icon + label + count */}
            {Object.entries(
              selectedUnitsData.types.reduce<Record<string, number>>((acc, t) => {
                acc[t] = (acc[t] || 0) + 1; return acc;
              }, {})
            ).map(([t, count]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0' }}>
                {unitIcons[t] && (
                  <img
                    src={unitIcons[t]}
                    alt={UNIT_STATS[t as UnitType].label}
                    style={{ width: isMobile ? 28 : 32, height: isMobile ? 28 : 32, objectFit: 'contain' }}
                  />
                )}
                <span style={{ flex: 1 }}>{UNIT_STATS[t as UnitType].label}</span>
                <span style={{ color: '#88ccff', fontWeight: 600 }}>x{count}</span>
              </div>
            ))}
            <div style={{ marginTop: '0.4rem', fontSize: isMobile ? '9px' : '11px', color: '#9aa8b8' }}>
              {isMobile ? 'Long-press: move/gather/attack' : 'Right-click: move / gather / attack'}
            </div>
          </div>
        ) : selectedBuildingData ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              {buildingIcons[selectedBuildingData.type] && (
                <img
                  src={buildingIcons[selectedBuildingData.type]}
                  alt={BUILDING_STATS[selectedBuildingData.type].label}
                  style={{ width: isMobile ? 36 : 44, height: isMobile ? 36 : 44, objectFit: 'contain' }}
                />
              )}
              <div style={{ fontWeight: 700, color: '#88ccff' }}>
                {BUILDING_STATS[selectedBuildingData.type].label}
              </div>
            </div>
            {selectedBuildingData.underConstruction ? (
              <div style={{ marginBottom: '0.4rem' }}>
                <div style={{ fontSize: '11px', color: '#f5e6a8' }}>Under construction</div>
                <div style={{
                  width: '100%', height: '8px', background: '#1a2530',
                  borderRadius: '4px', overflow: 'hidden', marginTop: '0.2rem',
                }}>
                  <div style={{
                    width: `${selectedBuildingData.buildProgress * 100}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #f5e6a8, #d4af37)',
                    transition: 'width 0.1s linear',
                  }} />
                </div>
                <div style={{ fontSize: '11px', color: '#9aa8b8', marginTop: '0.15rem' }}>
                  {Math.floor(selectedBuildingData.buildProgress * 100)}%
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: '0.4rem' }}>
                <div style={{ fontSize: '11px', color: '#9aa8b8' }}>
                  HP: {Math.ceil(selectedBuildingData.hp)}/{selectedBuildingData.maxHp}
                </div>
                <div style={{
                  width: '100%', height: '6px', background: '#1a2530',
                  borderRadius: '3px', overflow: 'hidden', marginTop: '0.2rem',
                }}>
                  <div style={{
                    width: `${(selectedBuildingData.hp / selectedBuildingData.maxHp) * 100}%`,
                    height: '100%',
                    background: selectedBuildingData.hp / selectedBuildingData.maxHp > 0.5 ? '#33ff66' : '#ff6633',
                  }} />
                </div>
              </div>
            )}
            {/* Production queue */}
            {!selectedBuildingData.underConstruction && selectedBuildingData.queue.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', color: '#9aa8b8', marginBottom: '0.2rem' }}>Training:</div>
                {selectedBuildingData.queue.map((q, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    padding: '0.15rem 0', fontSize: '11px',
                  }}>
                    <span style={{ flex: 1 }}>{UNIT_STATS[q.unit].label}</span>
                    <div style={{
                      width: '60px', height: '6px', background: '#1a2530',
                      borderRadius: '3px', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${q.progress * 100}%`, height: '100%',
                        background: '#88ccff',
                      }} />
                    </div>
                    <button
                      onClick={() => handleCancelTrain(i)}
                      style={{
                        background: '#c0392b', color: '#fff', border: 'none',
                        borderRadius: '3px', padding: '0.1rem 0.4rem',
                        cursor: 'pointer', fontSize: '10px',
                      }}
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#9aa8b8' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.3rem' }}>No selection</div>
            <div style={{ fontSize: '11px' }}>
              Click or drag-box to select units.<br />
              Click a building to select it.
            </div>
          </div>
        )}
      </div>

      {/* === BUILD/TRAIN toggle button (mobile only) === */}
      {isMobile && !selectedBuildingData && !selectedUnitsData && (
        <button
          onClick={() => setShowBuildPanel(s => !s)}
          style={{
            position: 'absolute',
            bottom: '0.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '0.5rem 1.5rem',
            background: showBuildPanel ? '#4f8cff' : '#2c4060',
            color: '#fff',
            border: '2px solid #4f8cff',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '14px',
            zIndex: 21,
            pointerEvents: 'auto',
          }}
        >
          {showBuildPanel ? '✕ Close' : '🔨 Build'}
        </button>
      )}

      {/* === BUILD / TRAIN BAR (bottom-center, responsive) === */}
      {(!isMobile || showBuildPanel || selectedBuildingData || selectedUnitsData) && (
      <div style={{
        position: 'absolute',
        bottom: '0.5rem',
        left: isMobile ? '0.5rem' : '50%',
        right: isMobile ? '130px' : 'auto',
        transform: isMobile ? 'none' : 'translateX(-50%)',
        display: 'flex',
        gap: '0.3rem',
        padding: isMobile ? '0.3rem 0.4rem' : '0.4rem 0.6rem',
        background: 'rgba(20, 28, 40, 0.95)',
        border: '2px solid #4f8cff',
        borderRadius: '6px',
        color: '#e8eef5',
        zIndex: 20,
        maxWidth: isMobile ? 'calc(100vw - 145px)' : 'calc(100vw - 500px)',
        overflowX: 'auto',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      }}>
        {selectedBuildingData && !selectedBuildingData.underConstruction && trainableUnits.length > 0 ? (
          // Train panel
          trainableUnits.map(unit => {
            const stats = UNIT_STATS[unit];
            const ageOk = AGE_ORDER.indexOf(stats.age) <= AGE_ORDER.indexOf(resources.age);
            const canAfford =
              (stats.cost.wood || 0) <= resources.wood &&
              (stats.cost.food || 0) <= resources.food &&
              (stats.cost.gold || 0) <= resources.gold;
            const popOk = resources.pop + stats.popCost <= resources.popCap;
            const disabled = !ageOk || !canAfford || !popOk;
            return (
              <button
                key={unit}
                onClick={() => handleTrainClick(unit)}
                disabled={disabled}
                title={`${stats.label}\nCost: ${stats.cost.wood || 0}w ${stats.cost.food || 0}f ${stats.cost.gold || 0}g\nPop: ${stats.popCost}\nHP: ${stats.hp}  DMG: ${stats.damage}\nRequires: ${AGE_INFO[stats.age].label}`}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: isMobile ? '0.3rem 0.3rem' : '0.35rem 0.4rem',
                  background: disabled ? '#1a2530' : '#2c4060',
                  color: disabled ? '#5a6878' : '#fff',
                  border: `1px solid ${disabled ? '#2a3848' : '#4f8cff'}`,
                  borderRadius: '4px',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  minWidth: isMobile ? '56px' : '76px',
                  minHeight: isMobile ? '56px' : 'auto',
                  fontSize: isMobile ? '9px' : '10px',
                  opacity: disabled ? 0.5 : 1,
                }}
              >
                {unitIcons[unit] ? (
                  <img
                    src={unitIcons[unit]}
                    alt={stats.label}
                    style={{
                      width: isMobile ? 36 : 42,
                      height: isMobile ? 36 : 42,
                      objectFit: 'contain',
                      filter: disabled ? 'grayscale(80%) brightness(0.6)' : 'none',
                      imageRendering: 'auto',
                    }}
                  />
                ) : (
                  <div style={{ width: 42, height: 42, background: '#1a2530', borderRadius: '2px' }} />
                )}
                <div style={{ fontSize: '9px', marginTop: '0.1rem', color: '#9ad7ff', fontWeight: 600 }}>
                  {stats.cost.wood ? `${stats.cost.wood}w ` : ''}
                  {stats.cost.food ? `${stats.cost.food}f ` : ''}
                  {stats.cost.gold ? `${stats.cost.gold}g` : ''}
                </div>
              </button>
            );
          })
        ) : !selectedBuildingData && !selectedUnitsData ? (
          // Build panel (only shown when nothing is selected)
          // Desktop: categorized with headers. Mobile: flat row (space-constrained).
          isMobile ? (
            // Mobile: flat row of all buildings
            availableBuildings.map(type => renderBuildingButton(type))
          ) : (
            // Desktop: grouped by category with headers
            <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
              {buildingCategories.map(cat => (
                <div key={cat.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
                  <div style={{
                    fontSize: '10px', fontWeight: 700, color: '#9ad7ff',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    padding: '0.1rem 0.4rem', borderBottom: '1px solid #4f8cff',
                    marginBottom: '0.15rem',
                  }}>
                    {cat.icon} {cat.label}
                  </div>
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {cat.buildings.map(type => renderBuildingButton(type))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div style={{ color: '#9aa8b8', padding: '0.4rem 0.6rem', fontSize: '11px' }}>
            Select a building to train units, or deselect to see build options.
          </div>
        )}
      </div>
      )}

      {/* === LOG TOASTS (top-right under top bar) === */}
      <div style={{
        position: 'absolute',
        top: '3rem',
        right: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.2rem',
        maxWidth: '320px',
        zIndex: 15,
        pointerEvents: 'none',
      }}>
        {logs.map((l, i) => (
          <div key={i} style={{
            background: 'rgba(20, 28, 40, 0.9)',
            color: '#f5e6a8',
            padding: '0.3rem 0.6rem',
            borderRadius: '4px',
            border: '1px solid #5a6878',
            fontSize: '11px',
          }}>
            {l}
          </div>
        ))}
      </div>

      {/* === HELP OVERLAY === */}
      {showHelp && (
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(20, 28, 40, 0.97)',
          border: '2px solid #4f8cff',
          borderRadius: '8px',
          padding: '1.5rem',
          color: '#e8eef5',
          maxWidth: '540px',
          zIndex: 30,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontWeight: 700, fontSize: '18px', marginBottom: '0.8rem', color: '#88ccff' }}>
            How to Play
          </div>
          <div style={{ fontSize: isMobile ? '12px' : '13px', lineHeight: 1.6 }}>
            {isMobile ? (
              <>
                <div><b>📱 Mobile Controls:</b></div>
                <div style={{ marginLeft: '1rem', marginBottom: '0.4rem' }}>
                  <b>One finger:</b> tap = select, drag = box-select, long-press = command (move/gather/attack)<br />
                  <b>Two fingers:</b> drag = pan camera, pinch = zoom, twist = rotate<br />
                  <b>Minimap:</b> tap to jump camera<br />
                  <b>Build button:</b> tap 🔨 Build at bottom to open build menu, tap a building, then tap valid ground (green)
                </div>
              </>
            ) : (
              <>
                <div><b>Camera:</b></div>
                <div style={{ marginLeft: '1rem', marginBottom: '0.4rem' }}>
                  WASD / Arrows / Edge-pan to move<br />
                  Scroll wheel to zoom<br />
                  Q/E or middle-drag to rotate
                </div>
                <div><b>Selection:</b></div>
                <div style={{ marginLeft: '1rem', marginBottom: '0.4rem' }}>
                  Left-click to select a unit/building<br />
                  Drag left-click to box-select units<br />
                  Click empty ground to deselect
                </div>
                <div><b>Commands:</b></div>
                <div style={{ marginLeft: '1rem', marginBottom: '0.4rem' }}>
                  Right-click ground = move<br />
                  Right-click resource = gather (villager)<br />
                  Right-click enemy = attack<br />
                  Right-click friendly building under construction = build (villager)<br />
                  Right-click friendly production building = set rally point
                </div>
              </>
            )}
            <div><b>Building:</b></div>
            <div style={{ marginLeft: '1rem', marginBottom: '0.4rem' }}>
              {isMobile ? 'Tap 🔨 Build, choose a building, then tap valid ground (green ghost).' : 'Deselect everything to see the build bar at the bottom.'}<br />
              {isMobile ? 'Tap elsewhere or pick another building to cancel.' : 'Click a building, then left-click on valid ground (green ghost) to place. ESC cancels.'}<br />
              Idle villagers auto-assist construction.
            </div>
            <div><b>Ages:</b></div>
            <div style={{ marginLeft: '1rem', marginBottom: '0.4rem' }}>
              Tap "Advance to ..." in the top bar when you can afford it.<br />
              Higher ages unlock stronger units and buildings.
            </div>
            <div><b>Win/Lose:</b></div>
            <div style={{ marginLeft: '1rem' }}>
              Destroy the enemy Town Center to win.<br />
              Protect your Town Center — lose it and you lose.
            </div>
          </div>
          <button
            onClick={() => setShowHelp(false)}
            style={{
              marginTop: '1rem',
              padding: '0.4rem 1rem',
              background: '#4f8cff',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Got it
          </button>
        </div>
      )}

      {/* === GAME OVER OVERLAY === */}
      {gameOver && (
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.85)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }}>
          <div style={{
            fontSize: '48px',
            fontWeight: 800,
            color: gameOver.winner === 'player' ? '#33ff66' : '#ff3333',
            textShadow: '0 0 20px rgba(0,0,0,0.8)',
            marginBottom: '1rem',
          }}>
            {gameOver.winner === 'player' ? 'VICTORY!' : 'DEFEAT'}
          </div>
          <div style={{
            fontSize: '18px',
            color: '#e8eef5',
            marginBottom: '2rem',
          }}>
            {gameOver.winner === 'player'
              ? 'You have destroyed the enemy Town Center.'
              : 'Your Town Center has fallen.'}
          </div>
          <button
            onClick={handleRestart}
            style={{
              padding: '0.8rem 2rem',
              background: '#4f8cff',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '16px',
            }}
          >
            Play Again
          </button>
        </div>
      )}
    </div>
  );
}
