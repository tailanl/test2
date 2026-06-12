/**
 * NavalCommandPanel - 指挥面板
 */

import React, { useState } from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalCommandPanel() {
  const {
    fleets,
    selectedFleetId,
    submitNavalCommand,
    currentTurn,
  } = useNavalStore();

  const [command, setCommand] = useState('');

  const selectedFleet = fleets.find((f) => f.id === selectedFleetId);
  const playerFleets = fleets.filter((f) => f.faction === 'player');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim()) return;
    const fleetIds = selectedFleetId ? [selectedFleetId] : playerFleets.map((f) => f.id);
    submitNavalCommand(command, fleetIds);
    setCommand('');
  };

  return (
    <div className="p-3 text-sm space-y-3">
      {/* Turn info */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">Turn {currentTurn}</span>
        <span className="text-gray-500">
          {selectedFleet ? `Selected: ${selectedFleet.name}` : 'No fleet selected'}
        </span>
      </div>

      {/* Command suggestions */}
      <div className="text-[10px] text-gray-500 uppercase">Quick Orders</div>
      <div className="flex flex-wrap gap-1">
        {[
          'Launch search aircraft',
          'Launch CAP',
          'Turn to heading 090',
          'Increase speed to 25 knots',
          'Withdraw to east',
          'Engage with main guns',
          'Launch torpedo attack',
          'Form screen formation',
        ].map((cmd) => (
          <button
            key={cmd}
            onClick={() => setCommand(cmd)}
            className="text-[10px] px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Command input */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Enter command..."
          className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 placeholder-gray-600"
        />
        <button
          type="submit"
          disabled={!command.trim()}
          className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-xs"
        >
          Send
        </button>
      </form>

      {/* Fleet selection */}
      <div className="text-[10px] text-gray-500 uppercase mt-2">Your Fleets</div>
      {playerFleets.map((fleet) => (
        <div
          key={fleet.id}
          className="text-xs text-gray-400 flex items-center justify-between"
        >
          <span>{fleet.name}</span>
          <span className="text-gray-500">{fleet.ships.length}s</span>
        </div>
      ))}
      {playerFleets.length === 0 && (
        <div className="text-xs text-gray-600">No player fleets</div>
      )}
    </div>
  );
}
