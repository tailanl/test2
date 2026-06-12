/**
 * 海军战争迷雾 - Fog of War UI
 */

import type { NavalIntelState, FogTileState } from './naval-intel-types';
import type { NavalShip } from '../ship/ship-types';
import type { NavalCellOverlay } from '../naval-types';

// ===== 获取可见海军单元格 =====

export function getVisibleNavalCells(params: {
  intel: NavalIntelState;
  friendlyShips: NavalShip[];
  overlay: NavalCellOverlay[][];
}): Record<string, FogTileState> {
  const { intel, friendlyShips, overlay } = params;
  const fogTiles: Record<string, FogTileState> = { ...intel.fogTiles };

  // 初始化所有 overlay 单元格
  for (let y = 0; y < overlay.length; y++) {
    for (let x = 0; x < (overlay[y]?.length ?? 0); x++) {
      const cell = overlay[y][x];
      if (!cell) continue;
      const key = `${cell.globalX}_${cell.globalY}`;

      if (!fogTiles[key]) {
        fogTiles[key] = {
          key,
          globalX: cell.globalX,
          globalY: cell.globalY,
          visibility: 'unknown',
        };
      }
    }
  }

  // 根据己方舰船更新可见性
  for (const ship of friendlyShips) {
    const visualRange = ship.sensors.visualRange;
    const radarRange = ship.sensors.radarOperational ? ship.sensors.surfaceRadarRange : 0;
    const maxRange = Math.max(visualRange, radarRange);

    for (let y = 0; y < overlay.length; y++) {
      for (let x = 0; x < (overlay[y]?.length ?? 0); x++) {
        const cell = overlay[y][x];
        if (!cell) continue;
        const key = `${cell.globalX}_${cell.globalY}`;
        const tile = fogTiles[key];
        if (!tile) continue;

        // 跳过已在己方控制的海区
        if (tile.visibility === 'controlled') continue;

        const dx = cell.globalX - ship.position.x;
        const dy = cell.globalY - ship.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= maxRange) {
          // 更新可见性
          if (tile.visibility === 'unknown') {
            tile.visibility = 'observed';
          } else if (tile.visibility === 'searched') {
            tile.visibility = 'observed';
          }
          tile.lastSeenTurn = intel.turn;
        }
      }
    }
  }

  // 已观察过的海区变为 searched
  for (const key of Object.keys(fogTiles)) {
    const tile = fogTiles[key];
    if (tile.visibility === 'observed' && tile.lastSeenTurn && tile.lastSeenTurn < intel.turn) {
      tile.visibility = 'searched';
    }
  }

  return fogTiles;
}

// ===== 检查网格是否在视野内 =====

export function isCellInFog(
  fogTiles: Record<string, FogTileState>,
  globalX: number,
  globalY: number
): boolean {
  const key = `${globalX}_${globalY}`;
  const tile = fogTiles[key];
  if (!tile) return true; // 未知 = 在雾中
  return tile.visibility === 'unknown';
}

// ===== 检查网格是否被观察过 =====

export function isCellSearched(
  fogTiles: Record<string, FogTileState>,
  globalX: number,
  globalY: number
): boolean {
  const key = `${globalX}_${globalY}`;
  const tile = fogTiles[key];
  if (!tile) return false;
  return tile.visibility === 'searched' || tile.visibility === 'observed' || tile.visibility === 'controlled';
}
