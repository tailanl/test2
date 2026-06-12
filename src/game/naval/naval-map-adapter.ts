/**
 * 海军地图适配器 - 独立地图系统
 * 重新导出独立地图生成器（不再依赖 WorldAtlas / RegionTile）
 */

export { generateNavalOverlay as createNavalOverlayFromRegionTile } from './naval-map-generator';
export { createNavalBattleMap } from './naval-map-generator';
