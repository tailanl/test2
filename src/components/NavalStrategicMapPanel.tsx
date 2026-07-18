import React, { useMemo, useState } from 'react';
import { useNavalStore } from '@/store/naval-store';
import type { FleetOperationalPosture } from '@/game/naval/naval-strategic-types';
import { buildReconProbabilityClouds, type ReconProbabilityCloud } from '@/game/naval/intel/recon-probability';
import { zhNavigationMode, zhRisk, zhWeather } from './zh-labels';

const GRID = 120;
const NAVAL_ASSETS = {
  carrierForce: '/assets/naval-ui/carrier-force.png',
  destroyerScreen: '/assets/naval-ui/destroyer-screen.png',
  scoutSearch: '/assets/naval-ui/scout-search.png',
  strikeBomber: '/assets/naval-ui/strike-bomber.png',
  enemyContact: '/assets/naval-ui/enemy-contact.png',
  routeWaypoint: '/assets/naval-ui/route-waypoint.png',
  chartTexture: '/assets/naval-ui/chart-texture.png',
};

const SEARCH_FAN_RIBS = 9;
type PendingMapOrder = 'search' | 'waypoint' | null;
type MapContextMenu = {
  screenX: number;
  screenY: number;
  worldPoint: { x: number; y: number };
  fleetId?: string;
  contactId?: string;
};

export function NavalStrategicMapPanel() {
  const {
    fleets,
    overlay,
    airOperations,
    intel,
    facilities,
    shippingLanes,
    currentTurn,
    weather,
    autoTurnEnabled,
    selectedFleetId,
    selectFleet,
    setFleetDestination,
    setFleetWaypoints,
    clearFleetNavigation,
    advanceNavalTurn,
    setAutoTurnEnabled,
    launchAirSearchSector,
    launchAirStrikeGroup,
  } = useNavalStore();
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [pendingMapOrder, setPendingMapOrder] = useState<PendingMapOrder>(null);
  const [contextMenu, setContextMenu] = useState<MapContextMenu | null>(null);
  const [draftWaypoints, setDraftWaypoints] = useState<Array<{ x: number; y: number }>>([]);
  const [draftWaypointFleetId, setDraftWaypointFleetId] = useState<string | null>(null);
  const playerFleets = fleets.filter((fleet) => fleet.faction === 'player');
  const visibleFleets = fleets.filter((fleet) => fleet.faction === 'player' || fleet.detectedByPlayer);
  const knownContacts = intel.playerContacts.filter((contact) => contact.detectionLevel !== 'none' && contact.detectionLevel !== 'lost');
  const strikeLegalContacts = knownContacts.filter((contact) => ['tracked', 'identified', 'classified', 'confirmed'].includes(contact.detectionLevel));
  const primaryContact = strikeLegalContacts[0] ?? knownContacts[0];
  const primaryStrikeContact = strikeLegalContacts[0];
  const selectedFleet = playerFleets.find((fleet) => fleet.id === selectedFleetId) || playerFleets[0];
  const contextFleet = playerFleets.find((fleet) => fleet.id === contextMenu?.fleetId) || selectedFleet;
  const contextContact = knownContacts.find((contact) => contact.id === contextMenu?.contactId) || primaryContact;
  const width = overlay?.[0]?.length ?? 3000;
  const height = overlay?.length ?? 2000;
  const reconClouds = useMemo(() => buildReconProbabilityClouds({
    contacts: intel.playerContacts,
    airOperations,
    searchMissions: intel.searchMissions,
    currentTurn,
    weather,
    ownPosition: selectedFleet ? { x: selectedFleet.position.globalX, y: selectedFleet.position.globalY } : undefined,
  }), [airOperations, currentTurn, intel.playerContacts, intel.searchMissions, selectedFleet, weather]);
  const reconCloudSummary = useMemo(() => ({
    coverage: reconClouds.filter((cloud) => cloud.kind === 'search_coverage').length,
    contacts: reconClouds.filter((cloud) => cloud.kind === 'contact_probability').length,
  }), [reconClouds]);

  const cells = useMemo(() => {
    if (!overlay) return [];
    const cols = Math.ceil(width / GRID);
    const rows = Math.ceil(height / GRID);
    return Array.from({ length: rows }).flatMap((_, row) =>
      Array.from({ length: cols }).map((__, col) => {
        const sampleX = Math.min(width - 1, Math.round((col + 0.5) * GRID));
        const sampleY = Math.min(height - 1, Math.round((row + 0.5) * GRID));
        const type = overlay[sampleY]?.[sampleX]?.seaZoneType;
        const fill =
          type === 'island' ? '#4f5936' :
          type === 'reef' ? '#7aa48b' :
          type === 'shallow_water' ? '#4f8b8a' :
          type === 'coastal_water' ? '#346f78' :
          '#244a5b';
        return { id: `${col}-${row}`, col, row, fill, type, blocked: type === 'island' || type === 'reef' };
      }),
    );
  }, [height, overlay, width]);

  const toScreenY = (worldY: number) => height - worldY;
  const routePoints = selectedFleet?.navigation?.path ?? [];
  const routeDestination = selectedFleet?.navigation?.destination ?? selectedFleet?.targetPosition;
  const committedWaypoints = selectedFleet?.navigation?.routeSource === 'manual_waypoints'
    ? selectedFleet.navigation.manualWaypoints ?? []
    : [];
  const activeDraftWaypoints = draftWaypointFleetId === selectedFleet?.id ? draftWaypoints : [];
  const manualWaypoints = activeDraftWaypoints.length > 0 ? activeDraftWaypoints : committedWaypoints;
  const manualWaypointCount = manualWaypoints.length;
  const contextManualWaypointCount = contextFleet?.id === selectedFleet?.id
    ? manualWaypointCount
    : contextFleet?.navigation?.manualWaypoints?.length ?? 0;
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = svgWorldPoint(event, width, height);
    setHoverPoint(point);
  };

  const handleMapClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!selectedFleet) return;
    const point = svgWorldPoint(event, width, height);
    setContextMenu(null);
    if (pendingMapOrder === 'search') {
      launchSearchToward(selectedFleet.id, point);
      setPendingMapOrder(null);
      return;
    }
    if (pendingMapOrder === 'waypoint') {
      appendWaypoint(selectedFleet.id, point);
      return;
    }
    setFleetDestination(selectedFleet.id, point);
  };

  const handleMapContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (!selectedFleet) return;
    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      worldPoint: svgWorldPoint(event, width, height),
      fleetId: selectedFleet.id,
    });
  };

  const openFleetContextMenu = (event: React.MouseEvent<SVGGElement>, fleetId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = svgWorldPoint(event, width, height);
    selectFleet(fleetId);
    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      worldPoint: point,
      fleetId,
    });
  };

  const openContactContextMenu = (event: React.MouseEvent<SVGGElement>, contactId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = svgWorldPoint(event, width, height);
    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      worldPoint: point,
      fleetId: selectedFleet?.id,
      contactId,
    });
  };

  const beginWaypointMode = () => {
    if (!selectedFleet) return;
    setDraftWaypoints(committedWaypoints);
    setDraftWaypointFleetId(selectedFleet.id);
    setPendingMapOrder((mode) => mode === 'waypoint' ? null : 'waypoint');
    setContextMenu(null);
  };

  const appendWaypoint = (fleetId: string, point: { x: number; y: number }) => {
    const fleet = playerFleets.find((item) => item.id === fleetId);
    const base = fleetId === selectedFleet?.id
      ? (activeDraftWaypoints.length > 0 ? activeDraftWaypoints : committedWaypoints)
      : fleet?.navigation?.manualWaypoints ?? [];
    const next = [...base, point].slice(0, 12);
    if (fleetId === selectedFleet?.id) {
      setDraftWaypoints(next);
      setDraftWaypointFleetId(fleetId);
    }
    setFleetWaypoints(fleetId, next);
  };

  const undoWaypoint = (fleetId?: string) => {
    const fleet = fleetId ? playerFleets.find((item) => item.id === fleetId) : selectedFleet;
    if (!fleet) return;
    const base = fleet.id === selectedFleet?.id
      ? (activeDraftWaypoints.length > 0 ? activeDraftWaypoints : committedWaypoints)
      : fleet.navigation?.manualWaypoints ?? [];
    const next = base.slice(0, -1);
    if (fleet.id === selectedFleet?.id) {
      setDraftWaypoints(next);
      setDraftWaypointFleetId(fleet.id);
    }
    if (next.length > 0) setFleetWaypoints(fleet.id, next);
    else clearFleetNavigation(fleet.id);
  };

  const clearWaypoints = (fleetId?: string) => {
    const fleet = fleetId ? playerFleets.find((item) => item.id === fleetId) : selectedFleet;
    if (!fleet) return;
    if (fleet.id === selectedFleet?.id) {
      setDraftWaypoints([]);
      setDraftWaypointFleetId(null);
    }
    clearFleetNavigation(fleet.id);
  };

  const launchSearchToward = (fleetId: string, point: { x: number; y: number }) => {
    const fleet = playerFleets.find((item) => item.id === fleetId);
    if (!fleet) return false;
    const distance = Math.hypot(point.x - fleet.position.globalX, point.y - fleet.position.globalY);
    return launchAirSearchSector(fleet.id, {
      headingDeg: mapBearing(fleet.position.globalX, fleet.position.globalY, point.x, point.y),
      arcWidthDeg: 82,
      range: Math.max(180, Math.min(620, Math.round(distance || 390))),
      teams: 5,
      scouts: 4,
      fighters: 2,
    });
  };

  const executeContextCommand = (command: 'move' | 'addWaypoint' | 'undoWaypoint' | 'clearWaypoints' | 'search' | 'strike' | 'toggleAuto' | 'step') => {
    if (!contextMenu) return;
    const fleet = contextFleet;
    if (command === 'toggleAuto') {
      setAutoTurnEnabled(!autoTurnEnabled);
      setContextMenu(null);
      return;
    }
    if (command === 'step') {
      advanceNavalTurn();
      setContextMenu(null);
      return;
    }
    if (!fleet) return;
    if (command === 'move') {
      setFleetDestination(fleet.id, contextMenu.worldPoint);
    }
    if (command === 'addWaypoint') {
      appendWaypoint(fleet.id, contextMenu.worldPoint);
      setPendingMapOrder('waypoint');
    }
    if (command === 'undoWaypoint') {
      undoWaypoint(fleet.id);
    }
    if (command === 'clearWaypoints') {
      clearWaypoints(fleet.id);
    }
    if (command === 'search') {
      launchSearchToward(fleet.id, contextMenu.worldPoint);
    }
    if (command === 'strike' && contextContact) {
      launchAirStrikeGroup(fleet.id, {
        contactId: contextContact.id,
        fighters: 6,
        diveBombers: 12,
        torpedoBombers: 6,
      });
    }
    if (command !== 'addWaypoint') setPendingMapOrder(null);
    setContextMenu(null);
  };

  return (
    <div className="battlefield-frame relative h-full w-full overflow-hidden bg-[#203834]" onClick={() => setContextMenu(null)}>
      <svg
        className="h-full w-full cursor-crosshair select-none"
        viewBox={`0 0 ${width} ${height}`}
        onPointerMove={handlePointer}
        onPointerLeave={() => setHoverPoint(null)}
        onClick={handleMapClick}
        onContextMenu={handleMapContextMenu}
        role="img"
        aria-label="Coarse naval chart"
      >
        <defs>
          <radialGradient id="oceanGradient" cx="42%" cy="45%" r="78%">
            <stop offset="0%" stopColor="#4e8a87" />
            <stop offset="48%" stopColor="#2f6674" />
            <stop offset="100%" stopColor="#183642" />
          </radialGradient>
          <linearGradient id="paperWash" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#d7c38d" stopOpacity="0.22" />
            <stop offset="42%" stopColor="#8fb2a0" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#152a34" stopOpacity="0.32" />
          </linearGradient>
          <pattern id="chartGrid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="#d4c08a" strokeWidth="2.5" opacity="0.1" />
            <path d={`M ${GRID} 0 L ${GRID} ${GRID * 5} M ${GRID * 2} 0 L ${GRID * 2} ${GRID * 5} M ${GRID * 3} 0 L ${GRID * 3} ${GRID * 5} M ${GRID * 4} 0 L ${GRID * 4} ${GRID * 5} M 0 ${GRID} L ${GRID * 5} ${GRID} M 0 ${GRID * 2} L ${GRID * 5} ${GRID * 2} M 0 ${GRID * 3} L ${GRID * 5} ${GRID * 3} M 0 ${GRID * 4} L ${GRID * 5} ${GRID * 4}`} fill="none" stroke="#f0d79a" strokeWidth="1" opacity="0.026" />
          </pattern>
          <filter id="chartNoise" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="4" seed="17" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="table" tableValues="0 0.16" />
            </feComponentTransfer>
          </filter>
          <filter id="unitCounterShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="8" stdDeviation="7" floodColor="#020617" floodOpacity="0.5" />
          </filter>
          <filter id="routeGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="reconCloudBlur" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="11" />
          </filter>
          <filter id="fanDiffusionBlur" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <rect width={width} height={height} fill="url(#oceanGradient)" />
        <image
          href={NAVAL_ASSETS.chartTexture}
          x={0}
          y={0}
          width={width}
          height={height}
          preserveAspectRatio="none"
          opacity={0.38}
        />
        <rect width={width} height={height} fill="url(#paperWash)" />
        <rect width={width} height={height} filter="url(#chartNoise)" opacity={0.85} />
        {cells.map((cell) => (
          <g key={cell.id}>
            <rect
              x={cell.col * GRID}
              y={height - (cell.row + 1) * GRID}
              width={GRID}
              height={GRID}
              rx={cell.blocked ? 22 : 0}
              fill={cell.fill}
              stroke={cell.blocked ? '#d4c08a' : '#7dd3fc'}
              strokeWidth={cell.blocked ? 2.4 : 0.35}
              opacity={cell.blocked ? 0.74 : cell.type === 'shallow_water' || cell.type === 'coastal_water' ? 0.18 : 0.08}
            />
            {cell.blocked && (
              <path
                d={terrainSketchPath(cell.col * GRID, height - (cell.row + 1) * GRID, GRID)}
                fill="none"
                stroke="#17251f"
                strokeWidth={3}
                opacity={0.28}
              />
            )}
          </g>
        ))}

        <rect width={width} height={height} fill="url(#chartGrid)" />

        <g opacity={0.52}>
          {Array.from({ length: Math.ceil(width / 500) }).map((_, index) => (
            <text key={`lon-${index}`} x={120 + index * 500} y={42} fill="#7dd3fc" fontSize={24} fontWeight={800} opacity={0.58}>
              {148 + index}E
            </text>
          ))}
          {Array.from({ length: Math.ceil(height / 420) }).map((_, index) => (
            <text key={`lat-${index}`} x={30} y={160 + index * 420} fill="#7dd3fc" fontSize={24} fontWeight={800} opacity={0.48}>
              {6 + index}S
            </text>
          ))}
        </g>

        <g opacity={0.24} fontWeight={900} letterSpacing={10} fill="#bae6fd">
          <text x={width * 0.35} y={height * 0.34} fontSize={74} transform={`rotate(-8 ${width * 0.35} ${height * 0.34})`}>所罗门海</text>
          <text x={width * 0.52} y={height * 0.7} fontSize={64} transform={`rotate(-6 ${width * 0.52} ${height * 0.7})`}>珊瑚海</text>
          <text x={width * 0.12} y={height * 0.52} fontSize={46} transform={`rotate(-19 ${width * 0.12} ${height * 0.52})`}>狭槽海域</text>
        </g>

        <g transform={`translate(${width - 170} 150)`} opacity={0.78}>
          <circle r={70} fill="rgba(2,6,23,0.45)" stroke="#38bdf8" strokeWidth={3} />
          <path d="M 0 -58 L 13 0 L 0 58 L -13 0 Z" fill="#bae6fd" opacity={0.85} />
          <path d="M -58 0 L 0 13 L 58 0 L 0 -13 Z" fill="#38bdf8" opacity={0.35} />
          <text y={-78} textAnchor="middle" fill="#e0f2fe" fontSize={26} fontWeight={900}>北</text>
        </g>

        <g opacity={0.72} filter="url(#routeGlow)">
          {shippingLanes.map((lane) => (
            <polyline
              key={`glow_${lane.id}`}
              points={lane.waypoints.map((point) => `${point.globalX},${toScreenY(point.globalY)}`).join(' ')}
              fill="none"
              stroke="#22c55e"
              strokeWidth={12}
              strokeDasharray="18 18"
              opacity={0.2}
            />
          ))}
        </g>
        <g opacity={0.58}>
          {shippingLanes.map((lane) => (
            <polyline
              key={lane.id}
              points={lane.waypoints.map((point) => `${point.globalX},${toScreenY(point.globalY)}`).join(' ')}
              fill="none"
              stroke="#86efac"
              strokeWidth={4}
              strokeDasharray="14 16"
            />
          ))}
        </g>

        {facilities.map((facility) => {
          const airfield = facility.type === 'airfield';
          const friendly = facility.faction === 'player';
          return (
            <g key={facility.id} transform={`translate(${facility.x} ${toScreenY(facility.y)})`}>
              {airfield ? (
                <>
                  <circle
                    r={9}
                    fill={friendly ? '#0284c7' : '#991b1b'}
                    stroke={friendly ? '#bae6fd' : '#fecaca'}
                    strokeWidth={2}
                    opacity={0.72}
                  />
                  <path d="M -10 0 L 10 0 M 0 -7 L 0 7" stroke="#dbeafe" strokeWidth={2} opacity={0.78} />
                </>
              ) : (
                <>
                  <rect
                    x={-12}
                    y={-12}
                    width={24}
                    height={24}
                    rx={3}
                    fill={friendly ? '#0284c7' : '#991b1b'}
                    stroke={friendly ? '#bae6fd' : '#fecaca'}
                    strokeWidth={2.5}
                    opacity={0.82}
                  />
                  <text y={34} textAnchor="middle" fill="#dbeafe" fontSize={17} fontWeight={800} paintOrder="stroke" stroke="#020617" strokeWidth={5}>
                    {facility.type === 'naval_base' ? '基' : '艇'}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {reconClouds.map((cloud) => renderReconCloud(cloud, height))}

        {knownContacts.map((contact) => (
          <g
            key={contact.id}
            transform={`translate(${contact.lastKnownPosition.x} ${toScreenY(contact.lastKnownPosition.y)})`}
            onContextMenu={(event) => openContactContextMenu(event, contact.id)}
            className="cursor-pointer"
          >
            <path
              d="M 0 -32 L 32 0 L 0 32 L -32 0 Z"
              fill={contact.detectionLevel === 'tracked' || contact.detectionLevel === 'identified' ? 'rgba(239,68,68,0.42)' : 'rgba(245,158,11,0.34)'}
              stroke={contact.detectionLevel === 'tracked' || contact.detectionLevel === 'identified' ? '#fecaca' : '#fde68a'}
              strokeWidth={3}
              opacity={0.9}
            />
            <image
              href={NAVAL_ASSETS.enemyContact}
              x={-38}
              y={-38}
              width={76}
              height={76}
              opacity={0.95}
            />
            <text y={-32} textAnchor="middle" fill="#fecaca" fontSize={22} fontWeight={900} paintOrder="stroke" stroke="#020617" strokeWidth={7}>
              {contact.estimatedClass || contact.id}
            </text>
          </g>
        ))}

        {(routePoints.length > 0 || manualWaypointCount > 0) && selectedFleet && routeDestination && (
          <g>
            {selectedFleet.navigation?.segments?.map((segment, index) => (
              <line
                key={`leg_${index}`}
                x1={segment.from.x}
                y1={toScreenY(segment.from.y)}
                x2={segment.to.x}
                y2={toScreenY(segment.to.y)}
                stroke={segmentRiskColor(segment.risk)}
              strokeWidth={13}
              strokeLinecap="round"
              opacity={0.42}
              filter="url(#routeGlow)"
            />
          ))}
            <polyline
              points={[
                `${selectedFleet.position.globalX},${toScreenY(selectedFleet.position.globalY)}`,
                ...routePoints.map((point) => `${point.x},${toScreenY(point.y)}`),
              ].join(' ')}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={7}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="22 16"
              opacity={0.95}
              filter="url(#routeGlow)"
            />
            {routePoints.map((point, index) => (
              <g key={`wp_${index}`} transform={`translate(${point.x} ${toScreenY(point.y)})`}>
                <circle r={9} fill="#f59e0b" stroke="#fffbeb" strokeWidth={3} opacity={0.72} />
                <text y={-18} textAnchor="middle" fill="#fed7aa" fontSize={14} fontWeight={900} paintOrder="stroke" stroke="#020617" strokeWidth={4}>
                  {index + 1}
                </text>
              </g>
            ))}
            {manualWaypoints.map((point, index) => (
              <g key={`manual_wp_${index}`} transform={`translate(${point.x} ${toScreenY(point.y)})`}>
                <circle r={31} fill="rgba(14,165,233,0.18)" stroke="#67e8f9" strokeWidth={5} strokeDasharray="8 6" />
                <image href={NAVAL_ASSETS.routeWaypoint} x={-25} y={-25} width={50} height={50} opacity={0.98} />
                <text y={-34} textAnchor="middle" fill="#cffafe" fontSize={22} fontWeight={950} paintOrder="stroke" stroke="#020617" strokeWidth={6}>
                  P{index + 1}
                </text>
              </g>
            ))}
            <circle
              cx={routeDestination.x}
              cy={toScreenY(routeDestination.y)}
              r={22}
              fill="none"
              stroke="#fbbf24"
              strokeWidth={7}
            />
          </g>
        )}

        {airOperations.filter((op) => op.type !== 'search').map((op) => (
          <g key={op.id} transform={`translate(${op.x} ${toScreenY(op.y)}) rotate(${op.heading})`}>
            <image
              href={op.type === 'strike' ? NAVAL_ASSETS.strikeBomber : NAVAL_ASSETS.scoutSearch}
              x={-34}
              y={-34}
              width={68}
              height={68}
              opacity={op.type === 'cap' ? 0.72 : 0.92}
            />
            <circle cx={0} cy={0} r={28} fill="none" stroke="#bae6fd" strokeWidth={2} opacity={0.35} />
          </g>
        ))}

        {visibleFleets.map((fleet) => {
          const selected = fleet.id === selectedFleet?.id;
          const posture = fleet.operation?.posture;
          const hostile = fleet.faction === 'enemy';
          const counterWidth = selected ? 152 : 132;
          const counterHeight = selected ? 68 : 58;
          const shipTicks = Math.min(12, Math.max(3, fleet.ships.length));
          return (
            <g
              key={fleet.id}
              transform={`translate(${fleet.position.globalX} ${toScreenY(fleet.position.globalY)})`}
              onClick={(event) => {
                event.stopPropagation();
                if (fleet.faction === 'player') selectFleet(fleet.id);
              }}
              onContextMenu={(event) => openFleetContextMenu(event, fleet.id)}
              className={fleet.faction === 'player' ? 'cursor-pointer' : 'cursor-default'}
            >
              <g filter="url(#unitCounterShadow)">
                <rect
                  x={-counterWidth / 2}
                  y={-counterHeight / 2}
                  width={counterWidth}
                  height={counterHeight}
                  rx={7}
                  fill={hostile ? 'rgba(92,20,30,0.9)' : 'rgba(20,45,105,0.92)'}
                  stroke={selected ? '#fde68a' : hostile ? '#fecaca' : '#bfdbfe'}
                  strokeWidth={selected ? 5 : 3}
                />
                <rect
                  x={-counterWidth / 2 + 5}
                  y={-counterHeight / 2 + 5}
                  width={counterWidth - 10}
                  height={counterHeight - 10}
                  rx={4}
                  fill="none"
                  stroke={operationStrokeColor(posture)}
                  strokeWidth={2}
                  opacity={posture ? 0.88 : 0.35}
                />
                <path
                  d={`M ${-counterWidth / 2 + 8} ${-counterHeight / 2 + 8} L ${-counterWidth / 2 + 46} ${-counterHeight / 2 + 8} L ${-counterWidth / 2 + 8} ${counterHeight / 2 - 8} Z`}
                  fill={hostile ? '#ef4444' : '#2563eb'}
                  stroke="#f8fafc"
                  strokeWidth={2}
                  opacity={0.92}
                />
                <image
                  href={fleetIcon(fleet.type, hostile)}
                  x={-counterWidth / 2 + 13}
                  y={-21}
                  width={42}
                  height={42}
                  opacity={0.82}
                />
                <text x={12} y={-7} textAnchor="middle" fill="#f8fafc" fontSize={selected ? 24 : 21} fontWeight={900} paintOrder="stroke" stroke="#020617" strokeWidth={5}>
                  {fleetCounterCode(fleet.type)}
                </text>
                <g transform={`translate(${-shipTicks * 6} ${counterHeight / 2 - 18})`}>
                  {Array.from({ length: shipTicks }).map((_, index) => (
                    <rect
                      key={`ship_tick_${index}`}
                      x={index * 12}
                      y={0}
                      width={8}
                      height={14}
                      rx={2}
                      fill={hostile ? '#fca5a5' : '#93c5fd'}
                      opacity={0.84}
                    />
                  ))}
                </g>
              </g>
              {selected && (
                <path
                  d={starPath(0, -counterHeight / 2 - 22, 17, 7, 5)}
                  fill="#fde047"
                  stroke="#1f2937"
                  strokeWidth={3}
                />
              )}
              <text y={counterHeight / 2 + 36} textAnchor="middle" fill={selected ? '#fde68a' : hostile ? '#fecaca' : '#cbd5e1'} fontSize={28} fontWeight={800} paintOrder="stroke" stroke="#020617" strokeWidth={8}>
                {fleet.name}
              </text>
              {posture && (
                <text y={counterHeight / 2 + 64} textAnchor="middle" fill={operationStrokeColor(posture)} fontSize={20} fontWeight={800} paintOrder="stroke" stroke="#020617" strokeWidth={6}>
                  {operationMapLabel(posture)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="battlefield-top-rail absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2">
        <button type="button" className={`battlefield-round-button ${pendingMapOrder === 'waypoint' ? 'is-active' : ''}`} title="路径点模式" onClick={beginWaypointMode} disabled={!selectedFleet}>
          <img src={NAVAL_ASSETS.routeWaypoint} alt="" />
        </button>
        <button type="button" className={`battlefield-round-button ${pendingMapOrder === 'search' ? 'is-active' : ''}`} title="选择侦察方向" onClick={() => setPendingMapOrder((mode) => mode === 'search' ? null : 'search')}>
          <img src={NAVAL_ASSETS.scoutSearch} alt="" />
        </button>
        <div className="battlefield-turn-box">
          <span>回合 {currentTurn}</span>
          <b>{zhWeather(weather)}</b>
        </div>
        <button type="button" className="battlefield-round-button" title={primaryStrikeContact ? '攻击' : '需要已分类/跟踪接触'} disabled={!selectedFleet || !primaryStrikeContact} onClick={() => selectedFleet && primaryStrikeContact && launchAirStrikeGroup(selectedFleet.id, {
          contactId: primaryStrikeContact.id,
          fighters: 6,
          diveBombers: 12,
          torpedoBombers: 6,
        })}>
          <img src={NAVAL_ASSETS.strikeBomber} alt="" />
        </button>
        <button
          type="button"
          className={`battlefield-round-button ${autoTurnEnabled ? 'is-active' : ''}`}
          title={autoTurnEnabled ? '暂停自动推进' : '开启自动推进'}
          onClick={() => setAutoTurnEnabled(!autoTurnEnabled)}
        >
          <span>{autoTurnEnabled ? 'Ⅱ' : '▶'}</span>
        </button>
        <button type="button" className="battlefield-round-button" title="推进回合" onClick={advanceNavalTurn}>
          <span>✓</span>
        </button>
      </div>

      {selectedFleet && (pendingMapOrder === 'waypoint' || manualWaypointCount > 0) && (
        <div
          className="battlefield-waypoint-strip absolute left-1/2 top-[64px] z-10 flex -translate-x-1/2 items-center gap-2 px-3 py-2 text-xs font-black"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="text-cyan-100">路径点 {manualWaypointCount}/12</span>
          <button type="button" onClick={() => setPendingMapOrder(null)}>完成</button>
          <button type="button" onClick={() => undoWaypoint()} disabled={manualWaypointCount === 0}>撤销上一点</button>
          <button type="button" onClick={() => clearWaypoints()} disabled={manualWaypointCount === 0}>清空航线</button>
        </div>
      )}

      <div className="battlefield-command-dock absolute bottom-4 left-1/2 z-10 flex w-[min(720px,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {[NAVAL_ASSETS.carrierForce, NAVAL_ASSETS.destroyerScreen, NAVAL_ASSETS.scoutSearch, NAVAL_ASSETS.strikeBomber].map((asset, index) => (
            <span key={`${asset}_${index}`} className="battlefield-unit-slot">
              <img src={asset} alt="" />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-black text-amber-100">{selectedFleet?.name ?? '未选择舰队'}</div>
          <div className="mt-1 truncate text-[11px] font-bold uppercase tracking-[0.12em] text-slate-300">
            {pendingMapOrder === 'search'
              ? '点击海图选择侦察方向'
              : pendingMapOrder === 'waypoint'
                ? '左键添加路径点，右键打开命令'
                : autoTurnEnabled ? '自动推进中' : '自动推进暂停'} · {selectedFleet?.navigation ? `${zhNavigationMode(selectedFleet.navigation.mode)} / ${zhRisk(selectedFleet.navigation.routeRisk)} / P${manualWaypointCount}` : '待命'} · {knownContacts.length} 个接触
          </div>
        </div>
        <button type="button" className="battlefield-confirm-button" onClick={() => setAutoTurnEnabled(!autoTurnEnabled)}>
          {autoTurnEnabled ? '暂停' : '自动'}
        </button>
      </div>

      <div className="pointer-events-none absolute left-4 top-[82px] hidden max-w-[calc(100%-2rem)] rounded-md border border-sky-500/20 bg-slate-950/70 px-4 py-3 text-xs text-slate-300 shadow-2xl backdrop-blur min-[760px]:block min-[900px]:max-w-sm">
        <div className="font-black uppercase tracking-[0.2em] text-sky-200">作战海图</div>
        <div className="mt-1 text-slate-500">{pendingMapOrder === 'search' ? '选择侦察方向：点击目标海域放出扇形搜索。' : pendingMapOrder === 'waypoint' ? '路径点模式：左键连续添加控制点；完成后舰队按序推进。' : '点击海图为当前舰队指定目标点；右键棋子打开命令。'}</div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <span>舰队: <b className="text-amber-200">{selectedFleet?.name ?? '无'}</b></span>
          <span>姿态: <b className="text-sky-200">{operationMapLabel(selectedFleet?.operation?.posture)}</b></span>
          <span>航线: <b className={selectedFleet?.navigation?.routeRisk === 'high' ? 'text-red-300' : selectedFleet?.navigation?.routeRisk === 'medium' ? 'text-amber-300' : 'text-emerald-300'}>{selectedFleet?.navigation ? `${zhNavigationMode(selectedFleet.navigation.mode)}/${zhRisk(selectedFleet.navigation.routeRisk)}/T${selectedFleet.navigation.etaTurns ?? '?'}/P${manualWaypointCount}` : '无'}</b></span>
          <span>侦察: <b className="text-cyan-200">{reconCloudSummary.coverage} 覆盖 / {reconCloudSummary.contacts} 接触</b></span>
          {hoverPoint && <span>XY {hoverPoint.x},{hoverPoint.y}</span>}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 w-56 rounded-md border border-amber-300/35 bg-slate-950/95 p-2 text-xs text-slate-200 shadow-2xl backdrop-blur"
          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div className="border-b border-slate-800 px-2 pb-2">
            <div className="font-black text-amber-200">{contextFleet?.name ?? '当前舰队'}</div>
            <div className="mt-1 text-[10px] text-slate-500">XY {contextMenu.worldPoint.x},{contextMenu.worldPoint.y}</div>
          </div>
          <div className="mt-2 grid gap-1">
            <MapContextButton label="前进到这里" icon={NAVAL_ASSETS.routeWaypoint} onClick={() => executeContextCommand('move')} disabled={!contextFleet} />
            <MapContextButton label="添加为路径点" icon={NAVAL_ASSETS.routeWaypoint} onClick={() => executeContextCommand('addWaypoint')} disabled={!contextFleet} />
            <MapContextButton label="撤销上一航点" onClick={() => executeContextCommand('undoWaypoint')} disabled={!contextFleet || contextManualWaypointCount === 0} />
            <MapContextButton label="清空当前航线" onClick={() => executeContextCommand('clearWaypoints')} disabled={!contextFleet || contextManualWaypointCount === 0} />
            <MapContextButton label="扇形侦察此方向" icon={NAVAL_ASSETS.scoutSearch} onClick={() => executeContextCommand('search')} disabled={!contextFleet} />
            <MapContextButton
              label={contextContact ? `攻击 ${contextContact.estimatedClass || contextContact.id}` : '攻击机群'}
              icon={NAVAL_ASSETS.strikeBomber}
              onClick={() => executeContextCommand('strike')}
              disabled={!contextFleet || !contextContact || !contactStrikeReady(contextContact.detectionLevel)}
            />
            <MapContextButton label={autoTurnEnabled ? '暂停自动推进' : '继续自动推进'} onClick={() => executeContextCommand('toggleAuto')} />
            <MapContextButton label="单步推进回合" onClick={() => executeContextCommand('step')} />
          </div>
          <div className="mt-2 rounded border border-slate-800 bg-slate-900/75 px-2 py-1.5 text-[10px] leading-4 text-slate-500">
            左键棋子选择；路径点模式左键连续加点，右键位置可加入航线或执行侦察/打击命令。
          </div>
        </div>
      )}
    </div>
  );
}

function MapContextButton({ label, icon, onClick, disabled }: { label: string; icon?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/80 px-2 py-2 text-left font-bold text-slate-200 transition hover:border-amber-300/60 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon && <img src={icon} alt="" className="h-5 w-5 object-contain" />}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function renderReconCloud(cloud: ReconProbabilityCloud, height: number): React.ReactNode {
  const cx = Math.round(cloud.center.x);
  const cy = Math.round(height - cloud.center.y);
  const heading = cloud.bearingDeg ?? 0;
  const opacity = cloud.kind === 'search_coverage' ? 0.56 + cloud.probability * 0.28 : 0.62 + cloud.probability * 0.22;
  const safeId = reconSvgId(cloud.id);

  if (cloud.kind === 'search_coverage' && cloud.path && cloud.path.length >= 2) {
    return renderSearchSweepTrack(cloud, height, safeId, opacity);
  }

  if (cloud.kind === 'search_coverage' && cloud.origin && cloud.range && cloud.arcWidthDeg) {
    const originScreen = { x: Math.round(cloud.origin.x), y: Math.round(height - cloud.origin.y) };
    const heatId = `${safeId}_fan_heat`;
    const coreId = `${safeId}_fan_core`;
    const diffusionPath = sectorBandPath(
      cloud.origin.x,
      cloud.origin.y,
      heading,
      Math.min(190, cloud.arcWidthDeg * 1.18),
      cloud.range * 0.68,
      cloud.range * 1.08,
      height,
    );
    return (
      <g
        key={cloud.id}
        data-recon-cloud-kind={cloud.kind}
        data-recon-render="fan_heatmap"
        aria-label={cloud.recommendation}
        opacity={opacity}
      >
        <defs>
          <radialGradient id={heatId} gradientUnits="userSpaceOnUse" cx={originScreen.x} cy={originScreen.y} r={cloud.range}>
            <stop offset="0%" stopColor="#fde68a" stopOpacity={0.42 + cloud.probability * 0.08} />
            <stop offset="24%" stopColor="#facc15" stopOpacity={0.34 + cloud.probability * 0.06} />
            <stop offset="54%" stopColor="#22c55e" stopOpacity={0.23} />
            <stop offset="82%" stopColor="#38bdf8" stopOpacity={0.13} />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={coreId} gradientUnits="userSpaceOnUse" cx={originScreen.x} cy={originScreen.y} r={cloud.range * 0.76}>
            <stop offset="0%" stopColor="#fff7ad" stopOpacity={0.46 + cloud.probability * 0.08} />
            <stop offset="38%" stopColor="#facc15" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          data-recon-heat-field="search"
          d={sectorPath(cloud.origin.x, cloud.origin.y, heading, cloud.arcWidthDeg, cloud.range, height)}
          fill={`url(#${heatId})`}
          filter="url(#reconCloudBlur)"
          opacity={0.95}
        />
        <path
          data-recon-heat-core="search"
          d={sectorPath(cloud.origin.x, cloud.origin.y, heading, Math.max(12, cloud.arcWidthDeg * 0.42), cloud.range * 0.78, height)}
          fill={`url(#${coreId})`}
          opacity={0.76}
        />
        <path
          data-recon-fan-diffusion="smooth"
          d={diffusionPath}
          fill={`url(#${heatId})`}
          filter="url(#fanDiffusionBlur)"
          opacity={0.34}
        />
        {renderFanRibs(cloud.origin, heading, cloud.arcWidthDeg, cloud.range, height)}
      </g>
    );
  }

  const contactHeatId = `${safeId}_contact_heat`;
  return (
    <g
      key={cloud.id}
      data-recon-cloud-kind={cloud.kind}
      data-recon-render="contact_heatmap"
      aria-label={cloud.recommendation}
      opacity={opacity}
    >
      <defs>
        <radialGradient
          id={contactHeatId}
          gradientUnits="userSpaceOnUse"
          cx={cx}
          cy={cy}
          r={Math.max(cloud.radiusX, cloud.radiusY) * 1.25}
        >
          <stop offset="0%" stopColor="#fde68a" stopOpacity={0.24 + cloud.probability * 0.12} />
          <stop offset="36%" stopColor="#f97316" stopOpacity={0.24} />
          <stop offset="72%" stopColor="#ef4444" stopOpacity={0.14} />
          <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        data-recon-heat-field="contact"
        cx={cx}
        cy={cy}
        rx={Math.max(18, cloud.radiusX * 1.18)}
        ry={Math.max(16, cloud.radiusY * 1.02)}
        transform={`rotate(${heading} ${cx} ${cy})`}
        fill={`url(#${contactHeatId})`}
        filter="url(#reconCloudBlur)"
        opacity={0.9}
      />
      <path
        d={`M ${cx} ${cy - 18} L ${cx + 18} ${cy} L ${cx} ${cy + 18} L ${cx - 18} ${cy} Z`}
        fill={cloudRiskColor(cloud.risk)}
        opacity={0.58}
      />
    </g>
  );
}

function renderSearchSweepTrack(cloud: ReconProbabilityCloud, height: number, safeId: string, opacity: number): React.ReactNode {
  const path = cloud.path ?? [];
  const points = path.map((point) => `${Math.round(point.x)},${Math.round(height - point.y)}`).join(' ');
  const last = path[path.length - 1] ?? cloud.center;
  const lastX = Math.round(last.x);
  const lastY = Math.round(height - last.y);
  const heatId = `${safeId}_track_heat`;
  const radius = Math.max(34, Math.min(170, cloud.range ?? cloud.radiusX));
  return (
    <g
      key={cloud.id}
      data-recon-cloud-kind={cloud.kind}
      data-recon-render="sweep_track"
      aria-label={cloud.recommendation}
      opacity={opacity}
    >
      <defs>
        <radialGradient id={heatId} gradientUnits="userSpaceOnUse" cx={lastX} cy={lastY} r={radius * 1.2}>
          <stop offset="0%" stopColor="#fff7ad" stopOpacity={0.34 + cloud.probability * 0.12} />
          <stop offset="48%" stopColor="#22c55e" stopOpacity={0.2 + cloud.probability * 0.04} />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polyline
        data-recon-sweep-corridor="true"
        points={points}
        fill="none"
        stroke="#22c55e"
        strokeWidth={Math.max(58, radius * 1.2)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.12}
        filter="url(#reconCloudBlur)"
      />
      <polyline
        data-recon-sweep-core="true"
        points={points}
        fill="none"
        stroke="#fde68a"
        strokeWidth={Math.max(18, radius * 0.36)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.2 + cloud.probability * 0.18}
        filter="url(#fanDiffusionBlur)"
      />
      <circle
        data-recon-sweep-current="true"
        cx={lastX}
        cy={lastY}
        r={radius}
        fill={`url(#${heatId})`}
        filter="url(#reconCloudBlur)"
        opacity={0.86}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r={Math.max(7, Math.min(16, radius * 0.12))}
        fill="#fef3c7"
        stroke="#0f172a"
        strokeWidth={3}
        opacity={0.92}
      />
    </g>
  );
}

function renderFanRibs(origin: { x: number; y: number }, heading: number, arcWidth: number, range: number, height: number): React.ReactNode {
  const half = arcWidth / 2;
  const denominator = Math.max(1, SEARCH_FAN_RIBS - 1);
  return Array.from({ length: SEARCH_FAN_RIBS }).map((_, index) => {
    const t = index / denominator;
    const offset = -half + arcWidth * t;
    const centerWeight = 1 - Math.min(1, Math.abs(t - 0.5) * 2);
    const start = sectorPointCoord(origin.x, origin.y, heading + offset, range * 0.08, height);
    const end = sectorPointCoord(origin.x, origin.y, heading + offset, range * (0.9 + centerWeight * 0.08), height);
    return (
      <line
        key={`fan_rib_${index}`}
        data-recon-fan-rib="true"
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        stroke={centerWeight > 0.6 ? '#fde68a' : '#a7f3d0'}
        strokeWidth={centerWeight > 0.6 ? 2.2 : 1.35}
        strokeLinecap="round"
        opacity={0.15 + centerWeight * 0.22}
      />
    );
  });
}

function cloudRiskColor(risk: ReconProbabilityCloud['risk']): string {
  if (risk === 'high') return '#ef4444';
  if (risk === 'medium') return '#f59e0b';
  return '#f97316';
}

function reconSvgId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sectorBandPath(originX: number, originY: number, heading: number, arcWidth: number, innerRange: number, outerRange: number, height: number): string {
  if (innerRange <= 1) return sectorPath(originX, originY, heading, arcWidth, outerRange, height);
  const half = arcWidth / 2;
  const steps = Math.max(4, Math.ceil(arcWidth / 10));
  const startAngle = heading - half;
  const endAngle = heading + half;
  const points = [
    `M ${sectorPoint(originX, originY, startAngle, innerRange, height)}`,
    `L ${sectorPoint(originX, originY, startAngle, outerRange, height)}`,
  ];
  for (let index = 1; index <= steps; index++) {
    const angle = startAngle + (arcWidth * index) / steps;
    points.push(`L ${sectorPoint(originX, originY, angle, outerRange, height)}`);
  }
  points.push(`L ${sectorPoint(originX, originY, endAngle, innerRange, height)}`);
  for (let index = steps - 1; index >= 0; index--) {
    const angle = startAngle + (arcWidth * index) / steps;
    points.push(`L ${sectorPoint(originX, originY, angle, innerRange, height)}`);
  }
  points.push('Z');
  return points.join(' ');
}

function sectorPath(originX: number, originY: number, heading: number, arcWidth: number, range: number, height: number): string {
  const points = [`M ${originX} ${height - originY}`];
  const half = arcWidth / 2;
  const steps = Math.max(4, Math.ceil(arcWidth / 12));
  points.push(`L ${sectorPoint(originX, originY, heading - half, range, height)}`);
  for (let index = 1; index <= steps; index++) {
    const angle = heading - half + (arcWidth * index) / steps;
    points.push(`L ${sectorPoint(originX, originY, angle, range, height)}`);
  }
  points.push('Z');
  return points.join(' ');
}

function sectorPoint(originX: number, originY: number, heading: number, range: number, height: number): string {
  const point = sectorPointCoord(originX, originY, heading, range, height);
  return `${point.x} ${point.y}`;
}

function sectorPointCoord(originX: number, originY: number, heading: number, range: number, height: number): { x: number; y: number } {
  const rad = heading * Math.PI / 180;
  const x = originX + Math.sin(rad) * range;
  const y = originY - Math.cos(rad) * range;
  return { x: Math.round(x), y: Math.round(height - y) };
}

function segmentRiskColor(risk: 'low' | 'medium' | 'high'): string {
  if (risk === 'high') return '#ef4444';
  if (risk === 'medium') return '#f59e0b';
  return '#22c55e';
}

function fleetIcon(type: string, hostile: boolean): string {
  if (hostile) return NAVAL_ASSETS.enemyContact;
  if (type === 'carrier_task_force') return NAVAL_ASSETS.carrierForce;
  return NAVAL_ASSETS.destroyerScreen;
}

function fleetCounterCode(type: string): string {
  if (type === 'carrier_task_force') return 'CV';
  if (type === 'surface_action_group') return 'SAG';
  if (type === 'submarine_wolfpack') return 'SS';
  if (type === 'amphibious_group') return 'AMP';
  if (type === 'convoy') return 'CVY';
  return 'TF';
}

function terrainSketchPath(x: number, y: number, size: number): string {
  const left = x + size * 0.16;
  const top = y + size * 0.2;
  const right = x + size * 0.84;
  const bottom = y + size * 0.76;
  return [
    `M ${left} ${top + 8}`,
    `C ${x + size * 0.32} ${top - 6}, ${x + size * 0.52} ${top + 14}, ${right} ${top}`,
    `C ${right + 10} ${y + size * 0.42}, ${right - 6} ${y + size * 0.58}, ${right - 18} ${bottom}`,
    `C ${x + size * 0.56} ${bottom + 12}, ${x + size * 0.34} ${bottom - 8}, ${left + 10} ${bottom}`,
    `C ${left - 10} ${y + size * 0.54}, ${left - 2} ${y + size * 0.36}, ${left} ${top + 8}`,
  ].join(' ');
}

function starPath(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const commands: string[] = [];
  for (let index = 0; index < points * 2; index++) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (Math.PI * index) / points;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    commands.push(`${index === 0 ? 'M' : 'L'} ${Math.round(x)} ${Math.round(y)}`);
  }
  commands.push('Z');
  return commands.join(' ');
}

function operationMapLabel(posture?: FleetOperationalPosture): string {
  switch (posture) {
    case 'strike_preparation': return '打击整备';
    case 'aircraft_recovery': return '飞机回收';
    case 'fighter_direction': return '战机引导';
    case 'smoke_screen': return '烟幕';
    case 'surface_engagement': return '水面战';
    case 'torpedo_attack': return '鱼雷攻击';
    case 'radio_silence': return '静默';
    case 'shore_bombardment': return '岸轰';
    case 'underway_replenishment': return '海上补给';
    case 'transport_run': return '运输';
    case 'normal':
    case undefined:
      return '常规';
    default: {
      const _exhaustive: never = posture;
      return _exhaustive;
    }
  }
}

function operationStrokeColor(posture?: FleetOperationalPosture): string {
  switch (posture) {
    case 'strike_preparation':
    case 'torpedo_attack':
    case 'shore_bombardment':
      return '#f87171';
    case 'aircraft_recovery':
    case 'underway_replenishment':
      return '#34d399';
    case 'fighter_direction':
      return '#38bdf8';
    case 'smoke_screen':
    case 'radio_silence':
      return '#cbd5e1';
    case 'surface_engagement':
      return '#fbbf24';
    case 'transport_run':
      return '#c084fc';
    case 'normal':
    case undefined:
      return '#93c5fd';
    default: {
      const _exhaustive: never = posture;
      return _exhaustive;
    }
  }
}

function contactStrikeReady(level: string): boolean {
  return ['tracked', 'identified', 'classified', 'confirmed'].includes(level);
}

function mapBearing(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.round(((Math.atan2(toX - fromX, fromY - toY) * 180 / Math.PI) % 360 + 360) % 360);
}

function svgWorldPoint(event: React.PointerEvent<SVGElement> | React.MouseEvent<SVGElement>, width: number, height: number): { x: number; y: number } {
  const svg = event.currentTarget instanceof SVGSVGElement
    ? event.currentTarget
    : event.currentTarget.ownerSVGElement;
  const rect = (svg ?? event.currentTarget).getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * width;
  const screenY = ((event.clientY - rect.top) / rect.height) * height;
  return {
    x: Math.max(0, Math.min(width - 1, Math.round(x))),
    y: Math.max(0, Math.min(height - 1, Math.round(height - screenY))),
  };
}
