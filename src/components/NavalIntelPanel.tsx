/**
 * NavalIntelPanel - 情报面板：显示 contacts 而非真实敌舰
 */

import React from 'react';
import { useNavalStore } from '@/store/naval-store';

export function NavalIntelPanel() {
  const { intel } = useNavalStore();
  const contacts = intel.playerContacts;

  if (contacts.length === 0) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        <div className="text-amber-400/50 text-xs font-bold mb-2">NO CONTACTS</div>
        <p className="text-xs">No enemy contacts detected on any sensors.</p>
        <p className="text-xs mt-2 text-gray-600">Launch search aircraft or reposition ships to find enemy forces.</p>
      </div>
    );
  }

  const grouped = {
    tracked: contacts.filter((c) => c.detectionLevel === 'tracked'),
    identified: contacts.filter((c) => c.detectionLevel === 'identified'),
    classified: contacts.filter((c) => c.detectionLevel === 'classified'),
    detected: contacts.filter((c) => c.detectionLevel === 'detected'),
    suspected: contacts.filter((c) => c.detectionLevel === 'suspected'),
    lost: contacts.filter((c) => c.detectionLevel === 'lost'),
  };

  return (
    <div className="p-2 text-sm">
      <div className="text-xs text-gray-400 mb-2">
        Turn {intel.turn} | {contacts.length} contacts
      </div>

      {Object.entries(grouped).map(([level, items]) => {
        if (items.length === 0) return null;
        const colors: Record<string, string> = {
          tracked: 'border-l-amber-400',
          identified: 'border-l-red-400',
          classified: 'border-l-orange-400',
          detected: 'border-l-yellow-400',
          suspected: 'border-l-gray-400',
          lost: 'border-l-gray-600',
        };

        return (
          <div key={level} className="mb-3">
            <div className={`text-[10px] font-bold uppercase mb-1 ${
              level === 'tracked' ? 'text-amber-400' :
              level === 'identified' ? 'text-red-400' :
              level === 'classified' ? 'text-orange-400' :
              level === 'detected' ? 'text-yellow-400' :
              level === 'lost' ? 'text-gray-600' :
              'text-gray-400'
            }`}>
              {level} ({items.length})
            </div>

            {items.map((contact) => (
              <div
                key={contact.id}
                className={`pl-2 py-1 mb-1 border-l-2 ${colors[level] || 'border-l-gray-600'} bg-gray-800/30 rounded-r text-[10px] ${contact.stale ? 'opacity-60' : ''}`}
              >
                <div className="flex justify-between">
                  <span className="text-gray-300 font-semibold">
                    {contact.estimatedClass || 'Unknown'}
                  </span>
                  <span className={`${
                    contact.confidence === 'high' ? 'text-green-400' :
                    contact.confidence === 'medium' ? 'text-yellow-400' :
                    'text-gray-500'
                  }`}>
                    {contact.confidence}
                  </span>
                </div>

                <div className="text-gray-500 mt-0.5">
                  Pos: ({contact.lastKnownPosition.x.toFixed(0)}, {contact.lastKnownPosition.y.toFixed(0)})
                  {contact.uncertaintyRadius > 1 && (
                    <span> ±{contact.uncertaintyRadius.toFixed(1)}</span>
                  )}
                </div>

                <div className="text-gray-600">
                  Last seen: T{contact.lastDetectedTurn}
                  {contact.detectedBy.length > 0 && (
                    <span> via {contact.detectedBy[contact.detectedBy.length - 1].sensorType.replace(/_/g, ' ')}</span>
                  )}
                </div>

                {contact.trackHistory.length > 1 && (
                  <div className="text-gray-600 mt-0.5">
                    Track: {contact.trackHistory.length} updates
                  </div>
                )}

                {contact.stale && (
                  <div className="text-yellow-500/70 mt-0.5">STALE</div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
