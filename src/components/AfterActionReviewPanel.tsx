/**
 * AfterActionReviewPanel - 战后复盘面板
 * 显示 LLM 决策效果、CampaignMemory 记录
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';

export function AfterActionReviewPanel() {
  const fleets = useNavalStore(s => s.fleets);
  const intel = useNavalStore(s => s.intel);
  const reports = useNavalStore(s => s.reports);
  const battleLog = useNavalStore(s => s.battleLog);
  const currentTurn = useNavalStore(s => s.currentTurn);
  const weather = useNavalStore(s => s.weather);
  const victory = useNavalStore(s => s.victory);
  const overlay = useNavalStore(s => s.overlay);
  const airOps = useNavalStore(s => s.airOperations);
  const facilities = useNavalStore(s => s.facilities);

  if (!overlay || fleets.length === 0) return null;

  const playerFleet = fleets.find(f => f.faction === 'player');
  const enemyFleet = fleets.find(f => f.faction === 'enemy');
  const playerAlive = playerFleet?.ships.filter(s => s.damage.status !== 'sunk' && s.damage.status !== 'sinking').length || 0;
  const enemyAlive = enemyFleet?.ships.filter(s => s.damage.status !== 'sunk' && s.damage.status !== 'sinking').length || 0;
  const playerTotal = playerFleet?.ships.length || 0;
  const enemyTotal = enemyFleet?.ships.length || 0;

  return (
    <div className="px-5 py-3 border-b border-purple-900/20 text-[10px]">
      <div className="text-purple-400 font-bold text-xs mb-2 tracking-wider">📊 战后复盘</div>
      <div className="space-y-1.5 text-slate-400">
        <div className="flex justify-between">
          <span>回合</span>
          <span className="text-slate-300">{currentTurn}</span>
        </div>
        <div className="flex justify-between">
          <span>天气</span>
          <span className={weather === 'storm' ? 'text-red-400' : weather === 'fog' ? 'text-yellow-400' : 'text-green-400'}>{weather}</span>
        </div>
        <div className="flex justify-between">
          <span>美军存活</span>
          <span className={playerAlive < playerTotal ? 'text-yellow-400' : 'text-green-400'}>{playerAlive}/{playerTotal}</span>
        </div>
        <div className="flex justify-between">
          <span>日军存活</span>
          <span className={enemyAlive < enemyTotal ? 'text-yellow-400' : 'text-green-400'}>{enemyAlive}/{enemyTotal}</span>
        </div>
        <div className="flex justify-between">
          <span>接触</span>
          <span>{intel.playerContacts.length}</span>
        </div>
        <div className="flex justify-between">
          <span>战斗事件</span>
          <span>{battleLog.length}</span>
        </div>
        <div className="flex justify-between">
          <span>报告</span>
          <span>{reports.length}</span>
        </div>
        <div className="flex justify-between">
          <span>空中任务</span>
          <span>{airOps.length}</span>
        </div>
        <div className="flex justify-between">
          <span>设施</span>
          <span>{facilities.length}</span>
        </div>
        {victory !== 'none' && (
          <div className={`mt-2 py-1 px-2 rounded text-center font-bold ${victory === 'player' ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
            {victory === 'player' ? '🏆 美军胜利' : '💀 日军胜利'}
          </div>
        )}
      </div>
    </div>
  );
}
