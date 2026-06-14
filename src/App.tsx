import React from 'react';
import { NavalScene3D } from './components/NavalScene3D';
import { SidePanel } from './components/SidePanel';

export function App() {
  return (
    <div className="flex w-full h-full bg-[#0a0e1a]">
      <div className="flex-1">
        <NavalScene3D />
      </div>
      <SidePanel />
    </div>
  );
}
