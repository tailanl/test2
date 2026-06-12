/**
 * 海军搜索模式
 */

export interface SearchPattern {
  name: string;
  description: string;
  generateArcDegs: (centerDeg: number) => Array<{ centerDeg: number; widthDeg: number }>;
}

export const SEARCH_PATTERNS: Record<string, SearchPattern> = {
  fan: {
    name: 'Fan Search',
    description: 'Fan-shaped search covering 180 degree arc',
    generateArcDegs: (centerDeg: number) => {
      const arcs: Array<{ centerDeg: number; widthDeg: number }> = [];
      const totalArc = 180;
      const segments = 4;
      const arcWidth = totalArc / segments;
      for (let i = 0; i < segments; i++) {
        arcs.push({
          centerDeg: ((centerDeg - totalArc / 2 + arcWidth / 2 + i * arcWidth) + 360) % 360,
          widthDeg: arcWidth,
        });
      }
      return arcs;
    },
  },
  double_fan: {
    name: 'Double Fan Search',
    description: 'Two overlapping fan searches for better coverage',
    generateArcDegs: (centerDeg: number) => {
      const arcs: Array<{ centerDeg: number; widthDeg: number }> = [];
      const totalArc = 120;
      const segments = 3;
      const arcWidth = totalArc / segments;
      for (let i = 0; i < segments; i++) {
        arcs.push({
          centerDeg: ((centerDeg - totalArc / 2 + arcWidth / 2 + i * arcWidth) + 360) % 360,
          widthDeg: arcWidth * 1.5,
        });
      }
      return arcs;
    },
  },
  sector: {
    name: 'Sector Search',
    description: 'Concentrated search in a narrow sector',
    generateArcDegs: (centerDeg: number) => {
      return [{
        centerDeg,
        widthDeg: 60,
      }];
    },
  },
  360: {
    name: '360 Search',
    description: 'Full 360 degree sweep',
    generateArcDegs: (_centerDeg: number) => {
      const arcs: Array<{ centerDeg: number; widthDeg: number }> = [];
      for (let i = 0; i < 6; i++) {
        arcs.push({
          centerDeg: i * 60,
          widthDeg: 80,
        });
      }
      return arcs;
    },
  },
};
